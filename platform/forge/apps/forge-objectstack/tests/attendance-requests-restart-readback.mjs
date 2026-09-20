import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const report=JSON.parse(await readFile('.objectstack/acceptance/attendance-requests-report.json','utf8')),api=await connect(),checks=[];
async function read(object,id){const r=await api.request('/data/'+object+'/'+id);assert.equal(r.status,200,JSON.stringify(r.value));return r.value.record}
const overtime=await read('forge_overtime_request',report.ids.overtime);assert.equal(overtime.status,'submitted');checks.push('overtime');
const leave=await read('forge_leave_request',report.ids.leave),type=await read('forge_leave_type',report.ids.leaveType);assert.equal(leave.status,'approved');assert.equal(type.used_hours,4);assert.equal(type.pending_hours,0);checks.push('leave-approved-quota');
const trip=await read('forge_business_trip_request',report.ids.trip),expense=await read('forge_business_trip_expense',report.ids.expense),itinerary=await read('forge_business_trip_itinerary',report.ids.itinerary);assert.equal(trip.status,'submitted');assert.equal(expense.trip_id,trip.id);assert.equal(itinerary.trip_id,trip.id);checks.push('trip-header-expense-itinerary');
console.log(JSON.stringify({suite:'attendance-requests-restart-readback',checks,status:'passed'},null,2));
