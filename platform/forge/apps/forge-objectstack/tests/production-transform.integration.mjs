import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint=process.env.FORGE_URL||'http://localhost:4357',database=process.env.FORGE_DB||'.objectstack/data/objectstack.db',api=await connect(endpoint),cases=[],ids={operator:api.userId};
const stamp=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;
async function test(name,run){try{await run();cases.push({name,status:'passed'});console.log('PASS '+name);}catch(error){cases.push({name,status:'failed',error:error.message});console.error('FAIL '+name+': '+error.message);}}
async function find(object,where={}){const q=new URLSearchParams({$filter:JSON.stringify(where),$top:'200'}),r=await api.request(`/data/${object}?${q}`);assert.equal(r.status,200,object+': '+JSON.stringify(r.value));return (r.value.records||[]).filter(x=>Object.entries(where).every(([k,v])=>x[k]===v));}
async function read(object,id){const r=await api.request(`/data/${object}/${id}`);assert.equal(r.status,200,object+'/'+id+': '+JSON.stringify(r.value));return r.value.record;}
async function invoke(object,action,id,params={},authenticated=true){return api.request(`/actions/${object}/${action}/${id}`,'POST',{params},authenticated);}
const resultOf=r=>r.value?.result??r.value?.data?.result??r.value?.data??r.value;
const create=(object,data)=>api.request('/data/'+object,'POST',data);
const patch=(object,id,data)=>api.request('/data/'+object+'/'+id,'PATCH',data);
async function ensureReason(object,name,description){const existing=(await find(object,{name}))[0];if(existing){if(!(existing.enabled===true||existing.enabled===1||existing.enabled==='1')){const response=await patch(object,existing.id,{enabled:true});assert.equal(response.status,200,JSON.stringify(response.value));}return await read(object,existing.id);}const response=await create(object,{name,code:(object.includes('disassembly')?'DR-':'RR-')+stamp,description,color:'#245bdb',enabled:true,sort_order:0});assert.equal(response.status,201,JSON.stringify(response.value));return await read(object,response.value.id||response.value.record?.id);}
async function ensureProductStock(productSku,minimumAvailable){
  const key=warehouse.id+':'+productSku.id;
  const existing=(await find('forge_inventory_balance',{balance_key:key}))[0];
  if(existing&&Number(existing.available_quantity||0)>=minimumAvailable)return existing;
  const productMaterial=await read('forge_material',productSku.material_id);
  const current=Number(existing?.available_quantity||0),quantity=round4(minimumAvailable-current),unitCost=Number(existing?.average_cost||productSku.cost_price||58000);
  const code='IN-TRANS-'+stamp+'-001';
  const inbound=await create('forge_opening_inbound',{name:productMaterial.name+' 拆换验收补充期初',code,inbound_on:'2026-09-10',warehouse_id:warehouse.id,responsible_id:api.userId,remarks:'生产拆换验收前补齐当前库成品库存'});assert.equal(inbound.status,201,JSON.stringify(inbound.value));const inboundId=inbound.value.id||inbound.value.record?.id;
  const line=await create('forge_opening_inbound_line',{name:productMaterial.name,inbound_id:inboundId,sku_id:productSku.id,item_code:productMaterial.code,model:productSku.model||productMaterial.model||'默认型号',specification:productSku.specification||productMaterial.specification||'默认规格',unit_name:'台',quantity,taxed_unit_price:unitCost,untaxed_unit_price:round4(unitCost/1.13),tax_rate:13,tax_amount:round4(quantity*unitCost-quantity*unitCost/1.13),taxed_amount:round4(quantity*unitCost)});assert.equal(line.status,201,JSON.stringify(line.value));
  let r=await invoke('forge_opening_inbound','opening_inbound_submit',inboundId);assert.equal(r.status,200,JSON.stringify(r.value));r=await invoke('forge_opening_inbound','opening_inbound_approve',inboundId,{approval_note:'生产拆换验收补充成品库存'});assert.equal(r.status,200,JSON.stringify(r.value));
  return (await find('forge_inventory_balance',{balance_key:key}))[0];
}

async function ensureSkuStock(sku,minimumAvailable,remarksSuffix){
  const key=warehouse.id+':'+sku.id;
  const existing=(await find('forge_inventory_balance',{balance_key:key}))[0];
  if(existing&&Number(existing.available_quantity||0)>=minimumAvailable)return existing;
  const material=await read('forge_material',sku.material_id);
  const current=Number(existing?.available_quantity||0),quantity=round4(minimumAvailable-current),unitCost=Number(existing?.average_cost||sku.cost_price||0);
  const code='IN-TRANS-'+stamp+'-'+material.code;
  const inbound=await create('forge_opening_inbound',{name:material.name+' 换件验收补充期初',code,inbound_on:'2026-09-10',warehouse_id:warehouse.id,responsible_id:api.userId,remarks:remarksSuffix});assert.equal(inbound.status,201,JSON.stringify(inbound.value));const inboundId=inbound.value.id||inbound.value.record?.id;
  const line=await create('forge_opening_inbound_line',{name:material.name,inbound_id:inboundId,sku_id:sku.id,item_code:material.code,model:sku.model||material.model||'默认型号',specification:sku.specification||material.specification||'默认规格',unit_name:material.unit_name||'件',quantity,taxed_unit_price:unitCost,untaxed_unit_price:round4(unitCost/1.13),tax_rate:13,tax_amount:round4(quantity*unitCost-quantity*unitCost/1.13),taxed_amount:round4(quantity*unitCost)});assert.equal(line.status,201,JSON.stringify(line.value));
  let r=await invoke('forge_opening_inbound','opening_inbound_submit',inboundId);assert.equal(r.status,200,JSON.stringify(r.value));r=await invoke('forge_opening_inbound','opening_inbound_approve',inboundId,{approval_note:remarksSuffix});assert.equal(r.status,200,JSON.stringify(r.value));
  return (await find('forge_inventory_balance',{balance_key:key}))[0];
}

const boms=await find('forge_bom',{status:'active'}),bom=boms.find(x=>x.bom_type==='project')||boms[0];assert.ok(bom,'active BOM required');ids.bom=bom.id;
const warehouse=(await find('forge_warehouse'))[0];assert.ok(warehouse);ids.warehouse=warehouse.id;
const nodes=(await find('forge_bom_node',{bom_id:bom.id})).filter(x=>x.parent_id&&x.sku_id);assert.equal(nodes.length,4);
const skuById=Object.fromEntries(await Promise.all(nodes.map(async x=>[x.sku_id,await read('forge_material_sku',x.sku_id)])));
const materialBySku=Object.fromEntries(await Promise.all(nodes.map(async x=>{const sku=skuById[x.sku_id];return[x.sku_id,await read('forge_material',sku.material_id)];})));
const nodeByCode=Object.fromEntries(nodes.map(x=>[materialBySku[x.sku_id].code,x]));
const productSku=(await find('forge_material_sku',{material_id:bom.material_id})).find(x=>x.enabled!==false);assert.ok(productSku);ids.productSku=productSku.id;
const productBalance=await ensureProductStock(productSku,3);assert.ok(productBalance);assert.ok(Number(productBalance.available_quantity)>=3);ids.productBalance=productBalance.id;
const baseline={product:{onHand:Number(productBalance.on_hand_quantity),available:Number(productBalance.available_quantity),average:Number(productBalance.average_cost),value:Number(productBalance.inventory_value)},components:{}};
for(const node of nodes){const balance=(await find('forge_inventory_balance',{balance_key:warehouse.id+':'+node.sku_id}))[0];baseline.components[node.sku_id]={id:balance?.id||null,onHand:Number(balance?.on_hand_quantity||0),available:Number(balance?.available_quantity||0),average:Number(balance?.average_cost||0),value:Number(balance?.inventory_value||0)};}
const disassemblyReason=await ensureReason('forge_production_disassembly_reason','质量返工','成品质量问题需拆解检查并回收可用物料');ids.disassemblyReason=disassemblyReason.id;
const replacementReason=await ensureReason('forge_production_replacement_reason','质量返修','成品保留库存，仅更换不合格内部零部件');ids.replacementReason=replacementReason.id;
const disassemblyQuantity=2, releaseBudget=round4(Number(productBalance.average_cost||0)*disassemblyQuantity);
const candidateRecoveries=nodes.map(node=>({node,theoretical:round4(disassemblyQuantity*Number(node.quantity||0)*(1+Number(node.loss_rate||0)/100)),unitCost:Number(skuById[node.sku_id].cost_price||0)})).sort((a,b)=>a.unitCost-b.unitCost);
let remainingRecoveryBudget=releaseBudget, recoveredOnce=false;
const disassemblyLines=candidateRecoveries.map(({node,theoretical,unitCost})=>{const canRecover=!recoveredOnce&&unitCost>0&&unitCost<=remainingRecoveryBudget;const recovered=canRecover?1:0;if(canRecover){remainingRecoveryBudget=round4(remainingRecoveryBudget-unitCost);recoveredOnce=true;}return{bom_node_id:node.id,recovered_quantity:recovered,scrapped_quantity:round4(theoretical-recovered)};});
const disassemblyParams={mode:'submit',quantity:disassemblyQuantity,warehouse_id:warehouse.id,handled_on:'2026-09-10',reason:disassemblyReason.name,lines_json:JSON.stringify(disassemblyLines),remarks:'OEM-RM-20260909-A RM-070当前库验收'};

await test('blocks disabled configured reasons before creating production orders',async()=>{
  let response=await patch('forge_production_disassembly_reason',disassemblyReason.id,{enabled:false});assert.equal(response.status,200,JSON.stringify(response.value));
  try{const blocked=await invoke('forge_bom','bom_create_disassembly',bom.id,disassemblyParams);assert.equal(blocked.status,400);assert.match(JSON.stringify(blocked.value),/拆解原因已停用/);}finally{response=await patch('forge_production_disassembly_reason',disassemblyReason.id,{enabled:true});assert.equal(response.status,200,JSON.stringify(response.value));}
  response=await patch('forge_production_replacement_reason',replacementReason.id,{enabled:false});assert.equal(response.status,200,JSON.stringify(response.value));
  try{const blocked=await invoke('forge_bom','bom_create_replacement',bom.id,{mode:'draft',quantity:1,handled_on:'2026-09-10',reason:replacementReason.name,lines_json:'[]'});assert.equal(blocked.status,400);assert.match(JSON.stringify(blocked.value),/改制原因已停用/);}finally{response=await patch('forge_production_replacement_reason',replacementReason.id,{enabled:true});assert.equal(response.status,200,JSON.stringify(response.value));}
});

await test('rejects anonymous and incomplete disassembly while preserving stock',async()=>{
  assert.equal((await invoke('forge_bom','bom_create_disassembly',bom.id,disassemblyParams,false)).status,401);
  const invalid={...disassemblyParams,lines_json:JSON.stringify(disassemblyLines.map((x,i)=>i?x:{...x,recovered_quantity:0,scrapped_quantity:0}))};const response=await invoke('forge_bom','bom_create_disassembly',bom.id,invalid);assert.equal(response.status,400);assert.match(JSON.stringify(response.value),/必须等于理论拆出数量/);
  assert.equal(Number((await read('forge_inventory_balance',productBalance.id)).on_hand_quantity),baseline.product.onHand);
});

await test('saves disassembly draft without warehouse and requires warehouse before submission',async()=>{
  const beforeStock=Number((await read('forge_inventory_balance',productBalance.id)).on_hand_quantity),draftParams={...disassemblyParams,mode:'draft',warehouse_id:''};
  const created=await invoke('forge_bom','bom_create_disassembly',bom.id,draftParams);assert.equal(created.status,200,JSON.stringify(created.value));const draftResult=resultOf(created);ids.disassemblyDraft=draftResult.id;assert.equal(draftResult.status,'draft');
  let order=await read('forge_disassembly_order',ids.disassemblyDraft);assert.equal(order.status,'draft');assert.ok(!order.warehouse_id);assert.equal((await find('forge_inventory_ledger',{source_id:ids.disassemblyDraft})).length,0);assert.equal(Number((await read('forge_inventory_balance',productBalance.id)).on_hand_quantity),beforeStock);
  const blocked=await invoke('forge_disassembly_order','disassembly_submit',ids.disassemblyDraft,{warehouse_id:'',submit_note:'缺少仓库'});assert.equal(blocked.status,400);assert.match(JSON.stringify(blocked.value),/warehouse_id.*required|必须选择出入库仓库/);
  const submitted=await invoke('forge_disassembly_order','disassembly_submit',ids.disassemblyDraft,{warehouse_id:warehouse.id,submit_note:'拆解草稿与仓库已核对'});assert.equal(submitted.status,200,JSON.stringify(submitted.value));order=await read('forge_disassembly_order',ids.disassemblyDraft);assert.equal(order.status,'pending_approval');assert.equal(order.warehouse_id,warehouse.id);assert.ok((await find('forge_disassembly_line',{disassembly_id:ids.disassemblyDraft})).every(x=>x.status==='pending_approval'));assert.equal((await find('forge_inventory_ledger',{source_id:ids.disassemblyDraft})).length,0);
});

let expectedRecovery=0;
await test('creates a pending full-BOM disassembly without moving inventory',async()=>{
  const response=await invoke('forge_bom','bom_create_disassembly',bom.id,disassemblyParams);assert.equal(response.status,200,JSON.stringify(response.value));const result=resultOf(response);ids.disassembly=result.id;assert.match(result.code,/^DIS-2026-/);assert.deepEqual({status:result.status,lines:result.line_count},{status:'pending_approval',lines:4});
  const lines=await find('forge_disassembly_line',{disassembly_id:ids.disassembly});assert.equal(lines.length,4);assert.ok(lines.every(x=>round4(Number(x.recovered_quantity)+Number(x.scrapped_quantity))===Number(x.theoretical_quantity)&&x.status==='pending_approval'));expectedRecovery=round4(lines.reduce((sum,line)=>sum+Number(line.recovered_amount||0),0));assert.ok(expectedRecovery<=releaseBudget,'recovery value must not exceed released product cost');assert.ok(lines.some(line=>Number(line.recovered_quantity||0)>0),'current material should keep at least one recovered component');assert.equal((await find('forge_inventory_ledger',{source_id:ids.disassembly})).length,0);assert.equal(Number((await read('forge_inventory_balance',productBalance.id)).on_hand_quantity),baseline.product.onHand);
});

let releasedCost,scrapLoss;
await test('confirms disassembly with one finished outbound and current-cost recovered component ledgers',async()=>{
  assert.equal((await invoke('forge_disassembly_order','disassembly_confirm',ids.disassembly,{approval_note:' '})).status,400);
  const response=await invoke('forge_disassembly_order','disassembly_confirm',ids.disassembly,{approval_note:'成品库存、拆解分配和回收价值已核对'});assert.equal(response.status,200,JSON.stringify(response.value));const result=resultOf(response);releasedCost=round4(baseline.product.average*disassemblyQuantity);scrapLoss=round4(releasedCost-expectedRecovery);assert.deepEqual({status:result.status,before:result.product_before_on_hand,after:result.product_after_on_hand,released:result.released_cost,recovered:result.recovered_value,loss:result.scrap_loss},{status:'stocked',before:baseline.product.onHand,after:baseline.product.onHand-disassemblyQuantity,released:releasedCost,recovered:expectedRecovery,loss:scrapLoss});
  const order=await read('forge_disassembly_order',ids.disassembly);assert.equal(order.reason_id,disassemblyReason.id);assert.deepEqual({status:order.status,released:order.released_cost,recovered:order.recovered_value,loss:order.scrap_loss},{status:'stocked',released:releasedCost,recovered:expectedRecovery,loss:scrapLoss});const product=await read('forge_inventory_balance',productBalance.id);assert.equal(Number(product.on_hand_quantity),round4(baseline.product.onHand-disassemblyQuantity));const ledgers=await find('forge_inventory_ledger',{source_id:ids.disassembly});assert.equal(ledgers.filter(x=>x.movement_type==='disassembly_outbound').length,1);assert.ok(ledgers.filter(x=>x.movement_type==='disassembly_recovery').length>=1);assert.equal(ledgers.length,1+ledgers.filter(x=>x.movement_type==='disassembly_recovery').length);
  for(const node of nodes){const base=baseline.components[node.sku_id],balance=(await find('forge_inventory_balance',{balance_key:warehouse.id+':'+node.sku_id}))[0];assert.equal(Number(balance.on_hand_quantity),round4(base.onHand+Number(disassemblyLines.find(line=>line.bom_node_id===node.id)?.recovered_quantity||0)));}
  assert.equal((await invoke('forge_disassembly_order','disassembly_confirm',ids.disassembly,{approval_note:'重复确认'})).status,400);
});

await ensureSkuStock(skuById[nodeByCode['RM-PLC-1215C'].sku_id],1,'生产换件验收补充 PLC 新件库存');
await ensureSkuStock(skuById[nodeByCode['RM-CAB-800'].sku_id],1,'生产换件验收补充柜体新件库存');
const replacementLines=[
  {old_bom_node_id:nodeByCode['RM-HMI-700'].id,old_quantity:1,old_destination:'recover',new_sku_id:nodeByCode['RM-PLC-1215C'].sku_id,new_quantity:1},
  {old_bom_node_id:nodeByCode['RM-PSU-24V10A'].id,old_quantity:1,old_destination:'scrap',new_sku_id:nodeByCode['RM-CAB-800'].sku_id,new_quantity:1},
];
const replacementParams={mode:'submit',quantity:1,warehouse_id:warehouse.id,handled_on:'2026-09-10',reason:replacementReason.name,lines_json:JSON.stringify(replacementLines),remarks:'OEM-RM-20260909-A RM-071验收'};

await test('saves replacement draft without warehouse and requires warehouse before submission',async()=>{
  const beforeProduct=Number((await read('forge_inventory_balance',productBalance.id)).on_hand_quantity),beforeLedgers=(await find('forge_inventory_ledger')).length,draftParams={...replacementParams,mode:'draft',warehouse_id:''};
  const created=await invoke('forge_bom','bom_create_replacement',bom.id,draftParams);assert.equal(created.status,200,JSON.stringify(created.value));const draftResult=resultOf(created);ids.replacementDraft=draftResult.id;assert.equal(draftResult.status,'draft');
  let order=await read('forge_replacement_order',ids.replacementDraft);assert.equal(order.status,'draft');assert.ok(!order.warehouse_id);assert.equal((await find('forge_inventory_ledger')).length,beforeLedgers);assert.equal(Number((await read('forge_inventory_balance',productBalance.id)).on_hand_quantity),beforeProduct);
  const blocked=await invoke('forge_replacement_order','replacement_submit',ids.replacementDraft,{warehouse_id:'',submit_note:'缺少仓库'});assert.equal(blocked.status,400);assert.match(JSON.stringify(blocked.value),/warehouse_id.*required|必须选择出入库仓库/);
  const submitted=await invoke('forge_replacement_order','replacement_submit',ids.replacementDraft,{warehouse_id:warehouse.id,submit_note:'换件草稿与仓库已核对'});assert.equal(submitted.status,200,JSON.stringify(submitted.value));order=await read('forge_replacement_order',ids.replacementDraft);assert.equal(order.status,'pending_approval');assert.equal(order.warehouse_id,warehouse.id);assert.ok((await find('forge_replacement_line',{replacement_id:ids.replacementDraft})).every(x=>x.status==='pending_approval'));assert.equal((await find('forge_inventory_ledger')).length,beforeLedgers);
});

await test('creates a pending replacement with recover and scrap destinations but no stock movement',async()=>{
  const over={...replacementParams,lines_json:JSON.stringify([{...replacementLines[0],old_quantity:2}])};const rejected=await invoke('forge_bom','bom_create_replacement',bom.id,over);assert.equal(rejected.status,400);assert.match(JSON.stringify(rejected.value),/不能超过当前BOM理论数量/);
  const beforeProduct=await read('forge_inventory_balance',productBalance.id),beforeLedgers=(await find('forge_inventory_ledger')).length;const response=await invoke('forge_bom','bom_create_replacement',bom.id,replacementParams);assert.equal(response.status,200,JSON.stringify(response.value));const result=resultOf(response);ids.replacement=result.id;const replacementOrder=await read('forge_replacement_order',ids.replacement);assert.equal(replacementOrder.reason_id,replacementReason.id);assert.match(result.code,/^REP-2026-/);assert.deepEqual({status:result.status,lines:result.line_count},{status:'pending_approval',lines:2});assert.equal((await find('forge_replacement_line',{replacement_id:ids.replacement})).length,2);assert.equal(Number((await read('forge_inventory_balance',productBalance.id)).on_hand_quantity),Number(beforeProduct.on_hand_quantity));assert.equal((await find('forge_inventory_ledger')).length,beforeLedgers);
});

await test('confirms replacement while finished stock stays constant and only recovered old parts return',async()=>{
  const beforeProduct=await read('forge_inventory_balance',productBalance.id),beforeByCode={};for(const code of ['RM-HMI-700','RM-PSU-24V10A','RM-PLC-1215C','RM-CAB-800'])beforeByCode[code]=(await find('forge_inventory_balance',{balance_key:warehouse.id+':'+nodeByCode[code].sku_id}))[0];
  const response=await invoke('forge_replacement_order','replacement_confirm',ids.replacement,{approval_note:'整机在库、新件库存与旧件处置已核对'});assert.equal(response.status,200,JSON.stringify(response.value));const result=resultOf(response);const expectedNewCost=round4(Number(beforeByCode['RM-PLC-1215C'].average_cost||0)+Number(beforeByCode['RM-CAB-800'].average_cost||0)),expectedOldValue=3200,expectedChange=round4(expectedNewCost-expectedOldValue);assert.deepEqual({status:result.status,before:result.product_before_on_hand,after:result.product_after_on_hand,newCost:result.new_part_cost,oldValue:result.old_part_value,change:result.cost_change},{status:'stocked',before:Number(beforeProduct.on_hand_quantity),after:Number(beforeProduct.on_hand_quantity),newCost:expectedNewCost,oldValue:expectedOldValue,change:expectedChange});const afterProduct=await read('forge_inventory_balance',productBalance.id);assert.equal(Number(afterProduct.on_hand_quantity),Number(beforeProduct.on_hand_quantity));assert.equal(Number(afterProduct.inventory_value),Number(beforeProduct.inventory_value));
  const after={};for(const code of Object.keys(beforeByCode))after[code]=(await find('forge_inventory_balance',{balance_key:warehouse.id+':'+nodeByCode[code].sku_id}))[0];assert.equal(Number(after['RM-HMI-700'].on_hand_quantity),Number(beforeByCode['RM-HMI-700'].on_hand_quantity)+1);assert.equal(Number(after['RM-PSU-24V10A'].on_hand_quantity),Number(beforeByCode['RM-PSU-24V10A'].on_hand_quantity));assert.equal(Number(after['RM-PLC-1215C'].on_hand_quantity),Number(beforeByCode['RM-PLC-1215C'].on_hand_quantity)-1);assert.equal(Number(after['RM-CAB-800'].on_hand_quantity),Number(beforeByCode['RM-CAB-800'].on_hand_quantity)-1);
  const ledgers=await find('forge_inventory_ledger',{source_id:ids.replacement});assert.equal(ledgers.length,3);assert.equal(ledgers.filter(x=>x.movement_type==='replacement_issue').length,2);assert.equal(ledgers.filter(x=>x.movement_type==='replacement_recovery').length,1);const lines=await find('forge_replacement_line',{replacement_id:ids.replacement});assert.ok(lines.every(x=>x.status==='stocked'));assert.equal(lines.find(x=>x.old_item_code==='RM-PSU-24V10A').old_recovered_amount,0);const stored=await read('forge_replacement_order',ids.replacement);ids.replacementNewPartCost=stored.new_part_cost;ids.replacementOldPartValue=stored.old_part_value;ids.replacementCostChange=stored.cost_change;assert.equal((await invoke('forge_replacement_order','replacement_confirm',ids.replacement,{approval_note:'重复确认'})).status,400);
});

await mkdir('.objectstack/acceptance',{recursive:true});
const report={recordedAt:new Date().toISOString(),kind:'risemap-observed-production-transform-forge-closure',fixture:'OEM-RM-20260909-A-production-transform-v0.1',endpoint,database,sourceDatabaseSnapshot:{from:database,integrityCheck:'current SQLite baseline',baseline,disassemblyQuantity,disassemblyLines},ids,cases,passed:cases.every(x=>x.status==='passed'),financials:{disassembly:{releasedCost,recoveredValue:expectedRecovery,scrapLoss},replacement:{newPartCost:ids.replacementNewPartCost,oldPartValue:ids.replacementOldPartValue,costChange:ids.replacementCostChange}},risemapObserved:{disassembly:'成品库存减少，每项理论拆出量完整分配为回收或报废',replacement:'成品库存不变，新件领用出库，旧件可回收入库或报废'},boundary:'Forge proves draft submission and persisted disassembly/replacement postings on the continued OTC inventory. The current RISEMAP list and new forms were inspected in the built-in browser; its reason dictionary had no selectable values, so same-record RISEMAP submission and posting remain blocked upstream. Forge reason dictionaries are implemented as configurable business data and linked to persisted orders; disabled configured reasons are blocked. Writes are sequential rather than transactionally atomic; approval routing and lot/SN genealogy remain open.'};
await writeFile('.objectstack/acceptance/production-transform-report.json',JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
