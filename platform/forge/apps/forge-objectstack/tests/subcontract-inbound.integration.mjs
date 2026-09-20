import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint=process.env.FORGE_URL||'http://localhost:4388',database=process.env.FORGE_DB||'.objectstack/data/objectstack.db';
const stamp=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
const base=JSON.parse(await readFile('.objectstack/acceptance/subcontract-issue-report.json','utf8')),api=await connect(endpoint),cases=[],ids={...base.ids,operator:api.userId};
const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;
async function test(name,run){try{await run();cases.push({name,status:'passed'});console.log('PASS '+name)}catch(error){cases.push({name,status:'failed',error:error.message});console.error('FAIL '+name+': '+error.message)}}
async function read(object,id){const r=await api.request('/data/'+object+'/'+id);assert.equal(r.status,200,object+'/'+id);return r.value.record}
async function find(object,where={}){const q=new URLSearchParams({$filter:JSON.stringify(where),$top:'200'}),r=await api.request('/data/'+object+'?'+q);assert.equal(r.status,200,object);return(r.value.records||[]).filter(row=>Object.entries(where).every(([key,value])=>row[key]===value))}
const invoke=(object,action,id,params={},authenticated=true)=>api.request('/actions/'+object+'/'+action+'/'+id,'POST',{params},authenticated),resultOf=r=>r.value?.result??r.value?.data?.result??r.value?.data??r.value;
const receiptParams={receipt_code:'SR-INB-'+stamp+'-001',receipt_on:'2026-09-12',lines_json:JSON.stringify([{order_line_id:ids.customerLine,received_quantity:3,qualified_quantity:2,defective_quantity:1,batch_number:'SC-FG-BATCH-001'}]),consumptions_json:JSON.stringify([{plan_id:ids.customerPlan,actual_quantity:6}]),remarks:'首批委外回厂验收'};

await test('creates and submits a pending inbound without moving stock or order totals',async()=>{
  let result={status:'pending_inbound',material_amount:0,formal_stock_added:0};
  if(process.env.FORGE_REUSE_RECEIPT==='1') {
    const receiptReport=JSON.parse(await readFile('.objectstack/acceptance/subcontract-receipt-report.json','utf8'));
    assert.equal(receiptReport.passed,true); Object.assign(ids,receiptReport.ids);
  } else {
    assert.equal((await invoke('forge_subcontract_order','subcontract_receipt_create',ids.customerSuppliedOrder,receiptParams,false)).status,401);
    const created=await invoke('forge_subcontract_order','subcontract_receipt_create',ids.customerSuppliedOrder,receiptParams);assert.equal(created.status,200,JSON.stringify(created.value));const draft=resultOf(created);ids.receipt=draft.id;ids.receiptLine=draft.line_ids[0];ids.consumption=draft.consumption_ids[0];
    const submitted=await invoke('forge_subcontract_receipt','subcontract_receipt_submit',ids.receipt);assert.equal(submitted.status,200,JSON.stringify(submitted.value));result=resultOf(submitted);ids.inbound=result.inbound_id;
  }
  const [receipt,line,consumption,inbound,inboundLines,stock,backflushLedgers,order,orderLine,plan,finishedBalances,finishedLedgers]=await Promise.all([read('forge_subcontract_receipt',ids.receipt),read('forge_subcontract_receipt_line',ids.receiptLine),read('forge_subcontract_receipt_consumption',ids.consumption),read('forge_subcontract_inbound',ids.inbound),find('forge_subcontract_inbound_line',{inbound_id:ids.inbound}),read('forge_subcontract_stock_balance',ids.stockBalance),find('forge_subcontract_stock_ledger',{source_id:ids.inbound}),read('forge_subcontract_order',ids.customerSuppliedOrder),read('forge_subcontract_order_line',ids.customerLine),read('forge_subcontract_material_plan',ids.customerPlan),find('forge_inventory_balance',{balance_key:ids.receiptWarehouse+':'+ids.finishedSku}),find('forge_inventory_ledger',{source_id:ids.inbound})]);ids.inboundLine=inboundLines[0]?.id;
  ids.finishedBeforeOnHand=Number(finishedBalances[0]?.on_hand_quantity||0);ids.finishedBeforeValue=Number(finishedBalances[0]?.inventory_value||0);
  assert.deepEqual({result:[result.status,result.material_amount,result.formal_stock_added],receipt:receipt.status,line:line.status,consumption:[consumption.status,consumption.amount],inbound:[inbound.status,inbound.total_quantity,inbound.processing_amount,inbound.material_amount,inbound.inventory_amount,inbound.valuation_status],stock:[stock.on_hand_quantity,stock.backflushed_quantity,stock.inventory_value],backflush:backflushLedgers.length,order:[order.status,order.received_quantity,order.backflushed_quantity,order.overconsumption_quantity],orderLine:[orderLine.received_good_quantity,orderLine.received_bad_quantity],plan:[plan.backflushed_quantity,plan.overconsumption_quantity],finishedLedgers:finishedLedgers.length},
  {result:['pending_inbound',0,0],receipt:'pending_inbound',line:'pending_inbound',consumption:['pending_backflush',0],inbound:['pending',2,71,0,0,'processing_only'],stock:[6,0,75],backflush:0,order:['in_progress',0,0,0],orderLine:[0,0],plan:[0,0],finishedLedgers:0});
});

await test('confirms once and posts finished stock, material backflush and order totals together',async()=>{
  let r=await invoke('forge_subcontract_inbound','subcontract_inbound_confirm',ids.inbound,{confirm_note:'仓库复核合格品、批次和实际耗用无误'});assert.equal(r.status,200,JSON.stringify(r.value));const result=resultOf(r);assert.deepEqual({status:result.status,stock:result.formal_stock_added,material:result.material_amount,processing:result.processing_amount,inventory:result.inventory_amount,valuation:result.valuation_status,order:result.order_status},{status:'stocked',stock:2,material:75,processing:71,inventory:146,valuation:'fully_costed',order:'in_progress'});
  r=await invoke('forge_subcontract_inbound','subcontract_inbound_confirm',ids.inbound,{confirm_note:'重复确认'});assert.ok(r.status>=400,JSON.stringify(r.value));
  const [receipt,line,consumption,inbound,inboundLine,stock,backflushLedgers,order,orderLine,plan,balances,ledgers,logs]=await Promise.all([read('forge_subcontract_receipt',ids.receipt),read('forge_subcontract_receipt_line',ids.receiptLine),read('forge_subcontract_receipt_consumption',ids.consumption),read('forge_subcontract_inbound',ids.inbound),read('forge_subcontract_inbound_line',ids.inboundLine),read('forge_subcontract_stock_balance',ids.stockBalance),find('forge_subcontract_stock_ledger',{source_id:ids.inbound}),read('forge_subcontract_order',ids.customerSuppliedOrder),read('forge_subcontract_order_line',ids.customerLine),read('forge_subcontract_material_plan',ids.customerPlan),find('forge_inventory_balance',{balance_key:ids.receiptWarehouse+':'+ids.finishedSku}),find('forge_inventory_ledger',{source_id:ids.inbound}),find('forge_subcontract_receipt_log',{receipt_id:ids.receipt})]);ids.backflushLedger=backflushLedgers[0]?.id;ids.finishedBalance=balances[0]?.id;ids.finishedLedger=ledgers[0]?.id;
  assert.deepEqual({
    receipt:receipt.status,
    line:line.status,
    consumption:[consumption.status,consumption.unit_cost,consumption.amount],
    inbound:[inbound.status,inbound.material_amount,inbound.inventory_amount,inbound.valuation_status],
    inboundLine:[inboundLine.status,inboundLine.material_amount,inboundLine.processing_amount,inboundLine.unit_cost,inboundLine.inventory_amount,round4(Number(inboundLine.after_on_hand)-Number(inboundLine.before_on_hand))],
    stock:[stock.on_hand_quantity,stock.backflushed_quantity,stock.inventory_value],
    backflush:[backflushLedgers.length,backflushLedgers[0]?.movement_type,backflushLedgers[0]?.quantity,backflushLedgers[0]?.amount],
    order:[order.status,order.received_quantity,order.backflushed_quantity,order.overconsumption_quantity],
    orderLine:[orderLine.received_good_quantity,orderLine.received_bad_quantity],
    plan:[plan.backflushed_quantity,plan.overconsumption_quantity],
    balanceDelta:[round4(Number(balances[0]?.on_hand_quantity||0)-Number(ids.finishedBeforeOnHand||0)),round4(Number(balances[0]?.available_quantity||0)-Number(ids.finishedBeforeOnHand||0)),round4(Number(balances[0]?.inventory_value||0)-Number(ids.finishedBeforeValue||0))],
    ledger:[ledgers.length,ledgers[0]?.movement_type,ledgers[0]?.quantity,ledgers[0]?.unit_cost,ledgers[0]?.amount],
    logs:logs.map(x=>x.action).sort()
  },
  {receipt:'stocked',line:'stocked',consumption:['backflushed',12.5,75],inbound:['stocked',75,146,'fully_costed'],inboundLine:['stocked',75,71,73,146,2],stock:[0,6,0],backflush:[1,'backflush',6,75],order:['in_progress',3,6,0.18],orderLine:[2,1],plan:[6,0.18],balanceDelta:[2,2,146],ledger:[1,'subcontract_receipt_inbound',2,73,146],logs:['exception_recorded','inbound_created','stocked','submitted']});
});

const report={suite:'subcontract-inbound-confirm',endpoint,database,ids,cases,passed:cases.every(x=>x.status==='passed'),completedAt:new Date().toISOString(),result:{receipt:{received:3,qualified:2,defective:1},pendingBoundary:{supplierStock:6,orderReceived:0,formalStockAdded:0},confirmed:{supplierStock:0,materialAmount:75,processingAmount:71,finishedQuantity:2,finishedUnitCost:73,finishedAmount:146,orderReceived:3,finishedBeforeOnHand:ids.finishedBeforeOnHand,finishedBeforeValue:ids.finishedBeforeValue}},risemapLiveEvidence:{routes:['/subcontract/receives/new','/subcontract/receives/:id','/inventory/subcontract-stock'],observed:['提交审核只生成待入库，不直接增加正式库存','确认入库后良品正式入库、材料实际耗用倒冲、订单累计同步更新','已完成入库不能撤回审核','成品入库和材料倒冲分别形成库存流水']},valuationBoundary:'RISEMAP 当前页面未直接展示成品计价公式；Forge 暂按每条回厂明细的实际材料成本加良品加工费形成成品入库成本。',boundary:'已闭环回厂提交到确认入库、正式库存、材料倒冲、订单累计和同库重启回读。不良 NCR、退料、补料、赔扣、对账和应付仍属后续切片。'};
await mkdir('.objectstack/acceptance',{recursive:true});await writeFile('.objectstack/acceptance/subcontract-inbound-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
