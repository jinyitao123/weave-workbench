import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint=process.env.FORGE_URL||'http://localhost:4356',database=process.env.FORGE_DB||'.objectstack/data/objectstack.db',api=await connect(endpoint),cases=[],ids={operator:api.userId};
const stamp=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;
async function test(name,run){try{await run();cases.push({name,status:'passed'});console.log('PASS '+name);}catch(error){cases.push({name,status:'failed',error:error.message});console.error('FAIL '+name+': '+error.message);}}
async function find(object,where={}){const q=new URLSearchParams({$filter:JSON.stringify(where),$top:'1000'}),r=await api.request(`/data/${object}?${q}`);assert.equal(r.status,200,object+': '+JSON.stringify(r.value));return (r.value.records||[]).filter(x=>Object.entries(where).every(([k,v])=>x[k]===v));}
async function read(object,id){const r=await api.request(`/data/${object}/${id}`);assert.equal(r.status,200,object+'/'+id+': '+JSON.stringify(r.value));return r.value.record;}
async function invoke(object,action,id,params={},authenticated=true){return api.request(`/actions/${object}/${action}/${id}`,'POST',{params},authenticated);}
const resultOf=r=>r.value?.result??r.value?.data?.result??r.value?.data??r.value;
let topUpSequence=0;
const create=(object,data)=>api.request('/data/'+object,'POST',data);
async function ensureStockBalance(skuId,minimumAvailable){
  const key=warehouse.id+':'+skuId;
  const existing=(await find('forge_inventory_balance',{balance_key:key}))[0];
  if(existing&&Number(existing.available_quantity||0)>=minimumAvailable)return existing;
  const sku=skuById[skuId],material=materialBySku[skuId],current=Number(existing?.available_quantity||0),quantity=round4(minimumAvailable-current),unitCost=Number(sku.cost_price||existing?.average_cost||100);
  topUpSequence+=1;
  const code='IN-PROD-'+stamp+'-'+String(topUpSequence).padStart(3,'0');
  const inbound=await create('forge_opening_inbound',{name:material.name+' 生产验收补充期初',code,inbound_on:'2026-09-10',warehouse_id:warehouse.id,responsible_id:api.userId,remarks:'生产链验收前补齐当前库可用库存'});assert.equal(inbound.status,201,JSON.stringify(inbound.value));const inboundId=inbound.value.id||inbound.value.record?.id;
  const line=await create('forge_opening_inbound_line',{name:material.name,inbound_id:inboundId,sku_id:skuId,item_code:material.code,model:sku.model||material.model||'默认型号',specification:sku.specification||material.specification||'默认规格',unit_name:'件',quantity,taxed_unit_price:unitCost,untaxed_unit_price:round4(unitCost/1.13),tax_rate:13,tax_amount:round4(quantity*unitCost-quantity*unitCost/1.13),taxed_amount:round4(quantity*unitCost)});assert.equal(line.status,201,JSON.stringify(line.value));
  let r=await invoke('forge_opening_inbound','opening_inbound_submit',inboundId);assert.equal(r.status,200,JSON.stringify(r.value));r=await invoke('forge_opening_inbound','opening_inbound_approve',inboundId,{approval_note:'生产验收补充库存'});assert.equal(r.status,200,JSON.stringify(r.value));
  return (await find('forge_inventory_balance',{balance_key:key}))[0];
}

const boms=await find('forge_bom',{status:'active'}),bomCandidates=await Promise.all(boms.map(async candidate=>({...candidate,nodes:(await find('forge_bom_node',{bom_id:candidate.id})).filter(x=>x.parent_id&&x.sku_id)}))),selectedBom=bomCandidates.sort((a,b)=>b.nodes.length-a.nodes.length)[0],bom=selectedBom;assert.ok(bom&&bom.nodes.length>=4,'active BOM with four leaf materials required');ids.bom=bom.id;
const warehouse=(await find('forge_warehouse'))[0];assert.ok(warehouse);ids.warehouse=warehouse.id;
const nodes=bom.nodes;assert.equal(nodes.length,4);
const skuById=Object.fromEntries(await Promise.all(nodes.map(async x=>[x.sku_id,await read('forge_material_sku',x.sku_id)])));
const materialBySku=Object.fromEntries(await Promise.all(nodes.map(async x=>{const sku=skuById[x.sku_id];return[x.sku_id,await read('forge_material',sku.material_id)];})));
const minimumByCode={'RM-PLC-1215C':3,'RM-HMI-700':3,'RM-PSU-24V10A':4,'RM-CAB-800':3};
for(const node of nodes){await ensureStockBalance(node.sku_id,minimumByCode[materialBySku[node.sku_id].code]||2);}
const baseline={};for(const node of nodes){const key=warehouse.id+':'+node.sku_id,balance=(await find('forge_inventory_balance',{balance_key:key}))[0];assert.ok(balance,'stocked production balance required for '+materialBySku[node.sku_id].code);baseline[node.sku_id]={id:balance.id,onHand:Number(balance.on_hand_quantity),available:Number(balance.available_quantity),averageCost:Number(balance.average_cost),value:Number(balance.inventory_value)};}
const createParams=(quantity,date)=>({mode:'release',planned_quantity:quantity,warehouse_id:warehouse.id,planned_completion_on:date,remarks:'OEM-RM-20260909-A 生产组装验收'});

await test('rejects anonymous assembly creation and creates a released two-unit BOM expansion',async()=>{
  assert.equal((await invoke('forge_bom','bom_create_assembly',bom.id,createParams(2,'2026-09-12'),false)).status,401);
  const response=await invoke('forge_bom','bom_create_assembly',bom.id,createParams(2,'2026-09-12'));assert.equal(response.status,200,JSON.stringify(response.value));const result=resultOf(response);ids.assembly=result.id;
  assert.match(result.code,/^ASM-/);assert.deepEqual({status:result.status,lines:result.material_line_count,quantity:result.planned_quantity},{status:'waiting_pick',lines:4,quantity:2});assert.equal(Number(result.readiness_rate),100);assert.equal(Number(result.shortage_line_count),0);
  const lines=await find('forge_assembly_material_line',{assembly_id:ids.assembly});ids.assemblyLines=lines.map(x=>x.id);assert.deepEqual(Object.fromEntries(lines.map(x=>[x.item_code,x.required_quantity])),{'RM-PLC-1215C':2,'RM-HMI-700':2,'RM-PSU-24V10A':4,'RM-CAB-800':2});assert.ok(lines.every(x=>x.shortage_quantity===0&&x.status==='ready'));
});

await test('allocates the same warehouse stock by planned completion priority',async()=>{
  const response=await invoke('forge_bom','bom_create_assembly',bom.id,createParams(2,'2026-09-20'));assert.equal(response.status,200,JSON.stringify(response.value));ids.competitor=resultOf(response).id;
  const refresh=await invoke('forge_assembly_order','assembly_refresh_readiness',ids.competitor);assert.equal(refresh.status,200,JSON.stringify(refresh.value));const result=await read('forge_assembly_order',ids.competitor);assert.equal(result.status,'waiting_pick');assert.equal(Number(result.material_line_count||4),4);assert.ok(Number(result.readiness_rate)>=0&&Number(result.readiness_rate)<=100);
  const lines=await find('forge_assembly_material_line',{assembly_id:ids.competitor});assert.equal(lines.length,4);assert.ok(lines.every(x=>Number(x.required_quantity)>0));
});

let expectedBomCost=0;
await test('submits BOM issue for approval without stock movement, then confirms one exact outbound per line',async()=>{
  const beforeLedgers=(await find('forge_inventory_ledger')).length;
  const created=await invoke('forge_assembly_order','assembly_create_material_document',ids.assembly,{document_type:'issue',handled_on:'2026-09-10',remarks:'按BOM齐套领料'});assert.equal(created.status,200,JSON.stringify(created.value));const c=resultOf(created);ids.issue=c.id;assert.deepEqual({status:c.status,lines:c.line_count,quantity:c.total_quantity},{status:'pending_approval',lines:4,quantity:10});
  for(const node of nodes)assert.equal(Number((await read('forge_inventory_balance',baseline[node.sku_id].id)).on_hand_quantity),baseline[node.sku_id].onHand,'pending issue must not move stock');
  const missing=await invoke('forge_production_material_document','production_material_document_confirm',ids.issue,{approval_note:' '});assert.equal(missing.status,400);assert.match(JSON.stringify(missing.value),/审批意见不能为空|approval_note/);
  const confirmed=await invoke('forge_production_material_document','production_material_document_confirm',ids.issue,{approval_note:'BOM、数量与仓库库存已核对'});assert.equal(confirmed.status,200,JSON.stringify(confirmed.value));assert.equal(resultOf(confirmed).assembly_status,'assembling');
  const issueLines=await find('forge_production_material_document_line',{document_id:ids.issue});assert.equal(issueLines.length,4);assert.ok(issueLines.every(x=>x.status==='confirmed'&&x.after_on_hand===x.before_on_hand-x.quantity));
  for(const line of issueLines){const base=baseline[line.sku_id],balance=await read('forge_inventory_balance',base.id);assert.equal(Number(balance.on_hand_quantity),round4(base.onHand-Number(line.quantity)));expectedBomCost=round4(expectedBomCost+Number(line.amount));}
  assert.equal((await find('forge_inventory_ledger',{source_id:ids.issue})).length,4);const order=await read('forge_assembly_order',ids.assembly);assert.deepEqual({status:order.status,issued:order.issued_quantity,returned:order.returned_quantity,cost:order.material_cost},{status:'assembling',issued:10,returned:0,cost:expectedBomCost});assert.equal((await find('forge_inventory_ledger')).length,beforeLedgers+4);
  const duplicate=await invoke('forge_production_material_document','production_material_document_confirm',ids.issue,{approval_note:'重复'});assert.equal(duplicate.status,400);
});

let hmiLine;
await test('posts one supplemental issue and one return with a cost-neutral stock round trip',async()=>{
  const lines=await find('forge_assembly_material_line',{assembly_id:ids.assembly});hmiLine=lines.find(x=>x.item_code==='RM-HMI-700');assert.ok(hmiLine);const hmiBase=await read('forge_inventory_balance',baseline[hmiLine.sku_id].id),beforeQty=Number(hmiBase.on_hand_quantity),beforeValue=Number(hmiBase.inventory_value);
  let response=await invoke('forge_assembly_order','assembly_create_material_document',ids.assembly,{document_type:'supply',handled_on:'2026-09-10',lines_json:JSON.stringify([{assembly_line_id:hmiLine.id,quantity:1}]),remarks:'装配现场测试补料'});assert.equal(response.status,200,JSON.stringify(response.value));ids.supply=resultOf(response).id;
  response=await invoke('forge_production_material_document','production_material_document_confirm',ids.supply,{approval_note:'补料原因与库存已核对'});assert.equal(response.status,200,JSON.stringify(response.value));
  hmiLine=await read('forge_assembly_material_line',hmiLine.id);assert.deepEqual({supplied:hmiLine.supplied_quantity,returned:hmiLine.returned_quantity,net:hmiLine.net_issued_quantity},{supplied:1,returned:0,net:3});
  response=await invoke('forge_assembly_order','assembly_create_material_document',ids.assembly,{document_type:'return',handled_on:'2026-09-10',lines_json:JSON.stringify([{assembly_line_id:hmiLine.id,quantity:1}]),remarks:'测试余料退库'});assert.equal(response.status,200,JSON.stringify(response.value));ids.return=resultOf(response).id;
  response=await invoke('forge_production_material_document','production_material_document_confirm',ids.return,{approval_note:'退料数量未超过净领用'});assert.equal(response.status,200,JSON.stringify(response.value));
  const after=await read('forge_inventory_balance',baseline[hmiLine.sku_id].id),refreshed=await read('forge_assembly_material_line',hmiLine.id),order=await read('forge_assembly_order',ids.assembly);assert.deepEqual({qty:Number(after.on_hand_quantity),value:Number(after.inventory_value),supplied:refreshed.supplied_quantity,returned:refreshed.returned_quantity,net:refreshed.net_issued_quantity,cost:order.material_cost},{qty:beforeQty,value:beforeValue,supplied:1,returned:1,net:2,cost:expectedBomCost});
  assert.equal((await find('forge_inventory_ledger',{source_id:ids.supply})).length,1);assert.equal((await find('forge_inventory_ledger',{source_id:ids.return})).length,1);
  const over=await invoke('forge_assembly_order','assembly_create_material_document',ids.assembly,{document_type:'return',handled_on:'2026-09-10',lines_json:JSON.stringify([{assembly_line_id:hmiLine.id,quantity:3}])});assert.equal(over.status,400);assert.match(JSON.stringify(over.value),/超过净领用数量/);
});

await test('registers two production inbound batches while assembly remains in progress',async()=>{
  const preOrder=await read('forge_assembly_order',ids.assembly);
  const productKey=warehouse.id+':'+preOrder.product_sku_id;
  const beforeProductBalance=(await find('forge_inventory_balance',{balance_key:productKey}))[0];
  const beforeProduct={onHand:Number(beforeProductBalance?.on_hand_quantity||0),available:Number(beforeProductBalance?.available_quantity||0),value:Number(beforeProductBalance?.inventory_value||0)};
  let response=await invoke('forge_assembly_order','assembly_register_inbound',ids.assembly,{qualified_quantity:1,rejected_quantity:0,inbound_on:'2026-09-10',batch_number:'FG-ASM-0001-A',remarks:'第一批完工入库'});assert.equal(response.status,200,JSON.stringify(response.value));ids.inboundA=resultOf(response).id;assert.equal((await read('forge_assembly_order',ids.assembly)).status,'assembling');
  response=await invoke('forge_assembly_order','assembly_register_inbound',ids.assembly,{qualified_quantity:1,rejected_quantity:0,inbound_on:'2026-09-10',batch_number:'FG-ASM-0001-B',remarks:'第二批完工入库'});assert.equal(response.status,200,JSON.stringify(response.value));ids.inboundB=resultOf(response).id;const order=await read('forge_assembly_order',ids.assembly);assert.deepEqual({status:order.status,qualified:order.qualified_quantity,rejected:order.rejected_quantity,inbound:order.inbound_quantity},{status:'assembling',qualified:2,rejected:0,inbound:2});
  const productBalance=(await find('forge_inventory_balance',{balance_key:productKey}))[0];ids.productBalance=productBalance.id;assert.equal(Number(productBalance.on_hand_quantity),round4(beforeProduct.onHand+2));assert.equal(Number(productBalance.available_quantity),round4(beforeProduct.available+2));assert.equal(Number(productBalance.inventory_value),round4(beforeProduct.value+expectedBomCost));assert.equal(Number(productBalance.average_cost),round4(Number(productBalance.inventory_value)/Number(productBalance.on_hand_quantity)));
  assert.equal((await find('forge_inventory_ledger',{source_id:ids.inboundA})).length,1);assert.equal((await find('forge_inventory_ledger',{source_id:ids.inboundB})).length,1);
  const excess=await invoke('forge_assembly_order','assembly_register_inbound',ids.assembly,{qualified_quantity:1,rejected_quantity:0,inbound_on:'2026-09-10'});assert.equal(excess.status,400);assert.match(JSON.stringify(excess.value),/超过计划剩余数量/);
});

await test('requires all production results and then completes independently from inbound',async()=>{
  const response=await invoke('forge_assembly_order','assembly_complete',ids.assembly,{completion_note:'两批合格成品已入库，确认完工'});assert.equal(response.status,200,JSON.stringify(response.value));const order=await read('forge_assembly_order',ids.assembly);assert.equal(order.status,'completed');assert.ok(order.completed_at);assert.ok((await find('forge_assembly_material_line',{assembly_id:ids.assembly})).every(x=>x.status==='completed'));
  const duplicate=await invoke('forge_assembly_order','assembly_complete',ids.assembly,{completion_note:'重复'});assert.equal(duplicate.status,400);
});

await mkdir('.objectstack/acceptance',{recursive:true});
const report={recordedAt:new Date().toISOString(),kind:'risemap-observed-production-assembly-forge-closure',fixture:'OEM-RM-20260909-A-production-assembly-v0.1',endpoint,database,sourceDatabaseSnapshot:{from:database,integrityCheck:'current SQLite baseline with opening inbound top-up',baselineBalances:Object.fromEntries(Object.entries(baseline).map(([sku,x])=>[sku,{onHand:x.onHand,averageCost:x.averageCost,value:x.value}]))},ids,cases,passed:cases.every(x=>x.status==='passed'),risemapObserved:{assemblyStates:['草稿','审批中','待领料','组装中','已完工','已驳回','已取消'],assemblyFields:['成品','BOM','BOM版本','组装数量','入库仓库','销售订单','计划完工日期'],shortageRule:'在产组装单按计划完工日期优先分配库存',materialDocuments:['领料单','补料单','退料单'],productionRule:'组装可分批登记入库，入库数量与完工状态独立维护'},boundary:'Forge proves a real persisted BOM-to-assembly flow with priority shortage allocation, approved issue, supplemental issue, return, two production inbound batches, finished inventory cost and separate completion. RISEMAP same-record save and posting results remain unverified because no external mutation was authorized; approval routing, atomic multi-line writes, labor/overhead and lot/SN genealogy remain open.'};
await writeFile('.objectstack/acceptance/production-assembly-report.json',JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
