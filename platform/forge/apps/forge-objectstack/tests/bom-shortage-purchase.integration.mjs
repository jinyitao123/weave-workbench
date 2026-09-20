import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const shortage = JSON.parse(await readFile('.objectstack/acceptance/bom-shortage-report.json', 'utf8'));
assert.equal(shortage.passed, true, 'BOM shortage acceptance must pass first');
const endpoint = process.env.FORGE_URL || 'http://localhost:4351';
const database = process.env.FORGE_DB || '.objectstack/otc-bom-purchase-final-v4.sqlite';
const api = await connect(endpoint);
const cases = [];
const ids = { analysis: shortage.ids.zeroStockAnalysis, bom: shortage.ids.bom, operator: api.userId };

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '100' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`);
  return response.value.records.filter(record => Object.entries(where).every(([key, value]) => record[key] === value));
}
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}: ${JSON.stringify(response.value)}`);
  return response.value.record;
}
const invoke = (object, action, id, params = {}, authenticated = true) =>
  api.request(`/actions/${object}/${action}/${id}`, 'POST', { params }, authenticated);
const resultOf = response => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
const createParams = supplierId => ({
  code: 'PO-FORGE-20260910-001', supplier_id: supplierId, expected_arrival_on: '2026-09-22',
  payment_term: '到货验收合格后30天付款', payment_method: 'bank_transfer',
  remarks: 'OEM-RM-20260909-A BOM缺料采购验收',
});

const suppliers = await find('forge_supplier');
const supplier = suppliers.find(item => item.name === '南京锐联电气技术有限公司') || suppliers[0];
assert.ok(supplier, 'supplier fixture is required');
ids.supplier = supplier.id;

await test('rejects anonymous purchase creation', async () => {
  assert.equal((await invoke('forge_bom_shortage_analysis', 'bom_shortage_create_purchase_order', ids.analysis, createParams(ids.supplier), false)).status, 401);
});

await test('blocks a BOM shortage purchase until the supplier is approved', async () => {
  assert.notEqual((await read('forge_supplier', ids.supplier)).approval_status, 'approved');
  const response = await invoke('forge_bom_shortage_analysis', 'bom_shortage_create_purchase_order', ids.analysis, createParams(ids.supplier));
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /供应商必须启用且已审批/);
});

await test('submits and approves the RISEMAP supplier with an audit trail', async () => {
  const submit = await invoke('forge_supplier', 'supplier_submit_approval', ids.supplier);
  assert.equal(submit.status, 200, JSON.stringify(submit.value));
  const approve = await invoke('forge_supplier', 'supplier_review', ids.supplier, {
    decision: 'approve', comment: '汇川OTC采购验收，资质信息已核对',
  });
  assert.equal(approve.status, 200, JSON.stringify(approve.value));
  const saved = await read('forge_supplier', ids.supplier);
  assert.deepEqual({ status: saved.approval_status, note: saved.approval_note, by: saved.approved_by },
    { status: 'approved', note: '汇川OTC采购验收，资质信息已核对', by: api.userId });
  const logs = await find('forge_supplier_approval_log', { supplier_id: ids.supplier });
  assert.deepEqual(logs.map(item => item.action).sort(), ['approved', 'submitted']);
});

await test('creates one pending-review order from all four shortage lines', async () => {
  const response = await invoke('forge_bom_shortage_analysis', 'bom_shortage_create_purchase_order', ids.analysis, createParams(ids.supplier));
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const result = resultOf(response); ids.order = result.id;
  assert.ok(ids.order, 'purchase order id');
  const order = await read('forge_purchase_order', ids.order);
  assert.deepEqual({ source: order.source_type, analysis: order.shortage_analysis_id, bom: order.bom_id, supplier: order.supplier_id,
    status: order.status, orderOn: order.order_on, lines: order.line_count, quantity: order.total_quantity, amount: order.total_amount, warehouse: order.warehouse_id },
  { source: 'bom_shortage', analysis: ids.analysis, bom: ids.bom, supplier: ids.supplier,
    status: 'pending_approval', orderOn: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10), lines: 4, quantity: 5, amount: 16320, warehouse: null });
  assert.equal(order.submitted_by, api.userId);
  const lines = await find('forge_purchase_order_line', { order_id: ids.order });
  assert.equal(lines.length, 4);
  assert.deepEqual(Object.fromEntries(lines.map(line => [line.item_code, line.quantity])), {
    'RM-PLC-1215C': 1, 'RM-HMI-700': 1, 'RM-PSU-24V10A': 2, 'RM-CAB-800': 1,
  });
  assert.deepEqual(Object.fromEntries(lines.map(line => [line.item_code, line.taxed_unit_price])), {
    'RM-PLC-1215C': 6800.001, 'RM-HMI-700': 3200.0018, 'RM-PSU-24V10A': 859.9978, 'RM-CAB-800': 4600.004,
  });
  assert.deepEqual(Object.fromEntries(lines.map(line => [line.item_code, line.untaxed_unit_price])), {
    'RM-PLC-1215C': 6017.7, 'RM-HMI-700': 2831.86, 'RM-PSU-24V10A': 761.06, 'RM-CAB-800': 4070.8,
  });
  assert.ok(lines.every(line => line.source_bom_id === ids.bom && line.source_analysis_line_id));
  ids.orderLines = lines.map(line => line.id);
  const logs = await find('forge_purchase_order_approval_log', { order_id: ids.order });
  assert.equal(logs.length, 1); assert.equal(logs[0].action, 'submitted');
});

await test('prevents another active order for the same shortage snapshot', async () => {
  const response = await invoke('forge_bom_shortage_analysis', 'bom_shortage_create_purchase_order', ids.analysis,
    { ...createParams(ids.supplier), code: 'PO-FORGE-20260910-DUP' });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /已生成有效采购订单/);
  assert.equal((await find('forge_purchase_order', { shortage_analysis_id: ids.analysis })).length, 1);
});

await test('requires an approval comment', async () => {
  const response = await invoke('forge_purchase_order', 'purchase_order_approve', ids.order, { approval_note: '' });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /approval_note|审批意见/);
});

await test('approves the order and creates one order-level arrival notice with four lines', async () => {
  const response = await invoke('forge_purchase_order', 'purchase_order_approve', ids.order, {
    approval_note: '汇川OTC缺料采购，数量金额与BOM核对无误',
  });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const action = resultOf(response); ids.arrivalNotice = action.arrival_notice_id;
  const order = await read('forge_purchase_order', ids.order);
  assert.deepEqual({ status: order.status, approvedBy: order.approved_by }, { status: 'approved', approvedBy: api.userId });
  const notices = await find('forge_purchase_arrival_notice', { order_id: ids.order });
  assert.equal(notices.length, 1); assert.equal(notices[0].id, ids.arrivalNotice);
  assert.deepEqual({ lines: notices[0].line_count, planned: notices[0].planned_quantity, arrived: notices[0].arrived_quantity,
    status: notices[0].status, expected: notices[0].expected_arrival_on, warehouse: notices[0].warehouse_id },
  { lines: 4, planned: 5, arrived: 0, status: 'pending_arrival', expected: '2026-09-22', warehouse: null });
  const noticeLines = await find('forge_purchase_arrival_notice_line', { notice_id: ids.arrivalNotice });
  assert.equal(noticeLines.length, 4); ids.arrivalNoticeLines = noticeLines.map(line => line.id);
  assert.deepEqual(Object.fromEntries(noticeLines.map(line => [line.item_code, line.planned_quantity])), {
    'RM-PLC-1215C': 1, 'RM-HMI-700': 1, 'RM-PSU-24V10A': 2, 'RM-CAB-800': 1,
  });
  const logs = await find('forge_purchase_order_approval_log', { order_id: ids.order });
  assert.deepEqual(logs.map(item => item.action).sort(), ['approved', 'submitted']);
  assert.equal(logs.find(item => item.action === 'approved').comment, '汇川OTC缺料采购，数量金额与BOM核对无误');
});

await test('rejects repeated approval without duplicating notice records', async () => {
  const response = await invoke('forge_purchase_order', 'purchase_order_approve', ids.order, { approval_note: '重复审批' });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /状态已变化/);
  assert.equal((await find('forge_purchase_arrival_notice', { order_id: ids.order })).length, 1);
  assert.equal((await find('forge_purchase_arrival_notice_line', { notice_id: ids.arrivalNotice })).length, 4);
});

await test('rejects anonymous order reads and approval', async () => {
  assert.equal((await api.request(`/data/forge_purchase_order/${ids.order}`, 'GET', undefined, false)).status, 401);
  assert.equal((await invoke('forge_purchase_order', 'purchase_order_approve', ids.order, { approval_note: 'anonymous' }, false)).status, 401);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'risemap-aligned-bom-shortage-purchase-acceptance',
  fixture: 'OEM-RM-20260909-A-bom-shortage-purchase-v0.1', endpoint, database, ids, cases,
  passed: cases.every(item => item.status === 'passed'),
  risemapObserved: { purchaseSource: 'BOM缺料采购', orderCode: 'PO-2026-0001', approvalStatus: '已审核',
    lineCount: 4, totalQuantity: 5, taxedTotal: 16320, expectedArrivalOn: '2026-09-22',
    arrivalNoticeCount: 1, arrivalNoticeLineCount: 4, arrivalStatus: '待到货' },
  boundary: 'This slice creates and approves one BOM-shortage purchase order and one order-level pending-arrival notice. Physical arrival, inspection, inbound, stock movement and payable recognition are not executed here.',
};
await writeFile('.objectstack/acceptance/bom-shortage-purchase-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
