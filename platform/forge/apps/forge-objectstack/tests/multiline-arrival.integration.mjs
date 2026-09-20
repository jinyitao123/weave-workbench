import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const purchase = JSON.parse(await readFile('.objectstack/acceptance/bom-shortage-purchase-report.json', 'utf8'));
assert.equal(purchase.passed, true, 'BOM shortage purchase acceptance must pass first');
const endpoint = process.env.FORGE_URL || 'http://localhost:4353';
const database = process.env.FORGE_DB || '.objectstack/otc-multiline-arrival-final.sqlite';
const api = await connect(endpoint);
const cases = [];
const ids = { order: purchase.ids.order, notice: purchase.ids.arrivalNotice, warehouse: purchase.ids.warehouse };

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
const invoke = (object, action, id, params = {}, authenticated = true) => api.request(`/actions/${object}/${action}/${id}`, 'POST', { params }, authenticated);
const resultOf = response => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;

const noticeLines = await find('forge_purchase_arrival_notice_line', { notice_id: ids.notice });
assert.equal(noticeLines.length, 4);
const warehouse = (await find('forge_warehouse'))[0];
assert.ok(warehouse); ids.warehouse = warehouse.id;
const fullLines = noticeLines.map(line => ({ notice_line_id: line.id, quantity: line.planned_quantity, warehouse_id: ids.warehouse,
  warehouse_location: '', batch_number: line.item_code === 'RM-PSU-24V10A' ? 'BATCH-PSU-20260910-001' : '', remarks: '' }));
const params = (mode, lines = fullLines) => ({ mode, arrived_on: '2026-09-10', contact_name: '沈妍', contact_phone: '13900002609',
  carrier: '顺达物流', logistics_number: 'SD20260910001', remarks: 'OEM-RM-20260909-A 到货登记验收', lines_json: JSON.stringify(lines) });

await test('rejects anonymous arrival registration', async () => {
  assert.equal((await invoke('forge_purchase_arrival_notice', 'purchase_arrival_register', ids.notice, params('draft'), false)).status, 401);
});

await test('rejects malformed material lines and missing warehouse', async () => {
  const malformed = await invoke('forge_purchase_arrival_notice', 'purchase_arrival_register', ids.notice, { ...params('draft'), lines_json: '{bad' });
  assert.equal(malformed.status, 400, JSON.stringify(malformed.value)); assert.match(malformed.value.error.message, /格式错误/);
  const noWarehouse = await invoke('forge_purchase_arrival_notice', 'purchase_arrival_register', ids.notice,
    params('draft', [{ ...fullLines[0], warehouse_id: null }]));
  assert.equal(noWarehouse.status, 400, JSON.stringify(noWarehouse.value)); assert.match(noWarehouse.value.error.message, /必须选择到货仓库/);
});

await test('rejects quantity above the notice-line remainder', async () => {
  const response = await invoke('forge_purchase_arrival_notice', 'purchase_arrival_register', ids.notice,
    params('draft', [{ ...fullLines[0], quantity: Number(fullLines[0].quantity) + 1 }]));
  assert.equal(response.status, 400, JSON.stringify(response.value)); assert.match(response.value.error.message, /超过剩余可到数量/);
});

await test('saves one four-line draft without consuming arrival quantity', async () => {
  const response = await invoke('forge_purchase_arrival_notice', 'purchase_arrival_register', ids.notice, params('draft'));
  assert.equal(response.status, 200, JSON.stringify(response.value)); const result = resultOf(response); ids.receipt = result.id;
  assert.deepEqual({ status: result.status, lines: result.line_count, quantity: result.total_quantity, untaxed: result.untaxed_amount, taxed: result.taxed_amount },
    { status: 'draft', lines: 4, quantity: 5, untaxed: 14442.48, taxed: 16320 });
  const receipt = await read('forge_purchase_receipt', ids.receipt);
  assert.deepEqual({ code: receipt.code, type: receipt.arrival_type, status: receipt.status, lines: receipt.line_count, quantity: receipt.total_quantity,
    untaxed: receipt.untaxed_amount, taxed: receipt.taxed_amount, carrier: receipt.carrier, logistics: receipt.logistics_number },
  { code: 'ARR-2026-0001', type: 'purchase', status: 'draft', lines: 4, quantity: 5,
    untaxed: 14442.48, taxed: 16320, carrier: '顺达物流', logistics: 'SD20260910001' });
  const lines = await find('forge_purchase_receipt_line', { receipt_id: ids.receipt }); ids.receiptLines = lines.map(line => line.id);
  assert.equal(lines.length, 4); assert.ok(lines.every(line => line.status === 'draft' && line.warehouse_id === ids.warehouse));
  assert.equal((await find('forge_pending_inspection', { receipt_id: ids.receipt })).length, 0, 'draft must not create pending-inspection inventory');
  assert.equal(lines.find(line => line.item_code === 'RM-PSU-24V10A').batch_number, 'BATCH-PSU-20260910-001');
  assert.deepEqual({ notice: (await read('forge_purchase_arrival_notice', ids.notice)).arrived_quantity, order: (await read('forge_purchase_order', ids.order)).arrived_quantity }, { notice: 0, order: 0 });
});

await test('submits the draft to pending inspection and rolls up every line exactly once', async () => {
  const response = await invoke('forge_purchase_receipt', 'purchase_receipt_submit', ids.receipt);
  assert.equal(response.status, 200, JSON.stringify(response.value)); assert.equal(resultOf(response).status, 'pending_inspection');
  const receipt = await read('forge_purchase_receipt', ids.receipt); assert.equal(receipt.status, 'pending_inspection'); assert.equal(receipt.submitted_by, api.userId);
  const savedLines = await find('forge_purchase_receipt_line', { receipt_id: ids.receipt }); assert.ok(savedLines.every(line => line.status === 'pending_inspection'));
  const pending = await find('forge_pending_inspection', { receipt_id: ids.receipt }); ids.pendingInspections = pending.map(item => item.id);
  assert.equal(pending.length, 4); assert.ok(pending.every(item => item.status === 'inspection_created' && item.inspection_id && item.warehouse_id === ids.warehouse));
  assert.deepEqual(new Set(pending.map(item => item.receipt_line_id)), new Set(ids.receiptLines));
  const savedNotice = await read('forge_purchase_arrival_notice', ids.notice), savedOrder = await read('forge_purchase_order', ids.order);
  assert.deepEqual({ noticeStatus: savedNotice.status, noticeArrived: savedNotice.arrived_quantity, orderStatus: savedOrder.status, orderArrived: savedOrder.arrived_quantity },
    { noticeStatus: 'arrived', noticeArrived: 5, orderStatus: 'arrived', orderArrived: 5 });
  const byCode = Object.fromEntries((await find('forge_purchase_arrival_notice_line', { notice_id: ids.notice })).map(line => [line.item_code, line]));
  assert.deepEqual(Object.fromEntries(Object.entries(byCode).map(([code, line]) => [code, line.arrived_quantity])),
    { 'RM-PLC-1215C': 1, 'RM-HMI-700': 1, 'RM-PSU-24V10A': 2, 'RM-CAB-800': 1 });
  assert.equal((await find('forge_purchase_inspection', { receipt_id: ids.receipt })).length, pending.length, '提交待检后应自动为每条到货物料生成检验单');
});

await test('rejects resubmission and further arrival after full receipt', async () => {
  const repeat = await invoke('forge_purchase_receipt', 'purchase_receipt_submit', ids.receipt);
  assert.equal(repeat.status, 400, JSON.stringify(repeat.value)); assert.match(repeat.value.error.message, /状态已变化/);
  const extra = await invoke('forge_purchase_arrival_notice', 'purchase_arrival_register', ids.notice, params('submit', [fullLines[0]]));
  assert.equal(extra.status, 400, JSON.stringify(extra.value)); assert.match(extra.value.error.message, /状态已变化/);
  assert.equal((await find('forge_purchase_receipt', { notice_id: ids.notice })).length, 1);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = { recordedAt: new Date().toISOString(), kind: 'risemap-aligned-multiline-arrival-acceptance',
  fixture: 'OEM-RM-20260909-A-multiline-arrival-v0.1', endpoint, database, ids, cases, passed: cases.every(item => item.status === 'passed'),
  risemapObserved: { arrivalType: '采购到货', arrivedOn: '2026-09-10', supplier: '南京锐联电气技术有限公司', order: 'PO-2026-0001',
    lineCount: 4, quantities: [1, 1, 2, 1], totalQuantity: 5, untaxedAmount: 14442.48, taxedAmount: 16320,
    required: ['到货日期', '供应商', '采购订单', '到货数量', '仓库'], actions: ['保存草稿', '提交待检'], nextState: '待检库存' },
  boundary: 'This slice saves and submits one order-level four-line arrival registration into pending-inspection inventory. It does not create an inspection order, decide quality, receive stock, or recognize payable.',
};
await writeFile('.objectstack/acceptance/multiline-arrival-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
