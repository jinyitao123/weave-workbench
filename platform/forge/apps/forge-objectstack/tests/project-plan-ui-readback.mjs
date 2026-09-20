import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/project-plan-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.restartVerification?.status, 'passed', 'API-created plan must survive restart before browser handling');
const api = await connect();
const query = new URLSearchParams({ $filter: JSON.stringify({ plan_id: report.ids.plan }), $top: '50' });
const response = await api.request(`/data/forge_project_work_item?${query}`);
assert.equal(response.status, 200, 'browser-created plan work item must be readable');
const items = response.value.records.filter(item => item.plan_id === report.ids.plan);
assert.equal(items.length, 4, 'browser action must increase the plan from three to four work items');
const browserTask = items.find(item => item.name === '确认项目范围与边界');
assert.ok(browserTask, 'browser-created task must be present');
assert.deepEqual(
  {
    type: browserTask.item_type, parent: browserTask.parent_id, owner: browserTask.owner_id,
    start: browserTask.planned_start_on, end: browserTask.planned_end_on, duration: browserTask.duration_days,
    weight: browserTask.weight, critical: browserTask.critical_path, deliverable: browserTask.planned_deliverable,
  },
  {
    type: 'task', parent: report.ids.phase, owner: report.ids.manager,
    start: '2026-09-10', end: '2026-09-12', duration: 2,
    weight: 20, critical: true, deliverable: '项目章程、WBS初版、风险清单',
  },
);
report.ids.browserTask = browserTask.id;
report.browserVerification = {
  verifiedAt: new Date().toISOString(), status: 'passed',
  url: `http://localhost:4342/_console/apps/forge/forge_project_plan/record/${report.ids.plan}?tab=related`,
  observed: [
    'native date inputs retained 2026-09-10 and 2026-09-12 before submission',
    'submitting 新增阶段/里程碑/任务 showed 计划工作项已添加',
    'the plan detail changed 工作项数 from 3 to 4',
    'the related list displayed 确认项目范围与边界 as 任务 with status 未开始 and item key suffix :4',
  ],
  limitation: 'RISEMAP first-phase creation is confirmed. Milestone/task hierarchy, predecessor behavior and later plan lifecycle rules still require same-material verification.',
};
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS browser-created project task persisted with all submitted fields');
