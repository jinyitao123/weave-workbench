import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:3001';
const api = await connect(endpoint);
const rowsOf = value => value.records || value.data?.records || value.data || [];
const find = async object => {
  const response = await api.request(`/data/${object}?$top=2000`);
  assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`);
  return rowsOf(response.value);
};
const valid = row => !['cancelled', 'voided', 'reversed', 'rejected', 'draft'].includes(row.status);
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
const [receivables, payables, receipts, payments, prepayments] = await Promise.all([
  'forge_accounts_receivable', 'forge_accounts_payable', 'forge_cash_receipt', 'forge_cash_payment', 'forge_supplier_prepayment',
].map(find));
const openReceivables = receivables.filter(row => valid(row) && Number(row.outstanding_amount || 0) > 0);
const openPayables = payables.filter(row => valid(row) && Number(row.outstanding_amount || 0) > 0);
const openPrepayments = prepayments.filter(row => valid(row) && Number(row.balance_amount || 0) > 0);
const values = {
  receivableBalance: sum(openReceivables, 'outstanding_amount'),
  payableBalance: sum(openPayables, 'outstanding_amount'),
  supplierPrepaymentBalance: sum(openPrepayments, 'balance_amount'),
  effectiveReceiptCount: receipts.filter(valid).length,
  effectivePaymentCount: payments.filter(valid).length,
};
for (const value of Object.values(values)) assert.ok(Number.isFinite(value));
console.log(JSON.stringify({
  suite: 'current-account-analysis', status: 'passed', endpoint,
  counts: { receivables: openReceivables.length, payables: openPayables.length, prepayments: openPrepayments.length },
  values,
  boundary: '往来账款只读取 Forge 当前真实应收、应付、收付款与供应商预付款；不复制 RISEMAP 的金额。',
}, null, 2));
