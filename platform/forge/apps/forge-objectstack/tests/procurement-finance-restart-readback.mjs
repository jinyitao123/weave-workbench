import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/procurement-finance-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true, 'procurement finance acceptance must pass before restart verification');
const api = await connect();
const read = async (object, id) => {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id} persisted across restart`);
  return response.value.record;
};
const invoice = await read('forge_purchase_invoice', report.ids.invoice);
const invoiceLine = await read('forge_purchase_invoice_line', report.ids.invoiceLine);
const payable = await read('forge_accounts_payable', report.ids.payable);
const inbound = await read('forge_purchase_inbound', report.ids.inbound);
assert.deepEqual({ invoice_status: invoice.status, invoice_number: invoice.invoice_number, invoice_amount: invoice.total_amount,
  line_quantity: invoiceLine.quantity, line_amount: invoiceLine.taxed_subtotal, payable_source: payable.source_type,
  payable_invoice: payable.invoice_id, payable_original: payable.original_amount, payable_outstanding: payable.outstanding_amount,
  payable_status: payable.status, inbound_amount: inbound.inventory_amount },
{ invoice_status: 'normal', invoice_number: report.invoiceNumber, invoice_amount: 6800, line_quantity: 1,
  line_amount: 6800, payable_source: 'purchase_inbound', payable_invoice: report.ids.invoice, payable_original: 6800,
  payable_outstanding: 6800, payable_status: 'unpaid', inbound_amount: 6800 });
assert.equal(invoiceLine.invoice_id, invoice.id);
assert.equal(invoice.inbound_id, inbound.id);
assert.equal(payable.inbound_id, inbound.id);
report.restartVerification = {
  verifiedAt: new Date().toISOString(), status: 'passed', database: '.objectstack/procurement-finance.sqlite',
  recordsRead: 4, assertion: 'purchase invoice, line, inbound-trigger payable and exact 6800 outstanding amount survived a full stop/start',
};
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS purchase invoice and payable chain survived full server restart');
