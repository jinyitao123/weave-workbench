import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const shipment = JSON.parse(await readFile('.objectstack/acceptance/sales-shipment-report.json', 'utf8'));
const outbound = JSON.parse(await readFile('.objectstack/acceptance/sales-outbound-report.json', 'utf8'));
assert.equal(shipment.passed, true, 'sales shipment acceptance must pass before finance verification');
assert.equal(outbound.passed, true, 'sales outbound acceptance must pass before finance verification');
const api = await connect();
const cases = [], ids = { order: shipment.ids.order, orderLine: shipment.ids.orderLine };
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const read = async (object, id) => (await api.request(`/data/${object}/${id}`)).value.record;
const find = async (object, where) => {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '20' });
  const result = await api.request(`/data/${object}?${query}`);
  assert.equal(result.status, 200, `${object} find`);
  return result.value.records.filter(record => Object.entries(where).every(([field, value]) => record[field] === value));
};
const invoke = params => api.request(`/actions/forge_sales_order/sales_order_issue_invoice/${ids.order}`, 'POST', { params });
const resultOf = response => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

try {
  const previous = JSON.parse(await readFile('.objectstack/acceptance/sales-finance-report.json', 'utf8'));
  if (previous.ids?.receivable) await api.request(`/data/forge_accounts_receivable/${previous.ids.receivable}`, 'DELETE');
  if (previous.ids?.invoiceLine) await api.request(`/data/forge_sales_invoice_line/${previous.ids.invoiceLine}`, 'DELETE');
  if (previous.ids?.invoice) await api.request(`/data/forge_sales_invoice/${previous.ids.invoice}`, 'DELETE');
  await api.request(`/data/forge_sales_order_line/${ids.orderLine}`, 'PATCH', { invoiced_quantity: 0 });
  await api.request(`/data/forge_sales_order/${ids.order}`, 'PATCH', { invoiced_amount: 0 });
  const order = await read('forge_sales_order', ids.order);
  if (order.contract_id) await api.request(`/data/forge_sales_contract/${order.contract_id}`, 'PATCH', { invoiced_amount: 0 });
} catch {}

await test('issues an invoice only for shipped quantity and creates matching receivable', async () => {
  const response = await invoke({ code: 'INV-CONVERT-' + stamp + '-001', invoice_on: '2026-09-09', due_on: '2026-10-09', quantity: 1, remarks: '销售开票与应收最小闭环验收。' });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const result = resultOf(response); ids.invoice = result.id; ids.receivable = result.receivable_id;
  assert.ok(ids.invoice && ids.receivable, 'invoice and receivable ids');
  const invoice = await read('forge_sales_invoice', ids.invoice);
  ids.contract = invoice.contract_id;
  assert.deepEqual({ order_id: invoice.order_id, total_amount: invoice.total_amount, outstanding_amount: invoice.outstanding_amount, status: invoice.status },
    { order_id: ids.order, total_amount: 121600, outstanding_amount: 121600, status: 'issued' });
  const lines = await find('forge_sales_invoice_line', { invoice_id: ids.invoice });
  assert.equal(lines.length, 1); ids.invoiceLine = lines[0].id;
  assert.deepEqual({ order_line_id: lines[0].order_line_id, quantity: lines[0].quantity, taxed_subtotal: lines[0].taxed_subtotal },
    { order_line_id: ids.orderLine, quantity: 1, taxed_subtotal: 121600 });
  const receivable = await read('forge_accounts_receivable', ids.receivable);
  assert.deepEqual({ invoice_id: receivable.invoice_id, original_amount: receivable.original_amount, outstanding_amount: receivable.outstanding_amount, status: receivable.status },
    { invoice_id: ids.invoice, original_amount: 121600, outstanding_amount: 121600, status: 'unpaid' });
});

await test('rolls invoiced quantity and amount back to the order', async () => {
  const order = await read('forge_sales_order', ids.order), line = await read('forge_sales_order_line', ids.orderLine);
  const contract = await read('forge_sales_contract', ids.contract);
  assert.deepEqual({ status: order.status, invoiced_amount: order.invoiced_amount, invoiced_quantity: line.invoiced_quantity, contract_invoiced_amount: contract.invoiced_amount },
    { status: 'partially_shipped', invoiced_amount: 121600, invoiced_quantity: 1, contract_invoiced_amount: 121600 });
});

await test('accepts the remaining shipped quantity when the order reaches shipped status', async () => {
  await api.request(`/data/forge_sales_order_line/${ids.orderLine}`, 'PATCH', { shipped_quantity: 2 });
  await api.request(`/data/forge_sales_order/${ids.order}`, 'PATCH', { status: 'shipped', shipped_amount: 243200 });
  const response = await invoke({ code: 'INV-CONVERT-' + stamp + '-FINAL', invoice_on: '2026-09-09', due_on: '2026-10-09', quantity: 1 });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const result = resultOf(response), finalInvoiceId = result.id, finalReceivableId = result.receivable_id;
  assert.deepEqual({ total_amount: (await read('forge_sales_invoice', finalInvoiceId)).total_amount,
    order_invoiced: (await read('forge_sales_order', ids.order)).invoiced_amount }, { total_amount: 121600, order_invoiced: 243200 });
  const finalLines = await find('forge_sales_invoice_line', { invoice_id: finalInvoiceId });
  if (finalReceivableId) await api.request(`/data/forge_accounts_receivable/${finalReceivableId}`, 'DELETE');
  if (finalLines[0]?.id) await api.request(`/data/forge_sales_invoice_line/${finalLines[0].id}`, 'DELETE');
  await api.request(`/data/forge_sales_invoice/${finalInvoiceId}`, 'DELETE');
  await api.request(`/data/forge_sales_order_line/${ids.orderLine}`, 'PATCH', { shipped_quantity: 1, invoiced_quantity: 1 });
  await api.request(`/data/forge_sales_order/${ids.order}`, 'PATCH', { status: 'partially_shipped', shipped_amount: 128000, invoiced_amount: 121600 });
  await api.request(`/data/forge_sales_contract/${ids.contract}`, 'PATCH', { invoiced_amount: 121600 });
});

await test('rejects invoicing beyond shipped uninvoiced quantity without extra ledger rows', async () => {
  const response = await invoke({ code: 'INV-CONVERT-' + stamp + '-OVER', invoice_on: '2026-09-09', due_on: '2026-10-09', quantity: 1 });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /超过已发货未开票数量/);
  assert.equal((await find('forge_sales_invoice', { order_id: ids.order })).length, 1);
  assert.equal((await find('forge_accounts_receivable', { order_id: ids.order })).length, 1);
});

await test('rejects a due date before invoice date', async () => {
  await api.request(`/data/forge_sales_order_line/${ids.orderLine}`, 'PATCH', { invoiced_quantity: 0 });
  await api.request(`/data/forge_sales_order/${ids.order}`, 'PATCH', { invoiced_amount: 0 });
  const response = await invoke({ code: 'INV-CONVERT-' + stamp + '-DATE', invoice_on: '2026-09-09', due_on: '2026-09-08', quantity: 1 });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /不得早于开票日期/);
  await api.request(`/data/forge_sales_order_line/${ids.orderLine}`, 'PATCH', { invoiced_quantity: 1 });
  await api.request(`/data/forge_sales_order/${ids.order}`, 'PATCH', { invoiced_amount: 121600 });
});

await test('rejects cumulative invoice amount beyond the order total', async () => {
  await api.request(`/data/forge_sales_order_line/${ids.orderLine}`, 'PATCH', { invoiced_quantity: 0 });
  await api.request(`/data/forge_sales_order/${ids.order}`, 'PATCH', { invoiced_amount: 243200 });
  const response = await invoke({ code: 'INV-CONVERT-' + stamp + '-AMOUNT', invoice_on: '2026-09-09', due_on: '2026-10-09', quantity: 1 });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /累计开票金额不得超过订单含税金额/);
  assert.equal((await find('forge_sales_invoice', { order_id: ids.order })).length, 1);
  await api.request(`/data/forge_sales_order_line/${ids.orderLine}`, 'PATCH', { invoiced_quantity: 1 });
  await api.request(`/data/forge_sales_order/${ids.order}`, 'PATCH', { invoiced_amount: 121600 });
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = { recordedAt: new Date().toISOString(), kind: 'local-sales-finance-api-acceptance', fixture: 'OEM-RM-20260909-A-sales-finance-v0.1', ids, cases,
  passed: cases.every(testCase => testCase.status === 'passed'),
  runtime: { url: process.env.FORGE_URL || 'http://localhost:4310', database: '.objectstack/sales-finance.sqlite' },
  observedBoundary: 'An issued sales invoice is limited by shipped uninvoiced quantity, creates one equally valued unpaid receivable, and rolls invoice progress back to the order.',
  implementationRule: 'Invoice value is allocated from the order line discounted taxed subtotal, preserving cumulative order amount. This rule awaits same-input verification in a successful RISEMAP invoice flow.',
  limitations: ['This first slice supports one order line per invoice.', 'Invoice application/approval, consolidated invoices, tax invoice numbers, red-letter and void flows remain outside this slice.', 'Collection registration and receivable write-off remain a deliberate later boundary.', 'Writes are sequential because ObjectStack 17.3.0 action transactions currently time out during audit persistence.'],
};
await writeFile('.objectstack/acceptance/sales-finance-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
