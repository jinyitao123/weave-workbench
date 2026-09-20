import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const api = await connect();
const cases = [];
async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function findOne(object, field, value) {
  const query = new URLSearchParams({ $filter: JSON.stringify({ [field]: value }), $top: '20' });
  const result = await api.request(`/data/${object}?${query}`);
  assert.equal(result.status, 200, `${object} lookup`);
  const matches = result.value.records.filter(record => record[field] === value);
  assert.equal(matches.length, 1, `${object}.${field}=${value} should have exactly one record`);
  return matches[0];
}

const ids = {};
await test('sales team keeps the project customer owner and member count', async () => {
  const team = await findOne('forge_sales_team', 'code', 'TEAM-RM-20260913');
  ids.team = team.id;
  assert.equal(team.name, '项目客户销售团队');
  assert.equal(team.manager_id, api.userId);
  assert.equal(team.member_count, 1);
  assert.equal(team.status, 'active');
});

await test('sales target preserves contract and payment goals as draft', async () => {
  const target = await findOne('forge_sales_target', 'code', 'TARGET-RM-20260913');
  ids.target = target.id;
  assert.equal(target.target_type, 'personal');
  assert.equal(target.owner_user_id, api.userId);
  assert.equal(target.target_amount, 1000000);
  assert.equal(target.payment_target_amount, 800000);
  assert.equal(target.achieved_amount, 0);
  assert.equal(target.status, 'draft');
  assert.match(target.remarks || '', /83337/);
  assert.match(target.remarks || '', /66674/);
});

await test('goodwill order keeps customer, type, reason and workflow state', async () => {
  const order = await findOne('forge_goodwill_order', 'code', 'GW-FORGE-20260913');
  ids.goodwill = order.id;
  assert.equal(order.gift_type, 'onsite_support');
  assert.equal(order.reason, '项目交付后现场调试支持所需控制柜样件赠送。');
  assert.equal(order.item_summary, '800型柔性线控制柜 / 2 台');
  assert.equal(order.total_amount, 0);
  assert.ok(['pending_approval', 'approved', 'shipping', 'completed'].includes(order.status), `unexpected Goodwill status ${order.status}`);
  assert.equal(order.responsible_id, api.userId);
  const customer = (await api.request(`/data/forge_customer/${order.customer_id}`)).value.record;
  ids.customer = customer.id;
  assert.equal(customer.name, '苏州澄岳自动化装备有限公司');
  assert.equal(customer.customer_type, 'company');
  assert.equal(customer.responsible_id, api.userId);
  if (customer.category_id) ids.customerCategory = customer.category_id;
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(),
  kind: 'local-sales-management-business-readback',
  source: 'browser-created Forge records checked against live RISEMAP evidence captured on 2026-09-13',
  ids,
  cases,
  passed: cases.every(testCase => testCase.status === 'passed'),
  limitations: [
    'RISEMAP Goodwill order has been observed through approval and shipment to 发货中; Forge completion remains a local execution extension until RISEMAP completion is separately verified.',
    '金一涛 and Forge Dev Admin are treated as the same business user per project instruction.',
  ],
};
await writeFile('.objectstack/acceptance/sales-management-data-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
