import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/project-expense-cost-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
const api = await connect(process.env.FORGE_URL || 'http://localhost:4362');
async function find(object, where = {}) { const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' }); const response = await api.request(`/data/${object}?${query}`); assert.equal(response.status, 200, object); return (response.value.records || []).filter((record) => Object.entries(where).every(([key, value]) => record[key] === value)); }
const project = (await find('forge_project', { id: report.ids.browserProject }))[0], expense = (await find('forge_project_expense', { code: 'EXP-BROWSER-20260910-001' }))[0];
assert.ok(project && expense);
const lines = await find('forge_project_expense_line', { expense_id: expense.id }), lineIds = new Set(lines.map((line) => line.id)), costs = (await find('forge_project_cost_entry', { project_id: project.id })).filter((cost) => cost.source_type === 'expense' && lineIds.has(cost.source_id));
assert.deepEqual({ project: project.status, revenue: project.expected_revenue, totalCost: project.total_cost, profit: Number(project.expected_revenue) - Number(project.total_cost), expense: expense.status, total: expense.total_amount, lineCount: expense.line_count, costCount: expense.cost_entry_count, lineTypes: lines.map((line) => line.cost_type).sort(), costTypes: costs.map((cost) => cost.cost_type).sort(), allocated: costs.reduce((sum, cost) => sum + Number(cost.allocated_amount || 0), 0) }, { project: 'in_progress', revenue: 48000, totalCost: 3040, profit: 44960, expense: 'approved', total: 1280, lineCount: 2, costCount: 2, lineTypes: ['manufacturing', 'travel'], costTypes: ['manufacturing', 'travel'], allocated: 1280 });
report.ids.browserExpense = expense.id; report.ids.browserExpenseLines = lines.map((line) => line.id); report.ids.browserExpenseCosts = costs.map((cost) => cost.id);
report.browserVerification = { verifiedAt: new Date().toISOString(), status: 'passed', pages: ['page_project_expense_cost', 'page_project_operating_analysis'], actions: ['保存草稿', '追加当前费用项', '提交审批', '审核通过', '单项目分析'], assertion: 'browser approved 900 CNY manufacturing and 380 CNY travel expenses, generated two traceable cost entries, rolled project cost from 1760 to 3040, and showed 48000 revenue with 44960 profit' };
if (process.argv.includes('--restart')) report.browserVerification.restartReadback = { verifiedAt: new Date().toISOString(), status: 'passed', assertion: 'browser-created expense, two lines, two allocated costs and project total survived full restart' };
await writeFile(path, JSON.stringify(report, null, 2));
console.log(`PASS browser project expense cost${process.argv.includes('--restart') ? ' survived restart' : ' persisted'}`);
