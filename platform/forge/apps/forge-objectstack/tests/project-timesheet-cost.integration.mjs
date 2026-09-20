import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4361';
const database = process.env.FORGE_DB || '.objectstack/otc-project-timesheet-cost.sqlite';
const api = await connect(endpoint);
const cases = [];
const ids = { manager: api.userId };
async function test(name, run) { try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); } catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); } }
async function find(object, where = {}) { const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' }); const response = await api.request(`/data/${object}?${query}`); assert.equal(response.status, 200, object); return (response.value.records || []).filter((record) => Object.entries(where).every(([key, value]) => record[key] === value)); }
async function read(object, id) { const response = await api.request(`/data/${object}/${id}`); assert.equal(response.status, 200, `${object}/${id}`); return response.value.record; }
async function invoke(object, action, id, params = {}, authenticated = true) { return api.request(`/actions/${object}/${action}/${id}`, 'POST', { params }, authenticated); }
const resultOf = (response) => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;

const customer = (await find('forge_customer'))[0];
const type = (await find('forge_project_type', { code: 'CABINET_OTC' }))[0];
assert.ok(customer && type);
let settled = (await find('forge_project')).find(x => ['settled','terminated','archived'].includes(x.status));
if (!settled) {
  const created = await invoke('forge_customer', 'customer_create_project', customer.id, { name: '工时成本关闭项目', type_id: type.id, priority: 'low', planned_start_on: '2026-09-10', planned_end_on: '2026-10-10', expected_revenue: 10000, budget_amount: 5000, manager_id: api.userId, description: '关闭项目边界验收' });
  assert.equal(created.status, 200, JSON.stringify(created.value));
  const closedId = resultOf(created).id;
  assert.equal((await invoke('forge_project', 'project_start', closedId)).status, 200);
  assert.equal((await invoke('forge_project', 'project_terminate', closedId, { termination_reason: '工时关闭项目边界验收' })).status, 200);
  settled = await read('forge_project', closedId);
}
ids.customer = customer.id; ids.type = type.id; ids.settledProject = settled.id;

async function createProject(name, expectedRevenue) {
  const created = await invoke('forge_customer', 'customer_create_project', customer.id, { name, type_id: type.id, priority: 'medium', planned_start_on: '2026-09-10', planned_end_on: '2026-10-10', expected_revenue: expectedRevenue, budget_amount: expectedRevenue / 2, manager_id: api.userId, description: '工时与人工成本隔离验收项目' });
  assert.equal(created.status, 200, JSON.stringify(created.value));
  const id = resultOf(created).id;
  assert.equal((await invoke('forge_project', 'project_start', id)).status, 200);
  return id;
}

await test('prepares independent active projects for API and browser acceptance', async () => {
  ids.apiProject = await createProject('工时成本 API 验收项目', 60000);
  ids.browserProject = await createProject('工时成本 浏览器验收项目', 48000);
  assert.deepEqual([(await read('forge_project', ids.apiProject)).status, (await read('forge_project', ids.browserProject)).status], ['in_progress', 'in_progress']);
});

await test('rejects anonymous, invalid-hour and settled-project time entry', async () => {
  const params = { code: 'TS-API-INVALID', worker_id: api.userId, work_on: '2026-09-10', work_content: '无效工时', time_type: 'normal', hours: 25, hourly_rate: 200 };
  assert.equal((await invoke('forge_project', 'project_record_timesheet', ids.apiProject, params, false)).status, 401);
  const invalid = await invoke('forge_project', 'project_record_timesheet', ids.apiProject, params); assert.equal(invalid.status, 400); assert.match(JSON.stringify(invalid.value), /0.25至24小时/);
  const closed = await invoke('forge_project', 'project_record_timesheet', settled.id, { ...params, code: 'TS-API-CLOSED', hours: 1 }); assert.equal(closed.status, 400); assert.match(JSON.stringify(closed.value), /不可填报工时/);
});

await test('saves a priced project timesheet draft and submits it for review', async () => {
  const response = await invoke('forge_project', 'project_record_timesheet', ids.apiProject, { code: 'TS-API-20260910-001', worker_id: api.userId, work_on: '2026-09-10', work_content: 'PLC 程序联调', time_type: 'normal', hours: 6.5, hourly_rate: 200, remarks: 'API 工时验收' });
  assert.equal(response.status, 200, JSON.stringify(response.value)); ids.approvedTimesheet = resultOf(response).id;
  assert.deepEqual({ status: resultOf(response).status, hours: resultOf(response).hours, rate: resultOf(response).hourly_rate, cost: resultOf(response).cost_amount }, { status: 'draft', hours: 6.5, rate: 200, cost: 1300 });
  assert.equal((await invoke('forge_project_timesheet', 'project_timesheet_submit', ids.approvedTimesheet)).status, 200);
  assert.equal((await read('forge_project_timesheet', ids.approvedTimesheet)).status, 'pending_review');
});

await test('rejects a submitted timesheet without creating project cost', async () => {
  const response = await invoke('forge_project', 'project_record_timesheet', ids.apiProject, { code: 'TS-API-20260910-REJECT', worker_id: api.userId, work_on: '2026-09-10', work_content: '重复填报待驳回', time_type: 'overtime', hours: 2, hourly_rate: 300 });
  ids.rejectedTimesheet = resultOf(response).id;
  assert.equal((await invoke('forge_project_timesheet', 'project_timesheet_submit', ids.rejectedTimesheet)).status, 200);
  const rejected = await invoke('forge_project_timesheet', 'project_timesheet_reject', ids.rejectedTimesheet, { review_comment: '与已提交记录重复' }); assert.equal(rejected.status, 200);
  const rejectedRecord = await read('forge_project_timesheet', ids.rejectedTimesheet);
  assert.deepEqual({ status: rejectedRecord.status, reviewer: rejectedRecord.reviewer_id }, { status: 'rejected', reviewer: api.userId });
  assert.equal((await find('forge_project_cost_entry', { source_id: ids.rejectedTimesheet })).length, 0);
});

await test('approves valid time into the labor cost pool and project total', async () => {
  const approved = await invoke('forge_project_timesheet', 'project_timesheet_approve', ids.approvedTimesheet, { review_comment: '工时与项目任务一致' }); assert.equal(approved.status, 200, JSON.stringify(approved.value));
  ids.costEntry = resultOf(approved).cost_entry_id;
  assert.deepEqual({ status: resultOf(approved).status, cost: resultOf(approved).cost_amount, projectCost: resultOf(approved).project_total_cost }, { status: 'approved', cost: 1300, projectCost: 1300 });
  const cost = await read('forge_project_cost_entry', ids.costEntry), project = await read('forge_project', ids.apiProject), timesheet = await read('forge_project_timesheet', ids.approvedTimesheet);
  assert.deepEqual({ source: cost.source_type, type: cost.cost_type, total: cost.total_amount, allocated: cost.allocated_amount, remaining: cost.remaining_amount, status: cost.status, projectCost: project.total_cost, reviewer: timesheet.reviewer_id }, { source: 'timesheet', type: 'labor', total: 1300, allocated: 1300, remaining: 0, status: 'allocated', projectCost: 1300, reviewer: api.userId });
  assert.equal((await invoke('forge_project_timesheet', 'project_timesheet_approve', ids.approvedTimesheet, { review_comment: '重复' })).status, 400);
});

await test('keeps the browser fixture free of pre-created time or cost records', async () => {
  assert.equal((await find('forge_project_timesheet', { project_id: ids.browserProject })).length, 0);
  assert.equal((await find('forge_project_cost_entry', { project_id: ids.browserProject })).length, 0);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const browserProject = await read('forge_project', ids.browserProject);
const report = { recordedAt: new Date().toISOString(), kind: 'forge-project-timesheet-labor-cost', fixture: 'OEM-RM-20260909-A-project-timesheet-v0.1', endpoint, database, ids, browserFixture: { projectCode: browserProject.code, projectName: browserProject.name }, cases, passed: cases.every((item) => item.status === 'passed'), result: { approvedHours: 6.5, hourlyRate: 200, laborCost: 1300, rejectedHours: 2 }, risemapObserved: { fields: ['work order', 'date', 'worker', 'project', 'content', 'hours', 'type', 'rate', 'cost', 'status'], statuses: ['pending review', 'approved', 'rejected'], costRule: 'approved business records feed cost collection; project time connects project execution, people utilization, review and labor cost' }, boundary: 'Forge proves project time draft, submit, reject, approve, labor cost creation and project rollup. Role-rate configuration, salary-derived rates, batch entry, idle/non-project time, post-settlement adjustments and transaction-level atomicity remain unimplemented.' };
await writeFile('.objectstack/acceptance/project-timesheet-cost-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
