import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const procurement = JSON.parse(await readFile('.objectstack/acceptance/procurement-chain-report.json', 'utf8'));
assert.equal(procurement.passed, true, 'procurement order acceptance must pass before receipt verification');
const api = await connect();
const cases = [];
const ids = { ...procurement.ids };
const read = async (object, id) => {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id} read`);
  return response.value.record;
};
const find = async (object, where, top = 50) => {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: String(top) });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object} find`);
  return response.value.records.filter(record => Object.entries(where).every(([field, value]) => record[field] === value));
};
const invoke = (object, action, id, params = {}) => api.request(`/actions/${object}/${action}/${id}`, 'POST', { params });
const resultOf = response => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
const round4 = value => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

await test('registers the approved notice as a physical receipt and creates pending inspection material', async () => {
  const lines = await find('forge_purchase_arrival_notice_line', { notice_id: ids.arrivalNotice });
  assert.equal(lines.length, 1);
  ids.arrivalNoticeLine = lines[0].id;
  const response = await invoke('forge_purchase_arrival_notice', 'purchase_arrival_register', ids.arrivalNotice, {
    arrived_on: '2026-09-09', mode: 'submit', contact_name: '到货联系人', contact_phone: '13800000000', carrier: '顺丰物流', logistics_number: 'SF-PROC-20260909',
    lines_json: JSON.stringify([{ notice_line_id: ids.arrivalNoticeLine, quantity: 2, warehouse_id: ids.warehouse, batch_number: 'BATCH-RM-20260909-001' }]),
    remarks: '采购到货、检验与入库当前库验收。',
  });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const result = resultOf(response); ids.receipt = result.id;
  const receipt = await read('forge_purchase_receipt', ids.receipt);
  assert.deepEqual({ notice_id: receipt.notice_id, line_count: receipt.line_count, total_quantity: receipt.total_quantity, taxed_amount: receipt.taxed_amount, status: receipt.status },
    { notice_id: ids.arrivalNotice, line_count: 1, total_quantity: 2, taxed_amount: 13600, status: 'pending_inspection' });
  const receiptLines = await find('forge_purchase_receipt_line', { receipt_id: ids.receipt });
  assert.equal(receiptLines.length, 1); ids.receiptLine = receiptLines[0].id;
  const pending = await find('forge_pending_inspection', { receipt_id: ids.receipt });
  assert.equal(pending.length, 1); ids.pendingInspection = pending[0].id;
  assert.deepEqual({ receipt_line_id: pending[0].receipt_line_id, arrival_quantity: pending[0].arrival_quantity, status: pending[0].status },
    { receipt_line_id: ids.receiptLine, arrival_quantity: 2, status: 'pending' });
  const notice = await read('forge_purchase_arrival_notice', ids.arrivalNotice);
  const order = await read('forge_purchase_order', ids.order);
  const line = await read('forge_purchase_order_line', ids.orderLine);
  assert.deepEqual({ notice_status: notice.status, notice_arrived: notice.arrived_quantity, order_status: order.status, order_arrived: order.arrived_quantity, line_arrived: line.arrived_quantity },
    { notice_status: 'arrived', notice_arrived: 2, order_status: 'arrived', order_arrived: 2, line_arrived: 2 });
});

await test('rejects another receipt after the notice quantity is fully arrived', async () => {
  const response = await invoke('forge_purchase_arrival_notice', 'purchase_arrival_register', ids.arrivalNotice, {
    arrived_on: '2026-09-09', mode: 'submit', lines_json: JSON.stringify([{ notice_line_id: ids.arrivalNoticeLine, quantity: 1, warehouse_id: ids.warehouse }]),
  });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /状态已变化|超过剩余可到数量/);
  assert.equal((await find('forge_purchase_receipt', { notice_id: ids.arrivalNotice })).length, 1);
});

await test('generates an inspection order and records a partial pass', async () => {
  const generated = await invoke('forge_pending_inspection', 'pending_inspection_create_order', ids.pendingInspection, { inspection_method: 'full' });
  assert.equal(generated.status, 200, JSON.stringify(generated.value));
  ids.inspection = resultOf(generated).id;
  const invalid = await invoke('forge_purchase_inspection', 'purchase_inspection_complete', ids.inspection, {
    inspected_on: '2026-09-09', accepted_quantity: 3, inspection_note: '超量校验',
  });
  assert.equal(invalid.status, 400, JSON.stringify(invalid.value));
  assert.match(invalid.value.error.message, /必须在0和到货总数之间/);
  const response = await invoke('forge_purchase_inspection', 'purchase_inspection_complete', ids.inspection, {
    inspected_on: '2026-09-09', accepted_quantity: 1, inspection_note: '1件合格，1件待供应商处置。',
  });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const inspection = await read('forge_purchase_inspection', ids.inspection);
  const receipt = await read('forge_purchase_receipt', ids.receipt);
  const line = await read('forge_purchase_order_line', ids.orderLine);
  assert.deepEqual({ accepted: inspection.accepted_quantity, rejected: inspection.rejected_quantity, result: inspection.result, status: inspection.status, receipt_status: receipt.status, line_inspected: line.inspected_quantity, line_accepted: line.accepted_quantity },
    { accepted: 1, rejected: 1, result: 'partial', status: 'completed', receipt_status: 'inspected', line_inspected: 2, line_accepted: 1 });
});

await test('stocks only the accepted quantity and creates an auditable purchase inbound ledger', async () => {
  const beforeBalance = (await find('forge_inventory_balance', { balance_key: `${ids.warehouse}:${ids.sku}` }))[0] || { on_hand_quantity: 0, available_quantity: 0, inventory_value: 0 };
  const response = await invoke('forge_purchase_order', 'purchase_order_create_inbound', ids.order, {
    mode: 'submit', inbound_on: '2026-09-09', lines_json: JSON.stringify([{ inspection_id: ids.inspection, quantity: 1, warehouse_id: ids.warehouse }]),
    remarks: '检验合格数量采购入库。',
  });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  ids.inbound = resultOf(response).id;
  assert.ok(ids.inbound, 'purchase inbound id');
  assert.equal((await invoke('forge_purchase_inbound', 'purchase_inbound_approve', ids.inbound, { approval_note: '采购入库审批通过' })).status, 200);
  assert.equal((await invoke('forge_purchase_inbound', 'purchase_inbound_stock', ids.inbound)).status, 200);
  const inbound = await read('forge_purchase_inbound', ids.inbound);
  assert.deepEqual({ order_id: inbound.order_id, line_count: inbound.line_count, total_quantity: inbound.total_quantity, status: inbound.status },
    { order_id: ids.order, line_count: 1, total_quantity: 1, status: 'stocked' });
  const balances = await find('forge_inventory_balance', { balance_key: `${ids.warehouse}:${ids.sku}` });
  assert.equal(balances.length, 1); ids.balance = balances[0].id;
  assert.deepEqual({ on_hand_delta: round4(balances[0].on_hand_quantity - Number(beforeBalance.on_hand_quantity || 0)), available_delta: round4(balances[0].available_quantity - Number(beforeBalance.available_quantity || 0)), value_delta: round4(balances[0].inventory_value - Number(beforeBalance.inventory_value || 0)) },
    { on_hand_delta: 1, available_delta: 1, value_delta: 6800 });
  const ledgers = await find('forge_inventory_ledger', { source_id: ids.inbound });
  assert.equal(ledgers.length, 1); ids.ledger = ledgers[0].id;
  assert.deepEqual({ source_object: ledgers[0].source_object, direction: ledgers[0].direction, movement_type: ledgers[0].movement_type, quantity: ledgers[0].quantity, amount: ledgers[0].amount },
    { source_object: 'forge_purchase_inbound', direction: 'inbound', movement_type: 'purchase_inbound', quantity: 1, amount: 6800 });
  const order = await read('forge_purchase_order', ids.order), line = await read('forge_purchase_order_line', ids.orderLine), receipt = await read('forge_purchase_receipt', ids.receipt);
  assert.deepEqual({ status: order.status, inbound: order.inbound_quantity, line_inbound: line.inbound_quantity, receipt_status: receipt.status },
    { status: 'partially_arrived', inbound: 1, line_inbound: 1, receipt_status: 'stocked' });
});

await test('rejects a second inbound for the same inspection without another stock movement', async () => {
  const response = await invoke('forge_purchase_order', 'purchase_order_create_inbound', ids.order, {
    mode: 'submit', inbound_on: '2026-09-09', lines_json: JSON.stringify([{ inspection_id: ids.inspection, quantity: 1, warehouse_id: ids.warehouse }]),
  });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /入库数量超过检验合格剩余数量/);
  assert.equal((await find('forge_inventory_ledger', { source_id: ids.inbound })).length, 1);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'local-procurement-receipt-inspection-inbound-acceptance', ids, cases,
  passed: cases.every(testCase => testCase.status === 'passed'),
  runtime: { url: process.env.FORGE_URL || 'http://localhost:4321', database: '.objectstack/data/objectstack.db' },
  observedBoundary: 'An approved arrival notice can be received with line JSON, converted to pending inspection, inspected, approved for inbound and stocked. Only accepted quantity increases the warehouse-SKU balance and creates a source-linked purchase inbound ledger.',
  limitations: [
    'RISEMAP evidence currently confirms the arrival, pending-inspection, inspection and purchase-inbound pages and their sequence, but this run is Forge current-SQLite evidence until browser side-by-side verification is restored.',
    'This slice handles one material line for the current regression material; multiline behavior is covered by the multiline acceptance scripts.',
    'Supplier nonconformance disposition, returns, accounts payable and purchase invoices remain separate slices.',
  ],
};
await writeFile('.objectstack/acceptance/procurement-receipt-inbound-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
