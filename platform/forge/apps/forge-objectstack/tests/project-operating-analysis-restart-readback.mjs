import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/project-operating-analysis-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true);
const api = await connect(process.env.FORGE_URL || 'http://localhost:4360');
async function read(object, id) { const response = await api.request(`/data/${object}/${id}`); assert.equal(response.status, 200, `${object}/${id}`); return response.value.record; }
const firstProject = await read('forge_project', report.ids['PRJ-2026-001']);
const secondProject = await read('forge_project', report.ids['PRJ-2026-002']);
const firstSettlement = await read('forge_project_settlement', report.ids['PST-OTC-20260910']);
const secondSettlement = await read('forge_project_settlement', report.ids['PST-BROWSER-20260910']);
assert.deepEqual({ projects: [firstProject.status, secondProject.status], revenue: firstSettlement.contract_amount + secondSettlement.contract_amount, cost: firstSettlement.production_cost + secondSettlement.production_cost, collected: firstProject.collected_amount + secondProject.collected_amount }, { projects: ['settled', 'settled'], revenue: 364800, cost: 48960.01, collected: 364800 });
report.restartVerification = { verifiedAt: new Date().toISOString(), status: 'passed', database: process.env.FORGE_DB, assertion: 'the same SQLite retained both settled projects and their traceable operating-analysis sources' };
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS project operating analysis sources survived full restart');
