import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const api = await connect();
const find = async object => {
  const response = await api.request(`/data/${object}?$top=500`);
  assert.equal(response.status, 200, `${object} list`);
  return response.value.records || [];
};
const [ledgers, warehouses, skus, materials] = await Promise.all(['forge_inventory_ledger', 'forge_warehouse', 'forge_material_sku', 'forge_material'].map(find));
const rows = ledgers.filter(row => row.direction === 'outbound');
assert.ok(rows.length > 0, 'outbound ledger rows must exist');
assert.ok(rows.every(row => warehouses.some(item => item.id === row.warehouse_id)), 'every outbound row must resolve a warehouse');
assert.ok(rows.every(row => skus.some(item => item.id === row.sku_id)), 'every outbound row must resolve a SKU');
assert.ok(rows.every(row => {
  const sku = skus.find(item => item.id === row.sku_id);
  return materials.some(item => item.id === sku?.material_id);
}), 'every outbound SKU must resolve a material');
for (const type of ['sales_outbound', 'other_outbound', 'purchase_return_outbound', 'subcontract_issue_outbound', 'damage_out', 'transfer_out', 'loan_out']) {
  assert.ok(rows.some(row => row.movement_type === type), `outbound details must include ${type}`);
}
assert.ok(rows.every(row => {
  const decrement = row.movement_type === 'inventory_lock'
    ? Number(row.before_available) - Number(row.after_available)
    : Number(row.before_on_hand) - Number(row.after_on_hand);
  return Number(row.quantity) > 0 && Math.abs(decrement - Number(row.quantity)) < 0.00001;
}), 'outbound quantity must match inventory or available-stock decrement');

const pageSource = await readFile('src/pages/outbound-lines-list.page.ts', 'utf8');
for (const label of ['序号', '出库日期', '出库单号', '发货单号', '业务类型', '仓库', '客户', '制单人', '物料编码', '物料名称', '型号', '规格', '单位', '数量', '含税单价', '不含税单价', '税率', '含税金额', '库位', '物流单号', '状态']) assert.ok(pageSource.includes(label), `page must expose ${label}`);
for (const control of ['打印条码', '导出', '刷新', '开始日期', '结束日期']) assert.ok(pageSource.includes(control), `page must expose ${control}`);
console.log(`PASS unified outbound details persisted rows: ${rows.length}`);
