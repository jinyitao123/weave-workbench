import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/project-expense-cost-report.json', report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true);
const api = await connect(process.env.FORGE_URL || 'http://localhost:4362');
async function read(object, id) { const response = await api.request(`/data/${object}/${id}`); assert.equal(response.status, 200, `${object}/${id}`); return response.value.record; }
const approved = await read('forge_project_expense', report.ids.approvedExpense), rejected = await read('forge_project_expense', report.ids.rejectedExpense), project = await read('forge_project', report.ids.apiProject);
const costs = await Promise.all(report.ids.apiCostEntries.map((id) => read('forge_project_cost_entry', id)));
assert.deepEqual({ approved: approved.status, rejected: rejected.status, total: approved.total_amount, costCount: approved.cost_entry_count, projectCost: project.total_cost, allocated: costs.reduce((sum, cost) => sum + Number(cost.allocated_amount || 0), 0), types: costs.map((cost) => cost.cost_type).sort() }, { approved: 'approved', rejected: 'rejected', total: 2801, costCount: 4, projectCost: 4101, allocated: 2801, types: ['manufacturing', 'other', 'subcontract', 'travel'] });
report.restartVerification = { verifiedAt: new Date().toISOString(), status: 'passed', database: process.env.FORGE_DB };
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS project expense and external cost survived full restart');
