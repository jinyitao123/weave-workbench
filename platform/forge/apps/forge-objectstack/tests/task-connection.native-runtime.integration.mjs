import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from 'pg';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = '/api/v1/apps/forge/task-delegations';
const OBJECT = 'forge_task_probe_record';
const TARGET_OBJECT = 'forge_task_probe_target_record';
const KEY = `forge:action:${OBJECT}.task_probe_touch`;

test('native auth signing, scoped MCP, session revocation, and native inbox keyset stay authoritative', {
  skip: process.env.FORGE_TASK_CONNECTION_PG_TEST !== '1', timeout: 240_000,
}, async () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const database = `forge_task_connection_${suffix}`;
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'forge-task-connection-'));
  const admin = new Client({ host: '127.0.0.1', port: Number(process.env.FORGE_TASK_PG_PORT ?? 5432),
    user: process.env.FORGE_TASK_PG_USER ?? os.userInfo().username, database: 'postgres' });
  const email = `task-${suffix}@example.test`, password = `Task-${randomBytes(18).toString('hex')}!`;
  const launcher = randomBytes(32).toString('hex'), authSecret = randomBytes(32).toString('hex'), secretKey=randomBytes(32).toString('hex');
  const secrets = [email, password, launcher, authSecret, secretKey];
  let child, output = '', db;
  await admin.connect(); await admin.query(`CREATE DATABASE "${database}"`);
  try {
    await symlink(path.join(APP, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
    await writeFile(path.join(temporary, 'package.json'), '{"type":"module"}\n');
    await writeFile(path.join(temporary, 'objectstack.config.ts'), `
import stack from ${JSON.stringify(path.join(APP, 'objectstack.config.ts'))};
import { sharedForgeCoreBundle, sharedForgeCorePlugin } from ${JSON.stringify(path.join(APP, 'src/apps/shared-core.ts'))};
import { AppPlugin } from '@objectstack/runtime';
import { defineAction } from '@objectstack/spec/ui';
import { ObjectSchema } from '@objectstack/spec/data';
import { currentNativeActor } from ${JSON.stringify(path.join(APP, 'src/plugins/native-task-auth.ts'))};
import { TaskDelegationService } from ${JSON.stringify(path.join(APP, 'src/plugins/task-delegation.plugin.ts'))};
const object = ObjectSchema.create({ name:'${OBJECT}', label:'任务验证记录', sharingModel:'private', fields:{
  name:{type:'text',required:true}, counter:{type:'number',defaultValue:0}, attachment:{type:'file'}, owner_id:{type:'text'}, organization_id:{type:'text'} } });
const target = ObjectSchema.create({name:'${TARGET_OBJECT}',label:'动作字段验证',sharingModel:'private',fields:{name:{type:'text'},attachment:{type:'file'}}});
const action = defineAction({ name:'task_probe_touch', label:'验证动作', objectName:'${OBJECT}', type:'script', locations:['record_header'], target:'TaskProbeTouch',
  visible:false, ai:{exposed:true,category:'action',description:'Only increments the authenticated caller-bound isolated task fixture record for native delegation regression validation.'}, params:[{field:'name',objectOverride:'${TARGET_OBJECT}',label:'动作目标名称',required:false},{field:'attachment',objectOverride:'${TARGET_OBJECT}',label:'任务材料',required:false}] });
object.actions=[action];
const bundle = {...sharedForgeCoreBundle, objects:[...sharedForgeCoreBundle.objects,object,target], actions:[...sharedForgeCoreBundle.actions,action]};
stack.plugins = stack.plugins.map(plugin => plugin === sharedForgeCorePlugin ? new AppPlugin(bundle) : plugin);
stack.plugins.push({ name:'test.task-connection-bootstrap', init(ctx) { ctx.hook('kernel:ready',()=>{
  const server=ctx.getService('http.server'), engine=ctx.getService('objectql'), messaging=ctx.getService('messaging');
  const barriers=new Map();
  const auth=ctx.getService('auth'),nativeGetApi=auth.getApi.bind(auth),sessionCalls=new Map();
  auth.getApi=async()=>{
    const api=await nativeGetApi();
    return new Proxy(api,{get(target,name){
      if(name!=='getSession')return Reflect.get(target,name,target);
      return async(args)=>{
        const marker=args.headers?.get('x-task-test-issuance');
        if(marker){
          const count=(sessionCalls.get(marker)??0)+1;sessionCalls.set(marker,count);
          const barrier=barriers.get(marker);
          if(count===(marker.startsWith('renew:')?2:3)&&barrier){barrier.entered=true;await barrier.wait;}
        }
        return api.getSession(args);
      };
    }});
  };
  const nativeTransaction=engine.transaction.bind(engine);
  engine.transaction=(callback,base,options)=>nativeTransaction(async(...args)=>{
    const result=await callback(...args),barrier=barriers.get('commit:'+result?.input_revision_id);
    if(barrier){barrier.entered=true;await barrier.wait;}
    return result;
  },base,options);
  engine.registerHook('beforeInsert',async hook=>{
    const barrier=barriers.get(hook.input?.data?.input_revision_id);
    if(barrier){barrier.entered=true;await barrier.wait;}
  },{object:'forge_task_delegation',packageId:'test.task-connection-bootstrap'});
  engine.registerHook('afterUpdate',async hook=>{
    if(hook.input?.data?.banned!==true&&hook.result?.banned!==true)return;
    const id=hook.input?.id??hook.previous?.id??hook.result?.id;
    const barrier=barriers.get('ban:'+id);
    if(barrier){barrier.entered=true;await barrier.wait;}
  },{object:'sys_user',priority:0,packageId:'test.task-connection-bootstrap'});
  server.post('/api/v1/__test/task-grant-barrier',async(req,res)=>{
    if(req.headers.authorization!=='Bearer ${launcher}')return res.status(403).json({error:'test launcher refused'});
    const {operation,inputId,generation}=req.body;
    if(operation==='arm'){
      let release;const wait=new Promise(resolve=>{release=resolve;});
      barriers.set(inputId,{entered:false,wait,release});return res.status(200).json({ok:true});
    }
    const barrier=barriers.get(inputId);
    if(operation==='release'){barriers.delete(inputId);barrier?.release();return res.status(200).json({ok:true});}
    if(operation==='credential'){
      const row=await engine.findOne('forge_task_delegation',{where:{input_revision_id:inputId,generation}},{context:{isSystem:true,positions:[],permissions:[]}});
      return res.status(200).json(await new TaskDelegationService(ctx)['response'](row));
    }
    return res.status(200).json({entered:barrier?.entered===true});
  });
  engine.registerAction('${OBJECT}','TaskProbeTouch',async input=>{
    const context=input.executionContext;
    const row=await engine.findOne('${OBJECT}',{where:{id:input.params.recordId}},{context});
    await engine.update('${OBJECT}',{id:row.id,counter:Number(row.counter??0)+1},{context});
    return {ok:true,counter:Number(row.counter??0)+1};
  });
  server.post('/api/v1/__test/task-member',async(req,res)=>{
    if(req.headers.authorization!=='Bearer ${launcher}')return res.status(403).json({error:'test launcher refused'});
    const {userId,organizationId,sessionId}=req.body;
    const context={isSystem:true,positions:[],permissions:[]};
    if(!await engine.findOne('sys_member',{where:{user_id:userId,organization_id:organizationId}},{context}))
      await engine.insert('sys_member',{user_id:userId,organization_id:organizationId,role:'member'},{context});
    await engine.update('sys_session',{id:sessionId,active_organization_id:organizationId},{context});
    return res.status(200).json({ok:true});
  });
  server.post('/api/v1/__test/task-connection',async(req,res)=>{
    if(req.headers.authorization!=='Bearer ${launcher}')return res.status(403).json({error:'test launcher refused'});
    const {userId,organizationId}=req.body;
    const context={isSystem:true,tenantId:organizationId,userId,positions:[],permissions:[]};
    const records=[];
    for(const name of ['原记录','另一记录'])records.push(await engine.insert('${OBJECT}',{name,counter:0,owner_id:userId,organization_id:organizationId},{context}));
    for(let n=0;n<223;n++)await messaging.emit({topic:'task.connection.test',audience:userId,organizationId,
      dedupKey:'${suffix}:'+n,channels:['inbox'],payload:{title:'分页验证'+n,body:'独立本地测试'}});
    const actor=await currentNativeActor(ctx,userId,organizationId);
    return res.status(200).json({recordIds:records.map(row=>row.id), actions:(await new TaskDelegationService(ctx).mcp.actions(actor)).map(a=>({name:a.name,objectName:a.objectName})), permissions:actor.permissions, positions:actor.positions});
  });
}); } });
export default stack;
`);
    const probe = createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(APP, 'node_modules/@objectstack/cli/bin/run.js'), 'dev', '--seed-admin',
      '--port', String(port), '--database-driver', 'postgres', '--admin-email', email, '--admin-password', password,
      '--auth-secret', authSecret, '--log-level', 'error'], { cwd: temporary, env: { ...process.env,
      OS_HOME: path.join(temporary, '.os-home'), OS_DATABASE_URL: `postgres://${admin.connectionParameters.user}@127.0.0.1:${admin.connectionParameters.port}/${database}`,
      OS_SECRET_KEY: secretKey, OS_BASE_URL: origin, OS_TRUSTED_ORIGINS: origin,
      FORGE_IDENTITY_ISSUER: `forge:task-test-${suffix}`, OS_ENVIRONMENT_ID: `task-connection-${suffix}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (part) => { output = (output + part).slice(-16_000); });
    child.stderr.on('data', (part) => { output = (output + part).slice(-16_000); });
    const deadline = Date.now() + 120_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Native runtime exited ${child.exitCode}`);
      try { if ((await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Native runtime did not start');
    const login = await fetch(`${origin}/api/v1/auth/sign-in/email`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({email,password}) });
    const loginData = await login.json(); assert.equal(login.status, 200);
    const bearer = loginData.token; assert.equal(typeof bearer, 'string'); secrets.push(bearer);
    async function request(url, method='GET', body, token=bearer, extraHeaders={}) {
      const response=await fetch(origin+url,{method,headers:{Authorization:'Bearer '+token,Origin:origin,
        Accept:'application/json, text/event-stream',...extraHeaders,...(body===undefined?{}:{'Content-Type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      const text=await response.text(); const lines=text.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(Boolean);
      const payload=lines.length?lines.at(-1):text;
      return {status:response.status,value:payload?JSON.parse(payload):null};
    }
    const barrierPath='/api/v1/__test/task-grant-barrier';
    async function barrier(operation,inputId,generation){return request(barrierPath,'POST',{operation,inputId,generation},launcher);}
    async function waitForBarrier(inputId){
      const deadline=Date.now()+10000;
      while(Date.now()<deadline){if((await barrier('status',inputId)).value.entered)return;await new Promise(resolve=>setTimeout(resolve,25));}
      throw new Error('native beforeInsert barrier was not reached');
    }
    const identitySource=await request('/api/v1/workbench/identity-source');
    assert.equal(identitySource.status,200);assert.equal(identitySource.value.issuer,'forge:task-test-'+suffix);
    const session=(await request('/api/v1/auth/get-session')).value;
    assert.ok(session.user.id && session.session.activeOrganizationId);
    const setup=await request('/api/v1/__test/task-connection','POST',{userId:session.user.id,organizationId:session.session.activeOrganizationId},launcher);
    assert.equal(setup.status,200); assert.equal(setup.value.recordIds.length,2);
    const resources=[];
    for(const [name,mediaType,content] of [['客户&金额.csv','text/csv','客户,金额\n样板,1200\n'],['任务.json','application/json','{"客户":"样板","金额":1200}']]) {
      const bytes=Buffer.from(content);
      const presigned=await request('/api/v1/storage/upload/presigned','POST',{filename:name,mimeType:mediaType,size:bytes.length,scope:'attachments'});
      assert.equal(presigned.status,200);
      const descriptor=presigned.value.data??presigned.value;
      assert.ok(descriptor.fileId&&descriptor.uploadUrl);
      secrets.push(descriptor.uploadUrl);
      const uploaded=await fetch(new URL(descriptor.uploadUrl,origin),{method:descriptor.method??'PUT',headers:descriptor.headers??{},body:bytes});
      assert.equal(uploaded.status,200);await uploaded.body?.cancel();
      const completed=await request('/api/v1/storage/upload/complete','POST',{fileId:descriptor.fileId});assert.equal(completed.status,200);
      resources.push({type:'forge-file',id:descriptor.fileId,name,mediaType,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    }
    const scope={input_revision_id:randomUUID(),registration_id:randomUUID(),task_sha256:'a'.repeat(64),workflow_id:randomUUID(),workflow_version:1,
      allowed_actions:[KEY],resources,business_record:{object_name:OBJECT,record_id:setup.value.recordIds[0]}};
    assert.ok(setup.value.actions.some(a=>a.name==='task_probe_touch'),JSON.stringify({actions:setup.value.actions,permissions:setup.value.permissions,positions:setup.value.positions}));
    const requestId=randomUUID();
    const firstRacing=await Promise.all(Array.from({length:6},()=>request(ROOT,'POST',{request_id:requestId,scope})));
    const first=firstRacing[0];
    for(const response of firstRacing){assert.equal(response.status,200,response.value?.error?.code);assert.equal(response.value.grant_id,first.value.grant_id);assert.equal(response.value.generation,1);secrets.push(response.value.access_token);}
    assert.equal(first.status,200,first.value?.error?.code ?? 'native issuance rejected'); secrets.push(first.value.access_token);
    const token=first.value.access_token; assert.equal(first.value.generation,1);
    assert.equal(first.value.identity_issuer,identitySource.value.issuer);
    assert.equal(Date.parse(first.value.expires_at)-Date.parse(first.value.issued_at),24*60*60*1000);
    const checked=await request(ROOT+'/current','GET',undefined,token); assert.equal(checked.status,200,'initial current:'+String(checked.value?.error?.code));
    for(const resource of resources){
      const original=await fetch(origin+ROOT+'/files/'+resource.id+'/original',{headers:{Authorization:'Bearer '+token}});
      assert.equal(original.status,200,'task original:'+resource.mediaType);
      const bytes=Buffer.from(await original.arrayBuffer());assert.equal(bytes.length,resource.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),resource.sha256);
      assert.equal(original.headers.get('content-type'),resource.mediaType);
    }
    for(const resource of resources){
      const owned=await request('/api/v1/workbench/materials/'+resource.id);
      assert.equal(owned.status,200);assert.equal(owned.value.mediaType,resource.mediaType);
      assert.equal(owned.value.sha256,resource.sha256);assert.equal(Buffer.byteLength(owned.value.content),resource.bytes);
    }
    const racing=await Promise.all(Array.from({length:6},()=>request(ROOT,'POST',{request_id:requestId,scope})));
    for(const response of racing){assert.equal(response.status,200);assert.equal(response.value.grant_id,first.value.grant_id);assert.equal(response.value.generation,1);secrets.push(response.value.access_token);}
    const repeated=await request(ROOT,'POST',{request_id:requestId,scope}); assert.equal(repeated.value.grant_id,first.value.grant_id); assert.equal(repeated.value.generation,1);
    assert.equal((await request(ROOT,'POST',{request_id:requestId,scope:{...scope,task_sha256:'b'.repeat(64)}})).status,409);
    const ordinarySession=await request('/api/v1/auth/get-session','GET',undefined,token); assert.ok(ordinarySession.status===401 || !ordinarySession.value?.user, 'task token must not become an employee session');
    assert.equal((await request('/api/v1/data/'+OBJECT,'POST',{name:'绕过尝试'},token)).status,401);
    assert.equal((await request(ROOT,'POST',{request_id:randomUUID(),scope},token)).status,401);
    let rpcId=0;
    async function rpc(method,params={},taskToken=token) { return request(ROOT+'/mcp','POST',{jsonrpc:'2.0',id:++rpcId,method,params},taskToken); }
    const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'native-task-test',version:'1'}});assert.equal(init.status,200,'mcp init:'+String(init.value?.error?.code));
    const actionReply=await rpc('tools/call',{name:'run_action',arguments:{actionName:'task_probe_touch',objectName:OBJECT,recordId:scope.business_record.record_id,params:{name:'可信动作字段'}}});
    assert.equal(actionReply.status,200,JSON.stringify(actionReply.value)); assert.ok(actionReply.value.result && actionReply.value.result.isError!==true,JSON.stringify(actionReply.value));
    const wrongFile=await rpc('tools/call',{name:'run_action',arguments:{actionName:'task_probe_touch',objectName:OBJECT,recordId:scope.business_record.record_id,params:{attachment:randomUUID()}}});assert.ok(wrongFile.status===403 || wrongFile.value.result?.isError,'field-backed file reference outside scope must be rejected');
    assert.equal((await request(ROOT+'/objects/'+TARGET_OBJECT,'GET',undefined,token)).status,403,'internal action field lookup must not expose target metadata');
    const targetRead=await rpc('tools/call',{name:'get_record',arguments:{objectName:TARGET_OBJECT,recordId:randomUUID()}});
    assert.ok(targetRead.status===403 || targetRead.value.result?.isError,'action field target records stay outside the grant');
    const targetDescription=await rpc('tools/call',{name:'describe_object',arguments:{objectName:TARGET_OBJECT}});
    assert.ok(targetDescription.status===403 || targetDescription.value.result?.isError,'action field target is not a public task object');
    assert.equal((await rpc('tools/call',{name:'create_record',arguments:{objectName:OBJECT,data:{name:'绕过尝试'}}})).status,403);
    const other=await rpc('tools/call',{name:'get_record',arguments:{objectName:OBJECT,recordId:setup.value.recordIds[1]}});
    assert.ok(other.status===403 || other.value.result?.isError,'outside-record read must be refused');
    const renewRacing=await Promise.all(Array.from({length:2},()=>request(ROOT,'POST',{request_id:randomUUID(),scope,expected_generation:1})));
    assert.deepEqual(renewRacing.map(response=>response.status).sort(),[200,409]);
    const renewed=renewRacing.find(response=>response.status===200);secrets.push(renewed.value.access_token);
    assert.equal(renewed.value.grant_id,first.value.grant_id); assert.equal(renewed.value.generation,2);
    assert.equal((await request(ROOT+'/current','GET',undefined,token)).status,401);
    assert.equal((await request(ROOT+'/current','GET',undefined,renewed.value.access_token.slice(0,-3)+'bad')).status,401);
    db=new Client({host:'127.0.0.1',port:admin.connectionParameters.port,user:admin.connectionParameters.user,database});await db.connect();
    const deliveryDeadline=Date.now()+30000;let delivered=0;
    while(Date.now()<deliveryDeadline){delivered=Number((await db.query('SELECT count(*) AS n FROM sys_inbox_message WHERE user_id=$1',[session.user.id])).rows[0].n);if(delivered>=223)break;await new Promise(resolve=>setTimeout(resolve,250));}
    assert.equal(delivered,223,'native delivery must materialize the fixture inbox before paginating');
    await db.query("UPDATE sys_inbox_message SET created_at='2026-01-01T01:02:03.456Z' WHERE user_id=$1",[session.user.id]);
    const noticeIds=new Set(); let cursor; let pages=0;
    do {
      const page=await request('/api/v1/apps/forge/workbench/inbox?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
      assert.equal(page.status,200,JSON.stringify(page.value)); assert.equal(page.value.version,'1');
      for(const row of page.value.notifications){assert.ok(!noticeIds.has(row.id));noticeIds.add(row.id);}
      cursor=page.value.next_cursor;pages++;assert.ok(pages<6);assert.equal(!!cursor,page.value.has_more);
    }while(cursor);
    assert.equal(noticeIds.size,223);assert.equal(pages,3);
    assert.equal((await request('/api/v1/apps/forge/workbench/inbox?cursor=broken')).status,400);
    // Keep the parent login alive: only the native organization entitlement changes.
    const memberRows=(await db.query('SELECT * FROM sys_member WHERE user_id=$1 AND organization_id=$2',[session.user.id,session.session.activeOrganizationId])).rows;
    assert.ok(memberRows.length>0);
    async function deniedWithoutMembership() {
      const current=await request(ROOT+'/current','GET',undefined,renewed.value.access_token);
      assert.equal(current.status,403);assert.equal(current.value.error.code,'FORGE_TASK_ORGANIZATION_FORBIDDEN');
      assert.equal(current.value.error.no_effect,true);
      assert.equal((await request(ROOT,'POST',{request_id:randomUUID(),scope})).status,403);
      assert.equal((await request('/api/v1/apps/forge/workbench/inbox?limit=100')).status,403);
      for(const resource of resources)assert.equal((await request('/api/v1/workbench/materials/'+resource.id)).status,403);
      assert.equal((await request(ROOT+'/files/'+randomUUID()+'/original','GET',undefined,renewed.value.access_token)).status,403);
      assert.equal((await rpc('tools/call',{name:'run_action',arguments:{actionName:'task_probe_touch',objectName:OBJECT,recordId:scope.business_record.record_id,params:{}}},renewed.value.access_token)).status,403);
    }
    const parent=(await db.query('SELECT expires_at FROM sys_session WHERE id=$1',[session.session.id])).rows[0];
    await db.query('UPDATE sys_session SET expires_at=$2 WHERE id=$1',[session.session.id,new Date(Date.now()-60000)]);
    const expiredParent=await request(ROOT+'/current','GET',undefined,renewed.value.access_token);
    assert.equal(expiredParent.status,200,'desktop session expiry must not interrupt a handed-off task');
    await db.query('UPDATE sys_session SET expires_at=$2 WHERE id=$1',[session.session.id,parent.expires_at]);
    assert.equal((await request(ROOT+'/current','GET',undefined,renewed.value.access_token)).status,200);
    const cancelRaceScope={...scope,input_revision_id:randomUUID(),allowed_actions:[],resources:[]};delete cancelRaceScope.business_record;
    const cancelRaceRequest=randomUUID();
    const cancelRaceGrant=await request(ROOT,'POST',{request_id:cancelRaceRequest,scope:cancelRaceScope});
    assert.equal(cancelRaceGrant.status,200);secrets.push(cancelRaceGrant.value.access_token);
    await barrier('arm',cancelRaceScope.input_revision_id);
    const cancelRaceRenewal=request(ROOT,'POST',{request_id:randomUUID(),scope:cancelRaceScope,expected_generation:1});
    try{
      await waitForBarrier(cancelRaceScope.input_revision_id);
      const cancel=await request(ROOT+'/'+cancelRaceGrant.value.grant_id,'DELETE',{reason:'employee_cancel'});
      assert.equal(cancel.status,200);assert.equal(cancel.value.reason,'employee_cancel');
    }finally{await barrier('release',cancelRaceScope.input_revision_id);}
    const cancelRaceReply=await cancelRaceRenewal;if(cancelRaceReply.value?.access_token)secrets.push(cancelRaceReply.value.access_token);
    assert.equal(cancelRaceReply.status,409,'cancel confirmed before insert must prevent a usable renewed grant');
    assert.equal((await request(ROOT,'POST',{request_id:cancelRaceRequest,scope:cancelRaceScope})).status,409,'issuance replay cannot revive a cancelled original input');
    await db.query('UPDATE forge_task_delegation SET revoked_at=NULL,revocation_reason=NULL,issuance_pending=false WHERE grant_key=$1 AND generation=2',[cancelRaceGrant.value.grant_id]);
    const unfinished=await barrier('credential',cancelRaceScope.input_revision_id,2);assert.equal(unfinished.status,200);secrets.push(unfinished.value.access_token);
    const unfinishedCurrent=await request(ROOT+'/current','GET',undefined,unfinished.value.access_token);
    assert.equal(unfinishedCurrent.status,403,'durable older cancellation must block an unmarked newer row');assert.equal(unfinishedCurrent.value.error.code,'FORGE_TASK_CANCELLED');
    await db.query('DELETE FROM sys_member WHERE user_id=$1 AND organization_id=$2',[session.user.id,session.session.activeOrganizationId]);
    await deniedWithoutMembership();
    for(const row of memberRows){const columns=Object.keys(row);await db.query('INSERT INTO sys_member ('+columns.map(name=>'"'+name+'"').join(',')+') VALUES ('+columns.map((_,index)=>'$'+(index+1)).join(',')+')',columns.map(name=>row[name]));}
    assert.equal((await request(ROOT+'/current','GET',undefined,renewed.value.access_token)).status,200);
    const targetEmail='ban-'+suffix+'@example.test',targetPassword='Ban-'+randomBytes(16).toString('hex')+'!';
    secrets.push(targetEmail,targetPassword);
    const created=await request('/api/v1/auth/admin/create-user','POST',{email:targetEmail,password:targetPassword,name:'停用验证员工'});
    assert.equal(created.status,200,'native target employee creation');
    const targetData=created.value.data??created.value;
    const targetId=targetData.user?.id??targetData.id;assert.ok(targetId,'target user envelope keys: '+Object.keys(created.value).join(','));
    const targetLogin=await request('/api/v1/auth/sign-in/email','POST',{email:targetEmail,password:targetPassword});
    assert.equal(targetLogin.status,200);const targetToken=targetLogin.value.token;assert.ok(targetToken);secrets.push(targetToken);
    const changedPassword='Changed-'+randomBytes(16).toString('hex')+'!';secrets.push(changedPassword);
    const passwordChanged=await request('/api/v1/auth/change-password','POST',{currentPassword:targetPassword,newPassword:changedPassword,revokeOtherSessions:false},targetToken);
    assert.equal(passwordChanged.status,200,'native first-login password change');
    const targetSession=(await request('/api/v1/auth/get-session','GET',undefined,targetToken)).value;
    assert.equal((await request('/api/v1/__test/task-member','POST',{userId:targetId,organizationId:session.session.activeOrganizationId,sessionId:targetSession.session.id},launcher)).status,200);
    const targetScope={...scope,input_revision_id:randomUUID(),allowed_actions:[],resources:[]};delete targetScope.business_record;
    const targetGrant=await request(ROOT,'POST',{request_id:randomUUID(),scope:targetScope},targetToken);
    assert.equal(targetGrant.status,200,'native employee empty-scope grant: '+String(targetGrant.value?.error?.code));secrets.push(targetGrant.value.access_token);
    await barrier('arm',targetScope.input_revision_id);
    const targetRenewal=request(ROOT,'POST',{request_id:randomUUID(),scope:targetScope,expected_generation:1},targetToken);
    await waitForBarrier(targetScope.input_revision_id);
    assert.equal((await request('/api/v1/auth/admin/ban-user','POST',{userId:targetId,banReason:'独立任务撤销验证'})).status,200);
    const banned=(await request(ROOT+'/current','GET',undefined,targetGrant.value.access_token));
    assert.equal(banned.status,401);assert.equal(banned.value.error.code,'FORGE_TASK_SUBJECT_INACTIVE');
    assert.equal((await request('/api/v1/auth/admin/unban-user','POST',{userId:targetId})).status,200);
    await barrier('release',targetScope.input_revision_id);
    assert.equal((await targetRenewal).status,409,'ban then unban before renewal insert cannot revive the original grant');
    const stillRevoked=await request(ROOT+'/current','GET',undefined,targetGrant.value.access_token);
    assert.equal(stillRevoked.status,401);assert.equal(stillRevoked.value.error.code,'FORGE_TASK_SUBJECT_INACTIVE','unban cannot revive the original grant');
    const cleanup=await request(ROOT+'/'+targetGrant.value.grant_id,'DELETE',{reason:'run_terminal'},targetGrant.value.access_token);
    assert.equal(cleanup.status,200);assert.equal(cleanup.value.reason,'subject_inactive');
    const restartedLogin=await request('/api/v1/auth/sign-in/email','POST',{email:targetEmail,password:changedPassword});
    assert.equal(restartedLogin.status,200);const restartedToken=restartedLogin.value.token;secrets.push(restartedToken);
    assert.equal((await request(ROOT,'POST',{request_id:randomUUID(),scope:targetScope},restartedToken)).status,409,'a new login must not resurrect the disabled original input');
    const firstRaceScope={...targetScope,input_revision_id:randomUUID()};
    const firstRaceRequest=randomUUID();
    await barrier('arm',firstRaceScope.input_revision_id);
    const firstIssuance=request(ROOT,'POST',{request_id:firstRaceRequest,scope:firstRaceScope},restartedToken);
    await waitForBarrier(firstRaceScope.input_revision_id);
    assert.equal((await request('/api/v1/auth/admin/ban-user','POST',{userId:targetId,banReason:'首次发行竞争验证'})).status,200);
    assert.equal((await request('/api/v1/auth/admin/unban-user','POST',{userId:targetId})).status,200);
    await barrier('release',firstRaceScope.input_revision_id);
    assert.equal((await firstIssuance).status,401,'first issuance must not survive ban deleting its original employee session');
    const firstRaceRows=await db.query('SELECT count(*)::int AS count FROM forge_task_delegation WHERE input_revision_id=$1',[firstRaceScope.input_revision_id]);
    assert.equal(firstRaceRows.rows[0].count,0,'aborted first issuance must roll back its row and request key');
    const freshLogin=await request('/api/v1/auth/sign-in/email','POST',{email:targetEmail,password:changedPassword});
    assert.equal(freshLogin.status,200);const freshToken=freshLogin.value.token;secrets.push(freshToken);
    const firstRetry=await request(ROOT,'POST',{request_id:firstRaceRequest,scope:firstRaceScope},freshToken);
    assert.equal(firstRetry.status,200,'fresh login can retry the original rolled-back first issuance nonce');secrets.push(firstRetry.value.access_token);
    assert.equal(firstRetry.value.generation,1);assert.equal((await request(ROOT+'/current','GET',undefined,firstRetry.value.access_token)).status,200);
    const banBarrier='ban:'+targetId;await barrier('arm',banBarrier);
    const delayedBan=request('/api/v1/auth/admin/ban-user','POST',{userId:targetId,banReason:'停用事件与启用竞争验证'});
    try{await waitForBarrier(banBarrier);assert.equal((await request('/api/v1/auth/admin/unban-user','POST',{userId:targetId})).status,200);}
    finally{await barrier('release',banBarrier);}
    assert.equal((await delayedBan).status,200);
    const delayedBanCurrent=await request(ROOT+'/current','GET',undefined,firstRetry.value.access_token);
    assert.equal(delayedBanCurrent.status,401,'a later unban cannot erase the native ban event before its revocation hook runs');assert.equal(delayedBanCurrent.value.error.code,'FORGE_TASK_SUBJECT_INACTIVE');
    const commitLogin=await request('/api/v1/auth/sign-in/email','POST',{email:targetEmail,password:changedPassword});
    assert.equal(commitLogin.status,200);const commitToken=commitLogin.value.token;secrets.push(commitToken);
    const commitScope={...targetScope,input_revision_id:randomUUID()},commitRequest=randomUUID(),commitBarrier='commit:'+commitScope.input_revision_id;
    await barrier('arm',commitBarrier);
    const commitIssuance=request(ROOT,'POST',{request_id:commitRequest,scope:commitScope},commitToken);
    try{
      await waitForBarrier(commitBarrier);
      assert.equal((await request('/api/v1/auth/admin/ban-user','POST',{userId:targetId,banReason:'复验后提交前竞争验证'})).status,200);
      assert.equal((await request('/api/v1/auth/admin/unban-user','POST',{userId:targetId})).status,200);
    }finally{await barrier('release',commitBarrier);}
    const commitReply=await commitIssuance;if(commitReply.value?.access_token)secrets.push(commitReply.value.access_token);
    assert.equal(commitReply.status,401,'post-validation ban/unban before commit must prevent signing a first task token');
    const committedRows=await db.query('SELECT revoked_at,revocation_reason FROM forge_task_delegation WHERE input_revision_id=$1',[commitScope.input_revision_id]);
    assert.equal(committedRows.rows.length,1,'postcommit rejection retains the failed issuance nonce');
    assert.ok(committedRows.rows[0].revoked_at);assert.equal(committedRows.rows[0].revocation_reason,'issuance_aborted');
    const abandoned=await barrier('credential',commitScope.input_revision_id,1);assert.equal(abandoned.status,200);secrets.push(abandoned.value.access_token);
    assert.equal((await request(ROOT+'/current','GET',undefined,abandoned.value.access_token)).status,401,'a signed test credential cannot activate the failed committed scope');
    const afterCommitLogin=await request('/api/v1/auth/sign-in/email','POST',{email:targetEmail,password:changedPassword});
    assert.equal(afterCommitLogin.status,200);const afterCommitToken=afterCommitLogin.value.token;secrets.push(afterCommitToken);
    assert.equal((await request(ROOT,'POST',{request_id:commitRequest,scope:commitScope},afterCommitToken)).status,409);
    const retriedCommit=await request(ROOT,'POST',{request_id:randomUUID(),scope:commitScope,expected_generation:0},afterCommitToken);
    assert.equal(retriedCommit.status,200,'fresh authorization may replace an aborted unconfirmed candidate');secrets.push(retriedCommit.value.access_token);
    assert.equal(retriedCommit.value.generation,2);
    const newWork=await request(ROOT,'POST',{request_id:randomUUID(),scope:{...commitScope,input_revision_id:randomUUID()}},afterCommitToken);
    assert.equal(newWork.status,200,'a new work input is allowed after fresh native login');secrets.push(newWork.value.access_token);
    const terminalScope={...cancelRaceScope,input_revision_id:randomUUID()};const terminalRequest=randomUUID();
    const terminalGrant=await request(ROOT,'POST',{request_id:terminalRequest,scope:terminalScope});assert.equal(terminalGrant.status,200);secrets.push(terminalGrant.value.access_token);
    assert.equal((await request(ROOT+'/'+terminalGrant.value.grant_id,'DELETE',{reason:'run_terminal'},terminalGrant.value.access_token)).status,200);
    assert.equal((await request(ROOT,'POST',{request_id:randomUUID(),scope:terminalScope,expected_generation:1})).status,409,'a terminal original input cannot obtain a new generation');
    const cancelGrant=await request(ROOT,'POST',{request_id:randomUUID(),scope:{...scope,input_revision_id:randomUUID()}});
    assert.equal(cancelGrant.status,200);secrets.push(cancelGrant.value.access_token);
    const cancellations=await Promise.all([
      request(ROOT+'/'+cancelGrant.value.grant_id,'DELETE',{reason:'employee_cancel'}),
      request(ROOT+'/'+cancelGrant.value.grant_id,'DELETE',{reason:'run_terminal'},cancelGrant.value.access_token),
    ]);
    for(const reply of cancellations){assert.equal(reply.status,200);assert.equal(reply.value.reason,cancellations[0].value.reason);}
    const cancelled=(await request(ROOT+'/current','GET',undefined,cancelGrant.value.access_token));
    assert.equal(cancelled.status,cancellations[0].value.reason==='employee_cancel'?403:401);
    assert.equal((await request(ROOT+'/'+renewed.value.grant_id,'DELETE',{reason:'employee_cancel'},renewed.value.access_token)).status,403);
    assert.equal((await request(ROOT+'/'+'f'.repeat(64),'DELETE',{reason:'run_terminal'},renewed.value.access_token)).status,403);
    const terminalRaceScope={...cancelRaceScope,input_revision_id:randomUUID()};
    const terminalRaceGrant=await request(ROOT,'POST',{request_id:randomUUID(),scope:terminalRaceScope});assert.equal(terminalRaceGrant.status,200);secrets.push(terminalRaceGrant.value.access_token);
    const terminalRaceMarker='renew:'+terminalRaceScope.input_revision_id;await barrier('arm',terminalRaceMarker);
    const terminalRaceRenewal=request(ROOT,'POST',{request_id:randomUUID(),scope:terminalRaceScope,expected_generation:1},bearer,{'x-task-test-issuance':terminalRaceMarker});
    await waitForBarrier(terminalRaceMarker);
    assert.equal((await request(ROOT+'/current','GET',undefined,terminalRaceGrant.value.access_token)).status,200,'a committed pending candidate cannot replace the confirmed authority');
    const terminalRaceStop=await request(ROOT+'/'+terminalRaceGrant.value.grant_id,'DELETE',{reason:'run_terminal'},terminalRaceGrant.value.access_token);
    assert.equal(terminalRaceStop.status,200,'confirmed original task can self-revoke while a newer candidate is pending');
    await barrier('release',terminalRaceMarker);assert.equal((await terminalRaceRenewal).status,409);
    assert.equal((await request(ROOT+'/current','GET',undefined,terminalRaceGrant.value.access_token)).status,401);
    const logoutRenewScope={...cancelRaceScope,input_revision_id:randomUUID()};
    const logoutRenewGrant=await request(ROOT,'POST',{request_id:randomUUID(),scope:logoutRenewScope});assert.equal(logoutRenewGrant.status,200);secrets.push(logoutRenewGrant.value.access_token);
    await barrier('arm',logoutRenewScope.input_revision_id);
    const logoutRenewRequest=randomUUID(),logoutRenewal=request(ROOT,'POST',{request_id:logoutRenewRequest,scope:logoutRenewScope,expected_generation:1});
    await waitForBarrier(logoutRenewScope.input_revision_id);
    assert.equal((await request(ROOT+'/current','GET',undefined,logoutRenewGrant.value.access_token)).status,200,'pending renewal cannot replace the handed-off authority');
    const lateScope={...cancelRaceScope,input_revision_id:randomUUID()},lateRequest=randomUUID(),lateMarker='caller:'+lateScope.input_revision_id;
    await barrier('arm',lateMarker);
    const lateOriginal=request(ROOT,'POST',{request_id:lateRequest,scope:lateScope},bearer,{'x-task-test-issuance':lateMarker});
    await waitForBarrier(lateMarker);
    const pendingCredential=await barrier('credential',lateScope.input_revision_id,1);assert.equal(pendingCredential.status,200);secrets.push(pendingCredential.value.access_token);
    assert.equal((await request(ROOT+'/current','GET',undefined,pendingCredential.value.access_token)).status,401,'unconfirmed issuance cannot execute');
    const handedOff=await request(ROOT,'POST',{request_id:lateRequest,scope:lateScope});assert.equal(handedOff.status,200);secrets.push(handedOff.value.access_token);
    const logout=await request('/api/v1/auth/sign-out','POST',{});assert.equal(logout.status,200);
    await barrier('release',logoutRenewScope.input_revision_id);
    assert.equal((await logoutRenewal).status,401);
    assert.equal((await request(ROOT+'/current','GET',undefined,logoutRenewGrant.value.access_token)).status,200,'aborted renewal and logout cannot close the handed-off old authority');
    await barrier('release',lateMarker);
    assert.equal((await lateOriginal).status,401,'late original issuer rejects its logged-out caller');
    assert.equal((await request(ROOT+'/current','GET',undefined,handedOff.value.access_token)).status,200,'late issuer abort cannot revoke a row already handed off by the same-nonce replay');
    const adminAgain=await request('/api/v1/auth/sign-in/email','POST',{email,password});assert.equal(adminAgain.status,200);const adminAgainToken=adminAgain.value.token;secrets.push(adminAgainToken);
    assert.equal((await request(ROOT,'POST',{request_id:logoutRenewRequest,scope:logoutRenewScope},adminAgainToken)).status,409,'aborted candidate nonce stays closed');
    const renewedAgain=await request(ROOT,'POST',{request_id:randomUUID(),scope:logoutRenewScope,expected_generation:1},adminAgainToken);
    assert.equal(renewedAgain.status,200);assert.equal(renewedAgain.value.generation,3,'allocation skips retained aborted generation while expected generation uses authority');secrets.push(renewedAgain.value.access_token);
    assert.equal((await request(ROOT+'/current','GET',undefined,renewedAgain.value.access_token)).status,200);
    assert.equal((await request(ROOT+'/current','GET',undefined,renewed.value.access_token)).status,200,'logout must not revoke handed-off work');
    const revoked=await request(ROOT+'/'+renewed.value.grant_id,'DELETE',{reason:'run_terminal'},renewed.value.access_token);
    assert.equal(revoked.status,200);assert.equal(revoked.value.revoked,true);assert.equal(revoked.value.reason,'run_terminal');
    const repeatedRevocation=await request(ROOT+'/'+renewed.value.grant_id,'DELETE',{reason:'run_terminal'},renewed.value.access_token);
    assert.equal(repeatedRevocation.status,200);assert.equal(repeatedRevocation.value.reason,'run_terminal');
    assert.equal((await request(ROOT+'/current','GET',undefined,renewed.value.access_token)).status,401);

    const affected=await db.query(`SELECT counter FROM ${OBJECT} WHERE id=$1`,[scope.business_record.record_id]);assert.equal(Number(affected.rows[0].counter),1);
  } catch (error) {
    for(const secret of secrets)output=output.replaceAll(secret,'[secret omitted]');
    // Do not print JSON response bodies containing a task credential.
    let message=String(error?.stack??error?.message??error);for(const secret of secrets)message=message.replaceAll(secret,'[secret omitted]');
    throw new Error(message+'\n'+output.slice(-3500));
  } finally {
    if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,8000))]);if(child.exitCode===null)child.kill('SIGKILL');}
    await db?.end().catch(()=>{});await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',[database]);
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);await admin.end();await rm(temporary,{recursive:true,force:true});
  }
});
