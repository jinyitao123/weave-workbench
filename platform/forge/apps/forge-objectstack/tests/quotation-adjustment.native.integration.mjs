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
const created = { users: [], memberships: [], assignments: [], categories: [], customers: [], types: [], issuers: [], contractTypes: [], contracts: [], materialCategories: [], units: [], materials: [], skus: [], quotes: [], lines: [] };
const cases = [];
let port;
let child;
let postgres;
let output = '';
let installedFailureTrigger = null;
let installedDraftFailureTrigger = null;

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

async function canRead(api, objectName, id) {
  const response = await api.request(`/data/${objectName}/${id}`);
  const record = response.value?.record || response.value?.data?.record;
  return response.status < 400 && Boolean(record?.id);
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
  await postgres.query('UPDATE forge_quotation SET owner_id = $1 WHERE id = $2', [ownerId, quoteId]);
  created.quotes.push(quoteId);
  const equipmentLineId = await create(admin, 'forge_quotation_line', {
    name: `${label}设备`, quotation_id: quoteId, line_type: 'material', item_code: `EQ-${suffix}`,
    quantity: 2, taxed_unit_price: 1000, untaxed_unit_price: 1000, tax_rate: 0,
    discount_rate: 0, taxed_subtotal: 2000,
  });
  await postgres.query('UPDATE forge_quotation_line SET owner_id = $1 WHERE id = $2', [ownerId, equipmentLineId]);
  created.lines.push(equipmentLineId);
  const serviceLineId = await create(admin, 'forge_quotation_line', {
    name: `${label}服务`, quotation_id: quoteId, line_type: 'service', item_code: `SV-${suffix}`,
    quantity: 1, taxed_unit_price: 300, untaxed_unit_price: 300, tax_rate: 0,
    discount_rate: 0, taxed_subtotal: 300,
  });
  await postgres.query('UPDATE forge_quotation_line SET owner_id = $1 WHERE id = $2', [ownerId, serviceLineId]);
  created.lines.push(serviceLineId);
  return { quoteId, equipmentLineId, serviceLineId };
}

async function createDraftReferenceData(admin, ownerId) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const customerCategoryId = await create(admin, 'forge_customer_category', { name: `草稿客户分类-${suffix}`, code: `DQCAT-${runId}-${suffix}`, status: 'active' });
  created.categories.push(customerCategoryId);
  const customerId = await create(admin, 'forge_customer', { name: `草稿客户-${suffix}`, category_id: customerCategoryId, responsible_id: ownerId });
  await postgres.query('UPDATE forge_customer SET owner_id = $1 WHERE id = $2', [ownerId, customerId]);
  created.customers.push(customerId);
  const typeId = await create(admin, 'forge_quotation_type', { name: `草稿类型-${suffix}`, code: `DQTYPE-${runId}-${suffix}`, status: 'active' });
  created.types.push(typeId);
  const issuerId = await create(admin, 'forge_quotation_issuer', { name: `草稿报价主体-${suffix}`, credit_code: `DQI-${runId}-${suffix}` });
  created.issuers.push(issuerId);
  const materialCategoryId = await create(admin, 'forge_material_category', { name: `草稿物料分类-${suffix}`, code: `DMCAT-${runId}-${suffix}`, status: 'active' });
  created.materialCategories.push(materialCategoryId);
  const unitId = await create(admin, 'forge_unit', { name: '台', code: `DUNIT-${runId}-${suffix}`, status: 'active' });
  created.units.push(unitId);
  const materialId = await create(admin, 'forge_material', {
    name: `草稿设备-${suffix}`, code: `DMAT-${runId}-${suffix}`, model: 'A型',
    category_id: materialCategoryId, unit_id: unitId, property: 'traded', source_type: 'purchased',
    status: 'active', responsible_id: ownerId,
  });
  created.materials.push(materialId);
  const skuId = await create(admin, 'forge_material_sku', {
    name: '标准规格', code: `DSKU-${runId}-${suffix}`, material_id: materialId,
    sale_price: 1000, cost_price: 450, enabled: true,
  });
  created.skus.push(skuId);
  const secondSkuId = await create(admin, 'forge_material_sku', {
    name: '服务配套规格', code: `DSKU2-${runId}-${suffix}`, material_id: materialId,
    sale_price: 300, cost_price: 200, enabled: true,
  });
  created.skus.push(secondSkuId);
  return { customerId, typeId, issuerId, materialCategoryId, unitId, materialId, skuId, secondSkuId };
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

async function installDraftFailureTrigger(failingLineName) {
  const token = randomUUID().replaceAll('-', '');
  const functionName = `quotation_draft_fail_${token}`;
  const triggerName = `quotation_draft_fail_${token}`;
  const escapedName = String(failingLineName).replaceAll("'", "''");
  await postgres.query(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.name = '${escapedName}' THEN RAISE EXCEPTION 'isolated quotation draft rollback probe'; END IF;
      RETURN NEW;
    END
  $$`);
  await postgres.query(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON forge_quotation_line FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
  installedDraftFailureTrigger = { functionName, triggerName };
}

async function removeDraftFailureTrigger() {
  if (!installedDraftFailureTrigger) return;
  await postgres.query(`DROP TRIGGER IF EXISTS "${installedDraftFailureTrigger.triggerName}" ON forge_quotation_line`);
  await postgres.query(`DROP FUNCTION IF EXISTS "${installedDraftFailureTrigger.functionName}"()`);
  installedDraftFailureTrigger = null;
}

async function cleanupTestUserRows(userIds) {
  const existing = await postgres.query("SELECT id FROM sys_user WHERE email LIKE 'quotation-adjustment-%@example.test' OR email LIKE 'quotation-observer-%@example.test' OR email LIKE 'quotation-draft-peer-%@example.test'");
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
  await removeDraftFailureTrigger().catch(() => {});
  for (const id of created.quotes) if (id) await postgres.query('DELETE FROM forge_quotation_price_adjustment_receipt WHERE quotation_id = $1', [id]).catch(() => {});
  for (const id of created.quotes) if (id) await postgres.query('DELETE FROM forge_quotation_line WHERE quotation_id = $1', [id]).catch(() => {});
  for (const id of [...created.lines].reverse()) if (id) await admin.request(`/data/forge_quotation_line/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.quotes].reverse()) if (id) await admin.request(`/data/forge_quotation/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.contracts].reverse()) if (id) await admin.request(`/data/forge_sales_contract/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.issuers].reverse()) if (id) await admin.request(`/data/forge_quotation_issuer/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.types].reverse()) if (id) await admin.request(`/data/forge_quotation_type/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.contractTypes].reverse()) if (id) await admin.request(`/data/forge_contract_type/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.skus].reverse()) if (id) await admin.request(`/data/forge_material_sku/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.materials].reverse()) if (id) await admin.request(`/data/forge_material/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.materialCategories].reverse()) if (id) await admin.request(`/data/forge_material_category/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.units].reverse()) if (id) await admin.request(`/data/forge_unit/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.customers].reverse()) if (id) await admin.request(`/data/forge_customer/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.categories].reverse()) if (id) await admin.request(`/data/forge_customer_category/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.assignments].reverse()) if (id) await admin.request(`/data/sys_user_permission_set/${id}`, 'DELETE').catch(() => {});
  for (const id of [...created.memberships].reverse()) if (id) await postgres.query('DELETE FROM sys_member WHERE id = $1', [id]).catch(() => {});
  for (const id of [...created.users].reverse()) if (id) await admin.request(`/data/sys_user/${id}`, 'DELETE').catch(() => {});
  await cleanupTestUserRows(created.users);
}

let admin;
let employee;
let draftPeer;
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
  const employeeSession = await employee.request('/auth/get-session');
  const employeeSessionUser = employeeSession.value?.user || employeeSession.value?.session?.user;
  assert.equal(employeeSessionUser?.id, employee.userId, 'The normal sales page must be able to resolve the signed-in owner');
  const observerEmail = `quotation-observer-${runId}@example.test`;
  unprivilegedEmployee = await createEmployee(admin, observerEmail, `Observe-${randomBytes(18).toString('hex')}!`, organizationId, 'quotation-observer-test');
  draftPeer = await createEmployee(admin, `quotation-draft-peer-${runId}@example.test`, `Peer-${randomBytes(18).toString('hex')}!`, organizationId, 'quotation-draft-peer-test');

  const permissionRows = await postgres.query("SELECT id, name FROM sys_permission_set WHERE name = ANY($1::text[])", [['sales_quotation_adjustment_operator', 'sales_quotation_draft_operator', 'sales_contract_operator', 'sales_contract_reviewer']]);
  const adjustmentPermission = permissionRows.rows.find(row => row.name === 'sales_quotation_adjustment_operator');
  const draftPermission = permissionRows.rows.find(row => row.name === 'sales_quotation_draft_operator');
  const contractPermission = permissionRows.rows.find(row => row.name === 'sales_contract_operator');
  const contractReviewerPermission = permissionRows.rows.find(row => row.name === 'sales_contract_reviewer');
  assert.ok(adjustmentPermission?.id, 'Forge must provision the sales quotation adjustment permission set');
  assert.ok(draftPermission?.id, 'Forge must provision the sales quotation draft permission set');
  assert.ok(contractPermission?.id, 'Forge must provision the existing sales contract operator permission set');
  assert.ok(contractReviewerPermission?.id, 'Forge must provision the existing sales contract reviewer permission set');
  await assignPermission(admin, employee, adjustmentPermission.id, organizationId);
  await assignPermission(admin, employee, draftPermission.id, organizationId);
  await assignPermission(admin, employee, contractPermission.id, organizationId);
  await assignPermission(admin, draftPeer, draftPermission.id, organizationId);
  await assignPermission(admin, draftPeer, contractPermission.id, organizationId);
  await assignPermission(admin, draftPeer, contractReviewerPermission.id, organizationId);

  const draftReferences = await createDraftReferenceData(admin, employee.userId);
  const contractTypeId = await create(admin, 'forge_contract_type', { name: `隔离合同类型-${runId}`, code: `CT-${runId}`, status: 'active' });
  created.contractTypes.push(contractTypeId);
  const ownedContractId = await create(admin, 'forge_sales_contract', {
    name: `销售本人合同-${runId}`, code: `SC-${runId}`, contract_type_id: contractTypeId,
    customer_id: draftReferences.customerId, responsible_id: employee.userId,
  });
  await postgres.query('UPDATE forge_sales_contract SET owner_id = $1 WHERE id = $2', [employee.userId, ownedContractId]);
  created.contracts.push(ownedContractId);
  assert.equal((await read(employee, 'forge_sales_contract', ownedContractId)).owner_id, employee.userId);
  assert.equal(await canRead(draftPeer, 'forge_sales_contract', ownedContractId), false, 'Contract operator and reviewer sets must not expose another seller\'s contract rows');
  const draftCode = `QT-DRAFT-${runId}`;
  const draftParams = {
    code: draftCode, name: `两行设备与服务报价-${runId}`,
    customer_id: draftReferences.customerId, quotation_type_id: draftReferences.typeId,
    issuer_id: draftReferences.issuerId, quotation_date: '2026-09-24', valid_until: '2026-10-24',
    lines_json: JSON.stringify([
      { line_type: 'material', sku_id: draftReferences.skuId, quantity: 2, taxed_unit_price: 1000, tax_rate: 0, discount_rate: 0 },
      { line_type: 'service', name: '设备安装服务', quantity: 1, taxed_unit_price: 300, tax_rate: 0, discount_rate: 0 },
    ]),
  };
  await test('ObjectStack accepts and reads back the canonical material property and source codes', async () => {
    const values = [
      { name: '贸易商品', property: 'traded', source_type: 'purchased' },
      { name: '备件', property: 'spare', source_type: 'purchased' },
      { name: '外协来源', property: 'raw_material', source_type: 'subcontracted' },
    ];
    for (const [index, value] of values.entries()) {
      const id = await create(admin, 'forge_material', {
        name: `${value.name}-${runId}`, code: `ENUM-${runId}-${index}`,
        model: 'ENUM-01', category_id: draftReferences.materialCategoryId,
        unit_id: draftReferences.unitId, property: value.property,
        source_type: value.source_type, status: 'active',
      });
      created.materials.push(id);
      const record = await read(admin, 'forge_material', id);
      assert.deepEqual({ property: record.property, source_type: record.source_type }, { property: value.property, source_type: value.source_type });
    }
    const legacyCode = await admin.request('/data/forge_material', 'POST', {
      name: `非法旧编码-${runId}`, code: `ENUM-OLD-${runId}`, model: 'ENUM-01',
      category_id: draftReferences.materialCategoryId, unit_id: draftReferences.unitId,
      property: 'trade_goods', source_type: 'outsourced', status: 'active',
    });
    assert.ok(legacyCode.status >= 400, 'The object must keep its canonical enum codes and reject the former aliases');
  });
  await test('sales employee creates and reopens an owned two-line draft through the Forge domain action', async () => {
    const directory = mcpData(await employee.callMcpTool('list_actions', {}));
    assert.equal(directory?.actions?.some(item => item.name === 'sales_quotation_draft_create'), false, 'Draft creation must not be exposed as an MCP write action');
    const directCreate = await employee.request('/data/forge_quotation', 'POST', { name: '通用写入不应创建报价' });
    assert.ok(directCreate.status >= 400, 'The sales draft permission must not grant generic quote creation');
    const visibleCustomers = await employee.request('/data/forge_customer?$top=500&$select=id,name,owner_id,responsible_id');
    assert.equal(visibleCustomers.status, 200);
    assert.ok(visibleCustomers.value?.records?.some(row => row.id === draftReferences.customerId), 'The sales page must be able to select its own customer');
    const pageReferenceReads = await Promise.all([
      employee.request('/data/forge_contact?$top=500&$select=id,name,customer_id,job_title,department,employment_status,owner_id,responsible_id'),
      employee.request('/data/forge_quotation_type?$top=500&$select=id,name,code,status'),
      employee.request('/data/forge_quotation_issuer?$top=500&$select=id,name,short_name'),
      employee.request('/data/forge_material?$top=500&$select=id,name,code,model,unit_id,status'),
      employee.request('/data/forge_unit?$top=500&$select=id,name,status'),
    ]);
    assert.ok(pageReferenceReads.every(response => response.status === 200), 'All reference selectors used by the sales page must remain readable to its seller');
    const foreignCustomer = await createDraftReferenceData(admin, draftPeer.userId);
    assert.equal(await canRead(employee, 'forge_customer', foreignCustomer.customerId), false, 'Customer selection must not widen to another salesperson\'s customer');
    const visibleSkus = await employee.request('/data/forge_material_sku?$top=500&$select=id,code,name,material_id,sale_price,enabled');
    assert.equal(visibleSkus.status, 200);
    const visibleSku = visibleSkus.value?.records?.find(row => row.id === draftReferences.skuId);
    assert.ok(visibleSku, 'The sales page must be able to select an organization catalog SKU');
    assert.equal(Object.hasOwn(visibleSku, 'cost_price'), false, 'The quote selector must not fetch internal SKU cost into the page');
    const skuDetail = await employee.request(`/data/forge_material_sku/${draftReferences.skuId}`);
    const skuDetailRecord = skuDetail.value?.record || skuDetail.value?.data?.record;
    assert.equal(skuDetail.status, 200);
    assert.ok(skuDetailRecord?.cost_price === undefined || skuDetailRecord?.cost_price === null, 'Native FLS must hide a populated SKU cost from the sales role');
    const saved = await employee.request('/actions/forge_quotation/sales_quotation_draft_create', 'POST', { params: draftParams });
    assert.equal(saved.status, 200, `Draft domain action returned HTTP ${saved.status}: ${JSON.stringify(saved.value)}`);
    const result = actionResult(saved.value);
    assert.ok(result.id, 'Draft action must return the persisted quote id');
    assert.equal(Object.hasOwn(result, 'cost_total'), false, 'Draft action must not return an aggregate cost to sales');
    assert.equal(Object.hasOwn(result, 'cost_analysis_available'), false, 'Draft action must not infer whether cost data is available');
    created.quotes.push(result.id);
    const ownerReopen = await clientFor(employeeEmail, employeePassword);
    const ownQuote = await read(ownerReopen, 'forge_quotation', result.id);
    assert.equal(ownQuote.owner_id, employee.userId);
    assert.equal(ownQuote.responsible_id, employee.userId);
    assert.deepEqual({ item_count: Number(ownQuote.item_count), subtotal: Number(ownQuote.subtotal), discount: Number(ownQuote.discount_amount), tax: Number(ownQuote.tax_amount), total: Number(ownQuote.total_amount) }, { item_count: 2, subtotal: 2300, discount: 0, tax: 0, total: 2300 });
    assert.ok(ownQuote.cost_total === undefined || ownQuote.cost_total === null, 'Native FLS must keep the quote total cost unknown to sales');
    const ownLines = await findAll(ownerReopen, 'forge_quotation_line', { quotation_id: result.id });
    created.lines.push(...ownLines.map(line => line.id));
    assert.equal(ownLines.length, 2, 'The newly saved quote must reopen with both details');
    assert.ok(ownLines.every(line => line.owner_id === employee.userId), 'Every detail must carry the sales owner in system context');
    assert.ok(ownLines.every(line => line.cost_price === undefined || line.cost_price === null), 'Sales cannot read detail costs');
    assert.deepEqual(ownLines.map(line => [line.line_type, Number(line.quantity), Number(line.taxed_unit_price), Number(line.taxed_subtotal)]).sort(), [['material', 2, 1000, 2000], ['service', 1, 300, 300]]);
    assert.equal(await canRead(draftPeer, 'forge_quotation', result.id), false, 'A second sales employee must not read the first employee\'s draft');
    assert.equal(await canRead(draftPeer, 'forge_quotation_line', ownLines[0].id), false, 'The contract operator role must not widen another salesperson\'s quotation detail access');
  });

  await test('sales can adjust two fully costed material lines without receiving cost through REST or MCP', async () => {
    const code = `QT-COST-${runId}`;
    const saved = await employee.request('/actions/forge_quotation/sales_quotation_draft_create', 'POST', { params: {
      ...draftParams, code, name: `纯物料成本隔离报价-${runId}`,
      lines_json: JSON.stringify([
        { line_type: 'material', sku_id: draftReferences.skuId, quantity: 2, taxed_unit_price: 1000, tax_rate: 0, discount_rate: 0 },
        { line_type: 'material', sku_id: draftReferences.secondSkuId, quantity: 1, taxed_unit_price: 300, tax_rate: 0, discount_rate: 0 },
      ]),
    } });
    assert.equal(saved.status, 200, `Cost-isolation draft returned HTTP ${saved.status}: ${JSON.stringify(saved.value)}`);
    const createdQuote = actionResult(saved.value);
    assert.ok(createdQuote.id);
    created.quotes.push(createdQuote.id);
    const fixtureLines = await findAll(admin, 'forge_quotation_line', { quotation_id: createdQuote.id });
    created.lines.push(...fixtureLines.map(line => line.id));
    assert.equal(fixtureLines.length, 2);
    await postgres.query('UPDATE forge_quotation_line SET cost_price = CASE sort_order WHEN 0 THEN 450 WHEN 1 THEN 200 END WHERE quotation_id = $1', [createdQuote.id]);
    await postgres.query('UPDATE forge_quotation SET cost_total = $1 WHERE id = $2', [1100, createdQuote.id]);
    const storedCosts = await postgres.query('SELECT sort_order, cost_price FROM forge_quotation_line WHERE quotation_id = $1 ORDER BY sort_order', [createdQuote.id]);
    assert.deepEqual(storedCosts.rows.map(row => Number(row.cost_price)), [450, 200], 'The isolated fixture must contain two complete cost snapshots');
    const quote = await read(employee, 'forge_quotation', createdQuote.id);
    const ownedLines = await findAll(employee, 'forge_quotation_line', { quotation_id: createdQuote.id });
    assert.equal(Number(quote.total_amount), 2300);
    assert.ok(quote.cost_total === undefined || quote.cost_total === null);
    assert.ok(ownedLines.every(line => line.cost_price === undefined || line.cost_price === null));

    const result = actionResult(mcpData(await invokeMcp(employee, createdQuote.id, {
      line_id: ownedLines.find(line => Number(line.sort_order) === 0).id,
      expected_version: Number(quote.pricing_version || 0), taxed_unit_price: 900,
      idempotency_key: `quote-cost-hidden-${runId}`,
    })));
    assert.deepEqual({ line_total: Number(result.line_total), total_amount: Number(result.total_amount), pricing_version: Number(result.pricing_version) }, { line_total: 1800, total_amount: 2100, pricing_version: 1 });
    assert.equal(Object.hasOwn(result, 'cost_total'), false, 'The MCP price action must not return aggregate cost');
    assert.equal(Object.hasOwn(result, 'cost_analysis_available'), false, 'The MCP price action must not reveal cost availability');
    const reopened = await clientFor(employeeEmail, employeePassword);
    const quoteAfter = await read(reopened, 'forge_quotation', createdQuote.id);
    const linesAfter = await findAll(reopened, 'forge_quotation_line', { quotation_id: createdQuote.id });
    assert.equal(Number(quoteAfter.total_amount), 2100);
    assert.ok(quoteAfter.cost_total === undefined || quoteAfter.cost_total === null);
    assert.ok(linesAfter.every(line => line.cost_price === undefined || line.cost_price === null));
    const storedCostTotal = await postgres.query('SELECT cost_total FROM forge_quotation WHERE id = $1', [createdQuote.id]);
    assert.equal(Number(storedCostTotal.rows[0].cost_total), 1100, 'The price action must preserve the internal cost snapshot without returning it');
    const storedCostLines = await postgres.query('SELECT cost_price FROM forge_quotation_line WHERE quotation_id = $1 ORDER BY sort_order', [createdQuote.id]);
    assert.deepEqual(storedCostLines.rows.map(row => Number(row.cost_price)), [450, 200], 'The price action must preserve hidden detail costs');
  });

  await test('draft header, first detail and calculated amounts roll back together on a detail failure', async () => {
    const beforeQuotes = await postgres.query('SELECT count(*)::int AS count FROM forge_quotation');
    const beforeLines = await postgres.query('SELECT count(*)::int AS count FROM forge_quotation_line');
    await installDraftFailureTrigger('故障测试服务');
    try {
      const failed = await employee.request('/actions/forge_quotation/sales_quotation_draft_create', 'POST', { params: {
        ...draftParams, code: `QT-ROLLBACK-${runId}`, name: '报价事务回滚',
        lines_json: JSON.stringify([
          { line_type: 'material', sku_id: draftReferences.skuId, quantity: 1, taxed_unit_price: 1000, tax_rate: 0, discount_rate: 0 },
          { line_type: 'service', name: '故障测试服务', quantity: 1, taxed_unit_price: 300, tax_rate: 0, discount_rate: 0 },
        ]),
      } });
      assert.ok(failed.status >= 400, 'A line insert failure must fail the complete draft action');
    } finally {
      await removeDraftFailureTrigger();
    }
    const afterQuotes = await postgres.query('SELECT count(*)::int AS count FROM forge_quotation');
    const afterLines = await postgres.query('SELECT count(*)::int AS count FROM forge_quotation_line');
    assert.equal(afterQuotes.rows[0].count, beforeQuotes.rows[0].count, 'The quote header must roll back with the failed line');
    assert.equal(afterLines.rows[0].count, beforeLines.rows[0].count, 'The first detail must roll back with the failed second detail');
  });

  await test('a second sales employee cannot draft against the first employee\'s customer', async () => {
    assert.equal(await canRead(draftPeer, 'forge_customer', draftReferences.customerId), false, 'Customer reference lists must stay within the current sales owner scope');
    const forbidden = await draftPeer.request('/actions/forge_quotation/sales_quotation_draft_create', 'POST', { params: { ...draftParams, code: `QT-PEER-${runId}` } });
    assert.ok(forbidden.status >= 400, 'The domain action must check customer ownership even in system context');
    assert.match(errorMessage(forbidden), /本人拥有/);
    assert.equal((await findAll(admin, 'forge_quotation', { code: `QT-PEER-${runId}` })).length, 0);
  });

  await test('existing line-price action changes 2300 to 2100 and preserves missing cost as unknown', async () => {
    const quote = (await findAll(employee, 'forge_quotation', { code: draftCode }))[0];
    const lines = await findAll(employee, 'forge_quotation_line', { quotation_id: quote.id });
    const device = lines.find(line => line.line_type === 'material');
    const changed = await employee.request(`/actions/forge_quotation/quotation_adjust_line_price/${quote.id}`, 'POST', {
      params: { line_id: device.id, expected_version: Number(quote.pricing_version || 0), taxed_unit_price: 900, idempotency_key: `draft-price-${runId}` },
    });
    assert.equal(changed.status, 200, `Existing line-price action returned HTTP ${changed.status}: ${JSON.stringify(changed.value)}`);
    const ownerAfterAdjustment = await clientFor(employeeEmail, employeePassword);
    const reopened = await read(ownerAfterAdjustment, 'forge_quotation', quote.id);
    const reopenedLines = await findAll(ownerAfterAdjustment, 'forge_quotation_line', { quotation_id: quote.id });
    assert.deepEqual({ owner_id: reopened.owner_id, item_count: Number(reopened.item_count), total: Number(reopened.total_amount) }, { owner_id: employee.userId, item_count: 2, total: 2100 });
    assert.ok(reopened.cost_total === undefined || reopened.cost_total === null);
    assert.deepEqual(reopenedLines.map(line => [line.line_type, Number(line.quantity), Number(line.taxed_unit_price)]).sort(), [['material', 2, 900], ['service', 1, 300]]);
  });

  const primary = await createQuote(admin, employee.userId, '价格调整');
  const stranger = await createQuote(admin, admin.userId, '其他员工');

  await test('native recalculation reads 2*1000+300 as 2300 without inventing missing cost', async () => {
    const result = await employee.request(`/actions/forge_quotation/quotation_recalculate/${primary.quoteId}`, 'POST', {});
    assert.equal(result.status, 200, JSON.stringify(result.value));
    const totals = actionResult(result.value);
    assert.equal(Object.hasOwn(totals, 'cost_total'), false);
    assert.equal(Object.hasOwn(totals, 'cost_analysis_available'), false);
    const quote = await read(employee, 'forge_quotation', primary.quoteId);
    assert.deepEqual({ subtotal: Number(quote.subtotal), total_amount: Number(quote.total_amount) }, { subtotal: 2300, total_amount: 2300 });
    assert.ok(quote.cost_total === undefined || quote.cost_total === null, 'Recalculation must not return the hidden cost field');
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
    assert.equal(Object.hasOwn(result, 'cost_analysis_available'), false, 'MCP must not report cost availability');
    assert.equal(Object.hasOwn(result, 'cost_total'), false, 'MCP must not return a cost total');
    const equipment = await read(admin, 'forge_quotation_line', primary.equipmentLineId);
    const service = await read(admin, 'forge_quotation_line', primary.serviceLineId);
    const quote = await read(admin, 'forge_quotation', primary.quoteId);
    assert.deepEqual({ price: Number(equipment.taxed_unit_price), quantity: Number(equipment.quantity), subtotal: Number(equipment.taxed_subtotal) }, { price: 900, quantity: 2, subtotal: 1800 });
    assert.deepEqual({ price: Number(service.taxed_unit_price), quantity: Number(service.quantity), subtotal: Number(service.taxed_subtotal) }, { price: 300, quantity: 1, subtotal: 300 });
    assert.deepEqual({ subtotal: Number(quote.subtotal), discount: Number(quote.discount_amount), tax: Number(quote.tax_amount), total: Number(quote.total_amount), version: Number(quote.pricing_version) }, { subtotal: 2100, discount: 0, tax: 0, total: 2100, version: 1 });
    assert.ok(quote.cost_total === undefined || quote.cost_total === null);
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
