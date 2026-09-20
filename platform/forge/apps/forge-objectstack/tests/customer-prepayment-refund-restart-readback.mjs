import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/customer-prepayment-refund-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true);
const api = await connect(process.env.FORGE_URL || 'http://localhost:4366');
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

const [apiPrepayment, apiRefund, apiOffset, apiReceivable, apiAccount, browserPrepayment, browserRefund, browserOffset, browserReceivable, browserAccount] = await Promise.all([
  read('forge_customer_prepayment', report.ids.prepayment),
  read('forge_customer_refund', report.ids.refund),
  read('forge_customer_prepayment_offset', report.ids.offset),
  read('forge_accounts_receivable', report.ids.receivable),
  read('forge_fund_account', report.ids.account),
  maybeRead('forge_customer_prepayment', report.ids.browserPrepayment),
  maybeRead('forge_customer_refund', report.ids.browserRefund),
  maybeRead('forge_customer_prepayment_offset', report.ids.browserOffset),
  maybeRead('forge_accounts_receivable', report.ids.browserReceivable),
  maybeRead('forge_fund_account', report.ids.browserAccount),
]);

assert.deepEqual({
  apiBalance: apiPrepayment.balance_amount,
  apiRefund: apiRefund.document_status,
  apiOffset: apiOffset.amount,
  apiAr: apiReceivable.outstanding_amount,
  apiAccount: apiAccount.current_balance,
}, {
  apiBalance: 5500,
  apiRefund: 'completed',
  apiOffset: 1500,
  apiAr: 4500,
  apiAccount: 8000,
});

if (browserPrepayment || browserRefund || browserOffset) {
  assert.ok(browserPrepayment && browserRefund && browserOffset && browserReceivable && browserAccount, 'browser customer refund readback requires all browser ids');
  assert.deepEqual({ browserBalance: browserPrepayment.balance_amount, browserRefund: browserRefund.document_status, browserOffset: browserOffset.amount, browserAr: browserReceivable.outstanding_amount, browserAccount: browserAccount.current_balance }, { browserBalance: 700, browserRefund: 'completed', browserOffset: 200, browserAr: 2800, browserAccount: 1900 });
}

report.restartVerification = {
  verifiedAt: new Date().toISOString(),
  status: 'passed',
  database: process.env.FORGE_DB,
  browserMaterial: browserPrepayment ? 'verified' : 'prepared-only; pending built-in-browser operation',
};
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS customer prepayment, receivable offset and refund survived complete restart');
