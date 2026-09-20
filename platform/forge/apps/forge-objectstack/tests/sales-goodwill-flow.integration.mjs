import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const code = `GW-FLOW-${stamp}`;
const cases = [];
const ids = { operator: api.userId };

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`);
  return (response.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
}
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}: ${JSON.stringify(response.value)}`);
  return response.value.record;
}
async function create(object, data) {
  const response = await api.request(`/data/${object}`, 'POST', data);
  assert.equal(response.status, 201, `${object} create: ${JSON.stringify(response.value)}`);
  return response.value.id || response.value.record?.id || response.value.data?.id || response.value.result?.id;
}
async function invoke(action, id, params = {}) {
  return api.request(`/actions/forge_goodwill_order/${action}/${id}`, 'POST', { params });
}
async function invokeOk(action, id, params = {}) {
  const response = await invoke(action, id, params);
  assert.equal(response.status, 200, `${action}: ${JSON.stringify(response.value)}`);
  return response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
}
async function ensureCustomer() {
  const existing = await find('forge_customer', { name: '苏州澄岳自动化装备有限公司' });
  if (existing.length) return existing[0].id;
  let categories = await find('forge_customer_category', { code: 'CUST-CAT-PROJECT' });
  let categoryId = categories[0]?.id;
  if (!categoryId) categoryId = await create('forge_customer_category', { name: '项目客户', code: 'CUST-CAT-PROJECT', status: 'active', remarks: 'Goodwill 验收客户分类' });
  return create('forge_customer', { name: '苏州澄岳自动化装备有限公司', customer_type: 'company', category_id: categoryId, responsible_id: api.userId, remarks: 'Goodwill 审批发货验收客户' });
}

await test('Goodwill order can be created with RISEMAP observed customer, contact and item fields', async () => {
  ids.customer = await ensureCustomer();
  ids.goodwill = await create('forge_goodwill_order', {
    name: '苏州澄岳自动化装备有限公司 - Goodwill 订单', code, customer_id: ids.customer,
    contact_name: '周启明', contact_phone: '13800002609', gift_type: 'onsite_support',
    reason: '项目交付后现场调试支持所需控制柜样件赠送。', item_summary: '800型柔性线控制柜 / 2 台',
    item_name: '800型柔性线控制柜', quantity: 2, unit_name: '台', total_amount: 0,
    status: 'draft', shipment_count: 0, shipped_quantity: 0, responsible_id: api.userId,
    remarks: '用于客户现场支持物料发放',
  });
  const row = await read('forge_goodwill_order', ids.goodwill);
  assert.equal(row.status, 'draft');
  assert.equal(row.contact_name, '周启明');
  assert.equal(row.item_name, '800型柔性线控制柜');
  assert.equal(row.quantity, 2);
});

await test('shipment is blocked before approval', async () => {
  const response = await invoke('goodwill_order_create_shipment', ids.goodwill, { delivery_address: '苏州市工业园区澄岳路9号', recipient: '周启明', recipient_phone: '13800002609' });
  assert.notEqual(response.status, 200, 'shipment before approval must fail');
});

await test('draft can submit and pending approval can approve', async () => {
  await invokeOk('goodwill_order_submit', ids.goodwill);
  let row = await read('forge_goodwill_order', ids.goodwill);
  assert.equal(row.status, 'pending_approval');
  await invokeOk('goodwill_order_approve', ids.goodwill);
  row = await read('forge_goodwill_order', ids.goodwill);
  assert.equal(row.status, 'approved');
  assert.equal(row.approved_by, 'Dev Admin');
  assert.ok(row.approved_at);
});

await test('shipment form requires recipient information after approval', async () => {
  const response = await invoke('goodwill_order_create_shipment', ids.goodwill, { delivery_address: '', recipient: '', recipient_phone: '' });
  assert.notEqual(response.status, 200, 'missing recipient shipment must fail');
});

await test('approved order records shipment and enters shipping status', async () => {
  await invokeOk('goodwill_order_create_shipment', ids.goodwill, {
    delivery_address: '苏州市工业园区澄岳路9号', recipient: '周启明', recipient_phone: '13800002609', logistics_company: '', tracking_no: '',
  });
  const row = await read('forge_goodwill_order', ids.goodwill);
  assert.equal(row.status, 'shipping');
  assert.match(row.shipment_code, /^DN-GW-/);
  assert.equal(row.shipment_status, '待发货');
  assert.equal(row.shipment_count, 1);
  assert.equal(row.shipped_quantity, 2);
  assert.equal(row.delivery_address, '苏州市工业园区澄岳路9号');
  assert.equal(row.recipient, '周启明');
  assert.equal(row.recipient_phone, '13800002609');
});

await test('shipping order can be completed as Forge follow-up state', async () => {
  await invokeOk('goodwill_order_complete', ids.goodwill);
  const row = await read('forge_goodwill_order', ids.goodwill);
  assert.equal(row.status, 'completed');
  assert.equal(row.shipment_status, '已完成');
  assert.ok(row.completed_at);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(),
  kind: 'forge-sales-goodwill-approval-shipment',
  endpoint,
  code,
  ids,
  cases,
  passed: cases.every(item => item.status === 'passed'),
  risemapObserved: {
    order: 'GW-2026-0001',
    customer: '苏州澄岳自动化装备有限公司',
    owner: '金一涛',
    item: '800型柔性线控制柜 x2',
    observedPath: '草稿 -> 待审批 -> 已审批 -> 创建发货 -> 发货中',
    limitation: 'RISEMAP 确认完成前登录态失效，Forge 完成态作为可写执行扩展保留，需后续同材料复核。',
  },
  forgeDecision: '金一涛 与 Dev Admin 按同一业务用户对照；Goodwill 发货记录先落在订单对象中承载。',
};
await writeFile('.objectstack/acceptance/sales-goodwill-flow-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
