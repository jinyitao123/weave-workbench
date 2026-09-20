import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4360';
const database = process.env.FORGE_DB || '.objectstack/otc-project-analysis.sqlite';
const api = await connect(endpoint);
const cases = [];
const ids = {};
const round4 = (value) => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, object);
  return (response.value.records || []).filter((record) => Object.entries(where).every(([key, value]) => record[key] === value));
}

const projects = await find('forge_project');
const settlements = await find('forge_project_settlement');
const rows = projects.map((project) => {
  const settlement = settlements.find((item) => item.project_id === project.id);
  const revenue = Number(settlement?.contract_amount ?? project.contract_amount ?? project.expected_revenue ?? 0);
  const cost = Number(settlement?.production_cost ?? project.total_cost ?? 0);
  const collected = Number(project.collected_amount || 0);
  return { project, settlement, revenue, cost, collected, profit: round4(revenue - cost), margin: revenue ? round4((revenue - cost) / revenue * 100) : 0, collectionRate: revenue ? round4(collected / revenue * 100) : 0 };
});

await test('requires authentication for project analytics sources', async () => {
  assert.equal((await api.request('/data/forge_project?$top=1', 'GET', undefined, false)).status, 401);
});

await test('joins each settled project to one persisted settlement snapshot', async () => {
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.project.status === 'settled' && row.settlement));
  for (const row of rows) {
    ids[row.project.code] = row.project.id;
    ids[row.settlement.code] = row.settlement.id;
    assert.equal(row.revenue, row.settlement.contract_amount);
    assert.equal(row.cost, row.settlement.production_cost);
    assert.equal(row.profit, row.settlement.gross_margin);
    assert.equal(row.margin, row.settlement.gross_margin_rate);
  }
});

await test('computes the all-project operating totals from durable records', async () => {
  const totals = rows.reduce((sum, row) => ({ revenue: sum.revenue + row.revenue, cost: sum.cost + row.cost, collected: sum.collected + row.collected }), { revenue: 0, cost: 0, collected: 0 });
  assert.deepEqual({ revenue: totals.revenue, cost: round4(totals.cost), profit: round4(totals.revenue - totals.cost), collected: totals.collected, collectionRate: round4(totals.collected / totals.revenue * 100) }, { revenue: 364800, cost: 48960.01, profit: 315839.99, collected: 364800, collectionRate: 100 });
});

await test('supports a single-project view with traceable revenue, cost and cash', async () => {
  const main = rows.find((row) => row.project.code === 'PRJ-2026-001');
  assert.ok(main);
  assert.deepEqual({ revenue: main.revenue, cost: main.cost, profit: main.profit, margin: main.margin, collected: main.collected, collectionRate: main.collectionRate }, { revenue: 243200, cost: 32640.0066, profit: 210559.9934, margin: 86.5789, collected: 243200, collectionRate: 100 });
});

await test('keeps the cost basis explicitly limited to production material', async () => {
  assert.ok(rows.every((row) => row.project.total_cost === row.settlement.production_cost));
  assert.equal((await find('forge_project_settlement')).reduce((sum, item) => sum + Number(item.production_cost || 0), 0), 48960.01);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = { recordedAt: new Date().toISOString(), kind: 'forge-project-operating-analysis', fixture: 'OEM-RM-20260909-A-project-analysis-v0.1', endpoint, database, ids, cases, passed: cases.every((item) => item.status === 'passed'), result: { projectCount: 2, revenue: 364800, productionMaterialCost: 48960.01, profit: 315839.99, collected: 364800, collectionRate: 100 }, risemapObserved: { currentProjectCount: 1, currentRevenue: 243200, currentCost: 0, currentProfit: 243200, currentCollected: 0, dimensions: ['all projects', 'single project'], visuals: ['revenue-cost-profit comparison', 'cost composition', 'cost flow', 'margin ranking'] }, boundary: 'Forge analytics uses settled contract amounts, production material settlement cost and approved collection totals. Labor, manufacturing overhead, travel, subcontracting and other project costs are not yet collected; RISEMAP source state differs and same-input comparison is not claimed.' };
await writeFile('.objectstack/acceptance/project-operating-analysis-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
