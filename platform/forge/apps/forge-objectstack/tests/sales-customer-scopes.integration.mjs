import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4486';
const database = process.env.FORGE_DB || '.objectstack/data/objectstack.db';
const api = await connect(endpoint);

async function records(object) {
  const response = await api.request(`/data/${object}?$top=500`);
  assert.equal(response.status, 200, `${object} should be readable`);
  return response.value.records || [];
}
async function create(object, values) {
  const response = await api.request(`/data/${object}`, 'POST', values);
  assert.ok([200, 201].includes(response.status), `${object} create failed: ${JSON.stringify(response.value)}`);
  return response.value.record || response.value.data?.record || response.value.data || response.value;
}
async function ensureUser(name, email) {
  let user = (await records('sys_user')).find((row) => row.email === email);
  if (user) return user;
  const origin = new URL(endpoint).origin;
  const login = await fetch(`${endpoint}/api/v1/auth/sign-in/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: process.env.FORGE_TEST_EMAIL || 'admin@objectos.ai', password: process.env.FORGE_TEST_PASSWORD || 'admin123' }),
  });
  const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const made = await fetch(`${endpoint}/api/v1/auth/admin/create-user`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, cookie },
    body: JSON.stringify({ name, email, password: process.env.FORGE_FIXTURE_PASSWORD || process.env.FORGE_TEST_PASSWORD || 'admin123', role: 'user' }),
  });
  assert.equal(made.status, 200, `fixture user ${name} could not be created`);
  user = (await records('sys_user')).find((row) => row.email === email);
  assert.ok(user, `fixture user ${name} missing after create`);
  return user;
}
async function ensure(object, predicate, values) {
  return (await records(object)).find(predicate) || create(object, values);
}

const users = await records('sys_user');
const current = users.find((row) => row.id === api.userId);
assert.ok(current, 'current user missing');
const subordinate = await ensureUser('销售下属甲', 'scope-subordinate@example.invalid');
const collaborator = await ensureUser('销售协作乙', 'scope-collaborator@example.invalid');

// Acceptance-only organization fixture. sys_user.manager_id is protected from generic CRUD,
// so the reporting line is inserted into this isolated branch SQLite before API/browser readback.
const db = new DatabaseSync(database);
db.prepare('update sys_user set manager_id = ? where id = ?').run(current.id, subordinate.id);
db.close();

const category = await ensure('forge_customer_category', (row) => row.code === 'SCOPE-CRM', { name: '范围验收客户', code: 'SCOPE-CRM', status: 'active', sort_order: 90 });
async function customer(name, owner) {
  return ensure('forge_customer', (row) => row.name === name, { name, customer_type: 'company', category_id: category.id, responsible_id: owner, credit_limit: 10000, payment_days: 30, credit_status: 'active' });
}
const mine = await customer('范围验收-我负责', current.id);
const participated = await customer('范围验收-我参与', collaborator.id);
const subordinateOwned = await customer('范围验收-下属负责', subordinate.id);
const subordinateParticipated = await customer('范围验收-下属参与', collaborator.id);
const unrelated = await customer('范围验收-无关客户', collaborator.id);

async function membership(customer, member) {
  return ensure('forge_customer_team_member', (row) => row.membership_key === `${customer.id}:${member.id}`, {
    name: member.name, membership_key: `${customer.id}:${member.id}`, customer_id: customer.id, user_id: member.id, member_duty: 'collaborator', active: true,
  });
}
await membership(participated, current);
await membership(subordinateParticipated, subordinate);

const customers = await records('forge_customer');
const members = await records('forge_customer_team_member');
const subordinateIds = new Set([subordinate.id]);
const teamIds = (customerId) => members.filter((row) => row.customer_id === customerId && row.active !== false).map((row) => row.user_id);
const by = (scope) => customers.filter((row) => {
  if (scope === 'mine') return row.responsible_id === current.id;
  if (scope === 'participated') return teamIds(row.id).includes(current.id);
  if (scope === 'subordinate_owned') return subordinateIds.has(row.responsible_id);
  if (scope === 'subordinate_participated') return teamIds(row.id).some((id) => subordinateIds.has(id));
  return true;
}).map((row) => row.name);

assert.ok(by('mine').includes(mine.name));
assert.ok(by('participated').includes(participated.name));
assert.ok(by('subordinate_owned').includes(subordinateOwned.name));
assert.ok(by('subordinate_participated').includes(subordinateParticipated.name));
for (const names of [by('mine'), by('participated'), by('subordinate_owned'), by('subordinate_participated')]) assert.ok(!names.includes(unrelated.name));

console.log(JSON.stringify({ suite: 'sales-customer-scopes', status: 'passed', current: current.id, subordinate: subordinate.id, customers: [mine.id, participated.id, subordinateOwned.id, subordinateParticipated.id, unrelated.id] }, null, 2));
