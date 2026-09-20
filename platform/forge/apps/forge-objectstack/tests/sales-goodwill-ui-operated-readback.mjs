import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
async function findOne(object, field, value) {
  const query = new URLSearchParams({ $filter: JSON.stringify({ [field]: value }), $top: '20' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`);
  const rows = (response.value.records || []).filter(row => row[field] === value);
  assert.equal(rows.length, 1, `${object}.${field}=${value}`);
  return rows[0];
}
const row = await findOne('forge_goodwill_order', 'code', 'GW-FORGE-20260913');
assert.equal(row.status, 'shipping');
assert.equal(row.gift_type, 'onsite_support');
assert.equal(row.reason, '项目交付后现场调试支持所需控制柜样件赠送。');
assert.equal(row.item_name, '800型柔性线控制柜');
assert.equal(row.quantity, 2);
assert.equal(row.shipment_status, '待发货');
assert.equal(row.shipment_count, 1);
assert.equal(row.shipped_quantity, 2);
assert.equal(row.recipient, '周启明');
assert.equal(row.recipient_phone, '13800002609');
assert.equal(row.delivery_address, '苏州市工业园区澄岳路9号');
assert.ok(row.approved_at);
assert.ok(row.shipped_at);
const text = JSON.stringify(row);
assert.equal(/RISEMAP 对照|复刻验收|用于 Forge/.test(text), false);
await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/sales-goodwill-ui-operated-readback-report.json', JSON.stringify({
  recordedAt: new Date().toISOString(), endpoint, passed: true, code: row.code, id: row.id,
  result: { status: row.status, shipment_status: row.shipment_status, shipped_quantity: row.shipped_quantity },
}, null, 2));
console.log('PASS browser-operated Goodwill approval and shipment state read back from current SQLite');
