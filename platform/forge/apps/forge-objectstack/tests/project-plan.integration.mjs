import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const initiation = JSON.parse(await readFile('.objectstack/acceptance/project-initiation-report.json', 'utf8'));
assert.equal(initiation.browserVerification?.status || (initiation.passed ? 'passed' : undefined), 'passed', 'project browser actions must pass before project plan acceptance');
const api = await connect();
const cases = [];
const ids = { project: initiation.ids.project, manager: initiation.ids.manager };

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
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '100' });
  const result = await api.request(`/data/${object}?${query}`);
  assert.equal(result.status, 200, `${object} find`);
  return result.value.records.filter(record => Object.entries(where).every(([field, value]) => record[field] === value));
}
async function invoke(object, action, id, params = {}, authenticated = true) {
  return api.request(`/actions/${object}/${action}/${id}`, 'POST', { params }, authenticated);
}
function actionResult(response) { return response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value; }

for (const plan of await find('forge_project_plan', { project_id: ids.project })) {
  for (const item of await find('forge_project_work_item', { plan_id: plan.id })) await api.request(`/data/forge_project_work_item/${item.id}`, 'DELETE');
  await api.request(`/data/forge_project_plan/${plan.id}`, 'DELETE');
}

await test('rejects an inverted first-phase date range before creating a plan', async () => {
  const response = await invoke('forge_project', 'project_create_manual_plan', ids.project, {
    phase_name: '错误阶段', owner_id: ids.manager,
    planned_start_on: '2026-09-12', planned_end_on: '2026-09-10', weight: 20,
  });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(JSON.stringify(response.value), /计划结束日期不得早于计划开始日期/);
});

await test('creates a manual plan and its first phase from the running project', async () => {
  const response = await invoke('forge_project', 'project_create_manual_plan', ids.project, {
    phase_name: '项目启动与计划', owner_id: ids.manager,
    planned_start_on: '2026-09-10', planned_end_on: '2026-09-12', weight: 20, critical_path: true,
    planned_deliverable: '项目章程、WBS 初版、风险清单',
  });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const result = actionResult(response); ids.plan = result.id; ids.phase = result.phase_id;
  const plan = await read('forge_project_plan', ids.plan);
  assert.deepEqual({ project_id: plan.project_id, source: plan.source, revision: plan.revision, status: plan.status, item_count: plan.item_count },
    { project_id: ids.project, source: 'manual', revision: 1, status: 'active', item_count: 1 });
  const phase = await read('forge_project_work_item', ids.phase);
  assert.deepEqual({ item_type: phase.item_type, parent_id: phase.parent_id, owner_id: phase.owner_id, duration_days: phase.duration_days, weight: phase.weight, critical_path: phase.critical_path },
    { item_type: 'phase', parent_id: null, owner_id: ids.manager, duration_days: 2, weight: 20, critical_path: true });
});

await test('rejects a second active plan for the same project', async () => {
  const response = await invoke('forge_project', 'project_create_manual_plan', ids.project, {
    phase_name: '重复阶段', planned_start_on: '2026-09-10', planned_end_on: '2026-09-11',
  });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(JSON.stringify(response.value), /已经存在执行中的计划/);
});

await test('adds a milestone under the observed phase structure', async () => {
  const response = await invoke('forge_project_plan', 'project_plan_add_work_item', ids.plan, {
    item_type: 'milestone', name: '项目计划确认', parent_id: ids.phase, owner_id: ids.manager,
    planned_start_on: '2026-09-12', planned_end_on: '2026-09-12', weight: 20, critical_path: true,
    planned_deliverable: '已确认的项目计划',
  });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  ids.milestone = actionResult(response).id;
  const item = await read('forge_project_work_item', ids.milestone);
  assert.deepEqual({ item_type: item.item_type, parent_id: item.parent_id, duration_days: item.duration_days, status: item.status },
    { item_type: 'milestone', parent_id: ids.phase, duration_days: 0, status: 'pending' });
});

await test('adds a task with a same-plan predecessor', async () => {
  const response = await invoke('forge_project_plan', 'project_plan_add_work_item', ids.plan, {
    item_type: 'task', name: '召开项目启动会', parent_id: ids.phase, owner_id: ids.manager,
    planned_start_on: '2026-09-10', planned_end_on: '2026-09-11', predecessor_ids: [ids.milestone],
    weight: 20, critical_path: true, planned_deliverable: '启动会纪要与行动项',
  });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  ids.task = actionResult(response).id;
  const task = await read('forge_project_work_item', ids.task);
  assert.deepEqual({ item_type: task.item_type, parent_id: task.parent_id, predecessor_ids: task.predecessor_ids, duration_days: task.duration_days },
    { item_type: 'task', parent_id: ids.phase, predecessor_ids: [ids.milestone], duration_days: 1 });
  assert.equal((await read('forge_project_plan', ids.plan)).item_count, 3);
});

await test('rejects a nested phase and duplicate work-item name', async () => {
  const nested = await invoke('forge_project_plan', 'project_plan_add_work_item', ids.plan, {
    item_type: 'phase', name: '错误嵌套阶段', parent_id: ids.phase, planned_start_on: '2026-09-10', planned_end_on: '2026-09-11',
  });
  assert.equal(nested.status, 400, JSON.stringify(nested.value));
  assert.match(JSON.stringify(nested.value), /阶段必须是顶层工作项/);
  const duplicate = await invoke('forge_project_plan', 'project_plan_add_work_item', ids.plan, {
    item_type: 'task', name: '召开项目启动会', parent_id: ids.phase, planned_start_on: '2026-09-10', planned_end_on: '2026-09-11',
  });
  assert.equal(duplicate.status, 400, JSON.stringify(duplicate.value));
  assert.match(JSON.stringify(duplicate.value), /同名工作项/);
  const phasePredecessor = await invoke('forge_project_plan', 'project_plan_add_work_item', ids.plan, {
    item_type: 'task', name: '错误前置阶段', parent_id: ids.phase, predecessor_ids: [ids.phase], planned_start_on: '2026-09-10', planned_end_on: '2026-09-11',
  });
  assert.equal(phasePredecessor.status, 400, JSON.stringify(phasePredecessor.value));
  assert.match(JSON.stringify(phasePredecessor.value), /当前计划中的任务或里程碑/);
});

await test('rejects anonymous plan reads and actions', async () => {
  assert.equal((await api.request('/data/forge_project_plan', 'GET', undefined, false)).status, 401);
  assert.equal((await invoke('forge_project_plan', 'project_plan_add_work_item', ids.plan, {
    item_type: 'task', name: '匿名任务', planned_start_on: '2026-09-10', planned_end_on: '2026-09-11',
  }, false)).status, 401);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'live-risemap-aligned-project-plan-api-acceptance',
  fixture: 'OEM-RM-20260909-A-project-plan-v0.1', ids, cases,
  passed: cases.every(testCase => testCase.status === 'passed'),
  risemapObserved: {
    project: 'PRJ-2026-001', planInitiallyAbsent: true, systemTemplateCount: 0, customTemplateCount: 0,
    startModes: ['system_template', 'custom_template', 'copied_project', 'manual'],
    itemTypes: ['phase', 'milestone', 'task'],
    fields: ['name', 'parent_phase', 'owner', 'planned_start', 'planned_end', 'duration_days', 'predecessor', 'weight', 'critical_path', 'planned_deliverable'],
    submittedFirstPhase: { name: '项目启动与计划', owner: '金一涛', planned_start_on: '2026-09-10', planned_end_on: '2026-09-12', duration_days: 2, weight: 20, critical_path: true, status: 'pending' },
    submittedMilestone: { name: '项目计划确认', parent: '项目启动与计划', owner: '金一涛', planned_start_on: '2026-09-12', planned_end_on: '2026-09-12', duration_display: '-', weight: 20, critical_path: true, status: 'pending' },
    submittedTask: { name: '召开项目启动会', parent: '项目启动与计划', owner: '金一涛', planned_start_on: '2026-09-10', planned_end_on: '2026-09-11', duration_days: 1, predecessors: ['项目计划确认'], weight: 20, critical_path: true, status: 'pending' },
    predecessorControl: 'checkbox multi-select',
  },
  pendingRisemapVerification: 'The phase, milestone, task hierarchy, single selected predecessor and duration rules are confirmed in RISEMAP. Multiple predecessors, later status transitions and plan lifecycle still require verification.',
  boundary: 'This slice implements the observed manual plan structure only. Template application, baselines, plan revisions, task execution, progress roll-up and change approval are not claimed.',
};
await writeFile('.objectstack/acceptance/project-plan-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
