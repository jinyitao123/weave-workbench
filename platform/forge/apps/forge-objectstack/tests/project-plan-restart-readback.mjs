import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/project-plan-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true, 'project plan acceptance must pass before restart readback');
const api = await connect();
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id} persisted across restart`);
  return response.value.record;
}
const plan = await read('forge_project_plan', report.ids.plan);
const phase = await read('forge_project_work_item', report.ids.phase);
const milestone = await read('forge_project_work_item', report.ids.milestone);
const task = await read('forge_project_work_item', report.ids.task);
const browserTask = report.ids.browserTask ? await read('forge_project_work_item', report.ids.browserTask) : null;
assert.deepEqual({ project_id: plan.project_id, source: plan.source, revision: plan.revision, status: plan.status, item_count: plan.item_count },
  { project_id: report.ids.project, source: 'manual', revision: 1, status: 'active', item_count: browserTask ? 4 : 3 });
assert.deepEqual({ type: phase.item_type, duration: phase.duration_days, deliverable: phase.planned_deliverable },
  { type: 'phase', duration: 2, deliverable: '项目章程、WBS 初版、风险清单' });
assert.deepEqual({ type: milestone.item_type, parent: milestone.parent_id, duration: milestone.duration_days },
  { type: 'milestone', parent: report.ids.phase, duration: 0 });
assert.deepEqual({ type: task.item_type, parent: task.parent_id, predecessors: task.predecessor_ids, duration: task.duration_days },
  { type: 'task', parent: report.ids.phase, predecessors: [report.ids.milestone], duration: 1 });
if (browserTask) assert.deepEqual(
  { type: browserTask.item_type, parent: browserTask.parent_id, owner: browserTask.owner_id, duration: browserTask.duration_days, critical: browserTask.critical_path },
  { type: 'task', parent: report.ids.phase, owner: report.ids.manager, duration: 2, critical: true },
);
report.restartVerification = { verifiedAt: new Date().toISOString(), status: 'passed', database: '.objectstack/otc-project.sqlite', recordsRead: browserTask ? 5 : 4,
  assertion: browserTask
    ? 'active manual plan plus all four work items, including the browser-created task, survived a full stop/start with exact hierarchy'
    : 'active manual plan plus phase, milestone and task survived a full stop/start with exact hierarchy and predecessor links' };
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS OTC project plan survived full server restart');
