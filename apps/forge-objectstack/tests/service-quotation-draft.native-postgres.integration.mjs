import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';
import test from 'node:test';
import { ServiceQuotationDraftReceipt } from '../src/objects/service-quotation-receipt.object.ts';
import { ServiceSettlement } from '../src/objects/sales.object.ts';
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
  assert.equal(ServiceSettlement.fields.code.type, 'autonumber');
  assert.equal(ServiceSettlement.fields.code.autonumberFormat, 'SS-{YYYYMMDD}-{0000}');
  assert.equal(ServiceSettlement.fields.code.unique, 'organization', 'the settlement business number preserves its original per-organization uniqueness contract');

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'forge-service-quotation-draft-pg-'));
  const databaseUrl = `postgresql://${encodeURIComponent(os.userInfo().username)}@127.0.0.1:${PG_PORT}/${DATABASE}`;
  let databaseCreated = false, postgres, child, runtimeOutput = '', rejectTrigger = '', rejectFunction = '';
  let quoteUpdateProbeTrigger = '', quoteUpdateProbeFunction = '', quoteUpdateProbeSequence = '';
  let quoteUpdateRowProbeTrigger = '', quoteUpdateRowProbeFunction = '', quoteUpdateRowProbeSequence = '';
  let receiptInsertProbeTrigger = '', receiptInsertProbeFunction = '', receiptInsertProbeSequence = '';
  let settlementRejectTrigger = '', settlementRejectFunction = '';
  let lineRejectTrigger = '', lineRejectFunction = '';
  const multilineLineMutationProbes = [];
  const callers = [];
  const quoteIds = {};
  t.after(async () => {
    if (postgres && rejectTrigger) await postgres.query(`DROP TRIGGER IF EXISTS "${rejectTrigger}" ON forge_service_quotation_draft_receipt`).catch(() => {});
    if (postgres && rejectFunction) await postgres.query(`DROP FUNCTION IF EXISTS "${rejectFunction}"()`).catch(() => {});
    if (postgres && quoteUpdateProbeTrigger) await postgres.query(`DROP TRIGGER IF EXISTS "${quoteUpdateProbeTrigger}" ON forge_service_quotation`).catch(() => {});
    if (postgres && quoteUpdateRowProbeTrigger) await postgres.query(`DROP TRIGGER IF EXISTS "${quoteUpdateRowProbeTrigger}" ON forge_service_quotation`).catch(() => {});
    if (postgres && receiptInsertProbeTrigger) await postgres.query(`DROP TRIGGER IF EXISTS "${receiptInsertProbeTrigger}" ON forge_service_quotation_draft_receipt`).catch(() => {});
    if (postgres && quoteUpdateProbeFunction) await postgres.query(`DROP FUNCTION IF EXISTS "${quoteUpdateProbeFunction}"()`).catch(() => {});
    if (postgres && quoteUpdateRowProbeFunction) await postgres.query(`DROP FUNCTION IF EXISTS "${quoteUpdateRowProbeFunction}"()`).catch(() => {});
    if (postgres && receiptInsertProbeFunction) await postgres.query(`DROP FUNCTION IF EXISTS "${receiptInsertProbeFunction}"()`).catch(() => {});
    if (postgres && quoteUpdateProbeSequence) await postgres.query(`DROP SEQUENCE IF EXISTS "${quoteUpdateProbeSequence}"`).catch(() => {});
    if (postgres && quoteUpdateRowProbeSequence) await postgres.query(`DROP SEQUENCE IF EXISTS "${quoteUpdateRowProbeSequence}"`).catch(() => {});
    if (postgres && receiptInsertProbeSequence) await postgres.query(`DROP SEQUENCE IF EXISTS "${receiptInsertProbeSequence}"`).catch(() => {});
    if (postgres && settlementRejectTrigger) await postgres.query(`DROP TRIGGER IF EXISTS "${settlementRejectTrigger}" ON forge_service_settlement`).catch(() => {});
    if (postgres && settlementRejectFunction) await postgres.query(`DROP FUNCTION IF EXISTS "${settlementRejectFunction}"()`).catch(() => {});
    if (postgres && lineRejectTrigger) await postgres.query(`DROP TRIGGER IF EXISTS "${lineRejectTrigger}" ON forge_service_quotation_line`).catch(() => {});
    if (postgres && lineRejectFunction) await postgres.query(`DROP FUNCTION IF EXISTS "${lineRejectFunction}"()`).catch(() => {});
    for (const probe of multilineLineMutationProbes) {
      await postgres?.query(`DROP TRIGGER IF EXISTS "${probe.trigger}" ON forge_service_quotation_line`).catch(() => {});
      await postgres?.query(`DROP FUNCTION IF EXISTS "${probe.fn}"()`).catch(() => {});
      await postgres?.query(`DROP SEQUENCE IF EXISTS "${probe.sequence}"`).catch(() => {});
    }
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
  await cp(path.join(APP_DIR, 'src'), path.join(tempDir, 'src'), { recursive: true });
  await cp(path.join(APP_DIR, 'objectstack.config.ts'), path.join(tempDir, 'objectstack.config.ts'));
  await symlink(path.join(APP_DIR, 'node_modules'), path.join(tempDir, 'node_modules'), 'dir');
  if (process.env.SERVICE_QUOTATION_MULTILINE_NATIVE_DIAGNOSTICS === '1') {
    const actionCopy = path.join(tempDir, 'src/actions/service-quotation-multiline.source.ts');
    const original = await readFile(actionCopy, 'utf8');
    const replacements = [
      [
        "if(!keptIds.has(String(old.id)))await linesApi.delete({where:{id:old.id,quotation_id:id,organization_id:organizationId}});",
        "if(!keptIds.has(String(old.id))){try{await linesApi.delete({where:{id:old.id,quotation_id:id,organization_id:organizationId}})}catch(error){throw new Error('TEST_PROBE_DELETE:'+String(error&&error.message||error))}}",
      ],
      [
        "else{const moved=await linesApi.update({sort_order:temporaryOrder++},{multi:true,where:{id:old.id,quotation_id:id,organization_id:organizationId}});if(moved!==1)throw new Error('报价项目已变化，请重新打开核对')}",
        "else{try{const moved=await linesApi.update({sort_order:temporaryOrder++},{multi:true,where:{id:old.id,quotation_id:id,organization_id:organizationId}});if(moved!==1)throw new Error('update count '+String(moved))}catch(error){throw new Error('TEST_PROBE_REORDER:'+String(error&&error.message||error))}}",
      ],
      [
        "if(rowId){const changedLine=await linesApi.update(row,{multi:true,where:{id:rowId,quotation_id:id,organization_id:organizationId}});if(changedLine!==1)throw new Error('报价项目已变化，请重新打开核对')}\n      else await linesApi.insert(row);",
        "if(rowId){try{const changedLine=await linesApi.update(row,{multi:true,where:{id:rowId,quotation_id:id,organization_id:organizationId}});if(changedLine!==1)throw new Error('update count '+String(changedLine))}catch(error){throw new Error('TEST_PROBE_UPDATE:'+String(error&&error.message||error))}}\n      else{try{await linesApi.insert(row)}catch(error){throw new Error('TEST_PROBE_INSERT:'+String(error&&error.message||error))}}",
      ],
      [
        "const text=String(error&&error.message||'');\n    const safe=",
        "const text=String(error&&error.message||'');\n    if(text.startsWith('TEST_PROBE_'))throw new Error(text);\n    const safe=",
      ],
    ];
    let instrumented = original;
    for (const [before, after] of replacements) {
      if (!instrumented.includes(before)) throw new Error('test-only Native diagnostic patch point not found');
      instrumented = instrumented.replace(before, after);
    }
    await writeFile(actionCopy, instrumented);
  }
  if (process.env.SERVICE_QUOTATION_SETTLEMENT_FIXED_CLOCK === '1') {
    const salesActionCopy = path.join(tempDir, 'src/actions/sales.action.ts');
    let source = await readFile(salesActionCopy, 'utf8');
    const actionStart = source.indexOf('export const ServiceQuotationCreateSettlement');
    const timeCode = "const code = 'SS-' + new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);";
    const timeCodeIndex = actionStart < 0 ? -1 : source.indexOf(timeCode, actionStart);
    if (timeCodeIndex >= 0) {
      const fixedTimeCode = "const code = 'SS-' + new Date('2026-10-06T12:34:56.000Z').toISOString().replace(/[-:TZ.]/g,'').slice(0,14);";
      source = source.slice(0, timeCodeIndex) + fixedTimeCode + source.slice(timeCodeIndex + timeCode.length);
      await writeFile(salesActionCopy, source);
    }
  }

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
  async function createPosition(name, permissionName, organizationId = ORGANIZATION_ID) {
    const found = await postgres.query('SELECT id FROM sys_position WHERE name=$1 AND organization_id=$2 ORDER BY id LIMIT 1', [name, organizationId]);
    const positionId = found.rows[0]?.id || await insertFixture('sys_position', {
      name, label: '隔离报价测试岗位 ' + name, active: true, organization_id: organizationId,
    });
    if (found.rows.length) await postgres.query('UPDATE sys_position SET active=true WHERE id=$1', [positionId]);
    const permission = await postgres.query('SELECT id FROM sys_permission_set WHERE name=$1 AND active=true ORDER BY id LIMIT 1', [permissionName]);
    assert.ok(permission.rows[0]?.id, 'the official Runtime loaded the existing permission set');
    const bound = await postgres.query('SELECT 1 FROM sys_position_permission_set WHERE position_id=$1 AND permission_set_id=$2 LIMIT 1', [positionId, permission.rows[0].id]);
    if (!bound.rows.length) await insertFixture('sys_position_permission_set', {
      position_id: positionId, permission_set_id: permission.rows[0].id, organization_id: organizationId,
    });
    return positionId;
  }
  async function createCaller(label, permissionName = '', organizationId = ORGANIZATION_ID) {
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
    await insertFixture('sys_member', { user_id: callerId, organization_id: organizationId, role: 'member' });
    if (permissionName) {
      const position = await createPosition('service_quote_' + permissionName + '_' + RUN, permissionName, organizationId);
      await insertFixture('sys_user_position', {
        user_id: callerId, position: 'service_quote_' + permissionName + '_' + RUN,
        organization_id: organizationId, valid_from: new Date(Date.now() - 60_000).toISOString(), valid_until: null,
      });
      return { id: callerId, email, password, position, organizationId, client: null };
    }
    return { id: callerId, email, password, position: '', organizationId, client: null };
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
    const selected = await caller.client.request('/auth/organization/set-active', 'POST', { organizationId: caller.organizationId });
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
      pricing_mode: 'estimated',
      payment_mode: 'full_prepayment',
      discount_rate: 0,
      subtotal: 0,
      discount_amount: 0,
      item_count: 0,
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
  async function quoteMultilineSnapshot(quoteId) {
    const result = await postgres.query('SELECT id,status,total_amount,valid_until::text AS valid_until,remarks,revision,pricing_mode,payment_mode,discount_rate,subtotal,discount_amount,item_count FROM forge_service_quotation WHERE id=$1', [quoteId]);
    const row = result.rows[0];
    return row ? {
      id: String(row.id), status: String(row.status), total_amount: Number(row.total_amount),
      valid_until: String(row.valid_until).slice(0, 10), remarks: row.remarks == null ? null : String(row.remarks),
      revision: Number(row.revision), pricing_mode: String(row.pricing_mode), payment_mode: String(row.payment_mode),
      discount_rate: Number(row.discount_rate), subtotal: Number(row.subtotal), discount_amount: Number(row.discount_amount), item_count: Number(row.item_count),
    } : null;
  }
  async function lineRows(quoteId) {
    const result = await postgres.query(
      'SELECT id,quotation_id,line_type,service_item_id,sku_id,item_code,name,description,unit_name,quantity,taxed_unit_price,line_amount,sort_order,organization_id,created_at::text AS created_at,updated_at::text AS updated_at FROM forge_service_quotation_line WHERE quotation_id=$1 ORDER BY sort_order,id',
      [quoteId],
    );
    return result.rows.map(row => ({
      id: String(row.id), quotation_id: String(row.quotation_id), line_type: String(row.line_type),
      service_item_id: row.service_item_id == null ? null : String(row.service_item_id),
      sku_id: row.sku_id == null ? null : String(row.sku_id), item_code: String(row.item_code), name: String(row.name),
      description: row.description == null ? '' : String(row.description), unit_name: String(row.unit_name),
      quantity: Number(row.quantity), taxed_unit_price: Number(row.taxed_unit_price), line_amount: Number(row.line_amount),
      sort_order: Number(row.sort_order), organization_id: String(row.organization_id), updated_at: String(row.updated_at),
    }));
  }
  function multilineDraft(lines, values = {}) {
    return {
      valid_until: '2026-12-31', remarks: '多行报价备注', pricing_mode: 'estimated', payment_mode: 'full_prepayment',
      discount_rate: 12.5, lines, ...values,
    };
  }
  function serviceLine(itemId, values = {}) {
    return { line_type: 'service', item_id: itemId, description: '服务说明', unit_name: '次', quantity: '1.00', taxed_unit_price: '20.00', ...values };
  }
  function partLine(itemId, values = {}) {
    return { line_type: 'part', item_id: itemId, description: '备件说明', unit_name: '件', quantity: '1.00', taxed_unit_price: '50.00', ...values };
  }
  async function saveMultiline(client, quoteId, expectedRevision, key, lines, values = {}) {
    return invoke(client, quoteId, {
      draft_json: JSON.stringify(multilineDraft(lines, values)), expected_revision: expectedRevision, idempotency_key: key,
    });
  }
  async function readLinesAction(client, quoteId) {
    return client.request('/actions/forge_service_quotation/service_quotation_read_lines/' + encodeURIComponent(quoteId), 'POST', { params: {} });
  }
  async function receiptRows(quoteId) {
    const result = await postgres.query('SELECT expected_revision,resulting_revision,idempotency_key,actor_id,request_signature,result_json FROM forge_service_quotation_draft_receipt WHERE quotation_id=$1 ORDER BY expected_revision,idempotency_key', [quoteId]);
    return result.rows;
  }
  async function settlementRows(quoteId) {
    const result = await postgres.query('SELECT id,code,status,total_amount,quotation_pricing_mode,quotation_payment_mode,organization_id FROM forge_service_settlement WHERE quotation_id=$1 ORDER BY id', [quoteId]);
    return result.rows;
  }
  async function settlementCounters() {
    if (!(await postgres.query("SELECT to_regclass('_objectstack_sequences') AS relation")).rows[0]?.relation) return [];
    const result = await postgres.query('SELECT tenant_id,scope,last_value FROM _objectstack_sequences WHERE object=$1 AND field=$2 AND tenant_id=ANY($3::text[]) ORDER BY tenant_id,scope', ['forge_service_settlement', 'code', [ORGANIZATION_ID, FOREIGN_ORGANIZATION_ID]]);
    return result.rows.map(row => ({ organization_id: String(row.tenant_id), prefix: String(row.scope), value: Number(row.last_value) }));
  }
  async function settlementNumberBaseline() {
    const counters = await settlementCounters();
    const result = await postgres.query('SELECT code,organization_id FROM forge_service_settlement WHERE organization_id=ANY($1::text[])', [[ORGANIZATION_ID, FOREIGN_ORGANIZATION_ID]]);
    return { counters, rows: result.rows };
  }
  function priorSettlementCounter(baseline, organizationId, prefix) {
    const storedValues = baseline.rows
      .filter(row => String(row.organization_id) === organizationId && String(row.code).startsWith(prefix))
      .map(row => String(row.code).slice(prefix.length))
      .filter(value => /^\d+$/.test(value))
      .map(Number);
    return Math.max(0, ...baseline.counters.filter(row => row.organization_id === organizationId && row.prefix === prefix).map(row => row.value), ...storedValues);
  }
  function safeSettlementMessage(response) {
    return messageOf(response).replace(/SS-[A-Za-z0-9-]+/g, '[masked settlement code]');
  }
  async function assertRejected(response, label) {
    assert.ok(response.status >= 400 && response.status < 500, label + ' is rejected by the official Runtime with a client error');
  }
  async function installWriteBoundaryProbes() {
    quoteUpdateProbeSequence = 'seq_sq_draft_update_' + RUN;
    quoteUpdateProbeFunction = 'fn_sq_draft_update_' + RUN;
    quoteUpdateProbeTrigger = 'trg_sq_draft_update_' + RUN;
    quoteUpdateRowProbeSequence = 'seq_sq_draft_updated_row_' + RUN;
    quoteUpdateRowProbeFunction = 'fn_sq_draft_updated_row_' + RUN;
    quoteUpdateRowProbeTrigger = 'trg_sq_draft_updated_row_' + RUN;
    receiptInsertProbeSequence = 'seq_sq_receipt_insert_' + RUN;
    receiptInsertProbeFunction = 'fn_sq_receipt_insert_' + RUN;
    receiptInsertProbeTrigger = 'trg_sq_receipt_insert_' + RUN;
    await postgres.query(`CREATE SEQUENCE "${quoteUpdateProbeSequence}" AS bigint START WITH 1`);
    await postgres.query(`CREATE SEQUENCE "${quoteUpdateRowProbeSequence}" AS bigint START WITH 1`);
    await postgres.query(`CREATE SEQUENCE "${receiptInsertProbeSequence}" AS bigint START WITH 1`);
    await postgres.query(`CREATE FUNCTION "${quoteUpdateProbeFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('${quoteUpdateProbeSequence}'); RETURN NEW; END $$`);
    await postgres.query(`CREATE FUNCTION "${quoteUpdateRowProbeFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('${quoteUpdateRowProbeSequence}'); RETURN NEW; END $$`);
    await postgres.query(`CREATE FUNCTION "${receiptInsertProbeFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('${receiptInsertProbeSequence}'); RETURN NEW; END $$`);
    await postgres.query(`CREATE TRIGGER "${quoteUpdateProbeTrigger}" BEFORE UPDATE ON forge_service_quotation FOR EACH STATEMENT EXECUTE FUNCTION "${quoteUpdateProbeFunction}"()`);
    await postgres.query(`CREATE TRIGGER "${quoteUpdateRowProbeTrigger}" AFTER UPDATE ON forge_service_quotation FOR EACH ROW EXECUTE FUNCTION "${quoteUpdateRowProbeFunction}"()`);
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
  async function installMultilineLineMutationProbes() {
    for (const operation of ['delete', 'update', 'insert']) {
      const probe = {
        sequence: 'seq_sq_line_' + operation + '_' + RUN,
        fn: 'fn_sq_line_' + operation + '_' + RUN,
        trigger: 'trg_sq_line_' + operation + '_' + RUN,
        operation: operation.toUpperCase(),
      };
      await postgres.query(`CREATE SEQUENCE "${probe.sequence}" AS bigint START WITH 1`);
      await postgres.query(`CREATE FUNCTION "${probe.fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('${probe.sequence}'); RETURN NULL; END $$`);
      await postgres.query(`CREATE TRIGGER "${probe.trigger}" BEFORE ${probe.operation} ON forge_service_quotation_line FOR EACH STATEMENT EXECUTE FUNCTION "${probe.fn}"()`);
      multilineLineMutationProbes.push(probe);
    }
    await postgres.query(`ALTER SEQUENCE "${quoteUpdateProbeSequence}" RESTART WITH 1`);
    await postgres.query(`ALTER SEQUENCE "${quoteUpdateRowProbeSequence}" RESTART WITH 1`);
    await postgres.query(`ALTER SEQUENCE "${receiptInsertProbeSequence}" RESTART WITH 1`);
  }
  async function multilineMutationDiagnostics(quoteId) {
    const quoteProbe = await postgres.query(`SELECT is_called FROM "${quoteUpdateProbeSequence}"`);
    const quoteRowsProbe = await postgres.query(`SELECT is_called FROM "${quoteUpdateRowProbeSequence}"`);
    const receiptProbe = await postgres.query(`SELECT is_called FROM "${receiptInsertProbeSequence}"`);
    const quote = await quoteMultilineSnapshot(quoteId);
    const childCount = await postgres.query('SELECT count(*)::int AS count FROM forge_service_quotation_line WHERE quotation_id=$1', [quoteId]);
    const mutations = {};
    for (const probe of multilineLineMutationProbes) {
      const result = await postgres.query(`SELECT is_called FROM "${probe.sequence}"`);
      mutations[probe.operation.toLowerCase()] = Boolean(result.rows[0]?.is_called);
    }
    return JSON.stringify({
      quoteUpdateReached: Boolean(quoteProbe.rows[0]?.is_called), receiptInsertReached: Boolean(receiptProbe.rows[0]?.is_called),
      quoteRowsActuallyUpdated: Boolean(quoteRowsProbe.rows[0]?.is_called),
      lineStatements: mutations,
      parentAfter: quote && { status: quote.status, revision: quote.revision, item_count: quote.item_count, subtotal: quote.subtotal, total_amount: quote.total_amount },
      childRows: childCount.rows[0]?.count || 0,
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
  await insertFixture('sys_organization', { id: FOREIGN_ORGANIZATION_ID, name: '服务报价第二隔离组织 ' + RUN, slug: 'service-quotation-foreign-' + RUN });
  const manager = await createCaller('主管', serviceManagerPermission.name);
  const operator = await createCaller('无管理权限服务员工', serviceOperatorPermission.name);
  const foreignManager = await createCaller('第二组织主管', serviceManagerPermission.name, FOREIGN_ORGANIZATION_ID);
  assert.equal((await postgres.query('SELECT count(*)::int AS count FROM sys_account WHERE user_id=ANY($1::text[])', [[manager.id, operator.id, foreignManager.id]])).rows[0]?.count, 3);

  quoteIds.success = await createQuote('SUCCESS', { ownerId: manager.id });
  quoteIds.nonDraft = await createQuote('NONDRAFT', { status: 'confirmed', ownerId: manager.id });
  quoteIds.unprivileged = await createQuote('NOPERM', { ownerId: operator.id });
  quoteIds.foreign = await createQuote('FOREIGN', { ownerId: manager.id, organizationId: FOREIGN_ORGANIZATION_ID });
  quoteIds.rollback = await createQuote('ROLLBACK', { ownerId: manager.id });
  quoteIds.sameRace = await createQuote('SAMERACE', { ownerId: manager.id });
  quoteIds.keyRace = await createQuote('KEYRACE', { ownerId: manager.id });
  quoteIds.settlementRollback = await createQuote('SETTLEMENTROLLBACK', { status: 'confirmed', revision: 3, ownerId: manager.id });
  quoteIds.multiline = await createQuote('MULTILINE', { ownerId: manager.id });
  quoteIds.multilineInvalid = await createQuote('MULTILINEINVALID', { ownerId: manager.id });
  quoteIds.multilineOther = await createQuote('MULTILINEOTHER', { ownerId: manager.id });
  quoteIds.multilineLineRollback = await createQuote('MULTILINELINEROLLBACK', { ownerId: manager.id });
  quoteIds.multilineReceiptRollback = await createQuote('MULTILINERECEIPTROLLBACK', { ownerId: manager.id });
  quoteIds.settlementRaceA = await createQuote('SETTLEMENTRACEA', { status: 'confirmed', revision: 3, ownerId: manager.id });
  quoteIds.settlementRaceB = await createQuote('SETTLEMENTRACEB', { status: 'confirmed', revision: 3, ownerId: manager.id });
  quoteIds.foreignSettlementRaceA = await createQuote('FOREIGNSETTLEMENTRACEA', { status: 'confirmed', revision: 3, ownerId: foreignManager.id, organizationId: FOREIGN_ORGANIZATION_ID });
  quoteIds.foreignSettlementRaceB = await createQuote('FOREIGNSETTLEMENTRACEB', { status: 'confirmed', revision: 3, ownerId: foreignManager.id, organizationId: FOREIGN_ORGANIZATION_ID });

  const feeConfigId = await insertFixture('forge_service_config_item', {
    name: '隔离上门检测项目 ' + RUN, code: 'SQ-FEE-' + RUN, category: 'fee_type', status: 'active',
    description: '真实费用目录项', remarks: '', revision: 1, owner_id: manager.id,
  }, ORGANIZATION_ID);
  const inactiveFeeConfigId = await insertFixture('forge_service_config_item', {
    name: '停用费用项目 ' + RUN, code: 'SQ-FEE-STOP-' + RUN, category: 'fee_type', status: 'inactive',
    description: 'inactive fixture', remarks: '', revision: 1, owner_id: manager.id,
  }, ORGANIZATION_ID);
  const wrongCategoryConfigId = await insertFixture('forge_service_config_item', {
    name: '其他服务配置 ' + RUN, code: 'SQ-FEE-CAT-' + RUN, category: 'order_type', status: 'active',
    description: 'wrong category fixture', remarks: '', revision: 1, owner_id: manager.id,
  }, ORGANIZATION_ID);
  const foreignFeeConfigId = await insertFixture('forge_service_config_item', {
    name: '外组织费用项目 ' + RUN, code: 'SQ-FEE-FOREIGN-' + RUN, category: 'fee_type', status: 'active',
    description: 'foreign fixture', remarks: '', revision: 1, owner_id: manager.id, organization_id: FOREIGN_ORGANIZATION_ID,
  }, '');
  const materialCategoryId = await insertFixture('forge_material_category', {
    name: '报价PG备件分类 ' + RUN, code: 'SQ-MAT-CAT-' + RUN, status: 'active',
  }, ORGANIZATION_ID);
  const unitId = await insertFixture('forge_unit', { name: '件-' + RUN, code: 'SQ-UNIT-' + RUN, status: 'active' }, ORGANIZATION_ID);
  const spareMaterialId = await insertFixture('forge_material', {
    name: '报价PG备件 ' + RUN, code: 'SQ-MAT-' + RUN, model: 'SQ-MODEL-' + RUN, category_id: materialCategoryId,
    unit_id: unitId, property: 'spare', source_type: 'purchased', status: 'active', owner_id: manager.id, responsible_id: manager.id,
  }, ORGANIZATION_ID);
  const activeSkuId = await insertFixture('forge_material_sku', {
    name: '规格A-' + RUN, code: 'SQ-SKU-' + RUN, material_id: spareMaterialId,
    sale_price: 999.99, cost_price: 321.12, enabled: true, owner_id: manager.id,
  }, ORGANIZATION_ID);
  const disabledSkuId = await insertFixture('forge_material_sku', {
    name: '停用规格-' + RUN, code: 'SQ-SKU-DISABLED-' + RUN, material_id: spareMaterialId,
    sale_price: 1, cost_price: 0.5, enabled: false, owner_id: manager.id,
  }, ORGANIZATION_ID);
  const inactiveMaterialId = await insertFixture('forge_material', {
    name: '停用报价PG备件 ' + RUN, code: 'SQ-MAT-INACTIVE-' + RUN, model: 'SQ-MODEL-INACTIVE-' + RUN,
    category_id: materialCategoryId, unit_id: unitId, property: 'spare', source_type: 'purchased', status: 'inactive',
    owner_id: manager.id, responsible_id: manager.id,
  }, ORGANIZATION_ID);
  const inactiveMaterialSkuId = await insertFixture('forge_material_sku', {
    name: '物料停用规格-' + RUN, code: 'SQ-SKU-MAT-INACTIVE-' + RUN, material_id: inactiveMaterialId,
    sale_price: 1, cost_price: 0.5, enabled: true, owner_id: manager.id,
  }, ORGANIZATION_ID);
  const foreignCategoryId = await insertFixture('forge_material_category', {
    name: '外组织报价分类 ' + RUN, code: 'SQ-MAT-CAT-FOREIGN-' + RUN, status: 'active',
  }, FOREIGN_ORGANIZATION_ID);
  const foreignUnitId = await insertFixture('forge_unit', { name: '外组织件-' + RUN, code: 'SQ-UNIT-FOREIGN-' + RUN, status: 'active' }, FOREIGN_ORGANIZATION_ID);
  const foreignMaterialId = await insertFixture('forge_material', {
    name: '外组织报价备件 ' + RUN, code: 'SQ-MAT-FOREIGN-' + RUN, model: 'SQ-MODEL-FOREIGN-' + RUN,
    category_id: foreignCategoryId, unit_id: foreignUnitId, property: 'spare', source_type: 'purchased', status: 'active',
    owner_id: manager.id, responsible_id: manager.id,
  }, FOREIGN_ORGANIZATION_ID);
  const foreignSkuId = await insertFixture('forge_material_sku', {
    name: '外组织规格-' + RUN, code: 'SQ-SKU-FOREIGN-' + RUN, material_id: foreignMaterialId,
    sale_price: 1, cost_price: 0.5, enabled: true, owner_id: manager.id,
  }, FOREIGN_ORGANIZATION_ID);
  const homeSkuForeignMaterialId = await insertFixture('forge_material_sku', {
    name: '本组织SKU外组织物料-' + RUN, code: 'SQ-SKU-CROSS-MATERIAL-' + RUN, material_id: foreignMaterialId,
    sale_price: 1, cost_price: 0.5, enabled: true, owner_id: manager.id,
  }, ORGANIZATION_ID);

  await startRuntime();
  const managerClient = await signIn(manager);
  const operatorClient = await signIn(operator);
  const foreignManagerClient = await signIn(foreignManager);
  if(process.env.FORGE_SALES_PRICING_NATIVE_ONLY==='1'){await exerciseNativeSalesPricing();console.log('PASS isolated official Runtime PostgreSQL native sales pricing, discount and fee approvals');return;}
  const managerPermissions = payloadOf(await managerClient.request('/auth/me/permissions'));
  assert.ok(managerPermissions.systemPermissions?.includes('forge_service_manager'));
  assert.equal(managerPermissions.systemPermissions?.includes('setup.write'), false);
  const foreignManagerPermissions = payloadOf(await foreignManagerClient.request('/auth/me/permissions'));
  assert.ok(foreignManagerPermissions.systemPermissions?.includes('forge_service_manager'), 'the second organization uses the same existing service-manager permission');
  assert.equal(foreignManagerPermissions.systemPermissions?.includes('setup.write'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(serviceManagerPermission.objects || {}, 'forge_service_quotation_line'), false, 'no generic service-manager permission was added for quotation-line CRUD');
  const operatorPermissions = payloadOf(await operatorClient.request('/auth/me/permissions'));
  assert.ok(operatorPermissions.systemPermissions?.includes('forge_service_operator'));
  assert.equal(operatorPermissions.systemPermissions?.includes('forge_service_manager'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(serviceOperatorPermission.objects || {}, 'forge_service_quotation_line'), false, 'the ordinary service-operator permission has no quotation-line grant');

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

  const initialMultiLines = [
    serviceLine(feeConfigId, { description: '校准及上门检测', unit_name: '小时', quantity: '1.25', taxed_unit_price: '99.99' }),
    partLine(activeSkuId, { description: '客户确认的备件规格', unit_name: '件', quantity: '1.00', taxed_unit_price: '50.00' }),
  ];
  const initialMultiValues = { remarks: '服务与备件明细', discount_rate: 12.5, pricing_mode: 'estimated', payment_mode: 'full_prepayment' };
  const initialMultiParams = {
    draft_json: JSON.stringify(multilineDraft(initialMultiLines, initialMultiValues)),
    expected_revision: 1, idempotency_key: 'multiline-save-' + RUN,
  };
  const multilineSave = await invoke(managerClient, quoteIds.multiline, initialMultiParams);
  assert.equal(multilineSave.status, 200, 'manager saves service and spare lines through the guarded Action: ' + messageOf(multilineSave));
  assert.deepEqual(resultOf(multilineSave), {
    id: quoteIds.multiline, code: 'SQD-' + RUN + '-MULTILINE', status: 'draft', revision: 2,
    valid_until: '2026-12-31', remarks: '服务与备件明细', pricing_mode: 'estimated', payment_mode: 'full_prepayment',
    discount_rate: 12.5, subtotal: 174.99, discount_amount: 21.87, total_amount: 153.12, item_count: 2, repeated: false,
  }, 'line amounts round to cents before the one-decimal whole-quote discount');
  const firstMultiRows = await lineRows(quoteIds.multiline);
  assert.equal(firstMultiRows.length, 2);
  assert.deepEqual(firstMultiRows.map(row => ({
    line_type: row.line_type, service_item_id: row.service_item_id, sku_id: row.sku_id,
    item_code: row.item_code, name: row.name, description: row.description, unit_name: row.unit_name,
    quantity: row.quantity, taxed_unit_price: row.taxed_unit_price, line_amount: row.line_amount, sort_order: row.sort_order,
  })), [
    {
      line_type: 'service', service_item_id: feeConfigId, sku_id: null, item_code: 'SQ-FEE-' + RUN,
      name: '隔离上门检测项目 ' + RUN, description: '校准及上门检测', unit_name: '小时', quantity: 1.25,
      taxed_unit_price: 99.99, line_amount: 124.99, sort_order: 0,
    },
    {
      line_type: 'part', service_item_id: null, sku_id: activeSkuId, item_code: 'SQ-SKU-' + RUN,
      name: '报价PG备件 ' + RUN + ' / 规格A-' + RUN, description: '客户确认的备件规格', unit_name: '件', quantity: 1,
      taxed_unit_price: 50, line_amount: 50, sort_order: 1,
    },
  ]);
  assert.deepEqual(await quoteMultilineSnapshot(quoteIds.multiline), {
    id: quoteIds.multiline, status: 'draft', total_amount: 153.12, valid_until: '2026-12-31', remarks: '服务与备件明细',
    revision: 2, pricing_mode: 'estimated', payment_mode: 'full_prepayment', discount_rate: 12.5,
    subtotal: 174.99, discount_amount: 21.87, item_count: 2,
  });
  const actorReadLines = await readLinesAction(managerClient, quoteIds.multiline);
  assert.equal(actorReadLines.status, 200, 'the authorized service manager reads child rows through the parent-scoped native Action');
  const actorLinePayload = resultOf(actorReadLines);
  assert.equal(actorLinePayload?.quotation_id, quoteIds.multiline);
  assert.equal(actorLinePayload?.revision, 2);
  assert.equal(actorLinePayload?.subtotal, 174.99);
  assert.equal(actorLinePayload?.discount_amount, 21.87);
  assert.equal(actorLinePayload?.total_amount, 153.12);
  assert.deepEqual(actorLinePayload?.lines?.map(row => ({
    line_type: row.line_type, item_id: row.item_id, name: row.name, item_code: row.item_code,
    quantity: Number(row.quantity), taxed_unit_price: Number(row.taxed_unit_price), line_amount: Number(row.line_amount), sort_order: Number(row.sort_order),
  })), [
    { line_type: 'service', item_id: feeConfigId, name: '隔离上门检测项目 ' + RUN, item_code: 'SQ-FEE-' + RUN, quantity: 1.25, taxed_unit_price: 99.99, line_amount: 124.99, sort_order: 0 },
    { line_type: 'part', item_id: activeSkuId, name: '报价PG备件 ' + RUN + ' / 规格A-' + RUN, item_code: 'SQ-SKU-' + RUN, quantity: 1, taxed_unit_price: 50, line_amount: 50, sort_order: 1 },
  ]);
  assert.equal(Object.keys(actorLinePayload.lines[0]).some(key => /cost|sale_price|inventory/i.test(key)), false, 'read DTO contains no cost, catalog price, or inventory fields');
  const afterInitialMultiSave = await lineRows(quoteIds.multiline);
  const sameMultiKeyReplay = await invoke(managerClient, quoteIds.multiline, initialMultiParams);
  assert.equal(sameMultiKeyReplay.status, 200, 'same multiline idempotency key replays the prior result');
  assert.equal(resultOf(sameMultiKeyReplay)?.repeated, true);
  assert.equal(resultOf(sameMultiKeyReplay)?.revision, 2);
  assert.deepEqual(await lineRows(quoteIds.multiline), afterInitialMultiSave, 'same-key replay does not rewrite stable line ids or timestamps');
  const staleMultiSave = await saveMultiline(managerClient, quoteIds.multiline, 1, 'multiline-stale-' + RUN, [serviceLine(feeConfigId)]);
  await assertRejected(staleMultiSave, 'saving multiline changes against an old parent revision');
  const scalarOverwrite = await invoke(managerClient, quoteIds.multiline, {
    draft_json: JSON.stringify({ total_amount: '1.00', valid_until: '2026-12-31', remarks: '不得覆盖项目' }),
    expected_revision: 2, idempotency_key: 'scalar-over-lines-' + RUN,
  });
  await assertRejected(scalarOverwrite, 'saving the old scalar shape over a quotation that already has lines');
  assert.deepEqual(await lineRows(quoteIds.multiline), afterInitialMultiSave, 'scalar fallback cannot erase or replace existing line rows');
  assert.equal((await receiptRows(quoteIds.multiline)).length, 1, 'conflict and scalar requests do not create additional receipts');

  const firstServiceId = firstMultiRows.find(row => row.line_type === 'service')?.id;
  const firstPartId = firstMultiRows.find(row => row.line_type === 'part')?.id;
  assert.ok(firstServiceId && firstPartId);
  const directChildGetForUnrelatedRole = await operatorClient.request('/data/forge_service_quotation_line/' + encodeURIComponent(firstServiceId));
  await assertRejected(directChildGetForUnrelatedRole, 'unrelated service role cannot read a child of a manager quotation');
  assertGenericWriteBlocked(await managerClient.request('/data/forge_service_quotation_line', 'POST', {
    name: '未受控服务项目', quotation_id: quoteIds.multiline, line_type: 'service', service_item_id: feeConfigId,
    item_code: 'SQ-RAW-' + RUN, unit_name: '项', quantity: 1, taxed_unit_price: 1, line_amount: 1, sort_order: 20,
  }), 'generic service quotation line creation');
  assertGenericWriteBlocked(await managerClient.request('/data/forge_service_quotation_line/' + encodeURIComponent(firstServiceId), 'PATCH', { taxed_unit_price: 1 }), 'generic service quotation line update');
  assertGenericWriteBlocked(await managerClient.request('/data/forge_service_quotation_line/' + encodeURIComponent(firstServiceId), 'DELETE'), 'generic service quotation line deletion');

  const invalidLineQuoteBefore = await quoteMultilineSnapshot(quoteIds.multilineInvalid);
  const invalidReferenceCases = [
    ['inactive fee item', serviceLine(inactiveFeeConfigId)],
    ['wrong-category config', serviceLine(wrongCategoryConfigId)],
    ['foreign-org fee item', serviceLine(foreignFeeConfigId)],
    ['disabled SKU', partLine(disabledSkuId)],
    ['inactive material behind SKU', partLine(inactiveMaterialSkuId)],
    ['foreign-org SKU', partLine(foreignSkuId)],
    ['foreign-org material behind a home-org SKU', partLine(homeSkuForeignMaterialId)],
  ];
  for (const [label, line] of invalidReferenceCases) {
    const response = await saveMultiline(managerClient, quoteIds.multilineInvalid, 1, 'invalid-ref-' + String(label).replaceAll(' ', '-') + '-' + RUN, [line]);
    await assertRejected(response, label);
    assert.deepEqual(await quoteMultilineSnapshot(quoteIds.multilineInvalid), invalidLineQuoteBefore, label + ' leaves the parent unchanged');
    assert.equal((await lineRows(quoteIds.multilineInvalid)).length, 0, label + ' creates no child rows');
    assert.equal((await receiptRows(quoteIds.multilineInvalid)).length, 0, label + ' creates no receipt');
  }
  const malformedCases = [
    ['zero quantity', serviceLine(feeConfigId, { quantity: '0' })],
    ['negative price', serviceLine(feeConfigId, { taxed_unit_price: '-0.01' })],
    ['tampered line amount', { ...serviceLine(feeConfigId), line_amount: '1.00' }],
    ['unknown line cost field', { ...partLine(activeSkuId), cost_price: '0.01' }],
  ];
  for (const [label, line] of malformedCases) {
    const response = await saveMultiline(managerClient, quoteIds.multilineInvalid, 1, 'invalid-shape-' + String(label).replaceAll(' ', '-') + '-' + RUN, [line]);
    await assertRejected(response, label);
    assert.deepEqual(await quoteMultilineSnapshot(quoteIds.multilineInvalid), invalidLineQuoteBefore, label + ' leaves the parent unchanged');
    assert.equal((await lineRows(quoteIds.multilineInvalid)).length, 0, label + ' creates no child rows');
    assert.equal((await receiptRows(quoteIds.multilineInvalid)).length, 0, label + ' creates no receipt');
  }

  const crossQuoteLine = await saveMultiline(managerClient, quoteIds.multilineOther, 1, 'cross-quote-line-' + RUN, [
    serviceLine(feeConfigId, { id: firstServiceId }),
  ]);
  await assertRejected(crossQuoteLine, 'reusing a child line id from another quotation');
  assert.equal((await lineRows(quoteIds.multilineOther)).length, 0, 'cross-quotation line ids cannot create or move child rows');
  assert.equal((await receiptRows(quoteIds.multilineOther)).length, 0, 'cross-quotation line rejection creates no receipt');

  const updatedMultiLines = [
    partLine(activeSkuId, { id: firstPartId, description: '重新排序并修改数量', quantity: '2.00', taxed_unit_price: '40.00' }),
    serviceLine(feeConfigId, { description: '新增安装项目', unit_name: '次', quantity: '1.00', taxed_unit_price: '20.00' }),
  ];
  await installMultilineLineMutationProbes();
  const updatedMulti = await saveMultiline(managerClient, quoteIds.multiline, 2, 'multiline-update-' + RUN, updatedMultiLines, {
    remarks: '调整项目和顺序', discount_rate: 5, pricing_mode: 'fixed', payment_mode: 'staged',
  });
  assert.equal(updatedMulti.status, 200, 'manager edits, removes and reorders child lines through the same guarded Action: ' + messageOf(updatedMulti) + '; SQL boundary probes ' + await multilineMutationDiagnostics(quoteIds.multiline));
  assert.deepEqual(resultOf(updatedMulti), {
    id: quoteIds.multiline, code: 'SQD-' + RUN + '-MULTILINE', status: 'draft', revision: 3,
    valid_until: '2026-12-31', remarks: '调整项目和顺序', pricing_mode: 'fixed', payment_mode: 'staged',
    discount_rate: 5, subtotal: 100, discount_amount: 5, total_amount: 95, item_count: 2, repeated: false,
  });
  const updatedRows = await lineRows(quoteIds.multiline);
  assert.equal(updatedRows.length, 2);
  assert.equal(updatedRows[0].id, firstPartId, 'existing part line keeps its id through editing and reorder');
  assert.equal(updatedRows[0].sort_order, 0);
  assert.equal(updatedRows[0].quantity, 2);
  assert.equal(updatedRows[0].taxed_unit_price, 40);
  assert.equal(updatedRows[1].line_type, 'service');
  assert.equal(updatedRows[1].service_item_id, feeConfigId);
  assert.notEqual(updatedRows[1].id, firstServiceId, 'the removed service line is replaced by a new stable row id');
  assert.equal(updatedRows[1].sort_order, 1);
  assert.equal(updatedRows.some(row => row.id === firstServiceId), false, 'omitting the previous service row deletes it');
  assert.deepEqual(await quoteMultilineSnapshot(quoteIds.multiline), {
    id: quoteIds.multiline, status: 'draft', total_amount: 95, valid_until: '2026-12-31', remarks: '调整项目和顺序',
    revision: 3, pricing_mode: 'fixed', payment_mode: 'staged', discount_rate: 5, subtotal: 100, discount_amount: 5, item_count: 2,
  });
  const updatedLinesResponse = await readLinesAction(managerClient, quoteIds.multiline);
  assert.equal(updatedLinesResponse.status, 200);
  assert.deepEqual(resultOf(updatedLinesResponse)?.lines?.map(row => ({ item_id: row.item_id, line_type: row.line_type, sort_order: Number(row.sort_order) })), [
    { item_id: activeSkuId, line_type: 'part', sort_order: 0 },
    { item_id: feeConfigId, line_type: 'service', sort_order: 1 },
  ]);

  await postgres.query('UPDATE forge_service_quotation SET subtotal=$1 WHERE id=$2', [100.01, quoteIds.multiline]);
  const mismatchedHeaderConfirm = await invokeQuotationAction(managerClient, 'service_quotation_confirm', quoteIds.multiline, { expected_revision: 3 });
  await assertRejected(mismatchedHeaderConfirm, 'confirming when the parent subtotal no longer matches its lines');
  const mismatchedHeader = await quoteMultilineSnapshot(quoteIds.multiline);
  assert.equal(mismatchedHeader.status, 'draft');
  assert.equal(mismatchedHeader.revision, 3);
  assert.equal(mismatchedHeader.subtotal, 100.01, 'failed confirmation does not repair or advance a tampered parent value');
  await postgres.query('UPDATE forge_service_quotation SET subtotal=$1 WHERE id=$2', [100, quoteIds.multiline]);

  await postgres.query('UPDATE forge_service_quotation_line SET line_amount=$1 WHERE id=$2 AND quotation_id=$3', [81, firstPartId, quoteIds.multiline]);
  const mismatchedLineConfirm = await invokeQuotationAction(managerClient, 'service_quotation_confirm', quoteIds.multiline, { expected_revision: 3 });
  await assertRejected(mismatchedLineConfirm, 'confirming when a persisted line amount was tampered');
  assert.equal((await quoteMultilineSnapshot(quoteIds.multiline)).status, 'draft', 'line-amount tampering cannot confirm the quotation');
  assert.equal((await quoteMultilineSnapshot(quoteIds.multiline)).revision, 3);
  await postgres.query('UPDATE forge_service_quotation_line SET line_amount=$1 WHERE id=$2 AND quotation_id=$3', [80, firstPartId, quoteIds.multiline]);

  const multilineConfirmed = await invokeQuotationAction(managerClient, 'service_quotation_confirm', quoteIds.multiline, { expected_revision: 3 });
  assert.equal(multilineConfirmed.status, 200, 'a consistent multiline quote confirms against its current revision');
  assert.deepEqual(resultOf(multilineConfirmed), { id: quoteIds.multiline, status: 'confirmed', revision: 4 });
  assert.deepEqual(await quoteMultilineSnapshot(quoteIds.multiline), {
    id: quoteIds.multiline, status: 'confirmed', total_amount: 95, valid_until: '2026-12-31', remarks: '调整项目和顺序',
    revision: 4, pricing_mode: 'fixed', payment_mode: 'staged', discount_rate: 5, subtotal: 100, discount_amount: 5, item_count: 2,
  });
  for (const [client, target] of [
    [managerClient, quoteIds.foreignSettlementRaceA],
    [foreignManagerClient, quoteIds.settlementRaceA],
  ]) {
    const before = await quoteSnapshot(target);
    const denied = await invokeQuotationAction(client, 'service_quotation_create_settlement', target, { expected_revision: 3 });
    await assertRejected(denied, 'creating a settlement for a confirmed quote in another organization');
    assert.deepEqual(await quoteSnapshot(target), before, 'cross-organization settlement requests leave the confirmed parent unchanged');
    assert.equal((await settlementRows(target)).length, 0, 'a cross-organization request creates no settlement');
  }
  const settlementBaseline = await settlementNumberBaseline();
  const parallelSettlementResults = await Promise.all([
    invokeQuotationAction(managerClient, 'service_quotation_create_settlement', quoteIds.settlementRaceA, { expected_revision: 3 }),
    invokeQuotationAction(managerClient, 'service_quotation_create_settlement', quoteIds.settlementRaceB, { expected_revision: 3 }),
  ]);
  assert.deepEqual(parallelSettlementResults.map(row => row.status).sort(), [200, 200], 'different confirmed quotes can create settlements concurrently: ' + parallelSettlementResults.map(safeSettlementMessage).join(' | '));
  const parallelSettlementRows = await Promise.all([
    settlementRows(quoteIds.settlementRaceA), settlementRows(quoteIds.settlementRaceB),
  ]);
  assert.equal(parallelSettlementRows[0]?.length, 1, 'first concurrent quote has exactly one settlement');
  assert.equal(parallelSettlementRows[1]?.length, 1, 'second concurrent quote has exactly one settlement');
  assert.ok(parallelSettlementRows[0][0].code && parallelSettlementRows[1][0].code);
  assert.match(parallelSettlementRows[0][0].code, /^SS-\d{8}-\d{4}$/);
  assert.match(parallelSettlementRows[1][0].code, /^SS-\d{8}-\d{4}$/);
  assert.notEqual(parallelSettlementRows[0][0].code, parallelSettlementRows[1][0].code, 'different settlements have distinct persisted codes');
  const homeSettlementCodes = parallelSettlementRows.flat().map(row => row.code).sort();
  const settlementPrefix = homeSettlementCodes[0].slice(0, -4);
  const initialHomeCounter = priorSettlementCounter(settlementBaseline, ORGANIZATION_ID, settlementPrefix);
  assert.deepEqual(homeSettlementCodes.map(value => Number(value.slice(-4))), [initialHomeCounter + 1, initialHomeCounter + 2], 'same-organization concurrent parents advance the observed daily counter exactly twice');
  assert.ok(parallelSettlementRows.flat().every(row => row.organization_id === ORGANIZATION_ID), 'both concurrent settlements retain their actual organization');
  assert.ok(homeSettlementCodes.every(value => value.startsWith(settlementPrefix)), 'concurrent settlements use the same daily prefix');
  const countersAfterHomeSettlements = await settlementCounters();
  assert.equal(countersAfterHomeSettlements.find(row => row.organization_id === ORGANIZATION_ID && row.prefix === settlementPrefix)?.value, initialHomeCounter + 2);
  assert.deepEqual(countersAfterHomeSettlements.filter(row => row.organization_id === FOREIGN_ORGANIZATION_ID), settlementBaseline.counters.filter(row => row.organization_id === FOREIGN_ORGANIZATION_ID), 'creating home settlements does not allocate a counter in the second organization');
  for (const raceQuoteId of [quoteIds.settlementRaceA, quoteIds.settlementRaceB]) {
    const saved = await quoteSnapshot(raceQuoteId);
    assert.equal(saved.status, 'settlement_created');
    assert.equal(saved.revision, 4);
  }
  const foreignSettlementResults = await Promise.all([
    invokeQuotationAction(foreignManagerClient, 'service_quotation_create_settlement', quoteIds.foreignSettlementRaceA, { expected_revision: 3 }),
    invokeQuotationAction(foreignManagerClient, 'service_quotation_create_settlement', quoteIds.foreignSettlementRaceB, { expected_revision: 3 }),
  ]);
  assert.deepEqual(foreignSettlementResults.map(row => row.status).sort(), [200, 200], 'the second organization can create legitimate settlements under the same daily prefix: ' + foreignSettlementResults.map(safeSettlementMessage).join(' | '));
  const foreignSettlementRows = await Promise.all([
    settlementRows(quoteIds.foreignSettlementRaceA), settlementRows(quoteIds.foreignSettlementRaceB),
  ]);
  assert.deepEqual(foreignSettlementRows.map(rows => rows.length), [1, 1], 'each confirmed parent in the second organization has exactly one settlement');
  assert.ok(foreignSettlementRows.flat().every(row => row.organization_id === FOREIGN_ORGANIZATION_ID), 'second-organization settlements retain their actual organization');
  const foreignSettlementCodes = foreignSettlementRows.flat().map(row => row.code).sort();
  for (const code of foreignSettlementCodes) assert.match(code, /^SS-\d{8}-\d{4}$/);
  const initialForeignCounter = priorSettlementCounter(settlementBaseline, FOREIGN_ORGANIZATION_ID, settlementPrefix);
  assert.ok(foreignSettlementCodes.every(value => value.startsWith(settlementPrefix)), 'both organizations generate settlements under the same observed daily prefix');
  assert.deepEqual(foreignSettlementCodes.map(value => Number(value.slice(-4))), [initialForeignCounter + 1, initialForeignCounter + 2], 'the second organization advances its own observed daily counter exactly twice');
  if (initialHomeCounter === initialForeignCounter) {
    assert.deepEqual(foreignSettlementCodes, homeSettlementCodes, 'equal starting counters legitimately produce the same business numbers in different organizations');
  }
  const countersAfterForeignSettlements = await settlementCounters();
  assert.equal(countersAfterForeignSettlements.find(row => row.organization_id === FOREIGN_ORGANIZATION_ID && row.prefix === settlementPrefix)?.value, initialForeignCounter + 2);
  assert.deepEqual(countersAfterForeignSettlements.filter(row => row.organization_id === ORGANIZATION_ID), countersAfterHomeSettlements.filter(row => row.organization_id === ORGANIZATION_ID), 'allocating second-organization settlement numbers does not change the home counter');
  for (const foreignQuoteId of [quoteIds.foreignSettlementRaceA, quoteIds.foreignSettlementRaceB]) {
    const saved = await quoteSnapshot(foreignQuoteId);
    assert.equal(saved.status, 'settlement_created');
    assert.equal(saved.revision, 4);
  }
  for (const [ownClient, otherClient, row] of [
    [managerClient, foreignManagerClient, parallelSettlementRows[0][0]],
    [foreignManagerClient, managerClient, foreignSettlementRows[0][0]],
  ]) {
    const ownRead = await ownClient.request('/data/forge_service_settlement/' + encodeURIComponent(row.id));
    assert.equal(ownRead.status, 200, 'the originating organization can read its newly generated settlement');
    const ownRecord = resultOf(ownRead)?.record || resultOf(ownRead);
    assert.equal(ownRecord?.id, row.id);
    assert.equal(ownRecord?.code, row.code);
    const crossRead = await otherClient.request('/data/forge_service_settlement/' + encodeURIComponent(row.id));
    await assertRejected(crossRead, 'reading another organization settlement by its known record id');
  }
  t.diagnostic('isolated settlement counters: home ' + initialHomeCounter + ' -> ' + (initialHomeCounter + 2) + '; second organization ' + initialForeignCounter + ' -> ' + (initialForeignCounter + 2) + '; same daily prefix; bidirectional cross-organization Action and read rejection verified');
  const staleMultilineSettlement = await invokeQuotationAction(managerClient, 'service_quotation_create_settlement', quoteIds.multiline, { expected_revision: 3 });
  await assertRejected(staleMultilineSettlement, 'settling a multiline quote against its old revision');
  assert.equal((await settlementRows(quoteIds.multiline)).length, 0, 'stale multiline settlement creates no row');
  const multilineSettlement = await invokeQuotationAction(managerClient, 'service_quotation_create_settlement', quoteIds.multiline, { expected_revision: 4 });
  const multilineSettlementParent = await quoteMultilineSnapshot(quoteIds.multiline);
  assert.equal(multilineSettlement.status, 200, 'settlement uses the final discounted amount from the validated multiline quote: ' + messageOf(multilineSettlement)
    + '; parentState=' + JSON.stringify(multilineSettlementParent && { status: multilineSettlementParent.status, revision: multilineSettlementParent.revision, total_amount: multilineSettlementParent.total_amount })
    + '; linkedSettlements=' + (await settlementRows(quoteIds.multiline)).length);
  const multilineSettlementResult = resultOf(multilineSettlement);
  assert.equal(multilineSettlementResult?.quotation_id, quoteIds.multiline);
  const multilineSettlements = await settlementRows(quoteIds.multiline);
  assert.equal(multilineSettlements.length, 1);
  assert.equal(multilineSettlements[0].status, 'draft');
  assert.equal(Number(multilineSettlements[0].total_amount), 95);
  assert.match(multilineSettlements[0].code, /^SS-\d{8}-\d{4}$/);
  assert.equal(multilineSettlements[0].quotation_pricing_mode, 'fixed');
  assert.equal(multilineSettlements[0].quotation_payment_mode, 'staged');
  const countersAfterMultilineSettlement = await settlementCounters();
  assert.equal(countersAfterMultilineSettlement.find(row => row.organization_id === ORGANIZATION_ID && row.prefix === settlementPrefix)?.value, initialHomeCounter + 3, 'the next home settlement advances only the home daily counter');
  assert.deepEqual(countersAfterMultilineSettlement.filter(row => row.organization_id === FOREIGN_ORGANIZATION_ID), countersAfterForeignSettlements.filter(row => row.organization_id === FOREIGN_ORGANIZATION_ID), 'a further home settlement leaves the second-organization counters unchanged');
  assert.deepEqual(await quoteMultilineSnapshot(quoteIds.multiline), {
    id: quoteIds.multiline, status: 'settlement_created', total_amount: 95, valid_until: '2026-12-31', remarks: '调整项目和顺序',
    revision: 5, pricing_mode: 'fixed', payment_mode: 'staged', discount_rate: 5, subtotal: 100, discount_amount: 5, item_count: 2,
  });
  const multilineSettlementDuplicate = await invokeQuotationAction(managerClient, 'service_quotation_create_settlement', quoteIds.multiline, { expected_revision: 4 });
  await assertRejected(multilineSettlementDuplicate, 'repeating multiline settlement creation');
  assert.equal((await settlementRows(quoteIds.multiline)).length, 1, 'multiline retries cannot create another settlement');

  const lineRollbackBefore = await quoteMultilineSnapshot(quoteIds.multilineLineRollback);
  lineRejectFunction = 'fn_service_quote_line_reject_' + RUN;
  lineRejectTrigger = 'trg_service_quote_line_reject_' + RUN;
  await postgres.query(`CREATE FUNCTION "${lineRejectFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.quotation_id = '${quoteIds.multilineLineRollback}' THEN RAISE EXCEPTION 'isolated quotation line insert failure'; END IF; RETURN NEW; END $$`);
  await postgres.query(`CREATE TRIGGER "${lineRejectTrigger}" BEFORE INSERT ON forge_service_quotation_line FOR EACH ROW EXECUTE FUNCTION "${lineRejectFunction}"()`);
  const childInsertFailure = await saveMultiline(managerClient, quoteIds.multilineLineRollback, 1, 'line-insert-failure-' + RUN, [serviceLine(feeConfigId)]);
  await assertRejected(childInsertFailure, 'quotation line insertion failure');
  assert.deepEqual(await quoteMultilineSnapshot(quoteIds.multilineLineRollback), lineRollbackBefore, 'parent totals and revision roll back with a child insert failure');
  assert.equal((await lineRows(quoteIds.multilineLineRollback)).length, 0, 'no child survives its failed insert');
  assert.equal((await receiptRows(quoteIds.multilineLineRollback)).length, 0, 'no receipt survives a child insert failure');
  await postgres.query(`DROP TRIGGER "${lineRejectTrigger}" ON forge_service_quotation_line`);
  await postgres.query(`DROP FUNCTION "${lineRejectFunction}"()`);
  lineRejectTrigger = ''; lineRejectFunction = '';

  const multilineReceiptRollbackBefore = await quoteMultilineSnapshot(quoteIds.multilineReceiptRollback);
  const multilineReceiptFailKey = 'multiline-receipt-failure-' + RUN;
  rejectFunction = 'fn_service_quote_multiline_receipt_reject_' + RUN;
  rejectTrigger = 'trg_service_quote_multiline_receipt_reject_' + RUN;
  await postgres.query(`CREATE FUNCTION "${rejectFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.idempotency_key = '${multilineReceiptFailKey}' THEN RAISE EXCEPTION 'isolated multiline receipt insert failure'; END IF; RETURN NEW; END $$`);
  await postgres.query(`CREATE TRIGGER "${rejectTrigger}" BEFORE INSERT ON forge_service_quotation_draft_receipt FOR EACH ROW EXECUTE FUNCTION "${rejectFunction}"()`);
  const multilineReceiptFailure = await saveMultiline(managerClient, quoteIds.multilineReceiptRollback, 1, multilineReceiptFailKey, [
    serviceLine(feeConfigId), partLine(activeSkuId),
  ]);
  await assertRejected(multilineReceiptFailure, 'multiline receipt insertion failure');
  assert.deepEqual(await quoteMultilineSnapshot(quoteIds.multilineReceiptRollback), multilineReceiptRollbackBefore, 'parent amount and revision roll back with a multiline receipt failure');
  assert.equal((await lineRows(quoteIds.multilineReceiptRollback)).length, 0, 'all child inserts roll back with a failed receipt insert');
  assert.equal((await receiptRows(quoteIds.multilineReceiptRollback)).length, 0, 'no multiline receipt survives its failed insert');
  await postgres.query(`DROP TRIGGER "${rejectTrigger}" ON forge_service_quotation_draft_receipt`);
  await postgres.query(`DROP FUNCTION "${rejectFunction}"()`);
  rejectTrigger = ''; rejectFunction = '';

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
  assert.match(createdSettlements[0].code, /^SS-\d{8}-\d{4}$/);
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

  async function exerciseNativeSalesPricing() {
    const clerk = await createCaller('销售经办', 'sales_order_operator');
    const priceReviewer = await createCaller('价格复核', 'sales_order_reviewer');
    const feeClerk = await createCaller('费用经办', 'sales_contract_operator');
    const financeReviewer = await createCaller('财务复核', 'forge_finance_reviewer');
    for (const [caller, positionName, permission] of [[priceReviewer, 'sales_order_reviewer', 'sales_order_reviewer'], [financeReviewer, 'finance_reviewer', 'forge_finance_reviewer']]) {
      const position = await createPosition(positionName, permission);
      await insertFixture('sys_user_position', { user_id: caller.id, position: positionName, organization_id: ORGANIZATION_ID, valid_from: new Date(Date.now() - 60_000).toISOString(), valid_until: null });
    }
    const clerkClient = await signIn(clerk), priceReviewerClient = await signIn(priceReviewer);
    const feeClient = await signIn(feeClerk), financeClient = await signIn(financeReviewer);
    const customerCategoryId=await insertFixture('forge_customer_category',{name:'本轮价格客户分类',code:'PRICE-CUSTOMER-CAT-'+RUN,organization_id:ORGANIZATION_ID});
    const customerId = await insertFixture('forge_customer', { category_id:customerCategoryId,name: '本轮价格客户', responsible_id: clerk.id, owner_id: clerk.id, organization_id: ORGANIZATION_ID });
    const categoryId = await insertFixture('forge_material_category', { name: '本轮价格材料分类', code: 'PRICE-CAT-' + RUN, organization_id: ORGANIZATION_ID });
    const unitId = await insertFixture('forge_unit', { name: '件', code: 'PRICE-UNIT-' + RUN, organization_id: ORGANIZATION_ID });
    const materialId = await insertFixture('forge_material', { name: '本轮价格物料', code: 'PRICE-MAT-' + RUN, model: 'TEST', category_id: categoryId, unit_id: unitId, property: 'raw_material', source_type: 'purchased', status: 'active', organization_id: ORGANIZATION_ID });
    const skuId = await insertFixture('forge_material_sku', { name: '标准规格', code: 'PRICE-SKU-' + RUN, material_id: materialId, sale_price: '100.0001', enabled: true, organization_id: ORGANIZATION_ID });
    const priceSave = await clerkClient.request('/actions/forge_sales_price_request/sales_price_draft_save', 'POST', { params: { request_key: 'native-price-' + RUN, draft_json: JSON.stringify({ kind: 'adjustment', reason: '部署原生价格复核', lines: [{ sku_id: skuId, quantity: '2.5000', proposed_price: '12.3456' }] }) } });
    assert.equal(priceSave.status, 200, messageOf(priceSave));
    const price = resultOf(priceSave);
    const priceSubmit = await clerkClient.request('/actions/forge_sales_price_request/sales_price_submit/' + price.id, 'POST', { params: { expected_revision: price.revision } });
    assert.equal(priceSubmit.status, 200, messageOf(priceSubmit)+' '+safeOutput(runtimeOutput,databaseUrl).slice(-1500));
    const priceSubmitted=(await postgres.query('SELECT status,review_owner_id,approval_status,submitted_by FROM forge_sales_price_request WHERE id=$1',[price.id])).rows[0];assert.equal(priceSubmitted.review_owner_id,priceReviewer.id,'native submission retained the selected real reviewer');
    async function approve(client, objectName, recordId, selfClient) {
      let request;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const inbox = await client.request('/approvals/requests');
        assert.equal(inbox.status, 200, messageOf(inbox));
        const data = payloadOf(inbox), rows = Array.isArray(data) ? data : data.requests || data.records || data.items || [];
        request = rows.find(row => row.recordId === recordId || row.record_id === recordId);
        if (request) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if(!request?.id){const tables=await postgres.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%approval%' OR table_name LIKE '%flow%')");console.log('native approval diagnostic tables',tables.rows.map(row=>row.table_name));for(const table of tables.rows.filter(row=>['sys_approval_request','sys_approval_step','sys_automation_run','sys_flow_execution'].includes(row.table_name))){const result=await postgres.query('SELECT row_to_json(item) AS record FROM '+table.table_name+' item LIMIT 5');console.log(table.table_name,JSON.stringify(result.rows))}console.log('native runtime diagnostic',safeOutput(runtimeOutput,databaseUrl))}
      assert.ok(request?.id, objectName + ' formed a native approval assigned to the live independent employee');
      if (selfClient) {
        const rejected = await selfClient.request('/approvals/requests/' + request.id + '/approve', 'POST', { comment: '自审必须拒绝' });
        assert.ok([403, 404].includes(rejected.status), 'applicant cannot approve their own application');
      }
      const decision = await client.request('/approvals/requests/' + request.id + '/approve', 'POST', { comment: '独立员工复核通过' });
      assert.equal(decision.status, 200, safeOutput(JSON.stringify(decision.value),databaseUrl)+' '+safeOutput(runtimeOutput,databaseUrl).slice(-3000));
    }
    await approve(priceReviewerClient, 'forge_sales_price_request', price.id, clerkClient);
    const deadline = Date.now() + 10000;
    let priceState;
    do {
      priceState = (await postgres.query('SELECT status,effect_status,effect_message FROM forge_sales_price_request WHERE id=$1', [price.id])).rows[0];
      if (priceState?.effect_status === 'applied') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.equal(priceState.effect_status, 'applied', priceState.effect_message);
    assert.equal(Number((await postgres.query('SELECT sale_price FROM forge_material_sku WHERE id=$1', [skuId])).rows[0].sale_price), 12.3456);
    assert.equal((await operatorClient.request('/data/forge_sales_price_request/' + price.id)).status, 403, 'unrelated service role cannot read price application');
    const orderId = await insertFixture('forge_sales_order', { name: '本轮优惠订单',planned_delivery_on:'2026-10-12',payment_term:'全额预付', code: 'PRICE-ORDER-' + RUN, customer_id: customerId, total_amount: 100, status: 'draft', owner_id: clerk.id, responsible_id: clerk.id, organization_id: ORGANIZATION_ID });
    const discountSave = await clerkClient.request('/actions/forge_sales_discount_request/sales_discount_draft_save', 'POST', { params: { request_key: 'native-discount-' + RUN, order_id: orderId, discount_type: 'amount', discount_value: 10, reason: '本轮客户优惠复核' } });
    assert.equal(discountSave.status, 200, messageOf(discountSave));
    const discount = resultOf(discountSave);
    const discountSubmit = await clerkClient.request('/actions/forge_sales_discount_request/sales_discount_submit/' + discount.id, 'POST', { params: { expected_revision: discount.revision } });
    assert.equal(discountSubmit.status, 200, messageOf(discountSubmit));
    await approve(priceReviewerClient, 'forge_sales_discount_request', discount.id, clerkClient);
    const feeCustomerId = await insertFixture('forge_customer', { category_id:customerCategoryId,name: '本轮费用客户', responsible_id: feeClerk.id, owner_id: feeClerk.id, organization_id: ORGANIZATION_ID });
    const feeSave = await feeClient.request('/actions/forge_sales_additional_fee/sales_additional_fee_draft_save', 'POST', { params: { request_key: 'native-fee-' + RUN, source_type: 'manual', source_id: feeCustomerId, bearing_type: 'customer', lines_json: JSON.stringify([{ name: '运输费', category: '物流', untaxed_amount: 10, tax_rate: 13 }]), occurred_on: '2026-10-10', settlement_type: 'order' } });
    assert.equal(feeSave.status, 200, messageOf(feeSave));
    const fee = resultOf(feeSave);
    const feeSubmit = await feeClient.request('/actions/forge_sales_additional_fee/sales_additional_fee_submit/' + fee.id, 'POST', { params: { expected_revision: fee.revision } });
    assert.equal(feeSubmit.status, 200, messageOf(feeSubmit));
    await approve(financeClient, 'forge_sales_additional_fee', fee.id, feeClient);
    const feeRead = await financeClient.request('/data/forge_sales_additional_fee/' + fee.id);
    assert.equal(feeRead.status, 200, messageOf(feeRead));
    const feeRecord=payloadOf(feeRead).record||payloadOf(feeRead);assert.equal(Number(feeRecord.total_amount), 11.3,JSON.stringify(feeRead.value));
    await stopRuntime(); await startRuntime();
    assert.equal((await postgres.query('SELECT effect_status FROM forge_sales_price_request WHERE id=$1', [price.id])).rows[0].effect_status, 'applied');
    assert.equal((await postgres.query('SELECT document_status FROM forge_sales_additional_fee WHERE id=$1', [fee.id])).rows[0].document_status, 'active');
  }
  await t.test('new sales price, discount and additional fee actions create and complete native employee approvals', exerciseNativeSalesPricing);
  console.log('PASS isolated PostgreSQL service quotation revision transitions, draft receipts, authorization, rollback, idempotency, and concurrency');
});
