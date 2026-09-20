import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const copiedBomId = process.env.FORGE_PRODUCTIZED_BOM_ID;
const shortageBomId = process.env.FORGE_PRODUCTIZED_SHORTAGE_BOM_ID;
const shortageAnalysisId = process.env.FORGE_PRODUCTIZED_ANALYSIS_ID;
assert.ok(copiedBomId, 'FORGE_PRODUCTIZED_BOM_ID is required');
assert.ok(shortageBomId, 'FORGE_PRODUCTIZED_SHORTAGE_BOM_ID is required');
assert.ok(shortageAnalysisId, 'FORGE_PRODUCTIZED_ANALYSIS_ID is required');

const api = await connect();
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id} should be readable`);
  return response.value.record;
}
async function find(object, where) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '100' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object} query should succeed`);
  return response.value.records.filter(record => Object.entries(where).every(([field, value]) => record[field] === value));
}

const copiedBom = await read('forge_bom', copiedBomId);
const [nodes, logs, shortageAnalysis] = await Promise.all([
  find('forge_bom_node', { bom_id: copiedBomId }),
  find('forge_bom_approval_log', { bom_id: copiedBomId }),
  read('forge_bom_shortage_analysis', shortageAnalysisId),
]);
assert.equal(shortageAnalysis.bom_id, shortageBomId);
const shortageLines = await find('forge_bom_shortage_line', { analysis_id: shortageAnalysis.id });

assert.deepEqual(
  { status: copiedBom.status, version: copiedBom.version, nodeCount: copiedBom.node_count, nodes: nodes.length },
  { status: 'active', version: 'V1.1', nodeCount: 4, nodes: 5 },
);
assert.deepEqual(logs.map(log => log.action).sort(), ['approved', 'submitted']);
assert.ok(logs.some(log => log.comment === '产品化 P0 页面、结构与用量核对通过'));
assert.deepEqual(
  {
    plannedQuantity: shortageAnalysis.planned_quantity,
    kitRate: shortageAnalysis.kit_rate,
    componentCount: shortageAnalysis.component_count,
    shortageCount: shortageAnalysis.shortage_count,
    maxProducibleQuantity: shortageAnalysis.max_producible_quantity,
    estimatedPurchaseAmount: shortageAnalysis.estimated_purchase_amount,
    lines: shortageLines.length,
  },
  { plannedQuantity: 1, kitRate: 80, componentCount: 4, shortageCount: 1, maxProducibleQuantity: 0, estimatedPurchaseAmount: 2831.86, lines: 4 },
);

console.log(JSON.stringify({
  suite: 'productized-bom-ui-restart-readback',
  status: 'passed',
  endpoint: process.env.FORGE_URL || 'http://localhost:4310',
  database: process.env.FORGE_DB || 'not supplied',
  copiedBom: { id: copiedBom.id, sourceBomId: copiedBom.source_bom_id, status: copiedBom.status, version: copiedBom.version, nodes: nodes.length, approvalLogs: logs.length },
  shortageAnalysis: { id: shortageAnalysis.id, bomId: shortageBomId, plannedQuantity: shortageAnalysis.planned_quantity, kitRate: shortageAnalysis.kit_rate, shortageCount: shortageAnalysis.shortage_count, estimatedPurchaseAmount: shortageAnalysis.estimated_purchase_amount, lines: shortageLines.length },
}, null, 2));
