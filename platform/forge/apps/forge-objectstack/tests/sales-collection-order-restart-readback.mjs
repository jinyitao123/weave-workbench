import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const reportPath = '.objectstack/acceptance/sales-collection-report.json';
const report = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(report.passed, true);
const api = await connect();
const read = async (object, id) => {
  const response = await api.request(`/data/${object}/${id}`); assert.equal(response.status, 200); return response.value.record;
};
for (const key of ['firstReceivable', 'secondReceivable']) {
  const receivable = await read('forge_accounts_receivable', report.ids[key]);
  assert.deepEqual({ collected: receivable.collected_amount, outstanding: receivable.outstanding_amount, status: receivable.status },
    { collected: 121600, outstanding: 0, status: 'settled' });
  const invoice = await read('forge_sales_invoice', receivable.invoice_id);
  assert.deepEqual({ collected: invoice.collected_amount, outstanding: invoice.outstanding_amount, status: invoice.status },
    { collected: 121600, outstanding: 0, status: 'settled' });
}
assert.equal((await read('forge_sales_order', report.ids.order)).collected_amount, 243200);
assert.equal((await read('forge_sales_contract', report.ids.contract)).collected_amount, 243200);
assert.equal((await read('forge_fund_account', report.ids.account)).current_balance, 243200);
for (const key of ['firstAllocation', 'secondAllocation']) assert.equal((await read('forge_collection_allocation', report.ids[key])).status, 'approved');
report.restartVerification = { passed: true, at: new Date().toISOString(), database: process.env.FORGE_DB };
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log('PASS sales collection and write-off after restart');
