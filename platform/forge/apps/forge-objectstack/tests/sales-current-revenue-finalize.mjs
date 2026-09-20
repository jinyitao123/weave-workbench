import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const split = JSON.parse(await readFile('.objectstack/acceptance/sales-split-fulfilment-report.json', 'utf8'));
assert.equal(split.passed, true);
const ids = { ...split.ids, operator: api.userId };
const resultOf = r => r.value?.result ?? r.value?.data?.result ?? r.value?.data ?? r.value;
async function read(o, id) { const r = await api.request(`/data/${o}/${id}`); assert.equal(r.status, 200, o + '/' + id + ': ' + JSON.stringify(r.value)); return r.value.record; }
async function find(o, w = {}) { const q = new URLSearchParams({ $filter: JSON.stringify(w), $top: '500' }); const r = await api.request(`/data/${o}?${q}`); assert.equal(r.status, 200, o); return (r.value.records || []).filter(x => Object.entries(w).every(([k, v]) => x[k] === v)); }
async function invoke(o, a, id, params = {}) { return api.request(`/actions/${o}/${a}/${id}`, 'POST', { params }); }
const order = await read('forge_sales_order', ids.order);
const outbounds = await find('forge_sales_outbound', { order_id: ids.order });
assert.equal(outbounds.length, 2);
let records = await find('forge_revenue_recognition', { order_id: ids.order });
let approved = records.filter(x => x.status === 'approved');
if (approved.length < outbounds.length) {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  for (const [index, target] of outbounds.entries()) {
    records = await find('forge_revenue_recognition', { order_id: ids.order });
    if (records.some(record => record.source_id === target.id && record.status === 'approved')) continue;
    const pending = records.find(record => record.source_id === target.id && record.status === 'pending_review');
    const recognitionId = pending?.id || resultOf(await invoke('forge_sales_order', 'sales_order_create_revenue_recognition', ids.order, { code: `REV-CURRENT-FINAL-${stamp}-${index + 1}`, source_id: target.id, recognition_on: '2026-09-13', financial_period: '2026-09', remarks: '销售主链最终收入确认' })).id;
    assert.ok(recognitionId, 'revenue recognition id');
    const approvedResponse = await invoke('forge_revenue_recognition', 'revenue_recognition_approve', recognitionId, { review_comment: '销售出库与发票回款链条已核对，确认收入' });
    assert.equal(approvedResponse.status, 200, JSON.stringify(approvedResponse.value));
  }
}
records = await find('forge_revenue_recognition', { order_id: ids.order });
approved = records.filter(x => x.status === 'approved');
const orderAfter = await read('forge_sales_order', ids.order);
assert.equal(approved.length, outbounds.length);
assert.equal(orderAfter.recognized_amount, 243200);
assert.equal(outbounds.length, 2);
await mkdir('.objectstack/acceptance', { recursive: true });
const report = { recordedAt: new Date().toISOString(), kind: 'forge-current-sales-revenue-final-closure', endpoint, database: process.env.FORGE_DB || '.objectstack/data/objectstack.db', ids: { order: ids.order, outbounds: outbounds.map(x => x.id), recognitions: approved.map(x => x.id) }, passed: true, result: { recognizedAmount: 243200, approvedRecognitions: 2, rejectedRecognitions: records.filter(x => x.status === 'rejected').length }, boundary: 'Forge current SQLite proves both shipment-sourced revenue recognitions can be generated and approved after two real sales outbounds. Rejected recognition remains as recoverable history for the second source.' };
await writeFile('.objectstack/acceptance/sales-current-revenue-final-report.json', JSON.stringify(report, null, 2));
console.log('PASS finalized current sales revenue recognition');
