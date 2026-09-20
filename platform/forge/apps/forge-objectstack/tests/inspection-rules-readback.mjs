import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4386';
const api = await connect(endpoint);
async function find(object) {
  const response = await api.request(`/data/${object}?$top=500`);
  assert.equal(response.status, 200, `${object} should be readable`);
  return response.value.records || [];
}

const [items, plans, links] = await Promise.all([
  find('forge_inspection_rule_item'),
  find('forge_inspection_plan'),
  find('forge_inspection_plan_item'),
]);
const item = items.find(row => row.code === 'IQI-FORGE-20260915-001');
const plan = plans.find(row => row.code === 'IQP-FORGE-20260915-001');
assert.ok(item, 'browser-created inspection item must survive');
assert.equal(item.status, 'active');
assert.equal(item.required_inspection, true);
assert.equal(item.affects_batch_result, true);
assert.equal(item.trigger_ncr, true);
assert.ok(plan, 'browser-created inspection plan must survive');
assert.equal(plan.status, 'active');
assert.equal(plan.inspection_type, 'incoming');
assert.equal(plan.inspection_method, 'full');
assert.ok(links.some(row => row.plan_id === plan.id && row.item_id === item.id), 'plan must retain its inspection item source');
console.log(JSON.stringify({ suite: 'inspection-rules-readback', status: 'passed', endpoint, items: items.length, plans: plans.length, links: links.length }, null, 2));
