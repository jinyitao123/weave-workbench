import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/project-plan-execution-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.restartVerification?.status, 'passed', 'API execution state must survive restart before browser acceptance');
const api = await connect();
async function find(object, where) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '100' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object} find`);
  return response.value.records.filter(record => Object.entries(where).every(([field, value]) => record[field] === value));
}
const items = await find('forge_project_work_item', { plan_id: report.ids.plan });
const task = items.find(item => item.id === report.ids.browserTask);
assert.ok(task, 'browser-tested task must remain readable');
assert.deepEqual(
  { predecessors: task.predecessor_ids, progress: task.progress, status: task.status, actualStart: task.actual_start_on },
  { predecessors: [report.ids.milestone, report.ids.task], progress: 50, status: 'in_progress', actualStart: new Date().toISOString().slice(0, 10) },
);
const dailyReports = await find('forge_project_daily_report', { plan_id: report.ids.plan });
const browserDaily = dailyReports.find(item => item.completed_today === '浏览器验收进度回读，完成范围边界初稿');
assert.ok(browserDaily, 'browser-submitted daily report must be readable');
assert.deepEqual(
  { item: browserDaily.work_item_id, reporter: browserDaily.reporter_id, on: browserDaily.report_on, progress: browserDaily.completion_percent,
    blockage: browserDaily.blockage, assistance: browserDaily.assistance_needed, changed: browserDaily.expected_finish_changed },
  { item: report.ids.browserTask, reporter: report.ids.manager, on: '2026-09-09', progress: 50,
    blockage: '待客户确认现场接口边界', assistance: '请项目经理协调确认', changed: false },
);
report.ids.browserDailyReport = browserDaily.id;
report.browserVerification = {
  verifiedAt: new Date().toISOString(), status: 'passed',
  taskUrl: `http://localhost:4343/_console/apps/forge/forge_project_work_item/record/${report.ids.browserTask}`,
  dailyReportUrl: `http://localhost:4343/_console/apps/forge/forge_project_daily_report/record/${browserDaily.id}`,
  observed: [
    'task detail displayed both predecessors, 50.00 progress, in-progress status and actual start today',
    '更新进度 submitted 50 and in-progress and showed 工作项进度已更新',
    'plan detail displayed 83.00 progress after the 100, 100, 50 sequence',
    '提交日报 accepted the observed fields and showed 项目日报已提交',
    'related records showed two daily reports and the browser-created report detail read back its task, reporter, date, 50%, completed content, blockage and assistance',
  ],
  limitation: 'Generated ObjectStack record/list pages expose the behavior and data. RISEMAP-style Gantt bars and the combined progress workspace are not rendered in this slice.',
};
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS browser progress action and daily-report submission persisted');
