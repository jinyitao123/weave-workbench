import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:3001';
const api = await connect(endpoint);

const request = (path, method = 'GET', body) => api.request(path, method, body);
const records = value => value.records || value.data?.records || value.data || [];
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`);
  return records(response.value).filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
}
async function create(object, body) {
  const response = await request(`/data/${object}`, 'POST', body);
  assert.equal(response.status, 201, `${object}: ${JSON.stringify(response.value)}`);
  return response.value.id || response.value.record?.id;
}
async function update(object, id, body) {
  const response = await request(`/data/${object}/${id}`, 'PATCH', body);
  assert.ok(response.status >= 200 && response.status < 300, `${object}/${id}: ${JSON.stringify(response.value)}`);
}
async function invoke(object, action, id, params = {}) {
  const response = await request(`/actions/${object}/${action}/${id}`, 'POST', { params });
  assert.equal(response.status, 200, `${action}: ${JSON.stringify(response.value)}`);
}
async function ensureByCode(object, code, body) {
  const existing = (await find(object, { code }))[0];
  return existing?.id || create(object, body);
}

const warehouse = (await find('forge_warehouse'))[0];
const skus = await find('forge_material_sku');
const materials = await find('forge_material');
assert.ok(warehouse, '库存统计验收需要一个仓库');
assert.equal(skus.length, 5, '当前库存统计验收固定使用五个已有物料规格');

const materialById = Object.fromEntries(materials.map(row => [row.id, row]));
const inboundTypeId = await ensureByCode('forge_other_inbound_type', 'OIT-INVENTORY-STATS-20260921', {
  name: '审计走查库存统计入库', code: 'OIT-INVENTORY-STATS-20260921', status: 'active', color: '#00875A',
  description: '仅用于库存统计页面非零数据、排行、筛选和响应式走查。',
});
const outboundTypeId = await ensureByCode('forge_other_outbound_type', 'OOT-INVENTORY-STATS-20260921', {
  name: '审计走查库存统计出库', code: 'OOT-INVENTORY-STATS-20260921', status: 'active', color: '#00875A',
  description: '仅用于库存统计页面周转率与出库排行走查。',
});

const inboundCode = 'OIN-INVENTORY-STATS-20260921';
let inbound = (await find('forge_other_inbound', { code: inboundCode }))[0];
if (!inbound) {
  const inboundId = await create('forge_other_inbound', {
    name: '审计走查 库存统计五物料入库', code: inboundCode, inbound_type_id: inboundTypeId,
    warehouse_id: warehouse.id, inbound_on: '2026-09-21', source_code: 'AUDIT-INVENTORY-STATS-20260921',
    handler_id: api.userId, arrival_reason: '库存统计页面非零数据验证', remarks: '审计走查测试数据，可追溯保留',
  });
  const quantities = [60, 45, 30, 2, 10];
  for (let index = 0; index < skus.length; index += 1) {
    const sku = skus[index], material = materialById[sku.material_id], quantity = quantities[index], price = Number(sku.cost_price || 1);
    await create('forge_other_inbound_line', {
      name: material.name, inbound_id: inboundId, sku_id: sku.id, item_code: material.code,
      model: material.model, specification: sku.name, unit_name: '件', quantity,
      taxed_unit_price: price, taxed_amount: quantity * price, batch_number: `INV-STATS-${index + 1}`,
      warehouse_location: `审计区-${index + 1}`, remarks: '库存统计页面验证',
    });
  }
  await invoke('forge_other_inbound', 'other_inbound_submit', inboundId);
  await invoke('forge_other_inbound', 'other_inbound_approve', inboundId, { approval_note: '审计走查数量、单价和仓库已核对' });
  await invoke('forge_other_inbound', 'other_inbound_stock', inboundId);
  inbound = (await find('forge_other_inbound', { code: inboundCode }))[0];
}
assert.equal(inbound.status, 'stocked');

const outboundCode = 'OOUT-INVENTORY-STATS-20260921';
let outbound = (await find('forge_other_outbound', { code: outboundCode }))[0];
if (!outbound) {
  const outboundId = await create('forge_other_outbound', {
    name: '审计走查 库存统计周转出库', code: outboundCode, outbound_type_id: outboundTypeId,
    outbound_on: '2026-09-21', reason: '库存统计周转率与出库排行验证', handler_id: api.userId,
    shipping_method: 'other', remarks: '审计走查测试数据，可追溯保留',
  });
  const outboundQuantities = [20, 15, 10, 1, 0];
  for (let index = 0; index < skus.length; index += 1) {
    const quantity = outboundQuantities[index];
    if (!quantity) continue;
    const sku = skus[index], material = materialById[sku.material_id];
    await create('forge_other_outbound_line', {
      name: material.name, outbound_id: outboundId, warehouse_id: warehouse.id, sku_id: sku.id,
      item_code: material.code, specification: sku.name, unit_name: '件', quantity,
      batch_number: `INV-STATS-${index + 1}`, warehouse_location: `审计区-${index + 1}`,
      remarks: '库存统计页面验证',
    });
  }
  await invoke('forge_other_outbound', 'other_outbound_submit', outboundId);
  await invoke('forge_other_outbound', 'other_outbound_approve', outboundId, { approval_note: '审计走查出库数量与可用库存已核对' });
  await invoke('forge_other_outbound', 'other_outbound_post', outboundId);
  outbound = (await find('forge_other_outbound', { code: outboundCode }))[0];
}
assert.equal(outbound.status, 'outbounded');

const balances = await find('forge_inventory_balance');
const ledgers = await find('forge_inventory_ledger');
const skuIds = new Set(skus.map(row => row.id));
const fixtureBalances = balances.filter(row => row.warehouse_id === warehouse.id && skuIds.has(row.sku_id));
assert.equal(fixtureBalances.length, 5);
assert.equal(ledgers.filter(row => row.source_id === inbound.id).length, 5);
assert.equal(ledgers.filter(row => row.source_id === outbound.id).length, 4);

const finishedSku = skus.find(row => row.code === 'FG-RM-CAB-800-0001');
const lowBalance = fixtureBalances.find(row => row.sku_id === finishedSku?.id);
assert.ok(lowBalance);
await update('forge_inventory_balance', lowBalance.id, { minimum_quantity: 3, slow_days: 30 });

const refreshedBalances = await find('forge_inventory_balance');
const refreshedFixtureBalances = refreshedBalances.filter(row => row.warehouse_id === warehouse.id && skuIds.has(row.sku_id));
const inventoryValue = refreshedBalances.reduce((sum, row) => sum + Number(row.inventory_value || 0), 0);
const outboundAmount = ledgers.filter(row => row.direction === 'outbound').reduce((sum, row) => sum + Number(row.amount || 0), 0);
assert.equal(refreshedFixtureBalances.filter(row => Number(row.on_hand_quantity || 0) > 0).length, 5);
assert.equal(refreshedFixtureBalances.filter(row => Number(row.minimum_quantity || 0) > Number(row.available_quantity || 0)).length, 1);
assert.ok(inventoryValue > 0);
assert.ok(outboundAmount > 0);

console.log(JSON.stringify({
  suite: 'inventory-statistics-data', endpoint, warehouse: warehouse.name,
  inbound: { code: inboundCode, id: inbound.id, status: inbound.status },
  outbound: { code: outboundCode, id: outbound.id, status: outbound.status },
  balances: refreshedBalances.length, fixtureBalances: refreshedFixtureBalances.length, ledgers: ledgers.length,
  skuCount: refreshedFixtureBalances.filter(row => Number(row.on_hand_quantity || 0) > 0).length,
  lowStockCount: refreshedFixtureBalances.filter(row => Number(row.minimum_quantity || 0) > Number(row.available_quantity || 0)).length,
  inventoryValue, outboundAmount,
}, null, 2));
