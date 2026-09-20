import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const find = async object => {
  const result = await api.request(`/data/${object}?$top=500`);
  assert.equal(result.status, 200, `${object} should be readable`);
  return result.value.records;
};

const [operations, balances, ledgers, warehouses, skus] = await Promise.all([
  find('forge_inventory_operation'),
  find('forge_inventory_balance'),
  find('forge_inventory_ledger'),
  find('forge_warehouse'),
  find('forge_material_sku'),
]);

const count = operations.find(row =>
  row.operation_type === 'count' && row.source_code === 'UI-COUNT-20260915-001'
);
assert.ok(count, 'browser-created inventory count should survive restart');
assert.equal(count.status, 'completed', 'inventory count should remain completed');
assert.equal(Number(count.system_quantity), 1, 'count should retain the book quantity');
assert.equal(Number(count.actual_quantity), 1, 'count should retain the actual quantity');
assert.equal(Number(count.variance_quantity), 0, 'zero-variance count should retain zero difference');
assert.ok(count.completed_at, 'completed count should retain its completion time');

assert.ok(warehouses.some(row => row.id === count.source_warehouse_id), 'count warehouse should remain readable');
assert.ok(skus.some(row => row.id === count.sku_id), 'count SKU should remain readable');
const balance = balances.find(row => row.warehouse_id === count.source_warehouse_id && row.sku_id === count.sku_id);
assert.ok(balance, 'counted warehouse SKU balance should remain readable');
assert.equal(Number(balance.on_hand_quantity), Number(count.actual_quantity), 'balance should equal the completed actual quantity');

const differenceLedgers = ledgers.filter(row =>
  row.source_object === 'forge_inventory_operation' &&
  row.source_id === count.id &&
  ['count_gain', 'count_loss'].includes(row.movement_type)
);
assert.equal(differenceLedgers.length, 0, 'zero-variance count must not create gain or loss ledger rows');

console.log(`PASS inventory count page API readback (${count.code}, completed, zero variance, balance ${balance.on_hand_quantity})`);
