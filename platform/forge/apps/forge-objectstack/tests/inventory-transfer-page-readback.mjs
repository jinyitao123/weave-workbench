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
  find('forge_inventory_operation'), find('forge_inventory_balance'), find('forge_inventory_ledger'),
  find('forge_warehouse'), find('forge_material_sku'),
]);
const transfer = operations.find(row => row.code === 'UI-TRF-20260915-001');
const loan = operations.find(row => row.code === 'UI-LOAN-20260915-001');
assert.ok(transfer && loan, 'browser-created transfer and loan should survive restart');
assert.equal(transfer.operation_type, 'transfer');
assert.equal(transfer.status, 'completed');
assert.equal(Number(transfer.quantity), 1);
assert.ok(transfer.source_warehouse_id !== transfer.target_warehouse_id, 'transfer warehouses must differ');
assert.equal(loan.operation_type, 'loan');
assert.equal(loan.status, 'returned');
assert.equal(Number(loan.quantity), 0.1);
assert.equal(Number(loan.released_quantity), 0.1, 'loan should retain its returned quantity');
assert.equal(loan.counterpart, '汇川项目现场');

const warehouseIds = new Set(warehouses.map(row => row.id));
const skuIds = new Set(skus.map(row => row.id));
for (const row of [transfer, loan]) {
  assert.ok(warehouseIds.has(row.source_warehouse_id), `${row.code} source warehouse should remain readable`);
  assert.ok(skuIds.has(row.sku_id), `${row.code} SKU should remain readable`);
}

const movementTypes = row => ledgers.filter(ledger => ledger.source_object === 'forge_inventory_operation' && ledger.source_id === row.id).map(ledger => ledger.movement_type).sort();
assert.deepEqual(movementTypes(transfer), ['transfer_in', 'transfer_out'], 'transfer must retain both warehouse ledger rows');
assert.deepEqual(movementTypes(loan), ['loan_out', 'loan_return'], 'loan must retain outbound and return ledger rows');

for (const balance of balances.filter(row => [transfer.sku_id, loan.sku_id].includes(row.sku_id))) {
  const latest = ledgers.filter(row => row.warehouse_id === balance.warehouse_id && row.sku_id === balance.sku_id).sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)))[0];
  assert.ok(latest, `balance ${balance.id} should retain ledger history`);
  assert.equal(Number(balance.on_hand_quantity), Number(latest.after_on_hand), `balance ${balance.id} should match its latest ledger`);
}

console.log('PASS inventory transfer page API readback (completed transfer, returned loan, four auditable ledger rows)');
