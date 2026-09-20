import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4365';
const api = await connect(endpoint);
const stamp = Date.now();
const cases = [];

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`);
  return (response.value.records || []).filter(record => Object.entries(where).every(([key, value]) => record[key] === value));
}
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}: ${JSON.stringify(response.value)}`);
  return response.value.record;
}
async function invoke(object, action, id, params = {}) {
  return api.request(`/actions/${object}/${action}/${id}`, 'POST', { params });
}
function result(response) { return response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value; }
function expectBlocked(response, pattern) {
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(JSON.stringify(response.value), pattern);
}

const project = (await find('forge_project', { status: 'in_progress' }))[0];
assert.ok(project, '需要一条进行中的隔离项目');
const createdPlan = await invoke('forge_project', 'project_create_manual_plan', project.id, {
  phase_name: `安全确认阶段 ${stamp}`, owner_id: project.manager_id,
  planned_start_on: '2026-09-13', planned_end_on: '2026-09-30', weight: 20,
  planned_deliverable: '二次确认与删除阻断验收',
});
assert.equal(createdPlan.status, 200, JSON.stringify(createdPlan.value));
const ids = { plan: result(createdPlan).id, phase: result(createdPlan).phase_id };
async function add(name, item_type = 'task', predecessor_ids = []) {
  const response = await invoke('forge_project_plan', 'project_plan_add_work_item', ids.plan, {
    item_type, name: `${name} ${stamp}`, parent_id: ids.phase, owner_id: project.manager_id,
    planned_start_on: '2026-09-13', planned_end_on: item_type === 'milestone' ? '2026-09-13' : '2026-09-15',
    predecessor_ids, weight: 20, planned_deliverable: `${name}验收结果`,
  });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return result(response).id;
}
ids.milestone = await add('已完成里程碑', 'milestone');
ids.reported = await add('已有日报任务');
ids.predecessor = await add('被依赖任务');
ids.dependent = await add('依赖任务', 'task', [ids.predecessor]);
ids.disposable = await add('可删除任务');

await invoke('forge_project_work_item', 'project_work_item_update_progress', ids.milestone, { progress: 100, status: 'completed' });
await invoke('forge_project_work_item', 'project_work_item_update_progress', ids.reported, { progress: 50, status: 'in_progress' });
await invoke('forge_project_plan', 'project_plan_submit_daily_report', ids.plan, {
  work_item_id: ids.reported, reporter_id: project.manager_id, report_on: '2026-09-13',
  completed_today: '验证已有日报任务不可删除', completion_percent: 50,
});

await test('阶段存在下级工作项时阻止删除', async () => expectBlocked(await invoke('forge_project_work_item', 'project_work_item_delete', ids.phase), /仍有任务或里程碑/));
await test('已完成工作项阻止删除', async () => expectBlocked(await invoke('forge_project_work_item', 'project_work_item_delete', ids.milestone), /已完成工作项不能删除/));
await test('已有日报工作项阻止删除', async () => expectBlocked(await invoke('forge_project_work_item', 'project_work_item_delete', ids.reported), /已有日报记录/));
await test('仍被其他任务作为前置任务时阻止删除', async () => expectBlocked(await invoke('forge_project_work_item', 'project_work_item_delete', ids.predecessor), /前置任务/));
await test('无引用工作项可删除并回算计划和项目进度', async () => {
  const before = await read('forge_project_plan', ids.plan);
  const response = await invoke('forge_project_work_item', 'project_work_item_delete', ids.disposable);
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const deletion = result(response), after = await read('forge_project_plan', ids.plan), projectAfter = await read('forge_project', project.id);
  assert.equal(deletion.deleted, true);
  assert.equal(after.item_count, Number(before.item_count) - 1);
  assert.equal(projectAfter.progress, after.progress);
  const missing = await api.request(`/data/forge_project_work_item/${ids.disposable}`);
  assert.equal(missing.status, 404);
});
await test('阶段进度不被尚未开始的新增任务立即拉低', async () => {
  const phase = await read('forge_project_work_item', ids.phase);
  assert.equal(phase.progress, 75);
});

const failed = cases.filter(item => item.status === 'failed');
console.log(JSON.stringify({ suite: 'project-plan-safety', endpoint, ids, cases }, null, 2));
assert.equal(failed.length, 0, `${failed.length} safety cases failed`);
