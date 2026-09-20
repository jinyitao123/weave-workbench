import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const reportPath = '.objectstack/acceptance/project-full-cost-settlement-report.json';
const report = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(report.passed, true);
const api = await connect(process.env.FORGE_URL || 'http://localhost:4363');
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}`);
  return response.value.record;
}
const project = await read('forge_project', report.ids.project);
const settlement = await read('forge_project_settlement', report.ids.settlement);
const timesheet = await read('forge_project_timesheet', report.ids.timesheet);
const expense = await read('forge_project_expense', report.ids.expense);
const costs = [report.ids.laborCost, ...report.ids.expenseCosts];
for (const id of costs) assert.equal((await read('forge_project_cost_entry', id)).status, 'allocated');
assert.deepEqual({
  project: project.status,
  projectCost: project.total_cost,
  timesheet: timesheet.status,
  expense: expense.status,
  production: settlement.production_cost,
  labor: settlement.labor_cost,
  manufacturing: settlement.manufacturing_cost,
  travel: settlement.travel_cost,
  subcontract: settlement.subcontract_cost,
  other: settlement.other_cost,
  total: settlement.total_cost,
  margin: settlement.gross_margin,
}, {
  project: 'settled',
  projectCost: 33790.0066,
  timesheet: 'approved',
  expense: 'approved',
  production: 32640.0066,
  labor: 200,
  manufacturing: 400,
  travel: 200,
  subcontract: 300,
  other: 50,
  total: 33790.0066,
  margin: 209409.9934,
});
report.restartVerification = { verifiedAt: new Date().toISOString(), status: 'passed', database: process.env.FORGE_DB };
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log('PASS full project cost settlement survived complete restart');
