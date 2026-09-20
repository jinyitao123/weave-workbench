import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4490';
const api = await connect(endpoint);

async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const result = await api.request(`/data/${object}?${query}`);
  assert.equal(result.status, 200, `${object}: ${JSON.stringify(result.value)}`);
  return (result.value.records || []).filter((record) =>
    Object.entries(where).every(([key, value]) => record[key] === value));
}

async function create(object, body) {
  const result = await api.request(`/data/${object}`, 'POST', body);
  assert.equal(result.status, 201, `${object}: ${JSON.stringify(result.value)}`);
  return result.value.id || result.value.record?.id;
}

async function invoke(action, id, params = {}, authenticated = true) {
  return api.request(`/actions/forge_purchase_request/${action}/${id}`, 'POST', { params }, authenticated);
}

async function removeRequest(request) {
  for (const object of ['forge_purchase_pending_item', 'forge_purchase_request_approval_log', 'forge_purchase_request_line']) {
    const key = object === 'forge_purchase_request_line' || object === 'forge_purchase_request_approval_log' ? 'request_id' : 'request_id';
    for (const record of await find(object, { [key]: request.id })) {
      const deleted = await api.request(`/data/${object}/${record.id}`, 'DELETE');
      assert.ok([200, 204].includes(deleted.status), `${object} cleanup failed`);
    }
  }
  const deleted = await api.request(`/data/forge_purchase_request/${request.id}`, 'DELETE');
  assert.ok([200, 204].includes(deleted.status), 'request cleanup failed');
}

for (const code of ['PR-ENTRY-MODES-001', 'PR-ENTRY-INCOMPLETE-001']) {
  for (const request of await find('forge_purchase_request', { code })) await removeRequest(request);
}

const requestId = await create('forge_purchase_request', {
  name: '现场辅材采购申请', code: 'PR-ENTRY-MODES-001', priority: 'high',
  responsible_id: api.userId, currency: 'cny', request_on: '2026-09-16',
  expected_arrival_on: '2026-09-25', purchase_reason: '验证手工录入和快速粘贴明细', status: 'draft',
});

const manualLineId = await create('forge_purchase_request_line', {
  name: '屏蔽电缆', request_id: requestId, entry_mode: 'manual', sku_id: null,
  item_code: '', model: 'RVVP-4x1.0', specification: '100 米/卷', category_name: '电气辅材',
  unit_name: '卷', quantity: 3, taxed_unit_price: 420, tax_rate: 13, taxed_subtotal: 1260,
  expected_arrival_on: '2026-09-25',
});
const pasteLineId = await create('forge_purchase_request_line', {
  name: '接线端子', request_id: requestId, entry_mode: 'paste', sku_id: null,
  item_code: '', model: 'UK2.5B', specification: '灰色', category_name: '电气辅材',
  unit_name: '只', quantity: 100, taxed_unit_price: 1.8, tax_rate: 13, taxed_subtotal: 180,
  expected_arrival_on: '2026-09-25',
});

const submitted = await invoke('purchase_request_submit', requestId);
assert.equal(submitted.status, 200, JSON.stringify(submitted.value));
const [submittedRequest] = await find('forge_purchase_request', { id: requestId });
assert.deepEqual({
  status: submittedRequest.status,
  lineCount: Number(submittedRequest.line_count),
  quantity: Number(submittedRequest.total_quantity),
  amount: Number(submittedRequest.estimated_taxed_amount),
}, { status: 'pending_approval', lineCount: 2, quantity: 103, amount: 1440 });

const approved = await invoke('purchase_request_approve', requestId, { approval_comment: '需求与交期已核对，同意采购' });
assert.equal(approved.status, 200, JSON.stringify(approved.value));
const pending = await find('forge_purchase_pending_item', { request_id: requestId });
assert.equal(pending.length, 2);
assert.deepEqual(pending.map((item) => ({
  name: item.name, model: item.model, quantity: Number(item.requested_quantity),
  remaining: Number(item.remaining_quantity), status: item.status,
})).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')), [
  { name: '接线端子', model: 'UK2.5B', quantity: 100, remaining: 100, status: 'ready' },
  { name: '屏蔽电缆', model: 'RVVP-4x1.0', quantity: 3, remaining: 3, status: 'ready' },
].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')));

const incompleteId = await create('forge_purchase_request', {
  name: '缺字段采购申请', code: 'PR-ENTRY-INCOMPLETE-001', priority: 'medium',
  responsible_id: api.userId, currency: 'cny', request_on: '2026-09-16',
  expected_arrival_on: '2026-09-25', purchase_reason: '验证提交阻断', status: 'draft',
});
await create('forge_purchase_request_line', {
  name: '未分类物料', request_id: incompleteId, entry_mode: 'manual', sku_id: null,
  model: 'NO-CATEGORY', unit_name: '件', quantity: 1, taxed_unit_price: 10, tax_rate: 13, taxed_subtotal: 10,
});
const incomplete = await invoke('purchase_request_submit', incompleteId);
assert.equal(incomplete.status, 400, JSON.stringify(incomplete.value));
assert.match(incomplete.value.error.message, /物料名称、型号、物料分类和单位/);

const anonymous = await invoke('purchase_request_approve', requestId, { approval_comment: '匿名重试' }, false);
assert.ok([401, 403].includes(anonymous.status), JSON.stringify(anonymous.value));

console.log(JSON.stringify({
  suite: 'purchase-request-entry-modes', status: 'passed', endpoint,
  requestId, manualLineId, pasteLineId, pendingIds: pending.map((item) => item.id), incompleteId,
}, null, 2));
