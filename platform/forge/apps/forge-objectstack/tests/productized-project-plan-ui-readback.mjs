import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const api = await connect();
async function find(object, where) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '100' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`);
  return response.value.records.filter(record => Object.entries(where).every(([field, value]) => record[field] === value));
}
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}: ${JSON.stringify(response.value)}`);
  return response.value.record;
}

const [task] = await find('forge_project_work_item', { name: '确认电气接口与现场边界' });
assert.ok(task, 'browser-created plan task must exist');
assert.deepEqual(
  { type: task.item_type, start: task.planned_start_on, end: task.planned_end_on, progress: task.progress, status: task.status, deliverable: task.planned_deliverable, critical: task.critical_path },
  { type: 'task', start: '2026-09-10', end: '2026-09-12', progress: 25, status: 'in_progress', deliverable: '接口边界确认单与现场条件清单', critical: true },
);
assert.ok(task.actual_start_on, 'updating progress must set an actual start date');

const plan = await read('forge_project_plan', task.plan_id);
assert.deepEqual({ item_count: plan.item_count, progress: plan.progress, status: plan.status }, { item_count: 5, progress: 69, status: 'active' });
const [phase] = await find('forge_project_work_item', { plan_id: plan.id, item_type: 'phase' });
assert.equal(phase.progress, 69, 'phase progress must roll up from its four direct children');

const reports = await find('forge_project_daily_report', { work_item_id: task.id });
const report = reports.find(item => item.completed_today === '完成电气接口清单初稿并核对现场供电条件');
assert.ok(report, 'browser-submitted daily report must exist');
assert.deepEqual(
  { progress: report.completion_percent, blockage: report.blockage, assistance: report.assistance_needed, changed: report.expected_finish_changed },
  { progress: 25, blockage: '客户尚未确认现场网络接口', assistance: '请项目经理协调客户技术负责人确认', changed: false },
);

await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/project-plan-productization-report.json', JSON.stringify({
  recordedAt: new Date().toISOString(),
  kind: 'productized-project-plan-browser-and-api-readback',
  passed: true,
  url: `http://localhost:4392/_console/apps/forge/page/page_project_plan_workspace?id=${plan.id}`,
  database: '.objectstack/productization-p2.sqlite',
  ids: { project: plan.project_id, plan: plan.id, phase: phase.id, task: task.id, dailyReport: report.id },
  observed: { planProgress: 69, phaseProgress: 69, itemCount: 5, taskProgress: 25, taskStatus: 'in_progress', dailyReportCount: (await find('forge_project_daily_report', { plan_id: plan.id })).length },
}, null, 2));
console.log('PASS productized project plan task, roll-up and daily report readback');
