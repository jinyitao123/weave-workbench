import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4365';
const planId = process.env.PLAN_ID;
const phaseId = process.env.PHASE_ID;
const projectId = process.env.PROJECT_ID;
const deletedItemId = process.env.DELETED_ITEM_ID;
for (const [name, value] of Object.entries({ PLAN_ID: planId, PHASE_ID: phaseId, PROJECT_ID: projectId, DELETED_ITEM_ID: deletedItemId })) {
  assert.ok(value, `${name} is required`);
}
const api = await connect(endpoint);
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}: ${JSON.stringify(response.value)}`);
  return response.value.record;
}
const [plan, phase, project, deleted] = await Promise.all([
  read('forge_project_plan', planId),
  read('forge_project_work_item', phaseId),
  read('forge_project', projectId),
  api.request(`/data/forge_project_work_item/${deletedItemId}`),
]);
assert.equal(deleted.status, 404, JSON.stringify(deleted.value));
assert.equal(phase.progress, 75);
assert.equal(project.progress, plan.progress);
console.log(JSON.stringify({
  suite: 'project-plan-safety-restart-readback', endpoint,
  persisted: { plan_id: plan.id, plan_progress: plan.progress, item_count: plan.item_count, phase_id: phase.id, phase_progress: phase.progress, project_id: project.id, project_progress: project.progress, deleted_item_id: deletedItemId, deleted_item_status: deleted.status },
}, null, 2));
