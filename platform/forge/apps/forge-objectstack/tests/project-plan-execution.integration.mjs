import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const planReportPath = '.objectstack/acceptance/project-plan-report.json';
const planReport = JSON.parse(await readFile(planReportPath, 'utf8'));
assert.equal(planReport.restartVerification?.status, 'passed', 'plan structure must pass restart acceptance first');
const api = await connect();
const cases = [];
const ids = { ...planReport.ids };

if (!ids.browserTask) {
  const response = await api.request(`/actions/forge_project_plan/project_plan_add_work_item/${ids.plan}`, 'POST', { params: { item_type: 'task', name: '确认项目范围与边界', parent_id: ids.phase, owner_id: ids.manager, planned_start_on: '2026-09-10', planned_end_on: '2026-09-12', predecessor_ids: [ids.task], weight: 20, critical_path: true, planned_deliverable: '项目范围与边界确认' } });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const created = response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
  ids.browserTask = created.id;
}

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function read(object, id) {
  const result = await api.request(`/data/${object}/${id}`);
  assert.equal(result.status, 200, `${object}/${id}: ${JSON.stringify(result.value)}`);
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

await test('stores two predecessors on the same task used in RISEMAP', async () => {
  const existing = await read('forge_project_work_item', ids.browserTask);
  if (!Array.isArray(existing.predecessor_ids) || existing.predecessor_ids.length !== 2) {
    const response = await api.request(`/data/forge_project_work_item/${ids.browserTask}`, 'PATCH', {
      predecessor_ids: [ids.milestone, ids.task],
    });
    assert.equal(response.status, 200, JSON.stringify(response.value));
  }
  const item = await read('forge_project_work_item', ids.browserTask);
  assert.deepEqual(item.predecessor_ids, [ids.milestone, ids.task]);
});

await test('rejects invalid completion and phase progress edits', async () => {
  const invalid = await invoke('forge_project_work_item', 'project_work_item_update_progress', ids.task, { progress: 50, status: 'completed' });
  assert.equal(invalid.status, 400, JSON.stringify(invalid.value));
  assert.match(JSON.stringify(invalid.value), /完成度必须是 100/);
  const phase = await invoke('forge_project_work_item', 'project_work_item_update_progress', ids.phase, { progress: 20 });
  assert.equal(phase.status, 400, JSON.stringify(phase.value));
  assert.match(JSON.stringify(phase.value), /自动汇总/);
});

await test('replays the observed 100, 100, 50 progress sequence and rolls the phase to 83', async () => {
  for (const [id, progress] of [[ids.milestone, 100], [ids.task, 100], [ids.browserTask, 50]]) {
    const response = await invoke('forge_project_work_item', 'project_work_item_update_progress', id, { progress });
    assert.equal(response.status, 200, JSON.stringify(response.value));
  }
  const milestone = await read('forge_project_work_item', ids.milestone);
  const task = await read('forge_project_work_item', ids.task);
  const activeTask = await read('forge_project_work_item', ids.browserTask);
  const phase = await read('forge_project_work_item', ids.phase);
  const plan = await read('forge_project_plan', ids.plan);
  const today = new Date().toISOString().slice(0, 10);
  assert.deepEqual(
    { progress: milestone.progress, status: milestone.status, start: milestone.actual_start_on, end: milestone.actual_end_on },
    { progress: 100, status: 'completed', start: today, end: today },
  );
  assert.deepEqual({ progress: task.progress, status: task.status, end: task.actual_end_on }, { progress: 100, status: 'completed', end: today });
  assert.deepEqual({ progress: activeTask.progress, status: activeTask.status, start: activeTask.actual_start_on, end: activeTask.actual_end_on },
    { progress: 50, status: 'in_progress', start: today, end: null });
  assert.deepEqual({ progress: phase.progress, status: phase.status }, { progress: 83, status: 'pending' });
  assert.equal(plan.progress, 83);
});

await test('supports the observed delayed status without losing progress', async () => {
  const delayed = await invoke('forge_project_work_item', 'project_work_item_update_progress', ids.browserTask, { progress: 50, status: 'delayed' });
  assert.equal(delayed.status, 200, JSON.stringify(delayed.value));
  assert.deepEqual({ progress: (await read('forge_project_work_item', ids.browserTask)).progress, status: (await read('forge_project_work_item', ids.browserTask)).status },
    { progress: 50, status: 'delayed' });
  const restored = await invoke('forge_project_work_item', 'project_work_item_update_progress', ids.browserTask, { progress: 50, status: 'in_progress' });
  assert.equal(restored.status, 200, JSON.stringify(restored.value));
});

await test('requires a new finish date when a daily report says the expected date changed', async () => {
  const response = await invoke('forge_project_plan', 'project_plan_submit_daily_report', ids.plan, {
    work_item_id: ids.browserTask, reporter_id: ids.manager, report_on: '2026-09-09',
    completed_today: '完成范围边界初稿', completion_percent: 50, expected_finish_changed: true,
  });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(JSON.stringify(response.value), /必须填写调整后的日期/);
});

await test('submits and reads back the observed daily-report fields', async () => {
  const response = await invoke('forge_project_plan', 'project_plan_submit_daily_report', ids.plan, {
    work_item_id: ids.browserTask, reporter_id: ids.manager, report_on: '2026-09-09',
    completed_today: '完成项目范围与边界初稿并与销售订单核对', completion_percent: 50,
    blockage: '待客户确认现场接口边界', assistance_needed: '请项目经理协调客户确认',
    expected_finish_changed: true, expected_finish_on: '2026-09-13',
  });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  ids.dailyReport = actionResult(response).id;
  const report = await read('forge_project_daily_report', ids.dailyReport);
  assert.deepEqual(
    { plan: report.plan_id, item: report.work_item_id, reporter: report.reporter_id, on: report.report_on, progress: report.completion_percent,
      changed: report.expected_finish_changed, finish: report.expected_finish_on },
    { plan: ids.plan, item: ids.browserTask, reporter: ids.manager, on: '2026-09-09', progress: 50, changed: true, finish: '2026-09-13' },
  );
});

await test('rejects anonymous execution actions', async () => {
  assert.equal((await invoke('forge_project_work_item', 'project_work_item_update_progress', ids.task, { progress: 100 }, false)).status, 401);
  assert.equal((await invoke('forge_project_plan', 'project_plan_submit_daily_report', ids.plan, {
    work_item_id: ids.task, reporter_id: ids.manager, report_on: '2026-09-09', completed_today: '匿名日报', completion_percent: 100,
  }, false)).status, 401);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'live-risemap-aligned-project-plan-execution-api-acceptance',
  fixture: 'OEM-RM-20260909-A-project-plan-execution-v0.1', ids, cases,
  passed: cases.every(testCase => testCase.status === 'passed'),
  risemapObserved: {
    progressPresets: [0, 25, 50, 75, 100],
    statuses: ['pending', 'in_progress', 'completed', 'delayed', 'cancelled'],
    automaticTransitions: ['50% => in_progress + actual start today', '100% => completed + actual end today'],
    phaseRollup: 'rounded arithmetic mean of direct non-phase children; parent phase status remains unchanged',
    reproducedSequence: '100%, 100%, 50% => 83%',
    views: ['list', 'gantt', 'progress'],
    dailyReportFields: ['completed_today', 'completion_percent', 'blockage', 'assistance_needed', 'expected_finish_changed', 'attachment <=20MB'],
  },
  boundary: 'Execution state, actual dates, arithmetic progress roll-up, multi-predecessor persistence and daily-report data are implemented. ObjectStack still renders generated grid/record pages; RISEMAP Gantt and combined progress workspace visual parity is not claimed.',
};
await writeFile('.objectstack/acceptance/project-plan-execution-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
