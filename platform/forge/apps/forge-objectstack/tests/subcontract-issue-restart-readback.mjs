import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/subcontract-issue-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true);
assert.equal(report.browserVerification?.status, 'passed');
const endpoint = process.env.FORGE_URL || 'http://localhost:4387';
const api = await connect(endpoint);
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}`);
  return response.value.record;
}
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, object);
  return (response.value.records || []).filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
}

const [apiIssue, browserIssue, rejectedIssue, sourceBalance, apiStock, browserStock, allIssues, allLines, allOutbounds, allIssueLogs, issueLedgers, stockLedgers] = await Promise.all([
  read('forge_subcontract_issue', report.ids.issue),
  read('forge_subcontract_issue', report.ids.browserIssue),
  read('forge_subcontract_issue', report.ids.rejectedIssue),
  read('forge_inventory_balance', report.ids.sourceBalance),
  read('forge_subcontract_stock_balance', report.ids.stockBalance),
  read('forge_subcontract_stock_balance', report.ids.browserStockBalance),
  find('forge_subcontract_issue'),
  find('forge_subcontract_issue_line'),
  find('forge_subcontract_outbound'),
  find('forge_subcontract_issue_log'),
  find('forge_inventory_ledger', { movement_type: 'subcontract_issue_outbound' }),
  find('forge_subcontract_stock_ledger', { movement_type: 'issue_inbound' }),
]);
assert.deepEqual([apiIssue.status, browserIssue.status, rejectedIssue.status], ['signed', 'signed', 'rejected']);
assert.deepEqual([sourceBalance.on_hand_quantity, sourceBalance.reserved_quantity, sourceBalance.available_quantity, sourceBalance.inventory_value], [22, 0, 22, 275]);
assert.deepEqual([apiStock.cumulative_issued_quantity, apiStock.on_hand_quantity, apiStock.inventory_value], [6, 6, 75]);
assert.deepEqual([browserStock.cumulative_issued_quantity, browserStock.on_hand_quantity, browserStock.inventory_value], [2, 2, 25]);
assert.deepEqual([allIssues.length, allLines.length, allOutbounds.length, allIssueLogs.length, issueLedgers.length, stockLedgers.length], [3, 3, 2, 10, 2, 2]);
report.restartVerification = {
  status: 'passed',
  verifiedAt: new Date().toISOString(),
  database: process.env.FORGE_DB || report.database,
  assertion: '同一 SQLite 完整停服并以生产模式重启后，API 与浏览器两张已签收发料单、一张已驳回单、两张委外出库单、原仓余额、两张供应商在外库存余额及双边流水均按原 ID 回读',
};
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
console.log('PASS subcontract issue and dual inventory state survived full server restart');
