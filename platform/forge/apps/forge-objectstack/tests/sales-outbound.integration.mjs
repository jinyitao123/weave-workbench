import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const shipmentReport = JSON.parse(await readFile('.objectstack/acceptance/sales-shipment-report.json', 'utf8'));
const inventoryReport = JSON.parse(await readFile('.objectstack/acceptance/inventory-opening-report.json', 'utf8'));
const registry = JSON.parse(await readFile('.objectstack/acceptance/reference-data.json', 'utf8'));
assert.equal(shipmentReport.passed, true, 'sales shipment acceptance must pass before outbound verification');
assert.equal(inventoryReport.passed, true, 'inventory acceptance must pass before outbound verification');
const foundation = Object.fromEntries(registry.results.map(result => [result.key, result.id]));
const api = await connect();
const cases = [];
const ids = { ...shipmentReport.ids, warehouse: inventoryReport.ids.warehouse, sku: inventoryReport.ids.sku };
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const read = async (object, id) => (await api.request(`/data/${object}/${id}`)).value.record;
const find = async (object, where) => {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '20' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object} find`);
  return response.value.records.filter(record => Object.entries(where).every(([field, value]) => record[field] === value));
};
const invoke = params => api.request(`/actions/forge_sales_shipment/sales_shipment_create_outbound/${ids.shipment}`, 'POST', { params });
const resultOf = response => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

await test('rejects an outbound warehouse without a matching SKU balance', async () => {
  const created = await api.request('/data/forge_warehouse', 'POST', {
    name: '销售出库空库存验收仓', code: 'WH-OUTBOUND-EMPTY-' + stamp, type_id: foundation.warehouse_type,
    responsible_id: api.userId, phone: '0512-00000000', area: 10, address: '苏州市销售出库验收隔离地址',
  });
  assert.equal(created.status, 201, JSON.stringify(created.value));
  ids.emptyWarehouse = created.value.id || created.value.record?.id;
  const rejected = await invoke({ code: 'OUT-CONVERT-' + stamp + '-NO-STOCK', warehouse_id: ids.emptyWarehouse, outbound_on: '2026-09-09', quantity: 1 });
  assert.equal(rejected.status, 400, JSON.stringify(rejected.value));
  assert.match(rejected.value.error.message, /没有该物料的库存余额/);
  assert.equal((await find('forge_sales_outbound', { shipment_id: ids.shipment })).length, 0);
});

await test('deducts the persisted warehouse-SKU balance and creates a source-linked ledger', async () => {
  const before = (await find('forge_inventory_balance', { balance_key: `${ids.warehouse}:${ids.sku}` }))[0];
  assert.ok(before, '当前库需要有销售出库库存余额');
  const beforeOnHand = Number(before.on_hand_quantity || 0), beforeAvailable = Number(before.available_quantity || 0), beforeValue = Number(before.inventory_value || 0), beforeCost = Number(before.average_cost || 0);
  assert.ok(beforeOnHand >= 1 && beforeAvailable >= 1, '销售出库库存余额至少需要 1 台');
  const response = await invoke({ code: 'OUT-CONVERT-' + stamp + '-001', warehouse_id: ids.warehouse, outbound_on: '2026-09-09', quantity: 1, customer_pickup: true });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  ids.outbound = resultOf(response).id;
  assert.ok(ids.outbound, 'outbound id');
  const outbound = await read('forge_sales_outbound', ids.outbound);
  assert.deepEqual({ status: outbound.status, sku_id: outbound.sku_id, quantity: outbound.quantity, available: outbound.available_quantity,
    before: outbound.before_on_hand, after: outbound.after_on_hand, cost: outbound.unit_cost, amount: outbound.inventory_amount, pickup: outbound.customer_pickup },
  { status: 'outbounded', sku_id: ids.sku, quantity: 1, available: beforeAvailable, before: beforeOnHand, after: beforeOnHand - 1, cost: beforeCost, amount: beforeCost, pickup: true });
  const after = await read('forge_inventory_balance', before.id);
  assert.deepEqual({ on_hand: after.on_hand_quantity, reserved: after.reserved_quantity, available: after.available_quantity, value: after.inventory_value, cost: after.average_cost },
    { on_hand: beforeOnHand - 1, reserved: 0, available: beforeAvailable - 1, value: beforeValue - beforeCost, cost: beforeCost });
  const ledgers = await find('forge_inventory_ledger', { source_id: ids.outbound });
  assert.equal(ledgers.length, 1); ids.ledger = ledgers[0].id; ids.balance = before.id;
  assert.deepEqual({ source_object: ledgers[0].source_object, source_line_id: ledgers[0].source_line_id, direction: ledgers[0].direction,
    movement_type: ledgers[0].movement_type, quantity: ledgers[0].quantity, before: ledgers[0].before_on_hand, after: ledgers[0].after_on_hand, amount: ledgers[0].amount },
  { source_object: 'forge_sales_outbound', source_line_id: ids.shipmentLine, direction: 'outbound', movement_type: 'sales_outbound', quantity: 1, before: beforeOnHand, after: beforeOnHand - 1, amount: beforeCost });
});

await test('rolls outbound progress up to the shipment and order', async () => {
  const shipment = await read('forge_sales_shipment', ids.shipment);
  const order = await read('forge_sales_order', ids.order);
  const line = await read('forge_sales_order_line', ids.orderLine);
  assert.deepEqual({ status: shipment.status, outbound_quantity: shipment.outbound_quantity, outbound_count: shipment.outbound_count },
    { status: 'outbounded', outbound_quantity: 1, outbound_count: 1 });
  assert.deepEqual({ status: order.status, shipped_amount: order.shipped_amount, shipped_quantity: line.shipped_quantity },
    { status: 'partially_shipped', shipped_amount: 128000, shipped_quantity: 1 });
});

await test('rejects repeated outbound after shipment completion without another stock movement', async () => {
  const rejected = await invoke({ code: 'OUT-CONVERT-' + stamp + '-OVER', warehouse_id: ids.warehouse, outbound_on: '2026-09-09', quantity: 1 });
  assert.equal(rejected.status, 400);
  assert.match(rejected.value.error.message, /发货单状态已变化/);
  assert.equal((await find('forge_inventory_ledger', { source_id: ids.outbound })).length, 1);
});

if (ids.emptyWarehouse) await api.request(`/data/forge_warehouse/${ids.emptyWarehouse}`, 'DELETE');
await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'local-sales-outbound-inventory-api-acceptance', ids, cases,
  passed: cases.every(testCase => testCase.status === 'passed'),
  observedBoundary: 'The outbound action reads the persisted warehouse-SKU balance, rejects a warehouse without stock, deducts quantity and inventory value, creates a source-linked outbound ledger, and rolls progress up to the shipment and order.',
  limitations: [
    'The current slice supports one shipment material line and one warehouse balance per outbound.',
    'ObjectStack 17.3.0 action transactions time out during audit persistence, so document, balance, ledger and rollup writes remain sequential and do not guarantee atomic rollback.',
    'Concurrent outbound reservation and retry idempotency remain outside this slice.',
    'RISEMAP successful outbound remains unproven because its same-input confirmation was still blocked by the initial-inventory gate.',
  ],
};
await writeFile('.objectstack/acceptance/sales-outbound-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
