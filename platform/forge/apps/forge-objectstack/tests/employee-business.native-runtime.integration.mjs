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

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const PG_PORT = Number(process.env.FORGE_APPROVAL_MCP_PG_PORT || 55439);
const PG_USER = process.env.FORGE_APPROVAL_MCP_PG_USER || 'postgres';
const CONTRACT_OBJECT = 'forge_sales_contract';
const FLOW_NAME = 'sales_contract_approval';
const APPROVE_ACTION = 'contract_approval_mcp_approve';
const SEND_BACK_ACTION = 'contract_approval_mcp_send_back';

assert.ok(Number.isInteger(PG_PORT) && PG_PORT > 0 && PG_PORT < 65536);

function safeOutput(output, secrets) {
  let result = output;
  for (const secret of secrets.filter(Boolean)) result = result.replaceAll(secret, '[secret omitted]');
  return result.slice(-6_000);
}

function mcpText(result) {
  return String(result?.content?.find((item) => item.type === 'text')?.text || result?._rpcError?.message || '');
}

function mcpData(result) {
  try { return JSON.parse(mcpText(result)); } catch { return null; }
}

test('employee business HTTP connection uses native metadata, identity and atomic operation receipts', {
  skip: process.env.FORGE_EMPLOYEE_BUSINESS_PG_TEST !== '1'
    ? 'set FORGE_EMPLOYEE_BUSINESS_PG_TEST=1 for the isolated local PostgreSQL 16 runtime test'
    : false,
  timeout: 240_000,
}, async (t) => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const database = `forge_employee_business_${suffix}`;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'forge-approval-mcp-runtime-'));
  const adminEmail = `approval-mcp-admin-${suffix}@example.test`;
  const adminPassword = `Am-${randomBytes(18).toString('hex')}!`;
  const secretKey = randomBytes(32).toString('hex');
  const authSecret = randomBytes(32).toString('hex');
  const launcherSecret = randomBytes(32).toString('hex');
  const runtimeId = `approval-mcp-${suffix}`;
  const secrets = [adminEmail, adminPassword, secretKey, authSecret, launcherSecret];
  const pgAdmin = new Client({ host: HOST, port: PG_PORT, database: 'postgres', user: PG_USER });
  let databaseClient;
  let child;
  let output = '';
  let port;
  await pgAdmin.connect();
  await pgAdmin.query(`CREATE DATABASE "${database}"`);

  async function stopRuntime() {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 8_000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }

  async function stopAndDrop() {
    await stopRuntime();
    if (databaseClient) await databaseClient.end().catch(() => {});
    await pgAdmin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [database]);
    await pgAdmin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await pgAdmin.end();
    await rm(tempDir, { recursive: true, force: true });
  }
  t.after(stopAndDrop);

  await writeFile(path.join(tempDir, 'package.json'), '{"name":"forge-approval-mcp-runtime-test","type":"module"}\n');
  await symlink(path.join(APP_DIR, 'src'), path.join(tempDir, 'src'), 'dir');
  await symlink(path.join(APP_DIR, 'node_modules'), path.join(tempDir, 'node_modules'), 'dir');
  await writeFile(path.join(tempDir, 'approval-flow-launcher.plugin.mjs'), `
export class ApprovalFlowLauncherPlugin {
 name = 'com.inoforge.forge.test.employee-receipt-fault'; version = '1.0.0'; type = 'standard';
 init(ctx) { ctx.hook('kernel:ready', () => {
  const engine = ctx.getService('objectql'), original = engine.update; let armed = false;
  engine.update = async function(object, data, options) {
   if (armed && object === 'forge_employee_business_operation' && data.status === 'succeeded') { armed = false; throw new Error('injected receipt persistence failure'); }
   return original.call(this, object, data, options);
  };
  ctx.getService('http.server').post('/api/v1/__test/seed-file', async(req,res) => {
   if (req.headers?.authorization !== 'Bearer ${launcherSecret}') { await res.status(403).json({error:'forbidden'}); return; }
   try { const id=crypto.randomUUID(), key='user/'+id+'.pdf', bytes=Buffer.from('%PDF-1.7 INTERNAL SYNTHETIC TEST');
   await ctx.getService('storage').upload(key,bytes,{contentType:'application/pdf',acl:'private'});
   await engine.insert('sys_file',{id,key,name:'内部合成凭证.pdf',mime_type:'application/pdf',size:bytes.length,status:'committed',scope:'user',acl:'private',owner_id:req.body.actorId,organization_id:req.body.organizationId},{context:{isSystem:true,tenantId:req.body.organizationId,positions:[],permissions:[]}});
   await res.status(200).json({fileId:id,name:'内部合成凭证.pdf',mediaType:'application/pdf',bytes:bytes.length}); } catch(error) { await res.status(500).json({error:String(error)}); }
  });
  ctx.getService('http.server').post('/api/v1/__test/receipt-fault', async(req,res) => {
   if (req.headers?.authorization !== 'Bearer ${launcherSecret}') { await res.status(403).json({error:'forbidden'}); return; }
   armed = true; await res.status(200).json({armed:true});
  });
 }); }
}
`);
  await writeFile(path.join(tempDir, 'objectstack.config.ts'), `
import stack from ${JSON.stringify(path.join(APP_DIR, 'objectstack.config.ts'))};
import { ApprovalFlowLauncherPlugin } from './approval-flow-launcher.plugin.mjs';
stack.plugins.push(new ApprovalFlowLauncherPlugin());
export default stack;
`);

  const portProbe = createServer();
  await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, HOST, resolve);
  });
  port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
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
      OS_DATABASE_URL: `postgres://${PG_USER}@${HOST}:${PG_PORT}/${database}`,
      OS_SECRET_KEY: secretKey,
      OS_BASE_URL: `http://${HOST}:${port}`,
      OS_TRUSTED_ORIGINS: `http://${HOST}:${port}`,
      OS_ENVIRONMENT_ID: runtimeId,
      FORGE_APPROVAL_TEST_BOOTSTRAP_TOKEN: launcherSecret,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output = (output + chunk).slice(-10_000); });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output = (output + chunk).slice(-10_000); });
  const deadline = Date.now() + 120_000;
  let health;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated ObjectStack runtime exited (${child.exitCode}).\n${safeOutput(output, secrets)}`);
    try {
      health = await fetch(`http://${HOST}:${port}/api/v1/health`, { signal: AbortSignal.timeout(1_000) });
      if (health.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(health?.ok, `Isolated ObjectStack runtime did not become ready.\n${safeOutput(output, secrets)}`);

  databaseClient = new Client({ host: HOST, port: PG_PORT, database, user: PG_USER });
  await databaseClient.connect();
  async function clientFor(email, password) {
    const origin = `http://${HOST}:${port}`;
    const response = await fetch(`${origin}/api/v1/auth/sign-in/email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email, password }),
    });
    const value = await response.json();
    assert.ok(response.ok && value.user?.id, `Local sign-in failed with HTTP ${response.status}`);
    const cookie = response.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
    let requestId = 0;
    let mcpSessionId = '';
    let mcpInitialized = false;
    async function request(resource, method = 'GET', body, extraHeaders = {}) {
      const result = await fetch(`${origin}/api/v1${resource}`, {
        method, headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
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
      const dataLines = raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter(Boolean);
      const payload = dataLines.length ? dataLines.at(-1) : raw;
      return { status: result.status, value: payload ? JSON.parse(payload) : null };
    }
    async function callMcpTool(name, arguments_ = {}) {
      if (!mcpInitialized) {
        const initialized = await mcpRequest('initialize', {
          protocolVersion: '2025-03-26', capabilities: {},
          clientInfo: { name: 'forge-approval-mcp-native-test', version: '1.0.0' },
        });
        assert.equal(initialized.status, 200, `MCP initialize returned ${initialized.status}`);
        await mcpRequest('notifications/initialized', {}, true);
        mcpInitialized = true;
      }
      const result = await mcpRequest('tools/call', { name, arguments: arguments_ });
      assert.equal(result.status, 200, `MCP ${name} transport returned ${result.status}`);
      return result.value?.result ?? { _rpcError: result.value?.error };
    }
    return { userId: value.user.id, request, callMcpTool, cookie };
  }

  async function createEmployee(admin, organizationId, roleName) {
    const email = `approval-mcp-${roleName}-${suffix}@example.test`;
    const password = `Emp-${randomBytes(18).toString('hex')}!`;
    const created = await admin.request('/auth/admin/create-user', 'POST', {
      name: `审批MCP隔离测试-${roleName}`, email, password, role: 'user', mustChangePassword: false,
    });
    assert.ok(created.status >= 200 && created.status < 300, `Employee creation returned HTTP ${created.status}`);
    const userId = created.value?.data?.user?.id;
    assert.ok(userId, 'Employee creation must return an id');
    const setPassword = await admin.request('/auth/admin/set-user-password', 'POST', {
      userId, newPassword: password, mustChangePassword: false,
    });
    assert.ok(setPassword.status >= 200 && setPassword.status < 300, 'Employee password setup succeeded');
    const membership = await databaseClient.query('SELECT id FROM sys_member WHERE user_id = $1 AND organization_id = $2 LIMIT 1', [userId, organizationId]);
    if (!membership.rows[0]?.id) {
      await databaseClient.query('INSERT INTO sys_member (id, organization_id, user_id, role) VALUES ($1, $2, $3, $4)', [randomUUID(), organizationId, userId, 'member']);
    }
    const employee = await clientFor(email, password);
    const employeeSession = await employee.request('/auth/get-session');
    if (employeeSession.value?.session?.activeOrganizationId !== organizationId) {
      const switched = await employee.request('/auth/organization/set-active', 'POST', { organizationId });
      assert.ok(switched.status >= 200 && switched.status < 300,
        `Employee active organization setup returned HTTP ${switched.status}`);
    }
    return employee;
  }

  function idOf(response, label) {
    const id = response?.value?.id || response?.value?.record?.id || response?.value?.data?.id || response?.value?.data?.record?.id;
    assert.ok(response.status >= 200 && response.status < 300 && id, `${label} HTTP ${response.status}`);
    return id;
  }

  const admin = await clientFor(adminEmail, adminPassword);
  const session = await admin.request('/auth/get-session');
  const organizationId = session.value?.session?.activeOrganizationId || session.value?.session?.organizationId;
  assert.ok(organizationId, 'Seeded administrator has an active organization');

  const permissionId = (await databaseClient.query('SELECT id FROM sys_permission_set WHERE name=$1',['sales_contract_operator'])).rows[0]?.id;
  assert.ok(permissionId);
  const grant = await admin.request('/data/sys_user_permission_set','POST',{user_id:admin.userId,permission_set_id:permissionId,organization_id:organizationId,granted_by:admin.userId,reason:'隔离测试'});
  assert.ok(grant.status<300,JSON.stringify(grant.value));
  await databaseClient.query('INSERT INTO sys_user_position (id,user_id,position,organization_id) VALUES ($1,$2,$3,$4)',[randomUUID(),admin.userId,'sales_owner',organizationId]);
  const unrelated = await createEmployee(admin, organizationId, 'unrelated');
  const categoryId = idOf(await admin.request('/data/forge_customer_category', 'POST', { name: '业务连接合成客户分类', code: `EBC-${suffix}`, status: 'active' }), 'category');
  const customerId = idOf(await admin.request('/data/forge_customer', 'POST', { name: '业务连接合成客户', category_id: categoryId, responsible_id: admin.userId }), 'customer');
  const contractTypeId = idOf(await admin.request('/data/forge_contract_type', 'POST', { name: '业务连接合成合同类型', code: `EBT-${suffix}`, status: 'active' }), 'contract type');
  const contractId = idOf(await admin.request('/data/forge_sales_contract', 'POST', { name: '业务连接合成合同', code: `EB-${suffix}`, contract_type_id: contractTypeId, customer_id: customerId, responsible_id: admin.userId }), 'contract');
  await databaseClient.query("UPDATE forge_sales_contract SET status = 'active', total_amount = 20000 WHERE id = $1", [contractId]);
  const catalog = await admin.request('/workbench/business-actions/catalog');
  assert.equal(catalog.status, 200, JSON.stringify(catalog.value));
  const material = catalog.value.capabilities.find(a => a.actionName === 'contract_submit_material_package');
  assert.equal(material?.status, 'available', JSON.stringify(material));
  assert.equal(material.executionMode, 'team_delegable');
  assert.equal(material.params.find(p => p.name === 'material_file_ids')?.multiple, true);
  assert.equal(catalog.value.capabilities.find(a => a.actionName === 'contract_set_order_conditions')?.executionMode, 'employee_only');
  const contextPath = `/workbench/business-actions/context?objectName=forge_sales_contract&recordId=${contractId}`;
  const opened = await admin.request(contextPath);
  assert.equal(opened.status, 200, JSON.stringify(opened.value));
  const bound = opened.value, action = bound.actions.find(a => a.capabilityId.endsWith('.contract_set_order_conditions'));
  assert.ok(action, JSON.stringify(bound));
  assert.equal(action.parameters.find(p => p.name === 'order_payment_requirement').enumLabels.find(p => p.value === 'prepayment').label, '先确认预付款');
  const prepare = (context, value) => ({ version:'1', contextId:context.contextId, contextVersion:context.contextVersion, opKey:randomUUID(), employeeMessage:{sessionId:randomUUID(), messageId:randomUUID(), sha256:'a'.repeat(64)}, action_ref:context.actions.find(a => a.capabilityId.endsWith('.contract_set_order_conditions')).action_ref, values:{order_payment_requirement:'prepayment',order_prepayment_amount:value} });
  const input = prepare(bound,6000);
  const first = await admin.request('/workbench/business-actions/execute','POST',input);
  assert.equal(first.status,200,JSON.stringify(first.value)); assert.equal(first.value.status,'succeeded',JSON.stringify(first.value));
  const repeated = await admin.request('/workbench/business-actions/execute','POST',input);
  assert.equal(repeated.value.repeated,true); assert.equal(repeated.value.requestDigest,first.value.requestDigest);
  const changedInput = await admin.request('/workbench/business-actions/execute','POST',{...input,values:{...input.values,order_prepayment_amount:7000}});
  assert.equal(changedInput.status,409);
  const stale = prepare(bound,7000), rejected = await admin.request('/workbench/business-actions/execute','POST',stale);
  assert.equal(rejected.value.status,'failed',JSON.stringify(rejected.value)); assert.equal(rejected.value.noEffect,true);
  assert.equal((await admin.request(`/workbench/business-actions/operations/${stale.opKey}`)).value.status,'failed');
  assert.equal((await unrelated.request(`/workbench/business-actions/operations/${input.opKey}`)).status,404);
  const current = (await admin.request(contextPath)).value;
  const race = await Promise.all([7000,8000].map(value => admin.request('/workbench/business-actions/execute','POST',prepare(current,value))));
  assert.equal(race.filter(r=>r.value.status==='succeeded').length,1,JSON.stringify(race));
  assert.equal(race.filter(r=>r.value.status==='failed'&&r.value.noEffect===true).length,1,JSON.stringify(race));
  const before = (await databaseClient.query('SELECT order_prepayment_amount FROM forge_sales_contract WHERE id=$1',[contractId])).rows[0].order_prepayment_amount;
  const fresh = (await admin.request(contextPath)).value, failingInput = prepare(fresh,9000);
  assert.equal((await admin.request('/__test/receipt-fault','POST',{}, {Authorization:`Bearer ${launcherSecret}`})).status,200);
  const unknown = await admin.request('/workbench/business-actions/execute','POST',failingInput);
  assert.equal(unknown.value.status,'unknown',JSON.stringify(unknown.value));
  assert.equal((await databaseClient.query('SELECT order_prepayment_amount FROM forge_sales_contract WHERE id=$1',[contractId])).rows[0].order_prepayment_amount,before,'real native action mutation rolls back when operation receipt persistence fails');
  assert.equal((await admin.request(`/workbench/business-actions/operations/${failingInput.opKey}`)).value.status,'unknown');
  assert.equal((await admin.request('/workbench/business-actions/execute','POST',failingInput)).value.status,'unknown','same request is never replayed');
  const work = await admin.request('/workbench/business-work?limit=100');
  assert.equal(work.status,200,JSON.stringify(work.value)); assert.equal(work.value.version,'1'); assert.equal(work.value.readStatus,'complete',JSON.stringify(work.value));
  // Real native permissions, field-file binding and cross-employee originals.
  const employees = {};
  for (const [key, position, permission] of [
    ['signature','contract_signature_registrar','contract_signature_registrar'],
    ['finance','finance_receivables_operator','forge_finance_receivables_operator'],
    ['financeReviewer','finance_reviewer','forge_finance_reviewer'],
  ]) {
    const client=await createEmployee(admin,organizationId,key); employees[key]=client;
    const permissionId=(await databaseClient.query('SELECT id FROM sys_permission_set WHERE name=$1',[permission])).rows[0]?.id;
    assert.ok(permissionId,permission);
    assert.ok((await admin.request('/data/sys_user_permission_set','POST',{user_id:client.userId,permission_set_id:permissionId,organization_id:organizationId,granted_by:admin.userId,reason:'隔离业务测试'})).status<300);
    await databaseClient.query('INSERT INTO sys_position (id,name,label,active,organization_id) VALUES ($1,$2,$3,true,$4)',[randomUUID(),position,position,organizationId]);
    await databaseClient.query('INSERT INTO sys_user_position (id,user_id,position,organization_id) VALUES ($1,$2,$3,$4)',[randomUUID(),client.userId,position,organizationId]);
  }
  async function seedFile(client,parameter) {
    const file=await admin.request('/__test/seed-file','POST',{actorId:client.userId,organizationId},{Authorization:`Bearer ${launcherSecret}`});
    assert.equal(file.status,200,JSON.stringify(file.value));
    return {...file.value,parameter,sha256:createHash('sha256').update('%PDF-1.7 INTERNAL SYNTHETIC TEST').digest('hex')};
  }
  async function executeEmployee(client,objectName,recordId,actionName,values,file) {
    const opened=await client.request(`/workbench/business-actions/context?objectName=${objectName}&recordId=${recordId}`);
    assert.equal(opened.status,200,JSON.stringify(opened.value));
    const context=opened.value, action=context.actions.find(a=>a.capabilityId.endsWith('.'+actionName));
    assert.ok(action,JSON.stringify(context));
    const input={version:'1',contextId:context.contextId,contextVersion:context.contextVersion,opKey:randomUUID(),employeeMessage:{sessionId:randomUUID(),messageId:randomUUID(),sha256:'b'.repeat(64)},action_ref:action.action_ref,values,...(file?{file}:{})};
    const result=await client.request('/workbench/business-actions/execute','POST',input);
    assert.equal(result.status,200,JSON.stringify(result.value)); assert.equal(result.value.status,'succeeded',JSON.stringify(result.value));
    return result.value;
  }
  const signFile=await seedFile(employees.signature,'signed_evidence_attachment');
  await executeEmployee(employees.signature,'forge_sales_contract',contractId,'contract_register_signature',{signed_on:'2026-10-03',signed_evidence_note:'内部合成测试，不发生真实签署'},signFile);
  const signatureBinding=(await databaseClient.query('SELECT ref_object,ref_id,ref_field FROM sys_file WHERE id=$1',[signFile.fileId])).rows[0];
  assert.deepEqual(signatureBinding,{ref_object:'forge_sales_contract',ref_id:contractId,ref_field:'signed_evidence_attachment'});
  const signatureRead=await fetch(`http://${HOST}:${port}/api/v1/storage/files/${signFile.fileId}`,{headers:{Cookie:employees.finance.cookie}});
  assert.equal(signatureRead.status,200); assert.equal(createHash('sha256').update(Buffer.from(await signatureRead.arrayBuffer())).digest('hex'),signFile.sha256);
  assert.ok((await fetch(`http://${HOST}:${port}/api/v1/storage/files/${signFile.fileId}`,{headers:{Cookie:unrelated.cookie}})).status>=400);
  const accountId=idOf(await admin.request('/data/forge_fund_account','POST',{name:'合成公司账户',code:`AC-${suffix}`,account_type:'bank',currency:'cny',opening_on:'2026-10-03',responsible_id:admin.userId,status:'active'}),'fund account');
  const financeContext=await employees.finance.request(contextPath);
  assert.equal(financeContext.status,200,JSON.stringify(financeContext.value));
  const payAction=financeContext.value.actions.find(a=>a.capabilityId.endsWith('.contract_register_customer_prepayment'));
  assert.equal(payAction.parameters.find(p=>p.name==='account_id').enumLabels.find(v=>v.value===accountId).label,'合成公司账户');
  const receiptFile=await seedFile(employees.finance,'receipt_evidence_attachment');
  const prepay=await executeEmployee(employees.finance,'forge_sales_contract',contractId,'contract_register_customer_prepayment',{code:`RC-${suffix}`,account_id:accountId,received_on:'2026-10-03',payment_method:'bank_transfer',amount:Number(before),counterpart_reference:`TEST-${suffix}`},receiptFile);
  const prepayId=prepay.recordReferences.find(r=>r.objectName==='forge_customer_prepayment').recordId;
  const receiptRead=await fetch(`http://${HOST}:${port}/api/v1/storage/files/${receiptFile.fileId}`,{headers:{Cookie:employees.financeReviewer.cookie}});
  assert.equal(receiptRead.status,200); assert.equal(createHash('sha256').update(Buffer.from(await receiptRead.arrayBuffer())).digest('hex'),receiptFile.sha256);
  assert.ok((await fetch(`http://${HOST}:${port}/api/v1/storage/files/${receiptFile.fileId}`,{headers:{Cookie:unrelated.cookie}})).status>=400);
  await executeEmployee(employees.financeReviewer,'forge_customer_prepayment',prepayId,'customer_prepayment_confirm',{confirmation_comment:'已独立核对合成到账原件与金额'});
  const reviewWork=await employees.financeReviewer.request('/workbench/business-work?limit=1');
  assert.equal(reviewWork.status,200,JSON.stringify(reviewWork.value));
  assert.equal(reviewWork.value.readStatus,'complete',JSON.stringify(reviewWork.value));

  const developerPermission=(await databaseClient.query('SELECT id FROM sys_permission_set WHERE name=$1',['weave_team_developer'])).rows[0]?.id;
  assert.ok(developerPermission);
  assert.ok((await admin.request('/data/sys_user_permission_set','POST',{user_id:unrelated.userId,permission_set_id:developerPermission,organization_id:organizationId,granted_by:admin.userId,reason:'隔离能力定义读取'})).status<300);
  const developerCatalog=await unrelated.request('/workbench/business-actions/catalog');
  assert.equal(developerCatalog.status,200,JSON.stringify(developerCatalog.value));
  assert.equal(developerCatalog.value.capabilities.find(a=>a.actionName==='contract_submit_material_package')?.status,'available');
  assert.ok((await unrelated.request(contextPath)).status>=400,'developer definitions do not confer business record access');
  // A bounded scan must continue beyond 1000 raw records, and its cursor must
  // be unusable by another employee even in the same organization.
  await databaseClient.query(`INSERT INTO forge_sales_contract (id,name,code,contract_type_id,customer_id,responsible_id,owner_id,organization_id,status,created_at,updated_at)
    SELECT 'page-'||$1||'-'||lpad(n::text,4,'0'),'分页合成记录','PAGE-'||$1||'-'||n,$2,$3,$4,$4,$5,'active',now(),now() FROM generate_series(1,1002) n`,[suffix,contractTypeId,customerId,unrelated.userId,organizationId]);
  const tailId='page-'+suffix+'-zzzz';
  await databaseClient.query("INSERT INTO forge_sales_contract (id,name,code,contract_type_id,customer_id,responsible_id,owner_id,organization_id,status,created_at,updated_at) VALUES($1,'分页末尾本人事项',$2,$3,$4,$5,$5,$6,'active',now(),now())",[tailId,'PAGE-END-'+suffix,contractTypeId,customerId,admin.userId,organizationId]);
  let cursor, found=false, pages=0;
  do {
    const page=await admin.request('/workbench/business-work?limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
    assert.equal(page.status,200,JSON.stringify(page.value)); assert.equal(page.value.readStatus,'complete',JSON.stringify(page.value));
    found ||= page.value.items.some(item=>item.record.recordId===tailId);
    cursor=page.value.nextCursor;
    if(cursor && pages===0) assert.equal((await unrelated.request('/workbench/business-work?limit=1&cursor='+encodeURIComponent(cursor))).status,400);
    assert.ok(++pages<10,'keyset paging must advance');
  } while(cursor);
  assert.equal(found,true,'eligible record after the first 1000 raw rows remains reachable');

});
