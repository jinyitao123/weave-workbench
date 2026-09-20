import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4386';
const api = await connect(endpoint);
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '500' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object} query`);
  return (response.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
}
async function one(object, where) {
  const rows = await find(object, where);
  assert.equal(rows.length, 1, `${object} ${JSON.stringify(where)} must be unique`);
  return rows[0];
}

const damage = await one('forge_inventory_damage', { remarks: '浏览器验收：运输损坏' });
assert.deepEqual({ status: damage.status, line_count: Number(damage.line_count), total_quantity: Number(damage.total_quantity), total_amount: Number(damage.total_amount) }, { status: 'completed', line_count: 2, total_quantity: 0.3, total_amount: 1820 });
const lines = await find('forge_inventory_damage_line', { damage_id: damage.id });
assert.equal(lines.length, 2);
assert.deepEqual(lines.map(row => row.status), ['completed', 'completed']);
assert.equal(Math.round(lines.reduce((sum, row) => sum + Number(row.quantity), 0) * 10000) / 10000, 0.3);
assert.equal(lines.reduce((sum, row) => sum + Number(row.amount), 0), 1820);
const ledgers = await find('forge_inventory_ledger', { source_id: damage.id });
assert.equal(ledgers.length, 2);
assert.deepEqual(ledgers.map(row => row.movement_type), ['damage_out', 'damage_out']);
for (const ledger of ledgers) {
  assert.equal(Math.round((Number(ledger.before_on_hand) - Number(ledger.after_on_hand)) * 10000) / 10000, Number(ledger.quantity));
  const balance = await one('forge_inventory_balance', { balance_key: `${ledger.warehouse_id}:${ledger.sku_id}` });
  assert.equal(Number(balance.on_hand_quantity), Number(ledger.after_on_hand));
  assert.equal(Number(balance.available_quantity), Number(ledger.after_available));
}

const type = await one('forge_inventory_damage_type', { name: '损坏' });
const sourceLine = lines[0];
const balance = await one('forge_inventory_balance', { balance_key: `${damage.warehouse_id}:${sourceLine.sku_id}` });
const code = `DMG-BLOCK-${Date.now()}`;
const headerResponse = await api.request('/data/forge_inventory_damage', 'POST', {
  name: `${code} 库存不足阻断`, code, warehouse_id: damage.warehouse_id, damage_type_id: type.id,
  damage_on: damage.damage_on, line_count: 1, total_quantity: Number(balance.available_quantity) + 1,
  total_amount: 0, handler_id: api.userId, remarks: '验收库存不足阻断',
});
assert.ok([200, 201].includes(headerResponse.status));
const blockedId = headerResponse.value.id || headerResponse.value.record?.id;
assert.ok(blockedId);
const lineResponse = await api.request('/data/forge_inventory_damage_line', 'POST', {
  name: '库存不足阻断物料', damage_id: blockedId, warehouse_id: damage.warehouse_id, sku_id: sourceLine.sku_id,
  item_code: sourceLine.item_code, specification: sourceLine.specification, unit_name: sourceLine.unit_name,
  quantity: Number(balance.available_quantity) + 1, unit_cost: Number(balance.average_cost), amount: 0,
});
assert.ok([200, 201].includes(lineResponse.status));
const blockedSubmit = await api.request(`/actions/forge_inventory_damage/inventory_damage_submit/${blockedId}`, 'POST', { params: {} });
assert.equal(blockedSubmit.status, 400);
assert.equal((await one('forge_inventory_damage', { id: blockedId })).status, 'draft');
assert.equal((await find('forge_inventory_ledger', { source_id: blockedId })).length, 0);
const voided = await api.request(`/actions/forge_inventory_damage/inventory_damage_void/${blockedId}`, 'POST', { params: { void_reason: '库存不足阻断验收完成' } });
assert.equal(voided.status, 200);
assert.equal((await one('forge_inventory_damage', { id: blockedId })).status, 'voided');

const serial = await one('forge_inventory_serial_number', { code: 'SN2609092289-00001' });
assert.equal(serial.status, 'in_stock');
assert.ok(serial.verified_at);
const found = await find('forge_inventory_serial_verification', { query_code: serial.code });
const missing = await find('forge_inventory_serial_verification', { query_code: 'INVALID-SN-NO-DATA' });
assert.ok(found.some(row => row.result === 'found' && row.serial_id === serial.id));
assert.ok(missing.some(row => row.result === 'not_found' && !row.serial_id));

const report = {
  passed: true, verifiedAt: new Date().toISOString(), endpoint,
  damage: { id: damage.id, code: damage.code, status: damage.status, line_count: lines.length, total_quantity: 0.3, total_amount: 1820 },
  ledgers: ledgers.map(row => ({ id: row.id, sku_id: row.sku_id, quantity: Number(row.quantity), amount: Number(row.amount), movement_type: row.movement_type })),
  blocked: { id: blockedId, code, status: 'voided', submit_status: blockedSubmit.status },
  serial: { id: serial.id, code: serial.code, status: serial.status, inbound_code: serial.inbound_code, found_checks: found.length, missing_checks: missing.length },
};
await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/inventory-damage-sn-report.json', JSON.stringify(report, null, 2));
console.log('PASS inventory damage and SN workflow');
