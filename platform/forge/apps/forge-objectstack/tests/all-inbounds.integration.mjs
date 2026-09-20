import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4491';
const api = await connect(endpoint);

async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const result = await api.request(`/data/${object}?${query}`);
  assert.equal(result.status, 200, `${object}: ${JSON.stringify(result.value)}`);
  return (result.value.records || []).filter((record) =>
    Object.entries(where).every(([key, value]) => record[key] === value));
}

let [warehouse] = await find('forge_warehouse', { code: 'WH-ALL-INBOUNDS' });
if (!warehouse) {
  let [warehouseType] = await find('forge_warehouse_type', { code: 'WT-ALL-INBOUNDS' });
  if (!warehouseType) {
    const typeCreated = await api.request('/data/forge_warehouse_type', 'POST', {
      name: '全部入库单验收仓库类型', code: 'WT-ALL-INBOUNDS', status: 'active', sort_order: 99,
    });
    assert.equal(typeCreated.status, 201, JSON.stringify(typeCreated.value));
    warehouseType = typeCreated.value.record || typeCreated.value;
  }
  const warehouseCreated = await api.request('/data/forge_warehouse', 'POST', {
    name: '全部入库单验收仓', code: 'WH-ALL-INBOUNDS', type_id: warehouseType.id,
    responsible_id: api.userId, phone: '13900000000', area: 120, address: '验收环境',
  });
  assert.equal(warehouseCreated.status, 201, JSON.stringify(warehouseCreated.value));
  warehouse = warehouseCreated.value.record || warehouseCreated.value;
}
for (const record of await find('forge_opening_inbound', { code: 'IN-ALL-AGGREGATE-001' })) {
  const deleted = await api.request(`/data/forge_opening_inbound/${record.id}`, 'DELETE');
  assert.ok([200, 204].includes(deleted.status), JSON.stringify(deleted.value));
}

const created = await api.request('/data/forge_opening_inbound', 'POST', {
  name: '全部入库单聚合验收', code: 'IN-ALL-AGGREGATE-001', inbound_on: '2026-09-16',
  warehouse_id: warehouse.id, line_count: 2, total_quantity: 18, total_amount: 5400,
  responsible_id: api.userId, remarks: '独立聚合页面与重启回读验收',
});
assert.equal(created.status, 201, JSON.stringify(created.value));
const id = created.value.id || created.value.record?.id;
assert.ok(id);

const [record] = await find('forge_opening_inbound', { id });
assert.deepEqual({
  code: record.code, status: record.status, warehouse: record.warehouse_id,
  quantity: Number(record.total_quantity), amount: Number(record.total_amount),
}, { code: 'IN-ALL-AGGREGATE-001', status: 'draft', warehouse: warehouse.id, quantity: 18, amount: 5400 });

const anonymous = await api.request('/data/forge_opening_inbound?$top=1', 'GET', undefined, false);
assert.ok([401, 403].includes(anonymous.status), JSON.stringify(anonymous.value));

console.log(JSON.stringify({ suite: 'all-inbounds', status: 'passed', endpoint, id, warehouseId: warehouse.id }, null, 2));
