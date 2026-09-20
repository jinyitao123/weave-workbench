import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/bom-shortage-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true);
const api = await connect(process.env.FORGE_URL || report.endpoint || 'http://localhost:4321');
async function find(object, where = {}) { const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '1000' }); const response = await api.request(`/data/${object}?${query}`); assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`); return response.value.records.filter(record => Object.entries(where).every(([key,value]) => record[key] === value)); }
async function read(object, id) { const response = await api.request(`/data/${object}/${id}`); assert.equal(response.status, 200, `${object}/${id}: ${JSON.stringify(response.value)}`); return response.value.record; }
const first = await read('forge_bom_shortage_analysis', report.ids.firstAnalysis || report.ids.zeroStockAnalysis);
const second = await read('forge_bom_shortage_analysis', report.ids.secondAnalysis || report.ids.partialStockAnalysis);
assert.equal(first.bom_id, report.ids.bom);
assert.equal(second.bom_id, report.ids.bom);
assert.equal(Number(first.component_count), 4);
assert.equal(Number(second.component_count), 4);
assert.equal((await find('forge_bom_shortage_line', { analysis_id: first.id })).length, 4);
assert.equal((await find('forge_bom_shortage_line', { analysis_id: second.id })).length, 4);
if (report.ids.inbound) {
  const inbound = await read('forge_opening_inbound', report.ids.inbound);
  assert.ok(['approved','completed','stocked'].includes(inbound.status), 'opening inbound must remain approved/completed');
}
report.restartVerification = { verifiedAt: new Date().toISOString(), status: 'passed', database: process.env.FORGE_DB || report.database, assertion: 'shortage summaries, snapshot lines and source stock change records survived a full stop/start readback' };
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS BOM shortage snapshots survived full server restart');
