import { defineAction } from '@objectstack/spec';

const locations = ['record_header', 'record_more'] as const;

export const SalesOrderCreateRevenueRecognition = defineAction({
  name: 'sales_order_create_revenue_recognition', label: '生成收入确认单', objectName: 'forge_sales_order', icon: 'badge-dollar-sign',
  locations: [...locations], order: 70, visible: `record.status == 'active' || record.status == 'partially_shipped' || record.status == 'shipped' || record.status == 'completed'`, refreshAfter: true,
  description: '按订单配置的收入确认方式，从已出库或已开票业务凭据生成待审核确认单。', successMessage: '收入确认单已生成',
  params: [
    { field: 'code', objectOverride: 'forge_revenue_recognition', required: true },
    { name: 'source_id', label: '业务来源记录', type: 'text', required: true },
    { field: 'recognition_on', objectOverride: 'forge_revenue_recognition', required: true },
    { field: 'financial_period', objectOverride: 'forge_revenue_recognition', required: true },
    { field: 'remarks', objectOverride: 'forge_revenue_recognition' },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.finance/page_revenue_recognition?recognition=${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),order=ctx.record,actor=ctx.session&&ctx.session.userId;
if(ctx.recordLoadDenied===true||!id||!order)throw new Error('销售订单不存在或不可访问');
if(!actor)throw new Error('无法识别当前制单人');
if(!['active','partially_shipped','shipped','completed'].includes(order.status))throw new Error('仅执行中或已履约订单可以生成收入确认');
if(!/^\\d{4}-(0[1-9]|1[0-2])$/.test(String(ctx.input.financial_period||'')))throw new Error('财务期间必须使用 YYYY-MM 格式');
const method=order.revenue_trigger||'shipment',sourceId=String(ctx.input.source_id||'').trim(),round4=v=>Math.round((Number(v)+Number.EPSILON)*10000)/10000;
if(!sourceId)throw new Error('业务来源记录不能为空');
let sourceType,sourceKey,source,amount;
if(method==='shipment'){
  sourceType='sales_outbound';sourceKey=sourceType+':'+sourceId;source=await ctx.api.object('forge_sales_outbound').findOne({where:{id:sourceId}});
  if(!source||source.order_id!==id||source.status!=='outbounded')throw new Error('按发货确认只能选择当前订单已出库记录');
  const shipmentLines=await ctx.api.object('forge_sales_shipment_line').find({where:{shipment_id:source.shipment_id,order_id:id}});
  if(shipmentLines.length!==1)throw new Error('当前按发货收入确认仅支持单条订单物料');
  const orderLine=await ctx.api.object('forge_sales_order_line').findOne({where:{id:shipmentLines[0].order_line_id}});
  if(!orderLine||!(Number(orderLine.quantity||0)>0))throw new Error('销售出库关联订单明细不存在');
  amount=round4(Number(source.quantity||0)*Number(orderLine.taxed_subtotal||0)/Number(orderLine.quantity||0));
}else if(method==='invoice'){
  sourceType='sales_invoice';sourceKey=sourceType+':'+sourceId;source=await ctx.api.object('forge_sales_invoice').findOne({where:{id:sourceId}});
  if(!source||source.order_id!==id||!['issued','settled'].includes(source.status))throw new Error('按开票确认只能选择当前订单有效销项发票');
  amount=round4(Number(source.total_amount||0));
}else throw new Error('当前切片仅支持按发货或按开票确认收入');
if(!(amount>0))throw new Error('业务来源没有可确认收入金额');
const sourceRecognitions=await ctx.api.object('forge_revenue_recognition').find({where:{source_key:sourceKey}});
if(sourceRecognitions.some(x=>!['rejected','voided'].includes(x.status)))throw new Error('当前业务来源已生成有效收入确认单');
const orderRecognitions=await ctx.api.object('forge_revenue_recognition').find({where:{order_id:id}}),committed=round4(orderRecognitions.filter(x=>!['rejected','voided'].includes(x.status)).reduce((sum,x)=>sum+Number(x.net_amount||0),0)),orderAmount=round4(Number(order.total_amount||0));
if(committed+amount>orderAmount+0.0001)throw new Error('收入确认累计金额超过订单金额');
const invoices=await ctx.api.object('forge_sales_invoice').find({where:{order_id:id}}),invoiced=round4(invoices.filter(x=>['issued','settled'].includes(x.status)).reduce((sum,x)=>sum+Number(x.total_amount||0),0)),invoiceStatus=invoiced<=0?'not_invoiced':invoiced>=orderAmount?'fully_invoiced':'partially_invoiced',links=await ctx.api.object('forge_project_sales_link').find({where:{order_id:id}}),now=new Date().toISOString(),proposed=round4(committed+amount),created=await ctx.api.object('forge_revenue_recognition').insert({name:ctx.input.code+' '+order.name,code:ctx.input.code,source_key:sourceKey,source_type:sourceType,source_id:sourceId,outbound_id:sourceType==='sales_outbound'?sourceId:null,invoice_id:sourceType==='sales_invoice'?sourceId:null,order_id:id,contract_id:order.contract_id||null,customer_id:order.customer_id,project_id:links[0]&&links[0].project_id||null,confirmation_method:method,net_amount:amount,order_amount:orderAmount,cumulative_amount:proposed,remaining_amount:round4(orderAmount-proposed),recognition_on:ctx.input.recognition_on,financial_period:ctx.input.financial_period,invoice_status:invoiceStatus,status:'pending_review',maker_id:actor,made_at:now,reviewer_id:null,reviewed_at:null,review_comment:null,responsible_id:order.responsible_id,remarks:ctx.input.remarks||'由业务履约来源生成'}),recognitionId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));
if(!recognitionId)throw new Error('收入确认单创建后未返回ID');
await ctx.api.object(sourceType==='sales_outbound'?'forge_sales_outbound':'forge_sales_invoice').update({id:sourceId,revenue_status:'pending_approval'});
await ctx.api.object('forge_revenue_recognition_log').insert({name:ctx.input.code+' 生成确认单',event_key:ctx.input.code+'-CREATE',recognition_id:recognitionId,action:'created',from_status:'source_ready',to_status:'pending_review',comment:ctx.input.remarks||'按业务来源生成待审核收入确认',occurred_at:now,operator_id:actor});
return{id:recognitionId,order_id:id,source_id:sourceId,confirmation_method:method,net_amount:amount,cumulative_amount:proposed,remaining_amount:round4(orderAmount-proposed),status:'pending_review'};
` },
});

export const RevenueRecognitionApprove = defineAction({
  name: 'revenue_recognition_approve', label: '审核通过', objectName: 'forge_revenue_recognition', icon: 'badge-check',
  locations: [...locations], order: 20, visible: `record.status == 'pending_review'`, refreshAfter: true,
  params: [{ field: 'review_comment', objectOverride: 'forge_revenue_recognition', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),record=ctx.record,actor=ctx.session&&ctx.session.userId,comment=String(ctx.input.review_comment||'').trim();
if(ctx.recordLoadDenied===true||!id||!record)throw new Error('收入确认单不存在或不可访问');
if(!actor)throw new Error('无法识别当前审核人');
if(record.status!=='pending_review')throw new Error('仅待审核收入确认单可以审核');
if(!comment)throw new Error('审核意见不能为空');
const order=await ctx.api.object('forge_sales_order').findOne({where:{id:record.order_id}});
if(!order)throw new Error('来源销售订单不存在');
const all=await ctx.api.object('forge_revenue_recognition').find({where:{order_id:order.id}}),round4=v=>Math.round((Number(v)+Number.EPSILON)*10000)/10000,approvedBefore=round4(all.filter(x=>x.id!==id&&x.status==='approved').reduce((sum,x)=>sum+Number(x.net_amount||0),0)),cumulative=round4(approvedBefore+Number(record.net_amount||0)),orderAmount=round4(Number(order.total_amount||0));
if(cumulative>orderAmount+0.0001)throw new Error('审核后累计确认收入将超过订单金额');
const remaining=round4(Math.max(0,orderAmount-cumulative)),now=new Date().toISOString();
await ctx.api.object('forge_revenue_recognition').update({id,status:'approved',cumulative_amount:cumulative,remaining_amount:remaining,reviewer_id:actor,reviewed_at:now,review_comment:comment});
await ctx.api.object('forge_sales_order').update({id:order.id,recognized_amount:cumulative});
await ctx.api.object(record.source_type==='sales_outbound'?'forge_sales_outbound':'forge_sales_invoice').update({id:record.source_id,revenue_status:'approved'});
await ctx.api.object('forge_revenue_recognition_log').insert({name:record.code+' 审核通过',event_key:record.code+'-APPROVE',recognition_id:id,action:'approved',from_status:'pending_review',to_status:'approved',comment,occurred_at:now,operator_id:actor});
return{id,status:'approved',order_id:order.id,net_amount:Number(record.net_amount||0),cumulative_amount:cumulative,remaining_amount:remaining};
` },
});

export const RevenueRecognitionReject = defineAction({
  name: 'revenue_recognition_reject', label: '驳回', objectName: 'forge_revenue_recognition', icon: 'circle-x',
  locations: [...locations], order: 30, visible: `record.status == 'pending_review'`, refreshAfter: true,
  params: [{ field: 'review_comment', objectOverride: 'forge_revenue_recognition', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),record=ctx.record,actor=ctx.session&&ctx.session.userId,comment=String(ctx.input.review_comment||'').trim();
if(ctx.recordLoadDenied===true||!id||!record)throw new Error('收入确认单不存在或不可访问');
if(!actor)throw new Error('无法识别当前审核人');
if(record.status!=='pending_review')throw new Error('仅待审核收入确认单可以驳回');
if(!comment)throw new Error('驳回意见不能为空');
const order=await ctx.api.object('forge_sales_order').findOne({where:{id:record.order_id}}),all=await ctx.api.object('forge_revenue_recognition').find({where:{order_id:record.order_id}}),round4=v=>Math.round((Number(v)+Number.EPSILON)*10000)/10000,approved=round4(all.filter(x=>x.id!==id&&x.status==='approved').reduce((sum,x)=>sum+Number(x.net_amount||0),0)),remaining=round4(Math.max(0,Number(order&&order.total_amount||0)-approved)),now=new Date().toISOString();
await ctx.api.object('forge_revenue_recognition').update({id,status:'rejected',cumulative_amount:approved,remaining_amount:remaining,reviewer_id:actor,reviewed_at:now,review_comment:comment});
await ctx.api.object(record.source_type==='sales_outbound'?'forge_sales_outbound':'forge_sales_invoice').update({id:record.source_id,revenue_status:'rejected'});
await ctx.api.object('forge_revenue_recognition_log').insert({name:record.code+' 驳回',event_key:record.code+'-REJECT',recognition_id:id,action:'rejected',from_status:'pending_review',to_status:'rejected',comment,occurred_at:now,operator_id:actor});
return{id,status:'rejected',order_id:record.order_id,cumulative_amount:approved,remaining_amount:remaining};
` },
});
