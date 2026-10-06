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
import { exerciseOrderProjectHandoff } from './order-project-handoff.fixture.mjs';

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
    ? 'set FORGE_EMPLOYEE_BUSINESS_PG_TEST=1 for the isolated native PostgreSQL runtime test'
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
import { quotationContentDigest } from ${JSON.stringify(path.join(APP_DIR, 'src/plugins/sales-quotation-readiness.ts'))};
import { employeeBusinessBinding } from ${JSON.stringify(path.join(APP_DIR, 'src/plugins/employee-business-binding.ts'))};
export class ApprovalFlowLauncherPlugin {
 name = 'com.inoforge.forge.test.employee-receipt-fault'; version = '1.0.0'; type = 'standard';
 init(ctx) { ctx.hook('kernel:ready', () => {
  const engine = ctx.getService('objectql'), original = engine.update, originalInsert = engine.insert, originalAction = engine.executeAction; let armed = false, uncertainRace, nativeFailure, startRace;
  let projectFieldFault;const security=ctx.getService('security'),readFields=security.getReadableFields.bind(security),readOne=engine.findOne,readMany=engine.find;
  security.getReadableFields=async(object,actor)=>{if(projectFieldFault?.object===object){if(projectFieldFault.answer==='undefined')return undefined;if(projectFieldFault.answer==='null')return null;if(projectFieldFault.answer==='throw')throw new Error('isolated FLS no answer');}return readFields(object,actor);};
  engine.findOne=async function(object,query,options){const value=await readOne.call(this,object,query,options);if(projectFieldFault?.omit&&projectFieldFault.object===object&&options?.context?.isSystem!==true&&value){const copy={...value};delete copy[projectFieldFault.omit];return copy;}return value;};
  engine.find=async function(object,query,options){const values=await readMany.call(this,object,query,options);if(projectFieldFault?.omit&&projectFieldFault.object===object&&options?.context?.isSystem!==true)return values.map(value=>{const copy={...value};delete copy[projectFieldFault.omit];return copy;});return values;};
  ctx.getService('http.server').post('/api/v1/__test/project-field-fault',async(req,res)=>{if(req.headers?.authorization!=='Bearer ${launcherSecret}'){await res.status(403).json({error:'forbidden'});return;}projectFieldFault=req.body.object?req.body:undefined;await res.status(200).json({armed:!!projectFieldFault});});
  let memberShape, memberAuditFault; engine.registerHook('beforeUpdate',hook=>{const input=hook.input?.data||hook.input;memberShape={keys:Object.keys(input||{}).sort(),hasPrevious:!!hook.previous?.id,duty:input?.member_duty,active:input?.active};if(memberAuditFault){const mode=memberAuditFault;memberAuditFault=undefined;if(mode==='actor')input.updated_by='forged-actor';else input.updated_at=new Date(Date.now()+(mode==='future'?60000:-60000)).toISOString();}},{object:'forge_project_member',priority:109,packageId:this.name});
  ctx.getService('http.server').post('/api/v1/__test/start-race',async(req,res)=>{if(req.headers?.authorization!=='Bearer ${launcherSecret}'){await res.status(403).json({error:'forbidden'});return;}startRace={...req.body,attempts:0,entered:false,bReserved:false};startRace.bPassed=new Promise(resolve=>{startRace.releaseAPrecheck=resolve;});startRace.aEntered=new Promise(resolve=>{startRace.releaseB=resolve;});startRace.bReady=new Promise(resolve=>{startRace.releaseA=resolve;});await res.status(200).json({armed:true});});
  ctx.getService('http.server').post('/api/v1/__test/start-race-state',async(req,res)=>{if(req.headers?.authorization!=='Bearer ${launcherSecret}'){await res.status(403).json({error:'forbidden'});return;}await res.status(200).json({attempts:startRace?.attempts,entered:startRace?.entered,bReserved:startRace?.bReserved,nativeFailure});});
  ctx.getService('http.server').post('/api/v1/__test/native-failure',async(req,res)=>{if(req.headers?.authorization!=='Bearer ${launcherSecret}'){await res.status(403).json({error:'forbidden'});return;}await res.status(200).json(nativeFailure||{});});
  ctx.getService('http.server').post('/api/v1/__test/member-audit-fault',async(req,res)=>{if(req.headers?.authorization!=='Bearer ${launcherSecret}'){await res.status(403).json({error:'forbidden'});return;}memberAuditFault=req.body.mode;await res.status(200).json({armed:true});});
  ctx.getService('http.server').post('/api/v1/__test/remove-project-link',async(req,res)=>{if(req.headers?.authorization!=='Bearer ${launcherSecret}'){await res.status(403).json({error:'forbidden'});return;}try{await engine.transaction(async transaction=>{const link=await engine.findOne('forge_project_sales_link',{where:{id:req.body.linkId,organization_id:req.body.organizationId}},{context:transaction});if(!link)throw new Error('isolated link not found');await engine.delete('forge_project_sales_link',{where:{id:link.id},context:transaction});},{isSystem:true,userId:req.body.actorId,tenantId:req.body.organizationId},{require:true});await res.status(200).json({removed:true});}catch(error){await res.status(500).json({error:String(error)});}});
  ctx.getService('http.server').post('/api/v1/__test/native-share',async(req,res)=>{if(req.headers?.authorization!=='Bearer ${launcherSecret}'){await res.status(403).json({error:'forbidden'});return;}try{const value=await ctx.getService('sharing').grant(req.body.grant,{isSystem:true,userId:req.body.actorId,tenantId:req.body.organizationId});await res.status(200).json({id:value.id});}catch(error){await res.status(500).json({error:String(error)});}});
  ctx.getService('http.server').post('/api/v1/__test/member-shape',async(req,res)=>{if(req.headers?.authorization!=='Bearer ${launcherSecret}'){await res.status(403).json({error:'forbidden'});return;}await res.status(200).json(memberShape||{});});
  engine.update = async function(object, data, options) {
   if (armed && object === 'forge_employee_business_operation' && data.status === 'succeeded') { armed = false; throw new Error('injected receipt persistence failure'); }
   return original.call(this, object, data, options);
  };
  engine.insert = async function(object, data, options) {
   if (object === 'forge_employee_business_operation' && data.status === 'in_progress' && uncertainRace) {
    if (data.operation_key === uncertainRace.a) await uncertainRace.bReserved;
    if (data.operation_key === uncertainRace.b) { uncertainRace.releaseA(); await uncertainRace.nativeAttempt; }
   }
   if(startRace&&object==='forge_employee_business_operation'&&data.status==='in_progress'){if(data.operation_key===startRace.a)await startRace.bPassed;if(data.operation_key===startRace.b){startRace.releaseAPrecheck();await startRace.aEntered;}}
   const inserted=await originalInsert.call(this,object,data,options);if(startRace&&object==='forge_employee_business_operation'&&data.status==='in_progress'&&data.operation_key===startRace.b){startRace.bReserved=true;startRace.releaseA();}return inserted;
  };
  engine.executeAction = async function(object, name, action) {
   if(startRace&&object==='forge_project'&&name==='forgeStartProject'&&action.record?.id===startRace.recordId){const bound=employeeBusinessBinding();startRace.attempts++;if(startRace.attempts===1){startRace.entered=true;startRace.releaseB();await startRace.bReady;}}
   if (uncertainRace && object === 'forge_quotation' && name === 'forgeSubmitQuotation' && action.record?.id === uncertainRace.recordId) {
    uncertainRace.attempts++; uncertainRace.releaseB(); throw new Error('injected uncertain native dispatch before mutation');
   }
   try{return await originalAction.call(this, object, name, action);}catch(error){nativeFailure={message:String(error.message),name:String(error.name)};throw error;}
  };
  ctx.getService('http.server').post('/api/v1/__test/uncertain-race', async(req,res) => {
   if (req.headers?.authorization !== 'Bearer ${launcherSecret}') { await res.status(403).json({error:'forbidden'}); return; }
   uncertainRace = { a:req.body.a, b:req.body.b, recordId:req.body.recordId, attempts:0 };
   uncertainRace.bReserved = new Promise(resolve => { uncertainRace.releaseA=resolve; });
   uncertainRace.nativeAttempt = new Promise(resolve => { uncertainRace.releaseB=resolve; });
   await res.status(200).json({armed:true});
  });
  ctx.getService('http.server').post('/api/v1/__test/uncertain-race-result', async(req,res) => {
   if (req.headers?.authorization !== 'Bearer ${launcherSecret}') { await res.status(403).json({error:'forbidden'}); return; }
   const attempts=uncertainRace?.attempts; uncertainRace=undefined; await res.status(200).json({attempts});
  });
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
  // Isolated pre-upgrade submission fixture. It creates a new native request
  // with header-only material, never rewrites an existing request's payload.
  ctx.getService('http.server').post('/api/v1/__test/legacy-quote-submit', async(req,res) => {
   if (req.headers?.authorization !== 'Bearer ${launcherSecret}') { await res.status(403).json({error:'forbidden'}); return; }
   try { const system={isSystem:true,userId:req.body.actorId,tenantId:req.body.organizationId,positions:[],permissions:[]};
   await engine.transaction(async transaction => {
    const quote=await engine.findOne('forge_quotation',{where:{id:req.body.recordId,organization_id:req.body.organizationId}},{context:transaction});
    if(!quote||quote.status!=='draft'||quote.owner_id!==req.body.actorId)throw new Error('legacy fixture binding refused');
    const lines=await engine.find('forge_quotation_line',{where:{quotation_id:quote.id,organization_id:req.body.organizationId},limit:101},{context:transaction});
    const round=value=>Math.round((value+Number.EPSILON)*10000)/10000;
    const subtotal=round(lines.reduce((sum,line)=>sum+Number(line.quantity)*Number(line.taxed_unit_price),0)),total=round(lines.reduce((sum,line)=>sum+Number(line.taxed_subtotal),0));
    const totals={item_count:lines.length,subtotal,discount_amount:round(subtotal-total),tax_amount:round(lines.reduce((sum,line)=>sum+Number(line.taxed_subtotal)-Number(line.taxed_subtotal)/(1+Number(line.tax_rate)/100),0)),total_amount:total};
    const submittedAt=new Date().toISOString(),content=await quotationContentDigest({...quote,...totals},lines);
    await engine.update('forge_quotation',{id:quote.id,...totals,submitted_line_snapshot:null,submitted_pricing_version:Number(quote.pricing_version),submitted_content_sha256:content,
      submitted_at:submittedAt,submitted_by:req.body.actorId,submitted_action_receipt:JSON.stringify({id:quote.id,status:'pending_approval',submitted_pricing_version:Number(quote.pricing_version),submitted_at:submittedAt}),status:'pending_approval'},{context:transaction});
   },system,{require:true}); await res.status(200).json({submitted:true});
   }catch(error){await res.status(500).json({error:String(error)});}
  });
 }); }
}
`);
  await writeFile(path.join(tempDir, 'objectstack.config.ts'), `
import stack from ${JSON.stringify(path.join(APP_DIR, 'objectstack.config.ts'))};
import { AppPlugin } from '@objectstack/runtime';
import { definePermissionSet } from '@objectstack/spec';
import { sharedForgeCorePlugin, sharedForgeCoreBundle } from ${JSON.stringify(path.join(APP_DIR, 'src/apps/shared-core.ts'))};
import { ApprovalFlowLauncherPlugin } from './approval-flow-launcher.plugin.mjs';
// Exercise the real employee-only signature handler under the current native confirmation gate.
stack.plugins=stack.plugins.map(plugin=>plugin===sharedForgeCorePlugin?new AppPlugin({...sharedForgeCoreBundle,
 permissions:[...sharedForgeCoreBundle.permissions,definePermissionSet({name:'test_project_header_mask',label:'隔离项目订单编号拒绝',objects:{},fields:{'forge_sales_order.code':{readable:false}}}),definePermissionSet({name:'test_project_price_mask',label:'隔离项目订单单价拒绝',objects:{},fields:{'forge_sales_order_line.taxed_unit_price':{readable:false}}}),definePermissionSet({name:'test_quotation_price_mask',label:'隔离报价单价字段拒绝',fields:{'forge_quotation_line.taxed_unit_price':{readable:false}},objects:{forge_quotation:{allowRead:true,readScope:'org'},forge_quotation_line:{allowRead:true,readScope:'org'}}})],
 actions:sharedForgeCoreBundle.actions.map(action=>action.name==='contract_register_signature'
  ?{...action,ai:{...action.ai,requiresConfirmation:true}}:action)}):plugin);
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
  async function startRuntime() {
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
        FORGE_IDENTITY_ISSUER: 'forge:employee-business-test-' + suffix,
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
  }
  await startRuntime();

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
  assert.ok(race.filter(r=>r.value.status==='succeeded').length<=1,JSON.stringify(race));
  assert.equal(race.filter(r=>r.value.status==='succeeded'||r.value.status==='failed'&&r.value.noEffect===true).length,2,JSON.stringify(race));
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
  if (process.env.FORGE_ORDER_PROJECT_PG_ONLY === '1') {
    await t.test('exact approved order project handoff', async () => exerciseOrderProjectHandoff({admin,organizationId,suffix,databaseClient,createEmployee,idOf,executeEmployee,seedFile,mcpData,mcpText,stopRuntime,startRuntime,launcherSecret,secrets,port,t}));
    return;
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
  assert.equal(reviewWork.value.readStatus,'partial',JSON.stringify(reviewWork.value));
  assert.ok(reviewWork.value.sourceErrors.some(error=>error.kind==='quotation_follow_up'&&error.code==='BUSINESS_WORK_SOURCE_FORBIDDEN'),'an unreadable quotation source must not be reported as zero work');

  // Quotation follow-up uses the same real employee connection, native
  // approval service, owned originals and existing formal domain actions.
  const quotePermission=(await databaseClient.query("SELECT id FROM sys_permission_set WHERE name='sales_quotation_draft_operator'")).rows[0]?.id;
  assert.ok(quotePermission);
  assert.ok((await admin.request('/data/sys_user_permission_set','POST',{user_id:admin.userId,permission_set_id:quotePermission,organization_id:organizationId,granted_by:admin.userId,reason:'隔离报价本人办理'})).status<300);
  const reviewer=await createEmployee(admin,organizationId,'quotationReviewer');
  const reviewerPermission=(await databaseClient.query("SELECT id FROM sys_permission_set WHERE name='sales_quotation_reviewer'")).rows[0]?.id;
  assert.ok(reviewerPermission);
  assert.ok((await admin.request('/data/sys_user_permission_set','POST',{user_id:reviewer.userId,permission_set_id:reviewerPermission,organization_id:organizationId,granted_by:admin.userId,reason:'隔离独立报价复核'})).status<300);
  await databaseClient.query("INSERT INTO sys_position (id,name,label,active,organization_id) VALUES ($1,'sales_quotation_reviewer','销售报价审批',true,$2)",[randomUUID(),organizationId]);
  await databaseClient.query("INSERT INTO sys_user_position (id,user_id,position,organization_id) VALUES ($1,$2,'sales_quotation_reviewer',$3)",[randomUUID(),reviewer.userId,organizationId]);
  const quoteType=idOf(await admin.request('/data/forge_quotation_type','POST',{name:'本人连接合成报价类型',code:'EQT-'+suffix,status:'active'}),'quotation type');
  const issuer=idOf(await admin.request('/data/forge_quotation_issuer','POST',{name:'本人连接合成报价主体',credit_code:'EQI-'+suffix}),'quotation issuer');
  async function makeQuote(label) {
    const id=idOf(await admin.request('/data/forge_quotation','POST',{name:'TEST 本人连接报价 '+label,code:'EQ-'+suffix+'-'+label,
      customer_id:customerId,quotation_type_id:quoteType,issuer_id:issuer,quotation_date:'2026-10-06',valid_until:'2099-12-31',responsible_id:admin.userId}),'quotation');
    const lines=[];
    for(const [name,quantity,price,tax] of [['TEST设备服务',2,900,13],['TEST培训服务',1,300,0]]) lines.push(idOf(await admin.request('/data/forge_quotation_line','POST',{
      name,quotation_id:id,line_type:'service',quantity,taxed_unit_price:price,tax_rate:tax,discount_rate:0,taxed_subtotal:quantity*price,sort_order:lines.length+1}),'quotation line'));
    return {id,lines};
  }
  const quote=await makeQuote('complete'), quotePath='/workbench/business-actions/context?objectName=forge_quotation&recordId='+quote.id;
  async function quoteContext() {
    const result=await admin.request(quotePath); assert.equal(result.status,200,JSON.stringify(result.value)); return result.value;
  }
  function quoteInput(context,name,values={},file) {
    const action=context.actions.find(item=>item.capabilityId==='forge:action:forge_quotation.'+name);
    assert.ok(action,JSON.stringify(context));
    return {version:'1',contextId:context.contextId,contextVersion:context.contextVersion,opKey:randomUUID(),
      employeeMessage:{sessionId:randomUUID(),messageId:randomUUID(),sha256:'c'.repeat(64)},action_ref:action.action_ref,values,...(file?{file}:{})};
  }
  async function assertQuoteReceipt(input) {
    const result=await admin.request('/workbench/business-actions/execute','POST',input);
    assert.equal(result.status,200,JSON.stringify(result.value)); assert.equal(result.value.status,'succeeded',JSON.stringify(result.value));
    const repeated=await admin.request('/workbench/business-actions/execute','POST',input);
    assert.equal(repeated.value.repeated,true); assert.deepEqual({...repeated.value,repeated:false},result.value,'same input returns the original complete receipt');
    return result.value;
  }
  const freshQuoteCatalog=await admin.request('/workbench/business-actions/catalog');
  const quotationActions=['quotation_submit','quotation_send','quotation_accept','quotation_convert_to_contract'];
  for(const name of quotationActions) assert.equal(freshQuoteCatalog.value.capabilities.find(item=>item.objectName==='forge_quotation'&&item.actionName===name)?.executionMode,'employee_only',name);
  const draft=await quoteContext();
  assert.deepEqual(draft.actions.map(item=>item.capabilityId),['forge:action:forge_quotation.quotation_submit']);
  assert.deepEqual(draft.actions[0].parameters,[],'submit has no model-controlled version, idempotency or confirmation input');
  const draftWork=await admin.request('/workbench/business-work?limit=100');
  const workQuote=draftWork.value.items.find(item=>item.record.recordId===quote.id);
  assert.equal(workQuote?.kind,'quotation_follow_up'); assert.equal(workQuote.recordVersion,draft.recordVersion);
  assert.ok([403,404].includes((await unrelated.request(quotePath)).status),'unrelated employee cannot read the quotation context');
  const staleInput=quoteInput(draft,'quotation_submit');
  await databaseClient.query('UPDATE forge_quotation_line SET quantity=3 WHERE id=$1',[quote.lines[0]]);
  const staleQuote=await admin.request('/workbench/business-actions/execute','POST',staleInput);
  assert.equal(staleQuote.value.status,'failed'); assert.equal(staleQuote.value.noEffect,true,'line changes reject the old frozen context before dispatch');
  await databaseClient.query('UPDATE forge_quotation_line SET quantity=2 WHERE id=$1',[quote.lines[0]]);
  const issueScope={input_revision_id:randomUUID(),registration_id:randomUUID(),task_sha256:'d'.repeat(64),workflow_id:'test-quotation-read',workflow_version:1,
    allowed_actions:[],resources:[],business_record:{object_name:'forge_quotation',record_id:quote.id}};
  for(const name of quotationActions) {
    const denied=await admin.request('/apps/forge/task-delegations','POST',{request_id:randomUUID(),scope:{...issueScope,input_revision_id:randomUUID(),allowed_actions:['forge:action:forge_quotation.'+name]}});
    assert.equal(denied.status,403,'human issuance cannot delegate '+name);
  }
  const delegation=await admin.request('/apps/forge/task-delegations','POST',{request_id:randomUUID(),scope:issueScope});
  assert.equal(delegation.status,200,JSON.stringify(delegation.value));
  const taskToken=delegation.value.access_token; assert.ok(taskToken);
  secrets.push(taskToken);
  async function taskRequest(resource,method='GET',body) {
    const response=await fetch(`http://${HOST}:${port}/api/v1${resource}`,{method,headers:{Authorization:'Bearer '+taskToken,Origin:`http://${HOST}:${port}`,Accept:'application/json, text/event-stream',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const raw=await response.text(), lines=raw.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(Boolean);
    return {status:response.status,value:JSON.parse(lines.at(-1)||raw)};
  }
  assert.equal((await taskRequest('/apps/forge/task-delegations/mcp','POST',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'employee-quotation-task-refusal',version:'1'}}})).status,200);
  const delegatedCatalog=await taskRequest('/apps/forge/task-delegations/mcp','POST',{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'list_actions',arguments:{}}});
  assert.equal(delegatedCatalog.status,200); assert.ok(!JSON.stringify(delegatedCatalog.value).includes('quotation_submit'));
  const delegatedObject=await taskRequest('/apps/forge/task-delegations/objects/forge_quotation');
  assert.equal(delegatedObject.status,200); assert.ok(!JSON.stringify(delegatedObject.value).includes('quotation_submit'));
  for(const name of quotationActions) {
    const denied=await taskRequest('/apps/forge/task-delegations/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'run_action',arguments:{actionName:name,objectName:'forge_quotation',recordId:quote.id,params:{},confirm:true}}});
    assert.ok(denied.status===403||denied.value?.result?.isError||denied.value?.error,'actual task token cannot execute '+name);
  }
  const taskContext=await taskRequest(quotePath); assert.ok([401,403].includes(taskContext.status),'task token cannot enter employee context');
  const submitContext=await quoteContext(), submitInput=quoteInput(submitContext,'quotation_submit');
  const competing=await Promise.all([submitInput,{...submitInput,opKey:randomUUID()}].map(input=>admin.request('/workbench/business-actions/execute','POST',input)));
  assert.ok(competing.filter(item=>item.value.status==='succeeded').length<=1,JSON.stringify(competing));
  assert.equal(competing.filter(item=>item.value.status==='succeeded'||item.value.status==='failed'&&item.value.noEffect).length,2,JSON.stringify(competing));
  const winning=competing.find(item=>item.value.status==='succeeded');
  const submitReceipt=winning?.value||await assertQuoteReceipt(quoteInput(await quoteContext(),'quotation_submit'));
  assert.equal((await admin.request('/workbench/business-actions/operations/'+submitReceipt.operationId)).value.status,'succeeded');
  assert.deepEqual((await quoteContext()).actions,[],'pending approval stays owner-read-only');
  assert.ok(!(await admin.request('/workbench/business-work?limit=100')).value.items.some(item=>item.record.recordId===quote.id),'owner work does not duplicate native pending approval');
  await stopRuntime(); await startRuntime();
  assert.equal((await admin.request('/workbench/business-actions/operations/'+submitReceipt.operationId)).value.status,'succeeded','receipt survives a full restart on the same PostgreSQL');
  const requests=await reviewer.request('/approvals/requests');
  const nativeRequest=(requests.value?.data?.items||requests.value?.data?.records||requests.value?.items||requests.value?.records||requests.value?.data||[]).find(item=>item.object_name==='forge_quotation'&&item.record_id===quote.id&&item.status==='pending');
  assert.ok(nativeRequest,JSON.stringify(requests.value));
  const approval=await reviewer.request('/approvals/requests/'+nativeRequest.id+'/workbench-context');
  assert.equal(approval.status,200,JSON.stringify(approval.value));
  const approve=approval.value.availableActions.find(item=>item.semantic==='approve'); assert.ok(approve);
  const selfApprove=await admin.callMcpTool('run_action',{actionName:'quotation_approval_mcp_approve',objectName:'forge_quotation',recordId:quote.id,params:{...approve.execution.params,comment:'禁止自审'},confirm:true});
  assert.equal(selfApprove.isError,true);
  const decided=await reviewer.callMcpTool('run_action',{actionName:approve.execution.actionName,objectName:approve.execution.objectName,
    recordId:approve.execution.recordId,params:{...approve.execution.params,comment:'TEST独立核对合成报价'},confirm:true});
  assert.equal(mcpData(decided)?.result?.decision,'approve',mcpText(decided));
  const approved=await quoteContext();
  assert.deepEqual(approved.actions.map(item=>item.capabilityId),['forge:action:forge_quotation.quotation_send']);
  const sendFile=await seedFile(admin,'sent_evidence_attachment'), sendInput=quoteInput(approved,'quotation_send',{sent_evidence_note:'TEST 仅登记合成发送凭证，不发送外部邮件'},sendFile);
  const changedFile=await admin.request('/workbench/business-actions/execute','POST',{...sendInput,opKey:randomUUID(),file:{...sendFile,name:'替换名称.pdf'}});
  assert.equal(changedFile.value.status,'failed'); assert.equal(changedFile.value.noEffect,true);
  const modelFile=await admin.request('/workbench/business-actions/execute','POST',{...sendInput,opKey:randomUUID(),values:{...sendInput.values,sent_evidence_attachment:sendFile.fileId},file:null});
  assert.equal(modelFile.value.status,'failed'); assert.equal(modelFile.value.noEffect,true,'a model scalar cannot supply a fileId');
  const sendReceipt=await assertQuoteReceipt(sendInput);
  const sent=await quoteContext(); assert.deepEqual(sent.actions.map(item=>item.capabilityId),['forge:action:forge_quotation.quotation_accept']);
  const acceptFile=await seedFile(admin,'customer_acceptance_evidence_attachment');
  const acceptReceipt=await assertQuoteReceipt(quoteInput(sent,'quotation_accept',{customer_acceptance_note:'TEST 客户材料登记，不代表真实客户同意'},acceptFile));
  const accepted=await quoteContext();
  const convert=accepted.actions.find(item=>item.capabilityId.endsWith('.quotation_convert_to_contract')); assert.ok(convert);
  const types=convert.parameters.find(item=>item.name==='contract_type_id');
  assert.ok(types.enum.includes(contractTypeId)); assert.equal(types.enumLabels.find(item=>item.value===contractTypeId).label,'业务连接合成合同类型');
  const duplicateType=idOf(await admin.request('/data/forge_contract_type','POST',{name:'业务连接合成合同类型',code:'EQT-DUP-'+suffix,status:'active'}),'ambiguous contract type');
  const ambiguous=await admin.request(quotePath); assert.equal(ambiguous.status,503); assert.equal(ambiguous.value.error.code,'EMPLOYEE_ACTION_LOOKUP_AMBIGUOUS');
  assert.ok((await admin.request('/data/forge_contract_type/'+duplicateType,'DELETE')).status<300);
  const convertInput=quoteInput(accepted,'quotation_convert_to_contract',{contract_type_id:contractTypeId,code:'EQC-'+suffix,name:'TEST 本人报价转换合同',starts_on:'2026-10-06',ends_on:'2027-10-06'});
  const converted=await assertQuoteReceipt(convertInput), references=converted.recordReferences;
  assert.equal(references.length,2); assert.equal(references[0].objectName,'forge_quotation'); assert.equal(references[0].recordId,quote.id);
  assert.equal(references[1].objectName,'forge_sales_contract'); assert.equal(references[1].label,'TEST 本人报价转换合同');
  const contract=(await databaseClient.query('SELECT quotation_id,total_amount,quotation_source_type,status FROM forge_sales_contract WHERE id=$1',[references[1].recordId])).rows[0];
  assert.deepEqual({...contract,total_amount:Number(contract.total_amount)},{quotation_id:quote.id,total_amount:2100,quotation_source_type:'formal_conversion',status:'draft'});
  const convertedLines=(await databaseClient.query('SELECT quotation_line_id,quantity_limit,taxed_unit_price,tax_rate,discount_rate,taxed_subtotal FROM forge_sales_contract_line WHERE contract_id=$1 ORDER BY taxed_unit_price DESC',[references[1].recordId])).rows;
  assert.deepEqual(convertedLines.map(item=>[item.quotation_line_id,Number(item.quantity_limit),Number(item.taxed_unit_price),Number(item.tax_rate),Number(item.discount_rate),Number(item.taxed_subtotal)]),[[quote.lines[0],2,900,13,0,1800],[quote.lines[1],1,300,0,0,300]]);
  assert.deepEqual((await quoteContext()).actions,[],'a completed conversion offers no further owner write');
  assert.ok(!(await admin.request('/workbench/business-work?limit=100')).value.items.some(item=>item.record.recordId===quote.id));
  for(const receipt of [sendReceipt,acceptReceipt,converted]) assert.equal((await unrelated.request('/workbench/business-actions/operations/'+receipt.operationId)).status,404);
  // Native header-only legacy request -> real rejection -> same quotation's
  // new employee submission. Every old request and opinion remains immutable.
  const legacyQuote=await makeQuote('legacy-snapshot');
  await databaseClient.query('UPDATE forge_quotation SET pricing_version=1 WHERE id=$1',[legacyQuote.id]);
  assert.equal((await admin.request('/__test/legacy-quote-submit','POST',{recordId:legacyQuote.id,actorId:admin.userId,organizationId},{Authorization:`Bearer ${launcherSecret}`})).status,200);
  async function pendingQuoteRequest(recordId) {
    const inbox=await reviewer.request('/approvals/requests'), data=inbox.value?.data||inbox.value;
    const rows=Array.isArray(data)?data:data?.items||data?.records||[];
    const request=rows.find(item=>item.object_name==='forge_quotation'&&item.record_id===recordId&&item.status==='pending');
    assert.ok(request,'native current reviewer has the exact quotation request'); return request;
  }
  const legacyRequest=await pendingQuoteRequest(legacyQuote.id), legacyPayload=(await databaseClient.query('SELECT payload_json FROM sys_approval_request WHERE id=$1',[legacyRequest.id])).rows[0].payload_json;
  const legacyContext=await reviewer.request('/approvals/requests/'+legacyRequest.id+'/workbench-context');
  assert.equal(legacyContext.status,200,JSON.stringify(legacyContext.value)); assert.equal(legacyContext.value.quotationLines,undefined);
  assert.deepEqual(legacyContext.value.availableActions.map(action=>action.semantic),['reject']);
  assert.equal(legacyContext.value.availableActions[0].execution.requiresConfirmation,true);
  assert.ok(legacyContext.value.fields.some(field=>field.value.includes('未固定完整报价明细')));
  const legacyParams=legacyContext.value.availableActions[0].execution.params;
  const rejectedMissingApprove=await reviewer.callMcpTool('run_action',{actionName:'quotation_approval_mcp_approve',objectName:'forge_quotation',recordId:legacyQuote.id,
    params:{...legacyParams,comment:'不能批准缺少冻结明细的旧请求'},confirm:true});
  assert.equal(rejectedMissingApprove.isError,true,'MCP approval core also refuses header-only requests');
  assert.ok((await reviewer.request('/approvals/requests/'+legacyRequest.id+'/approve','POST',{comment:'不能通过REST绕过缺明细门'})).status>=400);
  assert.equal((await databaseClient.query("SELECT count(*)::int AS count FROM sys_approval_action WHERE request_id=$1 AND action='approve'",[legacyRequest.id])).rows[0].count,0);
  const oldDecision=await reviewer.callMcpTool('run_action',{actionName:'quotation_approval_mcp_reject',objectName:'forge_quotation',recordId:legacyQuote.id,
    params:{...legacyParams,comment:'TEST旧请求未固定两条明细，无法核验'},confirm:true});
  assert.equal(mcpData(oldDecision)?.result?.decision,'reject',mcpText(oldDecision));
  assert.equal((await databaseClient.query('SELECT status FROM forge_quotation WHERE id=$1',[legacyQuote.id])).rows[0].status,'rejected');
  const rejectedContext=(await admin.request('/workbench/business-actions/context?objectName=forge_quotation&recordId='+legacyQuote.id)).value;
  assert.deepEqual(rejectedContext.actions.map(action=>action.capabilityId),['forge:action:forge_quotation.quotation_submit']);
  const roundInput=quoteInput(rejectedContext,'quotation_submit'), roundReceipt=await assertQuoteReceipt(roundInput);
  const newRequest=await pendingQuoteRequest(legacyQuote.id); assert.notEqual(newRequest.id,legacyRequest.id);
  const newContext=await reviewer.request('/approvals/requests/'+newRequest.id+'/workbench-context');
  assert.equal(newContext.status,200,JSON.stringify(newContext.value));
  assert.deepEqual(newContext.value.quotationLines,{version:'1',pricingVersion:1,itemCount:2,totalAmount:2100,rows:[
    {position:1,name:'TEST设备服务',lineType:'service',quantity:2,taxedUnitPrice:900,taxRate:13,discountRate:0,taxedSubtotal:1800},
    {position:2,name:'TEST培训服务',lineType:'service',quantity:1,taxedUnitPrice:300,taxRate:0,discountRate:0,taxedSubtotal:300},
  ]},'the new native payload contains all original quantities, prices, taxes and discounts');
  assert.ok(newContext.value.availableActions.every(action=>action.execution.requiresConfirmation===true));
  const rowsSerialized=JSON.stringify(newContext.value.quotationLines);
  for(const forbidden of [legacyQuote.id,...legacyQuote.lines,organizationId,admin.userId,'cost_price','cost_total']) assert.equal(rowsSerialized.includes(forbidden),false,'business-only line projection');
  assert.equal((await unrelated.request('/approvals/requests/'+newRequest.id+'/workbench-context')).status,404);
  const fixedVersion=newContext.value.sourceMaterialVersion;
  await databaseClient.query('UPDATE forge_quotation_line SET taxed_unit_price=999 WHERE id=$1',[legacyQuote.lines[0]]);
  const readFrozen=await reviewer.request('/approvals/requests/'+newRequest.id+'/workbench-context');
  assert.deepEqual(readFrozen.value.quotationLines,newContext.value.quotationLines,'reading uses frozen rows even when a test-only privileged live row is changed');
  assert.equal(readFrozen.value.sourceMaterialVersion,fixedVersion);
  await databaseClient.query('UPDATE forge_quotation_line SET taxed_unit_price=900 WHERE id=$1',[legacyQuote.lines[0]]);
  const priceMask=(await databaseClient.query("SELECT id FROM sys_permission_set WHERE name='test_quotation_price_mask'")).rows[0]?.id; assert.ok(priceMask);
  const maskAssignment=idOf(await admin.request('/data/sys_user_permission_set','POST',{user_id:reviewer.userId,permission_set_id:priceMask,organization_id:organizationId,granted_by:admin.userId,reason:'隔离冻结明细FLS验证'}),'price mask');
  assert.equal((await reviewer.request('/approvals/requests/'+newRequest.id+'/workbench-context')).status,403,'a required field denial does not turn into partial rows or zero price');
  assert.ok((await admin.request('/data/sys_user_permission_set/'+maskAssignment,'DELETE')).status<300);
  const restoredContext=await reviewer.request('/approvals/requests/'+newRequest.id+'/workbench-context');
  assert.equal(restoredContext.status,200);
  const currentApprove=restoredContext.value.availableActions.find(action=>action.semantic==='approve');
  const approvedRound=await reviewer.callMcpTool('run_action',{actionName:currentApprove.execution.actionName,objectName:'forge_quotation',recordId:legacyQuote.id,
    params:{...currentApprove.execution.params,comment:'TEST完整冻结两行及2100版本已核对'},confirm:true});
  assert.equal(mcpData(approvedRound)?.result?.decision,'approve',mcpText(approvedRound));
  const oldStored=(await databaseClient.query('SELECT status,payload_json FROM sys_approval_request WHERE id=$1',[legacyRequest.id])).rows[0];
  assert.equal(oldStored.status,'rejected'); assert.equal(oldStored.payload_json,legacyPayload,'old payload is neither backfilled nor rewritten');
  assert.equal((await databaseClient.query("SELECT comment FROM sys_approval_action WHERE request_id=$1 AND action='reject'",[legacyRequest.id])).rows[0].comment,'TEST旧请求未固定两条明细，无法核验');
  assert.equal((await databaseClient.query("SELECT count(*)::int AS count FROM sys_approval_request WHERE object_name='forge_quotation' AND record_id=$1",[legacyQuote.id])).rows[0].count,2);
  assert.equal((await admin.request('/workbench/business-actions/execute','POST',roundInput)).value.repeated,true);
  assert.deepEqual((await admin.request('/workbench/business-actions/operations/'+roundReceipt.operationId)).value.recordReferences,roundReceipt.recordReferences,'old operation receipt remains its original submission result after approval');
  const forbiddenNewRound=await admin.callMcpTool('run_action',{actionName:'quotation_submit',objectName:'forge_quotation',recordId:legacyQuote.id,params:{},confirm:true});
  assert.equal(forbiddenNewRound.isError,true,'bare empty params do not reopen or pretend to replay an already approved round');
  assert.equal((await databaseClient.query("SELECT count(*)::int AS count FROM sys_approval_request WHERE object_name='forge_quotation' AND record_id=$1",[legacyQuote.id])).rows[0].count,2);
  const restartQuote=await makeQuote('snapshot-restart'), restartQuoteContext=(await admin.request('/workbench/business-actions/context?objectName=forge_quotation&recordId='+restartQuote.id)).value;
  await assertQuoteReceipt(quoteInput(restartQuoteContext,'quotation_submit'));
  const restartRequest=await pendingQuoteRequest(restartQuote.id), restartBefore=await reviewer.request('/approvals/requests/'+restartRequest.id+'/workbench-context');
  assert.equal(restartBefore.status,200); assert.equal(restartBefore.value.quotationLines.itemCount,2);
  const unknownQuote=await makeQuote('unknown');
  const unknownContext=(await admin.request('/workbench/business-actions/context?objectName=forge_quotation&recordId='+unknownQuote.id)).value;
  const unknownInput=quoteInput(unknownContext,'quotation_submit');
  assert.equal((await admin.request('/__test/receipt-fault','POST',{}, {Authorization:`Bearer ${launcherSecret}`})).status,200);
  const unknownSubmit=await admin.request('/workbench/business-actions/execute','POST',unknownInput);
  assert.equal(unknownSubmit.value.status,'unknown',JSON.stringify(unknownSubmit.value));
  assert.equal((await databaseClient.query('SELECT status FROM forge_quotation WHERE id=$1',[unknownQuote.id])).rows[0].status,'draft');
  assert.equal((await databaseClient.query("SELECT count(*)::int AS count FROM sys_approval_request WHERE object_name='forge_quotation' AND record_id=$1",[unknownQuote.id])).rows[0].count,0,'rollback does not leave a phantom approval');
  await stopRuntime(); await startRuntime();
  const restartAfter=await reviewer.request('/approvals/requests/'+restartRequest.id+'/workbench-context');
  assert.equal(restartAfter.status,200); assert.deepEqual(restartAfter.value.quotationLines,restartBefore.value.quotationLines);
  assert.equal(restartAfter.value.sourceMaterialVersion,restartBefore.value.sourceMaterialVersion,'native frozen rows and exact material version survive full stop/restart on the same PostgreSQL');
  assert.equal((await admin.request('/workbench/business-actions/operations/'+unknownInput.opKey)).value.status,'unknown');
  assert.equal((await admin.request('/workbench/business-actions/execute','POST',unknownInput)).value.status,'unknown','unknown only returns its original operation after restart');
  const newUnknown=await admin.request('/workbench/business-actions/execute','POST',{...unknownInput,opKey:randomUUID()});
  assert.equal(newUnknown.value.status,'failed'); assert.equal(newUnknown.value.code,'EMPLOYEE_ACTION_UNRESOLVED','unknown cannot be bypassed by a new operation key');
  assert.equal((await admin.request('/workbench/business-actions/operations/'+converted.operationId)).value.status,'succeeded');
  assert.deepEqual((await admin.request('/workbench/business-actions/operations/'+converted.operationId)).value.recordReferences,references,'exact new contract references persist on the same database');
  const raceQuote=await makeQuote('uncertain-race');
  const raceContext=(await admin.request('/workbench/business-actions/context?objectName=forge_quotation&recordId='+raceQuote.id)).value;
  const raceA=quoteInput(raceContext,'quotation_submit'), raceB=quoteInput(raceContext,'quotation_submit');
  assert.equal((await admin.request('/__test/uncertain-race','POST',{a:raceA.opKey,b:raceB.opKey,recordId:raceQuote.id},{Authorization:`Bearer ${launcherSecret}`})).status,200);
  const uncertainResults=await Promise.all([raceA,raceB].map(input=>admin.request('/workbench/business-actions/execute','POST',input)));
  assert.equal(uncertainResults[0].value.status,'unknown',JSON.stringify(uncertainResults));
  assert.equal(uncertainResults[1].value.status,'failed',JSON.stringify(uncertainResults));
  assert.equal(uncertainResults[1].value.noEffect,true); assert.equal(uncertainResults[1].value.code,'EMPLOYEE_ACTION_UNRESOLVED');
  const attempts=await admin.request('/__test/uncertain-race-result','POST',{}, {Authorization:`Bearer ${launcherSecret}`});
  assert.equal(attempts.value.attempts,1,'a second key that passed preflight before the first reservation never enters native dispatch after uncertainty');
  assert.equal((await admin.request('/workbench/business-actions/context?objectName=forge_quotation&recordId='+raceQuote.id)).value.recordVersion,raceContext.recordVersion,'uncertain native dispatch did not change the quote version; final blocking is receipt authority, not version drift');
  const expiryQuote=await makeQuote('expiry'), expiryContext=(await admin.request('/workbench/business-actions/context?objectName=forge_quotation&recordId='+expiryQuote.id)).value;
  const expiryInput=quoteInput(expiryContext,'quotation_submit'), expires=Date.now()+2500;
  await databaseClient.query('UPDATE forge_employee_business_context SET expires_at=$1 WHERE id=$2',[new Date(expires).toISOString(),expiryContext.contextId]);
  await databaseClient.query('BEGIN');
  await databaseClient.query('SELECT id FROM forge_quotation WHERE id=$1 FOR UPDATE',[expiryQuote.id]);
  let expiring;
  try {
    expiring=admin.request('/workbench/business-actions/execute','POST',expiryInput);
    let reserved=false;
    while(Date.now()<expires) {
      reserved=Boolean((await databaseClient.query('SELECT id FROM forge_employee_business_operation WHERE operation_key=$1',[expiryInput.opKey])).rows.length);
      if(reserved) break; await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(reserved,true,'the operation passes live preflight and reserves before waiting for the actual business-row lock');
    await new Promise(resolve=>setTimeout(resolve,Math.max(1,expires-Date.now()+50)));
  } finally { await databaseClient.query('COMMIT'); }
  const expired=await expiring;
  assert.equal(expired.value.status,'failed',JSON.stringify(expired.value)); assert.equal(expired.value.noEffect,true);
  assert.equal(expired.value.code,'EMPLOYEE_ACTION_CONTEXT_CHANGED','context expiry is rechecked after the business lock wait and before dispatch');
  assert.equal((await databaseClient.query('SELECT status FROM forge_quotation WHERE id=$1',[expiryQuote.id])).rows[0].status,'draft');

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
  await t.test('exact approved order to project creation, native source sharing and manager startup', async () => {
    await exerciseOrderProjectHandoff({admin,organizationId,suffix,databaseClient,createEmployee,idOf,executeEmployee,seedFile,mcpData,mcpText,stopRuntime,startRuntime,launcherSecret,secrets,port,t});
  });

});
