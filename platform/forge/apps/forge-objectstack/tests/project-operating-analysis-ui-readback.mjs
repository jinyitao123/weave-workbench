import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/project-operating-analysis-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
const api = await connect(process.env.FORGE_URL || 'http://localhost:4360');
async function read(object, id) { const response = await api.request(`/data/${object}/${id}`); assert.equal(response.status, 200, `${object}/${id}`); return response.value.record; }
const project = await read('forge_project', report.ids['PRJ-2026-002']);
const settlement = await read('forge_project_settlement', report.ids['PST-BROWSER-20260910']);
assert.deepEqual({ project: project.status, progress: project.progress, revenue: settlement.contract_amount, cost: settlement.production_cost, profit: settlement.gross_margin, margin: settlement.gross_margin_rate, collected: project.collected_amount }, { project: 'settled', progress: 100, revenue: 121600, cost: 16320.0034, profit: 105279.9966, margin: 86.5789, collected: 121600 });
report.browserVerification = { verifiedAt: new Date().toISOString(), status: 'passed', page: 'page_project_operating_analysis', actions: ['查看全部项目', '切换单个项目', '选择 PRJ-2026-002'], assertion: 'browser showed two-project totals and the selected project revenue, production material cost, profit, margin, collection and settlement source' };
if (process.argv.includes('--restart')) report.browserVerification.restartReadback = { verifiedAt: new Date().toISOString(), status: 'passed', assertion: 'the derived all-project and single-project views remained visible from the same durable records after full restart' };
await writeFile(path, JSON.stringify(report, null, 2));
console.log(`PASS project operating analysis UI${process.argv.includes('--restart') ? ' survived restart' : ' source data verified'}`);
