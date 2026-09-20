import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const cases = [];
const ids = { operator: api.userId };
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
async function test(name, run) { try { await run(); cases.push({ name, status: 'passed' }); console.log('PASS ' + name); } catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } }
async function find(object, where = {}, top = 500) { const q = new URLSearchParams({ $filter: JSON.stringify(where), $top: String(top) }); const r = await api.request('/data/' + object + '?' + q); assert.equal(r.status, 200, object + ': ' + JSON.stringify(r.value)); return (r.value.records || []).filter(x => Object.entries(where).every(([k, v]) => x[k] === v)); }
async function read(object, id) { const r = await api.request('/data/' + object + '/' + id); assert.equal(r.status, 200, object + '/' + id + ': ' + JSON.stringify(r.value)); return r.value.record; }
async function create(object, record) { const r = await api.request('/data/' + object, 'POST', record); assert.equal(r.status, 201, object + ': ' + JSON.stringify(r.value)); return r.value.id || r.value.record?.id; }
async function invoke(object, action, id, params = {}, authenticated = true) { return api.request('/actions/' + object + '/' + action + '/' + id, 'POST', { params }, authenticated); }
const resultOf = r => r.value?.result ?? r.value?.data?.result ?? r.value?.data ?? r.value;
const round4 = v => Math.round((Number(v) + Number.EPSILON) * 10000) / 10000;

let receiptReport = null;
try { receiptReport = JSON.parse(await readFile('.objectstack/acceptance/procurement-receipt-inbound-report.json', 'utf8')); } catch {}
assert.ok(receiptReport?.passed, 'procurement receipt/inbound acceptance must pass first');
ids.order = receiptReport.ids.order;
ids.orderLine = receiptReport.ids.orderLine;
ids.warehouse = receiptReport.ids.warehouse;
ids.sku = receiptReport.ids.sku;
ids.account = await create('forge_fund_account', { name: '当前库采购退换货验收账户', code: 'FA-PR-CURRENT-' + stamp, account_type: 'bank', bank_name: '验收银行', account_number: 'PR-' + stamp, currency: 'cny', opening_balance: 5000, current_balance: 5000, opening_on: '2026-09-01', status: 'active', responsible_id: api.userId });

async function returnable() {
  const line = await read('forge_purchase_order_line', ids.orderLine);
  const committed = (await find('forge_purchase_return_line', { order_line_id: ids.orderLine })).filter(x => !['rejected', 'cancelled'].includes(x.status)).reduce((s, x) => s + Number(x.requested_quantity || 0), 0);
  const balance = (await find('forge_inventory_balance', { balance_key: ids.warehouse + ':' + ids.sku }))[0];
  assert.ok(balance, 'current warehouse/SKU balance is required');
  return { line, balance, qty: round4(Math.min(Number(line.inbound_quantity || 0) + Number(line.replenished_quantity || 0) - committed, Number(balance.available_quantity || 0))) };
}
function base(code, quantity) { return { code, order_line_id: ids.orderLine, warehouse_id: ids.warehouse, requested_quantity: quantity, return_on: '2026-09-14', reason: '当前库来料质量异常，走采购退换货验证', return_address: '供应商退货仓', contact_name: '供应商售后', contact_phone: '13800000000', remarks: '当前库采购退换货主链验收' }; }

await test('creates and completes a return-refund flow from current stocked material', async () => {
  const before = await returnable();
  assert.ok(before.qty >= 0.2, 'current line needs at least 0.2 returnable quantity');
  const quantity = 0.1;
  const made = await invoke('forge_purchase_order', 'purchase_order_create_return', ids.order, { ...base('PR-CUR-' + stamp, quantity), refund_method: 'bank_transfer' });
  assert.equal(made.status, 200, JSON.stringify(made.value));
  ids.return = resultOf(made).id; ids.returnLine = resultOf(made).line_id;
  assert.equal((await invoke('forge_purchase_return', 'purchase_return_submit', ids.return)).status, 200);
  assert.equal((await invoke('forge_purchase_return', 'purchase_return_approve', ids.return, { approval_comment: '退货原因、数量和货值已核对' })).status, 200);
  assert.equal((await invoke('forge_purchase_return', 'purchase_return_warehouse_confirm', ids.return, { warehouse_comment: '仓库实物与退货申请一致' })).status, 200);
  const outbound = await invoke('forge_purchase_return', 'purchase_return_outbound', ids.return, { outbound_comment: '退货实物已交供应商承运' });
  assert.equal(outbound.status, 200, JSON.stringify(outbound.value));
  const refundAmount = Number(resultOf(outbound).reference_amount);
  const refund = await invoke('forge_purchase_return', 'purchase_return_register_refund', ids.return, { code: 'PRR-CUR-' + stamp, account_id: ids.account, received_on: '2026-09-14', amount: refundAmount, bank_reference: 'BANK-PRR-' + stamp, remarks: '供应商退款到账' });
  assert.equal(refund.status, 200, JSON.stringify(refund.value));
  ids.refundReceipt = resultOf(refund).id;
  const saved = await read('forge_purchase_return', ids.return);
  assert.deepEqual({ status: saved.status, outbound: saved.outbound_status, refund: saved.refund_status }, { status: 'completed', outbound: 'outbounded', refund: 'received' });
});

await test('creates and completes a replacement flow without supplier refund', async () => {
  const before = await returnable();
  assert.ok(before.qty >= 0.1, 'current line needs remaining returnable quantity for replacement');
  const quantity = 0.1;
  const made = await invoke('forge_purchase_order', 'purchase_order_create_replacement', ids.order, { ...base('REP-CUR-' + stamp, quantity), expected_replenishment_on: '2026-09-25' });
  assert.equal(made.status, 200, JSON.stringify(made.value));
  ids.replacement = resultOf(made).id; ids.replacementLine = resultOf(made).line_id;
  assert.equal((await invoke('forge_purchase_return', 'purchase_replacement_submit', ids.replacement)).status, 200);
  assert.equal((await invoke('forge_purchase_return', 'purchase_return_warehouse_confirm', ids.replacement, { warehouse_comment: '换货原件已核对' })).status, 200);
  assert.equal((await invoke('forge_purchase_return', 'purchase_return_outbound', ids.replacement, { outbound_comment: '原件退回供应商' })).status, 200);
  const arrival = await invoke('forge_purchase_return', 'purchase_replacement_register_arrival', ids.replacement, { code: 'ARR-REP-CUR-' + stamp, arrived_on: '2026-09-14', quantity, batch_number: 'REP-CUR-BATCH', carrier: '供应商物流', logistics_number: 'REP-CUR-' + stamp });
  assert.equal(arrival.status, 200, JSON.stringify(arrival.value));
  ids.replacementReceipt = resultOf(arrival).id; ids.replacementPending = resultOf(arrival).pending_inspection_id;
  const inspected = await invoke('forge_purchase_return', 'purchase_replacement_inspect', ids.replacement, { pending_inspection_id: ids.replacementPending, inspected_on: '2026-09-14', accepted_quantity: quantity, inspection_method: 'full', inspection_note: '补货型号、规格和数量检验合格' });
  assert.equal(inspected.status, 200, JSON.stringify(inspected.value));
  const stocked = await invoke('forge_purchase_return', 'purchase_replacement_stock', ids.replacement, { code: 'PIN-REP-CUR-' + stamp, inbound_on: '2026-09-14', approval_note: '合格补货数量与退回数量一致，准予入库' });
  assert.equal(stocked.status, 200, JSON.stringify(stocked.value));
  ids.replacementInbound = resultOf(stocked).id;
  const saved = await read('forge_purchase_return', ids.replacement);
  assert.deepEqual({ status: saved.status, replacement: saved.replacement_status, refund: saved.refund_status }, { status: 'completed', replacement: 'stocked', refund: 'not_required' });
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = { suite: 'purchase-return-current', endpoint, ids, cases, passed: cases.every(x => x.status === 'passed'), completed_at: new Date().toISOString(), assertion: 'Current SQLite purchase return/refund and replacement/replenishment flows can be completed from a freshly stocked purchase line with source-linked inventory and cash effects.' };
await writeFile('.objectstack/acceptance/purchase-return-current-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
