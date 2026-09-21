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
const valid = row => !['cancelled', 'voided', 'reversed', 'red_reversed', 'rejected', 'draft'].includes(row.status);
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);

const [contracts, recognitions, projects, costs, expenses, timesheets] = await Promise.all([
  'forge_sales_contract', 'forge_revenue_recognition', 'forge_project',
  'forge_project_cost_entry', 'forge_project_expense', 'forge_project_timesheet',
].map(find));

const activeContracts = contracts.filter(valid);
const approvedRevenue = recognitions.filter(row => row.status === 'approved');
const activeProjects = projects.filter(row => !['terminated', 'archived'].includes(row.status));
const activeCosts = costs.filter(row => row.status !== 'reversed');
const approvedExpenses = expenses.filter(row => ['approved', 'paid'].includes(row.status));
const approvedTimesheets = timesheets.filter(row => row.status === 'approved');
const metrics = {
  contractAmount: sum(activeContracts, 'total_amount'),
  recognizedRevenue: sum(approvedRevenue, 'net_amount'),
  projectCost: sum(activeCosts, 'allocated_amount'),
  expenseAmount: sum(approvedExpenses, 'total_amount'),
  laborAmount: sum(approvedTimesheets, 'cost_amount'),
};

assert.equal(activeContracts.length, 3);
assert.equal(metrics.contractAmount, 729600);
assert.equal(activeProjects.length, 1);
assert.equal(activeProjects[0].contract_amount, 243200);
assert.equal(activeProjects[0].progress, 83);
assert.equal(metrics.recognizedRevenue, 0);
assert.equal(metrics.projectCost, 0);
assert.equal(metrics.laborAmount, 0);

console.log(JSON.stringify({
  suite: 'profit-loss-data', status: 'passed', endpoint,
  counts: { contracts: activeContracts.length, revenueRecognitions: approvedRevenue.length, projects: activeProjects.length, costs: activeCosts.length, expenses: approvedExpenses.length, timesheets: approvedTimesheets.length },
  metrics,
  boundary: '数值来自 Forge 当前持久库；RISEMAP 与 Forge 尚未使用同一组业务材料，不能据此声明双侧业务一致。',
}, null, 2));
