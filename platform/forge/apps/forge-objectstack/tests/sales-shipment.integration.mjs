import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const conversion = JSON.parse(await readFile('.objectstack/acceptance/sales-conversion-report.json', 'utf8'));
assert.equal(conversion.passed, true, 'sales conversion acceptance must pass before shipment verification');
const api = await connect();
const cases = [];
const ids = { order: conversion.ids.order, orderLine: conversion.ids.orderLine };
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

async function read(object, id) {
  const result = await api.request(`/data/${object}/${id}`);
  assert.equal(result.status, 200, `${object} read`);
  return result.value.record;
}

async function find(object, where) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '20' });
  const result = await api.request(`/data/${object}?${query}`);
  assert.equal(result.status, 200, `${object} find`);
  return result.value.records.filter(record => Object.entries(where).every(([field, value]) => record[field] === value));
}

async function invoke(params) {
  return api.request(`/actions/forge_sales_order/sales_order_create_shipment/${ids.order}`, 'POST', { params });
}

function actionResult(response) {
  return response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
}

try {
  const previous = JSON.parse(await readFile('.objectstack/acceptance/sales-shipment-report.json', 'utf8'));
  if (previous.ids?.shipmentLine) await api.request(`/data/forge_sales_shipment_line/${previous.ids.shipmentLine}`, 'DELETE');
  if (previous.ids?.shipment) await api.request(`/data/forge_sales_shipment/${previous.ids.shipment}`, 'DELETE');
  await api.request(`/data/forge_sales_order/${ids.order}`, 'PATCH', { shipment_count: 0, planned_shipment_amount: 0 });
} catch {}

await test('creates a partial shipment plan from one active order line', async () => {
  const response = await invoke({
    code: 'DN-CONVERT-' + stamp + '-001', shipment_on: '2026-09-09', recipient: '周启明',
    recipient_phone: '13800002609', delivery_address: '苏州市工业园区澄岳路9号', quantity: 1,
    remarks: '销售发货单切片验收；实际出库另行处理。',
  });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  ids.shipment = actionResult(response).id;
  assert.ok(ids.shipment, 'created shipment id');
  const shipment = await read('forge_sales_shipment', ids.shipment);
  assert.deepEqual(
    { status: shipment.status, total_quantity: shipment.total_quantity, outbound_quantity: shipment.outbound_quantity, total_amount: shipment.total_amount },
    { status: 'pending_shipment', total_quantity: 1, outbound_quantity: 0, total_amount: 128000 },
  );
  const lines = await find('forge_sales_shipment_line', { shipment_id: ids.shipment });
  assert.equal(lines.length, 1);
  ids.shipmentLine = lines[0].id;
  assert.deepEqual(
    { order_id: lines[0].order_id, order_line_id: lines[0].order_line_id, quantity: lines[0].quantity, outbound_quantity: lines[0].outbound_quantity, taxed_subtotal: lines[0].taxed_subtotal },
    { order_id: ids.order, order_line_id: ids.orderLine, quantity: 1, outbound_quantity: 0, taxed_subtotal: 128000 },
  );
});

await test('keeps shipment planning separate from actual outbound progress', async () => {
  const order = await read('forge_sales_order', ids.order);
  const orderLine = await read('forge_sales_order_line', ids.orderLine);
  assert.deepEqual(
    { status: order.status, shipment_count: order.shipment_count, planned_shipment_amount: order.planned_shipment_amount, shipped_amount: Number(order.shipped_amount || 0), shipped_quantity: orderLine.shipped_quantity },
    { status: 'active', shipment_count: 1, planned_shipment_amount: 128000, shipped_amount: 0, shipped_quantity: 0 },
  );
});

await test('rejects shipment quantity beyond the unplanned order remainder', async () => {
  const response = await invoke({
    code: 'DN-CONVERT-' + stamp + '-OVER', shipment_on: '2026-09-09', recipient: '周启明',
    delivery_address: '苏州市工业园区澄岳路9号', quantity: 2,
  });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /超过订单未建单数量/);
  assert.equal((await find('forge_sales_shipment_line', { order_line_id: ids.orderLine })).length, 1);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'local-sales-shipment-api-acceptance',
  fixture: 'OEM-RM-20260909-A-sales-shipment-v0.4', ids, cases,
  passed: cases.every(testCase => testCase.status === 'passed'),
  observedBoundary: 'Shipment planning reserves order quantity but does not change shipped quantity, shipped amount, order status or inventory. RISEMAP valued the one-unit shipment at the undiscounted taxed unit price of 128000.',
  limitations: [
    'This first slice creates a partial shipment from an order with exactly one material line.',
    'Multi-line allocation, multi-order merging, shipment cancellation and concurrent reservation races remain outside this slice.',
    'ObjectStack 17.3.0 audit writes time out when these three creates/updates run inside ctx.api.transaction, so this slice currently writes them sequentially and does not yet guarantee atomic rollback.',
    'Outbound documents and inventory movements are intentionally absent until a real stocked outbound is observed.',
  ],
};
await writeFile('.objectstack/acceptance/sales-shipment-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
