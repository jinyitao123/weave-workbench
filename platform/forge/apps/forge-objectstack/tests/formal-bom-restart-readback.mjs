import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/formal-bom-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true, 'formal BOM API acceptance must pass before restart');
const api = await connect();
async function read(object, id) { const response = await api.request(`/data/${object}/${id}`); assert.equal(response.status, 200, `${object}/${id}`); return response.value.record; }
async function find(object, where) { const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '100' }); const response = await api.request(`/data/${object}?${query}`); assert.equal(response.status, 200); return response.value.records.filter(record => Object.entries(where).every(([field, value]) => record[field] === value)); }
const standard = await read('forge_bom', report.ids.standardBom);
const project = await read('forge_bom', report.ids.projectBom);
const versionDraft = await read('forge_bom', report.ids.versionDraft);
assert.deepEqual({ status: standard.status, version: standard.version, count: standard.node_count, cost: standard.total_cost }, { status: 'active', version: 'V1.0', count: 4, cost: 14442.48 });
assert.deepEqual({ status: project.status, type: project.bom_type, source: project.source_bom_id, project: project.project_id, count: project.node_count },
  { status: 'active', type: 'project', source: report.ids.standardBom, project: report.ids.project, count: 4 });
assert.deepEqual({ status: versionDraft.status, version: versionDraft.version, source: versionDraft.source_bom_id }, { status: 'inactive', version: 'V1.1', source: report.ids.standardBom });
assert.equal((await find('forge_bom_node', { bom_id: report.ids.projectBom })).length, 5);
assert.equal((await find('forge_bom_approval_log', { bom_id: report.ids.standardBom })).length, 3);
if (report.ids.browserProjectBom) {
  const browserBom = await read('forge_bom', report.ids.browserProjectBom);
  assert.deepEqual({ project: browserBom.project_id, source: browserBom.source_bom_id, status: browserBom.status, count: browserBom.node_count },
    { project: report.ids.browserProject, source: report.ids.standardBom, status: 'active', count: 4 });
  assert.equal((await find('forge_bom_node', { bom_id: report.ids.browserProjectBom })).length, 5);
  assert.deepEqual((await find('forge_bom_approval_log', { bom_id: report.ids.browserProjectBom })).map(log => log.action).sort(), ['approved', 'submitted']);
}
report.restartVerification = { verifiedAt: new Date().toISOString(), status: 'passed', database: process.env.FORGE_DB || '.objectstack/otc-formal-bom.sqlite', recordsRead: report.ids.browserProjectBom ? 7 : 6,
  assertion: report.ids.browserProjectBom ? 'standard, active main-project BOM, invalidated V1.1, browser project BOM, copied nodes and approval logs survived a full stop/start' : 'standard, active main-project BOM, invalidated V1.1, copied nodes and approval logs survived a full stop/start' };
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS formal BOM lifecycle survived full server restart');
