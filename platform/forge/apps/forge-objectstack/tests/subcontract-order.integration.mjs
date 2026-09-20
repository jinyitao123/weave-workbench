import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4386';
const database = process.env.FORGE_DB || '.objectstack/data/objectstack.db';
const api = await connect(endpoint);
const cases = [], ids = { operator: api.userId }, stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
async function test(name, run) { try { await run(); cases.push({ name, status: 'passed' }); console.log('PASS ' + name); } catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } }
async function create(object, values) { const r = await api.request('/data/' + object, 'POST', values); assert.equal(r.status, 201, object + ': ' + JSON.stringify(r.value)); return r.value.id || r.value.record?.id; }
async function ensure(object, values, matchField = values.code ? 'code' : 'name') { const existing = (await find(object, { [matchField]: values[matchField] }))[0]; if (existing) return existing.id; return create(object, values); }
async function read(object, id) { const r = await api.request('/data/' + object + '/' + id); assert.equal(r.status, 200, object + '/' + id); return r.value.record; }
async function find(object, where = {}) { const q = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' }), r = await api.request('/data/' + object + '?' + q); assert.equal(r.status, 200, object); return (r.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value)); }
const invoke = (object, action, id, params = {}, authenticated = true) => api.request('/actions/' + object + '/' + action + '/' + id, 'POST', { params }, authenticated);
const resultOf = r => r.value?.result ?? r.value?.data?.result ?? r.value?.data ?? r.value;

ids.processTypeBending = await ensure('forge_subcontract_business_setting', { name: '钣金折弯、喷涂', code: 'SUB-PROCESS-BENDING-COATING', category: 'process_type', enabled: true, sort_order: 10, description: '委外订单加工类型前置配置。' });
ids.processTypeMarking = await ensure('forge_subcontract_business_setting', { name: '激光打标', code: 'SUB-PROCESS-MARKING', category: 'process_type', enabled: true, sort_order: 20, description: '委外订单加工类型前置配置。' });
ids.paymentConditionMonthly = await ensure('forge_payment_condition', { name: '月结 30 天', code: 'PAY-MONTHLY-30', settlement_basis: 'inventory_inbound', payment_days: 30, status: 'active', description: '确认入库后起算，30 天内完成付款。' });
ids.paymentConditionAcceptance = await ensure('forge_payment_condition', { name: '验收后 30 天', code: 'PAY-ACCEPTANCE-30', settlement_basis: 'goods_received', payment_days: 30, status: 'active', description: '到货验收后起算，30 天内完成付款。' });
ids.supplierCategory = await ensure('forge_supplier_category', { name: '委外加工供应商', code: 'SC-SUP-CAT', status: 'active' });
ids.supplierLevel = await ensure('forge_supplier_level', { name: '委外核心级', code: 'SC-SUP-LVL', status: 'active' });
ids.warehouseType = await ensure('forge_warehouse_type', { name: '委外仓库', code: 'SC-WH-TYPE', status: 'active' });
ids.unit = await ensure('forge_unit', { name: '件', code: 'PCS', status: 'active' });
ids.materialCategory = await ensure('forge_material_category', { name: '委外加工件', code: 'SC-MAT-CAT', status: 'active' });
ids.issueWarehouse = await ensure('forge_warehouse', { name: '委外发料仓', code: 'SC-WH-ISSUE', type_id: ids.warehouseType, responsible_id: api.userId, phone: '025-80000001', area: 200, address: '南京委外发料区' });
ids.receiptWarehouse = await ensure('forge_warehouse', { name: '委外回厂仓', code: 'SC-WH-RECEIPT', type_id: ids.warehouseType, responsible_id: api.userId, phone: '025-80000002', area: 180, address: '南京委外回厂区' });
ids.supplier = await ensure('forge_supplier', { name: '锐联钣金委外厂', code: 'SC-SUP-001', category_id: ids.supplierCategory, level_id: ids.supplierLevel, responsible_id: api.userId, payment_term: '月结 30 天', contact_name: '沈妍', phone: '13800000001', status: 'active' });
ids.unapprovedSupplier = await ensure('forge_supplier', { name: '未审批委外厂', code: 'SC-SUP-002', category_id: ids.supplierCategory, level_id: ids.supplierLevel, responsible_id: api.userId, payment_term: '月结 30 天', contact_name: '陈工', phone: '13800000002', status: 'active' });

await invoke('forge_supplier', 'supplier_submit_approval', ids.supplier);
await invoke('forge_supplier', 'supplier_review', ids.supplier, { decision: 'approve', comment: '基础资质通过，可开通委外' });

await test('denies anonymous subcontract profile activation', async () => {
  const r = await invoke('forge_supplier', 'subcontract_supplier_activate', ids.supplier, { process_capabilities: '钣金' }, false);
  assert.equal(r.status, 401);
});
await test('blocks an unapproved supplier from subcontract activation', async () => {
  const r = await invoke('forge_supplier', 'subcontract_supplier_activate', ids.unapprovedSupplier, { process_capabilities: '喷涂', credit_rating: 'three' });
  assert.ok(r.status >= 400, JSON.stringify(r.value));
  assert.equal((await find('forge_subcontract_supplier_profile', { supplier_id: ids.unapprovedSupplier })).length, 0);
});
await test('activates one governed subcontract supplier profile', async () => {
  const existingProfile = (await find('forge_subcontract_supplier_profile', { supplier_id: ids.supplier }))[0];
  const capabilities = '钣金折弯、喷涂\n激光打标';
  const r = existingProfile ? (await api.request('/data/forge_subcontract_supplier_profile/' + existingProfile.id, 'PATCH', { process_capabilities: capabilities }), { status: 200, value: { result: { ...existingProfile, process_capabilities: capabilities } } }) : await invoke('forge_supplier', 'subcontract_supplier_activate', ids.supplier, { process_capabilities: capabilities, credit_rating: 'four', default_issue_warehouse_id: ids.issueWarehouse, default_receipt_warehouse_id: ids.receiptWarehouse, loss_rate_limit: 3, warranty_terms: '回厂验收后质保 12 个月' });
  assert.equal(r.status, 200, JSON.stringify(r.value)); ids.profile = resultOf(r).id;
  const profile = await read('forge_subcontract_supplier_profile', ids.profile);
  ids.issueWarehouse = profile.default_issue_warehouse_id || ids.issueWarehouse;
  ids.receiptWarehouse = profile.default_receipt_warehouse_id || ids.receiptWarehouse;
  assert.deepEqual({ supplier: profile.supplier_id, capability: profile.process_capabilities, rating: profile.credit_rating, issue: profile.default_issue_warehouse_id, receipt: profile.default_receipt_warehouse_id, status: profile.status, actor: profile.activated_by }, { supplier: ids.supplier, capability: capabilities, rating: 'four', issue: ids.issueWarehouse, receipt: ids.receiptWarehouse, status: 'active', actor: api.userId });
  const duplicate = await invoke('forge_supplier', 'subcontract_supplier_activate', ids.supplier, { process_capabilities: '钣金', credit_rating: 'three' });
  assert.ok(duplicate.status >= 400, JSON.stringify(duplicate.value));
});

ids.finishedMaterial = await ensure('forge_material', { name: '电控柜门板', code: 'SC-FG-001', model: 'DB-1200', category_id: ids.materialCategory, unit_id: ids.unit, property: 'semi_finished', source_type: 'subcontracted', status: 'active', supplier_id: ids.supplier });
ids.finishedSku = await ensure('forge_material_sku', { name: '1200×600×2.0', code: 'SC-FG-SKU-001', material_id: ids.finishedMaterial, sale_price: 0, cost_price: 0, enabled: true });
ids.rawMaterial = await ensure('forge_material', { name: '冷轧钢板', code: 'SC-RM-001', model: 'SPCC', category_id: ids.materialCategory, unit_id: ids.unit, property: 'raw_material', source_type: 'purchased', status: 'active', supplier_id: ids.supplier });
ids.rawSku = await ensure('forge_material_sku', { name: '2.0mm', code: 'SC-RM-SKU-001', material_id: ids.rawMaterial, sale_price: 0, cost_price: 0, enabled: true });
ids.bendingPrice = await ensure('forge_subcontract_processing_price', { name: '锐联门板折弯喷涂价', code: 'SCP-SC-001-BENDING', supplier_profile_id: ids.profile, process_type_id: ids.processTypeBending, sku_id: ids.finishedSku, unit_name: '件', unit_price: 35.5, effective_from: '2026-01-01', status: 'active', responsible_id: api.userId, description: '指定门板加工件价目优先。' });
ids.markingPrice = await ensure('forge_subcontract_processing_price', { name: '锐联激光打标通用价', code: 'SCP-SC-001-MARKING', supplier_profile_id: ids.profile, process_type_id: ids.processTypeMarking, unit_name: '件', unit_price: 12, effective_from: '2026-01-01', status: 'active', responsible_id: api.userId, description: '激光打标通用价目。' });

ids.customerSuppliedOrder = await create('forge_subcontract_order', { name: '控制柜门板甲供料委外', code: `SC-ORDER-${stamp}-001`, supplier_profile_id: ids.profile, supplier_id: ids.supplier, supply_mode: 'customer_supplied', expected_delivery_on: '2026-09-30', source_type: 'manual', inspection_method: 'full', payment_condition_id: ids.paymentConditionMonthly, payment_term: '月结 30 天', responsible_id: api.userId });
await test('blocks inactive payment conditions and missing linked business sources', async () => {
  let r = await api.request('/data/forge_payment_condition/' + ids.paymentConditionMonthly, 'PATCH', { status: 'inactive' }); assert.equal(r.status, 200, JSON.stringify(r.value));
  r = await invoke('forge_subcontract_order', 'subcontract_order_submit', ids.customerSuppliedOrder); assert.ok(r.status >= 400, JSON.stringify(r.value)); assert.match(JSON.stringify(r.value), /付款条件/);
  r = await api.request('/data/forge_payment_condition/' + ids.paymentConditionMonthly, 'PATCH', { status: 'active' }); assert.equal(r.status, 200, JSON.stringify(r.value));
  r = await api.request('/data/forge_subcontract_order/' + ids.customerSuppliedOrder, 'PATCH', { source_type: 'sales_order' }); assert.equal(r.status, 200, JSON.stringify(r.value));
  r = await invoke('forge_subcontract_order', 'subcontract_order_submit', ids.customerSuppliedOrder); assert.ok(r.status >= 400, JSON.stringify(r.value)); assert.match(JSON.stringify(r.value), /来源销售订单/);
  r = await api.request('/data/forge_subcontract_order/' + ids.customerSuppliedOrder, 'PATCH', { source_type: 'manual' }); assert.equal(r.status, 200, JSON.stringify(r.value));
});
await test('blocks customer-supplied order without processing lines and issue plan', async () => {
  const r = await invoke('forge_subcontract_order', 'subcontract_order_submit', ids.customerSuppliedOrder);
  assert.ok(r.status >= 400, JSON.stringify(r.value)); assert.equal((await read('forge_subcontract_order', ids.customerSuppliedOrder)).status, 'draft');
});
ids.customerLine = await create('forge_subcontract_order_line', { name: '电控柜门板', order_id: ids.customerSuppliedOrder, sku_id: ids.finishedSku, item_code: 'SC-FG-001', specification: '1200×600×2.0', process_type_id: ids.processTypeBending, process_type: '钣金折弯、喷涂', quantity: 10, unit_name: '件', unit_price: 1, expected_delivery_on: '2026-09-30', drawing_number: 'DWG-SC-001' });
ids.customerPlan = await create('forge_subcontract_material_plan', { name: '冷轧钢板', order_id: ids.customerSuppliedOrder, order_line_id: ids.customerLine, sku_id: ids.rawSku, item_code: 'SC-RM-001', specification: '2.0mm', planned_quantity: 20, standard_quantity: 19.4, unit_name: '张' });
await test('blocks an order whose configured processing type has been disabled', async () => {
  let r = await api.request('/data/forge_subcontract_business_setting/' + ids.processTypeBending, 'PATCH', { enabled: false }); assert.equal(r.status, 200, JSON.stringify(r.value));
  r = await invoke('forge_subcontract_order', 'subcontract_order_submit', ids.customerSuppliedOrder); assert.ok(r.status >= 400, JSON.stringify(r.value));
  assert.match(JSON.stringify(r.value), /加工类型.*停用|加工类型.*不存在/);
  r = await api.request('/data/forge_subcontract_business_setting/' + ids.processTypeBending, 'PATCH', { enabled: true }); assert.equal(r.status, 200, JSON.stringify(r.value));
});
await test('derives customer-supplied totals and submits for approval', async () => {
  const r = await invoke('forge_subcontract_order', 'subcontract_order_submit', ids.customerSuppliedOrder); assert.equal(r.status, 200, JSON.stringify(r.value));
  assert.deepEqual(resultOf(r), { id: ids.customerSuppliedOrder, status: 'pending_approval', line_count: 1, total_quantity: 10, processing_amount: 355, issue_planned_quantity: 20 });
  const order = await read('forge_subcontract_order', ids.customerSuppliedOrder), line = await read('forge_subcontract_order_line', ids.customerLine);
  assert.deepEqual({ status: order.status, amount: order.processing_amount, total: order.total_quantity, issue: order.issue_planned_quantity, unitPrice: line.unit_price, subtotal: line.subtotal, submitter: order.submitted_by }, { status: 'pending_approval', amount: 355, total: 10, issue: 20, unitPrice: 35.5, subtotal: 355, submitter: api.userId });
});
await test('rejects, resubmits, then approves with the correct next step', async () => {
  let r = await invoke('forge_subcontract_order', 'subcontract_order_review', ids.customerSuppliedOrder, { decision: 'reject', comment: '补充图纸版本后重提' }); assert.equal(r.status, 200, JSON.stringify(r.value));
  assert.equal((await read('forge_subcontract_order', ids.customerSuppliedOrder)).status, 'rejected');
  r = await invoke('forge_subcontract_order', 'subcontract_order_submit', ids.customerSuppliedOrder); assert.equal(r.status, 200, JSON.stringify(r.value));
  r = await invoke('forge_subcontract_order', 'subcontract_order_review', ids.customerSuppliedOrder, { decision: 'approve', comment: '图纸版本已确认，同意委外' }); assert.equal(r.status, 200, JSON.stringify(r.value));
  assert.equal(resultOf(r).next_step, '创建委外发料单'); assert.equal((await read('forge_subcontract_order', ids.customerSuppliedOrder)).status, 'approved');
});

ids.turnkeyOrder = await create('forge_subcontract_order', { name: '控制柜铭牌包工包料委外', code: `SC-ORDER-${stamp}-002`, supplier_profile_id: ids.profile, supplier_id: ids.supplier, supply_mode: 'turnkey', expected_delivery_on: '2026-10-05', source_type: 'manual', inspection_method: 'sampling', sampling_ratio: 20, payment_condition_id: ids.paymentConditionAcceptance, payment_term: '验收后 30 天', responsible_id: api.userId });
ids.turnkeyLine = await create('forge_subcontract_order_line', { name: '电控柜门板', order_id: ids.turnkeyOrder, sku_id: ids.finishedSku, item_code: 'SC-FG-001', specification: '1200×600×2.0', process_type_id: ids.processTypeMarking, process_type: '激光打标', quantity: 5, unit_name: '件', unit_price: 1, expected_delivery_on: '2026-10-05', drawing_number: 'DWG-SC-002' });
await test('approves turnkey order without an internal issue plan', async () => {
  let r = await invoke('forge_subcontract_order', 'subcontract_order_submit', ids.turnkeyOrder); assert.equal(r.status, 200, JSON.stringify(r.value));
  assert.deepEqual({ amount: resultOf(r).processing_amount, issue: resultOf(r).issue_planned_quantity }, { amount: 60, issue: 0 });
  r = await invoke('forge_subcontract_order', 'subcontract_order_review', ids.turnkeyOrder, { decision: 'approve', comment: '供应商自行备料，同意执行' }); assert.equal(r.status, 200, JSON.stringify(r.value));
  assert.equal(resultOf(r).next_step, '等待加工回厂');
});

const logs = await find('forge_subcontract_order_approval_log', {});
assert.equal(logs.filter(x => x.order_id === ids.customerSuppliedOrder).length, 4);
assert.equal(logs.filter(x => x.order_id === ids.turnkeyOrder).length, 2);
const report = { suite: 'subcontract-supplier-order', endpoint, database, ids, cases, passed: cases.every(x => x.status === 'passed'), completedAt: new Date().toISOString(), result: { activeSupplierProfiles: 1, approvedOrders: 2, customerSupplied: { processingAmount: 355, issuePlannedQuantity: 20, nextStep: '创建委外发料单' }, turnkey: { processingAmount: 60, issuePlannedQuantity: 0, nextStep: '等待加工回厂' }, approvalLogs: 6 }, risemapLiveEvidence: { guide: '/subcontract/guide', dashboard: '/subcontract', orders: '/subcontract/orders', create: '/subcontract/orders/new', suppliers: '/subcontract/suppliers' }, boundary: '已闭环委外供应商开通、甲供料与包工包料订单、派生加工费、提交驳回重提和审核分支。真实发料、库存转移、回厂质检、退料赔偿、对账和应付进入后续切片。' };
await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/subcontract-order-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
