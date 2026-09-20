import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const report = JSON.parse(await readFile('.objectstack/acceptance/sales-goodwill-flow-report.json', 'utf8'));
assert.equal(report.passed, true);
const response = await api.request(`/data/forge_goodwill_order/${report.ids.goodwill}`);
assert.equal(response.status, 200, JSON.stringify(response.value));
const row = response.value.record;
assert.equal(row.code, report.code);
assert.equal(row.status, 'completed');
assert.equal(row.shipment_status, '已完成');
assert.equal(row.shipment_count, 1);
assert.equal(row.shipped_quantity, 2);
assert.equal(row.delivery_address, '苏州市工业园区澄岳路9号');
assert.equal(row.recipient, '周启明');
assert.equal(row.recipient_phone, '13800002609');
assert.ok(row.approved_at);
assert.ok(row.shipped_at);
assert.ok(row.completed_at);
await writeFile('.objectstack/acceptance/sales-goodwill-flow-restart-report.json', JSON.stringify({
  recordedAt: new Date().toISOString(),
  kind: 'forge-sales-goodwill-approval-shipment-restart-readback',
  endpoint,
  code: report.code,
  ids: report.ids,
  passed: true,
  result: { status: row.status, shipment_status: row.shipment_status, shipped_quantity: row.shipped_quantity },
}, null, 2));
console.log('PASS Goodwill approval and shipment state survived restart');
