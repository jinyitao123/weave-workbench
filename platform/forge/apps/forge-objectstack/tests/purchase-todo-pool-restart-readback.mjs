import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const api = await connect(process.env.FORGE_URL || 'http://localhost:4422');

async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const result = await api.request(`/data/${object}?${query}`);
  assert.equal(result.status, 200, object);
  return (result.value.records || []).filter(record => Object.entries(where).every(([key, value]) => record[key] === value));
}

const [request] = await find('forge_purchase_request', { code: 'PR-SUPPLY-POOL-BROWSER-001' });
assert.ok(request, 'browser acceptance purchase request must exist');
const [pending] = await find('forge_purchase_pending_item', { request_id: request.id });
assert.ok(pending, 'approved request line must remain in the procurement pool');
const orders = await find('forge_purchase_order', { purchase_request_id: request.id });
assert.equal(orders.length, 1, 'browser operation must create one source-linked order');
const [order] = orders;
const [line] = await find('forge_purchase_order_line', { order_id: order.id });
assert.ok(line, 'browser-created order line must exist');

assert.deepEqual({
  request_status: request.status,
  pending_status: pending.status,
  requested: Number(pending.requested_quantity),
  ordered: Number(pending.ordered_quantity),
  remaining: Number(pending.remaining_quantity),
  order_status: order.status,
  order_source: order.source_type,
  request_link: order.purchase_request_id,
  line_source: line.purchase_request_line_id,
  order_quantity: Number(line.quantity),
  untaxed_price: Number(line.untaxed_unit_price),
}, {
  request_status: 'approved', pending_status: 'ordered', requested: 2, ordered: 2, remaining: 0,
  order_status: 'draft', order_source: 'purchase_request', request_link: request.id,
  line_source: pending.request_line_id, order_quantity: 2, untaxed_price: 6017.6991,
});

console.log(JSON.stringify({ suite: 'purchase-todo-pool-restart-readback', status: 'passed', request_id: request.id, pending_id: pending.id, order_id: order.id, order_line_id: line.id }, null, 2));
