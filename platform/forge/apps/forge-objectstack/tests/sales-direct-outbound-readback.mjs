import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const api = await connect();
const find = async object => {
  const response = await api.request(`/data/${object}?$top=500`);
  assert.equal(response.status, 200, `${object} list`);
  return response.value.records || [];
};

const [shipments, shipmentLines, outbounds, orders, customers, ledgers] = await Promise.all([
  'forge_sales_shipment',
  'forge_sales_shipment_line',
  'forge_sales_outbound',
  'forge_sales_order',
  'forge_customer',
  'forge_inventory_ledger',
].map(find));

assert.ok(outbounds.length > 0, 'at least one sales outbound must exist');
const outbound = [...outbounds].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
const shipment = shipments.find(row => row.id === outbound.shipment_id);
assert.ok(shipment, 'outbound must retain its source shipment');
const line = shipmentLines.find(row => row.shipment_id === shipment.id);
assert.ok(line, 'shipment must retain its material line');
const order = orders.find(row => row.id === outbound.order_id && row.id === line.order_id);
assert.ok(order, 'outbound and shipment line must point to the same sales order');
assert.ok(customers.some(row => row.id === shipment.customer_id || row.id === order.customer_id), 'customer must be readable through the source chain');

const shipmentOutbounds = outbounds.filter(row => row.shipment_id === shipment.id && row.status === 'outbounded');
const completedQuantity = shipmentOutbounds.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
assert.equal(Number(shipment.outbound_quantity), completedQuantity, 'shipment progress must equal posted outbound quantity');
assert.equal(shipment.status, completedQuantity >= Number(shipment.total_quantity) ? 'outbounded' : 'partially_outbounded');
assert.ok(ledgers.some(row => row.source_object === 'forge_sales_outbound' && row.source_id === outbound.id && row.direction === 'outbound'), 'outbound must retain an inventory ledger movement');

const repeat = await api.request(`/actions/forge_sales_shipment/sales_shipment_create_outbound/${shipment.id}`, 'POST', {
  params: { code: `${outbound.code}-REPEAT`, warehouse_id: outbound.warehouse_id, outbound_on: outbound.outbound_on, quantity: 1 },
});
assert.ok(repeat.status >= 400, 'completed shipment must reject repeated outbound');
const afterRepeat = await find('forge_sales_outbound');
assert.equal(afterRepeat.filter(row => row.shipment_id === shipment.id).length, shipmentOutbounds.length, 'rejected repeat must not create another outbound');

const pageSource = await readFile('src/pages/sales-direct-outbounds.page.ts', 'utf8');
for (const label of ['直接出库单号', '客户单号', '客户', '出库进度', '状态', '创建时间', '操作']) {
  assert.ok(pageSource.includes(label), `page must expose ${label}`);
}
for (const status of ['待出库', '部分出库', '已完成']) {
  assert.ok(pageSource.includes(status), `page must expose status ${status}`);
}
assert.ok(pageSource.includes('page_pending_outbound_shipments'), 'pending rows must lead to the outbound handling page');

console.log(`PASS sales direct outbound source chain and persisted progress: ${outbound.code}`);
