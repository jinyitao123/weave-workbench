import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/otc-collection-settlement-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
const api = await connect(process.env.FORGE_URL || 'http://localhost:4359');

async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, object);
  return (response.value.records || []).filter((record) =>
    Object.entries(where).every(([key, value]) => record[key] === value),
  );
}

const project = (await find('forge_project', { code: 'PRJ-2026-002' }))[0];
const account = (await find('forge_fund_account', { code: 'FA-BROWSER-20260910' }))[0];
const invoice = (await find('forge_sales_invoice', { code: 'INV-BROWSER-20260910-001' }))[0];
const receivable = (await find('forge_accounts_receivable', { code: 'AR-INV-BROWSER-20260910-001' }))[0];
const receipt = (await find('forge_cash_receipt', { code: 'CR-BROWSER-20260910-001' }))[0];
const allocation = (await find('forge_collection_allocation', { code: 'CA-BROWSER-20260910-001' }))[0];
const settlement = (await find('forge_project_settlement', { code: 'PST-BROWSER-20260910' }))[0];

assert.ok(project && account && invoice && receivable && receipt && allocation && settlement);
assert.deepEqual(
  {
    project: project.status,
    projectInvoice: project.invoice_amount,
    projectCollected: project.collected_amount,
    account: account.current_balance,
    invoice: invoice.status,
    invoiceOutstanding: invoice.outstanding_amount,
    receivable: receivable.status,
    receivableOutstanding: receivable.outstanding_amount,
    receipt: receipt.status,
    receiptUnallocated: receipt.unallocated_amount,
    allocation: allocation.status,
    settlement: settlement.status,
  },
  {
    project: 'settled',
    projectInvoice: 121600,
    projectCollected: 121600,
    account: 121600,
    invoice: 'settled',
    invoiceOutstanding: 0,
    receivable: 'settled',
    receivableOutstanding: 0,
    receipt: 'allocated',
    receiptUnallocated: 0,
    allocation: 'approved',
    settlement: 'settled',
  },
);
assert.equal(receipt.account_id, account.id);
assert.equal(allocation.receipt_id, receipt.id);
assert.equal(allocation.receivable_id, receivable.id);
assert.equal(settlement.project_id, project.id);
assert.equal(settlement.gross_margin, 121600 - settlement.production_cost);

report.ids.browserProject = project.id;
report.ids.browserAccount = account.id;
report.ids.browserInvoice = invoice.id;
report.ids.browserReceivable = receivable.id;
report.ids.browserReceipt = receipt.id;
report.ids.browserAllocation = allocation.id;
report.ids.browserSettlement = settlement.id;
report.browserVerification = {
  verifiedAt: new Date().toISOString(),
  status: 'passed',
  page: 'page_collection_settlement_workspace',
  actions: ['创建并选用账户', '验收开票', '登记收款', '分配到应收', '审核核销', '确认项目结算'],
  assertion: 'browser independently settled PRJ-2026-002 from acceptance invoice through physical receipt, allocation approval, receivable writeoff and margin snapshot',
};
if (process.argv.includes('--restart')) {
  report.browserVerification.restartReadback = {
    verifiedAt: new Date().toISOString(),
    status: 'passed',
    assertion: 'browser-created account, invoice, receivable, receipt, approved allocation and project settlement remained API-readable after full restart',
  };
}
await writeFile(path, JSON.stringify(report, null, 2));
console.log(`PASS browser OTC collection and settlement${process.argv.includes('--restart') ? ' survived restart' : ' persisted'}`);
