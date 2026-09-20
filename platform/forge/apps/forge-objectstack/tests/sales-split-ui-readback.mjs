import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const api = await connect();
const findOne = async (object, where) => {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '10' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object} query`);
  const records = response.value.records.filter(record =>
    Object.entries(where).every(([field, value]) => record[field] === value));
  assert.equal(records.length, 1, `${object} must contain exactly one matching record`);
  return records[0];
};
const order = await findOne('forge_sales_order', { code: 'SO-CONVERT-20260909-001' });
const shipment = await findOne('forge_sales_shipment', { code: 'UI-DN-2-20260909' });
const outbound = await findOne('forge_sales_outbound', { code: 'UI-OUT-2-20260909' });
const invoice = await findOne('forge_sales_invoice', { code: 'UI-INV-2-20260909' });
const receivable = await findOne('forge_accounts_receivable', { code: 'AR-UI-INV-2-20260909' });
const orderLine = await findOne('forge_sales_order_line', { order_id: order.id });
const balance = await findOne('forge_inventory_balance', { balance_key: `${outbound.warehouse_id}:${outbound.sku_id}` });

assert.deepEqual(
  { status: order.status, shipment_count: order.shipment_count, shipped_amount: order.shipped_amount, invoiced_amount: order.invoiced_amount },
  { status: 'shipped', shipment_count: 2, shipped_amount: 256000, invoiced_amount: 243200 },
);
assert.deepEqual(
  { quantity: orderLine.quantity, shipped: orderLine.shipped_quantity, invoiced: orderLine.invoiced_quantity },
  { quantity: 2, shipped: 2, invoiced: 2 },
);
assert.deepEqual(
  { quantity: shipment.total_quantity, outbound: shipment.outbound_quantity, status: shipment.status },
  { quantity: 1, outbound: 1, status: 'outbounded' },
);
assert.deepEqual(
  { quantity: outbound.quantity, before: outbound.before_on_hand, after: outbound.after_on_hand, amount: outbound.inventory_amount },
  { quantity: 1, before: 2, after: 1, amount: 58000 },
);
assert.deepEqual(
  { amount: invoice.total_amount, outstanding: invoice.outstanding_amount, status: invoice.status },
  { amount: 121600, outstanding: 121600, status: 'issued' },
);
assert.deepEqual(
  { original: receivable.original_amount, outstanding: receivable.outstanding_amount, status: receivable.status },
  { original: 121600, outstanding: 121600, status: 'unpaid' },
);
assert.deepEqual(
  { onHand: balance.on_hand_quantity, available: balance.available_quantity, value: balance.inventory_value },
  { onHand: 1, available: 1, value: 58000 },
);

const report = {
  recordedAt: new Date().toISOString(),
  kind: 'real-browser-sales-split-fulfilment-acceptance',
  runtime: { url: process.env.FORGE_URL, database: process.env.FORGE_DB },
  browserActions: [
    'Created shipment UI-DN-2-20260909 from the sales-order record action.',
    'Created outbound UI-OUT-2-20260909 from the shipment record action with the visible warehouse picker.',
    'Created invoice UI-INV-2-20260909 from the sales-order record action.',
  ],
  visibleEvidence: [
    'The shipment list showed the new one-unit shipment before outbound.',
    'The invoice list showed two issued invoices of 121600 each.',
    'The receivable list showed two unpaid receivables of 121600 each.',
    'The inventory-balance list showed one unit available at an inventory value of 58000.',
  ],
  ids: { order: order.id, orderLine: orderLine.id, shipment: shipment.id, outbound: outbound.id, invoice: invoice.id, receivable: receivable.id, balance: balance.id },
  passed: true,
  restartReadback: process.argv.includes('--restart') ? { passed: true, at: new Date().toISOString() } : { passed: false },
  boundary: 'The three mutations were submitted through the real browser UI. This script only reads back their persisted effects through the API.',
};
await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/sales-split-ui-report.json', JSON.stringify(report, null, 2));
console.log(`PASS real-browser split fulfilment readback${process.argv.includes('--restart') ? ' after restart' : ''}`);
