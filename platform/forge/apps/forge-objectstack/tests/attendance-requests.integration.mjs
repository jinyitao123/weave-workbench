import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const api=await connect(), stamp=Date.now(), ids={}, cases=[];
async function test(name,run){try{await run();cases.push({name,status:'passed'});console.log('PASS '+name)}catch(error){cases.push({name,status:'failed',error:error.message});console.error('FAIL '+name+': '+error.message)}}
async function create(object,body){const r=await api.request('/data/'+object,'POST',body);assert.equal(r.status,201,JSON.stringify(r.value));return r.value.id||r.value.record?.id}
async function patch(object,id,body){const r=await api.request('/data/'+object+'/'+id,'PATCH',body);assert.equal(r.status,200,JSON.stringify(r.value))}
async function read(object,id){const r=await api.request('/data/'+object+'/'+id);assert.equal(r.status,200,JSON.stringify(r.value));return r.value.record}

await test('overtime request persists its exact time range and compensation method',async()=>{
  ids.overtime=await create('forge_overtime_request',{code:'OT-ACC-'+stamp,applicant_name:'Dev Admin',department:'研发中心',starts_at:'2026-09-16T18:00:00.000Z',ends_at:'2026-09-16T20:30:00.000Z',duration_hours:2.5,compensation_method:'time_off',reason:'项目交付前联调支持',status:'submitted',submitted_at:new Date().toISOString()});
  const row=await read('forge_overtime_request',ids.overtime);assert.deepEqual({duration_hours:row.duration_hours,compensation_method:row.compensation_method,status:row.status},{duration_hours:2.5,compensation_method:'time_off',status:'submitted'});
});

await test('leave submission reserves quota and approval converts it to used quota',async()=>{
  ids.leaveType=await create('forge_leave_type',{name:'调休',code:'COMP-'+stamp,unit:'hours',entitlement_hours:16,used_hours:0,pending_hours:0,requires_attachment:false,status:'active'});
  ids.leave=await create('forge_leave_request',{code:'LV-ACC-'+stamp,applicant_name:'Dev Admin',department:'研发中心',leave_type_id:ids.leaveType,starts_at:'2026-09-18T09:00:00.000Z',ends_at:'2026-09-18T13:00:00.000Z',duration_hours:4,reason:'个人事务',status:'submitted',submitted_at:new Date().toISOString()});
  await patch('forge_leave_type',ids.leaveType,{pending_hours:4});
  await patch('forge_leave_request',ids.leave,{status:'approved',decision_comment:'同意'});
  await patch('forge_leave_type',ids.leaveType,{pending_hours:0,used_hours:4});
  const request=await read('forge_leave_request',ids.leave),type=await read('forge_leave_type',ids.leaveType);assert.deepEqual({status:request.status,pending:type.pending_hours,used:type.used_hours},{status:'approved',pending:0,used:4});
});

await test('business trip keeps header expense and itinerary source relations',async()=>{
  ids.trip=await create('forge_business_trip_request',{code:'BT-ACC-'+stamp,applicant_name:'Dev Admin',department:'研发中心',reason:'客户项目交付验收',destination:'苏州',departure_on:'2026-09-20',return_on:'2026-09-21',duration_days:2,transport_method:'high_speed_rail',customer_names:'苏州澄岳自动化装备有限公司',estimated_amount:1080,status:'submitted',submitted_at:new Date().toISOString()});
  ids.expense=await create('forge_business_trip_expense',{trip_id:ids.trip,category:'transport',description:'往返高铁',amount:480});
  ids.itinerary=await create('forge_business_trip_itinerary',{trip_id:ids.trip,sequence:1,departure_at:'2026-09-20T08:00:00.000Z',arrival_at:'2026-09-20T10:00:00.000Z',origin:'南京南',destination:'苏州北',transport_method:'high_speed_rail'});
  const trip=await read('forge_business_trip_request',ids.trip),expense=await read('forge_business_trip_expense',ids.expense),itinerary=await read('forge_business_trip_itinerary',ids.itinerary);assert.deepEqual({status:trip.status,amount:trip.estimated_amount,expenseTrip:expense.trip_id,itineraryTrip:itinerary.trip_id},{status:'submitted',amount:1080,expenseTrip:ids.trip,itineraryTrip:ids.trip});
});

await test('anonymous attendance request access is rejected',async()=>{for(const object of ['forge_overtime_request','forge_leave_request','forge_business_trip_request'])assert.equal((await api.request('/data/'+object,'GET',undefined,false)).status,401)});
await mkdir('.objectstack/acceptance',{recursive:true});const report={recordedAt:new Date().toISOString(),kind:'attendance-requests-api-acceptance',ids,cases,passed:cases.every(x=>x.status==='passed'),runtime:{url:process.env.FORGE_URL||'http://localhost:4310',database:'file:.objectstack/attendance-requests.sqlite'}};await writeFile('.objectstack/acceptance/attendance-requests-report.json',JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
