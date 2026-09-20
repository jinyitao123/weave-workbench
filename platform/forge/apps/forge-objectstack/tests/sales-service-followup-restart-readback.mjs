import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const report = JSON.parse(await readFile('.objectstack/acceptance/sales-service-followup-flow-report.json', 'utf8'));
assert.equal(report.passed, true);
async function read(object, id) { const r = await api.request(`/data/${object}/${id}`); assert.equal(r.status, 200, `${object}/${id}: ${JSON.stringify(r.value)}`); return r.value.record; }
const [order, quote, settlement, receivable, warranty] = await Promise.all([
  read('forge_service_order', report.ids.order), read('forge_service_quotation', report.ids.quotation), read('forge_service_settlement', report.ids.settlement), read('forge_accounts_receivable', report.ids.receivable), read('forge_warranty_card', report.ids.warranty),
]);
assert.equal(order.status, 'completed');
assert.equal(order.quotation_code, quote.code);
assert.equal(order.settlement_code, settlement.code);
assert.equal(order.warranty_code, warranty.code);
assert.equal(order.treatment_record, '已完成PLC通讯参数复核、I/O点检与现场联调。');
assert.equal(order.onsite_evidence_count, 1);
assert.equal(order.service_hours, 1.5);
assert.equal(quote.status, 'confirmed');
assert.equal(settlement.service_order_id, order.id);
assert.equal(settlement.quotation_id, null);
assert.equal(settlement.status, 'receivable_created');
assert.equal(settlement.receivable_code, receivable.code);
assert.equal(receivable.source_type, 'service_settlement');
assert.equal(receivable.outstanding_amount, 6800);
assert.equal(warranty.status, 'active');
await writeFile('.objectstack/acceptance/sales-service-followup-restart-report.json', JSON.stringify({ recordedAt: new Date().toISOString(), kind: 'forge-sales-service-followup-restart-readback', endpoint, ids: report.ids, passed: true, result: { order: order.status, quotation: quote.status, settlement_source: settlement.quotation_id ? 'quotation' : 'service_order', settlement: settlement.status, receivable: receivable.status, warranty: warranty.status } }, null, 2));
console.log('PASS service follow-up chain survived restart');
