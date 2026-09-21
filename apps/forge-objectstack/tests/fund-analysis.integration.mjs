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
const [accounts, receipts, payments, receivables, payables] = await Promise.all([
  'forge_fund_account', 'forge_cash_receipt', 'forge_cash_payment', 'forge_accounts_receivable', 'forge_accounts_payable',
].map(find));
const activeAccounts = accounts.filter(row => row.status === 'active');
const openReceivables = receivables.filter(row => valid(row) && Number(row.outstanding_amount || 0) > 0);
const openPayables = payables.filter(row => valid(row) && Number(row.outstanding_amount || 0) > 0);
const values = {
  accountBalance: sum(activeAccounts, 'current_balance'),
  effectiveReceiptCount: receipts.filter(valid).length,
  effectivePaymentCount: payments.filter(valid).length,
  receivableBalance: sum(openReceivables, 'outstanding_amount'),
  payableBalance: sum(openPayables, 'outstanding_amount'),
};
for (const value of Object.values(values)) assert.ok(Number.isFinite(value));
console.log(JSON.stringify({
  suite: 'fund-analysis', status: 'passed', endpoint,
  counts: { accounts: activeAccounts.length, receivables: openReceivables.length, payables: openPayables.length },
  values,
  boundary: '资金分析读取 Forge 当前真实业务对象；零值保持为零，不注入演示金额。RISEMAP 与 Forge 尚非同一组业务材料。',
}, null, 2));
