import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const split = JSON.parse(await readFile('.objectstack/acceptance/sales-split-fulfilment-report.json', 'utf8'));
const collection = JSON.parse(await readFile('.objectstack/acceptance/sales-current-collection-report.json', 'utf8'));
const revenue = JSON.parse(await readFile('.objectstack/acceptance/sales-current-revenue-final-report.json', 'utf8'));
assert.equal(split.passed, true); assert.equal(collection.passed, true); assert.equal(revenue.passed, true);
async function read(object, id) { const r = await api.request(`/data/${object}/${id}`); assert.equal(r.status, 200, `${object}/${id}: ${JSON.stringify(r.value)}`); return r.value.record; }
async function find(object, where = {}) { const q = new URLSearchParams({ $filter: JSON.stringify(where), $top: '500' }); const r = await api.request(`/data/${object}?${q}`); assert.equal(r.status, 200, object); return (r.value.records || []).filter(x => Object.entries(where).every(([k, v]) => x[k] === v)); }
const ids = { ...split.ids, ...collection.ids };
const [order, contract, line, account, firstInvoice, secondInvoice, firstAr, secondAr] = await Promise.all([
  read('forge_sales_order', ids.order), read('forge_sales_contract', ids.contract), read('forge_sales_order_line', ids.orderLine), read('forge_fund_account', ids.account), read('forge_sales_invoice', ids.firstInvoice), read('forge_sales_invoice', ids.secondInvoice), read('forge_accounts_receivable', ids.firstReceivable), read('forge_accounts_receivable', ids.secondReceivable),
]);
const [shipment1, shipment2, outbounds, receipts, allocations, recognitions] = await Promise.all([
  read('forge_sales_shipment', ids.shipment), read('forge_sales_shipment', ids.secondShipment), find('forge_sales_outbound', { order_id: ids.order }), find('forge_cash_receipt', { account_id: ids.account }), find('forge_collection_allocation', { order_id: ids.order }), find('forge_revenue_recognition', { order_id: ids.order }),
]);
const shipments = [shipment1, shipment2];
assert.deepEqual({ orderStatus: order.status, orderAmount: order.total_amount, planned: order.planned_shipment_amount, shipped: order.shipped_amount, invoiced: order.invoiced_amount, collected: order.collected_amount, recognized: order.recognized_amount, contractCollected: contract.collected_amount, lineShipped: line.shipped_quantity, lineInvoiced: line.invoiced_quantity, accountBalance: account.current_balance }, { orderStatus: 'shipped', orderAmount: 243200, planned: 256000, shipped: 256000, invoiced: 243200, collected: 243200, recognized: 243200, contractCollected: 243200, lineShipped: 2, lineInvoiced: 2, accountBalance: 243200 });
assert.deepEqual([firstInvoice.status, secondInvoice.status], ['settled', 'settled']);
assert.deepEqual([firstAr.status, secondAr.status], ['settled', 'settled']);
assert.deepEqual([firstAr.outstanding_amount, secondAr.outstanding_amount], [0, 0]);
assert.equal(shipments.length, 2); assert.equal(outbounds.length, 2); assert.equal(receipts.length, 3); assert.equal(allocations.filter(x => x.status === 'approved').length, 3); assert.equal(recognitions.filter(x => x.status === 'approved').length, 2);
const report = { recordedAt: new Date().toISOString(), kind: 'forge-current-sales-main-chain-restart-readback', endpoint, database: process.env.FORGE_DB || collection.database, ids: { order: ids.order, contract: ids.contract, account: ids.account }, passed: true, result: { order: 'shipped', amount: 243200, invoices: 'settled', receivables: 'settled', receipts: 3, allocations: 3, revenue: 243200 }, assertion: 'quote-converted contract/order, two real shipment outbounds, two invoices, three receipt allocations and two approved revenue recognitions survived full server restart in the current SQLite.' };
await writeFile('.objectstack/acceptance/sales-current-main-chain-restart-report.json', JSON.stringify(report, null, 2));
console.log('PASS current sales main chain final state survived full server restart');
