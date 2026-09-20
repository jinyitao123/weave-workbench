import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
const endpoint=process.env.FORGE_URL||'http://localhost:4356',api=await connect(endpoint),report=JSON.parse(await readFile('.objectstack/acceptance/other-inbound-prerequisite-report.json','utf8'));
const read=async(object,id)=>(await api.request(`/data/${object}/${id}`)).value.record,find=async(object,where)=>{const q=new URLSearchParams({$filter:JSON.stringify(where),$top:'100'});return(await api.request(`/data/${object}?${q}`)).value.records};
const inbound=await read('forge_other_inbound',report.ids.inbound);assert.equal(inbound.status,'stocked');assert.equal(inbound.line_count,4);assert.equal(inbound.total_quantity,5);assert.ok(inbound.stocked_at);
const lines=await find('forge_other_inbound_line',{inbound_id:inbound.id}),ledgers=await find('forge_inventory_ledger',{source_id:inbound.id});assert.equal(lines.length,4);assert.ok(lines.every(x=>x.status==='stocked'));assert.equal(ledgers.length,4);assert.ok(ledgers.every(x=>x.movement_type==='other_inbound'));
const cancelled=await read('forge_other_inbound',report.ids.cancelled);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.cancel_reason,'测试停用类型阻断后的取消路径');
console.log('PASS other inbound prerequisites, stock changes and cancellation survived full restart');
