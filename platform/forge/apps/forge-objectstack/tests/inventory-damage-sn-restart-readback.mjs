import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4386';
const report = JSON.parse(await readFile('.objectstack/acceptance/inventory-damage-sn-report.json', 'utf8'));
const api = await connect(endpoint);
async function one(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object} ${id}`);
  return response.value.record;
}
async function find(object, where) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '500' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object} query`);
  return (response.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
}

const damage = await one('forge_inventory_damage', report.damage.id);
assert.deepEqual({ status: damage.status, line_count: Number(damage.line_count), total_quantity: Number(damage.total_quantity), total_amount: Number(damage.total_amount) }, { status: 'completed', line_count: 2, total_quantity: 0.3, total_amount: 1820 });
assert.equal((await find('forge_inventory_damage_line', { damage_id: damage.id })).length, 2);
assert.equal((await find('forge_inventory_ledger', { source_id: damage.id })).length, 2);
assert.equal((await one('forge_inventory_damage', report.blocked.id)).status, 'voided');
const serial = await one('forge_inventory_serial_number', report.serial.id);
assert.equal(serial.code, report.serial.code);
assert.equal(serial.status, 'in_stock');
assert.ok(serial.verified_at);
assert.ok((await find('forge_inventory_serial_verification', { query_code: report.serial.code })).some(row => row.result === 'found'));
assert.ok((await find('forge_inventory_serial_verification', { query_code: 'INVALID-SN-NO-DATA' })).some(row => row.result === 'not_found'));
console.log('PASS inventory damage and SN restart readback');
