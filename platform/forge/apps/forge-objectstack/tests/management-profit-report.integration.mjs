import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:3001';
const api = await connect(endpoint);
const rowsOf = value => value.records || value.data?.records || value.data || [];
const find = async object => {
  const response = await api.request(`/data/${object}?$top=2000`);
  assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`);
  return rowsOf(response.value);
};

const [versions, recognitions, costs, expenses, timesheets] = await Promise.all([
  'forge_management_profit_report_version', 'forge_revenue_recognition', 'forge_project_cost_entry',
  'forge_project_expense', 'forge_project_timesheet',
].map(find));
const current = versions.filter(row => row.accounting_period === '2026-09').sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)))[0];
assert.ok(current, '应存在 2026-09 管理利润表版本');
assert.equal(current.status, 'closed');
assert.ok(current.closed_at, '关账版本必须记录关账时间');
assert.equal(current.revenue_amount, 0);
assert.equal(current.operating_cost, 0);
assert.equal(current.period_expense, 0);
assert.equal(current.net_profit, 0);
const snapshot = JSON.parse(current.source_snapshot);
assert.deepEqual(snapshot.revenueRecognitionIds, recognitions.filter(row => row.status === 'approved' && String(row.recognition_on || '').startsWith('2026-09')).map(row => row.id));
assert.deepEqual(snapshot.costEntryIds, costs.filter(row => row.status !== 'reversed' && String(row.occurred_on || '').startsWith('2026-09')).map(row => row.id));
assert.deepEqual(snapshot.expenseIds, expenses.filter(row => ['approved', 'paid'].includes(row.status) && String(row.reviewed_at || row.created_at || '').startsWith('2026-09')).map(row => row.id));
assert.deepEqual(snapshot.timesheetIds, timesheets.filter(row => row.status === 'approved' && String(row.work_on || '').startsWith('2026-09')).map(row => row.id));

console.log(JSON.stringify({
  suite: 'management-profit-report', status: 'passed', endpoint,
  version: { id: current.id, code: current.code, period: current.accounting_period, reportStatus: current.status, generatedAt: current.generated_at, closedAt: current.closed_at },
  values: { revenue: current.revenue_amount, operatingCost: current.operating_cost, periodExpense: current.period_expense, netProfit: current.net_profit },
}, null, 2));
