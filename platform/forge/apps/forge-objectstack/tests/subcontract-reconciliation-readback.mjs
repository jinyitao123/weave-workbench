import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4399';
const database = process.env.FORGE_DB || '.objectstack/subcontract-product-sample.sqlite';
const api = await connect(endpoint);

async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '500' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object} query`);
  return (response.value.records || []).filter(record => Object.entries(where).every(([key, value]) => record[key] === value));
}

const requestedReconciliationCode = process.env.FORGE_RECONCILIATION_CODE;
const [orders, reconciliations, lines, payables, logs] = await Promise.all([
  find('forge_subcontract_order'),
  find('forge_subcontract_reconciliation'),
  find('forge_subcontract_reconciliation_line'),
  find('forge_accounts_payable'),
  find('forge_subcontract_reconciliation_log'),
]);

let reconciliation = requestedReconciliationCode
  ? reconciliations.find(row => row.code === requestedReconciliationCode)
  : undefined;
if (!reconciliation) {
  reconciliation = reconciliations
    .filter(row => row.status === 'payable_generated' && row.payable_id)
    .sort((left, right) => String(right.updated_at || right.created_at || right.id).localeCompare(String(left.updated_at || left.created_at || left.id)))[0];
}
assert.ok(reconciliation, requestedReconciliationCode ? `expected reconciliation ${requestedReconciliationCode}` : 'expected a payable generated subcontract reconciliation');
assert.equal(reconciliation.status, 'payable_generated');

const payable = payables.find(row => row.id === reconciliation.payable_id || row.reconciliation_id === reconciliation.id);
assert.ok(payable, `expected payable for reconciliation ${reconciliation.code}`);
assert.equal(reconciliation.payable_id, payable.id);
assert.equal(payable.reconciliation_id, reconciliation.id);
assert.equal(payable.source_type, 'subcontract_reconciliation');

const sourceLines = lines.filter(line => line.reconciliation_id === reconciliation.id);
const sourceLineIds = sourceLines.map(line => line.receipt_line_id);
assert.equal(sourceLines.length, Number(reconciliation.line_count));
assert.equal(new Set(sourceLineIds).size, sourceLineIds.length, 'source receipt lines must be unique');
assert.ok(sourceLines.every(line => line.source_key?.startsWith('receipt-line:')));

const relatedOrders = [...new Set(sourceLines.map(line => line.order_id))].map(id => orders.find(order => order.id === id)).filter(Boolean);
assert.ok(relatedOrders.length, 'expected linked subcontract orders');
for (const order of relatedOrders) {
  assert.ok(order.status, `expected business status for order ${order.code || order.id}`);
  assert.ok(Number(order.reconciled_amount || 0) >= 0, 'order reconciled amount should be numeric');
}

const auditLogs = logs.filter(log => log.reconciliation_id === reconciliation.id);
auditLogs.sort((left, right) => String(left.occurred_at).localeCompare(String(right.occurred_at)));
assert.deepEqual(auditLogs.map(log => log.action), ['generated', 'confirmed', 'payable_generated']);

const report = {
  recordedAt: new Date().toISOString(),
  kind: 'subcontract-reconciliation-restart-readback',
  status: 'passed',
  endpoint,
  database,
  ids: {
    orders: relatedOrders.map(order => order.id),
    reconciliation: reconciliation.id,
    sourceLines: sourceLines.map(line => line.id),
    payable: payable.id,
    auditLogs: auditLogs.map(log => log.id),
  },
  result: {
    reconciliationCode: reconciliation.code,
    reconciliationStatus: reconciliation.status,
    payableCode: payable.code,
    payableStatus: payable.status,
    payableAmount: reconciliation.payable_amount,
    lineCount: sourceLines.length,
    orderStatuses: relatedOrders.map(order => ({ code: order.code, status: order.status, reconciled_amount: order.reconciled_amount })),
  },
  boundary: 'This readback proves that the same Forge service can recover a saved subcontract reconciliation, source lines, order settlement amount, payable link and audit sequence from the current local database. It does not prove RISEMAP write behavior.',
};

await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/subcontract-reconciliation-readback-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
