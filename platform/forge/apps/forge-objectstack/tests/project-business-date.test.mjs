import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm}from'node:fs/promises';
import {tmpdir}from'node:os';
import {join}from'node:path';
import {ObjectQL}from'@objectstack/objectql';
import {SqlDriver}from'@objectstack/driver-sql';
import {Field,ObjectSchema}from'@objectstack/spec/data';
import {ProjectBusinessDatePlugin,formatOrganizationBusinessDate,organizationBusinessContext,organizationBusinessDate}from'../src/plugins/project-business-date.plugin.ts';
test('calendar dates follow the organization business timezone, default UTC and reject invalid zones',async()=>{
 const instant=new Date('2026-10-02T16:30:00Z');
 assert.equal(formatOrganizationBusinessDate(instant,'Asia/Shanghai'),'2026-10-03');
 assert.equal(formatOrganizationBusinessDate(instant,null),'2026-10-02');
 assert.equal(formatOrganizationBusinessDate(instant,'America/Los_Angeles'),'2026-10-02');
 assert.throws(()=>formatOrganizationBusinessDate(instant,'invalid/zone'));
 const engine={async findOne(){return{timezone:'invalid/zone'}}};
 await assert.rejects(organizationBusinessDate(engine,{isSystem:true,tenantId:'org'},instant),/时区无效/);
});
test('organization business context returns date and the exact timezone from the scoped organization read',async()=>{
 const instant=new Date('2026-10-02T16:30:00Z'),reads=[];
 const organizations={
  'org-shanghai':{timezone:'Asia/Shanghai'},
  'org-utc-null':{timezone:null},
  'org-utc-absent':{},
  'org-new-york':{timezone:'America/New_York'},
 };
 const engine={async findOne(object,query,options){reads.push({object,query,context:options.context});return organizations[query.where.id]||null}};
 const context={isSystem:true,userId:'reader-a',tenantId:'org-shanghai',organizationId:'org-shanghai'};
 assert.deepEqual(await organizationBusinessContext(engine,context,instant),{business_date:'2026-10-03',timezone:'Asia/Shanghai'});
 assert.equal(reads[0].object,'sys_organization');
 assert.deepEqual(reads[0].query,{where:{id:'org-shanghai'},fields:['id','timezone']});
 assert.equal(reads[0].context,context);
 assert.equal(await organizationBusinessDate(engine,context,instant),'2026-10-03','the legacy helper still returns a date string');
 assert.deepEqual(await organizationBusinessContext(engine,{...context,tenantId:'org-utc-null'},instant),{business_date:'2026-10-02',timezone:'UTC'});
 assert.deepEqual(await organizationBusinessContext(engine,{...context,tenantId:'org-utc-absent'},instant),{business_date:'2026-10-02',timezone:'UTC'});
 const beforeSpringForward=new Date('2026-03-08T06:59:59.999Z'),afterSpringForward=new Date('2026-03-08T07:00:00.000Z');
 assert.deepEqual(await organizationBusinessContext(engine,{...context,tenantId:'org-new-york'},beforeSpringForward),{business_date:'2026-03-08',timezone:'America/New_York'});
 assert.deepEqual(await organizationBusinessContext(engine,{...context,tenantId:'org-new-york'},afterSpringForward),{business_date:'2026-03-08',timezone:'America/New_York'});
 assert.equal(reads.at(-1).query.where.id,'org-new-york','each projection stays within its requested tenant');
});
test('organization business context refuses missing scope, missing organization and invalid timezone',async()=>{
 const engine={async findOne(_object,query){if(query.where.id==='invalid-zone-org')return{timezone:'invalid/zone'};return null}};
 await assert.rejects(organizationBusinessContext(engine,{isSystem:true},new Date('2026-10-02T16:30:00Z')),/缺少组织上下文/);
 await assert.rejects(organizationBusinessContext(engine,{isSystem:true,tenantId:'missing-org'},new Date('2026-10-02T16:30:00Z')),/无法读取组织业务时区/);
 await assert.rejects(organizationBusinessContext(engine,{isSystem:true,tenantId:'invalid-zone-org'},new Date('2026-10-02T16:30:00Z')),/时区无效/);
});
test('real ObjectQL fills required member date before validation and project start date through host hooks',async t=>{const directory=await mkdtemp(join(tmpdir(),'forge-project-date-'));const driver=new SqlDriver({client:'better-sqlite3',connection:{filename:join(directory,'test.sqlite')},useNullAsDefault:true}),engine=new ObjectQL(),schema=(name,fields)=>ObjectSchema.create({name,label:name,fields});const objects=[schema('sys_organization',{name:Field.text({}),timezone:Field.text({})}),schema('forge_project_member',{name:Field.text({}),joined_on:Field.date({required:true})}),schema('forge_project',{name:Field.text({}),status:Field.text({}),actual_start_on:Field.date({})})];t.after(async()=>{await driver.disconnect();await rm(directory,{recursive:true,force:true})});for(const object of objects)engine.registerObject(object);engine.registerDriver(driver,true);await engine.init();await driver.initObjects(objects);const context={isSystem:true,userId:'manager',tenantId:'org',positions:[],permissions:[]};await engine.insert('sys_organization',{id:'org',name:'日期回归',timezone:'Asia/Shanghai'},{context});new ProjectBusinessDatePlugin().start({hook(_event,ready){ready()},getService(){return engine}});await engine.insert('forge_project_member',{id:'member',name:'经理'},{context});const expected=formatOrganizationBusinessDate(new Date(),'Asia/Shanghai'),member=await engine.findOne('forge_project_member',{where:{id:'member'}},{context});assert.equal(member.joined_on,expected);await engine.insert('forge_project',{id:'project',name:'项目',status:'pending'},{context});await engine.update('forge_project',{id:'project',status:'in_progress'},{context});assert.equal((await engine.findOne('forge_project',{where:{id:'project'}},{context})).actual_start_on,expected)});
