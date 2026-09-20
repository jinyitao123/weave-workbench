import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const api = await connect(process.env.FORGE_URL || 'http://localhost:4486');
async function records(object) {
  const response = await api.request(`/data/${object}?$top=500`);
  assert.equal(response.status, 200, object);
  return response.value.records || [];
}

const [users, customers, members] = await Promise.all([
  records('sys_user'), records('forge_customer'), records('forge_customer_team_member'),
]);
const current = users.find((row) => row.id === api.userId);
const subordinate = users.find((row) => row.email === 'scope-subordinate@example.invalid');
assert.equal(subordinate?.manager_id, current.id, 'subordinate reporting line must survive restart');

const expected = {
  '范围验收-我负责': { owner: current.id, member: null },
  '范围验收-我参与': { member: current.id },
  '范围验收-下属负责': { owner: subordinate.id, member: null },
  '范围验收-下属参与': { member: subordinate.id },
};
for (const [name, rule] of Object.entries(expected)) {
  const customer = customers.find((row) => row.name === name);
  assert.ok(customer, `${name} missing after restart`);
  if (rule.owner) assert.equal(customer.responsible_id, rule.owner);
  if (rule.member) assert.ok(members.some((row) => row.customer_id === customer.id && row.user_id === rule.member && row.active !== false), `${name} membership missing`);
}

console.log(JSON.stringify({ suite: 'sales-customer-scopes-restart-readback', status: 'passed', customers: Object.keys(expected).length, memberships: members.length }, null, 2));
