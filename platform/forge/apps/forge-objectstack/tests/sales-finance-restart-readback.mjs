import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/sales-finance-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true, 'sales finance acceptance must pass before restart verification');
const api = await connect();
const read = async (object, id) => {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object} persisted across restart`);
  return response.value.record;
};
const invoice = await read('forge_sales_invoice', report.ids.invoice);
const invoiceLine = await read('forge_sales_invoice_line', report.ids.invoiceLine);
const receivable = await read('forge_accounts_receivable', report.ids.receivable);
const order = await read('forge_sales_order', report.ids.order);
const orderLine = await read('forge_sales_order_line', report.ids.orderLine);
const contract = await read('forge_sales_contract', report.ids.contract);
assert.deepEqual(
  { invoice_status: invoice.status, invoice_amount: invoice.total_amount, invoice_outstanding: invoice.outstanding_amount,
    line_quantity: invoiceLine.quantity, line_amount: invoiceLine.taxed_subtotal, receivable_status: receivable.status,
    receivable_amount: receivable.original_amount, receivable_outstanding: receivable.outstanding_amount,
    order_invoiced: order.invoiced_amount, line_invoiced: orderLine.invoiced_quantity, contract_invoiced: contract.invoiced_amount },
  { invoice_status: 'issued', invoice_amount: 121600, invoice_outstanding: 121600,
    line_quantity: 1, line_amount: 121600, receivable_status: 'unpaid', receivable_amount: 121600,
    receivable_outstanding: 121600, order_invoiced: 121600, line_invoiced: 1, contract_invoiced: 121600 },
  'invoice, receivable and order rollup survived restart with exact links and amounts',
);
assert.equal(invoiceLine.invoice_id, invoice.id);
assert.equal(receivable.invoice_id, invoice.id);
assert.equal(receivable.order_id, order.id);
report.restartVerification = { verifiedAt: new Date().toISOString(), status: 'passed', database: '.objectstack/sales-finance.sqlite',
  recordsRead: 6, assertion: 'invoice, invoice line, unpaid receivable and exact order/contract rollups survived a full stop/start' };
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS sales invoice and receivable chain survived full server restart');
