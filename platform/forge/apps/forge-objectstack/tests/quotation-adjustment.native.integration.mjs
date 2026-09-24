import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
assert.ok(TEST_DATABASE_URL, 'TEST_DATABASE_URL must point to the isolated PostgreSQL database');
const databaseUrl = new URL(TEST_DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname), 'TEST_DATABASE_URL must be loopback-only');
assert.equal(databaseUrl.pathname.replace(/^\//, ''), 'forge_quote_test', 'TEST_DATABASE_URL must target the task-isolated forge_quote_test database');

const runId = randomUUID().replaceAll('-', '').slice(0, 16);
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'forge-quotation-adjustment-'));
const authSecret = randomBytes(32).toString('hex');
const secretKey = randomBytes(32).toString('hex');
const portProbe = createServer();
const adminEmail = 'admin@objectos.ai';
const adminPassword = 'admin123';
const employeePassword = `Quote-${randomBytes(18).toString('hex')}!`;
const created = { users: [], memberships: [], assignments: [], categories: [], customers: [], types: [], issuers: [], quotes: [], lines: [] };
const cases = [];
let port;
let child;
let postgres;
let output = '';
let installedFailureTrigger = null;

function safeOutput() {
  return output
    .replaceAll(TEST_DATABASE_URL, '[test database URL omitted]')
    .replaceAll(authSecret, '[auth secret omitted]')
    .replaceAll(secretKey, '[secret key omitted]')
    .slice(-8000);
}

async function startRuntime() {
  await writeFile(path.join(tempDir, 'package.json'), '{"name":"forge-quotation-adjustment-test","type":"module"}\n');
  await writeFile(path.join(tempDir, 'objectstack.config.ts'), `export { default } from ${JSON.stringify(path.join(APP_DIR, 'objectstack.config.ts'))};\n`);
  await symlink(path.join(APP_DIR, 'src'), path.join(tempDir, 'src'), 'dir');
  await symlink(path.join(APP_DIR, 'node_modules'), path.join(tempDir, 'node_modules'), 'dir');
  await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, '127.0.0.1', resolve);
  });
  port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));

  child = spawn(process.execPath, [
    path.join(APP_DIR, 'node_modules/@objectstack/cli/bin/run.js'),
    'dev', '--seed-admin', '--port', String(port), '--database-driver', 'postgres',
    '--admin-email', adminEmail, '--admin-password', adminPassword,
    '--auth-secret', authSecret, '--log-level', 'error',
  ], {
    cwd: tempDir,
    env: {
      ...process.env,
      OS_HOME: path.join(tempDir, '.os-home'),
      OS_DATABASE_URL: TEST_DATABASE_URL,
      OS_SECRET_KEY: secretKey,
      OS_BASE_URL: `http://127.0.0.1:${port}`,
      OS_TRUSTED_ORIGINS: `http://127.0.0.1:${port}`,
      OS_ENVIRONMENT_ID: `quotation-adjustment-${runId}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8').on('data', chunk => { output = (output + chunk).slice(-8000); });
  child.stderr.setEncoding('utf8').on('data', chunk => { output = (output + chunk).slice(-8000); });

  const deadline = Date.now() + 120_000;
  let health;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated ObjectStack runtime exited (${child.exitCode}).\n${safeOutput()}`);
    try {
      health = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
      if (health.ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(health?.ok, `Isolated ObjectStack runtime did not become ready.\n${safeOutput()}`);
}

async function clientFor(email, password) {
  const origin = `http://127.0.0.1:${port}`;
  const response = await fetch(`${origin}/api/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email, password }),
  });
  const value = await response.json();
  assert.ok(response.ok && value.user?.id, `Local sign-in failed with HTTP ${response.status}`);
  const cookie = response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
  let requestId = 0;
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
    if (!notification) message.id = ++requestId;
    const result = await fetch(`${origin}/api/v1/mcp`, {
      method: 'POST',
      headers: {
        Cookie: cookie, Origin: origin, Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-03-26',
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
      clientInfo: { name: 'forge-quotation-adjustment-test', version: '1.0.0' },
    });
    assert.equal(initialized.status, 200, `MCP initialize returned ${initialized.status}`);
    await mcpRequest('notifications/initialized', {}, true);
    mcpInitialized = true;
  }
  async function callMcpTool(name, arguments_ = {}) {
    await initializeMcp();
    const result = await mcpRequest('tools/call', { name, arguments: arguments_ });
    assert.equal(result.status, 200, `MCP ${name} transport returned ${result.status}`);
    return result.value?.result ?? { _rpcError: result.value?.error };
  }
  return { userId: value.user.id, user: value.user, request, callMcpTool };
}

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

function mcpText(result) {
  return String(result?.content?.find(item => item.type === 'text')?.text || result?._rpcError?.message || '');
}

function mcpData(result) {
  try { return JSON.parse(mcpText(result)); } catch { return null; }
}

function actionResult(result) {
  return result?.result ?? result?.data?.result ?? result?.data ?? result;
}

function errorMessage(response) {
  return String(response?.value?.error?.message || response?.value?.error || response?.value?.message || '');
}

async function create(api, objectName, values) {
  const response = await api.request(`/data/${objectName}`, 'POST', values);
  assert.ok(response.status >= 200 && response.status < 300, `Create ${objectName} returned HTTP ${response.status}: ${JSON.stringify(response.value)}`);
  return response.value?.id || response.value?.record?.id || response.value?.data?.id;
}

async function read(api, objectName, id) {
  const response = await api.request(`/data/${objectName}/${id}`);
  assert.equal(response.status, 200, `Read ${objectName} returned HTTP ${response.status}`);
  return response.value?.record || response.value?.data?.record;
}

async function findAll(api, objectName, where = {}) {
  const params = new URLSearchParams({ $filter: JSON.stringify(where), $top: '500' });
  const response = await api.request(`/data/${objectName}?${params}`);
  assert.equal(response.status, 200, `Read ${objectName} returned HTTP ${response.status}`);
  return (response.value?.records || []).filter(row => Object.entries(where).every(([field, value]) => row[field] === value));
}

async function assignPermission(admin, user, permissionSetId, organizationId) {
  const body = {
    user_id: user.userId, permission_set_id: permissionSetId,
    granted_by: admin.userId, reason: '本机报价核价隔离测试',
  };
  if (organizationId) body.organization_id = organizationId;
  const result = await admin.request('/data/sys_user_permission_set', 'POST', body);
  assert.ok(result.status >= 200 && result.status < 300, `Permission assignment returned HTTP ${result.status}`);
  created.assignments.push(result.value?.id || result.value?.record?.id);
}

async function createEmployee(admin, email, password, organizationId, name) {
  const signup = await admin.request('/auth/admin/create-user', 'POST', {
    name, email, password, role: 'user', mustChangePassword: false,
  });
  assert.ok(signup.status >= 200 && signup.status < 300, `Employee creation returned HTTP ${signup.status}`);
  const userId = signup.value?.data?.user?.id;
  assert.ok(userId, 'Employee creation must return an id');
  created.users.push(userId);
  const setPassword = await admin.request('/auth/admin/set-user-password', 'POST', {
    userId, newPassword: password, mustChangePassword: false,
  });
  assert.ok(setPassword.status >= 200 && setPassword.status < 300, `Employee password setup returned HTTP ${setPassword.status}`);
  const membership = await postgres.query('SELECT id FROM sys_member WHERE user_id = $1 AND organization_id = $2 LIMIT 1', [userId, organizationId]);
  if (membership.rows[0]?.id) created.memberships.push(membership.rows[0].id);
  else {
    const membershipId = randomUUID();
    await postgres.query('INSERT INTO sys_member (id, organization_id, user_id, role) VALUES ($1, $2, $3, $4)', [membershipId, organizationId, userId, 'member']);
    created.memberships.push(membershipId);
  }
  return clientFor(email, password);
}

async function createQuote(admin, ownerId, label) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const categoryId = await create(admin, 'forge_customer_category', { name: `${label}分类-${suffix}`, code: `QCAT-${runId}-${suffix}`, status: 'active' });
  created.categories.push(categoryId);
  const customerId = await create(admin, 'forge_customer', { name: `${label}客户-${suffix}`, category_id: categoryId, responsible_id: ownerId });
  created.customers.push(customerId);
  const typeId = await create(admin, 'forge_quotation_type', { name: `${label}类型-${suffix}`, code: `QTYPE-${runId}-${suffix}`, status: 'active' });
  created.types.push(typeId);
  const issuerId = await create(admin, 'forge_quotation_issuer', { name: `${label}报价主体-${suffix}`, credit_code: `QI-${runId}-${suffix}` });
  created.issuers.push(issuerId);
  const quoteId = await create(admin, 'forge_quotation', {
    name: `${label}报价-${suffix}`, code: `QT-${runId}-${suffix}`, customer_id: customerId,
    quotation_type_id: typeId, issuer_id: issuerId, quotation_date: '2026-09-24', valid_until: '2026-10-24',
    responsible_id: ownerId, status: 'draft', item_count: 2, subtotal: 2300, discount_amount: 0,
    tax_amount: 0, total_amount: 2300, cost_total: null, pricing_version: 0,
  });
  created.quotes.push(quoteId);
  const equipmentLineId = await create(admin, 'forge_quotation_line', {
    name: `${label}设备`, quotation_id: quoteId, line_type: 'material', item_code: `EQ-${suffix}`,
    quantity: 2, taxed_unit_price: 1000, untaxed_unit_price: 1000, tax_rate: 0,
    discount_rate: 0, taxed_subtotal: 2000,
  });
  created.lines.push(equipmentLineId);
  const serviceLineId = await create(admin, 'forge_quotation_line', {
    name: `${label}服务`, quotation_id: quoteId, line_type: 'service', item_code: `SV-${suffix}`,
    quantity: 1, taxed_unit_price: 300, untaxed_unit_price: 300, tax_rate: 0,
    discount_rate: 0, taxed_subtotal: 300,
  });
  created.lines.push(serviceLineId);
  return { quoteId, equipmentLineId, serviceLineId };
}

async function invokeMcp(api, quoteId, params) {
  return api.callMcpTool('run_action', {
    actionName: 'quotation_adjust_line_price', objectName: 'forge_quotation', recordId: quoteId, params,
  });
}

async function installFailureTrigger(quoteId) {
  const token = randomUUID().replaceAll('-', '');
  const functionName = `quotation_adjust_fail_${token}`;
  const triggerName = `quotation_adjust_fail_${token}`;
  await postgres.query(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.id = '${quoteId.replaceAll("'", "''")}' THEN RAISE EXCEPTION 'isolated quotation adjustment rollback probe'; END IF;
      RETURN NEW;
    END
  $$`);
  await postgres.query(`CREATE TRIGGER "${triggerName}" BEFORE UPDATE OF total_amount ON forge_quotation FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
  installedFailureTrigger = { functionName, triggerName };
}

async function removeFailureTrigger() {
  if (!installedFailureTrigger) return;
  await postgres.query(`DROP TRIGGER IF EXISTS "${installedFailureTrigger.triggerName}" ON forge_quotation`);
  await postgres.query(`DROP FUNCTION IF EXISTS "${installedFailureTrigger.functionName}"()`);
  installedFailureTrigger = null;
}

async function cleanupTestUserRows(userIds) {
  const existing = await postgres.query("SELECT id FROM sys_user WHERE email LIKE 'quotation-adjustment-%@example.test' OR email LIKE 'quotation-observer-%@example.test'");
  const ids = [...new Set([...(userIds || []), ...existing.rows.map(row => String(row.id))].filter(Boolean))];
  if (!ids.length) return;
  const references = await postgres.query(`
    SELECT ns.nspname AS schema_name, relation.relname AS table_name, attribute.attname AS column_name
    FROM pg_constraint constraint_row
    JOIN pg_class relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace ns ON ns.oid = relation.relnamespace
    JOIN unnest(constraint_row.conkey) AS key_column(attnum) ON TRUE
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid AND attribute.attnum = key_column.attnum
    WHERE constraint_row.contype = 'f' AND constraint_row.confrelid = to_regclass('sys_user')
  `);
  const quoteIdentifier = value => `"${String(value).replaceAll('"', '""')}"`;
  for (const userId of ids) {
    for (const ref of references.rows) {
      if (ref.table_name === 'sys_user') continue;
      await postgres.query(`DELETE FROM ${quoteIdentifier(ref.schema_name)}.${quoteIdentifier(ref.table_name)} WHERE ${quoteIdentifier(ref.column_name)} = $1`, [userId]);
    }
    await postgres.query('DELETE FROM sys_account WHERE user_id = $1', [userId]);
    await postgres.query('DELETE FROM sys_user WHERE id = $1', [userId]);
  }
}

async function cleanup(admin) {
  await removeFailureTrigger().catch(() => {});
  for (const id of created.quotes) if (id) await postgres.query('DELETE FROM forge_quotation_price_adjustment_receipt WHERE quotation_id = $1', [id]).catch(() => {});
  for (const id of [...created.lines].reverse()) if (id) await admin.request(`/data/forge_quotation_line/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.quotes].reverse()) if (id) await admin.request(`/data/forge_quotation/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.issuers].reverse()) if (id) await admin.request(`/data/forge_quotation_issuer/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.types].reverse()) if (id) await admin.request(`/data/forge_quotation_type/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.customers].reverse()) if (id) await admin.request(`/data/forge_customer/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.categories].reverse()) if (id) await admin.request(`/data/forge_customer_category/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.assignments].reverse()) if (id) await admin.request(`/data/sys_user_permission_set/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.memberships].reverse()) if (id) await postgres.query('DELETE FROM sys_member WHERE id = $1', [id]).catch(() => {});
  for (const id of [...created.users].reverse()) if (id) await admin.request(`/data/sys_user/${id}`, 'DELETE').catch(() => {});
  await cleanupTestUserRows(created.users);
}

let admin;
let employee;
let unprivilegedEmployee;
try {
  postgres = new Client({ connectionString: TEST_DATABASE_URL });
  await postgres.connect();
  await startRuntime();
  admin = await clientFor(adminEmail, adminPassword);
  await cleanupTestUserRows();

  const adminMembership = await postgres.query('SELECT organization_id FROM sys_member WHERE user_id = $1 ORDER BY created_at LIMIT 1', [admin.userId]);
  assert.ok(adminMembership.rows[0]?.organization_id, 'The isolated platform admin must have an organization membership');
  const organizationId = adminMembership.rows[0].organization_id;
  const employeeEmail = `quotation-adjustment-${runId}@example.test`;
  employee = await createEmployee(admin, employeeEmail, employeePassword, organizationId, 'quotation-adjustment-test');
  const observerEmail = `quotation-observer-${runId}@example.test`;
  unprivilegedEmployee = await createEmployee(admin, observerEmail, `Observe-${randomBytes(18).toString('hex')}!`, organizationId, 'quotation-observer-test');

  const permissionRows = await postgres.query("SELECT id, name FROM sys_permission_set WHERE name = 'sales_quotation_adjustment_operator'");
  assert.equal(permissionRows.rows.length, 1, 'Forge must provision the sales quotation adjustment permission set');
  await assignPermission(admin, employee, permissionRows.rows[0].id, organizationId);

  const primary = await createQuote(admin, employee.userId, '价格调整');
  const stranger = await createQuote(admin, admin.userId, '其他员工');

  await test('native recalculation reads 2*1000+300 as 2300 without inventing missing cost', async () => {
    const result = await admin.request(`/actions/forge_quotation/quotation_recalculate/${primary.quoteId}`, 'POST', {});
    assert.equal(result.status, 200, JSON.stringify(result.value));
    const quote = await read(admin, 'forge_quotation', primary.quoteId);
    assert.deepEqual({ subtotal: Number(quote.subtotal), total_amount: Number(quote.total_amount), cost_total: quote.cost_total }, { subtotal: 2300, total_amount: 2300, cost_total: null });
  });

  await test('employee without adjustment permission cannot list or run the MCP action', async () => {
    const listing = mcpData(await unprivilegedEmployee.callMcpTool('list_actions', {}));
    assert.equal(listing?.actions?.some(item => item.name === 'quotation_adjust_line_price'), false);
    const denied = await invokeMcp(unprivilegedEmployee, primary.quoteId, {
      line_id: primary.equipmentLineId, expected_version: 0, taxed_unit_price: 900,
      idempotency_key: `quote-${runId}-no-permission`,
    });
    assert.equal(denied?.isError, true);
    assert.equal(Number((await read(admin, 'forge_quotation', primary.quoteId)).total_amount), 2300);
  });

  await test('native MCP grants the action only to the quote adjustment employee', async () => {
    const adminQuote = await read(admin, 'forge_quotation', primary.quoteId);
    assert.equal(adminQuote.responsible_id, employee.userId);
    const ownedQuote = await read(employee, 'forge_quotation', primary.quoteId);
    assert.equal(ownedQuote.responsible_id, employee.userId, 'Own-scope permission must expose the employee-responsible quote');
    const listing = mcpData(await employee.callMcpTool('list_actions', {}));
    const action = listing?.actions?.find(item => item.name === 'quotation_adjust_line_price');
    assert.ok(action, 'The authorized employee must see the scalar quote adjustment action');
    const params = action.params || [];
    assert.deepEqual(params.map(item => item.name).sort(), ['expected_version', 'idempotency_key', 'line_id', 'taxed_unit_price']);
    assert.deepEqual(params.map(item => [item.name, item.type]).sort((a, b) => a[0].localeCompare(b[0])), [
      ['expected_version', 'number'], ['idempotency_key', 'string'], ['line_id', 'string'], ['taxed_unit_price', 'number'],
    ]);
    const forbiddenEdit = await employee.request(`/data/forge_quotation/${primary.quoteId}`, 'PATCH', { total_amount: 9999 });
    assert.ok(forbiddenEdit.status >= 400, 'The capability permission must not grant generic quote edits');
  });

  await test('employee changes only the authorized device line and atomically saves 2100', async () => {
    const params = { line_id: primary.equipmentLineId, expected_version: 0, taxed_unit_price: 900, idempotency_key: `quote-${runId}-primary-v0` };
    const result = actionResult(mcpData(await invokeMcp(employee, primary.quoteId, params)));
    assert.deepEqual({ line_total: Number(result.line_total), total_amount: Number(result.total_amount), pricing_version: Number(result.pricing_version) }, { line_total: 1800, total_amount: 2100, pricing_version: 1 });
    assert.equal(result.cost_analysis_available, false);
    assert.equal(result.cost_total, null);
    const equipment = await read(admin, 'forge_quotation_line', primary.equipmentLineId);
    const service = await read(admin, 'forge_quotation_line', primary.serviceLineId);
    const quote = await read(admin, 'forge_quotation', primary.quoteId);
    assert.deepEqual({ price: Number(equipment.taxed_unit_price), quantity: Number(equipment.quantity), subtotal: Number(equipment.taxed_subtotal) }, { price: 900, quantity: 2, subtotal: 1800 });
    assert.deepEqual({ price: Number(service.taxed_unit_price), quantity: Number(service.quantity), subtotal: Number(service.taxed_subtotal) }, { price: 300, quantity: 1, subtotal: 300 });
    assert.deepEqual({ subtotal: Number(quote.subtotal), discount: Number(quote.discount_amount), tax: Number(quote.tax_amount), total: Number(quote.total_amount), version: Number(quote.pricing_version), cost: quote.cost_total }, { subtotal: 2100, discount: 0, tax: 0, total: 2100, version: 1, cost: null });
  });

  await test('same request replays while changed input and stale version conflict', async () => {
    const original = { line_id: primary.equipmentLineId, expected_version: 0, taxed_unit_price: 900, idempotency_key: `quote-${runId}-primary-v0` };
    const repeated = actionResult(mcpData(await invokeMcp(employee, primary.quoteId, original)));
    assert.equal(repeated.repeated, true);
    assert.deepEqual({ price: repeated.line_total, total: repeated.total_amount, version: repeated.pricing_version }, { price: 1800, total: 2100, version: 1 });
    const changed = await invokeMcp(employee, primary.quoteId, { ...original, taxed_unit_price: 800 });
    assert.equal(changed?.isError, true);
    assert.match(mcpText(changed), /同一请求标识已用于不同输入/);
    const stale = await invokeMcp(employee, primary.quoteId, { ...original, idempotency_key: `quote-${runId}-stale-v0`, taxed_unit_price: 800 });
    assert.equal(stale?.isError, true);
    assert.match(mcpText(stale), /报价版本已变化/);
    const quote = await read(admin, 'forge_quotation', primary.quoteId);
    assert.equal(Number(quote.total_amount), 2100);
    const receipts = await postgres.query('SELECT count(*)::int AS count FROM forge_quotation_price_adjustment_receipt WHERE quotation_id = $1', [primary.quoteId]);
    assert.equal(receipts.rows[0].count, 1);
  });

  await test('foreign line and another employee record are rejected before writing', async () => {
    const foreignLine = await invokeMcp(employee, primary.quoteId, {
      line_id: stranger.equipmentLineId, expected_version: 1, taxed_unit_price: 900,
      idempotency_key: `quote-${runId}-foreign-line`,
    });
    assert.equal(foreignLine?.isError, true);
    assert.match(mcpText(foreignLine), /不属于当前报价/);
    const foreignQuote = await invokeMcp(employee, stranger.quoteId, {
      line_id: stranger.equipmentLineId, expected_version: 0, taxed_unit_price: 900,
      idempotency_key: `quote-${runId}-foreign-quote`,
    });
    assert.equal(foreignQuote?.isError, true);
    assert.equal(Number((await read(admin, 'forge_quotation', stranger.quoteId)).total_amount), 2300);
  });

  await test('existing recalculation serializes its summary write into the quote version', async () => {
    const recalculate = await createQuote(admin, employee.userId, '版本重算');
    const edited = await admin.request(`/data/forge_quotation_line/${recalculate.equipmentLineId}`, 'PATCH', {
      taxed_unit_price: 950, untaxed_unit_price: 950, taxed_subtotal: 1900,
    });
    assert.ok(edited.status >= 200 && edited.status < 300, `Fixture line edit returned HTTP ${edited.status}`);
    const refreshed = await employee.request(`/actions/forge_quotation/quotation_recalculate/${recalculate.quoteId}`, 'POST', {});
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.value));
    const quote = await read(admin, 'forge_quotation', recalculate.quoteId);
    assert.deepEqual({ total: Number(quote.total_amount), version: Number(quote.pricing_version) }, { total: 2200, version: 1 });
    const stale = await invokeMcp(employee, recalculate.quoteId, {
      line_id: recalculate.equipmentLineId, expected_version: 0, taxed_unit_price: 900,
      idempotency_key: `quote-${runId}-after-recalculate`,
    });
    assert.equal(stale?.isError, true);
    assert.match(mcpText(stale), /报价版本已变化/);
  });

  await test('concurrent identical requests converge on one PostgreSQL version claim', async () => {
    const concurrent = await createQuote(admin, employee.userId, '并发同参');
    const params = { line_id: concurrent.equipmentLineId, expected_version: 0, taxed_unit_price: 900, idempotency_key: `quote-${runId}-same-v0` };
    const results = await Promise.all(Array.from({ length: 4 }, () => invokeMcp(employee, concurrent.quoteId, params)));
    assert.ok(results.every(result => result?.isError !== true), 'Concurrent duplicate requests must all return the committed result');
    const values = results.map(result => actionResult(mcpData(result)));
    assert.equal(new Set(values.map(result => result.total_amount)).size, 1);
    assert.equal(Number((await read(admin, 'forge_quotation', concurrent.quoteId)).total_amount), 2100);
    const receipts = await postgres.query('SELECT count(*)::int AS count FROM forge_quotation_price_adjustment_receipt WHERE quotation_id = $1 AND expected_version = 0', [concurrent.quoteId]);
    assert.equal(receipts.rows[0].count, 1);
  });

  await test('concurrent different requests allow only one result for the same version', async () => {
    const concurrent = await createQuote(admin, employee.userId, '并发异参');
    const results = await Promise.all([
      invokeMcp(employee, concurrent.quoteId, { line_id: concurrent.equipmentLineId, expected_version: 0, taxed_unit_price: 900, idempotency_key: `quote-${runId}-different-a` }),
      invokeMcp(employee, concurrent.quoteId, { line_id: concurrent.equipmentLineId, expected_version: 0, taxed_unit_price: 800, idempotency_key: `quote-${runId}-different-b` }),
    ]);
    assert.equal(results.filter(result => result?.isError !== true).length, 1);
    assert.equal(results.filter(result => result?.isError === true).length, 1);
    const quote = await read(admin, 'forge_quotation', concurrent.quoteId);
    assert.ok([1900, 2100].includes(Number(quote.total_amount)));
    assert.equal(Number(quote.pricing_version), 1);
    const receipts = await postgres.query('SELECT count(*)::int AS count FROM forge_quotation_price_adjustment_receipt WHERE quotation_id = $1 AND expected_version = 0', [concurrent.quoteId]);
    assert.equal(receipts.rows[0].count, 1);
  });

  await test('failure after line update rolls the line, quote version, summary and receipt back', async () => {
    const rollback = await createQuote(admin, employee.userId, '事务回滚');
    await installFailureTrigger(rollback.quoteId);
    const result = await invokeMcp(employee, rollback.quoteId, {
      line_id: rollback.equipmentLineId, expected_version: 0, taxed_unit_price: 900,
      idempotency_key: `quote-${runId}-rollback`,
    });
    assert.equal(result?.isError, true, 'A PostgreSQL trigger failure must reject the action');
    assert.match(mcpText(result), /isolated quotation adjustment rollback probe/);
    await removeFailureTrigger();
    const quote = await read(admin, 'forge_quotation', rollback.quoteId);
    const line = await read(admin, 'forge_quotation_line', rollback.equipmentLineId);
    const receipts = await postgres.query('SELECT count(*)::int AS count FROM forge_quotation_price_adjustment_receipt WHERE quotation_id = $1', [rollback.quoteId]);
    assert.deepEqual({ price: Number(line.taxed_unit_price), subtotal: Number(line.taxed_subtotal), version: Number(quote.pricing_version), total: Number(quote.total_amount), receipts: receipts.rows[0].count }, { price: 1000, subtotal: 2000, version: 0, total: 2300, receipts: 0 });
  });

  assert.ok(cases.every(item => item.status === 'passed'), `${cases.filter(item => item.status === 'failed').map(item => item.error).join('\n')}`);
  console.log(`PASS native quotation price adjustment permission, scalar MCP inputs, 2300-to-2100 recalculation, replay, conflict, concurrency and rollback on isolated PostgreSQL`);
} finally {
  if (admin) await cleanup(admin).catch(() => {});
  if (postgres) await postgres.end().catch(() => {});
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

if (cases.some(item => item.status === 'failed')) process.exitCode = 1;
