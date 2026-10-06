import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {userInfo} from 'node:os';
import {ObjectQL,ScopedContext} from '@objectstack/objectql';
import {SqlDriver} from '@objectstack/driver-sql';
import {SharingService,SysRecordShare} from '@objectstack/plugin-sharing';
import {Field,ObjectSchema} from '@objectstack/spec/data';
import {ProjectMemberSharingPlugin} from '../src/plugins/project-member-sharing.plugin.ts';
import {ServiceOrderReferenceSharingPlugin} from '../src/plugins/service-order-reference-sharing.plugin.ts';
import {sharingInTransaction} from '../src/plugins/native-sharing-transaction.ts';
const postgresPort=Number(process.env.FORGE_INTEGRATION_PG_PORT||5432);
const run=promisify(execFile),system={isSystem:true,userId:'sales-a',tenantId:'org-a',positions:[],permissions:[]};
const object=(name,fields,sharingModel='private')=>ObjectSchema.create({name,label:name,fields,sharingModel,enable:{apiEnabled:true}});

test('native sharing and project/service membership share the sandbox explicit PostgreSQL transaction, including failed grant and revoke',{skip:process.env.FORGE_NATIVE_SHARING_PG_TEST!=='1'?'set FORGE_NATIVE_SHARING_PG_TEST=1 for an isolated local PostgreSQL run':false},async t=>{
 const database='forge_sharing_tx_'+randomUUID().replaceAll('-','').slice(0,12);
 await run('createdb',['-h','127.0.0.1','-p',String(postgresPort),database]);
 const driver=new SqlDriver({client:'pg',connection:{host:'127.0.0.1',port:postgresPort,database,user:userInfo().username}}),engine=new ObjectQL();
 const handles=[];t.after(async()=>{for(const handle of handles){try{await driver.rollback(handle)}catch{}}await driver.disconnect();await run('dropdb',['-h','127.0.0.1','-p',String(postgresPort),database])});
 const text=()=>Field.text({}),common={name:text(),organization_id:text(),owner_id:text()};
 const schemas=[object('forge_customer',common),object('forge_customer_team_member',{...common,customer_id:text(),user_id:text(),active:Field.boolean({})}),object('forge_contact',{...common,customer_id:text()}),object('forge_contact_channel',{...common,contact_id:text()}),object('forge_sales_follow_up',{...common,customer_id:text()}),object('forge_project',common),object('forge_project_member',{...common,project_id:text(),user_id:text(),active:Field.boolean({})}),object('forge_project_attachment',{...common,project_id:text()}),object('forge_project_log',{...common,project_id:text()}),object('forge_service_order',{...common,engineer_id:text(),status:text(),customer_id:text(),contact_id:text(),sales_order_id:text(),contract_id:text()}),object('sys_position',{...common,active:Field.boolean({})}),object('sys_user_position',{user_id:text(),position:text(),organization_id:text(),valid_from:Field.datetime({}),valid_until:Field.datetime({})}),object('sys_user',{name:text(),banned:Field.boolean({})}),object('sys_organization',{name:text()}),object('sys_member',{user_id:text(),organization_id:text(),role:text()}),{...SysRecordShare,fields:{...SysRecordShare.fields,organization_id:text()}}];
 for(const schema of schemas)engine.registerObject(schema);engine.registerDriver(driver,true);await engine.init();await driver.initObjects(schemas);
 await engine.insert('sys_user',{id:'sales-a',name:'测试甲'},{context:system});await engine.insert('sys_user',{id:'sales-b',name:'测试乙'},{context:system});await engine.insert('sys_organization',{id:'org-a',name:'隔离分享回归'},{context:system});await engine.insert('sys_member',{user_id:'sales-b',organization_id:'org-a',role:'member'},{context:system});
 for(const [name,row]of[['forge_customer',{id:'customer-1'}],['forge_contact',{id:'contact-1',customer_id:'customer-1'}],['forge_contact_channel',{id:'channel-1',contact_id:'contact-1'}],['forge_sales_follow_up',{id:'follow-1',customer_id:'customer-1'}]])await engine.insert(name,{...row,name:'隔离材料',owner_id:'sales-a',organization_id:'org-a'},{context:system});
 const native=new SharingService({engine});
 // Reproduce the SDK boundary independently: the default native writer does
 // not join a sandbox explicit handle, even though grant receives that handle.
 const base=new ScopedContext(system,engine),unbound=await base.beginTransaction();assert.ok(unbound?.handle);
 await native.grant({object:'forge_customer',recordId:'customer-1',recipientId:'sales-b',source:'team',sourceId:'unbound-test',accessLevel:'read'},{...system,transaction:unbound.handle});
 await base.rollbackTransaction(unbound.handle);
 assert.equal((await engine.find('sys_record_share',{where:{source_id:'unbound-test'}},{context:system})).length,1,'17.5 native writer commits independently without the bridge');
 const existing=(await native.listShares('forge_customer','customer-1',system))[0];await native.revoke(existing.id,system);
 new ProjectMemberSharingPlugin().start({hook(_event,ready){ready()},getService(name){return name==='objectql'?engine:native}});
 for(const [name,row]of[['forge_project',{id:'project-1'}],['forge_project_attachment',{id:'attachment-1',project_id:'project-1'}],['forge_project_log',{id:'log-1',project_id:'project-1'}]])await engine.insert(name,{...row,name:'项目材料',owner_id:'sales-a',organization_id:'org-a'},{context:system});
 let projectFail=true;engine.registerHook('afterInsert',()=>{if(projectFail)throw new Error('project later failure')},{object:'forge_project_member',priority:999});
 const projectMember={id:'project-team-1',name:'项目成员',project_id:'project-1',user_id:'sales-b',active:true,owner_id:'sales-a',organization_id:'org-a'};
 const projectTx=await base.beginTransaction();handles.push(projectTx.handle);await assert.rejects(projectTx.ctx.object('forge_project_member').insert(projectMember),/project later failure/);await base.rollbackTransaction(projectTx.handle);
 assert.equal((await engine.find('sys_record_share',{}, {context:system})).length,0,'project member, attachment and log grants also roll back');
 projectFail=false;const committedProject=await base.beginTransaction();handles.push(committedProject.handle);await committedProject.ctx.object('forge_project_member').insert(projectMember);await base.commitTransaction(committedProject.handle);
 assert.equal((await engine.find('sys_record_share',{}, {context:system})).length,3,'native project and evidence grants commit together');
 for(let offset=0;offset<501;offset+=25)await Promise.all(Array.from({length:Math.min(25,501-offset)},(_,j)=>engine.insert('sys_record_share',{id:'bulk-'+(offset+j),organization_id:'org-a',object_name:'forge_project',record_id:'project-1',recipient_type:'user',recipient_id:'other-'+(offset+j),access_level:'read',source:'manual',created_at:'2100-01-01T00:00:00Z',updated_at:'2100-01-01T00:00:00Z'},{context:system})));
 assert.equal((await native.listShares('forge_project','project-1',system)).length,500);
 assert.ok(!(await native.listShares('forge_project','project-1',system)).some(row=>row.source_id==='project-team-1'),'the target is older than the native listShares ceiling');
 const revoke=await base.beginTransaction();handles.push(revoke?.handle);await revoke.ctx.object('forge_project_member').update({id:'project-team-1',active:false});
 assert.equal((await engine.find('sys_record_share',{where:{source_id:'project-team-1'}},{context:{...system,transaction:revoke.handle}})).length,0);
 await base.rollbackTransaction(revoke.handle);
 assert.equal((await engine.find('sys_record_share',{where:{source_id:'project-team-1'}},{context:system})).length,3,'failed deactivation restores native grants');
 assert.equal((await engine.findOne('forge_project_member',{where:{id:'project-team-1'}},{context:system})).active,true);
 const confirmed=await base.beginTransaction();handles.push(confirmed?.handle);await confirmed.ctx.object('forge_project_member').update({id:'project-team-1',active:false});await base.commitTransaction(confirmed.handle);
 assert.equal((await engine.find('sys_record_share',{where:{source_id:'project-team-1'}},{context:system})).length,0,'committed deactivation revokes all team grants even beyond 500 newer shares');
 assert.equal((await engine.find('sys_record_share',{where:{source:'manual'}},{context:system})).length,501,'unrelated manual grants are preserved');
 await engine.delete('sys_record_share',{where:{source:'manual'},multi:true,context:system});
 new ServiceOrderReferenceSharingPlugin().start({hook(event,ready){if(event==='kernel:ready')ready()},getService(name){return name==='objectql'?engine:native}});
 await engine.insert('sys_position',{id:'after-sales',name:'after_sales_operator',active:true,organization_id:'org-a'},{context:system});
 await engine.insert('sys_user_position',{user_id:'sales-b',position:'after_sales_operator',organization_id:'org-a'},{context:system});
 let serviceFail=true;engine.registerHook('afterInsert',()=>{if(serviceFail)throw new Error('service later failure')},{object:'forge_service_order',priority:999});
 const serviceRow={id:'service-1',name:'测试指派',engineer_id:'sales-b',status:'in_progress',customer_id:'customer-1',contact_id:'contact-1',owner_id:'sales-a',organization_id:'org-a'};
 const serviceTx=await base.beginTransaction();handles.push(serviceTx.handle);await assert.rejects(serviceTx.ctx.object('forge_service_order').insert(serviceRow),/service later failure/);await base.rollbackTransaction(serviceTx.handle);
 assert.equal((await engine.find('sys_record_share',{where:{source_id:'forge_service_order_assignment'}},{context:system})).length,0,'service reference grants roll back with the failed assignment');
 serviceFail=false;const serviceSuccess=await base.beginTransaction();handles.push(serviceSuccess.handle);await serviceSuccess.ctx.object('forge_service_order').insert(serviceRow);await base.commitTransaction(serviceSuccess.handle);
 assert.equal((await engine.find('sys_record_share',{where:{source_id:'forge_service_order_assignment'}},{context:system})).length,2,'native service reference grants commit');


});
