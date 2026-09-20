import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4386';
const api = await connect(endpoint);
async function find(object) {
  const response = await api.request(`/data/${object}?$top=500`);
  assert.equal(response.status, 200, object);
  return response.value.records || [];
}

const [documents, documentLines, assemblies, subcontractOutbounds, subcontractIssues, subcontractLines, ledgers] = await Promise.all([
  'forge_production_material_document', 'forge_production_material_document_line', 'forge_assembly_order',
  'forge_subcontract_outbound', 'forge_subcontract_issue', 'forge_subcontract_issue_line', 'forge_inventory_ledger',
].map(find));
for (const document of documents.filter(row => row.document_type !== 'return' && row.status === 'confirmed')) {
  assert.ok(assemblies.some(row => row.id === document.assembly_id), `${document.code} must retain its assembly source`);
  assert.ok(documentLines.some(row => row.document_id === document.id), `${document.code} must retain material details`);
  assert.ok(ledgers.some(row => row.source_object === 'forge_production_material_document' && row.source_id === document.id && row.direction === 'outbound'), `${document.code} must retain outbound stock movements`);
}
for (const outbound of subcontractOutbounds.filter(row => row.status === 'outbounded')) {
  const issue = subcontractIssues.find(row => row.id === outbound.issue_id);
  assert.ok(issue, `${outbound.code} must retain its subcontract issue source`);
  assert.ok(subcontractLines.some(row => row.issue_id === issue.id), `${outbound.code} must retain material details`);
  assert.ok(ledgers.some(row => row.source_object === 'forge_subcontract_issue' && row.source_id === issue.id && row.direction === 'outbound'), `${outbound.code} must retain outbound stock movements`);
}
assert.ok(subcontractOutbounds.length + documents.filter(row => row.document_type !== 'return' && ['pending_approval', 'confirmed'].includes(row.status)).length > 0, 'production outbound page must have a persistent source document');
console.log(JSON.stringify({ suite: 'production-outbound-list-readback', status: 'passed', endpoint, assemblyDocuments: documents.filter(row => row.document_type !== 'return' && ['pending_approval', 'confirmed'].includes(row.status)).length, subcontractDocuments: subcontractOutbounds.length }, null, 2));
