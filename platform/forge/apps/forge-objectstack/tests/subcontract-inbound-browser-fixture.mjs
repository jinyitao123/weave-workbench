import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/subcontract-inbound-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
const endpoint = process.env.FORGE_URL || 'http://localhost:4388';
const api = await connect(endpoint);
const invoke = (object, action, id, params = {}) => api.request('/actions/' + object + '/' + action + '/' + id, 'POST', { params });
const resultOf = response => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
async function read(object, id) { const response = await api.request('/data/' + object + '/' + id); assert.equal(response.status, 200, object + '/' + id); return response.value.record; }

let response = await invoke('forge_subcontract_order', 'subcontract_issue_create', report.ids.customerSuppliedOrder, {
  issue_code: 'SI-BROWSER-INBOUND-20260912-002', issue_type: 'normal', issue_on: '2026-09-12',
  lines_json: JSON.stringify([{ plan_id: report.ids.customerPlan, quantity: 2, batch_number: 'SC-BROWSER-MATERIAL-002' }]),
  remarks: '为浏览器回厂入库闭环追加实物发料',
});
assert.equal(response.status, 200, JSON.stringify(response.value));
const issueId = resultOf(response).id;
response = await invoke('forge_subcontract_issue', 'subcontract_issue_submit', issueId); assert.equal(response.status, 200, JSON.stringify(response.value));
response = await invoke('forge_subcontract_issue', 'subcontract_issue_review', issueId, { decision: 'approve', comment: '浏览器验收追加发料，订单与库存复核通过' }); assert.equal(response.status, 200, JSON.stringify(response.value));
response = await invoke('forge_subcontract_issue', 'subcontract_issue_dispatch', issueId, { comment: '实物追加发出 2 件供页面回厂倒冲' }); assert.equal(response.status, 200, JSON.stringify(response.value));
response = await invoke('forge_subcontract_issue', 'subcontract_issue_sign', issueId, { sign_note: '供应商签收追加材料 2 件' }); assert.equal(response.status, 200, JSON.stringify(response.value));

const stock = await read('forge_subcontract_stock_balance', report.ids.stockBalance);
assert.deepEqual([stock.cumulative_issued_quantity, stock.backflushed_quantity, stock.on_hand_quantity, stock.inventory_value], [8, 6, 2, 25]);
report.ids.browserIssue = issueId;
report.browserFixture = { status: 'passed', issueCode: 'SI-BROWSER-INBOUND-20260912-002', issuedQuantity: 2, supplierOnHandBeforeReceipt: 2, preparedAt: new Date().toISOString() };
await writeFile(path, JSON.stringify(report, null, 2) + '\n');
console.log('PASS browser fixture added 2 units through governed subcontract issue actions');
