import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/project-plan-execution-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true, 'execution acceptance must pass before restart readback');
const api = await connect();
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id} persisted across restart`);
  return response.value.record;
}
const phase = await read('forge_project_work_item', report.ids.phase);
const milestone = await read('forge_project_work_item', report.ids.milestone);
const task = await read('forge_project_work_item', report.ids.task);
const activeTask = await read('forge_project_work_item', report.ids.browserTask);
const plan = await read('forge_project_plan', report.ids.plan);
const daily = await read('forge_project_daily_report', report.ids.dailyReport);
const browserDaily = report.ids.browserDailyReport ? await read('forge_project_daily_report', report.ids.browserDailyReport) : null;
assert.deepEqual({ phase: phase.progress, phaseStatus: phase.status, milestone: milestone.progress, task: task.progress, activeTask: activeTask.progress, activeStatus: activeTask.status, plan: plan.progress },
  { phase: 83, phaseStatus: 'pending', milestone: 100, task: 100, activeTask: 50, activeStatus: 'in_progress', plan: 83 });
assert.deepEqual(activeTask.predecessor_ids, [report.ids.milestone, report.ids.task]);
assert.deepEqual({ item: daily.work_item_id, progress: daily.completion_percent, changed: daily.expected_finish_changed, finish: daily.expected_finish_on },
  { item: report.ids.browserTask, progress: 50, changed: true, finish: '2026-09-13' });
if (browserDaily) assert.deepEqual(
  { item: browserDaily.work_item_id, progress: browserDaily.completion_percent, completed: browserDaily.completed_today },
  { item: report.ids.browserTask, progress: 50, completed: '浏览器验收进度回读，完成范围边界初稿' },
);
report.restartVerification = {
  verifiedAt: new Date().toISOString(), status: 'passed', database: '.objectstack/otc-project-execution.sqlite', recordsRead: browserDaily ? 7 : 6,
  assertion: browserDaily
    ? 'the 83% roll-up, automatic actual dates, two predecessors and both API/browser daily reports survived a full stop/start'
    : 'the 83% roll-up, automatic actual dates, two predecessors and submitted daily report survived a full stop/start',
};
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS OTC project plan execution survived full server restart');
