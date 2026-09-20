import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4362';
const database = process.env.FORGE_DB || '.objectstack/otc-project-expense-cost.sqlite';
const api = await connect(endpoint);
const cases = [];
const ids = {};
async function test(name, run) { try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); } catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); } }
async function find(object, where = {}) { const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' }); const response = await api.request(`/data/${object}?${query}`); assert.equal(response.status, 200, object); return (response.value.records || []).filter((record) => Object.entries(where).every(([key, value]) => record[key] === value)); }
async function read(object, id) { const response = await api.request(`/data/${object}/${id}`); assert.equal(response.status, 200, `${object}/${id}`); return response.value.record; }
async function invoke(object, action, id, params = {}, authenticated = true) { return api.request(`/actions/${object}/${action}/${id}`, 'POST', { params }, authenticated); }
const resultOf = (response) => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;

const apiProject = (await find('forge_project', { name: '工时成本 API 验收项目' }))[0];
const browserProject = (await find('forge_project', { name: '工时成本 浏览器验收项目' }))[0];
const settledProject = (await find('forge_project')).find(x => ['settled','terminated','archived'].includes(x.status));
assert.ok(apiProject && browserProject && settledProject);
ids.apiProject = apiProject.id; ids.browserProject = browserProject.id; ids.settledProject = settledProject.id;

const baseParams = { code: 'EXP-API-INVALID', name: '无效费用', claim_type: 'self', beneficiary_id: api.userId, category: 'manufacturing', occurred_on: '2026-09-10', amount: 0, description: '金额无效' };

await test('starts from persisted labor cost projects', async () => {
  assert.deepEqual({ apiStatus: apiProject.status, apiCost: apiProject.total_cost, browserStatus: browserProject.status, browserCost: browserProject.total_cost }, { apiStatus: 'in_progress', apiCost: 1300, browserStatus: 'in_progress', browserCost: 0 });
});

await test('rejects anonymous, zero amount and settled project expense creation', async () => {
  assert.equal((await invoke('forge_project', 'project_create_expense', apiProject.id, baseParams, false)).status, 401);
  const zero = await invoke('forge_project', 'project_create_expense', apiProject.id, baseParams); assert.equal(zero.status, 400); assert.match(JSON.stringify(zero.value), /金额必须大于0/);
  const closed = await invoke('forge_project', 'project_create_expense', settledProject.id, { ...baseParams, code: 'EXP-API-CLOSED', amount: 100 }); assert.equal(closed.status, 400); assert.match(JSON.stringify(closed.value), /不可新增费用/);
});

await test('builds a four-line project expense draft with derived cost types', async () => {
  const created = await invoke('forge_project', 'project_create_expense', apiProject.id, { code: 'EXP-API-20260910-001', name: '项目制造与外部费用', claim_type: 'self', beneficiary_id: api.userId, expected_payment_on: '2026-09-20', category: 'manufacturing', occurred_on: '2026-09-10', amount: 800.25, description: '生产现场设备租赁', invoice_reference: 'INV-EXP-API-001' });
  assert.equal(created.status, 200, JSON.stringify(created.value)); ids.approvedExpense = resultOf(created).id;
  const additions = [
    { category: 'travel', amount: 320.75, description: '客户现场交通住宿', invoice_reference: 'INV-EXP-API-002' },
    { category: 'subcontract', amount: 1500, description: '柜体喷涂外协', invoice_reference: 'INV-EXP-API-003' },
    { category: 'software', amount: 180, description: '项目调试云服务', invoice_reference: 'INV-EXP-API-004' },
  ];
  for (const item of additions) {
    const response = await invoke('forge_project_expense', 'project_expense_add_line', ids.approvedExpense, { ...item, occurred_on: '2026-09-10' });
    assert.equal(response.status, 200, JSON.stringify(response.value));
  }
  const expense = await read('forge_project_expense', ids.approvedExpense), lines = await find('forge_project_expense_line', { expense_id: ids.approvedExpense });
  assert.deepEqual({ status: expense.status, count: expense.line_count, total: expense.total_amount }, { status: 'draft', count: 4, total: 2801 });
  assert.deepEqual(lines.map((line) => line.cost_type).sort(), ['manufacturing', 'other', 'subcontract', 'travel']);
});

await test('submits and rejects an expense without creating project cost', async () => {
  const created = await invoke('forge_project', 'project_create_expense', apiProject.id, { code: 'EXP-API-20260910-REJECT', name: '重复差旅费用', claim_type: 'self', beneficiary_id: api.userId, category: 'travel', occurred_on: '2026-09-10', amount: 500, description: '重复提交待驳回' });
  ids.rejectedExpense = resultOf(created).id;
  assert.equal((await invoke('forge_project_expense', 'project_expense_submit', ids.rejectedExpense)).status, 200);
  assert.equal((await invoke('forge_project_expense', 'project_expense_reject', ids.rejectedExpense, { review_comment: '与已有费用重复' })).status, 200);
  const rejected = await read('forge_project_expense', ids.rejectedExpense), line = (await find('forge_project_expense_line', { expense_id: ids.rejectedExpense }))[0];
  assert.deepEqual({ status: rejected.status, reviewer: rejected.reviewer_id }, { status: 'rejected', reviewer: api.userId });
  assert.equal((await find('forge_project_cost_entry', { source_id: line.id })).length, 0);
});

await test('approves each expense line into the cost pool and project total', async () => {
  assert.equal((await invoke('forge_project_expense', 'project_expense_submit', ids.approvedExpense)).status, 200);
  assert.equal((await invoke('forge_project_expense', 'project_expense_add_line', ids.approvedExpense, { category: 'other', occurred_on: '2026-09-10', amount: 1, description: '提交后追加' })).status, 400);
  const approved = await invoke('forge_project_expense', 'project_expense_approve', ids.approvedExpense, { review_comment: '票据与项目归属核对通过' });
  assert.equal(approved.status, 200, JSON.stringify(approved.value)); ids.apiCostEntries = resultOf(approved).cost_entry_ids;
  assert.deepEqual({ status: resultOf(approved).status, total: resultOf(approved).total_amount, projectCost: resultOf(approved).project_total_cost, count: ids.apiCostEntries.length }, { status: 'approved', total: 2801, projectCost: 4101, count: 4 });
  const expense = await read('forge_project_expense', ids.approvedExpense), project = await read('forge_project', ids.apiProject), costs = await find('forge_project_cost_entry', { project_id: ids.apiProject });
  const expenseCosts = costs.filter((cost) => cost.source_type === 'expense');
  assert.deepEqual({ reviewer: expense.reviewer_id, costCount: expense.cost_entry_count, projectCost: project.total_cost, expenseCost: expenseCosts.reduce((sum, cost) => sum + Number(cost.allocated_amount || 0), 0), types: expenseCosts.map((cost) => cost.cost_type).sort() }, { reviewer: api.userId, costCount: 4, projectCost: 4101, expenseCost: 2801, types: ['manufacturing', 'other', 'subcontract', 'travel'] });
  assert.equal((await invoke('forge_project_expense', 'project_expense_approve', ids.approvedExpense, { review_comment: '重复审核' })).status, 400);
});

await test('keeps the browser project free of pre-created expense records', async () => {
  assert.equal((await find('forge_project_expense', { project_id: ids.browserProject })).length, 0);
  const browserCosts = await find('forge_project_cost_entry', { project_id: ids.browserProject });
  assert.deepEqual(browserCosts.map((cost) => [cost.source_type, cost.cost_type, cost.allocated_amount]), []);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = { recordedAt: new Date().toISOString(), kind: 'forge-project-expense-cost', fixture: 'OEM-RM-20260909-A-project-expense-v0.1', endpoint, database, ids, browserFixture: { projectCode: browserProject.code, projectName: browserProject.name, startingProjectCost: 1760 }, cases, passed: cases.every((item) => item.status === 'passed'), result: { startingLaborCost: 1300, expenseTotal: 2801, finalProjectCost: 4101, costTypes: ['manufacturing', 'travel', 'subcontract', 'other'] }, risemapObserved: { reimbursementFields: ['title', 'claimant', 'ownership', 'related project', 'supplier', 'expected payment date', 'expense category', 'amount', 'description', 'date', 'invoice attachment'], statuses: ['draft', 'pending review', 'reviewing', 'approved', 'rejected', 'paid', 'voided'], costPoolRule: 'approved purchase inbound, production issue and reimbursement records feed the cost pool' }, boundary: 'Forge proves project-owned multi-line expense drafts, submit, reject, approve, per-line cost creation and active project rollup. Payment, loan offset, attachment upload, contract/order/period ownership, post-settlement adjustment and transaction-level atomicity remain unimplemented.' };
await writeFile('.objectstack/acceptance/project-expense-cost-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
