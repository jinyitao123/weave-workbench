import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/prepayment-refund-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true);
const api = await connect(process.env.FORGE_URL || 'http://localhost:4365');
async function read(object, id) {
  assert.ok(id, `${object} id is required for restart readback`);
  const r = await api.request(`/data/${object}/${id}`);
  assert.equal(r.status, 200, `${object}/${id}`);
  return r.value.record;
}
async function maybeRead(object, id) {
  if (!id) return null;
  return read(object, id);
}

const [apiPrepayment, apiRefund, apiOffset, apiPayable, apiAccount, browserPrepayment, browserRefund, browserAccount] = await Promise.all([
  read('forge_supplier_prepayment', report.ids.prepayment),
  read('forge_supplier_refund', report.ids.refund),
  read('forge_supplier_prepayment_offset', report.ids.offset),
  read('forge_accounts_payable', report.ids.payable),
  read('forge_fund_account', report.ids.account),
  maybeRead('forge_supplier_prepayment', report.ids.browserPrepayment),
  maybeRead('forge_supplier_refund', report.ids.browserRefund),
  maybeRead('forge_fund_account', report.ids.browserAccount),
]);

assert.deepEqual({
  apiBalance: apiPrepayment.balance_amount,
  apiRefund: apiRefund.document_status,
  offset: apiOffset.amount,
  apOutstanding: apiPayable.outstanding_amount,
  apiAccount: apiAccount.current_balance,
}, {
  apiBalance: 5500,
  apiRefund: 'completed',
  offset: 1500,
  apOutstanding: 5300,
  apiAccount: 5000,
});

if (browserPrepayment || browserRefund) {
  assert.ok(browserPrepayment && browserRefund && browserAccount, 'browser supplier refund readback requires all browser ids');
  assert.deepEqual({ browserBalance: browserPrepayment.balance_amount, browserRefund: browserRefund.document_status, browserAccount: browserAccount.current_balance }, { browserBalance: 900, browserRefund: 'completed', browserAccount: 2100 });
}

report.restartVerification = {
  verifiedAt: new Date().toISOString(),
  status: 'passed',
  database: process.env.FORGE_DB,
  browserMaterial: browserPrepayment ? 'verified' : 'prepared-only; pending built-in-browser operation',
};
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS supplier prepayment and refund survived complete restart');
