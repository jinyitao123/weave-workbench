import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4401';
const database = process.env.FORGE_DB || 'fixture database supplied by the caller';
const actionCode = `REC-BLOCK-${Date.now()}`;
const api = await connect(endpoint);

async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '500' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object} query`);
  return (response.value.records || []).filter(record => Object.entries(where).every(([key, value]) => record[key] === value));
}

const [suppliers, receipts, receiptLines, inbounds, ncrs, reconciliationLines, reconciliations, orders] = await Promise.all([
  find('forge_supplier'),
  find('forge_subcontract_receipt'),
  find('forge_subcontract_receipt_line'),
  find('forge_subcontract_inbound'),
  find('forge_subcontract_ncr'),
  find('forge_subcontract_reconciliation_line'),
  find('forge_subcontract_reconciliation'),
  find('forge_subcontract_order'),
]);
assert.ok(suppliers.length, 'expected at least one supplier');
assert.ok(receipts.length, 'expected at least one subcontract receipt');

const activeReconciliationIds = new Set(reconciliations.filter(row => row.status !== 'voided').map(row => row.id));
function blockingReasons(receipt) {
  const lines = receiptLines.filter(line => line.receipt_id === receipt.id);
  const line = lines.find(row => Number(row.qualified_quantity || 0) > 0) || lines[0];
  const inbound = inbounds.find(row => row.id === receipt.inbound_id);
  const relatedNcrs = ncrs.filter(row => row.receipt_id === receipt.id);
  const reasons = [];
  if (!['stocked', 'ncr_resolved'].includes(receipt.status)) reasons.push({ reason: '回厂尚未完成入库或不良处置', expectedMessage: '回厂入库或不良处置' });
  if (Number(line?.qualified_quantity || 0) > 0 && (!inbound || inbound.status !== 'stocked')) reasons.push({ reason: '良品尚未完成正式入库', expectedMessage: '正式入库' });
  if (relatedNcrs.some(row => row.status !== 'executed')) reasons.push({ reason: '存在未完成的不良处置', expectedMessage: '不良处置' });
  if (!Number(line?.qualified_quantity || 0)) reasons.push({ reason: '没有可结算的合格回厂明细', expectedMessage: '合格回厂明细' });
  if (lines.some(lineRow => reconciliationLines.some(recLine => recLine.receipt_line_id === lineRow.id && activeReconciliationIds.has(recLine.reconciliation_id)))) reasons.push({ reason: '来源明细已被有效对账单占用', expectedMessage: '有效委外对账单占用' });
  return reasons;
}

const requestedReceiptCode = process.env.FORGE_BLOCK_RECEIPT_CODE;
let candidate = requestedReceiptCode ? receipts.find(row => row.code === requestedReceiptCode) : undefined;
let reasons = candidate ? blockingReasons(candidate) : [];
if (!candidate || !reasons.length) {
  candidate = receipts.map(receipt => ({ receipt, reasons: blockingReasons(receipt) })).find(item => item.reasons.length)?.receipt;
  reasons = candidate ? blockingReasons(candidate) : [];
}
assert.ok(candidate, 'expected a current blocked subcontract receipt fixture');
assert.ok(reasons.length, `expected ${candidate.code} to have a blocking reason`);

const supplier = suppliers.find(row => row.id === candidate.supplier_id);
assert.ok(supplier, `expected supplier for blocked receipt ${candidate.code}`);

const snapshot = async () => {
  const [nextReconciliations, nextLines, logs, payables, nextOrders] = await Promise.all([
    find('forge_subcontract_reconciliation'),
    find('forge_subcontract_reconciliation_line'),
    find('forge_subcontract_reconciliation_log'),
    find('forge_accounts_payable'),
    find('forge_subcontract_order'),
  ]);
  return {
    reconciliations: nextReconciliations.length,
    lines: nextLines.length,
    logs: logs.length,
    payables: payables.filter(payable => payable.reconciliation_id).length,
    orders: nextOrders.map(order => ({ id: order.id, status: order.status, reconciled_amount: order.reconciled_amount })),
  };
};

const before = await snapshot();
const response = await api.request(`/actions/forge_supplier/subcontract_reconciliation_create/${supplier.id}`, 'POST', {
  params: {
    code: actionCode,
    period_start: '2026-09-01',
    period_end: '2026-09-12',
    receipt_ids_json: JSON.stringify([candidate.id]),
  },
});
assert.equal(response.status, 400, JSON.stringify(response.value));
const errorMessage = response.value.error?.message || response.value.message || '';
assert.ok(reasons.some(item => errorMessage.includes(item.expectedMessage)), `expected business blocking message for ${candidate.code}, got ${errorMessage}`);
const after = await snapshot();
assert.deepEqual(after, before, 'blocked reconciliation must not leave partial writes');

const report = {
  recordedAt: new Date().toISOString(),
  kind: 'subcontract-reconciliation-blocking-acceptance',
  status: 'passed',
  endpoint,
  database,
  fixture: { supplier_id: supplier.id, supplier_code: supplier.code, receipt_id: candidate.id, receipt_code: candidate.code, reasons: reasons.map(item => item.reason) },
  http: { status: response.status, error: errorMessage },
  noMutation: true,
  before,
  after,
  boundary: 'This acceptance proves the server-side blocking rule and no-partial-write result for a current local blocked receipt. Browser feedback and RISEMAP write behavior remain separate evidence layers.',
};
await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/subcontract-reconciliation-block-current-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
