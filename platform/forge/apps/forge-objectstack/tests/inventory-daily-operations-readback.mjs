import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4356';
const api = await connect(endpoint);

async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '500' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object} query`);
  return (response.value.records || []).filter((row) =>
    Object.entries(where).every(([key, value]) => row[key] === value),
  );
}

async function one(object, where) {
  const rows = await find(object, where);
  assert.equal(rows.length, 1, `${object} ${JSON.stringify(where)} must be unique`);
  return rows[0];
}

const lock = await one('forge_inventory_operation', { source_code: 'SO-2026-LOCK-001' });
const tracedLock = await one('forge_inventory_operation', { source_code: 'SO-2026-LOCK-002' });
const count = await one('forge_inventory_operation', { source_code: 'CHK-2026-001' });
const transfer = await one('forge_inventory_operation', { source_code: 'TRF-2026-001' });
const loan = await one('forge_inventory_operation', { source_code: 'LOAN-2026-001' });
const damage = await one('forge_inventory_operation', { source_code: 'DMG-2026-001' });
const serial = await one('forge_inventory_serial_number', { code: 'SN2609092289-00001' });

assert.deepEqual(
  { type: lock.operation_type, status: lock.status, quantity: Number(lock.quantity), released: Number(lock.released_quantity) },
  { type: 'lock', status: 'released', quantity: 2, released: 2 },
);
assert.deepEqual(
  { type: tracedLock.operation_type, status: tracedLock.status, quantity: Number(tracedLock.quantity), released: Number(tracedLock.released_quantity) },
  { type: 'lock', status: 'released', quantity: 0.1, released: 0.1 },
);
assert.deepEqual(
  { type: count.operation_type, status: count.status, system: Number(count.system_quantity), actual: Number(count.actual_quantity), variance: Number(count.variance_quantity) },
  { type: 'count', status: 'completed', system: 1004.3, actual: 1004.2, variance: -0.1 },
);
assert.deepEqual(
  { type: transfer.operation_type, status: transfer.status, quantity: Number(transfer.quantity) },
  { type: 'transfer', status: 'completed', quantity: 0.2 },
);
assert.notEqual(transfer.source_warehouse_id, transfer.target_warehouse_id);
assert.deepEqual(
  { type: loan.operation_type, status: loan.status, quantity: Number(loan.quantity), returned: Number(loan.released_quantity), counterpart: loan.counterpart },
  { type: 'loan', status: 'returned', quantity: 0.1, returned: 0.1, counterpart: '装配一组' },
);
assert.deepEqual(
  { type: damage.operation_type, status: damage.status, quantity: Number(damage.quantity) },
  { type: 'damage', status: 'completed', quantity: 0.1 },
);
assert.equal(serial.status, 'in_stock');
assert.equal(serial.inbound_code, 'IN-2026-0001');
assert.ok(serial.verified_at, 'SN verification timestamp');

const lockLedgers = await find('forge_inventory_ledger', { source_id: tracedLock.id });
const countLedgers = await find('forge_inventory_ledger', { source_id: count.id });
const transferLedgers = await find('forge_inventory_ledger', { source_id: transfer.id });
const loanLedgers = await find('forge_inventory_ledger', { source_id: loan.id });
const damageLedgers = await find('forge_inventory_ledger', { source_id: damage.id });
assert.deepEqual(lockLedgers.map((x) => x.movement_type).sort(), ['inventory_lock', 'inventory_release']);
assert.deepEqual(countLedgers.map((x) => x.movement_type), ['count_loss']);
assert.deepEqual(transferLedgers.map((x) => x.movement_type).sort(), ['transfer_in', 'transfer_out']);
assert.deepEqual(loanLedgers.map((x) => x.movement_type).sort(), ['loan_out', 'loan_return']);
assert.deepEqual(damageLedgers.map((x) => x.movement_type), ['damage_out']);
assert.equal(Number(countLedgers[0].before_on_hand), 1004.3);
assert.equal(Number(countLedgers[0].after_on_hand), 1004.2);

const sourceBalance = await one('forge_inventory_balance', { balance_key: `${count.source_warehouse_id}:${count.sku_id}` });
const targetBalance = await one('forge_inventory_balance', { balance_key: `${transfer.target_warehouse_id}:${transfer.sku_id}` });
const damageBalance = await one('forge_inventory_balance', { balance_key: `${damage.source_warehouse_id}:${damage.sku_id}` });
assert.equal(Number(sourceBalance.on_hand_quantity), 1004);
assert.equal(Number(sourceBalance.available_quantity), 1004);
assert.equal(Number(sourceBalance.reserved_quantity), 0);
assert.ok(Number(targetBalance.on_hand_quantity) >= 0.2);
assert.equal(Number(damageBalance.on_hand_quantity), 5.9);
assert.equal(Number(damageBalance.available_quantity), 5.9);
assert.equal(Number(damageBalance.minimum_quantity), 7);
assert.equal(Number(damageBalance.maximum_quantity), 100);
assert.equal(Number(damageBalance.slow_days), 36500);

const report = {
  passed: true,
  verifiedAt: new Date().toISOString(),
  endpoint,
  database: '.objectstack/data/objectstack.db',
  operations: {
    lock: { id: lock.id, code: lock.code, status: lock.status },
    tracedLock: { id: tracedLock.id, code: tracedLock.code, status: tracedLock.status },
    count: { id: count.id, code: count.code, status: count.status, variance: Number(count.variance_quantity) },
    transfer: { id: transfer.id, code: transfer.code, status: transfer.status },
    loan: { id: loan.id, code: loan.code, status: loan.status },
    damage: { id: damage.id, code: damage.code, status: damage.status },
    serial: { id: serial.id, code: serial.code, verified_at: serial.verified_at },
  },
  balances: {
    source: { id: sourceBalance.id, on_hand: Number(sourceBalance.on_hand_quantity), available: Number(sourceBalance.available_quantity) },
    transferTarget: { id: targetBalance.id, on_hand: Number(targetBalance.on_hand_quantity) },
    damage: { id: damageBalance.id, on_hand: Number(damageBalance.on_hand_quantity), minimum: Number(damageBalance.minimum_quantity) },
  },
  ledgerTypes: {
    lock: lockLedgers.map((x) => x.movement_type),
    count: countLedgers.map((x) => x.movement_type),
    transfer: transferLedgers.map((x) => x.movement_type),
    loan: loanLedgers.map((x) => x.movement_type),
    damage: damageLedgers.map((x) => x.movement_type),
  },
};
await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/inventory-daily-operations-report.json', JSON.stringify(report, null, 2));
console.log('PASS inventory daily operations readback');
