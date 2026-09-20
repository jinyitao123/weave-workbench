import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4490';
const api = await connect(endpoint);

async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const result = await api.request(`/data/${object}?${query}`);
  assert.equal(result.status, 200, object);
  return (result.value.records || []).filter((record) =>
    Object.entries(where).every(([key, value]) => record[key] === value));
}

const [request] = await find('forge_purchase_request', { code: 'PR-ENTRY-MODES-001' });
assert.ok(request, 'accepted mixed-entry purchase request must survive restart');
const lines = await find('forge_purchase_request_line', { request_id: request.id });
const logs = await find('forge_purchase_request_approval_log', { request_id: request.id });
const pending = await find('forge_purchase_pending_item', { request_id: request.id });

assert.deepEqual({
  status: request.status,
  lineCount: Number(request.line_count),
  quantity: Number(request.total_quantity),
  amount: Number(request.estimated_taxed_amount),
  modes: lines.map((line) => line.entry_mode).sort(),
  skuIds: lines.map((line) => line.sku_id),
  actions: logs.map((log) => log.action).sort(),
  pendingCount: pending.length,
  pendingQuantity: pending.reduce((sum, item) => sum + Number(item.remaining_quantity), 0),
}, {
  status: 'approved', lineCount: 2, quantity: 103, amount: 1440,
  modes: ['manual', 'paste'], skuIds: [null, null],
  actions: ['approved', 'submitted'], pendingCount: 2, pendingQuantity: 103,
});

console.log(JSON.stringify({
  suite: 'purchase-request-entry-modes-restart-readback', status: 'passed', endpoint,
  requestId: request.id, lineIds: lines.map((line) => line.id), pendingIds: pending.map((item) => item.id),
}, null, 2));
