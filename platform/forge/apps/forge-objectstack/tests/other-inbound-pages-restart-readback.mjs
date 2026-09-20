import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4495';
const sourceCode = process.env.OTHER_INBOUND_SOURCE || 'DEMO-OTHER-IN-20260916';
const api = await connect(endpoint);
const find = async (object, where) => {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '50' });
  const result = await api.request(`/data/${object}?${query}`);
  assert.equal(result.status, 200, `${object}: ${JSON.stringify(result.value)}`);
  return (result.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
};
const [inbound] = await find('forge_other_inbound', { source_code: sourceCode });
assert.ok(inbound, `missing browser-created other inbound ${sourceCode}`);
assert.equal(inbound.status, 'stocked');
assert.equal(inbound.counterparty_type, 'customer');
assert.equal(inbound.arrival_reason, '项目样机返仓补料');
assert.equal(Number(inbound.total_quantity), 3);
assert.equal(Number(inbound.total_amount), 8400);
const [[line], [ledger], [balance]] = await Promise.all([
  find('forge_other_inbound_line', { inbound_id: inbound.id }),
  find('forge_inventory_ledger', { source_id: inbound.id }),
  find('forge_inventory_balance', { balance_key: `${inbound.warehouse_id}:` + (await find('forge_other_inbound_line', { inbound_id: inbound.id }))[0].sku_id }),
]);
assert.equal(line.status, 'stocked');
assert.equal(line.batch_number, 'BROWSER-20260916');
assert.equal(ledger.movement_type, 'other_inbound');
assert.equal(Number(ledger.quantity), 3);
assert.ok(Number(balance.on_hand_quantity) >= 3);
console.log(JSON.stringify({ suite: 'other-inbound-pages-restart-readback', status: 'passed', endpoint, id: inbound.id, code: inbound.code, lineId: line.id, ledgerId: ledger.id, balanceId: balance.id, quantity: inbound.total_quantity, amount: inbound.total_amount }, null, 2));
