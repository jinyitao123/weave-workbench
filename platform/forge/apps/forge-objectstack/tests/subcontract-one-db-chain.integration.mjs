import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4416';
const database = process.env.FORGE_DB || '.objectstack/acceptance/subcontract-one-db-chain.sqlite';
const receiptReportPath = '.objectstack/acceptance/subcontract-receipt-report.json';
const orderReportPath = '.objectstack/acceptance/subcontract-order-report.json';
const inboundReportPath = '.objectstack/acceptance/subcontract-inbound-report.json';
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

function runScript(script, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`tests/${script}`], {
      cwd: process.cwd(),
      env: { ...process.env, FORGE_URL: endpoint, FORGE_DB: database, ...extraEnv },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${script} exited with ${code}`)));
  });
}

async function readReport(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function find(api, object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '500' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object} query`);
  return (response.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
}
async function invoke(api, object, action, id, params = {}) {
  const response = await api.request(`/actions/${object}/${action}/${id}`, 'POST', { params });
  assert.equal(response.status, 200, `${object}/${action}: ${JSON.stringify(response.value)}`);
  return response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
}

await runScript('subcontract-order.integration.mjs');
await runScript('subcontract-issue.integration.mjs');
await runScript('subcontract-receipt.integration.mjs');
await runScript('subcontract-inbound.integration.mjs', { FORGE_REUSE_RECEIPT: '1' });

const orderReport = await readReport(orderReportPath);
const receiptReport = await readReport(receiptReportPath);
const inboundReport = await readReport(inboundReportPath);
assert.equal(orderReport.passed, true, 'order stage failed');
assert.equal(receiptReport.passed, true, 'receipt stage failed');
assert.equal(inboundReport.passed, true, 'inbound stage failed');

const api = await connect(endpoint);
const [ncrs] = await Promise.all([
  find(api, 'forge_subcontract_ncr', { receipt_id: receiptReport.ids.receipt }),
]);
assert.equal(ncrs.length, 1, 'expected one NCR generated from the sample receipt');
const ncr = ncrs[0];
await invoke(api, 'forge_subcontract_ncr', 'subcontract_ncr_configure', ncr.id, {
  defect_level: 'major', defect_type: '尺寸超差', defect_description: '回厂不良待退货',
  disposition: 'return', disposition_quantity: 1, responsible_party: 'supplier',
  disposition_reason: '供应商退回不良件，待质量与供应商完成退货交接', loss_amount: 0,
  commercial_terms: '供应商承担退货物流责任',
});
await invoke(api, 'forge_subcontract_ncr', 'subcontract_ncr_submit', ncr.id);
await invoke(api, 'forge_subcontract_ncr', 'subcontract_ncr_review', ncr.id, { decision: 'approve', comment: '数量、责任和处置依据已复核' });
await invoke(api, 'forge_subcontract_ncr', 'subcontract_ncr_execute', ncr.id, { execution_note: '退货已登记，数量与来源回厂单核对一致' });

const reconciliationCode = process.env.FORGE_RECONCILIATION_CODE || 'REC-CHAIN-' + stamp + '-001';
const reconciliation = await invoke(api, 'forge_supplier', 'subcontract_reconciliation_create', orderReport.ids.supplier, {
  code: reconciliationCode,
  period_start: '2026-09-01', period_end: '2026-09-12',
  receipt_ids_json: JSON.stringify([receiptReport.ids.receipt]),
});
await invoke(api, 'forge_subcontract_reconciliation', 'subcontract_reconciliation_confirm', reconciliation.id, { confirmation_note: '回厂、NCR 处置和加工费来源已复核' });
const payableResult = await invoke(api, 'forge_subcontract_reconciliation', 'subcontract_reconciliation_generate_payable', reconciliation.id);

const [finalNcr, finalReceipt, finalReconciliation, finalPayables] = await Promise.all([
  find(api, 'forge_subcontract_ncr', { id: ncr.id }),
  find(api, 'forge_subcontract_receipt', { id: receiptReport.ids.receipt }),
  find(api, 'forge_subcontract_reconciliation', { id: reconciliation.id }),
  find(api, 'forge_accounts_payable', { reconciliation_id: reconciliation.id }),
]);
assert.equal(finalNcr[0]?.status, 'executed');
assert.equal(finalReceipt[0]?.status, 'stocked');
assert.equal(finalReconciliation[0]?.status, 'payable_generated');
assert.equal(finalPayables.length, 1);

const report = {
  suite: 'subcontract-one-db-chain',
  endpoint, database, passed: true, completedAt: new Date().toISOString(),
  stages: ['order', 'issue', 'supplier_signoff', 'receipt', 'inbound_confirm', 'ncr_disposition', 'reconciliation', 'payable'],
  ids: { order: orderReport.ids.customerSuppliedOrder, issue: orderReport.ids.issue, receipt: receiptReport.ids.receipt, inbound: inboundReport.ids.inbound, ncr: ncr.id, reconciliation: reconciliation.id, payable: finalPayables[0].id },
  result: { ncrStatus: finalNcr[0].status, receiptStatus: finalReceipt[0].status, reconciliationStatus: finalReconciliation[0].status, payableCode: finalPayables[0].code, payableAmount: finalReconciliation[0].payable_amount, generation: payableResult },
  boundary: 'This script proves the local Forge chain can be reproduced on one SQLite from order through payable. It does not prove RISEMAP write behavior, multi-account permissions, transaction atomicity, or full-order completion when planned quantities remain outstanding.',
};
await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/subcontract-one-db-chain-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
