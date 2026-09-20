import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const cases = [];
const ids = { operator: api.userId };
const codes = { order: `WO-FLOW-${stamp}` };
async function test(name, run) { try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); } catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); } }
async function find(object, where = {}) { const q = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' }); const r = await api.request(`/data/${object}?${q}`); assert.equal(r.status, 200, `${object}: ${JSON.stringify(r.value)}`); return (r.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value)); }
async function read(object, id) { const r = await api.request(`/data/${object}/${id}`); assert.equal(r.status, 200, `${object}/${id}: ${JSON.stringify(r.value)}`); return r.value.record; }
async function create(object, data) { const r = await api.request(`/data/${object}`, 'POST', data); assert.equal(r.status, 201, `${object}: ${JSON.stringify(r.value)}`); return r.value.id || r.value.record?.id || r.value.data?.id || r.value.result?.id; }
async function invoke(object, action, id, params = {}) { const r = await api.request(`/actions/${object}/${action}/${id}`, 'POST', { params }); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.value)}`); return r.value?.result ?? r.value?.data?.result ?? r.value?.data ?? r.value; }
async function ensureCustomer() { const existing = await find('forge_customer', { name: '苏州澄岳自动化装备有限公司' }); if (existing.length) return existing[0].id; const cats = await find('forge_customer_category', { code: 'CUST-CAT-PROJECT' }); const categoryId = cats[0]?.id || await create('forge_customer_category', { name: '项目客户', code: `CUST-CAT-SVC-${stamp}`, status: 'active' }); return create('forge_customer', { name: '苏州澄岳自动化装备有限公司', customer_type: 'company', category_id: categoryId, responsible_id: api.userId }); }
async function ensureContact(customerId) { const existing = await find('forge_contact', { customer_id: customerId }); if (existing.length) return existing[0].id; return create('forge_contact', { name: '周启明', customer_id: customerId, phone: '13800002609', position: '项目经理', is_primary: true, responsible_id: api.userId }); }
async function salesOrderId(customerId) { const existing = await find('forge_sales_order', { code: 'SO-CONVERT-20260909-001' }); if (existing.length) return existing[0].id; const any = await find('forge_sales_order', {}); if (any.length) return any[0].id; return null; }

await test('service order can be created from current sales material', async () => {
  ids.customer = await ensureCustomer();
  ids.contact = await ensureContact(ids.customer);
  ids.salesOrder = await salesOrderId(ids.customer);
  ids.order = await create('forge_service_order', {
    name: '800型柔性线控制柜现场调试支持', code: codes.order, customer_id: ids.customer, contact_id: ids.contact, contact_phone: '13800002609', sales_order_id: ids.salesOrder,
    service_address: '苏州澄岳自动化装备有限公司现场', service_object: '800型柔性线控制柜', service_type: '现场调试支持', service_mode: 'onsite', urgency: 'medium',
    warranty_starts_on: '2026-09-10', warranty_ends_on: '2027-09-10', warranty_status: '在保', responsibility_type: '供应商责任', quotation_handling: '按服务结果报价',
    fault_symptom: 'PLC 通讯参数复核', impact_scope: '单工位调试支持', expected_visit_on: '2026-09-15', status: 'pending_acceptance', responsible_id: api.userId, submitted_at: new Date().toISOString(), next_step: '受理', remarks: '800型柔性线控制柜交付后例行调试支持。',
  });
  const row = await read('forge_service_order', ids.order);
  assert.equal(row.status, 'pending_acceptance');
});

await test('service order advances through acceptance, dispatch, receive and completion', async () => {
  await invoke('forge_service_order', 'service_order_accept', ids.order);
  await invoke('forge_service_order', 'service_order_dispatch', ids.order, { engineer_name: '售后工程师-苏州现场支持', scheduled_at: '2026-09-15', dispatch_note: '派给苏州现场支持工程师处理' });
  await invoke('forge_service_order', 'service_order_engineer_accept', ids.order);
  await assert.rejects(
    () => invoke('forge_service_order', 'service_order_complete', ids.order, { service_result: 'PLC 通讯参数复核完成，现场联调通过。' }),
    /请至少填写一条处理记录/
  );
  await assert.rejects(
    () => invoke('forge_service_order', 'service_order_complete', ids.order, { service_hours: 1.5, treatment_record: '已完成PLC通讯参数复核、I/O点检与现场联调。', onsite_evidence_count: 0, service_result: 'PLC 通讯参数复核完成，现场联调通过。' }),
    /请至少记录一张现场处理图片/
  );
  await invoke('forge_service_order', 'service_order_complete', ids.order, { service_hours: 1.5, treatment_record: '已完成PLC通讯参数复核、I/O点检与现场联调。', onsite_evidence_count: 1, service_result: 'PLC 通讯参数复核完成，现场联调通过。' });
  const row = await read('forge_service_order', ids.order);
  assert.equal(row.status, 'completed');
  assert.equal(row.engineer_name, '售后工程师-苏州现场支持');
  assert.equal(row.service_result, 'PLC 通讯参数复核完成，现场联调通过。');
  assert.equal(row.treatment_record, '已完成PLC通讯参数复核、I/O点检与现场联调。');
  assert.equal(row.onsite_evidence_count, 1);
  assert.equal(row.service_hours, 1.5);
  assert.ok(row.completed_at);
});

await test('completed service order can create a quotation for customer confirmation', async () => {
  const q = await invoke('forge_service_order', 'service_order_create_quotation', ids.order, { total_amount: 6800, valid_until: '2026-09-30' });
  ids.quotation = q.id;
  let quote = await read('forge_service_quotation', ids.quotation);
  assert.equal(quote.status, 'draft');
  assert.equal(quote.total_amount, 6800);
  await invoke('forge_service_quotation', 'service_quotation_confirm', ids.quotation);
  quote = await read('forge_service_quotation', ids.quotation);
  assert.equal(quote.status, 'confirmed');
});

await test('completed service order creates settlement from finished work order and receivable', async () => {
  const direct = await invoke('forge_service_order', 'service_order_create_settlement', ids.order, { total_amount: 6800 });
  ids.settlement = direct.id;
  let settlement = await read('forge_service_settlement', ids.settlement);
  assert.equal(settlement.status, 'draft');
  assert.equal(settlement.total_amount, 6800);
  assert.equal(settlement.service_order_id, ids.order);
  assert.equal(settlement.quotation_id, null);
  await invoke('forge_service_settlement', 'service_settlement_confirm', ids.settlement);
  settlement = await read('forge_service_settlement', ids.settlement);
  assert.equal(settlement.status, 'confirmed');
  await invoke('forge_service_settlement', 'service_settlement_create_receivable', ids.settlement, { due_on: '2026-10-15' });
  settlement = await read('forge_service_settlement', ids.settlement);
  assert.equal(settlement.status, 'receivable_created');
  assert.match(settlement.receivable_code, /^AR-SVC-/);
  const receivables = await find('forge_accounts_receivable', { service_settlement_id: ids.settlement });
  assert.equal(receivables.length, 1);
  assert.equal(receivables[0].source_type, 'service_settlement');
  assert.equal(receivables[0].original_amount, 6800);
  assert.equal(receivables[0].outstanding_amount, 6800);
  ids.receivable = receivables[0].id;
});

await test('completed service order creates active warranty card once', async () => {
  const w = await invoke('forge_service_order', 'service_order_create_warranty', ids.order);
  const order = await read('forge_service_order', ids.order);
  assert.match(order.warranty_code, /^WC-/);
  const cards = await find('forge_warranty_card', { service_order_id: ids.order });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].status, 'active');
  assert.equal(cards[0].customer_id, ids.customer);
  ids.warranty = cards[0].id;
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = { recordedAt: new Date().toISOString(), kind: 'forge-sales-service-followup-flow', endpoint, codes, ids, cases, passed: cases.every(x => x.status === 'passed'), risemapObserved: { pages: ['/after-sales/orders', '/after-sales/quotations', '/after-sales/settlements', '/after-sales/warranty'], observedOrder: 'WO-2026-0001 服务中', blockers: ['提交服务结果前必须至少填写一条处理记录', '处理记录必须至少上传一张现场处理图片'], emptyFollowups: '服务报价单当前暂无符合条件报价单，服务结算单入口为从完工工单新建且当前暂无符合条件结算单，质保管理显示概览指标和空表。' }, forgeDecision: 'Forge 服务完工补入处理记录和现场图片数量阻断；完工后支持报价，也支持按 RISEMAP 结算页入口从完工工单直接生成服务结算。等待 RISEMAP 上传现场图片后继续同材料终态复核。' };
await writeFile('.objectstack/acceptance/sales-service-followup-flow-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
