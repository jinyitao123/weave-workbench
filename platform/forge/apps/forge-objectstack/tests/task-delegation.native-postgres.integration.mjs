import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from 'pg';

// Decision 002 (weave-workbench): Forge-issued task delegations on the real
// ObjectStack runtime and PostgreSQL. Covers issue, retry rotation, the entry,
// action and data guards, native revocation, and that the employee's desktop
// session is never affected.
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const PG_PORT = Number(process.env.FORGE_TASK_DELEGATION_PG_PORT || 55439);
const PG_USER = process.env.FORGE_TASK_DELEGATION_PG_USER || 'postgres';
const ISSUER = 'forge:task-delegation-test';
const digest = (value) => createHash('sha256').update(value).digest('hex');

function mcpText(result) {
  return String(result?.content?.find((item) => item.type === 'text')?.text || result?._rpcError?.message || '');
}

test('Forge task delegations are scoped, rotated and revoked natively', {
  skip: process.env.FORGE_TASK_DELEGATION_PG_TEST !== '1'
    ? 'set FORGE_TASK_DELEGATION_PG_TEST=1 for the isolated local PostgreSQL 16 runtime test'
    : false,
  timeout: 600_000,
}, async (t) => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const database = `forge_task_delegation_${suffix}`;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'forge-task-delegation-'));
  const adminEmail = `delegation-admin-${suffix}@example.test`;
  const adminPassword = `Td-${randomBytes(18).toString('hex')}!`;
  const pgAdmin = new Client({ host: HOST, port: PG_PORT, database: 'postgres', user: PG_USER });
  let child;
  let db;
  let output = '';
  await pgAdmin.connect();
  await pgAdmin.query(`CREATE DATABASE "${database}"`);
  t.after(async () => {
    await db?.end().catch(() => {});
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 8_000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await pgAdmin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [database]);
    await pgAdmin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await pgAdmin.end();
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(path.join(tempDir, 'package.json'), '{"name":"forge-task-delegation-test","type":"module"}\n');
  await symlink(path.join(APP_DIR, 'src'), path.join(tempDir, 'src'), 'junction');
  await symlink(path.join(APP_DIR, 'node_modules'), path.join(tempDir, 'node_modules'), 'junction');
  await writeFile(path.join(tempDir, 'objectstack.config.ts'), `export { default } from ${JSON.stringify(path.join(APP_DIR, 'objectstack.config.ts'))};\n`);

  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, HOST, resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const origin = `http://${HOST}:${port}`;
  const password = process.env.PGPASSWORD ? `:${encodeURIComponent(process.env.PGPASSWORD)}` : '';
  child = spawn(process.execPath, [
    path.join(APP_DIR, 'node_modules/@objectstack/cli/bin/run.js'),
    'dev', '--seed-admin', '--port', String(port), '--database-driver', 'postgres',
    '--admin-email', adminEmail, '--admin-password', adminPassword,
    '--auth-secret', randomBytes(32).toString('hex'), '--log-level', 'error',
  ], {
    cwd: tempDir,
    env: {
      ...process.env,
      OS_HOME: path.join(tempDir, '.os-home'),
      OS_DATABASE_URL: `postgres://${PG_USER}${password}@${HOST}:${PG_PORT}/${database}`,
      OS_SECRET_KEY: randomBytes(32).toString('hex'),
      OS_BASE_URL: origin, OS_TRUSTED_ORIGINS: origin,
      OS_ENVIRONMENT_ID: `task-delegation-${suffix}`,
      FORGE_IDENTITY_ISSUER: ISSUER,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output = (output + chunk).slice(-10_000); });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output = (output + chunk).slice(-10_000); });
  const deadline = Date.now() + 420_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated runtime exited (${child.exitCode}).\n${output.replaceAll(adminPassword, '[secret]')}`);
    try { if ((await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(1_000) })).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'isolated runtime became ready');

  async function signIn(email, secret) {
    const response = await fetch(`${origin}/api/v1/auth/sign-in/email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ email, password: secret }),
    });
    const value = await response.json();
    assert.ok(response.ok && value.token && value.user?.id, `sign-in returned ${response.status}`);
    return { token: value.token, userId: value.user.id };
  }
  async function call(token, resource, method = 'GET', body) {
    const response = await fetch(`${origin}/api/v1${resource}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, value: await response.json().catch(() => null) };
  }
  async function mcp(token, name, args) {
    const send = async (method, params, id) => {
      const response = await fetch(`${origin}/api/v1/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-03-26' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(id ? { id } : {}) }),
      });
      const raw = await response.text();
      const line = raw.split(/\r?\n/).filter((item) => item.startsWith('data:')).map((item) => item.slice(5).trim()).at(-1) ?? raw;
      let value = null;
      try { value = JSON.parse(line); } catch {}
      return { status: response.status, value };
    };
    const initialized = await send('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'task-delegation-test', version: '1' } }, 1);
    if (initialized.status !== 200) return { status: initialized.status };
    const result = await send('tools/call', { name, arguments: args }, 2);
    return { status: result.status, result: result.value?.result ?? { _rpcError: result.value?.error } };
  }

  const inactive = async (token) => {
    const result = await call(token, '/auth/me/permissions');
    return result.status === 401 || result.value?.authenticated === false;
  };
  const admin = await signIn(adminEmail, adminPassword);
  const identity = await fetch(`${origin}/api/v1/workbench/identity-source`).then(async (r) => ({ status: r.status, value: await r.json() }));
  assert.deepEqual(identity, { status: 200, value: { version: '1', issuer: ISSUER } }, 'stable identity source is served');

  // A second employee in the same organization, for isolation checks.
  const peerEmail = `delegation-peer-${suffix}@example.test`;
  const peerPassword = `Tp-${randomBytes(18).toString('hex')}!`;
  const createdPeer = await call(admin.token, '/auth/admin/create-user', 'POST', { name: '委托隔离测试同事', email: peerEmail, password: peerPassword, role: 'user', mustChangePassword: false });
  assert.ok(createdPeer.status < 300, `peer creation returned ${createdPeer.status}`);
  const peerId = createdPeer.value?.data?.user?.id;
  await call(admin.token, '/auth/admin/set-user-password', 'POST', { userId: peerId, newPassword: peerPassword, mustChangePassword: false });
  const session = await call(admin.token, '/auth/get-session');
  const organizationId = session.value?.session?.activeOrganizationId;
  assert.ok(organizationId, 'admin has an active organization');
  db = new Client({ host: HOST, port: PG_PORT, database, user: PG_USER });
  db.on('error', () => {});
  await db.connect();
  const membership = await db.query('SELECT id FROM sys_member WHERE user_id = $1 AND organization_id = $2 LIMIT 1', [peerId, organizationId]);
  if (!membership.rows[0]) await db.query('INSERT INTO sys_member (id, organization_id, user_id, role) VALUES ($1, $2, $3, $4)', [randomUUID(), organizationId, peerId, 'member']);
  const peer = await signIn(peerEmail, peerPassword);
  await call(peer.token, '/auth/organization/set-active', 'POST', { organizationId });

  // Two leads owned by the employee: one delegated, one not.
  const category = await call(admin.token, '/data/forge_customer_category', 'POST', { name: '项目客户', code: 'CUST-CAT-PROJECT', status: 'active' });
  assert.ok(category.status < 300, `category creation returned ${category.status}`);
  const lead = async (label) => {
    const created = await call(admin.token, '/data/forge_sales_lead', 'POST', {
      name: `${label}线索`, code: `LEAD-${suffix}-${label}`, company_name: `${label}公司-${suffix}`, contact_name: '测试联系人',
      phone: '13800000000', source: '委托隔离测试', responsible_id: admin.userId,
    });
    const id = created.value?.id ?? created.value?.record?.id ?? created.value?.data?.id;
    assert.ok(id, `lead creation returned ${created.status}`);
    return id;
  };
  const conversionSet = await db.query("SELECT id FROM sys_permission_set WHERE name = 'sales_lead_conversion_operator'");
  assert.ok(conversionSet.rows[0]?.id, 'conversion permission set is provisioned');
  const granted = await call(admin.token, '/data/sys_user_permission_set', 'POST', {
    user_id: admin.userId, permission_set_id: conversionSet.rows[0].id, granted_by: admin.userId,
    reason: '委托隔离测试夹具', organization_id: organizationId,
  });
  assert.ok(granted.status < 300, `permission grant returned ${granted.status}`);
  const delegatedLead = await lead('委托');
  const otherLead = await lead('范围外');
  const action = { objectName: 'forge_sales_lead', actionName: 'sales_lead_convert_to_opportunity' };
  const idempotencyKey = randomUUID();
  const request = {
    version: '1', idempotencyKey, inputDigest: digest(`input-${suffix}`), actions: [action],
    record: { objectName: 'forge_sales_lead', recordId: delegatedLead }, files: [],
  };

  // Issue: unknown actions and other people's records are refused.
  assert.equal((await call(admin.token, '/workbench/task-delegations', 'POST', { ...request, idempotencyKey: randomUUID(), actions: [{ objectName: 'forge_sales_lead', actionName: 'not_an_action' }] })).status, 422);
  assert.equal((await call(peer.token, '/workbench/task-delegations', 'POST', { ...request, idempotencyKey: randomUUID() })).status, 403,
    'a record the caller cannot see is refused');
  const issued = await call(admin.token, '/workbench/task-delegations', 'POST', request);
  assert.equal(issued.status, 201, `issue returned ${issued.status} ${JSON.stringify(issued.value)}`);
  assert.equal(issued.value.issuer, ISSUER);
  assert.equal(issued.value.deduplicated, false);
  const firstToken = issued.value.credential;
  assert.notEqual(firstToken, admin.token, 'task credential is a separate session');
  const ledger = await db.query('SELECT token_sha256, employee_id FROM forge_task_delegation WHERE delegation_id = $1', [issued.value.delegationId]);
  assert.equal(ledger.rows[0]?.token_sha256, digest(firstToken), 'only the credential digest is stored');

  // Retry with the same input rotates the credential; a changed input conflicts.
  const retried = await call(admin.token, '/workbench/task-delegations', 'POST', request);
  assert.equal(retried.status, 200);
  assert.equal(retried.value.deduplicated, true);
  assert.equal(retried.value.delegationId, issued.value.delegationId);
  const token = retried.value.credential;
  assert.notEqual(token, firstToken);
  assert.ok(await inactive(firstToken), 'rotated credential stops working');
  assert.equal((await call(admin.token, '/workbench/task-delegations', 'POST', { ...request, inputDigest: digest('other') })).status, 409);
  assert.equal((await call(token, '/workbench/task-delegations', 'POST', { ...request, idempotencyKey: randomUUID() })).status, 403,
    'a task credential cannot issue delegations');

  // Guard 1: only the paths a team member needs.
  const permissions = await call(token, '/auth/me/permissions');
  assert.equal(permissions.status, 200);
  assert.equal(permissions.value?.userId, admin.userId, 'task credential acts as the same employee');
  assert.equal((await call(token, `/data/forge_sales_lead/${delegatedLead}`)).status, 403, 'generic REST is closed');
  assert.equal((await call(token, '/data/forge_sales_lead', 'POST', { name: 'x' })).status, 403);
  assert.equal((await call(token, '/workbench/materials/00000000-0000-4000-8000-000000000000')).status, 403, 'files outside the scope are closed');

  // Guard 3: MCP generic writes are refused for task credentials.
  const write = await mcp(token, 'create_record', { objectName: 'forge_sales_lead', data: { name: '越权线索', company_name: 'x', contact_name: 'x', phone: '13800000000', responsible_id: admin.userId } });
  assert.equal(write.result?.isError, true, 'MCP create_record is refused');
  assert.match(mcpText(write.result), /TASK_DELEGATION_SCOPE/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM forge_sales_lead WHERE name = '越权线索'")).rows[0].n, 0);

  // Guard 2: the delegated action on another record is refused...
  const outside = await mcp(token, 'run_action', { ...action, recordId: otherLead, params: { amount: 1000, expected_close_on: '2026-10-30' } });
  assert.equal(outside.result?.isError, true, 'delegated action on another record is refused');
  assert.match(mcpText(outside.result), /TASK_DELEGATION_SCOPE/);
  // ...and the delegated action on the delegated record writes through its own body.
  const inside = await mcp(token, 'run_action', { ...action, recordId: delegatedLead, params: { amount: 1000, expected_close_on: '2026-10-30' } });
  assert.notEqual(inside.result?.isError, true, `delegated action succeeds: ${mcpText(inside.result).slice(0, 300)}`);
  const converted = await db.query('SELECT count(*)::int AS n FROM forge_sales_opportunity WHERE lead_id = $1', [delegatedLead]);
  assert.equal(converted.rows[0].n, 1, 'the delegated action wrote its business result');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM forge_sales_opportunity WHERE lead_id = $1', [otherLead])).rows[0].n, 0);

  // Revocation: a colleague cannot revoke it; the credential can revoke itself.
  assert.equal((await call(peer.token, `/workbench/task-delegations/${issued.value.delegationId}`, 'DELETE')).status, 404);
  const revoked = await call(token, `/workbench/task-delegations/${issued.value.delegationId}`, 'DELETE', { reason: 'run_terminal' });
  assert.equal(revoked.status, 200);
  assert.ok(await inactive(token), 'revoked credential is refused');
  const row = await db.query('SELECT revoked_at, revocation_reason FROM forge_task_delegation WHERE delegation_id = $1', [issued.value.delegationId]);
  assert.ok(row.rows[0].revoked_at);
  assert.equal(row.rows[0].revocation_reason, 'run_terminal');
  assert.equal((await call(admin.token, '/workbench/task-delegations', 'POST', request)).status, 409, 'a revoked delegation is not reissued');

  // Employee cancel revokes by session id; the desktop session keeps working throughout.
  const second = await call(admin.token, '/workbench/task-delegations', 'POST', { ...request, idempotencyKey: randomUUID(), actions: [], record: undefined });
  assert.equal(second.status, 201);
  assert.equal((await call(admin.token, `/workbench/task-delegations/${second.value.delegationId}`, 'DELETE', { reason: 'employee_cancel' })).status, 200);
  assert.ok(await inactive(second.value.credential), 'cancelled credential is refused');
  const desktop = await call(admin.token, '/auth/me/permissions');
  assert.equal(desktop.value?.authenticated, true, 'the desktop session is unaffected');
  assert.equal((await call(admin.token, `/data/forge_sales_lead/${otherLead}`)).status, 200, 'the desktop session keeps normal REST access');
});
