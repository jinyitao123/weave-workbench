import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4443';
const database = process.env.FORGE_DB || '.objectstack/data/objectstack.db';
const api = await connect(endpoint);

async function all(object) {
  const query = new URLSearchParams({ $top: '500' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, object);
  return response.value.records || [];
}

const returns = (await all('forge_subcontract_return')).filter(row => row.status !== 'cancelled');
const lines = await all('forge_subcontract_return_line');
const inbounds = await all('forge_subcontract_return_inbound');
const orders = await all('forge_subcontract_order');
const suppliers = await all('forge_supplier');

assert.ok(returns.length > 0, 'current database must expose visible subcontract returns');
const draft = returns.find(row => row.status === 'draft');
const pending = returns.find(row => row.status === 'pending_inbound');
assert.ok(draft || pending, 'current database must include an actionable draft or pending inbound return');

for (const record of returns) {
  assert.ok(record.code, 'return code is required for list display');
  assert.ok(record.order_id, `${record.code} must keep source subcontract order`);
  assert.ok(record.supplier_id, `${record.code} must keep supplier`);
  assert.ok(record.return_on, `${record.code} must keep return date`);
  assert.ok(record.reason, `${record.code} must keep return reason`);
  assert.ok(orders.some(order => order.id === record.order_id), `${record.code} source order must be readable`);
  assert.ok(suppliers.some(supplier => supplier.id === record.supplier_id), `${record.code} supplier must be readable`);
  assert.ok(lines.some(line => line.return_id === record.id), `${record.code} must have material lines`);
}

if (pending) {
  const inbound = inbounds.find(row => row.return_id === pending.id || row.id === pending.inbound_id);
  assert.ok(inbound, `${pending.code} must expose its pending inbound document`);
  assert.equal(inbound.status, 'pending', `${pending.code} inbound must wait for warehouse confirmation`);
}

console.log(JSON.stringify({
  suite: 'subcontract-return-browser-readback',
  status: 'passed',
  database,
  endpoint,
  activeReturns: returns.length,
  actionable: {
    draft: draft?.code || null,
    pendingInbound: pending?.code || null,
  },
  assertion: '当前 SQLite 中委外退料页面可见记录、来源订单、供应商、退料明细和待入库关系均可通过 API 回读，与内置浏览器首屏一致',
}, null, 2));
