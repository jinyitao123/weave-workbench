import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4320';
const database = process.env.FORGE_DB || '.objectstack/acceptance/project-settings-template.sqlite';
const api = await connect(endpoint);
const cases = [];
const ids = {};
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`);
  return response.value.records || [];
}
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}: ${JSON.stringify(response.value)}`);
  return response.value.record;
}
async function invoke(object, action, id, params = {}) {
  return api.request(`/actions/${object}/${action}/${id}`, 'POST', { params });
}
const resultOf = (response) => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;

const sourceProject = (await find('forge_project', { code: 'PRJ-2026-001' }))[0];
const sourcePlan = (await find('forge_project_plan', { project_id: sourceProject?.id, status: 'active' }))[0];
assert.ok(sourceProject && sourcePlan, 'source project and active plan are required');
const sourceItems = await find('forge_project_work_item', { plan_id: sourcePlan.id });
assert.ok(sourceItems.length, 'source plan must contain work items');
ids.sourceProject = sourceProject.id;
ids.sourcePlan = sourcePlan.id;

await test('saves the active plan as a reusable template', async () => {
  const response = await invoke('forge_project_plan', 'project_plan_save_as_template', sourcePlan.id, { template_name: `项目配置中心模板验收-${stamp}`, category: 'custom' });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const result = resultOf(response);
  assert.ok(result.id);
  ids.template = result.id;
  assert.equal(result.item_count, sourceItems.length);
});

await test('blocks applying a template to a plan that already has work items', async () => {
  const response = await invoke('forge_project_plan', 'project_plan_apply_template', sourcePlan.id, { template_id: ids.template });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(JSON.stringify(response.value), /当前计划已有工作项/);
});

await test('applies the template to an empty execution plan', async () => {
  const targetProject = (await find('forge_project', { code: 'PRJ-2026-003' }))[0] || (await find('forge_project', { code: 'PRJ-2026-004' }))[0];
  assert.ok(targetProject, 'an in-progress target project is required');
  const created = await api.request('/data/forge_project_plan', 'POST', {
    name: `${targetProject.name} 模板套用验收`, plan_key: `${targetProject.id}:SETTINGS-${stamp}`, project_id: targetProject.id,
    source: 'manual', revision: 1, planned_start_on: '2026-09-10', planned_end_on: '2026-09-12',
    status: 'active', item_count: 0, progress: 0, remarks: '项目配置中心模板链验收',
  });
  assert.equal(created.status, 201, JSON.stringify(created.value));
  ids.targetPlan = created.value.id || created.value.record?.id;
  assert.ok(ids.targetPlan);
  const applied = await invoke('forge_project_plan', 'project_plan_apply_template', ids.targetPlan, { template_id: ids.template });
  assert.equal(applied.status, 200, JSON.stringify(applied.value));
  const result = resultOf(applied);
  assert.equal(result.item_count, sourceItems.length);
  const plan = await read('forge_project_plan', ids.targetPlan);
  assert.equal(plan.source, 'custom_template');
  assert.equal(Number(plan.item_count), sourceItems.length);
  assert.equal((await find('forge_project_work_item', { plan_id: ids.targetPlan })).length, sourceItems.length);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'forge-project-settings-template-chain', endpoint, database, ids, cases,
  passed: cases.every((item) => item.status === 'passed'),
  result: { sourceItemCount: sourceItems.length, duplicateApply: 'blocked', emptyPlanApply: 'passed', source: 'custom_template' },
  boundary: 'Forge template save/apply is persisted and restart-readable. RISEMAP same-material template write remains pending because the live RISEMAP session currently redirects to login.',
};
await writeFile('.objectstack/acceptance/project-settings-template-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
