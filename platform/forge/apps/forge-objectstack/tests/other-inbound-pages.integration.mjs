import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4495';
const api = await connect(endpoint);
const find = async (object, where = {}) => {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '500' });
  const result = await api.request(`/data/${object}?${query}`);
  assert.equal(result.status, 200, `${object}: ${JSON.stringify(result.value)}`);
  return (result.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
};
const create = async (object, body) => {
  const result = await api.request(`/data/${object}`, 'POST', body);
  assert.equal(result.status, 201, `${object}: ${JSON.stringify(result.value)}`);
  return result.value.record || result.value;
};
const invoke = async (action, id, params = {}) => {
  const result = await api.request(`/actions/forge_other_inbound/${action}/${id}`, 'POST', { params });
  assert.equal(result.status, 200, `${action}: ${JSON.stringify(result.value)}`);
  return result.value;
};

const [[type], [warehouse], [sku], [customer]] = await Promise.all([
  find('forge_other_inbound_type', { status: 'active' }),
  find('forge_warehouse'),
  find('forge_material_sku'),
  find('forge_customer'),
]);
assert.ok(type && warehouse && sku, 'active inbound type, warehouse and SKU prerequisites are required');
const [material] = await find('forge_material', { id: sku.material_id });
assert.ok(material, 'SKU material is required');
const stamp = String(Date.now());
const code = `OIN-PAGE-${stamp}`;
const inbound = await create('forge_other_inbound', {
  name: `${code} 页面验收`, code, inbound_type_id: type.id, warehouse_id: warehouse.id,
  inbound_on: '2026-09-16', counterparty_type: 'customer', customer_id: customer?.id || null,
  arrival_reason: '项目样机返仓', source_code: `SRC-${stamp}`, handler_id: api.userId,
  line_count: 1, total_quantity: 2, total_amount: 246, remarks: '其他入库页面纵向链验收',
});
const line = await create('forge_other_inbound_line', {
  name: material.name, inbound_id: inbound.id, sku_id: sku.id, item_code: material.code,
  model: sku.model || material.model || null, specification: sku.specification || sku.name,
  unit_name: material.unit_name || '件', quantity: 2, taxed_unit_price: 123, taxed_amount: 246,
  batch_number: `BATCH-${stamp}`, warehouse_location: 'A-01',
});
const before = (await find('forge_inventory_balance', { balance_key: `${warehouse.id}:${sku.id}` }))[0];
await invoke('other_inbound_submit', inbound.id);
await invoke('other_inbound_approve', inbound.id, { approval_note: '物料、数量与仓库信息核对通过' });
await invoke('other_inbound_stock', inbound.id);
const [[readback], [lineReadback], [ledger], [balance]] = await Promise.all([
  find('forge_other_inbound', { id: inbound.id }),
  find('forge_other_inbound_line', { id: line.id }),
  find('forge_inventory_ledger', { source_id: inbound.id }),
  find('forge_inventory_balance', { balance_key: `${warehouse.id}:${sku.id}` }),
]);
assert.equal(readback.status, 'stocked');
assert.equal(readback.arrival_reason, '项目样机返仓');
assert.equal(readback.counterparty_type, 'customer');
assert.equal(lineReadback.status, 'stocked');
assert.equal(Number(balance.on_hand_quantity), Number(before?.on_hand_quantity || 0) + 2);
assert.equal(ledger.movement_type, 'other_inbound');
assert.equal(Number(ledger.quantity), 2);
console.log(JSON.stringify({ suite: 'other-inbound-pages', status: 'passed', endpoint, id: inbound.id, code, lineId: line.id }, null, 2));
