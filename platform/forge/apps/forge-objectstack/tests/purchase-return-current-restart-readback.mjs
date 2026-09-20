import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const report = JSON.parse(await readFile('.objectstack/acceptance/purchase-return-current-report.json', 'utf8'));
assert.equal(report.passed, true, 'purchase-return-current acceptance must pass first');
const { ids } = report;

async function find(object, where = {}, top = 500) {
  const q = new URLSearchParams({ $filter: JSON.stringify(where), $top: String(top) });
  const response = await api.request('/data/' + object + '?' + q);
  assert.equal(response.status, 200, object + ': ' + JSON.stringify(response.value));
  return (response.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
}
async function read(object, id) {
  const response = await api.request('/data/' + object + '/' + id);
  assert.equal(response.status, 200, object + '/' + id + ': ' + JSON.stringify(response.value));
  return response.value.record;
}

const purchaseReturn = await read('forge_purchase_return', ids.return);
const replacement = await read('forge_purchase_return', ids.replacement);
const orderLine = await read('forge_purchase_order_line', ids.orderLine);
const balance = (await find('forge_inventory_balance', { balance_key: ids.warehouse + ':' + ids.sku }))[0];
const refund = await read('forge_purchase_return_refund_receipt', ids.refundReceipt);
const inbound = await read('forge_purchase_inbound', ids.replacementInbound);
const returnLedger = (await find('forge_inventory_ledger', { source_id: ids.return })).find(row => row.movement_type === 'purchase_return_outbound');
const replacementOutboundLedger = (await find('forge_inventory_ledger', { source_id: ids.replacement })).find(row => row.movement_type === 'purchase_return_outbound');
const replacementInboundLedger = (await find('forge_inventory_ledger', { source_id: ids.replacementInbound })).find(row => row.movement_type === 'purchase_replacement_inbound');

assert.deepEqual(
  { status: purchaseReturn.status, outbound: purchaseReturn.outbound_status, refund: purchaseReturn.refund_status },
  { status: 'completed', outbound: 'outbounded', refund: 'received' },
  'return/refund status should survive restart',
);
assert.deepEqual(
  { status: replacement.status, outbound: replacement.outbound_status, replacement: replacement.replacement_status, refund: replacement.refund_status },
  { status: 'completed', outbound: 'outbounded', replacement: 'stocked', refund: 'not_required' },
  'replacement status should survive restart',
);
assert.equal(refund.return_id, ids.return, 'refund receipt keeps source return');
assert.equal(inbound.purchase_return_id, ids.replacement, 'replacement inbound keeps source return');
assert.ok(returnLedger, 'return outbound ledger should be readable');
assert.ok(replacementOutboundLedger, 'replacement outbound ledger should be readable');
assert.ok(replacementInboundLedger, 'replacement inbound ledger should be readable');
assert.ok(balance, 'warehouse/SKU inventory balance should be readable');
assert.ok(Number(orderLine.returned_quantity || 0) >= 0.2, 'order line keeps returned quantity from both flows');

const readback = {
  suite: 'purchase-return-current-restart-readback',
  endpoint,
  status: 'passed',
  ids: {
    return: ids.return,
    replacement: ids.replacement,
    refundReceipt: ids.refundReceipt,
    replacementInbound: ids.replacementInbound,
    orderLine: ids.orderLine,
    balance: balance.id,
  },
  assertion: 'Current SQLite purchase return/refund and replacement/replenishment results remain readable after service restart, including source-linked inventory and cash records.',
};
console.log(JSON.stringify(readback, null, 2));
