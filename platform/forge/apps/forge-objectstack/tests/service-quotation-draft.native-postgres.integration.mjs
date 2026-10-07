import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';
import test from 'node:test';
import { ServiceQuotationDraftReceipt } from '../src/objects/service-quotation-receipt.object.ts';
import { serviceManagerPermission, serviceOperatorPermission } from '../src/permissions/otc-role.permission.ts';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
const requireFromTest = createRequire(import.meta.url);
const requireFromCli = createRequire(requireFromTest.resolve('@objectstack/cli'));
const betterAuthCrypto = await import(pathToFileURL(requireFromCli.resolve('better-auth/crypto')).href);
const betterAuthDatabase = await import(pathToFileURL(requireFromCli.resolve('@better-auth/core/db')).href);
const hashPassword = betterAuthCrypto.hashPassword;
const accountFields = new Set(Object.keys(betterAuthDatabase.accountSchema.shape));
const PG_PORT = Number(process.env.SERVICE_QUOTATION_DRAFT_TEST_PG_PORT || 5432);
const PORT = Number(process.env.SERVICE_QUOTATION_DRAFT_TEST_PORT || 4652);
const RUN = randomUUID().replaceAll('-', '').slice(0, 14).toLowerCase();
const DATABASE = 'forge_service_quote_draft_' + RUN;
const ORIGIN = 'http://127.0.0.1:' + PORT;
const SECRET_KEY = randomBytes(32).toString('hex');
const AUTH_SECRET = randomBytes(32).toString('hex');
const ORGANIZATION_ID = randomUUID();
const FOREIGN_ORGANIZATION_ID = randomUUID();
const TRANSIENT_PASSWORDS = [];
const TABLE_SCHEMAS = new Map();
let callerCounter = 0, signInIp = 130;

function id() { return randomUUID(); }
function messageOf(response) {
  return String(response?.value?.error?.message || response?.value?.error || response?.value?.message || '').slice(0, 220);
}
function payloadOf(response) { return response?.value?.data || response?.value || {}; }
function resultOf(response) {
  const value = response?.value;
  return value?.result?.result || value?.result || value?.data?.result || value?.data || value;
}
function safeOutput(output, databaseUrl = '') {
  let safe = String(output || '').replaceAll(SECRET_KEY, '[temporary secret omitted]').replaceAll(AUTH_SECRET, '[temporary auth secret omitted]');
  if (databaseUrl) safe = safe.replaceAll(databaseUrl, '[temporary database URL omitted]');
  for (const password of TRANSIENT_PASSWORDS) if (password) safe = safe.replaceAll(password, '[temporary password omitted]');
  return safe.slice(-7000);
}

test('service quotation draft saves, confirmation and settlement use revision-checked native Actions and isolated PostgreSQL transactions', { timeout: 420_000 }, async t => {
  assert.equal(ServiceQuotationDraftReceipt.name, 'forge_service_quotation_draft_receipt');
  assert.equal(ServiceQuotationDraftReceipt.sharingModel, 'controlled_by_parent');
  assert.equal(ServiceQuotationDraftReceipt.managedBy, 'append-only');
  assert.deepEqual(ServiceQuotationDraftReceipt.enable?.apiMethods, ['get', 'list']);
  assert.deepEqual(ServiceQuotationDraftReceipt.lifecycle, { class: 'record' });
  assert.deepEqual(ServiceQuotationDraftReceipt.indexes?.map(index => ({ fields: index.fields, unique: index.unique })), [
    { fields: ['quotation_id', 'expected_revision'], unique: 'organization' },
    { fields: ['quotation_id', 'idempotency_key'], unique: 'organization' },
  ]);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'forge-service-quotation-draft-pg-'));
  const databaseUrl = `postgresql://${encodeURIComponent(os.userInfo().username)}@127.0.0.1:${PG_PORT}/${DATABASE}`;
  let databaseCreated = false, postgres, child, runtimeOutput = '', rejectTrigger = '', rejectFunction = '';
  let quoteUpdateProbeTrigger = '', quoteUpdateProbeFunction = '', quoteUpdateProbeSequence = '';
  let receiptInsertProbeTrigger = '', receiptInsertProbeFunction = '', receiptInsertProbeSequence = '';
  let settlementRejectTrigger = '', settlementRejectFunction = '';
  const callers = [];
  const quoteIds = {};
  t.after(async () => {
    if (postgres && rejectTrigger) await postgres.query(`DROP TRIGGER IF EXISTS "${rejectTrigger}" ON forge_service_quotation_draft_receipt`).catch(() => {});
    if (postgres && rejectFunction) await postgres.query(`DROP FUNCTION IF EXISTS "${rejectFunction}"()`).catch(() => {});
    if (postgres && quoteUpdateProbeTrigger) await postgres.query(`DROP TRIGGER IF EXISTS "${quoteUpdateProbeTrigger}" ON forge_service_quotation`).catch(() => {});
    if (postgres && receiptInsertProbeTrigger) await postgres.query(`DROP TRIGGER IF EXISTS "${receiptInsertProbeTrigger}" ON forge_service_quotation_draft_receipt`).catch(() => {});
    if (postgres && quoteUpdateProbeFunction) await postgres.query(`DROP FUNCTION IF EXISTS "${quoteUpdateProbeFunction}"()`).catch(() => {});
    if (postgres && receiptInsertProbeFunction) await postgres.query(`DROP FUNCTION IF EXISTS "${receiptInsertProbeFunction}"()`).catch(() => {});
    if (postgres && quoteUpdateProbeSequence) await postgres.query(`DROP SEQUENCE IF EXISTS "${quoteUpdateProbeSequence}"`).catch(() => {});
    if (postgres && receiptInsertProbeSequence) await postgres.query(`DROP SEQUENCE IF EXISTS "${receiptInsertProbeSequence}"`).catch(() => {});
    if (postgres && settlementRejectTrigger) await postgres.query(`DROP TRIGGER IF EXISTS "${settlementRejectTrigger}" ON forge_service_settlement`).catch(() => {});
    if (postgres && settlementRejectFunction) await postgres.query(`DROP FUNCTION IF EXISTS "${settlementRejectFunction}"()`).catch(() => {});
    await stopRuntime();
    await postgres?.end().catch(() => {});
    if (databaseCreated) await run('dropdb', ['-h', '127.0.0.1', '-p', String(PG_PORT), DATABASE]).catch(() => {});
    await rm(tempDir, { recursive: true, force: true });
  });

  const portProbe = createServer();
  await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(PORT, '127.0.0.1', resolve); });
  await new Promise(resolve => portProbe.close(resolve));
  await run('createdb', ['-h', '127.0.0.1', '-p', String(PG_PORT), DATABASE]);
  databaseCreated = true;
  postgres = new Client({ connectionString: databaseUrl });
  await postgres.connect();

  await writeFile(path.join(tempDir, 'package.json'), '{"name":"forge-service-quotation-draft-pg-test","type":"module"}\n');
  await writeFile(path.join(tempDir, 'objectstack.config.ts'), `export { default } from ${JSON.stringify(path.join(APP_DIR, 'objectstack.config.ts'))};\n`);
  await symlink(path.join(APP_DIR, 'src'), path.join(tempDir, 'src'), 'dir');
  await symlink(path.join(APP_DIR, 'node_modules'), path.join(tempDir, 'node_modules'), 'dir');

  async function stopRuntime() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise(resolve => child.once('close', resolve));
    child.kill('SIGTERM');
    await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 10_000))]);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
    child = undefined;
  }
  async function startRuntime() {
    runtimeOutput = '';
    child = spawn(process.execPath, [
      path.join(APP_DIR, 'node_modules/@objectstack/cli/bin/run.js'), 'serve', 'objectstack.config.ts', '--port', String(PORT), '--log-level', 'error',
    ], {
      cwd: tempDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        OS_HOME: path.join(tempDir, '.os-home'),
        OS_DATABASE_URL: databaseUrl,
        OS_SECRET_KEY: SECRET_KEY,
        OS_AUTH_SECRET: AUTH_SECRET,
        OS_BASE_URL: ORIGIN,
        OS_TRUSTED_ORIGINS: ORIGIN,
        OS_ENVIRONMENT_ID: 'service-quotation-draft-' + RUN,
        OS_TENANCY_POSTURE: 'single',
        OS_SEED_ADMIN: 'false',
        OS_PLATFORM_OWNER_EMAIL: 'service-quote-owner-' + RUN + '@example.test',
        OS_AUTOMATION_SCHEDULED_WORK_ENABLED: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8').on('data', chunk => { runtimeOutput = (runtimeOutput + chunk).slice(-10000); });
    child.stderr.setEncoding('utf8').on('data', chunk => { runtimeOutput = (runtimeOutput + chunk).slice(-10000); });
    const deadline = Date.now() + 150_000;
    let health;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Official Runtime exited during the isolated test.\n' + safeOutput(runtimeOutput, databaseUrl));
      try { health = await fetch(ORIGIN + '/api/v1/health', { signal: AbortSignal.timeout(1000) }); if (health.ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    assert.ok(health?.ok, 'Official Runtime did not become ready.\n' + safeOutput(runtimeOutput, databaseUrl));
  }
  async function tableSchema(tableName) {
    if (TABLE_SCHEMAS.has(tableName)) return TABLE_SCHEMAS.get(tableName);
    const result = await postgres.query(
      'SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1',
      [tableName],
    );
    assert.ok(result.rows.length, 'Official Runtime registered the isolated table ' + tableName);
    const columns = new Map(result.rows.map(row => [row.column_name, row]));
    TABLE_SCHEMAS.set(tableName, columns);
    return columns;
  }
  async function insertFixture(tableName, values, defaultOrganization = '') {
    const definition = await tableSchema(tableName), now = new Date().toISOString();
    const row = { id: id(), created_at: now, updated_at: now, ...values };
    if (!tableName.startsWith('sys_') && defaultOrganization) row.organization_id ??= defaultOrganization;
    const columns = [...definition.keys()].filter(name => row[name] !== undefined);
    const missing = [...definition.entries()]
      .filter(([name, column]) => column.is_nullable === 'NO' && column.column_default == null && !columns.includes(name))
      .map(([name]) => name);
    assert.deepEqual(missing, [], 'fixture satisfies the actual ' + tableName + ' schema');
    const quote = value => '"' + value.replaceAll('"', '""') + '"';
    await postgres.query(
      'INSERT INTO ' + quote(tableName) + ' (' + columns.map(quote).join(',') + ') VALUES (' + columns.map((_, index) => '$' + (index + 1)).join(',') + ')',
      columns.map(name => row[name]),
    );
    return row.id;
  }
  async function createPosition(name, permissionName) {
    const found = await postgres.query('SELECT id FROM sys_position WHERE name=$1 AND organization_id=$2 ORDER BY id LIMIT 1', [name, ORGANIZATION_ID]);
    const positionId = found.rows[0]?.id || await insertFixture('sys_position', {
      name, label: '隔离报价测试岗位 ' + name, active: true, organization_id: ORGANIZATION_ID,
    });
    if (found.rows.length) await postgres.query('UPDATE sys_position SET active=true WHERE id=$1', [positionId]);
    const permission = await postgres.query('SELECT id FROM sys_permission_set WHERE name=$1 AND active=true ORDER BY id LIMIT 1', [permissionName]);
    assert.ok(permission.rows[0]?.id, 'the official Runtime loaded the existing permission set');
    const bound = await postgres.query('SELECT 1 FROM sys_position_permission_set WHERE position_id=$1 AND permission_set_id=$2 LIMIT 1', [positionId, permission.rows[0].id]);
    if (!bound.rows.length) await insertFixture('sys_position_permission_set', {
      position_id: positionId, permission_set_id: permission.rows[0].id, organization_id: ORGANIZATION_ID,
    });
    return positionId;
  }
  async function createCaller(label, permissionName = '') {
    const email = `service-quote-${++callerCounter}-${RUN}@example.test`;
    const password = 'ServiceQuote-' + randomBytes(24).toString('hex') + '!';
    TRANSIENT_PASSWORDS.push(password);
    const callerId = id(), passwordHash = await hashPassword(password);
    await insertFixture('sys_user', {
      id: callerId, name: '服务报价验收' + label, email, email_verified: true, banned: false, role: 'user', organization_id: null,
    });
    await insertFixture('sys_account', {
      user_id: callerId, provider_id: 'credential', account_id: callerId, password: passwordHash,
      access_token: null, refresh_token: null, id_token: null,
    });
    await insertFixture('sys_member', { user_id: callerId, organization_id: ORGANIZATION_ID, role: 'member' });
    if (permissionName) {
      const position = await createPosition('service_quote_' + permissionName + '_' + RUN, permissionName);
      await insertFixture('sys_user_position', {
        user_id: callerId, position: 'service_quote_' + permissionName + '_' + RUN,
        organization_id: ORGANIZATION_ID, valid_from: new Date(Date.now() - 60_000).toISOString(), valid_until: null,
      });
      return { id: callerId, email, password, position, client: null };
    }
    return { id: callerId, email, password, position: '', client: null };
  }
  async function signIn(caller) {
    const response = await fetch(ORIGIN + '/api/v1/auth/sign-in/email', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Forwarded-For': `198.51.100.${signInIp++}` },
      body: JSON.stringify({ email: caller.email, password: caller.password }),
    });
    const value = await response.json().catch(() => ({}));
    assert.equal(response.status, 200, 'isolated BetterAuth sign-in succeeds: ' + String(value.code || value.message || value.error || '').slice(0, 100));
    const cookie = response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
    assert.ok(value.user?.id && cookie);
    assert.equal(value.user.id, caller.id);
    caller.cookie = cookie;
    caller.client = {
      id: caller.id,
      async request(resource, method = 'GET', body) {
        const result = await fetch(ORIGIN + '/api/v1' + resource, {
          method,
          headers: { Cookie: caller.cookie, Origin: ORIGIN, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const updatedCookie = result.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
        if (updatedCookie) caller.cookie = updatedCookie;
        return { status: result.status, value: await result.json().catch(() => null) };
      },
    };
    const selected = await caller.client.request('/auth/organization/set-active', 'POST', { organizationId: ORGANIZATION_ID });
    assert.equal(selected.status, 200, 'test caller selects the sole actual organization membership');
    return caller.client;
  }
  async function invoke(client, quoteId, params) {
    return client.request('/actions/forge_service_quotation/service_quotation_save_draft/' + encodeURIComponent(quoteId), 'POST', { params });
  }
  async function invokeQuotationAction(client, actionName, quoteId, params = {}) {
    return client.request('/actions/forge_service_quotation/' + actionName + '/' + encodeURIComponent(quoteId), 'POST', { params });
  }
  async function createQuote(suffix, { status = 'draft', revision = 1, ownerId = '', organizationId = ORGANIZATION_ID } = {}) {
    const quoteId = id(), now = new Date().toISOString();
    await insertFixture('forge_service_quotation', {
      id: quoteId,
      name: '隔离服务报价草稿 ' + suffix,
      code: 'SQD-' + RUN + '-' + suffix,
      service_order_id: null,
      order_code: null,
      customer_id: null,
      contact_id: null,
      total_amount: 10,
      status,
      valid_until: '2026-12-31',
      revision,
      responsible_id: ownerId || null,
      remarks: '初始内容',
      owner_id: ownerId || null,
      organization_id: organizationId,
      created_at: now,
      updated_at: now,
    }, '');
    return quoteId;
  }
  async function quoteSnapshot(quoteId) {
    const result = await postgres.query('SELECT id,status,total_amount,valid_until::text AS valid_until,remarks,revision FROM forge_service_quotation WHERE id=$1', [quoteId]);
    const row = result.rows[0];
    return row ? {
      id: String(row.id), status: String(row.status), total_amount: Number(row.total_amount),
      valid_until: String(row.valid_until).slice(0, 10),
      remarks: row.remarks == null ? null : String(row.remarks),
      revision: Number(row.revision),
    } : null;
  }
  async function receiptRows(quoteId) {
    const result = await postgres.query('SELECT expected_revision,resulting_revision,idempotency_key,actor_id,request_signature,result_json FROM forge_service_quotation_draft_receipt WHERE quotation_id=$1 ORDER BY expected_revision,idempotency_key', [quoteId]);
    return result.rows;
  }
  async function settlementRows(quoteId) {
    const result = await postgres.query('SELECT id,status,total_amount FROM forge_service_settlement WHERE quotation_id=$1 ORDER BY id', [quoteId]);
    return result.rows;
  }
  async function assertRejected(response, label) {
    assert.ok(response.status >= 400 && response.status < 500, label + ' is rejected by the official Runtime with a client error');
  }
  async function installWriteBoundaryProbes() {
    quoteUpdateProbeSequence = 'seq_sq_draft_update_' + RUN;
    quoteUpdateProbeFunction = 'fn_sq_draft_update_' + RUN;
    quoteUpdateProbeTrigger = 'trg_sq_draft_update_' + RUN;
    receiptInsertProbeSequence = 'seq_sq_receipt_insert_' + RUN;
    receiptInsertProbeFunction = 'fn_sq_receipt_insert_' + RUN;
    receiptInsertProbeTrigger = 'trg_sq_receipt_insert_' + RUN;
    await postgres.query(`CREATE SEQUENCE "${quoteUpdateProbeSequence}" AS bigint START WITH 1`);
    await postgres.query(`CREATE SEQUENCE "${receiptInsertProbeSequence}" AS bigint START WITH 1`);
    await postgres.query(`CREATE FUNCTION "${quoteUpdateProbeFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('${quoteUpdateProbeSequence}'); RETURN NEW; END $$`);
    await postgres.query(`CREATE FUNCTION "${receiptInsertProbeFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('${receiptInsertProbeSequence}'); RETURN NEW; END $$`);
    await postgres.query(`CREATE TRIGGER "${quoteUpdateProbeTrigger}" BEFORE UPDATE ON forge_service_quotation FOR EACH STATEMENT EXECUTE FUNCTION "${quoteUpdateProbeFunction}"()`);
    await postgres.query(`CREATE TRIGGER "${receiptInsertProbeTrigger}" BEFORE INSERT ON forge_service_quotation_draft_receipt FOR EACH STATEMENT EXECUTE FUNCTION "${receiptInsertProbeFunction}"()`);
  }
  async function writeBoundaryDiagnostics(quoteId) {
    const updateProbe = await postgres.query(`SELECT last_value,is_called FROM "${quoteUpdateProbeSequence}"`);
    const receiptProbe = await postgres.query(`SELECT last_value,is_called FROM "${receiptInsertProbeSequence}"`);
    const quote = await quoteSnapshot(quoteId);
    const receiptCount = await postgres.query('SELECT count(*)::int AS count FROM forge_service_quotation_draft_receipt WHERE quotation_id=$1', [quoteId]);
    return JSON.stringify({
      quoteUpdateStatementReached: Boolean(updateProbe.rows[0]?.is_called),
      receiptInsertStatementReached: Boolean(receiptProbe.rows[0]?.is_called),
      quoteAfter: quote && { status: quote.status, total_amount: quote.total_amount, valid_until: quote.valid_until, revision: quote.revision },
      committedReceipts: receiptCount.rows[0]?.count || 0,
    });
  }
  function assertGenericWriteBlocked(response, label) {
    assert.ok([403, 405].includes(response.status), label + ' is blocked by the official Runtime');
  }

  await startRuntime();
  assert.ok(accountFields.has('providerId') && accountFields.has('accountId') && accountFields.has('userId') && accountFields.has('password'));
  assert.equal(accountFields.has('issuer'), false, 'the installed Better Auth 1.7.3 schema does not use the retired issuer factory');
  const accountSchema = await tableSchema('sys_account');
  for (const field of ['user_id', 'provider_id', 'account_id', 'password']) assert.ok(accountSchema.has(field));
  assert.equal(accountSchema.has('issuer'), false, 'the current ObjectStack sys_account table has no issuer column');
  const permissionDeadline = Date.now() + 30_000;
  while (Date.now() < permissionDeadline) {
    const permissionRows = await postgres.query('SELECT name FROM sys_permission_set WHERE active=true AND name=ANY($1::text[])', [['forge_service_manager', 'forge_service_operator']]);
    if (permissionRows.rows.length === 2) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  await stopRuntime();
  assert.equal(typeof hashPassword, 'function', 'the official installed Better Auth password hash helper is available');
  assert.equal(typeof betterAuthDatabase.createLocalAccountIssuer, 'undefined', 'do not use the removed Better Auth account issuer helper');
  assert.equal(serviceManagerPermission.name, 'forge_service_manager');
  assert.equal(serviceOperatorPermission.name, 'forge_service_operator');
  await insertFixture('sys_organization', { id: ORGANIZATION_ID, name: '服务报价隔离组织 ' + RUN, slug: 'service-quotation-' + RUN });
  const manager = await createCaller('主管', serviceManagerPermission.name);
  const operator = await createCaller('无管理权限服务员工', serviceOperatorPermission.name);
  assert.equal((await postgres.query('SELECT count(*)::int AS count FROM sys_account WHERE user_id=ANY($1::text[])', [[manager.id, operator.id]])).rows[0]?.count, 2);

  quoteIds.success = await createQuote('SUCCESS', { ownerId: manager.id });
  quoteIds.nonDraft = await createQuote('NONDRAFT', { status: 'confirmed', ownerId: manager.id });
  quoteIds.unprivileged = await createQuote('NOPERM', { ownerId: operator.id });
  quoteIds.foreign = await createQuote('FOREIGN', { ownerId: manager.id, organizationId: FOREIGN_ORGANIZATION_ID });
  quoteIds.rollback = await createQuote('ROLLBACK', { ownerId: manager.id });
  quoteIds.sameRace = await createQuote('SAMERACE', { ownerId: manager.id });
  quoteIds.keyRace = await createQuote('KEYRACE', { ownerId: manager.id });
  quoteIds.settlementRollback = await createQuote('SETTLEMENTROLLBACK', { status: 'confirmed', revision: 3, ownerId: manager.id });

  await startRuntime();
  const managerClient = await signIn(manager);
  const operatorClient = await signIn(operator);
  const managerPermissions = payloadOf(await managerClient.request('/auth/me/permissions'));
  assert.ok(managerPermissions.systemPermissions?.includes('forge_service_manager'));
  assert.equal(managerPermissions.systemPermissions?.includes('setup.write'), false);
  const operatorPermissions = payloadOf(await operatorClient.request('/auth/me/permissions'));
  assert.ok(operatorPermissions.systemPermissions?.includes('forge_service_operator'));
  assert.equal(operatorPermissions.systemPermissions?.includes('forge_service_manager'), false);

  const parentRead = await managerClient.request('/data/forge_service_quotation/' + encodeURIComponent(quoteIds.success));
  assert.equal(parentRead.status, 200, 'the service manager can read the parent quotation through its authorized scope');
  assert.equal(resultOf(parentRead)?.record?.status || resultOf(parentRead)?.status, 'draft');
  const rawQuoteCreate = await managerClient.request('/data/forge_service_quotation', 'POST', {
    name: '未经动作创建的报价', code: 'SQD-RAW-' + RUN, total_amount: 1, status: 'draft',
  });
  assert.equal(rawQuoteCreate.status, 403, 'generic quotation creation remains denied');
  const rawQuoteUpdate = await managerClient.request('/data/forge_service_quotation/' + encodeURIComponent(quoteIds.success), 'PATCH', { total_amount: 999 });
  assert.equal(rawQuoteUpdate.status, 403, 'generic quotation update remains denied');
  const rawQuoteDelete = await managerClient.request('/data/forge_service_quotation/' + encodeURIComponent(quoteIds.success), 'DELETE');
  assert.equal(rawQuoteDelete.status, 403, 'generic quotation deletion remains denied');
  const rawReceiptCreate = await managerClient.request('/data/forge_service_quotation_draft_receipt', 'POST', {
    name: '未经动作创建的回执', quotation_id: quoteIds.success, actor_id: manager.id,
    expected_revision: 1, resulting_revision: 2, idempotency_key: 'raw-' + RUN,
    request_signature: '{}', result_json: '{}',
  });
  assertGenericWriteBlocked(rawReceiptCreate, 'generic receipt creation');
  await installWriteBoundaryProbes();

  const initial = { total_amount: '123.45', valid_until: '2026-12-31', remarks: '备注' };
  const initialParams = { draft_json: JSON.stringify(initial), expected_revision: 1, idempotency_key: 'save-' + RUN };
  const first = await invoke(managerClient, quoteIds.success, initialParams);
  assert.equal(first.status, 200, 'the authorized manager saves through the native Action: ' + messageOf(first) + '; boundary diagnostics ' + await writeBoundaryDiagnostics(quoteIds.success));
  assert.deepEqual(resultOf(first), {
    id: quoteIds.success, code: 'SQD-' + RUN + '-SUCCESS', status: 'draft', total_amount: 123.45,
    valid_until: '2026-12-31', remarks: '备注', revision: 2, repeated: false,
  });
  const replay = await invoke(managerClient, quoteIds.success, initialParams);
  assert.equal(replay.status, 200, 'the same key returns the original saved result');
  assert.equal(resultOf(replay)?.repeated, true);
  assert.equal(resultOf(replay)?.revision, 2);
  assert.equal((await receiptRows(quoteIds.success)).length, 1, 'one immutable receipt exists for the completed request');
  assert.deepEqual(await quoteSnapshot(quoteIds.success), {
    id: quoteIds.success, status: 'draft', total_amount: 123.45, valid_until: '2026-12-31', remarks: '备注', revision: 2,
  });
  const changedReplay = await invoke(managerClient, quoteIds.success, {
    ...initialParams, draft_json: JSON.stringify({ ...initial, total_amount: '321.00' }),
  });
  await assertRejected(changedReplay, 'reusing a key with different content');
  const stale = await invoke(managerClient, quoteIds.success, {
    draft_json: JSON.stringify({ ...initial, total_amount: '55.00' }), expected_revision: 1, idempotency_key: 'stale-' + RUN,
  });
  await assertRejected(stale, 'saving against an old quotation revision');
  assert.equal((await receiptRows(quoteIds.success)).length, 1, 'conflict attempts do not append receipts');

  const staleConfirm = await invokeQuotationAction(managerClient, 'service_quotation_confirm', quoteIds.success, { expected_revision: 1 });
  await assertRejected(staleConfirm, 'confirming against the stale pre-save revision');
  assert.deepEqual(await quoteSnapshot(quoteIds.success), {
    id: quoteIds.success, status: 'draft', total_amount: 123.45, valid_until: '2026-12-31', remarks: '备注', revision: 2,
  }, 'a stale confirm leaves the saved draft at its current revision');
  const confirmed = await invokeQuotationAction(managerClient, 'service_quotation_confirm', quoteIds.success, { expected_revision: 2 });
  assert.equal(confirmed.status, 200, 'confirmation accepts the current revision from the Action caller');
  assert.deepEqual(resultOf(confirmed), { id: quoteIds.success, status: 'confirmed', revision: 3 });
  const postConfirmReplay = await invoke(managerClient, quoteIds.success, initialParams);
  assert.equal(postConfirmReplay.status, 200, 'the prior save key still returns its original receipt after confirmation');
  assert.deepEqual(resultOf(postConfirmReplay), {
    id: quoteIds.success, code: 'SQD-' + RUN + '-SUCCESS', status: 'draft', total_amount: 123.45,
    valid_until: '2026-12-31', remarks: '备注', revision: 2, repeated: true,
  });
  assert.deepEqual(await quoteSnapshot(quoteIds.success), {
    id: quoteIds.success, status: 'confirmed', total_amount: 123.45, valid_until: '2026-12-31', remarks: '备注', revision: 3,
  }, 'replaying the prior save receipt does not rewind the confirmed parent');

  const nonDraftSave = await invoke(managerClient, quoteIds.nonDraft, {
    draft_json: JSON.stringify(initial), expected_revision: 1, idempotency_key: 'confirmed-' + RUN,
  });
  await assertRejected(nonDraftSave, 'saving a non-draft quotation');
  const foreign = await invoke(managerClient, quoteIds.foreign, {
    draft_json: JSON.stringify(initial), expected_revision: 1, idempotency_key: 'foreign-' + RUN,
  });
  await assertRejected(foreign, 'saving a quotation from a different organization');
  const noPermission = await invoke(operatorClient, quoteIds.unprivileged, {
    draft_json: JSON.stringify(initial), expected_revision: 1, idempotency_key: 'operator-' + RUN,
  });
  await assertRejected(noPermission, 'saving without the existing service-manager permission');
  assert.equal((await receiptRows(quoteIds.nonDraft)).length, 0);
  assert.equal((await receiptRows(quoteIds.foreign)).length, 0);
  assert.equal((await receiptRows(quoteIds.unprivileged)).length, 0);

  const staleSettlement = await invokeQuotationAction(managerClient, 'service_quotation_create_settlement', quoteIds.success, { expected_revision: 2 });
  await assertRejected(staleSettlement, 'creating a settlement with the pre-confirmation revision');
  assert.deepEqual(await quoteSnapshot(quoteIds.success), {
    id: quoteIds.success, status: 'confirmed', total_amount: 123.45, valid_until: '2026-12-31', remarks: '备注', revision: 3,
  }, 'a stale settlement request leaves the confirmed quotation unchanged');
  assert.equal((await settlementRows(quoteIds.success)).length, 0, 'a stale settlement request creates no settlement');
  const settlement = await invokeQuotationAction(managerClient, 'service_quotation_create_settlement', quoteIds.success, { expected_revision: 3 });
  assert.equal(settlement.status, 200, 'settlement creation accepts the current revision supplied by the caller');
  const settlementResult = resultOf(settlement);
  assert.equal(settlementResult?.quotation_id, quoteIds.success);
  assert.ok(settlementResult?.id);
  assert.deepEqual(await quoteSnapshot(quoteIds.success), {
    id: quoteIds.success, status: 'settlement_created', total_amount: 123.45, valid_until: '2026-12-31', remarks: '备注', revision: 4,
  }, 'successful settlement creation advances the parent revision');
  const createdSettlements = await settlementRows(quoteIds.success);
  assert.equal(createdSettlements.length, 1, 'one settlement is linked to the quotation');
  assert.equal(createdSettlements[0].status, 'draft');
  const duplicateSettlement = await invokeQuotationAction(managerClient, 'service_quotation_create_settlement', quoteIds.success, { expected_revision: 3 });
  await assertRejected(duplicateSettlement, 'repeating settlement creation for the same quotation');
  assert.equal((await settlementRows(quoteIds.success)).length, 1, 'repeat requests do not create a second settlement');

  settlementRejectFunction = 'fn_service_quote_settlement_reject_' + RUN;
  settlementRejectTrigger = 'trg_service_quote_settlement_reject_' + RUN;
  await postgres.query(`CREATE FUNCTION "${settlementRejectFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.quotation_id = '${quoteIds.settlementRollback}' THEN RAISE EXCEPTION 'isolated settlement insert failure'; END IF; RETURN NEW; END $$`);
  await postgres.query(`CREATE TRIGGER "${settlementRejectTrigger}" BEFORE INSERT ON forge_service_settlement FOR EACH ROW EXECUTE FUNCTION "${settlementRejectFunction}"()`);
  const beforeSettlementRollback = await quoteSnapshot(quoteIds.settlementRollback);
  const failedSettlementInsert = await invokeQuotationAction(managerClient, 'service_quotation_create_settlement', quoteIds.settlementRollback, { expected_revision: 3 });
  await assertRejected(failedSettlementInsert, 'settlement insertion failure');
  assert.deepEqual(await quoteSnapshot(quoteIds.settlementRollback), beforeSettlementRollback, 'the confirmed status and revision roll back when settlement insertion fails');
  assert.equal((await settlementRows(quoteIds.settlementRollback)).length, 0, 'no settlement survives a failed insert');
  await postgres.query(`DROP TRIGGER "${settlementRejectTrigger}" ON forge_service_settlement`);
  await postgres.query(`DROP FUNCTION "${settlementRejectFunction}"()`);
  settlementRejectTrigger = ''; settlementRejectFunction = '';

  const rawReceiptUpdate = await managerClient.request('/data/forge_service_quotation_draft_receipt/' + encodeURIComponent((await postgres.query('SELECT id FROM forge_service_quotation_draft_receipt WHERE quotation_id=$1 LIMIT 1', [quoteIds.success])).rows[0].id), 'PATCH', { result_json: '{}' });
  assertGenericWriteBlocked(rawReceiptUpdate, 'generic receipt update after a valid save');
  const rawReceiptDelete = await managerClient.request('/data/forge_service_quotation_draft_receipt/' + encodeURIComponent((await postgres.query('SELECT id FROM forge_service_quotation_draft_receipt WHERE quotation_id=$1 LIMIT 1', [quoteIds.success])).rows[0].id), 'DELETE');
  assertGenericWriteBlocked(rawReceiptDelete, 'generic receipt deletion after a valid save');

  const rollbackKey = 'receipt-failure-' + RUN;
  rejectFunction = 'fn_service_quote_receipt_reject_' + RUN;
  rejectTrigger = 'trg_service_quote_receipt_reject_' + RUN;
  await postgres.query(`CREATE FUNCTION "${rejectFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.idempotency_key = '${rollbackKey}' THEN RAISE EXCEPTION 'isolated receipt failure'; END IF; RETURN NEW; END $$`);
  await postgres.query(`CREATE TRIGGER "${rejectTrigger}" BEFORE INSERT ON forge_service_quotation_draft_receipt FOR EACH ROW EXECUTE FUNCTION "${rejectFunction}"()`);
  const beforeRollback = await quoteSnapshot(quoteIds.rollback);
  const failedInsert = await invoke(managerClient, quoteIds.rollback, {
    draft_json: JSON.stringify({ total_amount: '77.00', valid_until: '2026-12-30', remarks: '需回滚' }),
    expected_revision: 1, idempotency_key: rollbackKey,
  });
  await assertRejected(failedInsert, 'receipt insertion failure');
  assert.deepEqual(await quoteSnapshot(quoteIds.rollback), beforeRollback, 'parent fields and revision roll back with the failed receipt insert');
  assert.equal((await receiptRows(quoteIds.rollback)).length, 0, 'no receipt survives a failed insert');
  await postgres.query(`DROP TRIGGER "${rejectTrigger}" ON forge_service_quotation_draft_receipt`);
  await postgres.query(`DROP FUNCTION "${rejectFunction}"()`);
  rejectTrigger = ''; rejectFunction = '';

  const sameKeyParams = { draft_json: JSON.stringify({ total_amount: '88.00', valid_until: '2026-12-29', remarks: '同键并发' }), expected_revision: 1, idempotency_key: 'same-race-' + RUN };
  const sameKeyRace = await Promise.all([
    invoke(managerClient, quoteIds.sameRace, sameKeyParams),
    invoke(managerClient, quoteIds.sameRace, sameKeyParams),
  ]);
  assert.deepEqual(sameKeyRace.map(row => row.status).sort(), [200, 200], 'same-key contenders both receive the original valid save');
  assert.equal(sameKeyRace.filter(row => resultOf(row)?.repeated === true).length, 1, 'one same-key contender receives the replay marker');
  assert.equal((await quoteSnapshot(quoteIds.sameRace)).revision, 2, 'same-key contention advances the parent exactly once');
  assert.equal((await receiptRows(quoteIds.sameRace)).length, 1, 'same-key contention stores exactly one receipt');

  const differentKeyRequests = [
    { draft_json: JSON.stringify({ total_amount: '99.00', valid_until: '2026-12-28', remarks: '不同键甲' }), expected_revision: 1, idempotency_key: 'key-race-a-' + RUN },
    { draft_json: JSON.stringify({ total_amount: '101.00', valid_until: '2026-12-27', remarks: '不同键乙' }), expected_revision: 1, idempotency_key: 'key-race-b-' + RUN },
  ];
  const differentKeyRace = await Promise.all(differentKeyRequests.map(params => invoke(managerClient, quoteIds.keyRace, params)));
  assert.equal(differentKeyRace.filter(row => row.status === 200).length, 1, 'different-key contenders cannot both save the same parent revision');
  assert.equal(differentKeyRace.filter(row => row.status >= 400 && row.status < 500).length, 1, 'the losing key receives a conflict');
  assert.equal((await quoteSnapshot(quoteIds.keyRace)).revision, 2, 'different-key contention advances one revision');
  assert.equal((await receiptRows(quoteIds.keyRace)).length, 1, 'different-key contention persists only the winning receipt');

  console.log('PASS isolated PostgreSQL service quotation revision transitions, draft receipts, authorization, rollback, idempotency, and concurrency');
});
