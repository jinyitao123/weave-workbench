import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';
import test from 'node:test';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SALES_QUOTATION_TEST_PORT || 4641);
const PG_PORT = Number(process.env.SALES_QUOTATION_TEST_PG_PORT || 5432);
const RUN = randomUUID().replaceAll('-', '').slice(0, 14).toLowerCase();
const DATABASE = 'forge_sales_quotation_' + RUN;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const run = promisify(execFile);
const requireFromTest = createRequire(import.meta.url);
const requireFromCli = createRequire(requireFromTest.resolve('@objectstack/cli'));
const betterAuthCrypto = await import(pathToFileURL(requireFromCli.resolve('better-auth/crypto')).href);
const betterAuthDatabase = await import(pathToFileURL(requireFromCli.resolve('@better-auth/core/db')).href);
const hashPassword = betterAuthCrypto.hashPassword;
const verifyPassword = betterAuthCrypto.verifyPassword;
const createLocalAccountIssuer = typeof betterAuthDatabase.createLocalAccountIssuer === 'function' ? betterAuthDatabase.createLocalAccountIssuer : null;
const AUTH_SECRET = randomBytes(32).toString('hex');
const SECRET_KEY = randomBytes(32).toString('hex');
const PLATFORM_OWNER_EMAIL = 'sales-quotation-owner-' + RUN + '@example.test';
const TRANSIENT_PASSWORDS = [];
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4XcAAAAASUVORK5CYII=', 'base64');
const SCHEMAS = new Map();
const QUOTATION_APPROVE_ACTION = 'quotation_approval_mcp_approve';
const QUOTATION_REJECT_ACTION = 'quotation_approval_mcp_reject';
let callerCounter = 0, signInIp = 70;

function id() { return randomUUID(); }
function resultOf(response) {
  const value = response?.value;
  return value?.result?.result || value?.result || value?.data?.result || value?.data || value;
}
function rowsOf(response) {
  const value = response?.value?.data || response?.value;
  return Array.isArray(value) ? value : value?.records || value?.items || [];
}
function messageOf(response) {
  return String(response?.value?.error?.message || response?.value?.error || response?.value?.message || '').slice(0, 1200);
}
function mcpText(result) {
  return String(result?.content?.find(block => block?.type === 'text')?.text || result?._rpcError?.message || '');
}
function mcpData(result) {
  try { return JSON.parse(mcpText(result)); } catch { return null; }
}
function fileIdOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return fileIdOf(value[0]);
  return String(value?.id || '').trim();
}
function safeOutput(output, databaseUrl = '') {
  let safe = String(output || '').replaceAll(AUTH_SECRET, '[auth secret omitted]').replaceAll(SECRET_KEY, '[secret key omitted]');
  if (databaseUrl) safe = safe.replaceAll(databaseUrl, '[temporary database URL omitted]');
  for (const password of TRANSIENT_PASSWORDS) if (password) safe = safe.replaceAll(password, '[temporary password omitted]');
  return safe.slice(-9000);
}

test('quotation send, acceptance evidence, and contract conversion use native approval and PostgreSQL transactions', { timeout: 420_000 }, async t => {
  assert.notEqual(PORT, 4635, 'quotation test must not attach to the persistent 4635 runtime');
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'forge-sales-quotation-pg-'));
  const databaseUrl = `postgresql://${encodeURIComponent(os.userInfo().username)}@127.0.0.1:${PG_PORT}/${DATABASE}`;
  let databaseCreated = false, postgres, child, runtimeOutput = '', organizationId = '';
  let accountHasIssuer = false, accountIssuerValue = null;
  const callers = [];
  let nativeQuotationId = '', nativeQuotationApprovalId = '', nativeQuotationSendFileId = '', nativeQuotationAcceptanceFileId = '', convertedContractId = '';
  t.after(async () => {
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
  organizationId = id();
  await postgres.query(`CREATE TABLE sys_organization (
    id varchar(255) PRIMARY KEY,
    name varchar(255) NOT NULL,
    slug varchar(255),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await postgres.query('INSERT INTO sys_organization (id,name,slug) VALUES ($1,$2,$3)', [organizationId, '报价发送接受PG隔离组织 ' + RUN, 'sales-quotation-' + RUN]);

  async function stopRuntime() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise(resolve => child.once('close', resolve));
    child.kill('SIGTERM');
    await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 10_000))]);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
    child = undefined;
  }
  await writeFile(path.join(tempDir, 'package.json'), '{"name":"forge-sales-quotation-native-pg-test","type":"module"}\n');
  await writeFile(path.join(tempDir, 'quotation-file-claim-failure.plugin.mjs'), `export class QuotationFileClaimFailurePlugin {
  name = 'com.inoforge.test.quotation-file-claim-failure'; version = '1.0.0'; type = 'standard';
  init() {}
  start(ctx) {
    ctx.hook('kernel:ready', () => {
      const engine = ctx.getService('objectql'), storage = ctx.getService('storage'), failedFields = new Set();
      let failedConversion = false;
      engine.registerHook('afterUpdate', async hook => {
        const data = hook?.input?.data || hook?.input || {};
        const field = ['sent_evidence_attachment', 'customer_acceptance_evidence_attachment'].find(name => Object.prototype.hasOwnProperty.call(data, name));
        if (!field || failedFields.has(field) || hook?.object !== 'forge_quotation') return;
        failedFields.add(field);
        const raw = data[field], fileId = String(typeof raw === 'string' ? raw : raw && (raw.id || raw[0] && raw[0].id) || '').trim();
        const organizationId = String(hook.session?.organizationId || hook.user?.organizationId || ''), userId = String(hook.session?.userId || hook.user?.id || '');
        const file = await engine.findOne('sys_file', { where: { id: fileId, organization_id: organizationId } }, { context: { isSystem: true, userId, tenantId: organizationId, organizationId, ...(hook.transaction ? { transaction: hook.transaction } : {}) } });
        if (!file || file.ref_object !== 'forge_quotation' || String(file.ref_id) !== String(data.id || hook.input?.id || '') || file.ref_field !== field) throw new Error('NATIVE_QUOTATION_FILE_REFERENCE_NOT_CLAIMED_BEFORE_FAILURE');
        if (field === 'customer_acceptance_evidence_attachment') {
          const context = { isSystem: true, userId, tenantId: organizationId, organizationId, ...(hook.transaction ? { transaction: hook.transaction } : {}) };
          const quote = await engine.findOne('forge_quotation', { where: { id: String(data.id || hook.input?.id || ''), organization_id: organizationId } }, { context });
          const fileIdOf = value => String(typeof value === 'string' ? value : Array.isArray(value) ? value[0] && (typeof value[0] === 'string' ? value[0] : value[0].id) || '' : value && value.id || '').trim();
          const sent = await engine.findOne('sys_file', { where: { id: fileIdOf(quote?.sent_evidence_attachment), organization_id: organizationId } }, { context });
          if (!sent || !storage || !sent.key || !file.key) throw new Error('NATIVE_QUOTATION_COPY_BYTES_UNAVAILABLE');
          const [sentBytes, acceptanceBytes] = await Promise.all([storage.download(sent.key), storage.download(file.key)]);
          if (!Buffer.from(sentBytes).equals(Buffer.from(acceptanceBytes))) throw new Error('NATIVE_QUOTATION_COPY_BYTES_MISMATCH');
        }
        throw new Error(field === 'sent_evidence_attachment' ? 'FORCE_QUOTATION_SEND_AFTER_NATIVE_FILE_CLAIM' : 'FORCE_QUOTATION_ACCEPT_AFTER_NATIVE_FILE_CLAIM');
      }, { object: 'forge_quotation', priority: 30_000, packageId: this.name });
      engine.registerHook('afterInsert', async hook => {
        if (failedConversion || hook?.object !== 'forge_quotation_contract_conversion') return;
        failedConversion = true;
        if (!hook.transaction) throw new Error('QUOTATION_CONVERSION_RECEIPT_INSERT_HAS_NO_TRANSACTION');
        const receipt = hook.result || hook.input?.data || hook.input || {};
        const organizationId = String(receipt.organization_id || hook.session?.organizationId || hook.user?.organizationId || '');
        const userId = String(hook.session?.userId || hook.user?.id || '');
        const context = { isSystem: true, userId, tenantId: organizationId, organizationId, transaction: hook.transaction };
        const storedReceipt = await engine.findOne('forge_quotation_contract_conversion', {
          where: { id: String(receipt.id || ''), quotation_id: String(receipt.quotation_id || ''), organization_id: organizationId },
        }, { context });
        const contract = await engine.findOne('forge_sales_contract', {
          where: { id: String(receipt.contract_id || ''), quotation_id: String(receipt.quotation_id || ''), organization_id: organizationId },
        }, { context });
        const lines = await engine.find('forge_sales_contract_line', {
          where: { contract_id: String(receipt.contract_id || '') },
        }, { context });
        if (!storedReceipt || contract?.quotation_source_type !== 'formal_conversion' || lines.length !== Number(receipt.line_count)) {
          throw new Error('QUOTATION_CONVERSION_RECEIPT_NOT_VISIBLE_WITH_CONTRACT_AND_LINES_IN_TRANSACTION');
        }
        throw new Error('FORCE_QUOTATION_CONVERSION_AFTER_RECEIPT_INSERT');
      }, { object: 'forge_quotation_contract_conversion', priority: 30_000, packageId: this.name });
    });
  }
}\n`);
  const quotationFailurePlugin = path.join(tempDir, 'quotation-file-claim-failure.plugin.mjs');
  await writeFile(path.join(tempDir, 'objectstack.config.ts'), `import { defineStack } from '@objectstack/spec';\nimport base from ${JSON.stringify(path.join(APP_DIR, 'objectstack.config.ts'))};\nimport { QuotationFileClaimFailurePlugin } from ${JSON.stringify(quotationFailurePlugin)};\nexport default defineStack({ ...base, plugins: [...base.plugins, new QuotationFileClaimFailurePlugin()] });\n`);
  await symlink(path.join(APP_DIR, 'src'), path.join(tempDir, 'src'), 'dir');
  await symlink(path.join(APP_DIR, 'node_modules'), path.join(tempDir, 'node_modules'), 'dir');

  async function startRuntime() {
    runtimeOutput = '';
    child = spawn(process.execPath, [path.join(APP_DIR, 'node_modules/@objectstack/cli/bin/run.js'), 'serve', 'objectstack.config.ts', '--port', String(PORT), '--log-level', 'error'], {
      cwd: tempDir,
      env: {
        ...process.env, NODE_ENV: 'production', OS_HOME: path.join(tempDir, '.os-home'), OS_DATABASE_URL: databaseUrl,
        OS_SECRET_KEY: SECRET_KEY, OS_AUTH_SECRET: AUTH_SECRET, OS_BASE_URL: ORIGIN, OS_TRUSTED_ORIGINS: ORIGIN,
        OS_ENVIRONMENT_ID: 'sales-quotation-' + RUN, OS_TENANCY_POSTURE: 'single', OS_SEED_ADMIN: 'false',
        OS_PLATFORM_OWNER_EMAIL: PLATFORM_OWNER_EMAIL, OS_AUTOMATION_SCHEDULED_WORK_ENABLED: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8').on('data', chunk => { runtimeOutput = (runtimeOutput + chunk).slice(-12000); });
    child.stderr.setEncoding('utf8').on('data', chunk => { runtimeOutput = (runtimeOutput + chunk).slice(-12000); });
    const deadline = Date.now() + 150_000;
    let health;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Official ObjectStack Runtime exited: ' + safeOutput(runtimeOutput, databaseUrl));
      try { health = await fetch(ORIGIN + '/api/v1/health', { signal: AbortSignal.timeout(1000) }); if (health.ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    assert.ok(health?.ok, 'Official Runtime on ' + PORT + ' did not start: ' + safeOutput(runtimeOutput, databaseUrl));
  }
  async function waitForPermissionRegistry() {
    const requiredNames = ['sales_order_operator', 'sales_contract_operator', 'sales_quotation_draft_operator', 'sales_quotation_reviewer'];
    const deadline = Date.now() + 30_000;
    let found = [];
    while (Date.now() < deadline) {
      try {
        const response = await postgres.query('SELECT name FROM sys_permission_set WHERE active=true AND name=ANY($1::text[])', [requiredNames]);
        found = response.rows.map(row => String(row.name));
        if (requiredNames.every(name => found.includes(name))) return;
      } catch {}
      if (child?.exitCode !== null) throw new Error('Official Runtime exited before the permission registry was ready: ' + safeOutput(runtimeOutput, databaseUrl));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Permission registry did not become ready before fixture creation: ' + JSON.stringify({ requiredNames, found }) + '\n' + safeOutput(runtimeOutput, databaseUrl));
  }
  async function tableSchema(tableName) {
    if (SCHEMAS.has(tableName)) return SCHEMAS.get(tableName);
    const result = await postgres.query('SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1', [tableName]);
    assert.ok(result.rows.length, 'Runtime registered PostgreSQL table ' + tableName);
    const columns = new Map(result.rows.map(row => [row.column_name, row])); SCHEMAS.set(tableName, columns); return columns;
  }
  async function insertFixture(tableName, values, ownerId = '') {
    const definition = await tableSchema(tableName), now = new Date().toISOString();
    const row = { id: id(), created_at: now, updated_at: now, ...values };
    if (!tableName.startsWith('sys_')) {
      if (ownerId) { row.owner_id ??= ownerId; row.created_by ??= ownerId; row.updated_by ??= ownerId; }
      if (organizationId) row.organization_id ??= organizationId;
    }
    const columns = [...definition.keys()].filter(name => row[name] !== undefined);
    const missing = [...definition.entries()].filter(([name, column]) => column.is_nullable === 'NO' && column.column_default == null && !columns.includes(name)).map(([name]) => name);
    assert.deepEqual(missing, [], 'fixture satisfies actual ' + tableName + ' schema');
    const quote = name => '"' + name.replaceAll('"', '""') + '"';
    await postgres.query(`INSERT INTO ${quote(tableName)} (${columns.map(quote).join(',')}) VALUES (${columns.map((_, index) => '$' + (index + 1)).join(',')})`, columns.map(name => row[name]));
    return row.id;
  }
  async function createPosition(name, permissionNames, targetOrganizationId = organizationId) {
    const existing = await postgres.query('SELECT id FROM sys_position WHERE name=$1 AND (organization_id=$2 OR organization_id IS NULL) ORDER BY organization_id NULLS LAST LIMIT 1', [name, targetOrganizationId]);
    const positionId = existing.rows[0]?.id || await insertFixture('sys_position', { name, label: '报价隔离测试岗位 ' + name, active: true, organization_id: targetOrganizationId });
    if (existing.rows.length) await postgres.query('UPDATE sys_position SET active=true WHERE id=$1', [positionId]);
    const permissions = await postgres.query('SELECT id,name FROM sys_permission_set WHERE name=ANY($1::text[]) AND active=true', [permissionNames]);
    const byName = new Map(permissions.rows.map(row => [row.name, row.id]));
    assert.deepEqual(permissionNames.filter(name => !byName.has(name)), [], 'all declared permission sets are loaded by the Runtime');
    for (const permissionName of permissionNames) {
      const bound = await postgres.query('SELECT 1 FROM sys_position_permission_set WHERE position_id=$1 AND permission_set_id=$2 LIMIT 1', [positionId, byName.get(permissionName)]);
      if (!bound.rows.length) await insertFixture('sys_position_permission_set', { position_id: positionId, permission_set_id: byName.get(permissionName), organization_id: targetOrganizationId });
    }
    return positionId;
  }
  async function createCaller(label, permissions, email = '', callerOrganizationId = organizationId) {
    const callerEmail = email || `sales-quotation-${++callerCounter}-${RUN}@example.test`;
    const password = 'SalesQuotation-' + randomBytes(24).toString('hex') + '!'; TRANSIENT_PASSWORDS.push(password);
    const callerId = id(), passwordHash = await hashPassword(password);
    await insertFixture('sys_user', { id: callerId, name: '报价隔离验收' + label, email: callerEmail, email_verified: true, banned: false, role: 'user', organization_id: null });
    await insertFixture('sys_account', {
      user_id: callerId, provider_id: 'credential', account_id: callerId, password: passwordHash,
      ...(accountHasIssuer ? { issuer: accountIssuerValue } : {}),
    });
    await insertFixture('sys_member', { user_id: callerId, organization_id: callerOrganizationId, role: 'member' });
    for (const permission of permissions) {
      await createPosition(permission, [permission], callerOrganizationId);
      await insertFixture('sys_user_position', { user_id: callerId, position: permission, organization_id: callerOrganizationId, valid_from: new Date(Date.now() - 60_000).toISOString(), valid_until: null });
    }
    const stored = await postgres.query('SELECT provider_id,account_id,password FROM sys_account WHERE user_id=$1', [callerId]);
    assert.deepEqual({ provider: stored.rows[0]?.provider_id, account: stored.rows[0]?.account_id }, { provider: 'credential', account: callerId });
    assert.ok(await verifyPassword({ hash: stored.rows[0].password, password }));
    callers.push({ id: callerId, email: callerEmail, password, client: null, cookie: '', organizationId: callerOrganizationId });
    return callers.at(-1);
  }
  async function signIn(caller) {
    const response = await fetch(ORIGIN + '/api/v1/auth/sign-in/email', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Forwarded-For': `198.51.100.${signInIp++}` },
      body: JSON.stringify({ email: caller.email, password: caller.password }),
    });
    const value = await response.json().catch(() => ({}));
    assert.equal(response.status, 200, 'BetterAuth sign-in returns an ordinary session: ' + String(value.code || value.message || value.error || '').slice(0, 120));
    const cookie = response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
    assert.ok(value.user?.id && cookie);
    caller.cookie = cookie;
    caller.client = { id: value.user.id, async request(resource, method = 'GET', body) {
      const result = await fetch(ORIGIN + '/api/v1' + resource, {
        method, headers: { Cookie: caller.cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const updatedCookie = result.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
      if (updatedCookie) caller.cookie = updatedCookie;
      return { status: result.status, value: await result.json().catch(() => null), response: result };
    } };
    assert.equal(caller.client.id, caller.id);
    return caller;
  }
  async function selectOrganization(caller) {
    const selectedResponse = await fetch(ORIGIN + '/api/v1/auth/organization/set-active', {
      method: 'POST', headers: { Origin: ORIGIN, Cookie: caller.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: caller.organizationId }),
    });
    const selectedValue = await selectedResponse.json().catch(() => null);
    const updatedCookie = selectedResponse.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
    if (updatedCookie) caller.cookie = updatedCookie;
    assert.equal(selectedResponse.status, 200, 'ordinary caller selects their actual native organization: ' + String(selectedValue?.message || selectedValue?.error || '').slice(0, 300));
    const session = resultOf(await caller.client.request('/auth/get-session'));
    const activeOrganizationId = session?.session?.activeOrganizationId || session?.session?.active_organization_id
      || session?.activeOrganizationId || session?.organizationId;
    assert.equal(activeOrganizationId, caller.organizationId, 'authenticated session carries the selected organization');
  }
  async function action(client, object, name, recordId, params = {}) {
    return client.request('/actions/' + object + '/' + name + (recordId ? '/' + encodeURIComponent(recordId) : ''), 'POST', { params });
  }
  const mcpSessions = new Map();
  function mcpState(caller) {
    let state = mcpSessions.get(caller);
    if (!state) { state = { sessionId: '', requestId: 0, initialized: false }; mcpSessions.set(caller, state); }
    return state;
  }
  async function mcpRequest(method, params = {}, notification = false, caller = quotationMaker) {
    const state = mcpState(caller);
    const message = { jsonrpc: '2.0', method, params };
    if (!notification) message.id = ++state.requestId;
    const response = await fetch(ORIGIN + '/api/v1/mcp', {
      method: 'POST',
      headers: {
        Cookie: caller.cookie,
        Origin: ORIGIN,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-03-26',
        ...(state.sessionId ? { 'MCP-Session-Id': state.sessionId } : {}),
      },
      body: JSON.stringify(message),
    });
    state.sessionId ||= response.headers.get('MCP-Session-Id') || '';
    const raw = await response.text();
    const dataLines = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).filter(Boolean);
    const payload = dataLines.length ? dataLines.at(-1) : raw;
    return { status: response.status, value: payload ? JSON.parse(payload) : null };
  }
  async function initializeMcp(caller = quotationMaker) {
    const state = mcpState(caller);
    if (state.initialized) return;
    const initialized = await mcpRequest('initialize', {
      protocolVersion: '2025-03-26', capabilities: {},
      clientInfo: { name: 'forge-quotation-native-pg-test', version: '1.0.0' },
    }, false, caller);
    assert.equal(initialized.status, 200, 'ordinary maker MCP initialize returns a session');
    assert.equal(initialized.value?.result?.protocolVersion, '2025-03-26');
    const notification = await mcpRequest('notifications/initialized', {}, true, caller);
    assert.ok([200, 202, 204].includes(notification.status), 'MCP initialized notification is accepted');
    state.initialized = true;
  }
  async function callMcpTool(name, arguments_, caller = quotationMaker) {
    if (name === 'run_action') arguments_ = { confirm: true, ...arguments_ };
    await initializeMcp(caller);
    const response = await mcpRequest('tools/call', { name, arguments: arguments_ }, false, caller);
    assert.equal(response.status, 200, `MCP ${name} transport returns a JSON-RPC result`);
    return response.value?.result ?? { _rpcError: response.value?.error };
  }
  function assertMcpApiDisabled(result, label, requestedObjectName, input) {
    assert.equal(result?.isError, true, `${label} is returned as an MCP tool error`);
    const content = (result?.content || []).filter(block => block?.type === 'text').map(block => String(block.text || '')).join('\n');
    let decoded;
    try { decoded = JSON.parse(content); } catch {}
    assert.equal(input?.objectName, requestedObjectName, `${label} was sent with the intended internal object name`);
    const apiDisabledMessage = `Object '${requestedObjectName}' is not exposed via the API`;
    const runtimeGenericExposureDenial = content.trim() === 'object is not exposed via the API';
    assert.ok(content.includes(apiDisabledMessage) || runtimeGenericExposureDenial || decoded?.error?.code === 'OBJECT_API_DISABLED',
      `${label} fails specifically at the apiEnabled:false exposure gate for ${requestedObjectName}: ${content.slice(0, 500)}`);
    assert.doesNotMatch(content, /unknown tool|tool not found|invalid params|objectName is required|Object .* not found/i,
      `${label} is not a tool/schema/unknown-object failure: ${content.slice(0, 500)}`);
  }
  async function uploadAttachment(client, label) {
    const prepared = await client.request('/storage/upload/presigned', 'POST', {
      filename: label + '-' + RUN + '.png', mimeType: 'image/png', size: PNG_BYTES.byteLength, scope: 'attachments',
    });
    assert.equal(prepared.status, 200, 'native quotation attachment prepare: ' + messageOf(prepared));
    const descriptor = resultOf(prepared);
    assert.ok(descriptor.fileId && descriptor.uploadUrl);
    const uploaded = await fetch(new URL(descriptor.uploadUrl, ORIGIN), {
      method: descriptor.method || 'PUT', headers: descriptor.headers || {}, body: PNG_BYTES,
    });
    assert.ok(uploaded.ok, 'native storage accepted quotation attachment bytes');
    const completed = await client.request('/storage/upload/complete', 'POST', { fileId: descriptor.fileId });
    assert.equal(completed.status, 200, 'native quotation attachment commit: ' + messageOf(completed));
    return descriptor.fileId;
  }
  async function downloadAttachmentBytes(client, fileId) {
    const response = await fetch(ORIGIN + '/api/v1/storage/files/' + encodeURIComponent(fileId), { headers: { Cookie: client.cookie } });
    assert.equal(response.status, 200, 'quotation owner can download its native evidence file');
    return Buffer.from(await response.arrayBuffer());
  }
  async function read(client, object, recordId) {
    const response = await client.request('/data/' + object + '/' + encodeURIComponent(recordId));
    return { response, record: resultOf(response)?.record || resultOf(response)?.data?.record || resultOf(response)?.data || resultOf(response) };
  }
  async function readAllRecords(client, object, fields) {
    const rows = [], seen = new Set(), size = 100;
    for (let skip = 0; skip < 20_000; skip += size) {
      const query = new URLSearchParams({ $top: String(size), $skip: String(skip), $count: 'true', $orderby: 'id asc', $select: fields.join(',') });
      const response = await client.request('/data/' + encodeURIComponent(object) + '?' + query.toString());
      assert.equal(response.status, 200, object + ' page ' + skip + ': ' + messageOf(response));
      const batch = rowsOf(response);
      for (const row of batch) {
        assert.ok(row.id && !seen.has(row.id), object + ' paging returns each record once');
        seen.add(row.id);
      }
      rows.push(...batch);
      if (batch.length < size) return rows;
    }
    assert.fail(object + ' exceeded the fixture paging cap');
  }
  async function captureScopedSalesState(organizationIds) {
    const quotes = await postgres.query(`SELECT id,organization_id,owner_id,responsible_id,status,customer_id,opportunity_id,opportunity_name,total_amount,pricing_version,sent_pricing_version,
        accepted_pricing_version,sent_evidence_attachment,sent_evidence_note,sent_evidence_request_signature,sent_at,sent_by,
        customer_acceptance_evidence_attachment,customer_acceptance_note,customer_acceptance_request_signature,accepted_at,accepted_by
        FROM forge_quotation WHERE organization_id=ANY($1::text[]) ORDER BY id`, [organizationIds]);
    const quotationLines = await postgres.query(`SELECT line.id,line.quotation_id,line.line_type,line.name,line.sku_id,line.quantity,line.taxed_unit_price,
        line.tax_rate,line.discount_rate,line.taxed_subtotal FROM forge_quotation_line line JOIN forge_quotation quote ON quote.id=line.quotation_id
        WHERE quote.organization_id=ANY($1::text[]) ORDER BY line.id`, [organizationIds]);
    const customers = await postgres.query('SELECT id,organization_id,owner_id,responsible_id FROM forge_customer WHERE organization_id=ANY($1::text[]) ORDER BY id', [organizationIds]);
    const contracts = await postgres.query(`SELECT id,organization_id,owner_id,responsible_id,quotation_id,quotation_source_type,status,total_amount,draft_request_signature
        FROM forge_sales_contract WHERE organization_id=ANY($1::text[]) ORDER BY id`, [organizationIds]);
    const contractLines = await postgres.query(`SELECT line.id,line.contract_id,line.quotation_line_id,line.quantity_limit,line.taxed_unit_price,line.taxed_subtotal
        FROM forge_sales_contract_line line JOIN forge_sales_contract contract ON contract.id=line.contract_id
        WHERE contract.organization_id=ANY($1::text[]) ORDER BY line.id`, [organizationIds]);
    const conversions = await postgres.query(`SELECT id,organization_id,quotation_id,contract_id,converted_by,converted_at,pricing_version,line_count,request_signature,acceptance_file_id
        FROM forge_quotation_contract_conversion WHERE organization_id=ANY($1::text[]) ORDER BY id`, [organizationIds]);
    const files = await postgres.query(`SELECT id,organization_id,owner_id,status,ref_object,ref_id,ref_field FROM sys_file
        WHERE organization_id=ANY($1::text[]) ORDER BY organization_id,id`, [organizationIds]);
    return {
      quotes: quotes.rows,
      quotationLines: quotationLines.rows,
      customers: customers.rows,
      contracts: contracts.rows,
      contractLines: contractLines.rows,
      conversions: conversions.rows,
      files: files.rows,
    };
  }
  async function assertRejected(response, label) {
    assert.ok(response.status >= 400 && response.status < 500, label + ' must be rejected with a client error: ' + response.status + ' ' + messageOf(response));
  }
  async function assertRejectedWithoutWrites(response, before, organizationIds, label) {
    await assertRejected(response, label);
    assert.deepEqual(await captureScopedSalesState(organizationIds), before,
      label + ' leaves both organizations’ quotes, files, conversion receipts, customers, contracts and lines unchanged');
  }
  async function pendingApproval(client, objectName, recordId, processName, nodeId) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const inbox = await client.request('/approvals/requests');
      assert.equal(inbox.status, 200, 'native approval inbox is available');
      const pending = rowsOf(inbox).find(row => row.object_name === objectName && row.record_id === recordId
        && row.process_name === 'flow:' + processName && row.flow_node_id === nodeId && row.status === 'pending');
      if (pending) return pending;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.fail('native ' + processName + ' approval did not reach the independent reviewer');
  }
  async function workbenchContext(client, requestId) {
    return client.request('/approvals/requests/' + encodeURIComponent(requestId) + '/workbench-context');
  }
  await startRuntime();
  await waitForPermissionRegistry();
  const accountSchema = await tableSchema('sys_account');
  assert.ok(accountSchema.has('provider_id') && accountSchema.has('account_id'));
  accountHasIssuer = accountSchema.has('issuer');
  if (accountHasIssuer) {
    assert.equal(typeof createLocalAccountIssuer, 'function', 'legacy account schema has the official Better Auth issuer factory');
    accountIssuerValue = createLocalAccountIssuer('credential');
  } else assert.equal(createLocalAccountIssuer, null, 'current account schema does not use the retired issuer factory');
  await stopRuntime();
  const platformOwner = await createCaller('临时平台管理员', [], PLATFORM_OWNER_EMAIL);
  await postgres.query('UPDATE sys_user SET created_at=$1,updated_at=$1 WHERE id=$2', [new Date(Date.now() - 5 * 60_000).toISOString(), platformOwner.id]);
  const seller = await createCaller('非报价所有者与合同经办', ['sales_order_operator', 'sales_contract_operator']);
  const quotationMaker = await createCaller('报价与合同经办', ['sales_quotation_draft_operator', 'sales_contract_operator', 'sales_lead_conversion_operator']);
  const quotationReviewer = await createCaller('独立报价审核', ['sales_quotation_reviewer']);
  const quotationSubmitterReviewer = await createCaller('报价本人兼审批岗', ['sales_quotation_draft_operator', 'sales_quotation_reviewer']);
  await startRuntime();
  for (const caller of [seller, quotationMaker, quotationReviewer, quotationSubmitterReviewer]) await signIn(caller);
  assert.equal((await postgres.query('SELECT current_database() AS name')).rows[0]?.name, DATABASE, 'native test uses its uniquely named isolated PostgreSQL database');
  const sellerMe = resultOf(await seller.client.request('/auth/me/permissions'));
  assert.equal(sellerMe?.positions?.includes('platform_admin'), false, 'non-owner contract actor is not the temporary platform owner');
  assert.equal(sellerMe?.systemPermissions?.includes('setup.write'), false, 'ordinary actors do not have Setup write');
  assert.ok(sellerMe?.systemPermissions?.includes('sales_contract_operator'));

  const otherQuotationMaker = await createCaller('同组织非报价负责人', ['sales_quotation_draft_operator']);
  await signIn(otherQuotationMaker);
  const foreignOrganizationId = await insertFixture('sys_organization', {
    id: id(), name: '报价外组织隔离组织 ' + RUN, slug: 'sales-quotation-foreign-' + RUN,
  });
  const foreignQuotationMaker = await createCaller('外组织报价经办', ['sales_quotation_draft_operator', 'sales_contract_operator'], '', foreignOrganizationId);
  await signIn(foreignQuotationMaker);
  await selectOrganization(foreignQuotationMaker);
  const foreignMakerPermissions = resultOf(await foreignQuotationMaker.client.request('/auth/me/permissions'));
  assert.ok(foreignMakerPermissions?.systemPermissions?.includes('sales_contract_operator'),
    'the foreign conversion probe holds the normal contract action permission, so rejection is not caused by a missing role');
  const testOrganizationIds = [organizationId, foreignOrganizationId];

  const categoryId = await insertFixture('forge_customer_category', { name: '报价隔离客户类别', code: 'SQC-' + RUN, status: 'active' }, quotationMaker.id);
  const foreignCategoryId = await insertFixture('forge_customer_category', {
    name: '外组织报价隔离客户类别', code: 'SQC-FOREIGN-' + RUN, status: 'active', organization_id: foreignOrganizationId,
  }, foreignQuotationMaker.id);
  const customerId = await insertFixture('forge_customer', { name: '报价发送接受隔离客户', category_id: categoryId, responsible_id: quotationMaker.id, status: 'active' }, quotationMaker.id);
  const mismatchCustomerId = await insertFixture('forge_customer', { name: '报价来源商机客户不匹配验证', category_id: categoryId, responsible_id: quotationMaker.id, status: 'active' }, quotationMaker.id);
  const sourceOpportunityName = '报价来源追溯隔离商机';
  const sourceOpportunityId = await insertFixture('forge_sales_opportunity', {
    name: sourceOpportunityName, customer_id: customerId, stage: 'proposal_quoted', responsible_id: quotationMaker.id,
  }, quotationMaker.id);
  const mismatchOpportunityId = await insertFixture('forge_sales_opportunity', {
    name: '不同客户来源商机', customer_id: mismatchCustomerId, stage: 'proposal_quoted', responsible_id: quotationMaker.id,
  }, quotationMaker.id);
  const inaccessibleOpportunityId = await insertFixture('forge_sales_opportunity', {
    name: '其他销售负责人商机', customer_id: customerId, stage: 'proposal_quoted', responsible_id: otherQuotationMaker.id,
  }, otherQuotationMaker.id);
  for (let index = 0; index < 501; index += 1) {
    await insertFixture('forge_sales_opportunity', {
      name: '报价来源分页商机' + String(index + 1).padStart(3, '0'), customer_id: customerId,
      stage: 'proposal_quoted', responsible_id: quotationMaker.id,
    }, quotationMaker.id);
  }
  const foreignCustomerId = await insertFixture('forge_customer', {
    name: '外组织来源商机客户', category_id: foreignCategoryId, responsible_id: foreignQuotationMaker.id, status: 'active', organization_id: foreignOrganizationId,
  }, foreignQuotationMaker.id);
  const foreignOpportunityName = '外组织来源商机';
  const foreignOpportunityId = await insertFixture('forge_sales_opportunity', {
    name: foreignOpportunityName, customer_id: foreignCustomerId, stage: 'proposal_quoted', responsible_id: foreignQuotationMaker.id,
    organization_id: foreignOrganizationId,
  }, foreignQuotationMaker.id);
  const quotationTypeId = await insertFixture('forge_quotation_type', { name: '报价文件事务测试类型', code: 'SQ-QTYPE-' + RUN, status: 'active' }, quotationMaker.id);
  const quotationIssuerId = await insertFixture('forge_quotation_issuer', { name: '报价文件事务测试主体', credit_code: 'SQ-QISSUER-' + RUN, short_name: '隔离报价主体', organization_id: organizationId }, quotationMaker.id);
  const contractTypeId = await insertFixture('forge_contract_type', { name: '报价转换合同类型', code: 'SQ-CONTRACT-TYPE-' + RUN, status: 'active' }, quotationMaker.id);
  async function createServiceQuote(caller, quoteCustomerId, label) {
    const response = await action(caller.client, 'forge_quotation', 'sales_quotation_draft_create', '', {
      code: 'SQ-QUOTE-' + label + '-' + RUN, name: '原生报价审批隔离测试 ' + label,
      customer_id: quoteCustomerId, quotation_type_id: quotationTypeId, issuer_id: quotationIssuerId,
      quotation_date: new Date().toISOString().slice(0, 10),
      valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      lines_json: JSON.stringify([{ line_type: 'service', name: '审批验证服务', quantity: 1, taxed_unit_price: 2300, tax_rate: 13, discount_rate: 0 }]),
    });
    assert.equal(response.status, 200, `Native quotation draft ${label}: ${messageOf(response)}`);
    const quotationId = resultOf(response)?.id;
    assert.ok(quotationId, `Native quotation draft ${label} returns its record`);
    return quotationId;
  }

  const quoteOnlyOpportunityRead = await otherQuotationMaker.client.request('/data/forge_sales_opportunity?$top=1');
  assert.ok([403, 404].includes(quoteOnlyOpportunityRead.status), 'a quotation-only role cannot list opportunities without an existing read grant');
  const quoteOnlyCustomerId = await insertFixture('forge_customer', {
    name: '无商机读取权限的直接报价客户', category_id: categoryId, responsible_id: otherQuotationMaker.id, status: 'active',
  }, otherQuotationMaker.id);
  const quoteOnlyDirectDraft = await action(otherQuotationMaker.client, 'forge_quotation', 'sales_quotation_draft_create', '', {
    code: 'SQ-QUOTE-DIRECT-' + RUN, name: '无商机读取权限的直接报价', customer_id: quoteOnlyCustomerId,
    quotation_type_id: quotationTypeId, issuer_id: quotationIssuerId,
    quotation_date: '2026-10-04', valid_until: '2026-10-31',
    lines_json: JSON.stringify([{ line_type: 'service', name: '直接报价服务', quantity: 1, taxed_unit_price: 1, tax_rate: 0, discount_rate: 0 }]),
  });
  assert.equal(quoteOnlyDirectDraft.status, 200, 'a role without opportunity read access can still create a direct quote');
  const quoteOnlyDirectRecord = (await read(otherQuotationMaker.client, 'forge_quotation', resultOf(quoteOnlyDirectDraft).id)).record;
  assert.equal(quoteOnlyDirectRecord.opportunity_id, null);
  assert.equal(quoteOnlyDirectRecord.opportunity_name, null);

  const visibleOpportunities = await readAllRecords(quotationMaker.client, 'forge_sales_opportunity', ['id', 'name', 'customer_id', 'owner_id', 'responsible_id']);
  assert.ok(visibleOpportunities.length > 500, 'the paged source query reads more than 500 authorized opportunities');
  assert.ok(visibleOpportunities.some(row => row.id === sourceOpportunityId), 'the source picker query returns the maker’s own opportunity');
  assert.ok(!visibleOpportunities.some(row => row.id === inaccessibleOpportunityId), 'the source picker query does not expose another employee’s opportunity');
  const inaccessibleRead = await read(quotationMaker.client, 'forge_sales_opportunity', inaccessibleOpportunityId);
  assert.ok([403, 404].includes(inaccessibleRead.response.status), 'the quotation actor cannot independently read another employee’s opportunity');

  const quoteDraftResponse = await action(quotationMaker.client, 'forge_quotation', 'sales_quotation_draft_create', '', {
    code: 'SQ-QUOTE-' + RUN, name: '报价发送接受附件事务验证', customer_id: customerId,
    opportunity_id: sourceOpportunityId, quotation_type_id: quotationTypeId, issuer_id: quotationIssuerId,
    quotation_date: '2026-10-04', valid_until: '2026-10-31',
    lines_json: JSON.stringify([{ line_type: 'service', name: '现场安装服务', quantity: 1, taxed_unit_price: 180, tax_rate: 13, discount_rate: 0 }]),
  });
  assert.equal(quoteDraftResponse.status, 200, 'ordinary quote maker creates a source-valid draft through the existing Action: ' + messageOf(quoteDraftResponse));
  nativeQuotationId = resultOf(quoteDraftResponse).id;
  assert.ok(nativeQuotationId);
  const linkedQuotation = await read(quotationMaker.client, 'forge_quotation', nativeQuotationId);
  assert.equal(linkedQuotation.record.opportunity_id, sourceOpportunityId, 'a valid same-customer source is persisted as a native lookup');
  assert.equal(linkedQuotation.record.opportunity_name, sourceOpportunityName, 'the authorized source name is retained on the quote for later display');
  for (const [label, sourceId, expectedPrivateValue] of [
    ['another customer', mismatchOpportunityId, '不同客户来源商机'],
    ['another employee scope', inaccessibleOpportunityId, '其他销售负责人商机'],
    ['another organization', foreignOpportunityId, foreignOpportunityName],
    ['missing source', id(), ''],
  ]) {
    const before = await captureScopedSalesState(testOrganizationIds);
    const rejected = await action(quotationMaker.client, 'forge_quotation', 'sales_quotation_draft_create', '', {
      code: 'SQ-QUOTE-REJECT-' + label.replaceAll(' ', '-') + '-' + RUN,
      name: '来源商机拒绝验证', customer_id: customerId, opportunity_id: sourceId,
      quotation_type_id: quotationTypeId, issuer_id: quotationIssuerId,
      quotation_date: '2026-10-04', valid_until: '2026-10-31',
      lines_json: JSON.stringify([{ line_type: 'service', name: '来源验证服务', quantity: 1, taxed_unit_price: 1, tax_rate: 0, discount_rate: 0 }]),
    });
    await assertRejectedWithoutWrites(rejected, before, testOrganizationIds, label + ' source opportunity');
    assert.match(messageOf(rejected), /所选来源商机不存在、无权访问或与当前客户不匹配/);
    assert.doesNotMatch(messageOf(rejected), new RegExp(sourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'the validation error does not reveal a source record identifier');
    if (expectedPrivateValue) assert.doesNotMatch(messageOf(rejected), new RegExp(expectedPrivateValue), 'the validation error does not reveal source details');
  }
  const templateSourceLines = await postgres.query(`SELECT id,line_type,name,sku_id,item_code,model,specification,unit_name,quantity,
    taxed_unit_price,tax_rate,discount_rate,taxed_subtotal,remarks FROM forge_quotation_line WHERE quotation_id=$1 ORDER BY id`, [nativeQuotationId]);
  assert.equal(templateSourceLines.rows.length, 1, 'template-import fixture uses the real draft quotation line');
  const firstPriceRevision = await action(quotationMaker.client, 'forge_quotation', 'quotation_adjust_line_price', nativeQuotationId, {
    line_id: templateSourceLines.rows[0].id, expected_pricing_version: 0, taxed_unit_price: 181, idempotency_key: 'quotation-pg-' + RUN + '-v0-to-v1',
  });
  assert.equal(firstPriceRevision.status, 200, 'quotation owner records a versioned native price adjustment: ' + messageOf(firstPriceRevision));
  assert.equal(Number(resultOf(firstPriceRevision)?.pricing_version), 1);
  const restoredPriceRevision = await action(quotationMaker.client, 'forge_quotation', 'quotation_adjust_line_price', nativeQuotationId, {
    line_id: templateSourceLines.rows[0].id, expected_pricing_version: 1, taxed_unit_price: 180, idempotency_key: 'quotation-pg-' + RUN + '-v1-to-v2',
  });
  assert.equal(restoredPriceRevision.status, 200, 'quotation owner restores the intended final line value through a second versioned Action: ' + messageOf(restoredPriceRevision));
  assert.equal(Number(resultOf(restoredPriceRevision)?.pricing_version), 2);
  const restoredQuoteLine = (await postgres.query('SELECT taxed_unit_price,taxed_subtotal FROM forge_quotation_line WHERE id=$1', [templateSourceLines.rows[0].id])).rows[0];
  assert.deepEqual({ unitPrice: Number(restoredQuoteLine.taxed_unit_price), subtotal: Number(restoredQuoteLine.taxed_subtotal) }, { unitPrice: 180, subtotal: 180 },
    'test starts approval with a positive current pricing version and the original source-line amounts');
  const templateContractLineInputs = templateSourceLines.rows.map(line => ({
    quotation_line_id: line.id,
    line_type: line.line_type,
    name: line.name,
    sku_id: line.sku_id,
    item_code: line.item_code,
    model: line.model,
    specification: line.specification,
    unit_name: line.unit_name,
    quantity_limit: Number(line.quantity),
    taxed_unit_price: Number(line.taxed_unit_price),
    tax_rate: Number(line.tax_rate),
    discount_rate: Number(line.discount_rate),
    remarks: line.remarks,
  }));
  const templateContracts = [];
  for (const [index, suffix] of ['A', 'B'].entries()) {
    const templateResponse = await action(quotationMaker.client, 'forge_sales_contract', 'sales_contract_draft_create', '', {
      header_json: JSON.stringify({
        code: 'SQ-QUOTE-TEMPLATE-' + suffix + '-' + RUN,
        name: '同一报价模板合同草稿 ' + suffix,
        contract_type_id: contractTypeId,
        customer_id: customerId,
        quotation_id: nativeQuotationId,
        responsible_id: quotationMaker.id,
        starts_on: '2026-10-04',
        ends_on: '2027-10-04',
      }),
      lines_json: JSON.stringify(templateContractLineInputs),
      fees_json: '[]',
    });
    assert.equal(templateResponse.status, 200, 'ordinary contract operator imports a quote template draft ' + suffix + ': ' + messageOf(templateResponse));
    const templateContractId = resultOf(templateResponse)?.id;
    assert.ok(templateContractId, 'template import returns a saved contract ID');
    templateContracts.push(templateContractId);
    const persistedTemplate = (await postgres.query(`SELECT id,quotation_id,quotation_source_type,status,owner_id,responsible_id
      FROM forge_sales_contract WHERE id=$1`, [templateContractId])).rows[0];
    assert.deepEqual(persistedTemplate, {
      id: templateContractId, quotation_id: nativeQuotationId, quotation_source_type: 'template_import', status: 'draft',
      owner_id: quotationMaker.id, responsible_id: quotationMaker.id,
    }, 'multiple saved drafts from one quotation retain explicit template-import provenance');
    const persistedTemplateLines = await postgres.query(`SELECT quotation_line_id,quantity_limit,taxed_unit_price,tax_rate,discount_rate,taxed_subtotal
      FROM forge_sales_contract_line WHERE contract_id=$1`, [templateContractId]);
    assert.equal(persistedTemplateLines.rows.length, templateSourceLines.rows.length, 'template import keeps every quotation line');
    assert.deepEqual(persistedTemplateLines.rows.map(line => ({
      quotation_line_id: line.quotation_line_id, quantity: Number(line.quantity_limit), price: Number(line.taxed_unit_price),
      tax: Number(line.tax_rate), discount: Number(line.discount_rate), subtotal: Number(line.taxed_subtotal),
    })), templateSourceLines.rows.map(line => ({
      quotation_line_id: line.id, quantity: Number(line.quantity), price: Number(line.taxed_unit_price),
      tax: Number(line.tax_rate), discount: Number(line.discount_rate), subtotal: Number(line.taxed_subtotal),
    })), 'template lines preserve the source quote snapshot');
  }
  assert.equal(new Set(templateContracts).size, 2, 'two quote-derived template contracts coexist before formal conversion');
  const submittedQuotation = await action(quotationMaker.client, 'forge_quotation', 'quotation_submit', nativeQuotationId, {});
  assert.equal(submittedQuotation.status, 200, 'quote enters the configured native approval process: ' + messageOf(submittedQuotation));
  const quoteApproval = await pendingApproval(quotationReviewer.client, 'forge_quotation', nativeQuotationId, 'sales_quotation_approval', 'quotation_review');
  nativeQuotationApprovalId = quoteApproval.id;
  const quoteWorkList = await quotationReviewer.client.request('/workbench/approvals?limit=100');
  assert.equal(quoteWorkList.status, 200, 'the normal employee approval work list reads native quote work');
  assert.ok(rowsOf(quoteWorkList).some(item => item.requestId === quoteApproval.id), 'the assigned quote reviewer sees the native request in the normal desktop work list');
  const quoteContextResponse = await workbenchContext(quotationReviewer.client, quoteApproval.id);
  assert.equal(quoteContextResponse.status, 200, 'the assigned reviewer receives the native quote approval context');
  assert.deepEqual(quoteContextResponse.value.businessObject, {
    objectName: 'forge_quotation', recordId: nativeQuotationId, recordName: '报价发送接受附件事务验证',
  });
  const quoteContextActions = quoteContextResponse.value.availableActions;
  assert.deepEqual(quoteContextActions.map(item => [item.semantic, item.execution.actionName]), [
    ['approve', QUOTATION_APPROVE_ACTION], ['reject', QUOTATION_REJECT_ACTION],
  ], 'quote context offers only the two decisions supported by its native flow');
  assert.ok(!quoteContextResponse.value.fields.some(field => field.label === '总成本'), 'quote reviewer context preserves the native field mask for aggregate cost');
  const approvalPermission = await postgres.query("SELECT id FROM sys_permission_set WHERE name='sales_quotation_reviewer' AND active=true LIMIT 1");
  assert.ok(approvalPermission.rows[0]?.id, 'the native reviewer permission set is available to the isolated runtime');
  const reviewerTools = await callMcpTool('list_actions', {}, quotationReviewer);
  assert.ok(mcpData(reviewerTools)?.actions?.some(item => item.name === QUOTATION_APPROVE_ACTION), 'the signed-in reviewer MCP catalog exposes quote approve');
  assert.ok(mcpData(reviewerTools)?.actions?.some(item => item.name === QUOTATION_REJECT_ACTION), 'the signed-in reviewer MCP catalog exposes quote reject');
  const quoteApproveAction = quoteContextActions.find(item => item.semantic === 'approve');
  const quoteRejectAction = quoteContextActions.find(item => item.semantic === 'reject');
  assert.ok(quoteApproveAction && quoteRejectAction);
  const beforeQuoteDecisions = await postgres.query('SELECT count(*)::int AS count FROM sys_approval_action WHERE request_id=$1', [quoteApproval.id]);
  const staleMaterial = await callMcpTool('run_action', {
    actionName: QUOTATION_APPROVE_ACTION, objectName: 'forge_quotation', recordId: nativeQuotationId,
    params: { ...quoteApproveAction.execution.params, sourceMaterialVersion: 'f'.repeat(64), comment: '旧材料不得审批' },
  }, quotationReviewer);
  assert.equal(staleMaterial?.isError, true, 'a stale frozen quote material version is rejected before any native write');
  const staleItem = await callMcpTool('run_action', {
    actionName: QUOTATION_APPROVE_ACTION, objectName: 'forge_quotation', recordId: nativeQuotationId,
    params: { ...quoteApproveAction.execution.params, itemVersion: 'v1-' + '0'.repeat(64), comment: '旧事项不得审批' },
  }, quotationReviewer);
  assert.equal(staleItem?.isError, true, 'a stale native quote item version is rejected before any native write');
  assert.equal((await postgres.query('SELECT count(*)::int AS count FROM sys_approval_action WHERE request_id=$1', [quoteApproval.id])).rows[0].count,
    beforeQuoteDecisions.rows[0].count, 'stale context attempts do not create native approval actions');
  const noncurrentQuoteContext = await workbenchContext(quotationMaker.client, quoteApproval.id);
  assert.equal(noncurrentQuoteContext.status, 404, 'the quote submitter without reviewer assignment cannot read the reviewer context');
  const noncurrentQuoteAction = await callMcpTool('run_action', {
    actionName: QUOTATION_APPROVE_ACTION, objectName: 'forge_quotation', recordId: nativeQuotationId,
    params: { ...quoteApproveAction.execution.params, comment: '非审批人不得批准' },
  }, quotationMaker);
  assert.equal(noncurrentQuoteAction?.isError, true, 'a non-reviewer cannot invoke quote approval with another employee’s context');
  assert.equal((await postgres.query('SELECT count(*)::int AS count FROM sys_approval_action WHERE request_id=$1', [quoteApproval.id])).rows[0].count,
    beforeQuoteDecisions.rows[0].count, 'noncurrent quote decisions leave the native action history unchanged');
  const quoteDecisionTool = await callMcpTool('run_action', {
    actionName: QUOTATION_APPROVE_ACTION, objectName: 'forge_quotation', recordId: nativeQuotationId,
    params: { ...quoteApproveAction.execution.params, comment: '隔离报价版本与明细已核对' },
  }, quotationReviewer);
  const quoteDecision = mcpData(quoteDecisionTool);
  assert.equal(quoteDecision?.result?.decision, 'approve', 'independent reviewer decides through the native ApprovalService');
  assert.equal(quoteDecision?.result?.status, 'approved');
  assert.equal(quoteDecision?.result?.resumed, true, 'the native quote flow resumes after ApprovalService decides');
  const quoteNativeAudit = await postgres.query(`SELECT r.object_name,r.record_id,r.process_name,r.flow_node_id,r.submitter_id,r.status,a.actor_id,a.action
    FROM sys_approval_request r JOIN sys_approval_action a ON a.request_id=r.id
    WHERE r.id=$1 AND a.action='approve' ORDER BY a.created_at DESC LIMIT 1`, [quoteApproval.id]);
  assert.deepEqual(quoteNativeAudit.rows.map(row => [row.object_name,row.record_id,row.process_name,row.flow_node_id,row.submitter_id,row.status,row.actor_id,row.action]), [[
    'forge_quotation',nativeQuotationId,'flow:sales_quotation_approval','quotation_review',quotationMaker.id,'approved',quotationReviewer.id,'approve',
  ]], 'native approval ledger proves a distinct submitter and reviewer');
  let approvedQuotation;
  const approvedQuotationDeadline = Date.now() + 20_000;
  while (Date.now() < approvedQuotationDeadline) {
    approvedQuotation = (await read(quotationMaker.client, 'forge_quotation', nativeQuotationId)).record;
    if (approvedQuotation?.status === 'approved') break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(approvedQuotation?.status, 'approved');
  const directQuotePatch = await quotationMaker.client.request('/data/forge_quotation/' + encodeURIComponent(nativeQuotationId), 'PATCH', { status: 'accepted' });
  assert.ok([403, 405].includes(directQuotePatch.status), 'generic Data API cannot bypass native quote approval or acceptance Actions');

  const rejectedQuotationId = await createServiceQuote(quotationMaker, customerId, 'reject');
  const rejectedSubmit = await action(quotationMaker.client, 'forge_quotation', 'quotation_submit', rejectedQuotationId, {});
  assert.equal(rejectedSubmit.status, 200, 'second quote enters the native approval flow for rejection coverage: ' + messageOf(rejectedSubmit));
  const rejectedQuoteApproval = await pendingApproval(quotationReviewer.client, 'forge_quotation', rejectedQuotationId, 'sales_quotation_approval', 'quotation_review');
  const rejectedQuoteContext = await workbenchContext(quotationReviewer.client, rejectedQuoteApproval.id);
  assert.equal(rejectedQuoteContext.status, 200);
  const currentRejectAction = rejectedQuoteContext.value.availableActions.find(item => item.semantic === 'reject' && item.execution.actionName === QUOTATION_REJECT_ACTION);
  assert.ok(currentRejectAction, 'native context provides the existing flow’s reject decision');
  const rejectQuoteResult = mcpData(await callMcpTool('run_action', {
    actionName: QUOTATION_REJECT_ACTION, objectName: 'forge_quotation', recordId: rejectedQuotationId,
    params: { ...currentRejectAction.execution.params, comment: '隔离报价版本未达到审批要求' },
  }, quotationReviewer));
  assert.equal(rejectQuoteResult?.result?.decision, 'reject');
  assert.equal(rejectQuoteResult?.result?.status, 'rejected');
  assert.equal(rejectQuoteResult?.result?.resumed, true, 'native reject resumes the existing quote flow');
  assert.equal((await read(quotationMaker.client, 'forge_quotation', rejectedQuotationId)).record.status, 'rejected');
  assert.equal((await postgres.query('SELECT status FROM sys_approval_request WHERE id=$1', [rejectedQuoteApproval.id])).rows[0]?.status, 'rejected');

  const selfReviewer = quotationSubmitterReviewer;
  const selfCustomerId = await insertFixture('forge_customer', {
    name: '报价本人审批拒绝验证客户 ' + RUN, category_id: categoryId, responsible_id: selfReviewer.id, status: 'active',
  }, selfReviewer.id);
  const selfQuotationId = await createServiceQuote(selfReviewer, selfCustomerId, 'self-review');
  const selfSubmitted = await action(selfReviewer.client, 'forge_quotation', 'quotation_submit', selfQuotationId, {});
  assert.equal(selfSubmitted.status, 200, 'the submitter also holds the existing reviewer permission and position for the self-review negative case');
  const selfQuoteApproval = await pendingApproval(quotationReviewer.client, 'forge_quotation', selfQuotationId, 'sales_quotation_approval', 'quotation_review');
  const externalReviewerContext = await workbenchContext(quotationReviewer.client, selfQuoteApproval.id);
  assert.equal(externalReviewerContext.status, 200);
  const externalApproveAction = externalReviewerContext.value.availableActions.find(item => item.semantic === 'approve');
  assert.ok(externalApproveAction);
  const selfContext = await workbenchContext(selfReviewer.client, selfQuoteApproval.id);
  if (selfContext.status === 200) {
    assert.equal(selfContext.value.viewer, 'current_approver');
    assert.deepEqual(selfContext.value.availableActions, [], 'a quote submitter who also holds the reviewer role receives no self-approval action');
  } else assert.equal(selfContext.status, 404, 'native visibility may hide a submitter from their own reviewer context');
  const selfDecisionCount = await postgres.query('SELECT count(*)::int AS count FROM sys_approval_action WHERE request_id=$1', [selfQuoteApproval.id]);
  const selfNativeApprove = await selfReviewer.client.request('/approvals/requests/' + encodeURIComponent(selfQuoteApproval.id) + '/approve', 'POST', { comment: '本人不能通过原生 REST 自审报价' });
  assert.equal(selfNativeApprove.status, 403, 'the shared native ApprovalService decision boundary rejects quote self-approval through REST approve');
  const selfNativeReject = await selfReviewer.client.request('/approvals/requests/' + encodeURIComponent(selfQuoteApproval.id) + '/reject', 'POST', { comment: '本人不能通过原生 REST 自驳回报价' });
  assert.equal(selfNativeReject.status, 403, 'the shared native ApprovalService decision boundary rejects quote self-rejection through REST reject');
  assert.equal((await postgres.query('SELECT count(*)::int AS count FROM sys_approval_action WHERE request_id=$1', [selfQuoteApproval.id])).rows[0].count,
    selfDecisionCount.rows[0].count, 'both native REST self-decision attempts leave the approval action history unchanged');
  assert.equal((await read(selfReviewer.client, 'forge_quotation', selfQuotationId)).record.status, 'pending_approval', 'both native REST self-decisions leave the quote pending');
  const selfAttempt = await callMcpTool('run_action', {
    actionName: QUOTATION_APPROVE_ACTION, objectName: 'forge_quotation', recordId: selfQuotationId,
    params: { ...externalApproveAction.execution.params, comment: '本人不能审批自己的报价' },
  }, selfReviewer);
  assert.equal(selfAttempt?.isError, true, 'the server rejects a valid native action replayed by the quote submitter');
  assert.match(mcpText(selfAttempt), /APPROVAL_ACTION_FORBIDDEN/);
  assert.equal((await postgres.query("SELECT count(*)::int AS count FROM sys_approval_action WHERE request_id=$1 AND actor_id=$2 AND action IN ('approve','reject','revise')",
    [selfQuoteApproval.id, selfReviewer.id])).rows[0].count, 0, 'self-approval rejection does not write a native decision');
  assert.equal((await read(selfReviewer.client, 'forge_quotation', selfQuotationId)).record.status, 'pending_approval');
  const independentSelfQuoteDecision = mcpData(await callMcpTool('run_action', {
    actionName: QUOTATION_APPROVE_ACTION, objectName: 'forge_quotation', recordId: selfQuotationId,
    params: { ...externalApproveAction.execution.params, comment: '独立审批人核对本人报价的冻结版本' },
  }, quotationReviewer));
  assert.equal(independentSelfQuoteDecision?.result?.decision, 'approve');
  assert.equal(independentSelfQuoteDecision?.result?.status, 'approved');

  const nativeRestRejectedQuotationId = await createServiceQuote(quotationMaker, customerId, 'native-rest-reject');
  const nativeRestRejectSubmit = await action(quotationMaker.client, 'forge_quotation', 'quotation_submit', nativeRestRejectedQuotationId, {});
  assert.equal(nativeRestRejectSubmit.status, 200, 'a third quote enters the native approval flow for REST reject compatibility coverage');
  const nativeRestRejectApproval = await pendingApproval(quotationReviewer.client, 'forge_quotation', nativeRestRejectedQuotationId, 'sales_quotation_approval', 'quotation_review');
  const nativeRestReject = await quotationReviewer.client.request('/approvals/requests/' + encodeURIComponent(nativeRestRejectApproval.id) + '/reject', 'POST', { comment: '独立报价审批人经原生 REST 驳回' });
  assert.equal(nativeRestReject.status, 200, 'an independent current reviewer can still decide quote rejection through native REST');
  assert.equal((await read(quotationMaker.client, 'forge_quotation', nativeRestRejectedQuotationId)).record.status, 'rejected', 'native REST reject resumes the existing quote Flow');

  nativeQuotationSendFileId = await uploadAttachment(quotationMaker.client, 'quote-send-evidence');
  const quoteSendParams = { sent_evidence_attachment: nativeQuotationSendFileId, sent_evidence_note: '隔离测试：本地合成发送回执与送达说明' };
  const sameOrgOtherActorSendFileId = await uploadAttachment(otherQuotationMaker.client, 'quote-other-actor-send-evidence');
  const foreignOrgSendFileId = await uploadAttachment(foreignQuotationMaker.client, 'quote-foreign-org-send-evidence');
  const stateBeforeOtherActorSend = await captureScopedSalesState(testOrganizationIds);
  await assertRejectedWithoutWrites(await action(otherQuotationMaker.client, 'forge_quotation', 'quotation_send', nativeQuotationId, {
    sent_evidence_attachment: sameOrgOtherActorSendFileId, sent_evidence_note: '隔离测试：非负责人尝试登记发送',
  }), stateBeforeOtherActorSend, testOrganizationIds, 'same-organization non-owner send');
  const stateBeforeForeignOrgSend = await captureScopedSalesState(testOrganizationIds);
  await assertRejectedWithoutWrites(await action(foreignQuotationMaker.client, 'forge_quotation', 'quotation_send', nativeQuotationId, {
    sent_evidence_attachment: foreignOrgSendFileId, sent_evidence_note: '隔离测试：外组织尝试登记发送',
  }), stateBeforeForeignOrgSend, testOrganizationIds, 'cross-organization send');
  const stateBeforeForeignFileSend = await captureScopedSalesState(testOrganizationIds);
  await assertRejectedWithoutWrites(await action(quotationMaker.client, 'forge_quotation', 'quotation_send', nativeQuotationId, {
    sent_evidence_attachment: foreignOrgSendFileId, sent_evidence_note: '隔离测试：本组织负责人引用外组织凭证',
  }), stateBeforeForeignFileSend, testOrganizationIds, 'send with a file owned by a different organization');
  const injectedSendFailure = await action(quotationMaker.client, 'forge_quotation', 'quotation_send', nativeQuotationId, quoteSendParams);
  assert.equal(injectedSendFailure.status, 400, 'failure after native file-reference claim rejects the send transaction: ' + messageOf(injectedSendFailure));
  assert.match(messageOf(injectedSendFailure), /FORCE_QUOTATION_SEND_AFTER_NATIVE_FILE_CLAIM/);
  const [quoteAfterSendRollback, fileAfterSendRollback] = await Promise.all([
    read(quotationMaker.client, 'forge_quotation', nativeQuotationId),
    postgres.query('SELECT ref_object,ref_id,ref_field FROM sys_file WHERE id=$1', [nativeQuotationSendFileId]),
  ]);
  assert.equal(quoteAfterSendRollback.record.status, 'approved');
  assert.deepEqual(fileAfterSendRollback.rows[0], { ref_object: null, ref_id: null, ref_field: null }, 'failed send leaves the native sys_file reference unattached');
  const sentQuotationResponse = await action(quotationMaker.client, 'forge_quotation', 'quotation_send', nativeQuotationId, quoteSendParams);
  assert.equal(sentQuotationResponse.status, 200, 'same evidence can be retried after the failed SQL transaction: ' + messageOf(sentQuotationResponse));
  const sentQuotation = (await read(quotationMaker.client, 'forge_quotation', nativeQuotationId)).record;
  assert.deepEqual({ status: sentQuotation.status, sent_version: Number(sentQuotation.sent_pricing_version), version: Number(sentQuotation.pricing_version) },
    { status: 'sent', sent_version: Number(sentQuotation.pricing_version), version: Number(sentQuotation.pricing_version) });
  assert.deepEqual((await postgres.query('SELECT ref_object,ref_id,ref_field FROM sys_file WHERE id=$1', [nativeQuotationSendFileId])).rows[0], {
    ref_object: 'forge_quotation', ref_id: nativeQuotationId, ref_field: 'sent_evidence_attachment',
  });
  const stateAfterSendBeforeReplay = await captureScopedSalesState(testOrganizationIds);
  const originalSendBytesBeforeReplay = await downloadAttachmentBytes(quotationMaker, nativeQuotationSendFileId);
  const duplicateSendReplay = await action(quotationMaker.client, 'forge_quotation', 'quotation_send', nativeQuotationId, quoteSendParams);
  assert.equal(duplicateSendReplay.status, 200, 'identical same-field send replay is idempotent: ' + messageOf(duplicateSendReplay));
  assert.equal(resultOf(duplicateSendReplay)?.repeated, true);
  assert.equal((await postgres.query('SELECT count(*)::int AS count FROM sys_file WHERE id=$1 AND ref_object=$2 AND ref_id=$3 AND ref_field=$4',
    [nativeQuotationSendFileId, 'forge_quotation', nativeQuotationId, 'sent_evidence_attachment'])).rows[0].count, 1);
  assert.deepEqual(await captureScopedSalesState(testOrganizationIds), stateAfterSendBeforeReplay, 'same original send parameters replay without another file/reference or signature change');
  assert.deepEqual(await downloadAttachmentBytes(quotationMaker, nativeQuotationSendFileId), originalSendBytesBeforeReplay, 'send replay preserves original evidence bytes');
  await assertRejectedWithoutWrites(await action(quotationMaker.client, 'forge_quotation', 'quotation_send', nativeQuotationId, {
    ...quoteSendParams, sent_evidence_note: quoteSendParams.sent_evidence_note + '（修改说明）',
  }), stateAfterSendBeforeReplay, testOrganizationIds, 'send replay with a different note');
  const differentSendFileId = await uploadAttachment(quotationMaker.client, 'quote-different-send-file');
  await assertRejectedWithoutWrites(await action(quotationMaker.client, 'forge_quotation', 'quotation_send', nativeQuotationId, {
    ...quoteSendParams, sent_evidence_attachment: differentSendFileId,
  }), await captureScopedSalesState(testOrganizationIds), testOrganizationIds, 'send replay with a different file');
  const sentPricingVersion = Number((await read(quotationMaker.client, 'forge_quotation', nativeQuotationId)).record.pricing_version);
  await postgres.query('UPDATE forge_quotation SET pricing_version=$1 WHERE id=$2', [sentPricingVersion + 1, nativeQuotationId]);
  const stateWithDriftedSendVersion = await captureScopedSalesState(testOrganizationIds);
  await assertRejectedWithoutWrites(await action(quotationMaker.client, 'forge_quotation', 'quotation_send', nativeQuotationId, quoteSendParams),
    stateWithDriftedSendVersion, testOrganizationIds, 'send replay with a changed pricing version');
  await postgres.query('UPDATE forge_quotation SET pricing_version=$1 WHERE id=$2', [sentPricingVersion, nativeQuotationId]);

  const quoteAcceptParams = {
    customer_acceptance_evidence_attachment: nativeQuotationSendFileId,
    customer_acceptance_note: '隔离测试：本地合成客户接受回执；验证原生跨字段持有复制',
  };
  const stateBeforeSameOrgActorAccept = await captureScopedSalesState(testOrganizationIds);
  await assertRejectedWithoutWrites(await action(otherQuotationMaker.client, 'forge_quotation', 'quotation_accept', nativeQuotationId, {
    ...quoteAcceptParams, customer_acceptance_evidence_attachment: sameOrgOtherActorSendFileId,
  }), stateBeforeSameOrgActorAccept, testOrganizationIds, 'same-organization non-owner acceptance');
  const stateBeforeForeignOrgAccept = await captureScopedSalesState(testOrganizationIds);
  await assertRejectedWithoutWrites(await action(foreignQuotationMaker.client, 'forge_quotation', 'quotation_accept', nativeQuotationId, {
    ...quoteAcceptParams, customer_acceptance_evidence_attachment: foreignOrgSendFileId,
  }), stateBeforeForeignOrgAccept, testOrganizationIds, 'cross-organization acceptance');
  const versionBeforeStaleAccept = Number((await read(quotationMaker.client, 'forge_quotation', nativeQuotationId)).record.pricing_version);
  const stateBeforeForeignFileAccept = await captureScopedSalesState(testOrganizationIds);
  await assertRejectedWithoutWrites(await action(quotationMaker.client, 'forge_quotation', 'quotation_accept', nativeQuotationId, {
    ...quoteAcceptParams, customer_acceptance_evidence_attachment: foreignOrgSendFileId,
  }), stateBeforeForeignFileAccept, testOrganizationIds, 'acceptance with a file owned by a different organization');
  await postgres.query('UPDATE forge_quotation SET pricing_version=$1 WHERE id=$2', [versionBeforeStaleAccept + 1, nativeQuotationId]);
  const stateWithDriftedAcceptanceVersion = await captureScopedSalesState(testOrganizationIds);
  await assertRejectedWithoutWrites(await action(quotationMaker.client, 'forge_quotation', 'quotation_accept', nativeQuotationId, quoteAcceptParams),
    stateWithDriftedAcceptanceVersion, testOrganizationIds, 'acceptance replay with a changed pricing version');
  await postgres.query('UPDATE forge_quotation SET pricing_version=$1 WHERE id=$2', [versionBeforeStaleAccept, nativeQuotationId]);
  const organizationFileIdsBeforeAcceptance = (await postgres.query('SELECT id FROM sys_file WHERE organization_id=ANY($1::text[]) ORDER BY organization_id,id', [testOrganizationIds])).rows.map(row => row.id);
  assert.ok(organizationFileIdsBeforeAcceptance.includes(nativeQuotationSendFileId), 'organization-scoped snapshot includes the original send evidence');
  const originalSendFileBeforeAcceptance = (await postgres.query('SELECT id,ref_object,ref_id,ref_field FROM sys_file WHERE id=$1 AND organization_id=$2', [nativeQuotationSendFileId, organizationId])).rows[0];
  assert.deepEqual(originalSendFileBeforeAcceptance, { id: nativeQuotationSendFileId, ref_object: 'forge_quotation', ref_id: nativeQuotationId, ref_field: 'sent_evidence_attachment' });
  const originalSendBytesBeforeAcceptance = await downloadAttachmentBytes(quotationMaker, nativeQuotationSendFileId);
  assert.deepEqual(originalSendBytesBeforeAcceptance, PNG_BYTES, 'original send attachment has the uploaded bytes before acceptance');
  const injectedAcceptanceFailure = await action(quotationMaker.client, 'forge_quotation', 'quotation_accept', nativeQuotationId, quoteAcceptParams);
  assert.equal(injectedAcceptanceFailure.status, 400, 'failure after native acceptance file-reference claim rejects the transaction: ' + messageOf(injectedAcceptanceFailure));
  assert.match(messageOf(injectedAcceptanceFailure), /FORCE_QUOTATION_ACCEPT_AFTER_NATIVE_FILE_CLAIM/);
  assert.equal((await read(quotationMaker.client, 'forge_quotation', nativeQuotationId)).record.status, 'sent', 'failed acceptance leaves the quotation sent');
  assert.deepEqual((await postgres.query('SELECT ref_object,ref_id,ref_field FROM sys_file WHERE id=$1', [nativeQuotationSendFileId])).rows[0], {
    ref_object: 'forge_quotation', ref_id: nativeQuotationId, ref_field: 'sent_evidence_attachment',
  }, 'failed acceptance cannot move the original send proof');
  const organizationFilesAfterAcceptanceFailure = await postgres.query('SELECT id,ref_object,ref_id,ref_field FROM sys_file WHERE organization_id=ANY($1::text[]) ORDER BY organization_id,id', [testOrganizationIds]);
  assert.equal(organizationFilesAfterAcceptanceFailure.rows.length, organizationFileIdsBeforeAcceptance.length,
    'failed copy-on-claim leaves the organization sys_file row count unchanged');
  assert.deepEqual(organizationFilesAfterAcceptanceFailure.rows.map(row => row.id), organizationFileIdsBeforeAcceptance,
    'failed copy-on-claim leaves no new orphan or unreferenced sys_file row');
  const originalSendFileAfterAcceptanceFailure = (await postgres.query('SELECT id,ref_object,ref_id,ref_field FROM sys_file WHERE id=$1 AND organization_id=$2', [nativeQuotationSendFileId, organizationId])).rows[0];
  assert.deepEqual(originalSendFileAfterAcceptanceFailure, originalSendFileBeforeAcceptance, 'failed acceptance preserves the original send file reference');
  assert.deepEqual(await downloadAttachmentBytes(quotationMaker, nativeQuotationSendFileId), originalSendBytesBeforeAcceptance,
    'failed acceptance preserves the original send attachment bytes');
  assert.equal((await postgres.query('SELECT count(*)::int AS count FROM sys_file WHERE ref_object=$1 AND ref_id=$2 AND ref_field=$3',
    ['forge_quotation', nativeQuotationId, 'customer_acceptance_evidence_attachment'])).rows[0].count, 0, 'failed acceptance leaves no target reference');
  const acceptedQuotationResponse = await action(quotationMaker.client, 'forge_quotation', 'quotation_accept', nativeQuotationId, quoteAcceptParams);
  assert.equal(acceptedQuotationResponse.status, 200, 'ordinary quote maker records customer acceptance through native copy-on-claim: ' + messageOf(acceptedQuotationResponse));
  const acceptedQuotation = (await read(quotationMaker.client, 'forge_quotation', nativeQuotationId)).record;
  nativeQuotationAcceptanceFileId = fileIdOf(acceptedQuotation.customer_acceptance_evidence_attachment);
  assert.ok(nativeQuotationAcceptanceFileId, 'accepted quotation stores the claimed acceptance file');
  assert.notEqual(nativeQuotationAcceptanceFileId, nativeQuotationSendFileId, 'native copy-on-claim gives the acceptance field its own file reference');
  const acceptedAttachmentBytes = await downloadAttachmentBytes(quotationMaker, nativeQuotationAcceptanceFileId);
  assert.deepEqual(acceptedAttachmentBytes, originalSendBytesBeforeAcceptance, 'copy-on-claim preserves byte-identical customer-acceptance evidence');
  assert.deepEqual({ status: acceptedQuotation.status, sentVersion: Number(acceptedQuotation.sent_pricing_version), acceptedVersion: Number(acceptedQuotation.accepted_pricing_version), pricingVersion: Number(acceptedQuotation.pricing_version) }, {
    status: 'accepted', sentVersion: Number(acceptedQuotation.pricing_version), acceptedVersion: Number(acceptedQuotation.pricing_version), pricingVersion: Number(acceptedQuotation.pricing_version),
  });
  assert.deepEqual((await postgres.query('SELECT ref_object,ref_id,ref_field FROM sys_file WHERE id=$1', [nativeQuotationSendFileId])).rows[0], {
    ref_object: 'forge_quotation', ref_id: nativeQuotationId, ref_field: 'sent_evidence_attachment',
  }, 'copy-on-claim preserves the original send file reference');
  assert.deepEqual((await postgres.query('SELECT ref_object,ref_id,ref_field FROM sys_file WHERE id=$1', [nativeQuotationAcceptanceFileId])).rows[0], {
    ref_object: 'forge_quotation', ref_id: nativeQuotationId, ref_field: 'customer_acceptance_evidence_attachment',
  });
  const stateAfterAcceptanceBeforeReplay = await captureScopedSalesState(testOrganizationIds);
  const originalSendAndAcceptanceCopyIds = [nativeQuotationSendFileId, nativeQuotationAcceptanceFileId].sort();
  assert.deepEqual(stateAfterAcceptanceBeforeReplay.files.filter(file => originalSendAndAcceptanceCopyIds.includes(file.id)).map(file => file.id).sort(),
    originalSendAndAcceptanceCopyIds, 'accepted state contains the original send file and one separate acceptance copy');
  const duplicateAcceptReplay = await action(quotationMaker.client, 'forge_quotation', 'quotation_accept', nativeQuotationId, quoteAcceptParams);
  assert.equal(duplicateAcceptReplay.status, 200, 'replaying the exact original acceptance params is idempotent after cross-field copy: ' + messageOf(duplicateAcceptReplay));
  assert.equal(resultOf(duplicateAcceptReplay)?.repeated, true);
  const quotationAfterOriginalAcceptReplay = (await read(quotationMaker.client, 'forge_quotation', nativeQuotationId)).record;
  assert.equal(quotationAfterOriginalAcceptReplay.status, 'accepted', 'same-request acceptance replay does not move quote state');
  assert.equal(fileIdOf(quotationAfterOriginalAcceptReplay.customer_acceptance_evidence_attachment), nativeQuotationAcceptanceFileId,
    'original-input replay keeps the native copied acceptance file ID rather than copying a second time');
  assert.deepEqual(await captureScopedSalesState(testOrganizationIds), stateAfterAcceptanceBeforeReplay,
    'same original acceptance params do not add another copy or change either organization quote/file/signature state');
  assert.deepEqual(await downloadAttachmentBytes(quotationMaker, nativeQuotationSendFileId), originalSendBytesBeforeAcceptance);
  assert.deepEqual(await downloadAttachmentBytes(quotationMaker, nativeQuotationAcceptanceFileId), acceptedAttachmentBytes);
  const stateBeforeAcceptedSendReplay = await captureScopedSalesState(testOrganizationIds);
  const acceptedSendReplay = await action(quotationMaker.client, 'forge_quotation', 'quotation_send', nativeQuotationId, quoteSendParams);
  assert.equal(acceptedSendReplay.status, 200, 'original send request replays after later acceptance: ' + messageOf(acceptedSendReplay));
  assert.deepEqual(resultOf(acceptedSendReplay), {
    id: nativeQuotationId, status: 'sent', sent_at: sentQuotation.sent_at, sent_pricing_version: Number(sentQuotation.sent_pricing_version), repeated: true,
  }, 'post-accept send replay returns the original send receipt without rolling back accepted state');
  assert.deepEqual((await read(quotationMaker.client, 'forge_quotation', nativeQuotationId)).record.status, 'accepted');
  assert.deepEqual(await captureScopedSalesState(testOrganizationIds), stateBeforeAcceptedSendReplay,
    'post-accept send replay changes neither quote status, copy IDs, signatures nor file references');
  assert.deepEqual(await downloadAttachmentBytes(quotationMaker, nativeQuotationSendFileId), originalSendBytesBeforeAcceptance);
  assert.deepEqual(await downloadAttachmentBytes(quotationMaker, nativeQuotationAcceptanceFileId), acceptedAttachmentBytes);
  const changedAcceptanceNote = await action(quotationMaker.client, 'forge_quotation', 'quotation_accept', nativeQuotationId, {
    ...quoteAcceptParams, customer_acceptance_note: quoteAcceptParams.customer_acceptance_note + '（更改说明）',
  });
  await assertRejectedWithoutWrites(changedAcceptanceNote, stateAfterAcceptanceBeforeReplay, testOrganizationIds, 'acceptance replay with a different note');
  const differentAcceptanceFileId = await uploadAttachment(quotationMaker.client, 'quote-different-acceptance-file');
  const stateBeforeDifferentAcceptanceFile = await captureScopedSalesState(testOrganizationIds);
  const changedAcceptanceFile = await action(quotationMaker.client, 'forge_quotation', 'quotation_accept', nativeQuotationId, {
    ...quoteAcceptParams, customer_acceptance_evidence_attachment: differentAcceptanceFileId,
  });
  await assertRejectedWithoutWrites(changedAcceptanceFile, stateBeforeDifferentAcceptanceFile, testOrganizationIds, 'acceptance replay with a different file');
  assert.equal((await postgres.query('SELECT ref_object,ref_id,ref_field FROM sys_file WHERE id=$1', [differentAcceptanceFileId])).rows[0].ref_object,
    null, 'a conflicting acceptance file remains unattached');
  const stateBeforeDifferentAcceptanceActor = await captureScopedSalesState(testOrganizationIds);
  const changedAcceptanceActor = await action(otherQuotationMaker.client, 'forge_quotation', 'quotation_accept', nativeQuotationId, {
    ...quoteAcceptParams, customer_acceptance_evidence_attachment: sameOrgOtherActorSendFileId,
  });
  await assertRejectedWithoutWrites(changedAcceptanceActor, stateBeforeDifferentAcceptanceActor, testOrganizationIds, 'acceptance replay by a different same-organization actor');
  const stateBeforeCrossOrganizationAcceptanceReplay = await captureScopedSalesState(testOrganizationIds);
  const crossOrganizationAcceptanceReplay = await action(foreignQuotationMaker.client, 'forge_quotation', 'quotation_accept', nativeQuotationId, {
    ...quoteAcceptParams, customer_acceptance_evidence_attachment: foreignOrgSendFileId,
  });
  await assertRejectedWithoutWrites(crossOrganizationAcceptanceReplay, stateBeforeCrossOrganizationAcceptanceReplay, testOrganizationIds,
    'acceptance replay by a caller in another organization');
  const acceptedVersion = Number(quotationAfterOriginalAcceptReplay.pricing_version);
  await postgres.query('UPDATE forge_quotation SET pricing_version=$1 WHERE id=$2', [acceptedVersion + 1, nativeQuotationId]);
  const stateWithChangedAcceptedVersion = await captureScopedSalesState(testOrganizationIds);
  await assertRejectedWithoutWrites(await action(quotationMaker.client, 'forge_quotation', 'quotation_accept', nativeQuotationId, quoteAcceptParams),
    stateWithChangedAcceptedVersion, testOrganizationIds, 'acceptance replay against a changed pricing version');
  await postgres.query('UPDATE forge_quotation SET pricing_version=$1 WHERE id=$2', [acceptedVersion, nativeQuotationId]);
  const expectedStateAfterVersionRestore = structuredClone(stateWithChangedAcceptedVersion);
  const restoredPricingVersion = (await postgres.query('SELECT pricing_version FROM forge_quotation WHERE id=$1', [nativeQuotationId])).rows[0].pricing_version;
  assert.equal(Number(restoredPricingVersion), acceptedVersion, 'test-only pricing drift was restored to the original current version');
  expectedStateAfterVersionRestore.quotes.find(quote => quote.id === nativeQuotationId).pricing_version = restoredPricingVersion;
  assert.deepEqual(await captureScopedSalesState(testOrganizationIds), expectedStateAfterVersionRestore,
    'restoring test-only pricing drift changes only the quote pricing_version field');

  const conversionParams = {
    contract_type_id: contractTypeId, code: 'SQ-QUOTE-CONTRACT-' + RUN, name: '报价转换普通员工可读合同草稿',
    starts_on: '2026-10-04', ends_on: '2027-10-04',
  };
  const quoteBeforeWrongActor = (await postgres.query('SELECT owner_id,responsible_id,status,customer_id,total_amount,pricing_version,sent_pricing_version,accepted_pricing_version FROM forge_quotation WHERE id=$1', [nativeQuotationId])).rows[0];
  const customerBeforeWrongActor = (await postgres.query('SELECT owner_id,responsible_id FROM forge_customer WHERE id=$1', [customerId])).rows[0];
  const linesBeforeWrongActor = (await postgres.query('SELECT id,quotation_id,quantity,taxed_unit_price,taxed_subtotal FROM forge_quotation_line WHERE quotation_id=$1 ORDER BY id', [nativeQuotationId])).rows;
  const contractsBeforeWrongActor = (await postgres.query('SELECT count(*)::int AS count FROM forge_sales_contract WHERE quotation_id=$1', [nativeQuotationId])).rows[0].count;
  assert.equal(contractsBeforeWrongActor, 2, 'the draft quotation currently has two independent template-import contracts');
  const wrongActorConversion = await action(seller.client, 'forge_quotation', 'quotation_convert_to_contract', nativeQuotationId, conversionParams);
  if (wrongActorConversion.status === 400) {
    assert.equal(messageOf(wrongActorConversion), '当前报价不存在，或无法确认当前员工和组织', 'an older runtime may express the native recordLoadDenied guard through its Action error envelope');
  } else assert.ok([403, 404].includes(wrongActorConversion.status), 'a different contract/order operator cannot convert another employee’s accepted quotation');
  assert.deepEqual((await postgres.query('SELECT owner_id,responsible_id,status,customer_id,total_amount,pricing_version,sent_pricing_version,accepted_pricing_version FROM forge_quotation WHERE id=$1', [nativeQuotationId])).rows[0], quoteBeforeWrongActor,
    'denied non-owner conversion preserves quote ownership and accepted business state');
  assert.deepEqual((await postgres.query('SELECT owner_id,responsible_id FROM forge_customer WHERE id=$1', [customerId])).rows[0], customerBeforeWrongActor,
    'denied conversion does not change customer ownership');
  assert.deepEqual((await postgres.query('SELECT id,quotation_id,quantity,taxed_unit_price,taxed_subtotal FROM forge_quotation_line WHERE quotation_id=$1 ORDER BY id', [nativeQuotationId])).rows, linesBeforeWrongActor,
    'denied conversion does not change quotation line count or amounts');
  const contractsAfterWrongActor = (await postgres.query('SELECT count(*)::int AS count FROM forge_sales_contract WHERE quotation_id=$1', [nativeQuotationId])).rows[0].count;
  assert.equal(contractsAfterWrongActor, contractsBeforeWrongActor, 'denied conversion creates no contract');

  const cleanTemplateSnapshot = await captureScopedSalesState(testOrganizationIds);
  await postgres.query('UPDATE forge_sales_contract SET quotation_source_type=NULL WHERE id=$1', [templateContracts[0]]);
  const unknownLegacySnapshot = await captureScopedSalesState(testOrganizationIds);
  const unknownLegacyConversion = await action(quotationMaker.client, 'forge_quotation', 'quotation_convert_to_contract', nativeQuotationId, conversionParams);
  await assertRejectedWithoutWrites(unknownLegacyConversion, unknownLegacySnapshot, testOrganizationIds, 'conversion with an unknown legacy quote source');
  assert.equal(messageOf(unknownLegacyConversion), '存在来源待核对合同，不能自动判定历史正式转换，请先完成来源核验',
    'unknown legacy provenance fails closed with the source-review instruction');
  assert.equal((await postgres.query('SELECT quotation_source_type FROM forge_sales_contract WHERE id=$1', [templateContracts[0]])).rows[0].quotation_source_type,
    null, 'the test-only legacy row remains unclassified after the rejected conversion');
  assert.equal((await postgres.query('SELECT count(*)::int AS count FROM forge_quotation_contract_conversion WHERE quotation_id=$1', [nativeQuotationId])).rows[0].count,
    0, 'unknown legacy provenance creates no formal-conversion receipt');
  await postgres.query("UPDATE forge_sales_contract SET quotation_source_type='template_import' WHERE id=$1", [templateContracts[0]]);
  assert.deepEqual(await captureScopedSalesState(testOrganizationIds), cleanTemplateSnapshot,
    'restoring the explicit template fixture leaves both template contracts and quote unchanged');

  const templateLinkBeforeApiWrite = (await postgres.query('SELECT id,quotation_id,quotation_source_type FROM forge_sales_contract WHERE id=$1', [templateContracts[0]])).rows[0];
  const stateBeforeReadonlyFieldChecks = await captureScopedSalesState(testOrganizationIds);
  const genericTemplateLinkPatch = await quotationMaker.client.request('/data/forge_sales_contract/' + encodeURIComponent(templateContracts[0]), 'PATCH', {
    quotation_id: null,
  });
  if (genericTemplateLinkPatch.status >= 200 && genericTemplateLinkPatch.status < 300) {
    assert.deepEqual((await postgres.query('SELECT id,quotation_id,quotation_source_type FROM forge_sales_contract WHERE id=$1', [templateContracts[0]])).rows[0],
      templateLinkBeforeApiWrite, 'ordinary Data API cannot clear the read-only quotation source link even when PATCH returns success');
  } else await assertRejected(genericTemplateLinkPatch, 'generic quotation_id patch');
  assert.deepEqual(await captureScopedSalesState(testOrganizationIds), stateBeforeReadonlyFieldChecks,
    'attempting to clear the read-only quotation link leaves the template source unchanged');

  const genericTemplateSourcePatch = await quotationMaker.client.request('/data/forge_sales_contract/' + encodeURIComponent(templateContracts[0]), 'PATCH', {
    quotation_source_type: 'formal_conversion',
  });
  if (genericTemplateSourcePatch.status >= 200 && genericTemplateSourcePatch.status < 300) {
    assert.deepEqual((await postgres.query('SELECT id,quotation_id,quotation_source_type FROM forge_sales_contract WHERE id=$1', [templateContracts[0]])).rows[0],
      templateLinkBeforeApiWrite, 'ordinary Data API cannot forge formal-conversion provenance even when PATCH returns success');
  } else await assertRejected(genericTemplateSourcePatch, 'generic quotation_source_type patch');
  assert.deepEqual(await captureScopedSalesState(testOrganizationIds), stateBeforeReadonlyFieldChecks,
    'attempting to forge the read-only source type leaves quotation_id and template provenance intact');

  const genericContractCode = 'SQ-GENERIC-SOURCE-' + RUN;
  const genericContractCreate = await quotationMaker.client.request('/data/forge_sales_contract', 'POST', {
    id: id(), name: '通用接口报价来源伪造探针', code: genericContractCode, contract_type_id: contractTypeId,
    customer_id: customerId, quotation_id: nativeQuotationId, quotation_source_type: 'formal_conversion',
    responsible_id: quotationMaker.id, owner_id: quotationMaker.id, starts_on: '2026-10-04', ends_on: '2027-10-04',
    total_amount: 180, status: 'draft',
  });
  const genericContractRows = await postgres.query('SELECT id,quotation_id,quotation_source_type FROM forge_sales_contract WHERE code=$1', [genericContractCode]);
  if (genericContractCreate.status >= 200 && genericContractCreate.status < 300) {
    assert.equal(genericContractRows.rows.length, 1, 'successful generic create has one row that can be checked for stripped read-only source fields');
    assert.notEqual(genericContractRows.rows[0].quotation_id, nativeQuotationId,
      'generic create cannot attach the quotation as a partially protected relationship');
    assert.ok(!['template_import', 'formal_conversion'].includes(genericContractRows.rows[0].quotation_source_type),
      'generic create cannot forge either protected quotation provenance type');
    const genericCreatedId = genericContractRows.rows[0].id;
    await postgres.query('DELETE FROM forge_sales_contract_line WHERE contract_id=$1', [genericCreatedId]);
    await postgres.query('DELETE FROM forge_sales_contract WHERE id=$1', [genericCreatedId]);
  } else {
    await assertRejected(genericContractCreate, 'generic contract create with forged quotation provenance');
    assert.equal(genericContractRows.rows.length, 0, 'rejected generic create writes no contract row');
  }
  assert.deepEqual(await captureScopedSalesState(testOrganizationIds), stateBeforeReadonlyFieldChecks,
    'generic create cannot leave a quotation_id with missing provenance that would block formal conversion');

  const invalidDateConversion = await action(quotationMaker.client, 'forge_quotation', 'quotation_convert_to_contract', nativeQuotationId, {
    ...conversionParams, ends_on: '2027-02-29', code: 'SQ-QUOTE-CONTRACT-INVALID-' + RUN,
  });
  assert.equal(invalidDateConversion.status, 400, 'conversion rejects impossible calendar dates');
  assert.equal((await postgres.query('SELECT count(*)::int AS count FROM forge_sales_contract WHERE quotation_id=$1', [nativeQuotationId])).rows[0].count, 2,
    'an invalid formal conversion leaves both template contracts intact');
  const stateBeforeReceiptFailure = await captureScopedSalesState(testOrganizationIds);
  const failedAfterReceiptInsert = await action(quotationMaker.client, 'forge_quotation', 'quotation_convert_to_contract', nativeQuotationId, conversionParams);
  assert.equal(failedAfterReceiptInsert.status, 400, 'fault after formal receipt insert rolls back the conversion transaction: ' + messageOf(failedAfterReceiptInsert));
  assert.match(messageOf(failedAfterReceiptInsert), /FORCE_QUOTATION_CONVERSION_AFTER_RECEIPT_INSERT/);
  assert.deepEqual(await captureScopedSalesState(testOrganizationIds), stateBeforeReceiptFailure,
    'failure after the receipt hook observed receipt, formal contract and lines rolls back all three while preserving both templates');
  assert.equal((await postgres.query('SELECT count(*)::int AS count FROM forge_sales_contract WHERE quotation_id=$1', [nativeQuotationId])).rows[0].count, 2,
    'receipt failure leaves only the two pre-existing template contracts');
  assert.equal((await postgres.query('SELECT count(*)::int AS count FROM forge_quotation_contract_conversion WHERE quotation_id=$1', [nativeQuotationId])).rows[0].count,
    0, 'receipt insertion and formal contract rows roll back together');
  assert.equal((await postgres.query('SELECT count(*)::int AS count FROM forge_sales_contract_line line JOIN forge_sales_contract contract ON contract.id=line.contract_id WHERE contract.quotation_id=$1 AND contract.quotation_source_type=$2',
    [nativeQuotationId, 'formal_conversion'])).rows[0].count, 0, 'formal conversion lines also roll back with the receipt');
  const concurrentConversions = await Promise.all([
    action(quotationMaker.client, 'forge_quotation', 'quotation_convert_to_contract', nativeQuotationId, conversionParams),
    action(quotationMaker.client, 'forge_quotation', 'quotation_convert_to_contract', nativeQuotationId, conversionParams),
  ]);
  assert.deepEqual(concurrentConversions.map(response => response.status), [200, 200],
    'concurrent retries return the one committed conversion: ' + concurrentConversions.map(messageOf).join(' | '));
  assert.equal(concurrentConversions.filter(response => resultOf(response)?.repeated === true).length, 1,
    'exactly one concurrent request observes the existing idempotent conversion');
  const conversionResults = concurrentConversions.map(resultOf);
  assert.equal(conversionResults[0]?.id, conversionResults[1]?.id, 'both concurrent callers receive the same contract');
  convertedContractId = conversionResults[0].id;
  assert.ok(convertedContractId);
  const ownerContractRead = await read(quotationMaker.client, 'forge_sales_contract', convertedContractId);
  assert.equal(ownerContractRead.response.status, 200, 'the ordinary conversion actor can read their resulting draft contract');
  assert.deepEqual({ owner: ownerContractRead.record.owner_id, responsible: ownerContractRead.record.responsible_id,
    status: ownerContractRead.record.status, quotation_id: ownerContractRead.record.quotation_id }, {
    owner: quotationMaker.id, responsible: quotationMaker.id, status: 'draft', quotation_id: nativeQuotationId,
  });
  const unrelatedDraftRead = await seller.client.request('/data/forge_sales_contract/' + encodeURIComponent(convertedContractId));
  assert.ok([403, 404].includes(unrelatedDraftRead.status), 'a non-owner cannot read the unsigned converted draft');
  const sourceContractsAfterConversion = await postgres.query(`SELECT quotation_source_type,count(*)::int AS count
    FROM forge_sales_contract WHERE quotation_id=$1 GROUP BY quotation_source_type ORDER BY quotation_source_type`, [nativeQuotationId]);
  assert.deepEqual(sourceContractsAfterConversion.rows, [
    { quotation_source_type: 'formal_conversion', count: 1 },
    { quotation_source_type: 'template_import', count: 2 },
  ], 'the conversion receipt allows one formal contract to coexist with both quote template drafts');
  const conversionReceipt = await postgres.query(`SELECT id,quotation_id,contract_id,converted_by,pricing_version,line_count,request_signature,acceptance_file_id
    FROM forge_quotation_contract_conversion WHERE organization_id=$1 AND quotation_id=$2`, [organizationId, nativeQuotationId]);
  assert.equal(conversionReceipt.rows.length, 1, 'one organization-scoped receipt binds the formal conversion');
  assert.deepEqual({
    quotation_id: conversionReceipt.rows[0].quotation_id, contract_id: conversionReceipt.rows[0].contract_id,
    converted_by: conversionReceipt.rows[0].converted_by, pricing_version: Number(conversionReceipt.rows[0].pricing_version),
    line_count: Number(conversionReceipt.rows[0].line_count), acceptance_file_id: conversionReceipt.rows[0].acceptance_file_id,
  }, {
    quotation_id: nativeQuotationId, contract_id: convertedContractId, converted_by: quotationMaker.id,
    pricing_version: Number(acceptedQuotation.pricing_version), line_count: 1, acceptance_file_id: nativeQuotationAcceptanceFileId,
  }, 'formal conversion receipt preserves the actor, accepted quote version, source evidence and first response line count');
  assert.equal(conversionReceipt.rows[0].request_signature, JSON.stringify({
    action: 'quotation_convert_to_contract', organization_id: organizationId, quotation_id: nativeQuotationId,
    actor_id: quotationMaker.id, pricing_version: Number(acceptedQuotation.pricing_version),
    contract_type_id: conversionParams.contract_type_id, code: conversionParams.code, name: conversionParams.name,
    starts_on: conversionParams.starts_on, ends_on: conversionParams.ends_on,
  }), 'formal receipt binds the canonical conversion request for exact replay');
  const convertedStateBeforeConflicts = await captureScopedSalesState(testOrganizationIds);
  for (const changedParams of [
    { ...conversionParams, code: conversionParams.code + '-OTHER' },
    { ...conversionParams, name: conversionParams.name + ' 不同请求' },
    { ...conversionParams, starts_on: '2026-10-05' },
    { ...conversionParams, ends_on: '2027-10-05' },
  ]) {
    const changedReplay = await action(quotationMaker.client, 'forge_quotation', 'quotation_convert_to_contract', nativeQuotationId, changedParams);
    assert.ok([400, 409, 422].includes(changedReplay.status), 'changed conversion input cannot reuse or create another formal conversion');
    assert.deepEqual(await captureScopedSalesState(testOrganizationIds), convertedStateBeforeConflicts,
      'a changed conversion request preserves both organizations, all contracts, receipts and file references');
  }
  const foreignConversion = await action(foreignQuotationMaker.client, 'forge_quotation', 'quotation_convert_to_contract', nativeQuotationId, conversionParams);
  assert.ok([400, 403, 404, 422].includes(foreignConversion.status), 'another organization cannot formally convert this accepted quotation');
  assert.deepEqual(await captureScopedSalesState(testOrganizationIds), convertedStateBeforeConflicts,
    'cross-organization conversion leaves all business and file state unchanged');
  const receiptCrudSnapshot = await captureScopedSalesState(testOrganizationIds);
  const receiptDirectRead = await quotationMaker.client.request('/data/forge_quotation_contract_conversion/' + encodeURIComponent(conversionReceipt.rows[0].id));
  assert.ok([403, 404, 405].includes(receiptDirectRead.status), 'ordinary contract operator cannot read the private internal conversion receipt');
  const receiptListRead = await quotationMaker.client.request('/data/forge_quotation_contract_conversion?$top=20');
  assert.ok([403, 404, 405].includes(receiptListRead.status), 'ordinary contract operator cannot list internal conversion receipts');
  const forgedReceiptWrite = await quotationMaker.client.request('/data/forge_quotation_contract_conversion', 'POST', {
    id: id(), name: '伪造报价转换绑定', organization_id: organizationId,
    quotation_id: nativeQuotationId, contract_id: convertedContractId, converted_by: quotationMaker.id,
    converted_at: new Date().toISOString(), pricing_version: Number(acceptedQuotation.pricing_version), line_count: 1,
    request_signature: 'forged-client-receipt', acceptance_file_id: nativeQuotationAcceptanceFileId,
  });
  assert.ok([403, 404, 405].includes(forgedReceiptWrite.status), 'ordinary contract operator cannot create or forge an internal conversion receipt');
  assert.deepEqual(await captureScopedSalesState(testOrganizationIds), receiptCrudSnapshot,
    'direct receipt read/list/create attempts cannot change the conversion binding or contract records');
  const makerPermissions = resultOf(await quotationMaker.client.request('/auth/me/permissions'));
  assert.equal(makerPermissions?.positions?.includes('platform_admin'), false, 'MCP receipt probe uses the ordinary native quotation/contract operator');
  assert.equal(makerPermissions?.systemPermissions?.includes('setup.write'), false, 'MCP receipt probe does not inherit Setup write');
  await initializeMcp(quotationMaker);
  const mcpToolList = await mcpRequest('tools/list', {}, false, quotationMaker);
  assert.equal(mcpToolList.status, 200, 'ordinary maker lists the tools actually exposed by the native MCP endpoint');
  const listedTools = mcpToolList.value?.result?.tools || [];
  const registeredTool = name => {
    const tool = listedTools.find(candidate => candidate.name === name);
    assert.ok(tool, `MCP tools/list advertises ${name} for the ordinary caller`);
    return tool.name;
  };
  const queryRecordsTool = registeredTool('query_records');
  const getRecordTool = registeredTool('get_record');
  const createRecordTool = registeredTool('create_record');
  const updateRecordTool = registeredTool('update_record');
  const deleteRecordTool = registeredTool('delete_record');
  const stateBeforeMcpReceiptProbe = await captureScopedSalesState(testOrganizationIds);
  const receiptObjectName = 'forge_quotation_contract_conversion';
  const queryReceiptArgs = { objectName: receiptObjectName, where: { quotation_id: nativeQuotationId }, limit: 5 };
  const queryReceiptToolResult = await callMcpTool(queryRecordsTool, queryReceiptArgs);
  assertMcpApiDisabled(queryReceiptToolResult, 'MCP query_records', receiptObjectName, queryReceiptArgs);
  const getReceiptArgs = { objectName: receiptObjectName, recordId: conversionReceipt.rows[0].id };
  const getReceiptToolResult = await callMcpTool(getRecordTool, getReceiptArgs);
  assertMcpApiDisabled(getReceiptToolResult, 'MCP get_record', receiptObjectName, getReceiptArgs);
  const forgedMcpReceiptId = id();
  const createReceiptArgs = {
    objectName: receiptObjectName,
    data: {
      id: forgedMcpReceiptId, name: 'MCP 伪造报价转换绑定', organization_id: organizationId,
      quotation_id: nativeQuotationId, contract_id: convertedContractId, converted_by: quotationMaker.id,
      converted_at: new Date().toISOString(), pricing_version: Number(acceptedQuotation.pricing_version), line_count: 1,
      request_signature: 'forged-mcp-receipt', acceptance_file_id: nativeQuotationAcceptanceFileId,
    },
  };
  const createReceiptToolResult = await callMcpTool(createRecordTool, createReceiptArgs);
  assertMcpApiDisabled(createReceiptToolResult, 'MCP create_record', receiptObjectName, createReceiptArgs);
  const updateReceiptArgs = { objectName: receiptObjectName, recordId: conversionReceipt.rows[0].id, data: { request_signature: 'changed-mcp-receipt' } };
  assertMcpApiDisabled(await callMcpTool(updateRecordTool, updateReceiptArgs), 'MCP update_record', receiptObjectName, updateReceiptArgs);
  const deleteReceiptArgs = { objectName: receiptObjectName, recordId: conversionReceipt.rows[0].id };
  assertMcpApiDisabled(await callMcpTool(deleteRecordTool, deleteReceiptArgs), 'MCP delete_record', receiptObjectName, deleteReceiptArgs);
  assert.equal((await postgres.query('SELECT count(*)::int AS count FROM forge_quotation_contract_conversion WHERE id=$1', [forgedMcpReceiptId])).rows[0].count,
    0, 'MCP create_record cannot write a forged conversion receipt');
  assert.deepEqual(await captureScopedSalesState(testOrganizationIds), stateBeforeMcpReceiptProbe,
    'MCP read and create failures leave both organizations’ quotes, files, contracts, lines and receipt unchanged');
  const mcpContractRead = await callMcpTool(getRecordTool, { objectName: 'forge_sales_contract', recordId: templateContracts[0] });
  assert.notEqual(mcpContractRead?.isError, true, 'the same ordinary MCP caller can read its own normal contract');
  assert.equal(mcpContractRead?._rpcError, undefined, 'normal contract read is a valid control for the receipt probe');
  const mcpContractText = (mcpContractRead.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
  assert.ok(mcpContractText.includes(templateContracts[0]), 'the read control returns the intended existing contract');
  const existingTemplateRemarks = (await postgres.query('SELECT remarks FROM forge_sales_contract WHERE id=$1', [templateContracts[0]])).rows[0].remarks;
  const mcpWritableControl = await callMcpTool(updateRecordTool, { objectName: 'forge_sales_contract', recordId: templateContracts[0], data: { remarks: existingTemplateRemarks } });
  assert.notEqual(mcpWritableControl?.isError, true, 'the ordinary caller can invoke update_record on an allowed draft field');
  assert.equal(mcpWritableControl?._rpcError, undefined, 'update_record accepts the actual schema before readonly-field probing');
  const stateBeforeMcpSourceForgery = await captureScopedSalesState(testOrganizationIds);
  const mcpSourceForgery = await callMcpTool(updateRecordTool, {
    objectName: 'forge_sales_contract', recordId: templateContracts[0],
    data: { quotation_id: null, quotation_source_type: 'formal_conversion' },
  });
  assert.equal(mcpSourceForgery?._rpcError, undefined, 'readonly-source probe uses a valid tool invocation');
  if (mcpSourceForgery.isError) {
    const text = (mcpSourceForgery.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
    assert.doesNotMatch(text, /unknown tool|tool not found|invalid params|objectName is required/i, 'readonly-source refusal is not a malformed test');
  }
  assert.deepEqual(await captureScopedSalesState(testOrganizationIds), stateBeforeMcpSourceForgery,
    'HTTP MCP cannot unlink a quotation source or turn a template into a formal conversion');
  const stateBeforeExistingStatusFixture = await captureScopedSalesState(testOrganizationIds);
  await postgres.query("UPDATE forge_sales_contract SET status='active' WHERE id=$1", [convertedContractId]);
  const stateWithExistingActiveContract = await captureScopedSalesState(testOrganizationIds);
  const activeContractReplay = await action(quotationMaker.client, 'forge_quotation', 'quotation_convert_to_contract', nativeQuotationId, conversionParams);
  assert.equal(activeContractReplay.status, 200, 'exact conversion replay returns the existing contract after its status changes: ' + messageOf(activeContractReplay));
  assert.deepEqual(resultOf(activeContractReplay), {
    id: convertedContractId, quotation_id: nativeQuotationId, line_count: 1, status: 'active', repeated: true,
  }, 'conversion replay reports the stored contract status instead of reverting its first response to draft');
  assert.deepEqual(await captureScopedSalesState(testOrganizationIds), stateWithExistingActiveContract,
    'status replay leaves the receipt, contract owner, quotation link, lines and all files unchanged');
  await postgres.query("UPDATE forge_sales_contract SET status='draft' WHERE id=$1", [convertedContractId]);
  const expectedStateAfterStatusFixture = structuredClone(stateWithExistingActiveContract);
  expectedStateAfterStatusFixture.contracts.find(contract => contract.id === convertedContractId).status = 'draft';
  assert.deepEqual(await captureScopedSalesState(testOrganizationIds), expectedStateAfterStatusFixture,
    'restoring the isolated status fixture changes only the formal contract status');
  assert.ok(stateBeforeExistingStatusFixture.contracts.find(contract => contract.id === convertedContractId)?.status !== 'active',
    'the replay status case starts from the actual conversion draft, without claiming contract approval');
  const contractLines = await postgres.query('SELECT quotation_line_id,quantity_limit,taxed_unit_price,taxed_subtotal FROM forge_sales_contract_line WHERE contract_id=$1', [convertedContractId]);
  assert.deepEqual(contractLines.rows.map(line => ({ quotation_line_id: line.quotation_line_id, quantity: Number(line.quantity_limit), price: Number(line.taxed_unit_price), total: Number(line.taxed_subtotal) })), [
    { quotation_line_id: (await postgres.query('SELECT id FROM forge_quotation_line WHERE quotation_id=$1', [nativeQuotationId])).rows[0].id, quantity: 1, price: 180, total: 180 },
  ], 'converted contract preserves the accepted quotation line snapshot');

  const zeroVersionDraft = await action(quotationMaker.client, 'forge_quotation', 'sales_quotation_draft_create', '', {
    code: 'SQ-QUOTE-V0-' + RUN, name: '零核价版本报价闭环验证', customer_id: customerId,
    quotation_type_id: quotationTypeId, issuer_id: quotationIssuerId,
    quotation_date: '2026-10-04', valid_until: '2026-10-31',
    lines_json: JSON.stringify([{ line_type: 'service', name: '现场安装服务', quantity: 1, taxed_unit_price: 180, tax_rate: 13, discount_rate: 0 }]),
  });
  assert.equal(zeroVersionDraft.status, 200, 'ordinary quote maker creates a second native draft without adjusting its initial version: ' + messageOf(zeroVersionDraft));
  const zeroVersionQuotationId = resultOf(zeroVersionDraft)?.id;
  assert.ok(zeroVersionQuotationId);
  const zeroVersionInitialQuote = (await read(quotationMaker.client, 'forge_quotation', zeroVersionQuotationId)).record;
  assert.equal(zeroVersionInitialQuote.opportunity_id, null, 'existing callers may still create a direct quotation without an opportunity');
  assert.equal(zeroVersionInitialQuote.opportunity_name, null, 'a direct quotation does not invent a source name');
  assert.equal(Number(zeroVersionInitialQuote.pricing_version), 0, 'new quotation remains at its legitimate initial pricing version');
  const zeroVersionSubmission = await action(quotationMaker.client, 'forge_quotation', 'quotation_submit', zeroVersionQuotationId, {});
  assert.equal(zeroVersionSubmission.status, 200, 'initial version zero can enter the native approval flow: ' + messageOf(zeroVersionSubmission));
  const zeroVersionApproval = await pendingApproval(quotationReviewer.client, 'forge_quotation', zeroVersionQuotationId, 'sales_quotation_approval', 'quotation_review');
  const zeroVersionDecision = await quotationReviewer.client.request('/approvals/requests/' + encodeURIComponent(zeroVersionApproval.id) + '/approve', 'POST', { comment: '核价版本零的原始报价已复核' });
  assert.equal(zeroVersionDecision.status, 200, 'independent reviewer approves the untouched version-zero quote');
  let approvedZeroVersionQuote;
  const zeroVersionDeadline = Date.now() + 20_000;
  while (Date.now() < zeroVersionDeadline) {
    approvedZeroVersionQuote = (await read(quotationMaker.client, 'forge_quotation', zeroVersionQuotationId)).record;
    if (approvedZeroVersionQuote?.status === 'approved') break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(approvedZeroVersionQuote?.status, 'approved');
  const zeroVersionSendFileId = await uploadAttachment(quotationMaker.client, 'quote-zero-version-send-evidence');
  const zeroVersionSend = await action(quotationMaker.client, 'forge_quotation', 'quotation_send', zeroVersionQuotationId, {
    sent_evidence_attachment: zeroVersionSendFileId, sent_evidence_note: '零核价版本报价已实际发送，隔离验证回执',
  });
  assert.equal(zeroVersionSend.status, 200, 'version-zero quote send records through its native Action: ' + messageOf(zeroVersionSend));
  const zeroVersionSentQuote = (await read(quotationMaker.client, 'forge_quotation', zeroVersionQuotationId)).record;
  assert.equal(zeroVersionSentQuote.status, 'sent');
  assert.equal(Number(zeroVersionSentQuote.sent_pricing_version), 0);
  const zeroVersionAccept = await action(quotationMaker.client, 'forge_quotation', 'quotation_accept', zeroVersionQuotationId, {
    customer_acceptance_evidence_attachment: zeroVersionSendFileId,
    customer_acceptance_note: '零核价版本报价已被客户实际接受，隔离验证回执',
  });
  assert.equal(zeroVersionAccept.status, 200, 'version-zero customer acceptance records through its native Action: ' + messageOf(zeroVersionAccept));
  const zeroVersionAcceptedQuote = (await read(quotationMaker.client, 'forge_quotation', zeroVersionQuotationId)).record;
  assert.equal(zeroVersionAcceptedQuote.status, 'accepted');
  assert.equal(Number(zeroVersionAcceptedQuote.pricing_version), 0);
  assert.equal(Number(zeroVersionAcceptedQuote.accepted_pricing_version), 0);
  const zeroVersionContractParams = {
    contract_type_id: contractTypeId, code: 'SQ-QUOTE-V0-CONTRACT-' + RUN, name: '零核价版本正式转换合同',
    starts_on: '2026-10-04', ends_on: '2027-10-04',
  };
  const zeroVersionConversion = await action(quotationMaker.client, 'forge_quotation', 'quotation_convert_to_contract', zeroVersionQuotationId, zeroVersionContractParams);
  assert.equal(zeroVersionConversion.status, 200, 'accepted version-zero quote converts without an artificial price adjustment: ' + messageOf(zeroVersionConversion));
  const zeroVersionConversionResult = resultOf(zeroVersionConversion);
  const zeroVersionContractId = zeroVersionConversionResult?.id;
  assert.ok(zeroVersionContractId);
  const zeroVersionReceipt = await postgres.query(`SELECT quotation_id,contract_id,converted_by,pricing_version,line_count,acceptance_file_id
    FROM forge_quotation_contract_conversion WHERE organization_id=$1 AND quotation_id=$2`, [organizationId, zeroVersionQuotationId]);
  assert.deepEqual({
    count: zeroVersionReceipt.rows.length,
    quotation_id: zeroVersionReceipt.rows[0]?.quotation_id, contract_id: zeroVersionReceipt.rows[0]?.contract_id,
    converted_by: zeroVersionReceipt.rows[0]?.converted_by, pricing_version: Number(zeroVersionReceipt.rows[0]?.pricing_version),
    line_count: Number(zeroVersionReceipt.rows[0]?.line_count), acceptance_file_id: zeroVersionReceipt.rows[0]?.acceptance_file_id,
  }, {
    count: 1, quotation_id: zeroVersionQuotationId, contract_id: zeroVersionContractId,
    converted_by: quotationMaker.id, pricing_version: 0, line_count: 1,
    acceptance_file_id: fileIdOf(zeroVersionAcceptedQuote.customer_acceptance_evidence_attachment),
  }, 'conversion receipt records the legitimate version-zero snapshot and its native accepted evidence');
  const zeroVersionContractRead = await read(quotationMaker.client, 'forge_sales_contract', zeroVersionContractId);
  assert.deepEqual({ status: zeroVersionContractRead.record.status, quotation_id: zeroVersionContractRead.record.quotation_id,
    quotation_source_type: zeroVersionContractRead.record.quotation_source_type }, {
    status: 'draft', quotation_id: zeroVersionQuotationId, quotation_source_type: 'formal_conversion',
  }, 'version-zero conversion creates one formal contract from the accepted source quote');

  await stopRuntime();
  await startRuntime();
  const restartedQuotation = (await read(quotationMaker.client, 'forge_quotation', nativeQuotationId)).record;
  const restartedQuoteContract = (await read(quotationMaker.client, 'forge_sales_contract', convertedContractId)).record;
  assert.deepEqual({ status: restartedQuotation.status, sentVersion: Number(restartedQuotation.sent_pricing_version), acceptedVersion: Number(restartedQuotation.accepted_pricing_version), version: Number(restartedQuotation.pricing_version), opportunity_id: restartedQuotation.opportunity_id, opportunity_name: restartedQuotation.opportunity_name }, {
    status: 'accepted', sentVersion: Number(restartedQuotation.pricing_version), acceptedVersion: Number(restartedQuotation.pricing_version), version: Number(restartedQuotation.pricing_version), opportunity_id: sourceOpportunityId, opportunity_name: sourceOpportunityName,
  }, 'native-approved quote source and customer acceptance survive PostgreSQL Runtime restart');
  assert.deepEqual({ owner: restartedQuoteContract.owner_id, quotation: restartedQuoteContract.quotation_id, status: restartedQuoteContract.status }, {
    owner: quotationMaker.id, quotation: nativeQuotationId, status: 'draft',
  }, 'ordinary quotation owner retains the converted draft after Runtime restart');
  const restartedZeroVersionQuote = (await read(quotationMaker.client, 'forge_quotation', zeroVersionQuotationId)).record;
  const restartedZeroVersionContract = (await read(quotationMaker.client, 'forge_sales_contract', zeroVersionContractId)).record;
  assert.deepEqual({ quoteStatus: restartedZeroVersionQuote.status, pricingVersion: Number(restartedZeroVersionQuote.pricing_version),
    sentVersion: Number(restartedZeroVersionQuote.sent_pricing_version), acceptedVersion: Number(restartedZeroVersionQuote.accepted_pricing_version),
    contractQuote: restartedZeroVersionContract.quotation_id, contractSource: restartedZeroVersionContract.quotation_source_type }, {
    quoteStatus: 'accepted', pricingVersion: 0, sentVersion: 0, acceptedVersion: 0,
    contractQuote: zeroVersionQuotationId, contractSource: 'formal_conversion',
  }, 'native version-zero quotation approval, send, acceptance and formal conversion survive Runtime restart');
  assert.ok([403, 404].includes((await seller.client.request('/data/forge_sales_contract/' + encodeURIComponent(convertedContractId))).status),
    'non-owner remains unable to read the unsigned converted draft after Runtime restart');
  const [restartedQuoteSendFile, restartedQuoteAcceptanceFile] = await Promise.all([
    postgres.query('SELECT ref_object,ref_id,ref_field FROM sys_file WHERE id=$1', [nativeQuotationSendFileId]),
    postgres.query('SELECT ref_object,ref_id,ref_field FROM sys_file WHERE id=$1', [nativeQuotationAcceptanceFileId]),
  ]);
  assert.deepEqual(restartedQuoteSendFile.rows[0], { ref_object: 'forge_quotation', ref_id: nativeQuotationId, ref_field: 'sent_evidence_attachment' });
  assert.deepEqual(restartedQuoteAcceptanceFile.rows[0], { ref_object: 'forge_quotation', ref_id: nativeQuotationId, ref_field: 'customer_acceptance_evidence_attachment' });
  const approvalAfterRestart = await postgres.query('SELECT object_name,record_id,process_name,flow_node_id,status FROM sys_approval_request WHERE id=$1', [nativeQuotationApprovalId]);
  assert.deepEqual(approvalAfterRestart.rows[0], { object_name: 'forge_quotation', record_id: nativeQuotationId, process_name: 'flow:sales_quotation_approval', flow_node_id: 'quotation_review', status: 'approved' });
  for (const [label, fileId] of [['send', nativeQuotationSendFileId], ['acceptance', nativeQuotationAcceptanceFileId]]) {
    assert.deepEqual(await downloadAttachmentBytes(quotationMaker, fileId), PNG_BYTES, `${label} evidence bytes survive Runtime restart`);
  }
  assert.equal((await postgres.query('SELECT current_database() AS name')).rows[0]?.name, DATABASE, 'restart readback stays on the same isolated PostgreSQL database');

  // Production material submission creates the review grants; no fixture grants them.
  const deliveryPosition = await createPosition('contract_delivery_reviewer', ['sales_contract_reviewer']);
  const commercialPosition = await createPosition('contract_commercial_reviewer', ['sales_contract_reviewer']);
  for (const [reviewer, position, positionId] of [[quotationReviewer, 'contract_delivery_reviewer', deliveryPosition], [seller, 'contract_commercial_reviewer', commercialPosition]]) {
    await insertFixture('sys_user_position', { user_id: reviewer.id, position, position_id: positionId, organization_id: organizationId, valid_from: new Date(Date.now() - 60000).toISOString(), valid_until: null });
  }
  await stopRuntime(); await startRuntime();
  await signIn(quotationMaker); await signIn(quotationReviewer); await signIn(seller);
  assert.equal((await quotationMaker.client.request('/data/forge_sales_contract/' + convertedContractId, 'PATCH', { payment_term: '验收后付款' })).status, 200);
  assert.ok([403,404].includes((await quotationReviewer.client.request('/data/forge_sales_contract/' + convertedContractId)).status), 'review position alone never grants an unassigned contract');
  const primaryBytes = Buffer.from('%PDF-1.7\nIsolated contract review material\n%%EOF\n');
  const preparedMaterial = await quotationMaker.client.request('/storage/upload/presigned', 'POST', { filename: 'contract-review-' + RUN + '.pdf', mimeType: 'application/pdf', size: primaryBytes.length, scope: 'attachments' });
  assert.equal(preparedMaterial.status, 200);
  const preparedFile = resultOf(preparedMaterial);
  assert.ok((await fetch(new URL(preparedFile.uploadUrl, ORIGIN), { method: preparedFile.method || 'PUT', headers: preparedFile.headers || {}, body: primaryBytes })).ok);
  assert.equal((await quotationMaker.client.request('/storage/upload/complete', 'POST', { fileId: preparedFile.fileId })).status, 200);
  const materialParams = { primary_file_id: preparedFile.fileId, material_file_ids: [preparedFile.fileId] };
  assert.ok((await action(seller.client, 'forge_sales_contract', 'contract_submit_material_package', convertedContractId, materialParams)).status >= 400, 'unassigned non-owner cannot submit the material package');
  const submittedMaterial = await action(quotationMaker.client, 'forge_sales_contract', 'contract_submit_material_package', convertedContractId, materialParams);
  assert.equal(submittedMaterial.status, 200, 'production material submit resolves native staff and read grants: ' + messageOf(submittedMaterial));
  assert.equal((await action(quotationMaker.client, 'forge_sales_contract', 'contract_submit_material_package', convertedContractId, materialParams)).status, 200, 'same material returns its existing receipt');
  const exactShares = await postgres.query('SELECT recipient_id,access_level,source,source_id FROM sys_record_share WHERE organization_id=$1 AND object_name=$2 AND record_id=$3', [organizationId, 'forge_sales_contract', convertedContractId]);
  assert.deepEqual(exactShares.rows.map(row => row.recipient_id).sort(), [quotationReviewer.id, seller.id].sort());
  assert.ok(exactShares.rows.every(row => row.access_level === 'read' && row.source === 'team' && row.source_id === 'forge-contract-review:' + convertedContractId));
  for (const reviewer of [quotationReviewer, seller]) {
    const readback = await reviewer.client.request('/data/forge_sales_contract/' + convertedContractId);
    assert.equal(readback.status, 200, 'production-created share permits the currently assigned reader');
  }
  for (const outsider of [otherQuotationMaker, foreignQuotationMaker]) assert.ok((await outsider.client.request('/data/forge_sales_contract/' + convertedContractId)).status >= 400, 'unassigned or foreign-organization account remains excluded');
  assert.ok((await quotationReviewer.client.request('/data/forge_sales_contract/' + convertedContractId, 'PATCH', { remarks: 'forbidden' })).status >= 400, 'review share never grants generic writes');
  await stopRuntime(); await startRuntime();
  await signIn(quotationMaker); await signIn(quotationReviewer); await signIn(seller);
  assert.equal((await quotationReviewer.client.request('/data/forge_sales_contract/' + convertedContractId)).status, 200, 'assigned read persists while the employee/server were offline');
  let contractRequest;
  for (let attempt=0;attempt<150;attempt++) {
    const pending = await postgres.query("SELECT id FROM sys_approval_request WHERE object_name='forge_sales_contract' AND record_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1", [convertedContractId]);
    if (pending.rows[0]) { contractRequest=pending.rows[0].id; break; }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(contractRequest, 'production submit starts the real native contract flow');
  for (const reviewer of [quotationReviewer, seller]) {
    const context = await reviewer.client.request('/approvals/requests/' + encodeURIComponent(contractRequest) + '/workbench-context');
    assert.equal(context.status, 200);
    const approve = (context.value?.availableActions || context.value?.data?.availableActions || []).find(item => item.execution?.actionName === 'contract_approval_mcp_approve');
    assert.ok(approve, 'current real reviewer has the version-bound native action');
    const decision = await callMcpTool('run_action', { actionName: approve.execution.actionName, objectName: approve.execution.objectName, recordId: approve.execution.recordId, params: { ...approve.execution.params, comment: '本员工已核对固定合同材料' } }, reviewer);
    assert.notEqual(decision?.isError, true, 'real caller and production-created share reach native approval: ' + mcpText(decision));
  }
  assert.equal((await read(quotationMaker.client, 'forge_sales_contract', convertedContractId)).record?.status, 'active');
  const terminalShares = await postgres.query('SELECT id FROM sys_record_share WHERE organization_id=$1 AND object_name=$2 AND record_id=$3 AND source=$4 AND source_id=$5', [organizationId, 'forge_sales_contract', convertedContractId, 'team', 'forge-contract-review:' + convertedContractId]);
  assert.equal(terminalShares.rows.length, 0, 'production terminal hook revokes the exact review provenance');
  assert.ok([403,404].includes((await quotationReviewer.client.request('/data/forge_sales_contract/' + convertedContractId)).status), 'removed temporary grant no longer exposes the live contract');

});
