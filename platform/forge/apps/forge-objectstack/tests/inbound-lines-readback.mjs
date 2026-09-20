import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const find = async object => {
  const result = await api.request(`/data/${object}?$top=500`);
  assert.equal(result.status, 200, `${object} should be readable`);
  return result.value.records;
};

const specs = [
  ['forge_purchase_inbound', 'forge_purchase_inbound_line', '采购入库'],
  ['forge_opening_inbound', 'forge_opening_inbound_line', '期初入库'],
  ['forge_other_inbound', 'forge_other_inbound_line', '其他入库'],
  ['forge_subcontract_inbound', 'forge_subcontract_inbound_line', '委外入库'],
];

let total = 0;
for (const [headerObject, lineObject, label] of specs) {
  const [headers, lines] = await Promise.all([find(headerObject), find(lineObject)]);
  assert.ok(headers.length > 0, `${label} header fixture should survive restart`);
  assert.ok(lines.length > 0, `${label} line fixture should survive restart`);
  const ids = new Set(headers.map(row => row.id));
  assert.ok(lines.every(line => ids.has(line.inbound_id)), `${label} lines must retain their source document`);
  total += lines.length;
}

const production = await find('forge_production_inbound');
assert.ok(total >= 10, 'the unified inbound line page should have persisted cross-source rows');
console.log(`PASS unified inbound line API readback (${total + production.length} rows across five business types)`);
