import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/bom-shortage-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true);
const endpoint = process.env.FORGE_URL || 'http://localhost:4347';
const api = await connect(endpoint);
async function find(object, where) { const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '100' }); const response = await api.request(`/data/${object}?${query}`); assert.equal(response.status, 200); return response.value.records.filter(record => Object.entries(where).every(([key,value]) => record[key] === value)); }
const analyses = (await find('forge_bom_shortage_analysis', { bom_id: report.ids.bom })).sort((a,b) => String(b.analyzed_at).localeCompare(String(a.analyzed_at)));
assert.equal(analyses.length, 3);
const browserAnalysis = analyses[0];
assert.deepEqual({ planned: browserAnalysis.planned_quantity, components: browserAnalysis.component_count, shortage: browserAnalysis.shortage_count, kit: browserAnalysis.kit_rate, max: browserAnalysis.max_producible_quantity, amount: browserAnalysis.estimated_purchase_amount },
  { planned: 1, components: 4, shortage: 1, kit: 80, max: 0, amount: 2831.86 });
const lines = await find('forge_bom_shortage_line', { analysis_id: browserAnalysis.id });
assert.equal(lines.length, 4);
assert.deepEqual(lines.filter(line => line.shortage_quantity > 0).map(line => [line.item_code, line.shortage_quantity]), [['RM-HMI-700', 1]]);
report.ids.browserAnalysis = browserAnalysis.id;
report.browserVerification = { verifiedAt: new Date().toISOString(), status: 'passed', url: `${endpoint}/_console/apps/forge/page/page_bom_workspace?id=${report.ids.bom}`, observed: ['从专用 BOM 工作台进入缺料分析页签', '把计划生产数量改为 1 并点击重新分析', '页面回读齐套率 80%、采购件 4、缺口项 1、最大可生产数 0、预计采购金额 2831.86', '明细仅 RM-HMI-700 缺口 1，其余三项库存充足'] };
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS browser shortage analysis persisted and matched the rendered result');
