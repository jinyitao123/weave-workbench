import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
const path = '.objectstack/acceptance/sales-current-collection-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true, 'sales current collection must pass before restart readback');
const api = await connect(process.env.FORGE_URL || report.endpoint || 'http://localhost:4321');
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}: ${JSON.stringify(response.value)}`);
  return response.value.record;
}
const ids = report.ids;
const [order, contract, firstInvoice, secondInvoice, firstAr, secondAr, account, r1, r2, r3, a1, a2, a3] = await Promise.all([
  read('forge_sales_order', ids.order), read('forge_sales_contract', ids.contract), read('forge_sales_invoice', ids.firstInvoice), read('forge_sales_invoice', ids.secondInvoice), read('forge_accounts_receivable', ids.firstReceivable), read('forge_accounts_receivable', ids.secondReceivable), read('forge_fund_account', ids.account), read('forge_cash_receipt', ids.receipt1), read('forge_cash_receipt', ids.receipt2), read('forge_cash_receipt', ids.receipt3), read('forge_collection_allocation', ids.allocation1), read('forge_collection_allocation', ids.allocation2), read('forge_collection_allocation', ids.allocation3),
]);
assert.deepEqual({ orderCollected: order.collected_amount, contractCollected: contract.collected_amount, invoices: [firstInvoice.status, secondInvoice.status], receivables: [firstAr.status, secondAr.status], outstanding: [firstAr.outstanding_amount, secondAr.outstanding_amount], accountBalance: account.current_balance, receipts: [r1.status, r2.status, r3.status], allocations: [a1.status, a2.status, a3.status] }, { orderCollected: 243200, contractCollected: 243200, invoices: ['settled', 'settled'], receivables: ['settled', 'settled'], outstanding: [0, 0], accountBalance: 243200, receipts: ['allocated', 'allocated', 'allocated'], allocations: ['approved', 'approved', 'approved'] });
report.restartVerification = { verifiedAt: new Date().toISOString(), status: 'passed', database: process.env.FORGE_DB || report.database, assertion: 'sales receipts, allocations, settled receivables/invoices and order/contract collection totals survived full server restart' };
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS sales current collection chain survived full server restart');
