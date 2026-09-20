import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/subcontract-order-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true);
assert.equal(report.browserVerification?.status, 'passed');
const endpoint = process.env.FORGE_URL || 'http://localhost:4386';
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

const [profile, customerOrder, turnkeyOrder, browserOrder, browserLine, browserPlan, allOrders, allLines, allPlans, allLogs] = await Promise.all([
  read('forge_subcontract_supplier_profile', report.ids.profile),
  read('forge_subcontract_order', report.ids.customerSuppliedOrder),
  read('forge_subcontract_order', report.ids.turnkeyOrder),
  read('forge_subcontract_order', report.ids.browserOrder),
  read('forge_subcontract_order_line', report.ids.browserLine),
  read('forge_subcontract_material_plan', report.ids.browserPlan),
  find('forge_subcontract_order'),
  find('forge_subcontract_order_line'),
  find('forge_subcontract_material_plan'),
  find('forge_subcontract_order_approval_log'),
]);
assert.deepEqual([profile.status, profile.supplier_id, profile.process_capabilities], ['active', report.ids.supplier, '钣金折弯、喷涂']);
assert.deepEqual([customerOrder.status, customerOrder.processing_amount, customerOrder.issue_planned_quantity], ['approved', 355, 20]);
assert.deepEqual([turnkeyOrder.status, turnkeyOrder.processing_amount, turnkeyOrder.issue_planned_quantity], ['approved', 60, 0]);
assert.deepEqual([browserOrder.status, browserOrder.processing_amount, browserOrder.issue_planned_quantity], ['approved', 177, 4]);
assert.deepEqual([browserLine.subtotal, browserLine.expected_delivery_on, browserPlan.planned_quantity, browserPlan.standard_quantity], [177, '2026-10-10', 4, 3.8]);
assert.equal(allOrders.length, 3);
assert.equal(allLines.length, 3);
assert.equal(allPlans.length, 2);
assert.equal(allLogs.length, 8);
report.restartVerification = {
  status: 'passed',
  verifiedAt: new Date().toISOString(),
  database: process.env.FORGE_DB || report.database,
  assertion: '同一 SQLite 完整停服并以生产模式重启后，委外供应商能力档案、三张已审核订单、三条加工件、两条甲供料计划和八条审核日志均按原 ID 回读',
};
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
console.log('PASS subcontract supplier and order state survived full server restart');
