import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const inboundReport = JSON.parse(await readFile('.objectstack/acceptance/procurement-receipt-inbound-report.json', 'utf8'));
assert.equal(inboundReport.passed, true, 'procurement inbound acceptance must pass before finance verification');
const api = await connect();
const cases = [];
const ids = { ...inboundReport.ids };
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const invoiceNumber = '3200' + stamp.slice(2, 14) + '02';
const read = async (object, id) => {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id} read`);
  return response.value.record;
};
const find = async (object, where) => {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '20' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object} find`);
  return response.value.records.filter(record => Object.entries(where).every(([field, value]) => record[field] === value));
};
const invoke = params => api.request(`/actions/forge_purchase_inbound/purchase_inbound_register_invoice/${ids.inbound}`, 'POST', { params });
const resultOf = response => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

await test('recognizes an unpaid payable when an inbound-trigger order is stocked', async () => {
  const payables = await find('forge_accounts_payable', { inbound_id: ids.inbound });
  assert.equal(payables.length, 1); ids.payable = payables[0].id;
  assert.deepEqual({ source_type: payables[0].source_type, invoice_id: payables[0].invoice_id,
    original: payables[0].original_amount, paid: payables[0].paid_amount, offset: payables[0].offset_amount,
    outstanding: payables[0].outstanding_amount, status: payables[0].status },
  { source_type: 'purchase_inbound', invoice_id: null, original: 6800, paid: 0, offset: 0, outstanding: 6800, status: 'unpaid' });
});

await test('rejects an invoice due date before its issue date without changing the payable', async () => {
  const response = await invoke({ code: 'PINV-RM-' + stamp + '-DATE', invoice_number: '3200' + stamp.slice(2, 14) + '01', invoice_on: '2026-09-09', due_on: '2026-09-08' });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /不得早于开票日期/);
  assert.equal((await find('forge_purchase_invoice', { inbound_id: ids.inbound })).length, 0);
  assert.equal((await read('forge_accounts_payable', ids.payable)).invoice_id, null);
});

await test('registers an exact inbound-valued purchase invoice and links the existing payable', async () => {
  const response = await invoke({
    code: 'PINV-RM-' + stamp + '-001', invoice_number: invoiceNumber, invoice_on: '2026-09-09', due_on: '2026-10-09',
    remarks: '采购进项发票与应付待复核切片验收。',
  });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const result = resultOf(response); ids.invoice = result.id;
  assert.equal(result.payable_id, ids.payable); assert.ok(ids.invoice, 'purchase invoice id');
  const invoice = await read('forge_purchase_invoice', ids.invoice);
  assert.deepEqual({ inbound_id: invoice.inbound_id, order_id: invoice.order_id, invoice_number: invoice.invoice_number,
    total: invoice.total_amount, tax_rate: invoice.tax_rate, due_on: invoice.due_on, status: invoice.status },
  { inbound_id: ids.inbound, order_id: ids.order, invoice_number: invoiceNumber, total: 6800,
    tax_rate: 13, due_on: '2026-10-09', status: 'normal' });
  const lines = await find('forge_purchase_invoice_line', { invoice_id: ids.invoice });
  assert.equal(lines.length, 1); ids.invoiceLine = lines[0].id;
  assert.deepEqual({ inbound_id: lines[0].inbound_id, order_line_id: lines[0].order_line_id, quantity: lines[0].quantity,
    unit_price: lines[0].taxed_unit_price, subtotal: lines[0].taxed_subtotal },
  { inbound_id: ids.inbound, order_line_id: ids.orderLine, quantity: 1, unit_price: 6800, subtotal: 6800 });
  const payable = await read('forge_accounts_payable', ids.payable);
  assert.deepEqual({ invoice_id: payable.invoice_id, due_on: payable.due_on, original: payable.original_amount,
    outstanding: payable.outstanding_amount, status: payable.status },
  { invoice_id: ids.invoice, due_on: '2026-10-09', original: 6800, outstanding: 6800, status: 'unpaid' });
});

await test('rejects a second effective invoice for the same purchase inbound', async () => {
  const response = await invoke({ code: 'PINV-RM-' + stamp + '-REPEAT', invoice_number: '3200' + stamp.slice(2, 14) + '03', invoice_on: '2026-09-09', due_on: '2026-10-09' });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /已经登记有效进项发票/);
  assert.equal((await find('forge_purchase_invoice', { inbound_id: ids.inbound })).length, 1);
  assert.equal((await find('forge_accounts_payable', { inbound_id: ids.inbound })).length, 1);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'local-purchase-invoice-payable-acceptance', ids, cases, invoiceNumber,
  passed: cases.every(testCase => testCase.status === 'passed'),
  runtime: { url: process.env.FORGE_URL || 'http://localhost:4336', database: '.objectstack/procurement-finance.sqlite' },
  observedBoundary: 'An inbound-trigger purchase order recognizes one unpaid payable when accepted stock is posted. Registering one exact-valued purchase invoice links that payable without changing its outstanding amount.',
  limitations: [
    'RISEMAP evidence confirms purchase-invoice, payable and payment-task pages, but the same-input invoice and payable generation timing has not been successfully observed.',
    'This slice supports one purchase invoice per purchase inbound and values it at the accepted inbound amount.',
    'Invoice verification, deduction, red reversal, void, consolidated allocation, payment tasks, cash payment and write-off remain outside this slice.',
    'Writes remain sequential because ObjectStack 17.3.0 action transactions time out during audit persistence.',
  ],
};
await writeFile('.objectstack/acceptance/procurement-finance-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
