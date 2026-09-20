import { defineAction } from '@objectstack/spec';

const locations = ['record_header', 'record_more'] as const;
const round4 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;

export const SubcontractReconciliationCreate = defineAction({
  name: 'subcontract_reconciliation_create', label: '生成委外对账单', objectName: 'forge_supplier', icon: 'file-check-2',
  locations: [...locations], order: 40,
  params: [
    { field: 'code', objectOverride: 'forge_subcontract_reconciliation', required: true },
    { field: 'period_start', objectOverride: 'forge_subcontract_reconciliation', required: true },
    { field: 'period_end', objectOverride: 'forge_subcontract_reconciliation', required: true },
    { name: 'receipt_ids_json', label: '回厂批次 ID', type: 'textarea', required: true },
  ],
  successMessage: '委外对账单已生成，等待供应商确认',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;const supplierId=ctx.recordId||(ctx.record&&ctx.record.id),actor=ctx.session&&ctx.session.userId,code=String(ctx.input.code||'').trim(),start=String(ctx.input.period_start||''),end=String(ctx.input.period_end||'');
if(ctx.recordLoadDenied===true||!supplierId||!ctx.record)throw new Error('供应商不存在或不可访问');if(!actor)throw new Error('无法识别当前制单人');
if(!code||!/^\\d{4}-\\d{2}-\\d{2}$/.test(start)||!/^\\d{4}-\\d{2}-\\d{2}$/.test(end)||end<start)throw new Error('对账单号和账期必须完整且有效');
let receiptIds;try{receiptIds=JSON.parse(String(ctx.input.receipt_ids_json||'[]'));}catch(e){throw new Error('回厂批次选择格式不正确');}if(!Array.isArray(receiptIds)||!receiptIds.length)throw new Error('至少选择一个已入库回厂批次');
if((await ctx.api.object('forge_subcontract_reconciliation').find({where:{code}})).length)throw new Error('委外对账单号已存在');
const receipts=await ctx.api.object('forge_subcontract_receipt').find({where:{supplier_id:supplierId}}),selected=receipts.filter(x=>receiptIds.includes(x.id));if(selected.length!==receiptIds.length)throw new Error('存在不属于当前供应商或不存在的回厂批次');
const lines=await ctx.api.object('forge_subcontract_receipt_line').find({where:{}}),inbounds=await ctx.api.object('forge_subcontract_inbound').find({where:{}}),ncrs=await ctx.api.object('forge_subcontract_ncr').find({where:{}}),existing=await ctx.api.object('forge_subcontract_reconciliation_line').find({where:{}}),activeRecon=await ctx.api.object('forge_subcontract_reconciliation').find({where:{}}),activeIds=new Set(activeRecon.filter(x=>x.status!=='voided').map(x=>x.id));
const eligible=[];for(const receipt of selected){if(!['stocked','ncr_resolved'].includes(receipt.status))throw new Error(receipt.code+' 尚未完成回厂入库或不良处置');const inbound=inbounds.find(x=>x.id===receipt.inbound_id);if(Number(receipt.qualified_quantity||0)>0&&(!inbound||inbound.status!=='stocked'))throw new Error(receipt.code+' 的良品尚未完成正式入库');const relatedNcr=ncrs.filter(x=>x.receipt_id===receipt.id);if(relatedNcr.some(x=>x.status!=='executed'))throw new Error(receipt.code+' 存在未完成的不良处置');const receiptLines=lines.filter(x=>x.receipt_id===receipt.id&&Number(x.qualified_quantity||0)>0);if(!receiptLines.length)throw new Error(receipt.code+' 没有可结算的合格回厂明细');for(const line of receiptLines){const occupied=existing.some(x=>x.receipt_line_id===line.id&&activeIds.has(x.reconciliation_id));if(occupied)throw new Error(line.name+' 已被其他有效委外对账单占用');eligible.push({receipt,line});}}
const processing=round4(eligible.reduce((sum,x)=>sum+Number(x.line.settlement_amount||0),0));if(!(processing>0))throw new Error('选中的回厂批次没有正的可结算加工费');
const now=new Date().toISOString(),made=await ctx.api.object('forge_subcontract_reconciliation').insert({name:ctx.record.name+' '+code,code,supplier_id:supplierId,period_start:start,period_end:end,generation_dimension:'receipt_batch',processing_amount:processing,replenishment_amount:0,deduction_amount:0,refund_amount:0,payable_amount:processing,line_count:eligible.length,status:'pending_confirmation',responsible_id:actor,remarks:'按已入库回厂批次生成；应付=加工费+补料-扣款'}),id=typeof made==='string'?made:made&&(made.id||(made.record&&made.record.id));if(!id)throw new Error('委外对账单创建后未返回 ID');
for(const [index,x] of eligible.entries())await ctx.api.object('forge_subcontract_reconciliation_line').insert({name:code+'-'+String(index+1).padStart(3,'0')+' '+x.line.name,reconciliation_id:id,supplier_id:supplierId,order_id:x.line.order_id,receipt_id:x.receipt.id,receipt_line_id:x.line.id,fee_type:'processing',occurred_on:x.receipt.receipt_on,quantity:Number(x.line.qualified_quantity||0),unit_price:Number(x.line.processing_unit_price||0),amount:Number(x.line.settlement_amount||0),source_status_snapshot:x.receipt.status,source_key:'receipt-line:'+x.line.id,description:'回厂合格品加工费',responsible_id:actor});
await ctx.api.object('forge_subcontract_reconciliation_log').insert({name:code+' 生成',reconciliation_id:id,action:'generated',from_status:'',to_status:'pending_confirmation',comment:'已入库回厂批次 '+selected.map(x=>x.code).join('、'),occurred_at:now,operator_id:actor});return{id,status:'pending_confirmation',line_count:eligible.length,processing_amount:processing,payable_amount:processing};
` },
});

export const SubcontractReconciliationConfirm = defineAction({
  name: 'subcontract_reconciliation_confirm', label: '确认并锁定', objectName: 'forge_subcontract_reconciliation', icon: 'badge-check',
  locations: [...locations], order: 20, visible: `record.status == 'pending_confirmation'`, refreshAfter: true,
  params: [{ name: 'confirmation_note', label: '确认说明', type: 'textarea', required: true }], successMessage: '委外对账单已确认锁定',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;const id=ctx.recordId||(ctx.record&&ctx.record.id),record=ctx.record,actor=ctx.session&&ctx.session.userId,note=String(ctx.input.confirmation_note||'').trim();if(ctx.recordLoadDenied===true||!id||!record)throw new Error('委外对账单不存在或不可访问');if(!actor||!note)throw new Error('确认人和确认说明不能为空');if(record.status!=='pending_confirmation')throw new Error('仅待确认委外对账单可以确认');
const lines=await ctx.api.object('forge_subcontract_reconciliation_line').find({where:{reconciliation_id:id}});if(!lines.length)throw new Error('委外对账单没有冻结明细');const byOrder={};for(const line of lines)byOrder[line.order_id]=(byOrder[line.order_id]||0)+Number(line.amount||0);
for(const orderId of Object.keys(byOrder)){const order=await ctx.api.object('forge_subcontract_order').findOne({where:{id:orderId}});if(!order)throw new Error('对账明细关联委外订单不存在');const next=round4(Number(order.reconciled_amount||0)+byOrder[orderId]);if(next>Number(order.processing_amount||0)+0.0001)throw new Error(order.code+' 累计已对账金额超过加工费');await ctx.api.object('forge_subcontract_order').update({id:order.id,reconciled_amount:next,status:next>=Number(order.processing_amount||0)-0.0001?'reconciled':order.status});}
const now=new Date().toISOString();await ctx.api.object('forge_subcontract_reconciliation').update({id,status:'confirmed',confirmed_by:actor,confirmed_at:now,confirmation_note:note});await ctx.api.object('forge_subcontract_reconciliation_log').insert({name:record.code+' 确认锁定',reconciliation_id:id,action:'confirmed',from_status:'pending_confirmation',to_status:'confirmed',comment:note,occurred_at:now,operator_id:actor});return{id,status:'confirmed',confirmed_amount:Number(record.payable_amount||0)};
` },
});

export const SubcontractReconciliationGeneratePayable = defineAction({
  name: 'subcontract_reconciliation_generate_payable', label: '生成财务应付', objectName: 'forge_subcontract_reconciliation', icon: 'hand-coins',
  locations: [...locations], order: 30, visible: `record.status == 'confirmed'`, refreshAfter: true, successMessage: '委外财务应付已生成',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),record=ctx.record,actor=ctx.session&&ctx.session.userId;if(ctx.recordLoadDenied===true||!id||!record)throw new Error('委外对账单不存在或不可访问');if(!actor)throw new Error('无法识别当前生成人');if(record.status==='payable_generated')return{id,status:record.status,payable_id:record.payable_id,idempotent:true};if(record.status!=='confirmed')throw new Error('仅已确认委外对账单可以生成应付');
const existing=await ctx.api.object('forge_accounts_payable').find({where:{reconciliation_id:id}});if(existing.length){const payable=existing[0];await ctx.api.object('forge_subcontract_reconciliation').update({id,status:'payable_generated',payable_id:payable.id});return{id,status:'payable_generated',payable_id:payable.id,idempotent:true};}
const supplier=await ctx.api.object('forge_supplier').findOne({where:{id:record.supplier_id}});if(!supplier)throw new Error('对账供应商不存在');const now=new Date().toISOString(),made=await ctx.api.object('forge_accounts_payable').insert({name:record.code+' 委外应付',code:'AP-'+record.code,source_type:'subcontract_reconciliation',reconciliation_id:id,inbound_id:null,invoice_id:null,order_id:null,supplier_id:record.supplier_id,recognized_on:record.period_end,due_on:record.period_end,original_amount:Number(record.payable_amount||0),paid_amount:0,offset_amount:0,red_reversed_amount:0,outstanding_amount:Number(record.payable_amount||0),invoice_marker:'unknown',status:'unpaid',responsible_id:record.responsible_id||actor,remarks:'由委外对账单生成'}),payableId=typeof made==='string'?made:made&&(made.id||(made.record&&made.record.id));if(!payableId)throw new Error('委外应付创建后未返回 ID');await ctx.api.object('forge_subcontract_reconciliation').update({id,status:'payable_generated',payable_id:payableId,payable_generated_by:actor,payable_generated_at:now});await ctx.api.object('forge_subcontract_reconciliation_log').insert({name:record.code+' 生成应付',reconciliation_id:id,action:'payable_generated',from_status:'confirmed',to_status:'payable_generated',comment:'生成应付 '+('AP-'+record.code),occurred_at:now,operator_id:actor});return{id,status:'payable_generated',payable_id:payableId,amount:Number(record.payable_amount||0),idempotent:false};
` },
});
