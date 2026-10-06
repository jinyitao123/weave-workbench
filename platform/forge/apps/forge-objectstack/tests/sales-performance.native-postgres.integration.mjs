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

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromTest = createRequire(import.meta.url);
const requireFromCli = createRequire(requireFromTest.resolve('@objectstack/cli'));
const betterAuthCrypto = await import(pathToFileURL(requireFromCli.resolve('better-auth/crypto')).href);
const hashPassword = betterAuthCrypto.hashPassword;
const run = promisify(execFile);
const runId = randomUUID().replaceAll('-', '').slice(0, 14).toLowerCase();
const database = 'forge_sales_perf_' + runId;
const databasePort = Number(process.env.FORGE_INTEGRATION_PG_PORT || 5432);
const organizationId = randomUUID();
const secretKey = randomBytes(32).toString('hex');
const authSecret = randomBytes(32).toString('hex');
const temporaryPasswords = [];
const id = () => randomUUID();
const resultOf = response => response?.value?.result?.result || response?.value?.result || response?.value?.data?.result || response?.value?.data || response?.value;
const rowsOf = value => { const payload = value?.data ?? value; return Array.isArray(payload) ? payload : payload?.records || payload?.items || []; };
const messageOf = response => String(response?.value?.error?.message || response?.value?.error || response?.value?.message || '').slice(0, 2000);

function safeOutput(output, databaseUrl = '') {
  let safe = String(output || '').replaceAll(secretKey, '[temporary secret omitted]').replaceAll(authSecret, '[temporary auth secret omitted]');
  if (databaseUrl) safe = safe.replaceAll(databaseUrl, '[temporary database URL omitted]');
  for (const password of temporaryPasswords) if (password) safe = safe.replaceAll(password, '[temporary password omitted]');
  return safe.slice(-7000);
}

function bindAddress() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

test('sales performance normal HTTP authorization, native approval, Rebook ledger and export persist in isolated PostgreSQL', { timeout: 360_000 }, async t => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'forge-sales-performance-pg-'));
  const runtimePort = await bindAddress();
  const origin = 'http://127.0.0.1:' + runtimePort;
  const databaseUrl = 'postgresql://' + encodeURIComponent(os.userInfo().username) + '@127.0.0.1:' + databasePort + '/' + database;
  let databaseCreated = false;
  let postgres;
  let child;
  let runtimeOutput = '';
  let signInIp = 30;
  const schemas = new Map();

  await run('createdb', ['-h', '127.0.0.1', '-p', String(databasePort), database]);
  databaseCreated = true;
  postgres = new Client({ connectionString: databaseUrl });
  await postgres.connect();

  async function stopRuntime() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise(resolve => child.once('close', resolve));
    child.kill('SIGTERM');
    await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 10_000))]);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
    child = undefined;
  }

  t.after(async () => {
    await stopRuntime();
    await postgres?.end().catch(() => {});
    if (databaseCreated) {
      await run('dropdb', ['-h', '127.0.0.1', '-p', String(databasePort), database]);
      const admin = new Client({ connectionString: 'postgresql://' + encodeURIComponent(os.userInfo().username) + '@127.0.0.1:' + databasePort + '/postgres' });
      await admin.connect();
      const remaining = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database]);
      await admin.end();
      assert.equal(remaining.rows.length, 0, 'the temporary sales-performance database was dropped');
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  await writeFile(path.join(tempDir, 'package.json'), '{"name":"forge-sales-performance-native-pg-test","type":"module"}\n');
  await writeFile(path.join(tempDir, 'objectstack.config.ts'), `export { default } from ${JSON.stringify(path.join(APP_DIR, 'objectstack.config.ts'))};\n`);
  await symlink(path.join(APP_DIR, 'src'), path.join(tempDir, 'src'), 'dir');
  await symlink(path.join(APP_DIR, 'node_modules'), path.join(tempDir, 'node_modules'), 'dir');

  async function startRuntime() {
    runtimeOutput = '';
    child = spawn(process.execPath, [path.join(APP_DIR, 'node_modules/@objectstack/cli/bin/run.js'), 'serve', 'objectstack.config.ts', '--port', String(runtimePort), '--log-level', 'error'], {
      cwd: tempDir,
      env: {
        ...process.env,
        NODE_ENV: 'production', OS_HOME: path.join(tempDir, '.os-home'), OS_DATABASE_URL: databaseUrl,
        OS_SECRET_KEY: secretKey, OS_AUTH_SECRET: authSecret, OS_BASE_URL: origin, OS_TRUSTED_ORIGINS: origin,
        OS_ENVIRONMENT_ID: 'sales-performance-' + runId, OS_TENANCY_POSTURE: 'single', OS_SEED_ADMIN: 'false',
        OS_AUTOMATION_SCHEDULED_WORK_ENABLED: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8').on('data', chunk => { runtimeOutput = (runtimeOutput + chunk).slice(-14_000); });
    child.stderr.setEncoding('utf8').on('data', chunk => { runtimeOutput = (runtimeOutput + chunk).slice(-14_000); });
    const deadline = Date.now() + 150_000;
    let health;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Official ObjectStack Runtime exited (' + child.exitCode + ').\n' + safeOutput(runtimeOutput, databaseUrl));
      try { health = await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(1000) }); if (health.ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    assert.ok(health?.ok, 'Official Runtime did not become ready.\n' + safeOutput(runtimeOutput, databaseUrl));
  }

  async function tableSchema(tableName) {
    if (schemas.has(tableName)) return schemas.get(tableName);
    const result = await postgres.query('SELECT column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1', [tableName]);
    assert.ok(result.rows.length, 'Official Runtime registered PostgreSQL table ' + tableName);
    const schema = new Map(result.rows.map(row => [row.column_name, row]));
    schemas.set(tableName, schema);
    return schema;
  }

  async function insertFixture(tableName, values) {
    const schema = await tableSchema(tableName), now = new Date().toISOString(), candidate = { id: id(), created_at: now, updated_at: now, ...values };
    const columns = [...schema.keys()].filter(name => candidate[name] !== undefined);
    const missing = [...schema.entries()].filter(([name, column]) => column.is_nullable === 'NO' && column.column_default == null && !columns.includes(name)).map(([name]) => name);
    assert.deepEqual(missing, [], 'Fixture for ' + tableName + ' satisfies actual PostgreSQL schema');
    const quoted = columns.map(name => '"' + name.replaceAll('"', '""') + '"').join(', ');
    const marks = columns.map((_, index) => '$' + (index + 1)).join(', ');
    await postgres.query('INSERT INTO "' + tableName.replaceAll('"', '""') + '" (' + quoted + ') VALUES (' + marks + ')', columns.map(name => candidate[name]));
    return candidate.id;
  }

  async function signIn(email, password) {
    const response = await fetch(origin + '/api/v1/auth/sign-in/email', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Forwarded-For': '198.51.100.' + signInIp++ },
      body: JSON.stringify({ email, password }),
    });
    const value = await response.json().catch(() => ({}));
    assert.equal(response.status, 200, 'BetterAuth sign-in returned ' + response.status + ': ' + String(value.message || value.error || '').slice(0, 120) + '\n' + safeOutput(runtimeOutput, databaseUrl));
    const cookie = response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
    assert.ok(value.user?.id && cookie, 'ordinary HTTP sign-in issues a native user session');
    return { id: value.user.id, cookie };
  }

  function clientFor(session) {
    return {
      id: session.id,
      async request(resource, method = 'GET', body) {
        const response = await fetch(origin + '/api/v1' + resource, {
          method, headers: { Cookie: session.cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: response.status, value: await response.json().catch(() => null) };
      },
    };
  }

  async function ensurePermissionBinding(positionId, permissionName) {
    const permission = await postgres.query('SELECT id FROM sys_permission_set WHERE name=$1 AND active=true ORDER BY id LIMIT 1', [permissionName]);
    assert.ok(permission.rows[0]?.id, 'registered native PermissionSet ' + permissionName + ' exists');
    const existing = await postgres.query('SELECT id FROM sys_position_permission_set WHERE position_id=$1 AND permission_set_id=$2 LIMIT 1', [positionId, permission.rows[0].id]);
    if (!existing.rows.length) await insertFixture('sys_position_permission_set', { position_id: positionId, permission_set_id: permission.rows[0].id, organization_id: organizationId });
  }

  async function createPosition(name, permissionNames) {
    let position = await postgres.query('SELECT id FROM sys_position WHERE name=$1 AND organization_id=$2 ORDER BY id LIMIT 1', [name, organizationId]);
    const positionId = position.rows[0]?.id || await insertFixture('sys_position', { name, label: '销售业绩临时验收岗位', active: true, organization_id: organizationId });
    for (const permissionName of permissionNames) await ensurePermissionBinding(positionId, permissionName);
    return positionId;
  }

  async function createActor(label, permissionBindings) {
    const email = 'sales-performance-' + label + '-' + runId + '@example.test';
    const password = 'Performance-' + randomBytes(22).toString('hex') + '!';
    temporaryPasswords.push(password);
    const userId = id();
    await insertFixture('sys_user', { id: userId, name: '业绩验收' + label, email, email_verified: true, banned: false, role: 'user' });
    await insertFixture('sys_account', { user_id: userId, provider_id: 'credential', account_id: userId, password: await hashPassword(password), access_token: null, refresh_token: null, id_token: null });
    await insertFixture('sys_member', { user_id: userId, organization_id: organizationId, role: 'member' });
    for (const { name, permissionName } of permissionBindings) {
      const positionId = await createPosition(name, [permissionName]);
      await insertFixture('sys_user_position', { user_id: userId, position: name, position_id: positionId, organization_id: organizationId, valid_from: new Date(Date.now() - 60_000).toISOString(), valid_until: null });
    }
    const client = clientFor(await signIn(email, password));
    assert.equal(client.id, userId, 'signed-in identity maps to its canonical sys_user');
    return client;
  }

  async function waitForNativeRequest(objectName, recordId) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const result = await postgres.query('SELECT id,status,organization_id,object_name,record_id,process_name,flow_run_id,flow_node_id FROM sys_approval_request WHERE organization_id=$1 AND object_name=$2 AND record_id=$3 ORDER BY created_at DESC LIMIT 5', [organizationId, objectName, recordId]);
      const request = result.rows.find(row => row.status === 'pending');
      if (request) return request;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const recent = await postgres.query('SELECT status,object_name,record_id,process_name,flow_node_id FROM sys_approval_request WHERE organization_id=$1 AND object_name=$2 AND record_id=$3 ORDER BY created_at DESC LIMIT 5', [organizationId, objectName, recordId]);
    assert.fail('Native ApprovalService did not create a pending request: ' + JSON.stringify(recent.rows) + '\n' + safeOutput(runtimeOutput, databaseUrl));
  }

  async function waitForRecordStatus(tableName, recordId, expectedStatus) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const result = await postgres.query('SELECT status FROM "' + tableName.replaceAll('"', '""') + '" WHERE id=$1 AND organization_id=$2', [recordId, organizationId]);
      if (result.rows[0]?.status === expectedStatus) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const result = await postgres.query('SELECT status,approval_status FROM "' + tableName.replaceAll('"', '""') + '" WHERE id=$1 AND organization_id=$2', [recordId, organizationId]);
    assert.equal(result.rows[0]?.status, expectedStatus, tableName + ' status finalized through native Flow');
  }

  await startRuntime();
  const accountIssuerColumn = await postgres.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='sys_account' AND column_name='issuer'");
  if (!accountIssuerColumn.rows.length) await postgres.query('ALTER TABLE sys_account ADD COLUMN issuer text');

  await insertFixture('sys_organization', { id: organizationId, name: '销售业绩原生PG隔离组织 ' + runId, slug: 'sales-performance-' + runId, timezone: 'Asia/Shanghai' });
  const actor = await createActor('manager', [
    { name: 'perf-reader-' + runId, permissionName: 'sales_performance_reader' },
    { name: 'perf-confirm-' + runId, permissionName: 'sales_performance_confirm' },
    { name: 'perf-rebook-' + runId, permissionName: 'sales_performance_rebook' },
    { name: 'perf-source-reader-' + runId, permissionName: 'forge_finance_reviewer' },
  ]);
  const seller = await createActor('seller', [{ name: 'perf-reader-seller-' + runId, permissionName: 'sales_performance_reader' }]);
  const outsideSeller = await createActor('outside-seller', [{ name: 'perf-reader-outside-' + runId, permissionName: 'sales_performance_reader' }]);
  const reviewer = await createActor('reviewer', [{ name: 'finance_reviewer', permissionName: 'forge_finance_reviewer' }]);

  const actorPermissions = resultOf(await actor.request('/auth/me/permissions'));
  const sellerPermissions = resultOf(await seller.request('/auth/me/permissions'));
  for (const permission of ['sales_performance_read', 'sales_performance_confirm', 'sales_performance_rebook', 'forge_sales_gross_profit_read']) {
    assert.ok((actorPermissions.systemPermissions || []).includes(permission), 'manager has effective native permission ' + permission);
  }
  assert.ok((sellerPermissions.systemPermissions || []).includes('sales_performance_read'));
  assert.equal((sellerPermissions.systemPermissions || []).includes('sales_performance_confirm'), false, 'read-only employee cannot submit confirmations');
  assert.equal((sellerPermissions.systemPermissions || []).includes('sales_performance_rebook'), false, 'read-only employee cannot submit Rebook');

  const businessDateResponse = await actor.request('/actions/global/organization_business_date_query', 'POST', { params: {} });
  assert.equal(businessDateResponse.status, 200, 'ordinary authenticated actor reads host-projected organization business date: ' + messageOf(businessDateResponse));
  const dateResult = resultOf(businessDateResponse);
  const businessDate = String(dateResult?.business_date || '');
  assert.match(businessDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(dateResult?.timezone, 'Asia/Shanghai', 'ordinary authenticated actor receives the timezone used by the organization date projection');
  const businessQuarter = 'q' + Math.ceil(Number(businessDate.slice(5, 7)) / 3);
  const outsideQuarter = businessQuarter === 'q1' ? 'q2' : 'q1';
  assert.deepEqual(Object.keys(dateResult).sort(), ['business_date', 'timezone'], 'global date response exposes only the date context, not organization or business records');

  const businessUnitId = await insertFixture('sys_business_unit', { name: '原生销售BU ' + runId, code: 'SP-' + runId, kind: 'department', manager_user_id: actor.id, active: true, effective_from: new Date(Date.now() - 60_000).toISOString(), organization_id: organizationId });
  for (const user of [actor, seller]) await insertFixture('sys_business_unit_member', { user_id: user.id, business_unit_id: businessUnitId, organization_id: organizationId, function_in_business_unit: user.id === actor.id ? 'manager' : 'member', is_primary: true, effective_from: new Date(Date.now() - 60_000).toISOString(), effective_to: null });

  const financePosition = await postgres.query("SELECT id FROM sys_position WHERE name='finance_reviewer' AND (organization_id=$1 OR organization_id IS NULL) AND active=true ORDER BY (organization_id=$1) DESC LIMIT 1", [organizationId]);
  assert.ok(financePosition.rows[0]?.id, 'FinanceReviewer uses a loaded active native position');
  const reviewerAssignment = await postgres.query('SELECT id FROM sys_user_position WHERE user_id=$1 AND organization_id=$2 AND position=$3', [reviewer.id, organizationId, 'finance_reviewer']);
  assert.ok(reviewerAssignment.rows.length, 'separate reviewer has a valid organization assignment to the native finance position');
  await ensurePermissionBinding(financePosition.rows[0].id, 'forge_finance_reviewer');

  const customerCategoryId = await insertFixture('forge_customer_category', { name: '业绩验收客户分类', code: 'PCC-' + runId, status: 'active', organization_id: organizationId });
  const customerId = await insertFixture('forge_customer', { name: '业绩隔离客户 ' + runId, category_id: customerCategoryId, status: 'active', responsible_id: seller.id, owner_id: seller.id, organization_id: organizationId });
  const categoryId = await insertFixture('forge_material_category', { name: '业绩验收物料分类', code: 'PC-' + runId, status: 'active', organization_id: organizationId });
  const unitId = await insertFixture('forge_unit', { name: '件', code: 'PU-' + runId, organization_id: organizationId });
  const warehouseTypeId = await insertFixture('forge_warehouse_type', { name: '业绩验收仓型', code: 'PWT-' + runId, status: 'active', organization_id: organizationId });
  const warehouseId = await insertFixture('forge_warehouse', { name: '业绩验收仓库', code: 'PW-' + runId, type_id: warehouseTypeId, responsible_id: actor.id, phone: '', area: 0, address: '隔离测试数据', organization_id: organizationId });
  const materialId = await insertFixture('forge_material', { name: '业绩验收物料', code: 'PM-' + runId, model: 'Performance model', category_id: categoryId, unit_id: unitId, status: 'active', responsible_id: actor.id, organization_id: organizationId });
  const skuId = await insertFixture('forge_material_sku', { name: '业绩验收规格', code: 'PS-' + runId, material_id: materialId, sale_price: 113, cost_price: 60, enabled: true, responsible_id: actor.id, organization_id: organizationId });
  const orderId = await insertFixture('forge_sales_order', { name: '已完成绩效订单', code: 'SO-PERF-' + runId, customer_id: customerId, responsible_id: seller.id, owner_id: seller.id, organization_id: organizationId, status: 'completed', total_amount: 113, recognized_amount: 113, planned_delivery_on: businessDate, payment_term: '验收付款', completion_date: businessDate, completed_at: businessDate + 'T12:00:00.000Z' });
  const orderLineId = await insertFixture('forge_sales_order_line', { name: '已交付物料', order_id: orderId, sku_id: skuId, item_code: 'PS-' + runId, quantity: 1, taxed_unit_price: 113, taxed_subtotal: 113, untaxed_unit_price: 100, tax_rate: 13, organization_id: organizationId });
  const shipmentId = await insertFixture('forge_sales_shipment', { name: '绩效验收发货单', code: 'SH-' + runId, customer_id: customerId, shipment_on: businessDate, recipient: '验收收件人', delivery_address: '隔离测试地址', total_amount: 113, total_quantity: 1, outbound_quantity: 0, outbound_count: 0, status: 'outbounded', responsible_id: seller.id, organization_id: organizationId });
  const outboundId = await insertFixture('forge_sales_outbound', { name: '销售出库', code: 'DN-' + runId, order_id: orderId, shipment_id: shipmentId, warehouse_id: warehouseId, sku_id: skuId, responsible_id: seller.id, organization_id: organizationId, status: 'outbounded', outbound_on: businessDate, quantity: 1, available_quantity: 1, before_on_hand: 1, after_on_hand: 0, inventory_amount: 60, customer_pickup: false });
  const shipmentLineId = await insertFixture('forge_sales_shipment_line', { name: '销售出库明细', shipment_id: shipmentId, order_id: orderId, order_line_id: orderLineId, sku_id: skuId, item_code: 'PS-' + runId, model: 'Performance model', unit_name: '件', quantity: 1, outbound_quantity: 1, taxed_unit_price: 113, taxed_subtotal: 113, organization_id: organizationId });
  await insertFixture('forge_inventory_ledger', { name: '销售出库成本结转', code: 'IL-' + runId, warehouse_id: warehouseId, source_object: 'forge_sales_outbound', source_id: outboundId, source_line_id: shipmentLineId, sku_id: skuId, responsible_id: seller.id, occurred_at: businessDate + 'T12:00:00.000Z', direction: 'outbound', movement_type: 'sales_outbound', quantity: 1, amount: 60, organization_id: organizationId });
  const recognitionId = await insertFixture('forge_revenue_recognition', { name: '已批准收入确认', code: 'RR-' + runId, source_key: 'sales-outbound:' + outboundId, order_id: orderId, customer_id: customerId, responsible_id: seller.id, source_type: 'sales_outbound', source_id: outboundId, outbound_id: outboundId, confirmation_method: 'shipment', status: 'approved', recognition_on: businessDate, financial_period: businessDate.slice(0, 7), net_amount: 113, untaxed_amount: 100, tax_amount: 13, tax_basis: 'source_lines_reconciled', order_amount: 113, cumulative_amount: 113, remaining_amount: 0, invoice_status: 'not_invoiced', maker_id: seller.id, made_at: new Date().toISOString(), organization_id: organizationId });
  await insertFixture('forge_revenue_recognition_line', { name: '可核对收入确认明细', recognition_id: recognitionId, source_object: 'forge_sales_shipment_line', source_id: shipmentLineId, order_id: orderId, order_line_id: orderLineId, sku_id: skuId, item_code: 'PS-' + runId, material_name: '业绩验收物料', quantity: 1, taxed_source_amount: 113, untaxed_amount: 100, tax_amount: 13, tax_rate: 13, tax_basis: 'source_lines_reconciled', organization_id: organizationId });
  await insertFixture('forge_business_setting_option', { name: '同BU协作转记', code: 'PRA-' + runId, scope: 'sales', setting_type: 'performance_allocation_reason', enabled: true, sort_order: 10, organization_id: organizationId });

  const outsideOrderId = await insertFixture('forge_sales_order', { name: 'BU范围外订单', code: 'SO-OUT-' + runId, customer_id: customerId, responsible_id: outsideSeller.id, owner_id: outsideSeller.id, organization_id: organizationId, status: 'completed', total_amount: 226, recognized_amount: 226, planned_delivery_on: businessDate, payment_term: '验收付款' });
  await insertFixture('forge_revenue_recognition', { name: 'BU范围外批准收入', code: 'RR-OUT-' + runId, source_key: 'outside-outbound:' + runId, order_id: outsideOrderId, customer_id: customerId, responsible_id: outsideSeller.id, source_type: 'sales_outbound', source_id: 'outside-outbound-' + runId, confirmation_method: 'shipment', status: 'approved', recognition_on: businessDate, financial_period: businessDate.slice(0, 7), net_amount: 226, untaxed_amount: 200, tax_amount: 26, tax_basis: 'source_lines_reconciled', order_amount: 226, cumulative_amount: 226, remaining_amount: 0, invoice_status: 'not_invoiced', maker_id: outsideSeller.id, made_at: new Date().toISOString(), organization_id: organizationId });

  const pendingCandidates = await actor.request('/actions/forge_sales_performance_entry/sales_performance_workspace_query', 'POST', { params: { scope: 'team', tab: 'confirm', confirm_status: 'pending', period: 'all', year: Number(businessDate.slice(0, 4)), business_date: businessDate, page: 1, page_size: 10 } });
  assert.equal(pendingCandidates.status, 200, 'team-scoped workspace Action reads the approved source DTO: ' + messageOf(pendingCandidates));
  const candidateRows = resultOf(pendingCandidates).rows || [];
  assert.deepEqual(candidateRows.map(row => row.order_id), [orderId], 'only the current BU owner appears; unrelated employee source rows are filtered');
  assert.equal(candidateRows[0].sales_person_id, seller.id);
  const confirmationFilter = await actor.request('/actions/forge_sales_performance_entry/sales_performance_workspace_query', 'POST', { params: {
    scope: 'team', tab: 'confirm', confirm_status: 'pending', period: businessQuarter, year: Number(businessDate.slice(0, 4)), business_date: businessDate,
    sales_person_id: seller.id, confirmation_customer_id: customerId, confirmation_start_on: businessDate, confirmation_end_on: businessDate, page: 1, page_size: 10,
  } });
  assert.equal(confirmationFilter.status, 200, 'confirmation search/person/customer/date/period filters use the controlled WorkspaceQuery Action: ' + messageOf(confirmationFilter));
  const filteredConfirmationRows = resultOf(confirmationFilter).rows || [];
  assert.deepEqual(filteredConfirmationRows.map(row => row.order_id), [orderId], 'pending candidate matches the server-applied business quarter');
  const wrongQuarter = await actor.request('/actions/forge_sales_performance_entry/sales_performance_workspace_query', 'POST', { params: {
    scope: 'team', tab: 'confirm', confirm_status: 'pending', period: outsideQuarter, year: Number(businessDate.slice(0, 4)), business_date: businessDate,
    confirmation_customer_id: customerId, page: 1, page_size: 10,
  } });
  assert.equal(wrongQuarter.status, 200);
  assert.deepEqual((resultOf(wrongQuarter).rows || []).map(row => row.order_id), [], 'pending candidates outside the selected server-side quarter are excluded');
  assert.ok((resultOf(confirmationFilter).customer_options || []).some(customer => customer.id === customerId), 'customer picker options only use the caller-visible candidate sources');
  const noMatchConfirmation = await actor.request('/actions/forge_sales_performance_entry/sales_performance_workspace_query', 'POST', { params: {
    scope: 'team', tab: 'confirm', confirm_status: 'pending', period: 'all', year: Number(businessDate.slice(0, 4)), business_date: businessDate,
    confirmation_customer_id: customerId, confirmation_start_on: '2020-01-01', confirmation_end_on: '2020-01-02', page: 1, page_size: 10,
  } });
  assert.equal(noMatchConfirmation.status, 200);
  assert.deepEqual((resultOf(noMatchConfirmation).rows || []).map(row => row.order_id), [], 'a valid but nonmatching date range is a true empty result');

  const deniedSubmission = await seller.request('/actions/forge_sales_order/sales_performance_confirmation_submit', 'POST', { params: { order_id: orderId, business_date: businessDate, request_key: 'no-cap-' + runId } });
  assert.ok(deniedSubmission.status >= 400, 'employee without confirm and finance-source permissions cannot submit');
  const malformedBusinessDate = await actor.request('/actions/forge_sales_performance_entry/sales_performance_workspace_query', 'POST', { params: { scope: 'all', tab: 'bank', period: 'all', year: Number(businessDate.slice(0, 4)), business_date: '1999-99-99', page: 1, page_size: 10 } });
  assert.ok(malformedBusinessDate.status >= 400, 'workspace refuses client dates outside the required calendar form');

  const confirmationResponse = await actor.request('/actions/forge_sales_order/sales_performance_confirmation_submit', 'POST', { params: { order_id: orderId, business_date: businessDate, request_key: 'confirm-' + runId, remarks: '隔离PG原生业绩确认' } });
  assert.equal(confirmationResponse.status, 200, 'ConfirmationSubmit runs through authenticated QuickJS HTTP: ' + messageOf(confirmationResponse));
  const confirmation = resultOf(confirmationResponse);
  assert.equal(confirmation.status, 'pending_approval');
  assert.equal(Number(confirmation.performance_amount), 100);
  assert.equal(Number(confirmation.gross_profit), 40);
  const pendingEntry = await postgres.query('SELECT status,gross_profit,cost_complete FROM forge_sales_performance_entry WHERE id=$1 AND organization_id=$2', [confirmation.entry_id, organizationId]);
  assert.equal(pendingEntry.rows[0]?.status, 'pending', 'pending performance is not banked before native approval');
  assert.equal(pendingEntry.rows[0]?.gross_profit, null);

  const rebookOptionsResponse = await actor.request('/actions/forge_sales_performance_entry/sales_performance_rebook_options_query', 'POST', { params: { source_entry_id: confirmation.entry_id } });
  assert.equal(rebookOptionsResponse.status, 200, 'Rebook options use same-organization/native-BU scope: ' + messageOf(rebookOptionsResponse));
  assert.ok((resultOf(rebookOptionsResponse).targets || []).some(person => person.id === actor.id), 'same BU manager is a valid transfer target');
  const rebookResponse = await actor.request('/actions/forge_sales_performance_entry/sales_performance_rebook_submit', 'POST', { params: { source_entry_id: confirmation.entry_id, target_person_id: actor.id, ratio: 25, reason_id: resultOf(rebookOptionsResponse).reasons[0].id, request_key: 'rebook-' + runId, remarks: '隔离PG原生Rebook验证' } });
  assert.equal(rebookResponse.status, 200, 'RebookSubmit runs through authenticated QuickJS HTTP: ' + messageOf(rebookResponse));
  const rebook = resultOf(rebookResponse);
  assert.equal(rebook.status, 'pending_approval');
  assert.equal(Number(rebook.amount), 25);

  const rebookApproval = await waitForNativeRequest('forge_sales_performance_rebook', rebook.id);
  const rebookDecision = await reviewer.request('/approvals/requests/' + encodeURIComponent(rebookApproval.id) + '/approve', 'POST', { comment: '原生审批通过，等待原业绩确认' });
  assert.equal(rebookDecision.status, 200, 'official Native Approval REST endpoint approves the Rebook round: ' + messageOf(rebookDecision));
  await waitForRecordStatus('forge_sales_performance_rebook', rebook.id, 'approved_waiting_source');
  const prematureEntries = await postgres.query('SELECT id FROM forge_sales_performance_entry WHERE organization_id=$1 AND rebook_id=$2', [organizationId, rebook.id]);
  assert.equal(prematureEntries.rows.length, 0, 'approved Rebook is not posted before source performance approval');

  const confirmationApproval = await waitForNativeRequest('forge_sales_performance_confirmation', confirmation.id);
  const confirmationDecision = await reviewer.request('/approvals/requests/' + encodeURIComponent(confirmationApproval.id) + '/approve', 'POST', { comment: '收入税基与出库结转成本已核对' });
  assert.equal(confirmationDecision.status, 200, 'official Native Approval REST endpoint approves the performance confirmation: ' + messageOf(confirmationDecision) + (confirmationDecision.status === 200 ? '' : '\n' + safeOutput(runtimeOutput, databaseUrl)));
  await waitForRecordStatus('forge_sales_performance_confirmation', confirmation.id, 'confirmed');
  await waitForRecordStatus('forge_sales_performance_rebook', rebook.id, 'approved');

  const posted = await postgres.query('SELECT entry_type,amount_direction,performance_amount,sales_person_id FROM forge_sales_performance_entry WHERE organization_id=$1 AND rebook_id=$2 ORDER BY entry_type', [organizationId, rebook.id]);
  assert.equal(posted.rows.length, 2, 'native approval posts one debit and one credit entry atomically');
  assert.deepEqual(posted.rows.map(row => row.entry_type).sort(), ['rebook_in', 'rebook_out']);
  assert.ok(posted.rows.every(row => Number(row.performance_amount) === 25), 'both immutable postings retain the same 25 transfer amount');
  assert.equal(posted.rows.reduce((sum, row) => sum + (row.amount_direction === 'increase' ? Number(row.performance_amount) : -Number(row.performance_amount)), 0), 0, 'increase and decrease postings conserve the performance net');
  const original = await postgres.query('SELECT status,gross_profit,cost_complete,rebook_reserved_amount,rebooked_amount FROM forge_sales_performance_entry WHERE id=$1 AND organization_id=$2', [confirmation.entry_id, organizationId]);
  assert.equal(original.rows[0]?.status, 'confirmed');
  assert.equal(Number(original.rows[0]?.gross_profit), 40);
  assert.equal(original.rows[0]?.cost_complete, true);
  assert.equal(Number(original.rows[0]?.rebook_reserved_amount), 0);
  assert.equal(Number(original.rows[0]?.rebooked_amount), 25);

  const confirmedFilter = await actor.request('/actions/forge_sales_performance_entry/sales_performance_workspace_query', 'POST', { params: {
    scope: 'team', tab: 'confirm', confirm_status: 'confirmed', period: businessQuarter, year: Number(businessDate.slice(0, 4)), business_date: businessDate,
    sales_person_id: seller.id, confirmation_customer_id: customerId, confirmation_start_on: businessDate, confirmation_end_on: businessDate, page: 1, page_size: 10,
  } });
  assert.equal(confirmedFilter.status, 200, 'confirmed performance uses the same native source filters');
  assert.deepEqual((resultOf(confirmedFilter).rows || []).map(row => row.order_id), [orderId]);
  assert.equal(resultOf(confirmedFilter).rows[0].business_date, businessDate, 'the confirmation DTO exposes the organization day while preserving its original UTC timestamp');
  assert.match(resultOf(confirmedFilter).rows[0].confirmed_at, /T.*Z$/);
  assert.equal(Object.hasOwn(resultOf(confirmedFilter).rows[0], '__forge_business_dates'), false, 'temporary calendar bridge fields are not part of the public DTO');

  const businessActor = async (scope, tab='bank', extra={}) => actor.request('/actions/forge_sales_performance_entry/sales_performance_workspace_query', 'POST', { params: { scope, tab, period: 'all', year: Number(businessDate.slice(0, 4)), business_date: businessDate, confirm_status: 'confirmed', page: 1, page_size: 20, ...extra } });
  const allScope = resultOf(await businessActor('all', 'bank'));
  const mineScope = resultOf(await businessActor('mine', 'bank'));
  const teamScope = resultOf(await businessActor('team', 'bank'));
  assert.ok((allScope.rows || []).some(row => row.id === confirmation.entry_id), 'all scope includes a current native BU participant');
  assert.equal(allScope.analytics?.trend?.length, 12, 'bank trend is derived from the same authorized source rows as the bank ledger');
  const bankEntry = (allScope.rows || []).find(row => row.id === confirmation.entry_id);
  assert.equal(bankEntry.amount_direction, 'increase');
  assert.equal(Number(bankEntry.gross_profit_rate), 40, 'bank margin comes from the approved source-backed performance entry');
  assert.equal(Number(bankEntry.performance_ratio), 100, 'bank recognition ratio comes from the same immutable entry');
  assert.equal((allScope.rows || []).some(row => row.sales_person_id === outsideSeller.id), false, 'all scope remains capped to current BU members without read-all capability');
  assert.equal((mineScope.rows || []).some(row => row.sales_person_id === seller.id), false, 'mine scope is only the authenticated actor');
  assert.ok((teamScope.rows || []).some(row => row.sales_person_id === seller.id), 'team scope follows current native BU manager/member relations');
  const watchedIds = [{ type: 'record', id: 'record:forge_sales_performance_entry:' + confirmation.entry_id }];
  await insertFixture('sys_user_preference', { user_id: actor.id, key: 'ui.favorites', value: JSON.stringify(watchedIds) });
  const watchedScope = resultOf(await businessActor('watched', 'bank'));
  assert.ok((watchedScope.rows || []).some(row => row.id === confirmation.entry_id), 'watched scope reuses the native record-favorite IDs');

  const entriesResponse = await businessActor('team', 'entries');
  assert.equal(entriesResponse.status, 200, 'ledger tab is read only through the controlled DTO Action');
  assert.equal((resultOf(entriesResponse).rows || []).filter(row => row.entry_type === 'rebook_in' || row.entry_type === 'rebook_out').length, 2);
  const confirmedResponse = await businessActor('team', 'confirm', { confirm_status: 'confirmed' });
  assert.equal(confirmedResponse.status, 200);
  assert.ok((resultOf(confirmedResponse).rows || []).some(row => row.order_id === orderId && row.status === 'confirmed'));
  assert.equal(resultOf(confirmedResponse).target_completion_configured, false, 'unknown performance targets remain explicitly unconfigured');

  const directRead = await seller.request('/data/forge_sales_performance_entry/' + encodeURIComponent(confirmation.entry_id));
  assert.ok(directRead.status >= 400, 'ordinary read-only role cannot use a direct table lookup to bypass the controlled DTO scope');
  const directCreate = await seller.request('/data/forge_sales_performance_rebook', 'POST', { name: '禁止通用API写入', status: 'approved', organization_id: organizationId, responsible_id: seller.id });
  assert.ok(directCreate.status >= 400, 'generic Data API cannot forge a Rebook record or bank posting');
  const outsideScope = await outsideSeller.request('/actions/forge_sales_performance_entry/sales_performance_workspace_query', 'POST', { params: { scope: 'all', tab: 'bank', period: 'all', year: Number(businessDate.slice(0, 4)), business_date: businessDate, page: 1, page_size: 10 } });
  assert.equal(outsideScope.status, 200);
  assert.equal((resultOf(outsideScope).rows || []).length, 0, 'ordinary same-org role receives no other employee ledger without a native BU scope');

  const exportCreatedResponse = await actor.request('/actions/forge_sales_performance_rebook/sales_performance_rebook_export_create', 'POST', { params: { request_key: 'export-' + runId, scope: 'team', period: 'all', business_date: businessDate, year: Number(businessDate.slice(0, 4)), sales_person_id: '', search: '' } });
  assert.equal(exportCreatedResponse.status, 200, 'Rebook export task Action persists a native artifact: ' + messageOf(exportCreatedResponse));
  const exportCreated = resultOf(exportCreatedResponse);
  assert.equal(exportCreated.status, 'completed');
  assert.equal(Number(exportCreated.row_count), 1);
  const downloadResponse = await actor.request('/actions/forge_sales_performance_export_job/sales_performance_export_job_download', 'POST', { params: { job_id: exportCreated.id } });
  assert.equal(downloadResponse.status, 200, 'submitter can download the own export artifact');
  assert.match(String(resultOf(downloadResponse).result_content), /SO-PERF-/);
  const crossActorDownload = await seller.request('/actions/forge_sales_performance_export_job/sales_performance_export_job_download', 'POST', { params: { job_id: exportCreated.id } });
  assert.ok(crossActorDownload.status >= 400, 'another employee cannot read another user export task through the download Action');

  const exportAtRest = await postgres.query('SELECT status,row_count,submitted_by,result_name FROM forge_sales_performance_export_job WHERE id=$1 AND organization_id=$2', [exportCreated.id, organizationId]);
  assert.equal(exportAtRest.rows[0]?.status, 'completed');
  assert.equal(Number(exportAtRest.rows[0]?.row_count), 1);
  assert.equal(exportAtRest.rows[0]?.submitted_by, actor.id);
  const auditActions = await postgres.query("SELECT action,actor_id,step_name,organization_id FROM sys_approval_action WHERE organization_id=$1 AND request_id=ANY($2::text[]) AND action='approve' ORDER BY created_at", [organizationId, [rebookApproval.id, confirmationApproval.id]]);
  assert.deepEqual(auditActions.rows.map(row => row.action).sort(), ['approve', 'approve'], 'final states retain the native actor/decision audit rows');
  assert.ok(auditActions.rows.every(row => row.actor_id === reviewer.id && row.step_name === 'review'));

  const deniedDateWithoutOrganization = await fetch(origin + '/api/v1/actions/global/organization_business_date_query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ params: {} }) });
  assert.ok(deniedDateWithoutOrganization.status >= 400, 'global date resolver requires an authenticated same-org session');
});
