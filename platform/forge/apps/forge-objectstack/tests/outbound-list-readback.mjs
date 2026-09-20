import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4386';
const api = await connect(endpoint);
async function find(object) {
  const response = await api.request(`/data/${object}?$top=500`);
  assert.equal(response.status, 200, object);
  return response.value.records || [];
}

const [ledgers, sales, others, returns, production, subcontractIssues, subcontractOutbounds] = await Promise.all([
  'forge_inventory_ledger', 'forge_sales_outbound', 'forge_other_outbound', 'forge_purchase_return',
  'forge_production_material_document', 'forge_subcontract_issue', 'forge_subcontract_outbound',
].map(find));
const sourceCollections = {
  forge_sales_outbound: sales,
  forge_other_outbound: others,
  forge_purchase_return: returns,
  forge_production_material_document: production,
  forge_subcontract_issue: subcontractIssues,
  forge_subcontract_outbound: subcontractOutbounds,
};
const supported = new Set(Object.keys(sourceCollections));
const outbound = ledgers.filter(row => row.direction === 'outbound' && supported.has(row.source_object));
assert.ok(outbound.length > 0, 'unified outbound list must have persisted outbound business rows');
const grouped = Map.groupBy(outbound, row => `${row.source_object}:${row.source_id}`);
for (const [key, rows] of grouped) {
  const [sourceObject, sourceId] = key.split(':');
  assert.ok(sourceCollections[sourceObject].some(row => row.id === sourceId), `${key} must retain its source document`);
  assert.ok(rows.every(row => Number(row.quantity) > 0 && Number(row.after_on_hand) <= Number(row.before_on_hand)), `${key} must retain an outbound stock effect`);
}
for (const type of ['sales_outbound', 'other_outbound', 'purchase_return_outbound', 'subcontract_issue_outbound']) {
  assert.ok(outbound.some(row => row.movement_type === type), `${type} must appear in the unified list readback`);
}
console.log(JSON.stringify({ suite: 'outbound-list-readback', status: 'passed', endpoint, documents: grouped.size, lines: outbound.length, sourceTypes: [...new Set(outbound.map(row => row.source_object))].sort() }, null, 2));
