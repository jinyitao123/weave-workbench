import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('@objectstack/cli'));
const { hashPassword } = await import(pathToFileURL(cliRequire.resolve('better-auth/crypto')).href);
const PG_PORT = Number(process.env.FORGE_INTEGRATION_PG_PORT || 5432);
const resultOf = response => response.value?.result?.result ?? response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;

test('CRM maintainability uses ordinary native HTTP permissions, RLS and FLS', {
  skip: process.env.FORGE_CRM_MAINTENANCE_PG_TEST !== '1' ? 'set FORGE_CRM_MAINTENANCE_PG_TEST=1 for isolated PostgreSQL' : false,
  timeout: 240_000,
}, async t => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const database = 'forge_crm_read_' + suffix;
  const temp = await mkdtemp(path.join(os.tmpdir(), 'forge-crm-read-'));
  const secrets = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
  const pgAdmin = new Client({ host: '127.0.0.1', port: PG_PORT, user: os.userInfo().username, database: 'postgres' });
  let pg, child, created = false, output = '';
  const safe = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[temporary credential omitted]'), String(value)).slice(-4000);
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise(resolve => child.once('close', resolve));
      child.kill('SIGTERM');
      await Promise.race([stopped, new Promise(resolve => setTimeout(resolve, 8000))]);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await stopped; }
    }
    await pg?.end();
    if (created) {
      await pgAdmin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1', [database]);
      await pgAdmin.query(`DROP DATABASE "${database}"`);
      assert.equal((await pgAdmin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0);
    }
    await pgAdmin.end();
    await rm(temp, { recursive: true, force: true });
  });
  await pgAdmin.connect();
  await pgAdmin.query(`CREATE DATABASE "${database}"`);
  created = true;
  pg = new Client({ host: '127.0.0.1', port: PG_PORT, user: os.userInfo().username, database });
  await pg.connect();
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  const databaseUrl = `postgresql://${encodeURIComponent(os.userInfo().username)}@127.0.0.1:${PG_PORT}/${database}`;
  secrets.push(databaseUrl);
  await writeFile(path.join(temp, 'package.json'), '{"type":"module"}\n');
  await symlink(path.join(APP_DIR, 'src'), path.join(temp, 'src'), 'dir');
  await symlink(path.join(APP_DIR, 'node_modules'), path.join(temp, 'node_modules'), 'dir');
  await writeFile(path.join(temp, 'objectstack.config.ts'), `
import stack from ${JSON.stringify(path.join(APP_DIR, 'objectstack.config.ts'))};
import { AppPlugin } from '@objectstack/runtime';
import { definePermissionSet } from '@objectstack/spec';
import { sharedForgeCorePlugin, sharedForgeCoreBundle } from ${JSON.stringify(path.join(APP_DIR, 'src/apps/shared-core.ts'))};
const own={allowRead:true,readScope:'own'},org={allowRead:true,readScope:'org'};
const readers=[
  {name:'test_crm_own',objects:{forge_customer:own,forge_contact:own}},
  {name:'test_crm_org',objects:{forge_customer:org,forge_contact:org}},
  {name:'test_crm_contact_only',objects:{forge_contact:own}},
  {name:'test_crm_parent_rls',objects:{forge_customer:org,forge_contact:own},rowLevelSecurity:[{name:'visible_customer',object:'forge_customer',operation:'select',using:"name != 'Blocked parent'"}]},
  {name:'test_crm_owner_mask',objects:{forge_customer:own,forge_contact:own},fields:{'forge_customer.owner_id':{readable:false},'forge_contact.owner_id':{readable:false}}},
  {name:'test_crm_parent_mask',objects:{forge_customer:own,forge_contact:own},fields:{'forge_contact.customer_id':{readable:false}}},
];
stack.plugins=stack.plugins.map(plugin=>plugin===sharedForgeCorePlugin?new AppPlugin({...sharedForgeCoreBundle,
  permissions:[...sharedForgeCoreBundle.permissions,...readers.map(definePermissionSet)],
}):plugin);
export default stack;
`);
  // The runtime runs in an empty directory; existing app .env files and
  // inherited deployment/database settings cannot select another database.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OS_|FORGE_|WEAVE_|PG|DATABASE_|TEST_DATABASE_)/.test(key)));
  child = spawn(process.execPath, [path.join(APP_DIR, 'node_modules/@objectstack/cli/bin/run.js'), 'serve', 'objectstack.config.ts', '--port', String(port), '--log-level', 'error'], {
    cwd: temp, env: { ...env, NODE_ENV: 'production', PGPASSFILE: '/dev/null', OS_HOME: path.join(temp, '.os-home'), OS_DATABASE_URL: databaseUrl,
      OS_SECRET_KEY: secrets[0], OS_AUTH_SECRET: secrets[1], OS_BASE_URL: origin, OS_TRUSTED_ORIGINS: origin,
      OS_ENVIRONMENT_ID: 'crm-read-' + suffix, OS_TENANCY_POSTURE: 'single', OS_SEED_ADMIN: 'false', OS_AUTOMATION_SCHEDULED_WORK_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) stream.setEncoding('utf8').on('data', chunk => { output = (output + chunk).slice(-10000); });
  let ready = false;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Isolated Runtime exited: ' + safe(output));
    try { ready = (await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.ok(ready, safe(output));
  const schemas = new Map();
  async function insert(table, values) {
    if (!schemas.has(table)) schemas.set(table, (await pg.query('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1', [table])).rows.map(row => row.column_name));
    const now = new Date().toISOString(), row = { id: randomUUID(), created_at: now, updated_at: now, ...values };
    const columns = schemas.get(table).filter(key => row[key] !== undefined);
    assert.ok(columns.length, 'registered native table ' + table);
    await pg.query(`INSERT INTO "${table}" (${columns.map(key => '"' + key + '"').join(',')}) VALUES (${columns.map((_, index) => '$' + (index + 1)).join(',')})`, columns.map(key => row[key]));
    return row.id;
  }
  const organizationId = await insert('sys_organization', { name: 'CRM read test', slug: 'crm-' + suffix });
  const foreignOrganizationId = await insert('sys_organization', { name: 'Other CRM read test', slug: 'crm-other-' + suffix });
  async function grant(userId, name) {
    const permission = (await pg.query('SELECT id FROM sys_permission_set WHERE name=$1 AND active=true', [name])).rows[0];
    assert.ok(permission, 'official Runtime registered permission ' + name);
    return insert('sys_user_permission_set', { user_id: userId, permission_set_id: permission.id, organization_id: organizationId });
  }
  let signInIp = 40;
  async function caller(label, reader, maintenance = true) {
    const email = `crm-${label}-${suffix}@example.test`, password = 'Crm-' + randomBytes(24).toString('hex') + '!';
    secrets.push(password);
    const userId = await insert('sys_user', { name: 'CRM ' + label, email, email_verified: true, banned: false, role: 'user', organization_id: null });
    await insert('sys_account', { user_id: userId, provider_id: 'credential', account_id: userId, password: await hashPassword(password) });
    await insert('sys_member', { user_id: userId, organization_id: organizationId, role: 'member' });
    if (reader) await grant(userId, reader);
    if (maintenance) await grant(userId, 'sales_crm_maintenance_operator');
    const signed = await fetch(origin + '/api/v1/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Forwarded-For': '198.51.100.' + signInIp++ }, body: JSON.stringify({ email, password }) });
    assert.equal(signed.status, 200, 'ordinary native caller signs in');
    assert.equal((await signed.json()).user?.id, userId);
    let cookie = signed.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
    secrets.push(cookie);
    const request = async (resource, method = 'GET', body) => {
      const response = await fetch(origin + '/api/v1' + resource, { method, headers: { Cookie: cookie, Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const next = response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
      if (next) { cookie = next; secrets.push(cookie); }
      return { status: response.status, value: await response.json().catch(() => null) };
    };
    assert.equal((await request('/auth/organization/set-active', 'POST', { organizationId })).status, 200);
    return { id: userId, request };
  }
  const invoke = (user, object, id) => user.request('/actions/forge_' + object + '/sales_' + object + '_can_maintain/' + id, 'POST', { params: {} });
  const denied = response => response.status >= 400 || resultOf(response)?.can_maintain === false;
  async function source(user, { customerName = 'Owned customer', customerOwner = user.id, contactOwner = user.id, organization = organizationId } = {}) {
    const categoryId = await insert('forge_customer_category', { name: 'Category', owner_id: user.id, organization_id: organization });
    const customer = await insert('forge_customer', { name: customerName, category_id: categoryId, responsible_id: customerOwner, owner_id: customerOwner, organization_id: organization });
    const contact = await insert('forge_contact', { name: 'Contact', customer_id: customer, responsible_id: contactOwner, owner_id: contactOwner, organization_id: organization });
    return { customer, contact };
  }

  await t.test('named eligibility adds no object/FLS rights and owned readable records return only the boolean', async () => {
    const operator = await caller('owner', 'test_crm_own');
    const records = await source(operator);
    for (const object of ['customer', 'contact']) {
      const response = await invoke(operator, object, records[object]);
      assert.equal(response.status, 200);
      assert.deepEqual(resultOf(response), { can_maintain: true });
    }
    const noReader = await caller('no-reader', '');
    const own = await source(noReader);
    assert.ok(denied(await invoke(noReader, 'customer', own.customer)), 'action eligibility alone cannot grant object read');
    const noCapability = await caller('no-capability', 'test_crm_own', false);
    const other = await source(noCapability);
    assert.equal((await noCapability.request('/data/forge_customer/' + other.customer)).status, 200);
    assert.ok(denied(await invoke(noCapability, 'customer', other.customer)), 'read rights alone cannot grant the action');
  });
  await t.test('readable other owners and cross-organization rows never become maintainable', async () => {
    const reader = await caller('org-reader', 'test_crm_org');
    const another = await caller('another', 'test_crm_own');
    const other = await source(another);
    assert.equal((await reader.request('/data/forge_customer/' + other.customer)).status, 200);
    assert.deepEqual(resultOf(await invoke(reader, 'customer', other.customer)), { can_maintain: false });
    assert.deepEqual(resultOf(await invoke(reader, 'contact', other.contact)), { can_maintain: false });
    const foreign = await source(reader, { organization: foreignOrganizationId });
    assert.ok(denied(await invoke(reader, 'customer', foreign.customer)));
    assert.ok(denied(await invoke(reader, 'contact', foreign.contact)));
  });
  await t.test('a readable owned contact cannot bypass its parent customer object grant or RLS', async () => {
    for (const reader of ['test_crm_contact_only', 'test_crm_parent_rls']) {
      const user = await caller(reader, reader);
      const records = await source(user, { customerName: 'Blocked parent' });
      assert.equal((await user.request('/data/forge_contact/' + records.contact)).status, 200);
      assert.ok((await user.request('/data/forge_customer/' + records.customer)).status >= 400, 'native parent read is actually refused');
      assert.ok(denied(await invoke(user, 'contact', records.contact)), 'the action must retain the native parent refusal');
    }
  });
  await t.test('unreadable ownership or parent relationship fields fail closed', async () => {
    for (const [reader, object, hidden] of [['test_crm_owner_mask', 'customer', 'owner_id'], ['test_crm_owner_mask', 'contact', 'owner_id'], ['test_crm_parent_mask', 'contact', 'customer_id']]) {
      const user = await caller(reader + object, reader);
      const records = await source(user);
      const read = await user.request('/data/forge_' + object + '/' + records[object]);
      assert.equal(read.status, 200);
      const record = read.value?.record ?? read.value?.data?.record;
      assert.ok(record && !(hidden in record), 'native FLS strips the required field');
      assert.ok(denied(await invoke(user, object, records[object])), 'trusted ownership reads must not restore denied fields');
    }
  });
});
