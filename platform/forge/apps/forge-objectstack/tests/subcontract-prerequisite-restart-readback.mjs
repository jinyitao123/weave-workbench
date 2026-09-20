import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4356';
const database = process.env.FORGE_DB || '.objectstack/data/objectstack.db';
const [orderReport, issueReport, receiptReport] = await Promise.all([
  readFile('.objectstack/acceptance/subcontract-order-report.json', 'utf8').then(JSON.parse),
  readFile('.objectstack/acceptance/subcontract-issue-report.json', 'utf8').then(JSON.parse),
  readFile('.objectstack/acceptance/subcontract-receipt-report.json', 'utf8').then(JSON.parse),
]);
assert.equal(orderReport.passed, true);
assert.equal(issueReport.passed, true);
assert.equal(receiptReport.passed, true);

const api = await connect(endpoint);
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}`);
  return response.value.record;
}
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, object);
  return (response.value.records || []).filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
}

const [profile, bendingPrice, markingPrice, policyRows, order, issue, receipt] = await Promise.all([
  read('forge_subcontract_supplier_profile', orderReport.ids.profile),
  read('forge_subcontract_processing_price', orderReport.ids.bendingPrice),
  read('forge_subcontract_processing_price', orderReport.ids.markingPrice),
  find('forge_subcontract_policy', { status: 'active' }),
  read('forge_subcontract_order', orderReport.ids.customerSuppliedOrder),
  read('forge_subcontract_issue', issueReport.ids.issue),
  read('forge_subcontract_receipt', receiptReport.ids.receipt),
]);
assert.equal(profile.status, 'active');
assert.deepEqual([bendingPrice.status, bendingPrice.unit_price, markingPrice.status, markingPrice.unit_price], ['active', 35.5, 'active', 12]);
assert.ok(policyRows.length >= 1, '至少一套委外控制规则已生效');
const policy = policyRows.sort((a, b) => String(b.updated_at || b.created_at || b.id).localeCompare(String(a.updated_at || a.created_at || a.id)))[0];
assert.deepEqual({
  stockAge: policy.stock_age_warning_days,
  overdue: policy.overdue_order_warning_days,
  reconciliationCount: policy.pending_reconciliation_count,
  reconciliationAge: policy.pending_reconciliation_age_days,
  reminder: policy.reminder_interval_days,
  lockDays: policy.issue_lock_days,
  overIssue: [policy.over_issue_control, policy.over_issue_tolerance],
  overReceive: [policy.over_receive_control, policy.over_receive_tolerance],
  admission: policy.supplier_admission_control,
  reconciliation: policy.reconciliation_dimension,
  lossRate: policy.apply_loss_rate_limit,
}, {
  stockAge: 30,
  overdue: 1,
  reconciliationCount: 5,
  reconciliationAge: 15,
  reminder: 7,
  lockDays: 7,
  overIssue: ['block', 1.5],
  overReceive: ['block', 1],
  admission: 'block',
  reconciliation: 'supplier',
  lossRate: false,
});
assert.deepEqual([order.processing_amount, order.issue_planned_quantity], [355, 20]);
assert.equal(issue.status, 'signed');
assert.equal(receipt.status, 'pending_inbound');

const report = {
  suite: 'subcontract-prerequisite-restart-readback',
  endpoint,
  database,
  passed: true,
  verifiedAt: new Date().toISOString(),
  assertion: '同一 SQLite 完整停服重启后，委外供应商能力、两条当前价目、当前控制规则以及订单、发料、回厂结果均按原 ID 回读。',
  ids: { profile: profile.id, bendingPrice: bendingPrice.id, markingPrice: markingPrice.id, policy: policy.id, order: order.id, issue: issue.id, receipt: receipt.id },
};
await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/subcontract-prerequisite-restart-readback.json', `${JSON.stringify(report, null, 2)}\n`);
console.log('PASS subcontract prerequisites and business state survived full server restart');
