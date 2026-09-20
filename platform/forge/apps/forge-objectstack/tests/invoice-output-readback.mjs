import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4441';
const api = await connect(endpoint);
const find = async (object, where) => {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '20' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return response.value.records || [];
};
const invoke = (id, params, authenticated = true) => api.request(
  `/actions/forge_sales_invoice/sales_invoice_red_reverse/${id}`,
  'POST',
  { params },
  authenticated,
);

const [normal] = await find('forge_sales_invoice', { code: 'INV-BROWSER-20260916-001' });
const [original] = await find('forge_sales_invoice', { code: 'INV-ISSUED-1789545797758' });
const [red] = await find('forge_sales_invoice', { code: 'INV-RED-BROWSER-20260916-001' });
assert.ok(normal && original && red, '缺少销项发票页面验收材料');

const [normalReceivable] = await find('forge_accounts_receivable', { invoice_id: normal.id });
const [reversedReceivable] = await find('forge_accounts_receivable', { invoice_id: original.id });
const logs = await find('forge_invoice_reversal_log', { original_sales_invoice_id: original.id });
const lines = await find('forge_sales_invoice_line', {});
const invoiceLines = lines.filter((line) => [normal.id, original.id, red.id].includes(line.invoice_id));
const signedTotal = [normal, original, red].reduce(
  (total, invoice) => total + (invoice.invoice_type === 'red' ? -1 : 1) * Number(invoice.total_amount || 0),
  0,
);
const rates = [...new Set(invoiceLines.map((line) => Number(line.tax_rate || 0)))];

assert.deepEqual(
  {
    normalStatus: normal.status,
    normalReceivableStatus: normalReceivable?.status,
    normalOutstanding: normalReceivable?.outstanding_amount,
    originalStatus: original.status,
    originalOutstanding: original.outstanding_amount,
    reversedReceivableStatus: reversedReceivable?.status,
    reversedReceivableOutstanding: reversedReceivable?.outstanding_amount,
    redStatus: red.status,
    redType: red.invoice_type,
    redOriginal: red.original_invoice_id,
    reversalLogs: logs.length,
    signedTotal,
    rates,
  },
  {
    normalStatus: 'issued',
    normalReceivableStatus: 'unpaid',
    normalOutstanding: 26000,
    originalStatus: 'red_reversed',
    originalOutstanding: 0,
    reversedReceivableStatus: 'red_reversed',
    reversedReceivableOutstanding: 0,
    redStatus: 'red_invoice',
    redType: 'red',
    redOriginal: original.id,
    reversalLogs: 1,
    signedTotal: 26000,
    rates: [13],
  },
);

assert.equal((await invoke(normal.id, {
  code: 'INV-RED-UNAUTHENTICATED',
  invoice_on: '2026-09-18',
  reversal_reason: '未登录调用不应成功',
}, false)).status, 401);
assert.equal((await invoke(original.id, {
  code: 'INV-RED-REPEAT',
  invoice_on: '2026-09-18',
  reversal_reason: '已红冲发票不应重复红冲',
})).status, 400);

console.log(JSON.stringify({
  suite: 'invoice-output-readback',
  status: 'passed',
  endpoint,
  invoiceIds: { normal: normal.id, original: original.id, red: red.id },
  signedTotal,
  rates,
}, null, 2));
