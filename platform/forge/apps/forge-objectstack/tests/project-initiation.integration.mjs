import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const sales = JSON.parse(await readFile('.objectstack/acceptance/sales-workflow-report.json', 'utf8'));
assert.equal(sales.passed, true, 'sales workflow acceptance must pass before project initiation');
const registry = JSON.parse(await readFile('.objectstack/acceptance/reference-data.json', 'utf8'));
const fixture = Object.fromEntries(registry.results.map(result => [result.key, result.id]));
const api = await connect();
const cases = [];
const ids = { customer: fixture.customer, contract: sales.ids.contract, order: sales.ids.order, manager: api.userId };

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function read(object, id) {
  const result = await api.request(`/data/${object}/${id}`);
  assert.equal(result.status, 200, `${object} read: ${JSON.stringify(result.value)}`);
  return result.value.record;
}
async function find(object, where) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '50' });
  const result = await api.request(`/data/${object}?${query}`);
  assert.equal(result.status, 200, `${object} find`);
  return result.value.records.filter(record => Object.entries(where).every(([field, value]) => record[field] === value));
}
async function invoke(object, action, id, params = {}, authenticated = true) {
  return api.request(`/actions/${object}/${action}/${id}`, 'POST', { params }, authenticated);
}
function actionResult(response) { return response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value; }

try {
  const previous = JSON.parse(await readFile('.objectstack/acceptance/project-initiation-report.json', 'utf8'));
  for (const link of await find('forge_project_sales_link', { project_id: previous.ids.project })) await api.request(`/data/forge_project_sales_link/${link.id}`, 'DELETE');
  for (const member of await find('forge_project_member', { project_id: previous.ids.project })) await api.request(`/data/forge_project_member/${member.id}`, 'DELETE');
  if (previous.ids.project) await api.request(`/data/forge_project/${previous.ids.project}`, 'DELETE');
  if (previous.ids.type) await api.request(`/data/forge_project_type/${previous.ids.type}`, 'DELETE');
} catch {}

await test('creates the CABINET_OTC project type observed in RISEMAP', async () => {
  const result = await api.request('/data/forge_project_type', 'POST', { name: '标准柜机项目', code: 'CABINET_OTC', color: '#2563EB', active: true });
  assert.equal(result.status, 201, JSON.stringify(result.value));
  ids.type = result.value.id || result.value.record?.id;
});

await test('rejects a project whose planned end precedes planned start', async () => {
  const result = await api.request('/data/forge_project', 'POST', {
    name: '错误日期项目', type_id: ids.type, customer_id: ids.customer, manager_id: ids.manager,
    planned_start_on: '2026-12-31', planned_end_on: '2026-09-10', expected_revenue: 0, budget_amount: 0,
  });
  assert.equal(result.status, 400, JSON.stringify(result.value));
  assert.match(JSON.stringify(result.value), /计划结束日期不得早于计划开始日期/);
});

await test('creates one pending project and its manager from the customer action', async () => {
  const response = await invoke('forge_customer', 'customer_create_project', ids.customer, {
    name: '800型柔性线控制柜交付项目', type_id: ids.type, priority: 'medium',
    planned_start_on: '2026-09-10', planned_end_on: '2026-12-31', expected_revenue: 243200, budget_amount: 180000,
    manager_id: ids.manager, description: 'OEM-RM-20260909-A：标准柜机从立项、设计、采购制造、调试验收到回款的同步对照项目。',
  });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  ids.project = actionResult(response).id;
  const project = await read('forge_project', ids.project);
  assert.match(project.code, /^PRJ-2026-\d{3}$/);
  assert.deepEqual({ status: project.status, customer_id: project.customer_id, manager_id: project.manager_id, expected_revenue: project.expected_revenue, budget_amount: project.budget_amount },
    { status: 'pending', customer_id: ids.customer, manager_id: ids.manager, expected_revenue: 243200, budget_amount: 180000 });
  const members = await find('forge_project_member', { project_id: ids.project });
  assert.equal(members.length, 1); ids.member = members[0].id;
  assert.deepEqual({ user_id: members[0].user_id, member_duty: members[0].member_duty, active: members[0].active },
    { user_id: ids.manager, member_duty: 'manager', active: true });
});

await test('starts the project without requiring a plan, matching live RISEMAP', async () => {
  const response = await invoke('forge_project', 'project_start', ids.project);
  assert.equal(response.status, 200, JSON.stringify(response.value));
  assert.equal(actionResult(response).status, 'in_progress');
  const project = await read('forge_project', ids.project);
  assert.equal(project.status, 'in_progress');
  assert.equal(project.actual_start_on, new Date().toISOString().slice(0, 10));
});

await test('links a contract and automatically brings in all eligible orders', async () => {
  const response = await invoke('forge_project', 'project_link_contract', ids.project, { contract_id: ids.contract });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const result = actionResult(response);
  assert.deepEqual({ order_count: result.order_count, contract_amount: result.contract_amount, invoice_amount: result.invoice_amount, collected_amount: result.collected_amount },
    { order_count: 1, contract_amount: 243200, invoice_amount: 0, collected_amount: 0 });
  const links = await find('forge_project_sales_link', { project_id: ids.project });
  assert.equal(links.length, 1); ids.link = links[0].id;
  assert.deepEqual({ contract_id: links[0].contract_id, order_id: links[0].order_id, order_amount: links[0].order_amount },
    { contract_id: ids.contract, order_id: ids.order, order_amount: 243200 });
  const project = await read('forge_project', ids.project);
  assert.deepEqual({ contract_amount: project.contract_amount, invoice_amount: project.invoice_amount, collected_amount: project.collected_amount },
    { contract_amount: 243200, invoice_amount: 0, collected_amount: 0 });
});

await test('relinking the same contract refreshes rather than duplicates the order link', async () => {
  const response = await invoke('forge_project', 'project_link_contract', ids.project, { contract_id: ids.contract });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  assert.equal((await find('forge_project_sales_link', { project_id: ids.project })).length, 1);
});

await test('supports pause and resume while preserving project links', async () => {
  assert.equal((await invoke('forge_project', 'project_pause', ids.project, { pause_reason: '计划基线调整' })).status, 200);
  assert.equal((await read('forge_project', ids.project)).status, 'paused');
  assert.equal((await invoke('forge_project', 'project_resume', ids.project)).status, 200);
  const project = await read('forge_project', ids.project);
  assert.equal(project.status, 'in_progress');
  assert.equal(project.contract_amount, 243200);
});

await test('rejects duplicate start and anonymous project access', async () => {
  const duplicate = await invoke('forge_project', 'project_start', ids.project);
  assert.equal(duplicate.status, 400, JSON.stringify(duplicate.value));
  assert.match(duplicate.value.error.message, /仅待执行项目/);
  assert.equal((await api.request('/data/forge_project', 'GET', undefined, false)).status, 401);
  assert.equal((await invoke('forge_project', 'project_pause', ids.project, { pause_reason: 'unauthorized' }, false)).status, 401);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'live-risemap-aligned-project-initiation-api-acceptance',
  fixture: 'OEM-RM-20260909-A-project-initiation-v0.1', ids, cases,
  passed: cases.every(testCase => testCase.status === 'passed'),
  risemapObserved: {
    project: 'PRJ-2026-001', status: 'in_progress', type: 'CABINET_OTC', managerCount: 1,
    contract: 'SC-OEM-20260909-001', linkedOrderCount: 1, contractAmount: 243200, receivable: 243200,
    rule: 'A project may start without a plan. Starting freezes basic project editing while plan, task and team details remain manageable.',
  },
  boundary: 'This acceptance covers the first sequential OTC stage only: project type, initiation, manager membership, start, pause/resume and sales contract/order linkage. Project plan is the next stage.',
};
await writeFile('.objectstack/acceptance/project-initiation-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
