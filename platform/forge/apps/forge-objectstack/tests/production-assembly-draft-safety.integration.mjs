import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint=process.env.FORGE_URL||'http://localhost:4356';
const database=process.env.FORGE_DB||'.objectstack/data/objectstack.db';
const reportPath='.objectstack/acceptance/production-assembly-draft-safety-report.json';
const api=await connect(endpoint),cases=[],ids={operator:api.userId};
const stamp=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;
const resultOf=response=>response.value?.result??response.value?.data?.result??response.value?.data??response.value;
async function test(name,run){try{await run();cases.push({name,status:'passed'});console.log('PASS '+name)}catch(error){cases.push({name,status:'failed',error:error.message});console.error('FAIL '+name+': '+error.message)}}
async function find(object,where={}){const q=new URLSearchParams({$filter:JSON.stringify(where),$top:'1000'}),response=await api.request(`/data/${object}?${q}`);assert.equal(response.status,200,object+': '+JSON.stringify(response.value));return (response.value.records||[]).filter(row=>Object.entries(where).every(([key,value])=>row[key]===value))}
async function read(object,id){const response=await api.request(`/data/${object}/${id}`);assert.equal(response.status,200,object+'/'+id+': '+JSON.stringify(response.value));return response.value.record}
async function invoke(object,action,id,params={}){return api.request(`/actions/${object}/${action}/${id}`,'POST',{params})}

const bom=(await find('forge_bom',{status:'active'})).find(row=>row.bom_type==='project')||(await find('forge_bom',{status:'active'}))[0];
assert.ok(bom,'需要至少一个已生效 BOM');ids.bom=bom.id;
const warehouse=(await find('forge_warehouse'))[0];assert.ok(warehouse,'需要至少一个仓库');ids.warehouse=warehouse.id;
const nodes=(await find('forge_bom_node',{bom_id:bom.id})).filter(row=>row.parent_id&&row.sku_id);assert.ok(nodes.length>0,'BOM 需要末级物料');
const countBefore=(await find('forge_assembly_order')).length;

await test('创建一张草稿且只产生一个组装单',async()=>{
  const response=await invoke('forge_bom','bom_create_assembly',bom.id,{mode:'draft',planned_quantity:2,warehouse_id:warehouse.id,planned_completion_on:'2026-09-18',remarks:'P1 草稿编辑取消验收 '+stamp});
  assert.equal(response.status,200,JSON.stringify(response.value));const result=resultOf(response);ids.cancelledDraft=result.id;ids.cancelledCode=result.code;
  assert.deepEqual({status:result.status,quantity:Number(result.planned_quantity),lineCount:Number(result.material_line_count)},{status:'draft',quantity:2,lineCount:nodes.length});
  assert.equal((await find('forge_assembly_order')).length,countBefore+1);
  const order=await read('forge_assembly_order',ids.cancelledDraft);assert.equal(order.bom_id,bom.id);assert.equal(order.bom_version,bom.version);assert.equal(order.status,'draft');
  const lines=await find('forge_assembly_material_line',{assembly_id:ids.cancelledDraft});assert.equal(lines.length,nodes.length);
  for(const node of nodes){const line=lines.find(row=>row.bom_node_id===node.id);assert.ok(line,'缺少 BOM 节点 '+node.id);assert.equal(Number(line.required_quantity),round4(2*Number(node.quantity||0)*(1+Number(node.loss_rate||0)/100)));assert.equal(Number(line.issued_quantity||0),0)}
});

await test('编辑草稿沿用原 BOM 并重算物料需求',async()=>{
  const response=await invoke('forge_assembly_order','assembly_update_draft',ids.cancelledDraft,{planned_quantity:3,warehouse_id:warehouse.id,planned_completion_on:'2026-09-20',remarks:'P1 草稿已修改 '+stamp});
  assert.equal(response.status,200,JSON.stringify(response.value));const result=resultOf(response);assert.equal(result.id,ids.cancelledDraft);assert.equal(result.status,'draft');assert.equal(Number(result.planned_quantity),3);
  assert.equal((await find('forge_assembly_order')).length,countBefore+1,'编辑草稿不得新建第二张组装单');
  const order=await read('forge_assembly_order',ids.cancelledDraft);assert.equal(order.code,ids.cancelledCode);assert.equal(order.bom_id,bom.id);assert.equal(order.bom_version,bom.version);assert.equal(order.planned_quantity,3);assert.equal(order.status,'draft');assert.equal(order.remarks,'P1 草稿已修改 '+stamp);
  assert.deepEqual({qualified:Number(order.qualified_quantity),rejected:Number(order.rejected_quantity),inbound:Number(order.inbound_quantity),issued:Number(order.issued_quantity),returned:Number(order.returned_quantity),cost:Number(order.material_cost)},{qualified:0,rejected:0,inbound:0,issued:0,returned:0,cost:0});
  const lines=await find('forge_assembly_material_line',{assembly_id:ids.cancelledDraft});assert.equal(lines.length,nodes.length);
  for(const node of nodes){const line=lines.find(row=>row.bom_node_id===node.id);assert.ok(line);assert.equal(Number(line.required_quantity),round4(3*Number(node.quantity||0)*(1+Number(node.loss_rate||0)/100)));const balances=await find('forge_inventory_balance',{balance_key:warehouse.id+':'+node.sku_id});assert.equal(Number(line.available_snapshot),Number(balances[0]?.available_quantity||0));assert.equal(line.status,'shortage')}
});

await test('取消草稿必须填写原因且取消后不能继续编辑',async()=>{
  let response=await invoke('forge_assembly_order','assembly_cancel',ids.cancelledDraft,{reason:'  '});assert.equal(response.status,400);assert.match(JSON.stringify(response.value),/取消原因不能为空|reason.*required/);
  response=await invoke('forge_assembly_order','assembly_cancel',ids.cancelledDraft,{reason:'生产计划调整，本单不再执行'});assert.equal(response.status,200,JSON.stringify(response.value));assert.equal(resultOf(response).status,'cancelled');
  const order=await read('forge_assembly_order',ids.cancelledDraft);assert.equal(order.status,'cancelled');
  response=await invoke('forge_assembly_order','assembly_update_draft',ids.cancelledDraft,{planned_quantity:4,warehouse_id:warehouse.id});assert.equal(response.status,400);assert.match(JSON.stringify(response.value),/仅草稿组装单可以编辑/);
  response=await invoke('forge_assembly_order','assembly_cancel',ids.cancelledDraft,{reason:'重复取消'});assert.equal(response.status,400);assert.match(JSON.stringify(response.value),/仅草稿组装单可以取消/);
  const logs=await find('forge_production_approval_log',{source_id:ids.cancelledDraft});const cancelled=logs.find(row=>row.action==='cancelled');assert.ok(cancelled);assert.deepEqual({from:cancelled.from_status,to:cancelled.to_status,comment:cancelled.comment},{from:'draft',to:'cancelled',comment:'生产计划调整，本单不再执行'});
  assert.equal((await find('forge_production_material_document',{assembly_id:ids.cancelledDraft})).length,0);assert.equal((await find('forge_inventory_ledger',{source_id:ids.cancelledDraft})).length,0);
});

await test('组装单下达后禁止编辑和取消',async()=>{
  let response=await invoke('forge_bom','bom_create_assembly',bom.id,{mode:'draft',planned_quantity:1,warehouse_id:warehouse.id,planned_completion_on:'2026-09-22',remarks:'P1 下达后状态保护 '+stamp});assert.equal(response.status,200,JSON.stringify(response.value));const created=resultOf(response);ids.releasedDraft=created.id;ids.releasedCode=created.code;
  response=await invoke('forge_assembly_order','assembly_release',ids.releasedDraft,{warehouse_id:warehouse.id});assert.equal(response.status,200,JSON.stringify(response.value));assert.equal(resultOf(response).status,'waiting_pick');
  response=await invoke('forge_assembly_order','assembly_cancel',ids.releasedDraft,{reason:'不应允许'});assert.equal(response.status,400);assert.match(JSON.stringify(response.value),/仅草稿组装单可以取消/);
  response=await invoke('forge_assembly_order','assembly_update_draft',ids.releasedDraft,{planned_quantity:2,warehouse_id:warehouse.id});assert.equal(response.status,400);assert.match(JSON.stringify(response.value),/仅草稿组装单可以编辑/);
  assert.equal((await read('forge_assembly_order',ids.releasedDraft)).status,'waiting_pick');
});

await mkdir('.objectstack/acceptance',{recursive:true});
const report={recordedAt:new Date().toISOString(),kind:'production-assembly-draft-edit-cancel-safety',endpoint,database,ids,cases,passed:cases.every(row=>row.status==='passed'),risemapObserved:{page:'https://risemap.cn/production/assembly',newPage:'https://risemap.cn/production/assembly/new',states:['草稿','审批中','待领料','组装中','已完工','已驳回','已取消'],newFields:['物料','BOM','BOM版本','组装数量','入库仓库','关联销售订单','计划完工日期','备注']},forgeDecision:'草稿取消使用二次确认并显示不可恢复影响；已下达组装单禁止编辑和取消。'};
await writeFile(reportPath,JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
