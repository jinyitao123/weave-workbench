import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
const path = '.objectstack/acceptance/project-settings-template-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true);
const api = await connect(process.env.FORGE_URL || 'http://localhost:4320');
async function read(object, id) { const response = await api.request(`/data/${object}/${id}`); assert.equal(response.status, 200, `${object}/${id}`); return response.value.record; }
async function find(object, where) { const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' }); const response = await api.request(`/data/${object}?${query}`); assert.equal(response.status, 200); return response.value.records || []; }
const template = await read('forge_project_plan_template', report.ids.template);
const plan = await read('forge_project_plan', report.ids.targetPlan);
const items = await find('forge_project_work_item', { plan_id: report.ids.targetPlan });
assert.equal(template.status, 'active');
assert.equal(plan.source, 'custom_template');
assert.equal(Number(plan.item_count), report.result.sourceItemCount);
assert.equal(items.length, report.result.sourceItemCount);
report.restartVerification = { verifiedAt: new Date().toISOString(), status: 'passed', database: process.env.FORGE_DB || report.database, assertion: 'template, target plan source and copied work items survived a full stop and restart' };
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS project settings template chain survived full server restart');
