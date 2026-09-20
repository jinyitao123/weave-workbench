import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4386';
const api = await connect(endpoint);

async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const result = await api.request(`/data/${object}?${query}`);
  assert.equal(result.status, 200, object);
  return (result.value.records || []).filter((record) =>
    Object.entries(where).every(([key, value]) => record[key] === value));
}

const approved = (await find('forge_purchase_request', { code: 'PR-1789479200309' }))[0];
const cancelled = (await find('forge_purchase_request', { code: 'PR-1789479326599' }))[0];
assert.ok(approved && cancelled, 'browser-created purchase requests must remain readable');

const [approvedLines, cancelledLines, approvedLogs, cancelledLogs] = await Promise.all([
  find('forge_purchase_request_line', { request_id: approved.id }),
  find('forge_purchase_request_line', { request_id: cancelled.id }),
  find('forge_purchase_request_approval_log', { request_id: approved.id }),
  find('forge_purchase_request_approval_log', { request_id: cancelled.id }),
]);

assert.equal(approvedLines.length, 1);
assert.deepEqual({
  status: approved.status,
  lineCount: Number(approved.line_count),
  quantity: Number(approved.total_quantity),
  amount: Number(approved.estimated_taxed_amount),
  lineQuantity: Number(approvedLines[0].quantity),
  lineAmount: Number(approvedLines[0].taxed_subtotal),
  actions: approvedLogs.map((log) => log.action).sort(),
}, {
  status: 'approved', lineCount: 1, quantity: 2, amount: 13600,
  lineQuantity: 2, lineAmount: 13600, actions: ['approved', 'submitted'],
});

assert.equal(cancelledLines.length, 1);
assert.deepEqual({
  name: cancelled.name,
  status: cancelled.status,
  lineQuantity: Number(cancelledLines[0].quantity),
  lineAmount: Number(cancelledLines[0].taxed_subtotal),
  actions: cancelledLogs.map((log) => log.action),
  comment: cancelledLogs[0]?.comment,
}, {
  name: '取消路径采购申请（已修改）', status: 'cancelled',
  lineQuantity: 3, lineAmount: 9600, actions: ['cancelled'],
  comment: '业务测试取消，验证不可恢复阻断',
});

console.log(JSON.stringify({
  suite: 'purchase-request-page-readback', status: 'passed', endpoint,
  approved: approved.code, cancelled: cancelled.code,
  approvedAmount: approved.estimated_taxed_amount,
  cancelledLineAmount: cancelledLines[0].taxed_subtotal,
}, null, 2));
