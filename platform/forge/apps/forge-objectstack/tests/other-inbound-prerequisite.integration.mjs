import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint=process.env.FORGE_URL||'http://localhost:4356',api=await connect(endpoint),stamp=Date.now();
const registry=JSON.parse(await readFile('.objectstack/acceptance/reference-data.json','utf8'));
const fixture=Object.fromEntries(registry.results.map(x=>[x.key,x.id]));
for(const key of ['warehouse','plc_sku','hmi_sku','psu_sku','cab_sku','other_inbound_type_production'])assert.ok(fixture[key],key+' prerequisite');
const skus=[['plc_sku',1],['hmi_sku',1],['psu_sku',2],['cab_sku',1]],ids={},cases=[];
const request=(path,method='GET',body)=>api.request(path,method,body),read=async(object,id)=>(await request(`/data/${object}/${id}`)).value.record;
const find=async(object,where)=>{const q=new URLSearchParams({$filter:JSON.stringify(where),$top:'100'});return(await request(`/data/${object}?${q}`)).value.records};
const invoke=(action,id,params={})=>request(`/actions/forge_other_inbound/${action}/${id}`,'POST',{params});
async function test(name,run){try{await run();cases.push({name,status:'passed'});console.log('PASS '+name)}catch(error){cases.push({name,status:'failed',error:error.message});console.error('FAIL '+name+': '+error.message)}}

await test('RISEMAP observed production prerequisites and current empty drawing categories are preserved',async()=>{
 const inboundType=await read('forge_other_inbound_type',fixture.other_inbound_type_production);assert.equal(inboundType.name,'生产验收备料');assert.equal(inboundType.status,'active');
 const drawing=await find('forge_drawing_business_setting',{enabled:true});assert.deepEqual([...new Set(drawing.map(x=>x.category))].sort(),['change_type','drawing_category','drawing_type','issue_category','issue_severity','review_category','version_type']);
 const allDrawing=await find('forge_drawing_business_setting',{});assert.ok(allDrawing.some(x=>x.category==='change_level'&&!['true',true,1,'1'].includes(x.enabled)));assert.ok(allDrawing.some(x=>x.category==='participant_role'&&!['true',true,1,'1'].includes(x.enabled)));
 const subcontract=await find('forge_subcontract_business_setting',{enabled:true});assert.equal(new Set(subcontract.map(x=>x.category)).size,6);
 const inventory=await find('forge_inventory_business_setting',{enabled:true});assert.equal(new Set(inventory.map(x=>x.category)).size,7);
});

await test('creates one four-material other inbound and submission does not change inventory',async()=>{
 ids.before={};for(const [key] of skus){const rows=await find('forge_inventory_balance',{balance_key:fixture.warehouse+':'+fixture[key]});ids.before[key]=Number(rows[0]?.on_hand_quantity||0)}
 const made=await request('/data/forge_other_inbound','POST',{name:'生产验收备料 '+stamp,code:'OIN-ACCEPT-'+stamp,inbound_type_id:fixture.other_inbound_type_production,warehouse_id:fixture.warehouse,inbound_on:'2026-09-14',source_code:'ASM-PREREQUISITE-'+stamp,handler_id:api.userId,remarks:'补齐800型柔性线控制柜组装验收所需四项物料'});assert.equal(made.status,201,JSON.stringify(made.value));ids.inbound=made.value.id||made.value.record?.id;
 ids.lines=[];for(const [key,quantity] of skus){const sku=await read('forge_material_sku',fixture[key]),material=await read('forge_material',sku.material_id),unit=Number(sku.cost_price||0),madeLine=await request('/data/forge_other_inbound_line','POST',{name:material.name,inbound_id:ids.inbound,sku_id:sku.id,item_code:material.code,model:sku.model||material.model||null,specification:sku.specification||sku.name,unit_name:'件',quantity,taxed_unit_price:unit,taxed_amount:quantity*unit,batch_number:'PRE-'+stamp,status:'stocked'});assert.equal(madeLine.status,201,JSON.stringify(madeLine.value));ids.lines.push(madeLine.value.id||madeLine.value.record?.id)}
 assert.equal((await invoke('other_inbound_submit',ids.inbound)).status,200);const inbound=await read('forge_other_inbound',ids.inbound);assert.equal(inbound.status,'pending_approval');assert.equal(inbound.line_count,4);assert.equal(inbound.total_quantity,5);
 for(const [key] of skus){const rows=await find('forge_inventory_balance',{balance_key:fixture.warehouse+':'+fixture[key]});assert.equal(Number(rows[0]?.on_hand_quantity||0),ids.before[key])}
});

await test('approval remains non-stock-moving and warehouse execution writes four linked ledgers',async()=>{
 assert.equal((await invoke('other_inbound_approve',ids.inbound,{approval_note:'物料、数量和仓库已核对'})).status,200);assert.equal((await read('forge_other_inbound',ids.inbound)).status,'approved');
 for(const [key] of skus){const rows=await find('forge_inventory_balance',{balance_key:fixture.warehouse+':'+fixture[key]});assert.equal(Number(rows[0]?.on_hand_quantity||0),ids.before[key])}
 const stocked=await invoke('other_inbound_stock',ids.inbound);assert.equal(stocked.status,200,JSON.stringify(stocked.value));const inbound=await read('forge_other_inbound',ids.inbound);assert.equal(inbound.status,'stocked');assert.ok(inbound.stocked_at);
 const ledgers=await find('forge_inventory_ledger',{source_id:ids.inbound});assert.equal(ledgers.length,4);assert.ok(ledgers.every(x=>x.movement_type==='other_inbound'&&x.direction==='inbound'));ids.ledgers=ledgers.map(x=>x.id);
 for(const [key,quantity] of skus){const rows=await find('forge_inventory_balance',{balance_key:fixture.warehouse+':'+fixture[key]});assert.equal(rows.length,1);assert.equal(Number(rows[0].on_hand_quantity),ids.before[key]+quantity)}
 const duplicate=await invoke('other_inbound_stock',ids.inbound);assert.equal(duplicate.status,400);assert.match(JSON.stringify(duplicate.value),/仅|库存流水|approved/);
});

await test('inactive inbound type blocks submission and cancellation requires a business reason',async()=>{
 const type=await request('/data/forge_other_inbound_type','POST',{name:'停用验收类型 '+stamp,code:'OIT-INACTIVE-'+stamp,status:'inactive'});ids.inactiveType=type.value.id||type.value.record?.id;
 const draft=await request('/data/forge_other_inbound','POST',{name:'停用类型阻断 '+stamp,code:'OIN-BLOCK-'+stamp,inbound_type_id:ids.inactiveType,warehouse_id:fixture.warehouse,inbound_on:'2026-09-14',handler_id:api.userId});ids.cancelled=draft.value.id||draft.value.record?.id;
 const sku=await read('forge_material_sku',fixture.plc_sku),material=await read('forge_material',sku.material_id);await request('/data/forge_other_inbound_line','POST',{name:material.name,inbound_id:ids.cancelled,sku_id:sku.id,item_code:material.code,quantity:1,taxed_unit_price:1,taxed_amount:1});
 const blocked=await invoke('other_inbound_submit',ids.cancelled);assert.equal(blocked.status,400);assert.match(JSON.stringify(blocked.value),/已启用/);
 const empty=await invoke('other_inbound_cancel',ids.cancelled,{cancel_reason:' '});assert.equal(empty.status,400);assert.match(JSON.stringify(empty.value),/取消原因|cancel_reason/);
 assert.equal((await invoke('other_inbound_cancel',ids.cancelled,{cancel_reason:'测试停用类型阻断后的取消路径'})).status,200);assert.equal((await read('forge_other_inbound',ids.cancelled)).status,'cancelled');
});

await mkdir('.objectstack/acceptance',{recursive:true});const report={recordedAt:new Date().toISOString(),endpoint,kind:'other-inbound-production-prerequisite',ids,cases,passed:cases.every(x=>x.status==='passed')};await writeFile('.objectstack/acceptance/other-inbound-prerequisite-report.json',JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
