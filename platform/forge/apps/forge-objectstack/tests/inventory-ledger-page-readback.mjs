import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const find = async object => {
  const result = await api.request(`/data/${object}?$top=500`);
  assert.equal(result.status, 200, `${object} should be readable`);
  return result.value.records;
};

const sourceObjects = [
  'forge_purchase_inbound',
  'forge_other_inbound',
  'forge_opening_inbound',
  'forge_subcontract_inbound',
  'forge_subcontract_issue',
  'forge_purchase_return',
  'forge_inventory_operation',
  'forge_assembly_order',
  'forge_production_material_document',
  'forge_sales_outbound',
];
const [ledgers, warehouses, skus, balances, ...sourceSets] = await Promise.all([
  find('forge_inventory_ledger'),
  find('forge_warehouse'),
  find('forge_material_sku'),
  find('forge_inventory_balance'),
  ...sourceObjects.map(find),
]);
const warehouseIds = new Set(warehouses.map(row => row.id));
const skuIds = new Set(skus.map(row => row.id));
const sources = Object.fromEntries(sourceObjects.map((name, index) => [name, new Set(sourceSets[index].map(row => row.id))]));

assert.ok(ledgers.length >= 13, 'inventory ledger page should retain the established cross-module flow rows');
assert.ok(ledgers.every(row => warehouseIds.has(row.warehouse_id)), 'every ledger must retain its warehouse');
assert.ok(ledgers.every(row => skuIds.has(row.sku_id)), 'every ledger must retain its SKU');
assert.ok(ledgers.every(row => ['inbound', 'outbound'].includes(row.direction)), 'every ledger must retain a valid direction');
assert.ok(ledgers.every(row => Number(row.quantity || 0) > 0), 'every ledger must retain a positive quantity');
assert.ok(ledgers.every(row => sources[row.source_object]?.has(row.source_id)), 'every ledger must retain a readable source document');

for (const balance of balances) {
  const related = ledgers
    .filter(row => row.warehouse_id === balance.warehouse_id && row.sku_id === balance.sku_id)
    .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
  assert.ok(related.length > 0, `balance ${balance.id} must have ledger history`);
  assert.equal(Number(related[0].after_on_hand), Number(balance.on_hand_quantity), `balance ${balance.id} must match latest ledger on-hand`);
}

console.log(`PASS inventory ledger page API readback (${ledgers.length} ledgers, ${balances.length} balances, all sources readable)`);
