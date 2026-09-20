import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const api = await connect(process.env.FORGE_URL || 'http://localhost:4441');
const fixture = JSON.parse(await readFile('.objectstack/acceptance/invoice-task-workspace.json', 'utf8'));
const read = async (object, id) => {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return response.value.record;
};
const find = async (object, where) => {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '20' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return response.value.records;
};

const [approved, rejected, issued] = await Promise.all([
  read('forge_sales_invoice_request', fixture.records.pendingApprove.requestId),
  read('forge_sales_invoice_request', fixture.records.pendingReject.requestId),
  read('forge_sales_invoice_request', fixture.records.approvedForBrowser.requestId),
]);
const invoices = await find('forge_sales_invoice', { code: 'INV-BROWSER-20260916-001' });
assert.equal(invoices.length, 1);
const receivables = await find('forge_accounts_receivable', { invoice_id: invoices[0].id });
assert.equal(receivables.length, 1);
assert.deepEqual(
  {
    approved: approved.status, rejected: rejected.status, issued: issued.status,
    invoice: invoices[0].status, receivable: receivables[0].status,
    amount: invoices[0].total_amount, outstanding: receivables[0].outstanding_amount,
    requestInvoiceId: issued.invoice_id,
  },
  {
    approved: 'approved', rejected: 'rejected', issued: 'issued',
    invoice: 'issued', receivable: 'unpaid', amount: 26000, outstanding: 26000,
    requestInvoiceId: invoices[0].id,
  },
);

console.log(JSON.stringify({
  suite: 'invoice-task-restart-readback', status: 'passed', database: '.objectstack/finance-sales-cycle.sqlite',
  requestIds: { approved: approved.id, rejected: rejected.id, issued: issued.id },
  invoiceId: invoices[0].id, receivableId: receivables[0].id, amount: invoices[0].total_amount,
}, null, 2));
