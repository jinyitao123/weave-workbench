import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const isPostgres = Boolean(TEST_DATABASE_URL);
if (isPostgres) {
  const url = new URL(TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'TEST_DATABASE_URL must be loopback-only');
  assert.equal(url.pathname.replace(/^\//, ''), 'forge_mvp1_test', 'TEST_DATABASE_URL must target the task-isolated database');
}

const runId = randomUUID().replaceAll('-', '').slice(0, 16);
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'forge-sales-lead-conversion-'));
const dbPath = path.join(tempDir, '.objectstack', 'data', 'sales-lead-conversion.sqlite');
const databaseUrl = TEST_DATABASE_URL || `file:${dbPath}`;
const authSecret = randomBytes(32).toString('hex');
const secretKey = randomBytes(32).toString('hex');
const weaveSecret = randomBytes(32).toString('hex');
const adminEmail = 'admin@objectos.ai';
const adminPassword = 'admin123';
const basePermissionPassword = `Lead-${randomBytes(18).toString('hex')}!`;
const portProbe = createServer();
let port;
let child;
let postgres;
let sqlite;
let output = '';
let installedFailureTrigger = null;
let authDiagnostic = '';

async function cleanupPreviousTestUsers() {
  if (!isPostgres) return;
  postgres = new Client({ connectionString: TEST_DATABASE_URL });
  await postgres.connect();
  let users;
  try {
    users = await postgres.query("SELECT id FROM sys_user WHERE email = 'admin@objectos.ai' OR email = 'lead-conversion-admin@example.test' OR email LIKE 'lead-conversion-admin-%@example.test' OR email LIKE 'lead-conversion-reader-%@example.test'");
  } catch (error) {
    if (error?.code === '42P01') return;
    throw error;
  }
  const userIds = users.rows.map(row => String(row.id));
  const references = await postgres.query(`
    SELECT ns.nspname AS schema_name, relation.relname AS table_name, attribute.attname AS column_name
    FROM pg_constraint constraint_row
    JOIN pg_class relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace ns ON ns.oid = relation.relnamespace
    JOIN unnest(constraint_row.conkey) AS key_column(attnum) ON TRUE
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid AND attribute.attnum = key_column.attnum
    WHERE constraint_row.contype = 'f' AND constraint_row.confrelid = to_regclass('sys_user')
  `);
  for (const userId of userIds) {
    for (const ref of references.rows) {
      if (ref.table_name === 'sys_user') continue;
      const quote = value => `"${String(value).replaceAll('"', '""')}"`;
      await postgres.query(`DELETE FROM ${quote(ref.schema_name)}.${quote(ref.table_name)} WHERE ${quote(ref.column_name)} = $1`, [userId]);
    }
    await postgres.query('DELETE FROM sys_user WHERE id = $1', [userId]);
  }
  // An earlier interrupted fixture may have removed its sys_user through the
  // public API while leaving Better Auth's sys_account row behind. The shared
  // database is dedicated to this test; remove only rows with no identity row.
  await postgres.query('DELETE FROM sys_account account_row WHERE NOT EXISTS (SELECT 1 FROM sys_user user_row WHERE user_row.id = account_row.user_id)');
}
const created = { users: [], assignments: [], leads: [], opportunities: [], customers: [], categories: [] };

function sanitizedOutput() {
  return output
    .replaceAll(TEST_DATABASE_URL, '[test database URL omitted]')
    .replaceAll(authSecret, '[auth secret omitted]')
    .replaceAll(secretKey, '[secret key omitted]')
    .replaceAll(weaveSecret, '[event secret omitted]')
    .slice(-8000);
}

async function startRuntime() {
  await mkdir(path.dirname(dbPath), { recursive: true });
  await writeFile(path.join(tempDir, 'package.json'), '{"name":"forge-sales-lead-conversion-test","type":"module"}\n');
  await cp(path.join(APP_DIR, 'objectstack.config.ts'), path.join(tempDir, 'objectstack.config.ts'));
  await symlink(path.join(APP_DIR, 'src'), path.join(tempDir, 'src'), 'dir');
  await symlink(path.join(APP_DIR, 'node_modules'), path.join(tempDir, 'node_modules'), 'dir');
  await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, '127.0.0.1', resolve);
  });
  port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));

  const cli = path.join(APP_DIR, 'node_modules/@objectstack/cli/bin/run.js');
  child = spawn(process.execPath, [
    cli, 'dev', '--seed-admin', '--port', String(port),
    '--database-driver', isPostgres ? 'postgres' : 'sqlite',
    '--admin-email', adminEmail, '--admin-password', adminPassword,
    '--auth-secret', authSecret, '--log-level', 'error',
  ], {
    cwd: tempDir,
    env: {
      ...process.env,
      OS_HOME: path.join(tempDir, '.os-home'),
      OS_DATABASE_URL: databaseUrl,
      OS_SECRET_KEY: secretKey,
      OS_BASE_URL: `http://127.0.0.1:${port}`,
      OS_TRUSTED_ORIGINS: `http://127.0.0.1:${port}`,
      OS_ENVIRONMENT_ID: `lead-conversion-${runId}`,
      OS_PLATFORM_OWNER_EMAIL: adminEmail,
      FORGE_WEAVE_EVENT_SECRET: weaveSecret,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8').on('data', chunk => { output = (output + chunk).slice(-8000); });
  child.stderr.setEncoding('utf8').on('data', chunk => { output = (output + chunk).slice(-8000); });

  const deadline = Date.now() + 120_000;
  let health;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated ObjectStack runtime exited (${child.exitCode}).\n${sanitizedOutput()}`);
    try {
      health = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
      if (health.ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(health?.ok, `Isolated ObjectStack runtime did not become ready.\n${sanitizedOutput()}`);
}

function clientFor(email, password) {
  const origin = `http://127.0.0.1:${port}`;
  return fetch(`${origin}/api/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email, password }),
  }).then(async response => {
    const value = await response.json();
    const failureCode = value.error?.code || value.code || value.message || 'no response detail';
    assert.ok(response.ok && value.user?.id, `Local sign-in failed (${response.status}, ${failureCode}) ${authDiagnostic}`);
    const cookie = response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
    let mcpRequestId = 0;
    let mcpSessionId = '';
    let mcpInitialized = false;
    async function request(resource, method = 'GET', body) {
      const result = await fetch(`${origin}/api/v1${resource}`, {
        method,
        headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: result.status, value: await result.json().catch(() => null) };
    }
    async function mcpRequest(method, params = {}, notification = false) {
      const message = { jsonrpc: '2.0', method, params };
      if (!notification) message.id = ++mcpRequestId;
      const result = await fetch(`${origin}/api/v1/mcp`, {
        method: 'POST',
        headers: {
          Cookie: cookie, Origin: origin,
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2025-03-26',
          ...(mcpSessionId ? { 'MCP-Session-Id': mcpSessionId } : {}),
        },
        body: JSON.stringify(message),
      });
      mcpSessionId ||= result.headers.get('MCP-Session-Id') || '';
      const raw = await result.text();
      const dataLines = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).filter(Boolean);
      const payload = dataLines.length ? dataLines.at(-1) : raw;
      return { status: result.status, value: payload ? JSON.parse(payload) : null };
    }
    async function initializeMcp() {
      if (mcpInitialized) return;
      const initialized = await mcpRequest('initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'forge-sales-lead-conversion-test', version: '1.0.0' },
      });
      assert.equal(initialized.status, 200, `MCP initialize returned ${initialized.status}`);
      await mcpRequest('notifications/initialized', {}, true);
      mcpInitialized = true;
    }
    async function listMcpTools() {
      await initializeMcp();
      const result = await mcpRequest('tools/list', {});
      assert.equal(result.status, 200, `MCP tools/list returned ${result.status}`);
      return result.value?.result?.tools || [];
    }
    async function callMcpTool(name, arguments_) {
      await initializeMcp();
      const result = await mcpRequest('tools/call', { name, arguments: arguments_ });
      assert.equal(result.status, 200, `MCP tool ${name} transport returned ${result.status}`);
      return result.value?.result ?? {
        _rpcError: result.value?.error,
        _envelopeKeys: Object.keys(result.value || {}),
        _httpStatus: result.status,
      };
    }
    return { userId: value.user.id, user: value.user, request, listMcpTools, callMcpTool };
  });
}

async function signup(admin, email) {
  const response = await admin.request('/auth/admin/create-user', 'POST', {
    name: email.split('@')[0], email, password: basePermissionPassword, role: 'user', mustChangePassword: false,
  });
  const createError = response.value?.error?.code || response.value?.error?.message || response.value?.message || 'no response detail';
  const adminRole = admin.user?.isPlatformAdmin === true || admin.user?.role === 'admin' || admin.user?.positions?.includes('platform_admin');
  assert.ok(response.status >= 200 && response.status < 300, `Local employee creation failed (${response.status}, ${createError}; adminRole=${adminRole})`);
  const userId = response.value?.data?.user?.id;
  assert.ok(userId, 'Local admin creation must return the new employee id');
  created.users.push(userId);
  const password = await admin.request('/auth/admin/set-user-password', 'POST', {
    userId, newPassword: basePermissionPassword, mustChangePassword: false,
  });
  assert.ok(password.status >= 200 && password.status < 300, `Local employee password setup failed (${password.status})`);
  if (isPostgres) {
    const userState = await postgres.query('SELECT email_verified, banned FROM sys_user WHERE id = $1', [userId]);
    const accountState = await postgres.query("SELECT provider_id, issuer, (password IS NOT NULL) AS has_password FROM sys_account WHERE user_id = $1", [userId]);
    authDiagnostic = `auth user=${userState.rows.length > 0}, emailVerified=${Boolean(userState.rows[0]?.email_verified)}, banned=${Boolean(userState.rows[0]?.banned)}, credential=${accountState.rows.some(row => row.provider_id === 'credential')}, passwordPresent=${accountState.rows.some(row => row.provider_id === 'credential' && row.has_password)}`;
  }
  const client = await clientFor(email, basePermissionPassword);
  assert.equal(client.userId, userId);
  return client;
}

function unpack(result) {
  return result.value?.result ?? result.value?.data?.result ?? result.value?.data ?? result.value;
}

function mcpText(result) {
  return String(result?.content?.find(item => item.type === 'text')?.text || result?._rpcError?.message || '');
}

function mcpData(result) {
  try { return JSON.parse(mcpText(result)); } catch { return null; }
}

function errorMessage(result) {
  return String(result.value?.error?.message || result.value?.error || result.value?.message || '');
}

async function findAll(api, objectName, where = {}) {
  const params = new URLSearchParams({ $filter: JSON.stringify(where), $top: '500' });
  const response = await api.request(`/data/${objectName}?${params}`);
  assert.equal(response.status, 200, `Read ${objectName} returned ${response.status}`);
  return (response.value?.records || []).filter(row => Object.entries(where).every(([field, value]) => row[field] === value));
}

async function findOne(api, objectName, where = {}) {
  return (await findAll(api, objectName, where))[0] || null;
}

async function create(api, objectName, values) {
  const response = await api.request(`/data/${objectName}`, 'POST', values);
  assert.ok(response.status >= 200 && response.status < 300, `Create ${objectName} returned ${response.status}`);
  return response.value?.id || response.value?.record?.id || response.value?.data?.id;
}

async function read(api, objectName, id) {
  const response = await api.request(`/data/${objectName}/${id}`);
  assert.equal(response.status, 200, `Read ${objectName} returned ${response.status}`);
  return response.value?.record || response.value?.data?.record;
}

async function invoke(api, leadId, params) {
  return api.request(`/actions/forge_sales_lead/sales_lead_convert_to_opportunity/${leadId}`, 'POST', { params });
}

async function createLead(api, ownerId, label) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const id = await create(api, 'forge_sales_lead', {
    name: `${label}线索`, code: `LEAD-${runId}-${suffix}`,
    company_name: `${label}公司-${suffix}`, contact_name: '测试联系人',
    phone: '13800000000', source: '隔离运行时测试',
    responsible_id: ownerId, remarks: 'Forge 原生运行时线索转化验证',
  });
  created.leads.push(id);
  return { id, companyName: `${label}公司-${suffix}` };
}

async function ensureProjectCustomerCategory(admin) {
  const existing = await findOne(admin, 'forge_customer_category', { code: 'CUST-CAT-PROJECT' });
  if (existing) return existing.id;
  const id = await create(admin, 'forge_customer_category', {
    name: '项目客户', code: 'CUST-CAT-PROJECT', status: 'active',
  });
  created.categories.push(id);
  return id;
}

async function assignPermission(api, userId, user, permissionSets, name) {
  const permissionSet = permissionSets.find(item => item.name === name);
  assert.ok(permissionSet?.id, `Permission set ${name} was not provisioned`);
  const body = {
    user_id: userId, permission_set_id: permissionSet.id,
    granted_by: admin.userId, reason: '隔离原生权限测试夹具',
  };
  const organizationId = user?.organization_id;
  if (organizationId) body.organization_id = organizationId;
  const response = await api.request('/data/sys_user_permission_set', 'POST', body);
  assert.ok(response.status >= 200 && response.status < 300, `Assign ${name} returned ${response.status}`);
  const id = response.value?.id || response.value?.record?.id;
  if (id) created.assignments.push(id);
}

async function loadPermissionSets() {
  if (isPostgres) {
    const result = await postgres.query('SELECT id, name FROM sys_permission_set WHERE name = ANY($1::text[])', [[
      'admin_full_access', 'sales_lead_owner', 'sales_lead_conversion_operator',
    ]]);
    return result.rows;
  }
  const { DatabaseSync } = await import('node:sqlite');
  sqlite = new DatabaseSync(dbPath);
  const rows = sqlite.prepare('SELECT id, name FROM sys_permission_set WHERE name IN (?, ?, ?)').all('admin_full_access', 'sales_lead_owner', 'sales_lead_conversion_operator');
  sqlite.close();
  sqlite = null;
  return rows;
}

async function ensureTestAdminStanding(api) {
  if (api.user?.isPlatformAdmin === true || api.user?.positions?.includes('platform_admin')) return api;
  const sets = await loadPermissionSets();
  const adminSet = sets.find(item => item.name === 'admin_full_access');
  assert.ok(adminSet?.id, 'ObjectStack platform admin permission set must be provisioned');
  const id = randomUUID();
  if (isPostgres) {
    await postgres.query(`
      INSERT INTO sys_user_permission_set (id, user_id, permission_set_id, organization_id, granted_by, reason)
      SELECT $1::text, $2::text, $3::text, NULL, $4::text, $5::text
      WHERE NOT EXISTS (
        SELECT 1 FROM sys_user_permission_set
        WHERE user_id = $2::text AND permission_set_id = $3::text AND organization_id IS NULL
      )
    `, [id, api.userId, adminSet.id, api.userId, 'Isolated native-runtime test bootstrap']);
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    sqlite = new DatabaseSync(dbPath);
    sqlite.prepare(`INSERT INTO sys_user_permission_set (id, user_id, permission_set_id, organization_id, granted_by, reason)
      SELECT ?, ?, ?, NULL, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM sys_user_permission_set WHERE user_id = ? AND permission_set_id = ? AND organization_id IS NULL
      )`).run(id, api.userId, adminSet.id, api.userId, 'Isolated native-runtime test bootstrap', api.userId, adminSet.id);
    sqlite.close();
    sqlite = null;
  }
  const refreshed = await clientFor(adminEmail, adminPassword);
  const session = await refreshed.request('/auth/get-session');
  const sessionUser = session.value?.user || session.value?.session?.user;
  assert.ok(sessionUser?.isPlatformAdmin === true || sessionUser?.positions?.includes('platform_admin'), 'isolated runtime admin must have native admin_full_access standing');
  return refreshed;
}

async function installFailureTrigger(leadId) {
  const token = randomUUID().replaceAll('-', '');
  const triggerName = `lead_conversion_fail_${token}`;
  if (isPostgres) {
    const functionName = `${triggerName}_fn`;
    await postgres.query(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.id = '${leadId}' AND NEW.status = 'converted' THEN
          RAISE EXCEPTION 'isolated lead conversion rollback probe';
        END IF;
        RETURN NEW;
      END;
      $$`);
    await postgres.query(`CREATE TRIGGER "${triggerName}" BEFORE UPDATE OF status ON "forge_sales_lead" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
    installedFailureTrigger = { triggerName, functionName };
    return;
  }
  const { DatabaseSync } = await import('node:sqlite');
  sqlite = new DatabaseSync(dbPath);
  sqlite.exec(`CREATE TRIGGER "${triggerName}" BEFORE UPDATE ON "forge_sales_lead"
    WHEN OLD.id = '${leadId}' AND NEW.status = 'converted'
    BEGIN SELECT RAISE(ABORT, 'isolated lead conversion rollback probe'); END`);
  installedFailureTrigger = { triggerName };
}

async function removeFailureTrigger() {
  if (!installedFailureTrigger) return;
  if (isPostgres) {
    await postgres.query(`DROP TRIGGER IF EXISTS "${installedFailureTrigger.triggerName}" ON "forge_sales_lead"`);
    await postgres.query(`DROP FUNCTION IF EXISTS "${installedFailureTrigger.functionName}"()`);
  } else {
    sqlite?.exec(`DROP TRIGGER IF EXISTS "${installedFailureTrigger.triggerName}"`);
    sqlite?.close();
    sqlite = null;
  }
  installedFailureTrigger = null;
}

async function inspectUniqueLeadIndex() {
  if (isPostgres) {
    const result = await postgres.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = ANY (current_schemas(false)) AND tablename = 'forge_sales_opportunity'`);
    assert.ok(result.rows.some(row => /unique/i.test(row.indexdef) && /lead_id/i.test(row.indexdef)), 'PostgreSQL must have a unique index covering forge_sales_opportunity.lead_id');
    return;
  }
  const { DatabaseSync } = await import('node:sqlite');
  sqlite = new DatabaseSync(dbPath);
  const indexes = sqlite.prepare('PRAGMA index_list("forge_sales_opportunity")').all();
  const hasUniqueLeadIndex = indexes.filter(index => Number(index.unique) === 1).some(index =>
    sqlite.prepare(`PRAGMA index_info("${String(index.name).replaceAll('"', '""')}")`).all().some(column => column.name === 'lead_id'));
  assert.ok(hasUniqueLeadIndex, 'SQLite must have a unique index covering forge_sales_opportunity.lead_id');
  sqlite.close();
  sqlite = null;
}

async function cleanup(admin) {
  await removeFailureTrigger().catch(() => {});
  for (const id of [...new Set(created.leads)].reverse()) await admin.request(`/data/forge_sales_lead/${id}`, 'DELETE').catch(() => {});
  for (const id of [...new Set(created.opportunities)].reverse()) await admin.request(`/data/forge_sales_opportunity/${id}`, 'DELETE').catch(() => {});
  for (const id of [...new Set(created.customers)].reverse()) await admin.request(`/data/forge_customer/${id}`, 'DELETE').catch(() => {});
  for (const id of [...new Set(created.categories)].reverse()) await admin.request(`/data/forge_customer_category/${id}`, 'DELETE').catch(() => {});
  for (const id of [...new Set(created.assignments)].reverse()) await admin.request(`/data/sys_user_permission_set/${id}`, 'DELETE').catch(() => {});
  for (const id of [...new Set(created.users)].reverse()) await admin.request(`/data/sys_user/${id}`, 'DELETE').catch(() => {});
}

let admin;
try {
  await cleanupPreviousTestUsers();
  await startRuntime();
  admin = await ensureTestAdminStanding(await clientFor(adminEmail, adminPassword));
  await inspectUniqueLeadIndex();

  const permissionSets = await loadPermissionSets();
  const readerEmail = `lead-conversion-reader-${runId}@example.test`;
  const reader = await signup(admin, readerEmail);
  assert.ok(reader.userId, 'Registered employee must be present in ObjectStack identity data');
  await assignPermission(admin, reader.userId, reader.user, permissionSets, 'sales_lead_owner');

  const blockedLead = await createLead(reader, reader.userId, '无转化权限');
  const readerRecord = await read(reader, 'forge_sales_lead', blockedLead.id);
  assert.equal(readerRecord.status, 'new', 'owner permission must allow the assigned employee to read their own lead');
  const tamperStatus = await reader.request(`/data/forge_sales_lead/${blockedLead.id}`, 'PATCH', {
    status: 'converted', converted_customer_id: 'untrusted-customer', converted_opportunity_id: 'untrusted-opportunity',
  });
  assert.ok(tamperStatus.status >= 200 && tamperStatus.status < 300, 'read-only conversion fields should be ignored on a normal record update');
  assert.equal((await read(reader, 'forge_sales_lead', blockedLead.id)).status, 'new', 'generic record update must not bypass the conversion action');
  const denied = await invoke(reader, blockedLead.id, { amount: 120000, expected_close_on: '2026-11-30' });
  assert.equal(denied.status, 403, 'read access alone must not authorize lead conversion');
  const readerActions = mcpData(await reader.callMcpTool('list_actions', {}));
  assert.ok(Array.isArray(readerActions?.actions));
  assert.equal(readerActions.actions.some(action => action.name === 'sales_lead_convert_to_opportunity'), false, 'native MCP must hide the action from a reader without conversion permission');
  const hiddenCall = await reader.callMcpTool('run_action', {
    actionName: 'sales_lead_convert_to_opportunity', objectName: 'forge_sales_lead',
    recordId: blockedLead.id, params: { amount: 120000, expected_close_on: '2026-11-30' },
  });
  assert.equal(hiddenCall?.isError, true, 'native MCP must enforce requiredPermissions at call time');
  assert.equal((await findAll(admin, 'forge_sales_opportunity', { lead_id: blockedLead.id })).length, 0);
  assert.equal((await findAll(admin, 'forge_customer', { name: blockedLead.companyName })).length, 0);

  const conversionSet = permissionSets.find(item => item.name === 'sales_lead_conversion_operator');
  assert.ok(conversionSet?.id, 'Conversion capability permission set must be provisioned');
  await assignPermission(admin, reader.userId, reader.user, permissionSets, 'sales_lead_conversion_operator');
  const enabledActions = mcpData(await reader.callMcpTool('list_actions', {}));
  const exposedAction = enabledActions?.actions?.find(action => action.name === 'sales_lead_convert_to_opportunity');
  assert.ok(exposedAction, 'native MCP must expose the lead action to an explicitly authorized employee');
  assert.notEqual(exposedAction.requiresConfirmation, true, 'turn-scoped employee authorization must not add a second fixed confirmation gate');

  const missingCategoryLead = await createLead(reader, reader.userId, '缺少客户分类');
  const projectCategoryId = await ensureProjectCustomerCategory(admin);
  const maskedCategory = await admin.request(`/data/forge_customer_category/${projectCategoryId}`, 'PATCH', { code: `CUST-CAT-PROJECT-HIDDEN-${runId}` });
  assert.ok(maskedCategory.status >= 200 && maskedCategory.status < 300, 'test fixture must be able to mask the category through the admin data path');
  let missingCategory;
  try {
    missingCategory = await reader.callMcpTool('run_action', {
      actionName: 'sales_lead_convert_to_opportunity', objectName: 'forge_sales_lead',
      recordId: missingCategoryLead.id, params: { amount: 75000 },
    });
    const missingCategoryEnvelope = mcpData(missingCategory);
    const businessError = JSON.stringify(missingCategoryEnvelope?.error || missingCategoryEnvelope?.message || missingCategory?._rpcError?.message || mcpText(missingCategory));
    const safeMcpError = mcpText(missingCategory)
      .replaceAll(missingCategoryLead.id, '[lead]')
      .replaceAll(missingCategoryLead.companyName, '[company]')
      .replaceAll(reader.userId, '[user]')
      .replaceAll(admin.userId, '[admin]')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '[id]');
    assert.equal(missingCategory?.isError, true, 'native MCP must preserve the business-action error state');
    assert.match(businessError, /缺少项目客户分类/);
  } finally {
    const restoredCategory = await admin.request(`/data/forge_customer_category/${projectCategoryId}`, 'PATCH', { code: 'CUST-CAT-PROJECT' });
    assert.ok(restoredCategory.status >= 200 && restoredCategory.status < 300, 'test category code must be restored');
  }
  assert.equal((await findAll(admin, 'forge_customer', { name: missingCategoryLead.companyName })).length, 0);
  assert.equal((await findAll(admin, 'forge_sales_opportunity', { lead_id: missingCategoryLead.id })).length, 0);

  const normalLead = await createLead(reader, reader.userId, '权限通过');
  const params = { amount: 320000, expected_close_on: '2026-10-30' };
  const callArgs = {
    actionName: 'sales_lead_convert_to_opportunity', objectName: 'forge_sales_lead',
    recordId: normalLead.id, params,
  };
  const first = await reader.callMcpTool('run_action', callArgs);
  assert.notEqual(first?.isError, true, 'employee with the explicit conversion permission can use the controlled MCP action');
  const firstEnvelope = mcpData(first);
  const firstResult = firstEnvelope?.result;
  assert.ok(firstEnvelope?.ok === true && firstResult?.customer_id && firstResult?.opportunity_id, `MCP action result keys: ${Object.keys(firstEnvelope || {}).join(',')}; result keys: ${Object.keys(firstResult || {}).join(',')}`);
  created.customers.push(firstResult.customer_id);
  created.opportunities.push(firstResult.opportunity_id);
  assert.deepEqual(mcpData(await reader.callMcpTool('run_action', callArgs))?.result, firstResult, 'same MCP input retry must return the original association');
  const changed = await reader.callMcpTool('run_action', { ...callArgs, params: { amount: 320001, expected_close_on: '2026-10-30' } });
  assert.equal(changed?.isError, true, 'different MCP input must conflict');
  assert.match(mcpText(changed), /不同金额或预计成交日期/);
  assert.equal((await findAll(admin, 'forge_sales_opportunity', { lead_id: normalLead.id })).length, 1);
  const convertedLead = await read(reader, 'forge_sales_lead', normalLead.id);
  assert.ok(convertedLead.conversion_request_signature, 'the conversion capability can read the persisted replay signature');

  const concurrentLead = await createLead(reader, reader.userId, '并发同参');
  const concurrentSame = await Promise.all(Array.from({ length: 4 }, () => invoke(reader, concurrentLead.id, params)));
  assert.ok(concurrentSame.every(result => result.status === 200), 'concurrent identical requests must all resolve successfully');
  const sameResults = concurrentSame.map(unpack);
  assert.equal(new Set(sameResults.map(result => result.opportunity_id)).size, 1, 'identical concurrent calls must converge on one opportunity');
  created.opportunities.push(sameResults[0].opportunity_id);
  created.customers.push(sameResults[0].customer_id);
  assert.equal((await findAll(admin, 'forge_sales_opportunity', { lead_id: concurrentLead.id })).length, 1);

  const concurrentConflictLead = await createLead(reader, reader.userId, '并发异参');
  const concurrentDifferent = await Promise.all([
    invoke(reader, concurrentConflictLead.id, { amount: 100000, expected_close_on: '2026-10-30' }),
    invoke(reader, concurrentConflictLead.id, { amount: 200000, expected_close_on: '2026-11-30' }),
  ]);
  assert.equal(concurrentDifferent.filter(result => result.status === 200).length, 1, 'only one different-input request may commit');
  const losingDifferent = concurrentDifferent.find(result => result.status >= 400);
  assert.match(errorMessage(losingDifferent), /不同金额或预计成交日期/);
  const uniqueConcurrentOpportunity = await findOne(admin, 'forge_sales_opportunity', { lead_id: concurrentConflictLead.id });
  assert.ok(uniqueConcurrentOpportunity);
  created.opportunities.push(uniqueConcurrentOpportunity.id);
  created.customers.push(uniqueConcurrentOpportunity.customer_id);
  assert.equal((await findAll(admin, 'forge_sales_opportunity', { lead_id: concurrentConflictLead.id })).length, 1);

  const closedLead = await createLead(reader, reader.userId, '已关闭');
  if (isPostgres) await postgres.query('UPDATE forge_sales_lead SET status = $1 WHERE id = $2', ['closed', closedLead.id]);
  else {
    const { DatabaseSync } = await import('node:sqlite');
    sqlite = new DatabaseSync(dbPath);
    sqlite.prepare('UPDATE forge_sales_lead SET status = ? WHERE id = ?').run('closed', closedLead.id);
    sqlite.close();
    sqlite = null;
  }
  const closedResult = await invoke(reader, closedLead.id, params);
  assert.ok(closedResult.status >= 400);
  assert.match(errorMessage(closedResult), /线索状态已变化/);
  assert.equal((await findAll(admin, 'forge_sales_opportunity', { lead_id: closedLead.id })).length, 0);
  assert.equal((await findAll(admin, 'forge_customer', { name: closedLead.companyName })).length, 0);

  const rollbackLead = await createLead(reader, reader.userId, '事务回滚');
  const rollbackBefore = await findAll(admin, 'forge_customer_category', { code: 'CUST-CAT-PROJECT' });
  await installFailureTrigger(rollbackLead.id);
  const failed = await invoke(reader, rollbackLead.id, params);
  assert.ok(failed.status >= 400, 'failure during the final lead update must abort the native conversion transaction');
  await removeFailureTrigger();
  const rollbackState = await read(admin, 'forge_sales_lead', rollbackLead.id);
  assert.deepEqual({ status: rollbackState.status, customer: rollbackState.converted_customer_id, opportunity: rollbackState.converted_opportunity_id }, { status: 'new', customer: null, opportunity: null });
  assert.equal((await findAll(admin, 'forge_customer', { name: rollbackLead.companyName })).length, 0, 'customer insert must roll back with the failed lead update');
  assert.equal((await findAll(admin, 'forge_sales_opportunity', { lead_id: rollbackLead.id })).length, 0, 'opportunity insert must roll back with the failed lead update');
  const rollbackAfter = await findAll(admin, 'forge_customer_category', { code: 'CUST-CAT-PROJECT' });
  assert.equal(rollbackAfter.length, rollbackBefore.length, 'category creation must roll back with the failed conversion');

  const retried = await invoke(reader, rollbackLead.id, params);
  assert.equal(retried.status, 200, 'the rolled-back input may be retried once the cause is removed');
  const retryResult = unpack(retried);
  created.customers.push(retryResult.customer_id);
  created.opportunities.push(retryResult.opportunity_id);
  assert.equal((await findAll(admin, 'forge_sales_opportunity', { lead_id: rollbackLead.id })).length, 1);

  console.log(`PASS native sales lead conversion permission, unique source, replay, conflict, concurrency and rollback on ${isPostgres ? 'isolated PostgreSQL' : 'temporary SQLite'}`);
} finally {
  if (admin) await cleanup(admin).catch(() => {});
  if (postgres) await postgres.end().catch(() => {});
  if (sqlite) sqlite.close();
  if (portProbe.listening) await new Promise(resolve => portProbe.close(resolve));
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000)),
    ]);
  }
  await rm(tempDir, { recursive: true, force: true });
}
