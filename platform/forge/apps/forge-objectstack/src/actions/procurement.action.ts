import { defineAction } from '@objectstack/spec';

const locations = ['record_header', 'record_more'] as const;

export const PurchaseRequestSubmit = defineAction({
  name: 'purchase_request_submit', label: '提交审批', objectName: 'forge_purchase_request', icon: 'send',
  locations: [...locations], order: 10, visible: `record.status == 'draft' || record.status == 'rejected'`, refreshAfter: true,
  confirmText: '提交前将校验基本信息与采购明细，是否继续？', successMessage: '采购申请已提交审批',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),request=ctx.record,actor=ctx.session&&ctx.session.userId;
if(ctx.recordLoadDenied===true||!id||!request)throw new Error('当前采购申请不存在或不可访问');
if(!['draft','rejected'].includes(request.status))throw new Error('仅草稿或已驳回申请可以提交审批');
if(!actor)throw new Error('无法识别当前操作人');
if(!request.name||!request.expected_arrival_on||!request.responsible_id||!String(request.purchase_reason||'').trim())throw new Error('申请标题、期望到货日期、负责人和采购原因不能为空');
const lines=await ctx.api.object('forge_purchase_request_line').find({where:{request_id:id}});if(!lines.length)throw new Error('采购申请至少需要一条物料明细');
const round4=v=>Math.round((Number(v)+Number.EPSILON)*10000)/10000;
for(const line of lines){if(!(Number(line.quantity||0)>0))throw new Error('采购数量必须大于0');if(line.entry_mode!=='library'&&(!String(line.name||'').trim()||!String(line.model||'').trim()||!String(line.category_name||'').trim()||!String(line.unit_name||'').trim()))throw new Error('手工明细必须填写物料名称、型号、物料分类和单位');}
const existingInstances=await ctx.api.object('forge_approval_instance').find({where:{source_object:'forge_purchase_request',source_id:id}});if(existingInstances.some(x=>x.status==='in_progress'))throw new Error('该采购申请已在审批中，请前往我的审批查看');
const totalQuantity=round4(lines.reduce((s,x)=>s+Number(x.quantity||0),0)),totalAmount=round4(lines.reduce((s,x)=>s+Number(x.taxed_subtotal||0),0)),now=new Date().toISOString(),user=await ctx.api.object('sys_user').findOne({where:{id:actor}}),initiatorName=(user&&(user.display_name||user.name||user.email))||'申请人',approvalCode='AP-PR-'+String(request.code||id)+'-'+Date.now();
await ctx.api.object('forge_purchase_request').update({id,line_count:lines.length,total_quantity:totalQuantity,estimated_taxed_amount:totalAmount,status:'pending_approval',submitted_at:now,submitted_by:actor,approval_comment:null});
const logCreated=await ctx.api.object('forge_purchase_request_approval_log').insert({name:request.code+' 提交审批',request_id:id,action:'submitted',from_status:request.status,to_status:'pending_approval',comment:'提交审批',occurred_at:now,operator_id:actor}),rawLog=logCreated,logId=typeof rawLog==='string'?rawLog:rawLog&&(rawLog.id||(rawLog.record&&rawLog.record.id));
let instanceId=null,taskId=null;try{const created=await ctx.api.object('forge_approval_instance').insert({title:String(request.code||'')+' '+request.name,code:approvalCode,process_name:'采购申请审批',priority:request.priority==='high'?'urgent':'normal',status:'in_progress',current_node:'采购审批',source_object:'forge_purchase_request',source_id:id,source_code:request.code,source_page:'/_console/apps/forge/page/page_purchase_request_pool?id='+encodeURIComponent(id),initiator_name:initiatorName,initiated_at:now,due_at:null,remarks:request.purchase_reason||null}),rawInstance=created,instance=typeof rawInstance==='string'?rawInstance:rawInstance&&(rawInstance.id||(rawInstance.record&&rawInstance.record.id));if(!instance)throw new Error('审批实例创建后未返回ID');instanceId=instance;const taskCreated=await ctx.api.object('forge_approval_task').insert({title:'采购申请审批',code:'APT-PR-'+Date.now(),instance_id:instance,process_name:'采购申请审批',process_title:String(request.code||'')+' '+request.name,initiator_name:initiatorName,assignee_name:'系统管理员',created_at_business:now,due_at:null,urged_count:0,status:'pending'}),rawTask=taskCreated,task=typeof rawTask==='string'?rawTask:rawTask&&(rawTask.id||(rawTask.record&&rawTask.record.id));if(!task)throw new Error('审批任务创建后未返回ID');taskId=task;}catch(error){if(taskId)await ctx.api.object('forge_approval_task').delete({where:{id:taskId}});if(instanceId)await ctx.api.object('forge_approval_instance').delete({where:{id:instanceId}});if(logId)await ctx.api.object('forge_purchase_request_approval_log').delete({where:{id:logId}});await ctx.api.object('forge_purchase_request').update({id,status:request.status,submitted_at:request.submitted_at||null,submitted_by:request.submitted_by||null});throw error;}
return{id,status:'pending_approval',approval_instance_id:instanceId,approval_task_id:taskId,line_count:lines.length,total_quantity:totalQuantity,estimated_taxed_amount:totalAmount};
` },
});

export const ProcurementApprovalTaskDecide = defineAction({
  name: 'procurement_approval_task_decide', label: '办理审批任务', objectName: 'forge_approval_task', icon: 'clipboard-check',
  locations: [], refreshAfter: true,
  params: [
    { name: 'decision', label: '审批结论', type: 'select', required: true, options: [{ value: 'approved', label: '通过' }, { value: 'rejected', label: '驳回' }] },
    { name: 'decision_comment', label: '审批意见', type: 'textarea', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const taskId=ctx.recordId||(ctx.record&&ctx.record.id),task=ctx.record,actor=ctx.session&&ctx.session.userId,decision=String(ctx.input.decision||''),note=String(ctx.input.decision_comment||'').trim();
if(ctx.recordLoadDenied===true||!taskId||!task)throw new Error('当前审批任务不存在或不可访问');if(!actor)throw new Error('无法识别当前操作人');if(task.status!=='pending')throw new Error('审批任务已经办理，请刷新后重试');if(!['approved','rejected'].includes(decision))throw new Error('审批结论无效');if(!note)throw new Error('审批意见不能为空');
const instance=await ctx.api.object('forge_approval_instance').findOne({where:{id:task.instance_id}});if(!instance||instance.status!=='in_progress')throw new Error('审批实例状态已变化，请刷新后重试');
const now=new Date().toISOString();
if(instance.source_object==='forge_purchase_request'){
 const request=await ctx.api.object('forge_purchase_request').findOne({where:{id:instance.source_id}});if(!request)throw new Error('来源采购申请不存在');if(request.status!=='pending_approval')throw new Error('采购申请状态已变化，请刷新后重试');
 if(decision==='approved'){const lines=await ctx.api.object('forge_purchase_request_line').find({where:{request_id:request.id}}),existing=await ctx.api.object('forge_purchase_pending_item').find({where:{request_id:request.id}});if(!lines.length)throw new Error('采购申请没有物料明细，不能审批通过');if(existing.length)throw new Error('该采购申请已生成采购待办，请刷新后核对');for(let index=0;index<lines.length;index++){const line=lines[index],quantity=Number(line.quantity||0);await ctx.api.object('forge_purchase_pending_item').insert({name:line.name,code:'POOL-'+String(request.code||request.id)+'-'+String(index+1).padStart(3,'0'),request_id:request.id,request_line_id:line.id,request_code:request.code,line_number:index+1,applicant_id:request.submitted_by||request.responsible_id,department_name:'',project_id:request.project_id||null,item_code:line.item_code||'',model:line.model||'',specification:line.specification||'',unit_name:line.unit_name||'',requested_quantity:quantity,locked_quantity:0,ordered_quantity:0,remaining_quantity:quantity,suggested_supplier_id:line.suggested_supplier_id||request.suggested_supplier_id||null,assigned_supplier_id:null,purchase_category:'',required_on:line.expected_arrival_on||request.expected_arrival_on,requested_at:request.submitted_at||now,priority:request.priority||'medium',status:'ready',responsible_id:request.responsible_id,remarks:line.remarks||null});}await ctx.api.object('forge_purchase_request').update({id:request.id,status:'approved',approved_at:now,approved_by:actor,approval_comment:note});await ctx.api.object('forge_purchase_request_approval_log').insert({name:request.code+' 审批通过',request_id:request.id,action:'approved',from_status:'pending_approval',to_status:'approved',comment:note,occurred_at:now,operator_id:actor});}
 else{await ctx.api.object('forge_purchase_request').update({id:request.id,status:'rejected',approval_comment:note});await ctx.api.object('forge_purchase_request_approval_log').insert({name:request.code+' 审批驳回',request_id:request.id,action:'rejected',from_status:'pending_approval',to_status:'rejected',comment:note,occurred_at:now,operator_id:actor});}
}
await ctx.api.object('forge_approval_task').update({id:taskId,status:decision,decision_comment:note,completed_at:now});await ctx.api.object('forge_approval_instance').update({id:instance.id,status:decision,current_node:decision==='approved'?'审批完成':'已驳回',ended_at:now});return{id:taskId,instance_id:instance.id,source_object:instance.source_object||null,source_id:instance.source_id||null,status:decision};
` },
});

export const PurchaseRequestApprove = defineAction({
  name: 'purchase_request_approve', label: '审批通过', objectName: 'forge_purchase_request', icon: 'circle-check',
  locations: [...locations], order: 20, visible: `record.status == 'pending_approval'`, refreshAfter: true,
  params: [{ name: 'approval_comment', label: '审批意见', type: 'textarea', required: true }], successMessage: '采购申请已审批通过',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),request=ctx.record,actor=ctx.session&&ctx.session.userId,note=String(ctx.input.approval_comment||'').trim();
if(ctx.recordLoadDenied===true||!id||!request)throw new Error('当前采购申请不存在或不可访问');if(request.status!=='pending_approval')throw new Error('采购申请状态已变化，请刷新后重试');if(!actor)throw new Error('无法识别当前操作人');if(!note)throw new Error('审批意见不能为空');
const lines=await ctx.api.object('forge_purchase_request_line').find({where:{request_id:id}}),existing=await ctx.api.object('forge_purchase_pending_item').find({where:{request_id:id}});
if(!lines.length)throw new Error('采购申请没有物料明细，不能审批通过');if(existing.length)throw new Error('该采购申请已生成采购待办，请刷新后核对');
const now=new Date().toISOString();await ctx.api.object('forge_purchase_request').update({id,status:'approved',approved_at:now,approved_by:actor,approval_comment:note});
for(let index=0;index<lines.length;index++){const line=lines[index],quantity=Number(line.quantity||0);await ctx.api.object('forge_purchase_pending_item').insert({name:line.name,code:'POOL-'+String(request.code||id)+'-'+String(index+1).padStart(3,'0'),request_id:id,request_line_id:line.id,request_code:request.code,line_number:index+1,applicant_id:request.submitted_by||request.responsible_id,department_name:'',project_id:request.project_id||null,item_code:line.item_code||'',model:line.model||'',specification:line.specification||'',unit_name:line.unit_name||'',requested_quantity:quantity,locked_quantity:0,ordered_quantity:0,remaining_quantity:quantity,suggested_supplier_id:line.suggested_supplier_id||request.suggested_supplier_id||null,assigned_supplier_id:null,purchase_category:'',required_on:line.expected_arrival_on||request.expected_arrival_on,requested_at:request.submitted_at||now,priority:request.priority||'medium',status:'ready',responsible_id:request.responsible_id,remarks:line.remarks||null});}
await ctx.api.object('forge_purchase_request_approval_log').insert({name:request.code+' 审批通过',request_id:id,action:'approved',from_status:'pending_approval',to_status:'approved',comment:note,occurred_at:now,operator_id:actor});const instances=await ctx.api.object('forge_approval_instance').find({where:{source_object:'forge_purchase_request',source_id:id}});for(const instance of instances.filter(x=>x.status==='in_progress')){const tasks=await ctx.api.object('forge_approval_task').find({where:{instance_id:instance.id}});for(const task of tasks.filter(x=>x.status==='pending'))await ctx.api.object('forge_approval_task').update({id:task.id,status:'approved',decision_comment:note,completed_at:now});await ctx.api.object('forge_approval_instance').update({id:instance.id,status:'approved',current_node:'审批完成',ended_at:now});}return{id,status:'approved'};
` },
});

export const PurchaseRequestReject = defineAction({
  name: 'purchase_request_reject', label: '驳回', objectName: 'forge_purchase_request', icon: 'circle-x',
  locations: [...locations], order: 30, visible: `record.status == 'pending_approval'`, refreshAfter: true,
  params: [{ name: 'approval_comment', label: '驳回原因', type: 'textarea', required: true }], successMessage: '采购申请已驳回',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),request=ctx.record,actor=ctx.session&&ctx.session.userId,note=String(ctx.input.approval_comment||'').trim();
if(ctx.recordLoadDenied===true||!id||!request)throw new Error('当前采购申请不存在或不可访问');if(request.status!=='pending_approval')throw new Error('采购申请状态已变化，请刷新后重试');if(!actor)throw new Error('无法识别当前操作人');if(!note)throw new Error('驳回原因不能为空');
const now=new Date().toISOString();await ctx.api.object('forge_purchase_request').update({id,status:'rejected',approval_comment:note});await ctx.api.object('forge_purchase_request_approval_log').insert({name:request.code+' 审批驳回',request_id:id,action:'rejected',from_status:'pending_approval',to_status:'rejected',comment:note,occurred_at:now,operator_id:actor});const instances=await ctx.api.object('forge_approval_instance').find({where:{source_object:'forge_purchase_request',source_id:id}});for(const instance of instances.filter(x=>x.status==='in_progress')){const tasks=await ctx.api.object('forge_approval_task').find({where:{instance_id:instance.id}});for(const task of tasks.filter(x=>x.status==='pending'))await ctx.api.object('forge_approval_task').update({id:task.id,status:'rejected',decision_comment:note,completed_at:now});await ctx.api.object('forge_approval_instance').update({id:instance.id,status:'rejected',current_node:'已驳回',ended_at:now});}return{id,status:'rejected'};
` },
});

export const PurchaseRequestCancel = defineAction({
  name: 'purchase_request_cancel', label: '取消申请', objectName: 'forge_purchase_request', icon: 'ban',
  locations: [...locations], order: 40, visible: `record.status == 'draft' || record.status == 'rejected'`, refreshAfter: true,
  params: [{ name: 'cancel_reason', label: '取消原因', type: 'textarea', required: true }], successMessage: '采购申请已取消',
  body: { language: 'js', capabilities: ['api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),request=ctx.record,actor=ctx.session&&ctx.session.userId,note=String(ctx.input.cancel_reason||'').trim();
if(ctx.recordLoadDenied===true||!id||!request)throw new Error('当前采购申请不存在或不可访问');if(!['draft','rejected'].includes(request.status))throw new Error('仅草稿或已驳回申请可以取消');if(!actor)throw new Error('无法识别当前操作人');if(!note)throw new Error('取消原因不能为空');
const now=new Date().toISOString();await ctx.api.object('forge_purchase_request').update({id,status:'cancelled',approval_comment:note});await ctx.api.object('forge_purchase_request_approval_log').insert({name:request.code+' 取消',request_id:id,action:'cancelled',from_status:request.status,to_status:'cancelled',comment:note,occurred_at:now,operator_id:actor});return{id,status:'cancelled'};
` },
});

export const SupplierPriceBookActivate = defineAction({
  name: 'supplier_price_book_activate', label: '启用价格本', objectName: 'forge_supplier_price_book', icon: 'badge-check',
  locations: [...locations], order: 10, visible: `record.status == 'draft'`, refreshAfter: true,
  confirmText: '启用后该价格本将参与采购定价，是否继续？', successMessage: '供应商价格本已生效',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),book=ctx.record,actor=ctx.session&&ctx.session.userId;
if(ctx.recordLoadDenied===true||!id||!book)throw new Error('当前价格本不存在或不可访问');
if(book.status!=='draft')throw new Error('仅草稿价格本可以启用');if(!actor)throw new Error('无法识别当前操作人');
if(book.valid_from&&book.valid_to&&book.valid_to<book.valid_from)throw new Error('失效日期不能早于生效日期');
const lines=await ctx.api.object('forge_supplier_price_book_line').find({where:{price_book_id:id}});if(!lines.length)throw new Error('价格本至少需要一条物料价格后才能启用');
const now=new Date().toISOString();await ctx.api.object('forge_supplier_price_book').update({id,status:'active',line_count:lines.length,activated_at:now,activated_by:actor});
await ctx.api.object('forge_supplier_price_book_status_log').insert({name:String(book.code||book.name)+' 生效',price_book_id:id,action:'activated',from_status:'draft',to_status:'active',comment:'启用价格本',operator_id:actor,occurred_at:now});
return{id,status:'active',line_count:lines.length};
` },
});

export const SupplierPriceBookVoid = defineAction({
  name: 'supplier_price_book_void', label: '废弃价格本', objectName: 'forge_supplier_price_book', icon: 'ban',
  locations: [...locations], order: 20, visible: `record.status == 'draft' || record.status == 'active'`, refreshAfter: true,
  params: [{ name: 'void_reason', label: '废弃原因', type: 'textarea', required: true }], successMessage: '供应商价格本已废弃',
  body: { language: 'js', capabilities: ['api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),book=ctx.record,actor=ctx.session&&ctx.session.userId,note=String(ctx.input.void_reason||'').trim();
if(ctx.recordLoadDenied===true||!id||!book)throw new Error('当前价格本不存在或不可访问');
if(!['draft','active'].includes(book.status))throw new Error('仅草稿或生效中价格本可以废弃');if(!actor)throw new Error('无法识别当前操作人');if(!note)throw new Error('废弃原因不能为空');
const now=new Date().toISOString();await ctx.api.object('forge_supplier_price_book').update({id,status:'voided',void_reason:note});
await ctx.api.object('forge_supplier_price_book_status_log').insert({name:String(book.code||book.name)+' 废弃',price_book_id:id,action:'voided',from_status:book.status,to_status:'voided',comment:note,operator_id:actor,occurred_at:now});
return{id,status:'voided'};
` },
});

export const BomShortageCreatePurchaseOrder = defineAction({
  name: 'bom_shortage_create_purchase_order', label: '提交采购审核', objectName: 'forge_bom_shortage_analysis', icon: 'shopping-cart',
  locations: [...locations], order: 10, visible: `record.status == 'completed'`, refreshAfter: true,
  description: '以本次缺料快照的缺口项生成一张待审核采购订单。', successMessage: 'BOM缺料采购订单已提交审核',
  params: [
    { field: 'code', objectOverride: 'forge_purchase_order', required: true },
    { field: 'supplier_id', objectOverride: 'forge_purchase_order', required: true },
    { field: 'warehouse_id', objectOverride: 'forge_purchase_order' },
    { field: 'expected_arrival_on', objectOverride: 'forge_purchase_order', required: true },
    { field: 'payment_term', objectOverride: 'forge_purchase_order', required: true },
    { field: 'payment_method', objectOverride: 'forge_purchase_order', required: true },
    { field: 'settlement_on', objectOverride: 'forge_purchase_order' },
    { field: 'arrival_address', objectOverride: 'forge_purchase_order' },
    { field: 'remarks', objectOverride: 'forge_purchase_order' },
  ],
  onSuccess: { navigate: '/_console/apps/forge/page/page_purchase_order_workspace?id=${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const analysisId=ctx.recordId||(ctx.record&&ctx.record.id), analysis=ctx.record, actor=ctx.session&&ctx.session.userId;
if(ctx.recordLoadDenied===true||!analysisId||!analysis) throw new Error('当前缺料分析不存在或不可访问');
if(!actor) throw new Error('无法识别当前操作人');
if(analysis.status!=='completed') throw new Error('仅已完成的缺料分析可以生成采购订单');
const bom=await ctx.api.object('forge_bom').findOne({where:{id:analysis.bom_id}});
if(!bom||bom.status!=='active') throw new Error('关联BOM必须处于已生效状态');
const supplier=await ctx.api.object('forge_supplier').findOne({where:{id:ctx.input.supplier_id}});
if(!supplier||supplier.status!=='active'||supplier.approval_status!=='approved') throw new Error('供应商必须启用且已审批');
const existing=await ctx.api.object('forge_purchase_order').findOne({where:{shortage_analysis_id:analysisId}});
if(existing&&!['cancelled','rejected'].includes(existing.status)) throw new Error('该缺料快照已生成有效采购订单');
const lines=(await ctx.api.object('forge_bom_shortage_line').find({where:{analysis_id:analysisId}})).filter(line=>Number(line.shortage_quantity||0)>0&&line.source_type==='purchased');
if(!lines.length) throw new Error('该缺料快照没有可采购的缺口项');
const code=String(ctx.input.code||'').trim(), expected=ctx.input.expected_arrival_on, paymentTerm=String(ctx.input.payment_term||'').trim();
if(!code||!expected||!paymentTerm||!ctx.input.payment_method) throw new Error('采购订单号、供应商、付款条件、付款方式和期望到货日期不能为空');
const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;
const round2=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
let totalQuantity=0,totalAmount=0; const prepared=[];
for(const line of lines){
  const sku=await ctx.api.object('forge_material_sku').findOne({where:{id:line.sku_id}}); if(!sku||sku.enabled===false) throw new Error('缺料明细包含不可用物料规格');
  const quantity=Number(line.shortage_quantity||0), taxRate=Number(bom.tax_rate||13), untaxed=round2(Number(line.untaxed_unit_price||0)), taxed=round4(untaxed*(1+taxRate/100)), subtotal=round2(quantity*taxed);
  totalQuantity+=quantity; totalAmount+=subtotal; prepared.push({line,sku,quantity,taxRate,untaxed,taxed,subtotal});
}
const now=new Date().toISOString(), today=new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10); totalQuantity=round4(totalQuantity); totalAmount=round4(totalAmount);
const created=await ctx.api.object('forge_purchase_order').insert({name:supplier.name+' - 采购订单',code,supplier_id:supplier.id,source_type:'bom_shortage',bom_id:bom.id,shortage_analysis_id:analysisId,project_id:analysis.project_id||bom.project_id||null,warehouse_id:ctx.input.warehouse_id||null,expected_arrival_on:expected,order_on:today,payment_term:paymentTerm,payment_method:ctx.input.payment_method,currency:'cny',exchange_rate:1,payable_trigger:'inbound',settlement_on:ctx.input.settlement_on||null,arrival_address:ctx.input.arrival_address||null,responsible_id:actor,line_count:prepared.length,total_quantity:totalQuantity,total_amount:totalAmount,arrived_quantity:0,inbound_quantity:0,status:'pending_approval',submitted_at:now,submitted_by:actor,remarks:ctx.input.remarks||('由BOM '+bom.code+' 缺料分析生成')});
const orderId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id)); if(!orderId) throw new Error('采购订单创建后未返回记录ID');
for(const item of prepared) await ctx.api.object('forge_purchase_order_line').insert({name:item.line.name,order_id:orderId,sku_id:item.line.sku_id,item_code:item.line.item_code,model:item.line.model,specification:item.line.specification,unit_name:item.line.unit_name,quantity:item.quantity,arrived_quantity:0,inspected_quantity:0,accepted_quantity:0,inbound_quantity:0,taxed_unit_price:item.taxed,untaxed_unit_price:item.untaxed,tax_rate:item.taxRate,taxed_subtotal:item.subtotal,source_bom_id:bom.id,source_analysis_line_id:item.line.id,expected_arrival_on:expected});
await ctx.api.object('forge_purchase_order_approval_log').insert({name:code+' 提交审核',order_id:orderId,action:'submitted',from_status:'draft',to_status:'pending_approval',comment:ctx.input.remarks||'提交审核',occurred_at:now,operator_id:actor});
return {id:orderId,status:'pending_approval',line_count:prepared.length,total_quantity:totalQuantity,total_amount:totalAmount,bom_id:bom.id,shortage_analysis_id:analysisId};
` },
});

export const PurchaseOrderSubmit = defineAction({
  name: 'purchase_order_submit', label: '提交审核', objectName: 'forge_purchase_order', icon: 'send',
  locations: [...locations], order: 10, visible: `record.status == 'draft'`, refreshAfter: true,
  confirmText: '提交前将校验供应商、付款条件、交期与采购明细，是否继续？', successMessage: '采购订单已提交审核',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const order = ctx.record;
if (ctx.recordLoadDenied === true || !id || !order) throw new Error('当前采购订单不存在或不可访问');
if (order.status !== 'draft') throw new Error('采购订单状态已变化，请刷新后重试');
const supplier = await ctx.api.object('forge_supplier').findOne({ where: { id: order.supplier_id } });
if (!supplier || supplier.status !== 'active' || supplier.approval_status !== 'approved') throw new Error('供应商必须启用且已审批');
const lines = await ctx.api.object('forge_purchase_order_line').find({ where: { order_id: id } });
if (!lines.length) throw new Error('采购订单至少需要一条物料明细');
const round4 = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
for (const line of lines) if (!(Number(line.quantity || 0) > 0)) throw new Error('采购数量必须大于0');
const totalQuantity = round4(lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0));
const totalAmount = round4(lines.reduce((sum, line) => sum + Number(line.taxed_subtotal || 0), 0));
const actor=ctx.session&&ctx.session.userId; if(!actor) throw new Error('无法识别当前操作人'); const now=new Date().toISOString(), today=new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10);
await ctx.api.object('forge_purchase_order').update({ id, line_count: lines.length, total_quantity: totalQuantity, total_amount: totalAmount, status: 'pending_approval', submitted_at:now, submitted_by:actor, order_on:order.order_on||today });
await ctx.api.object('forge_purchase_order_approval_log').insert({name:order.code+' 提交审核',order_id:id,action:'submitted',from_status:'draft',to_status:'pending_approval',comment:'提交审核',occurred_at:now,operator_id:actor});
return { id, status: 'pending_approval', line_count: lines.length, total_quantity: totalQuantity, total_amount: totalAmount };
` },
});

export const PurchaseOrderApprove = defineAction({
  name: 'purchase_order_approve', label: '同意', objectName: 'forge_purchase_order', icon: 'circle-check',
  locations: [...locations], order: 10, visible: `record.status == 'pending_approval'`, refreshAfter: true,
  params: [{ name: 'approval_note', label: '审批意见', type: 'textarea', required: true }],
  description: '审批通过后生成一张订单级到货通知。', successMessage: '采购订单已审核并生成到货通知',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const order = ctx.record;
if (ctx.recordLoadDenied === true || !id || !order) throw new Error('当前采购订单不存在或不可访问');
if (order.status !== 'pending_approval') throw new Error('采购订单状态已变化，请刷新后重试');
const lines = await ctx.api.object('forge_purchase_order_line').find({ where: { order_id: id } });
if (!lines.length) throw new Error('采购订单至少需要一条物料明细');
const actor=ctx.session&&ctx.session.userId, note=String(ctx.input.approval_note||'').trim(); if(!actor) throw new Error('无法识别当前操作人'); if(!note) throw new Error('审批意见不能为空');
let notice=await ctx.api.object('forge_purchase_arrival_notice').findOne({where:{order_id:id}}), noticeId=notice&&notice.id;
if(!notice||notice.status==='cancelled'){
  const total=lines.reduce((sum,line)=>sum+Number(line.quantity||0),0);
  const created=await ctx.api.object('forge_purchase_arrival_notice').insert({name:order.code+' 到货通知',code:order.code+'-AN-001',order_id:id,order_line_id:lines[0].id,sku_id:lines[0].sku_id,item_code:lines[0].item_code||null,supplier_id:order.supplier_id,warehouse_id:order.warehouse_id||null,expected_arrival_on:order.expected_arrival_on,line_count:lines.length,planned_quantity:total,arrived_quantity:0,status:'pending_arrival',responsible_id:order.responsible_id,remarks:'由采购订单 '+order.code+' 审核生成'});
  noticeId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id)); if(!noticeId) throw new Error('到货通知创建后未返回记录ID');
  for(const line of lines) await ctx.api.object('forge_purchase_arrival_notice_line').insert({name:line.name,notice_id:noticeId,order_id:id,order_line_id:line.id,sku_id:line.sku_id,item_code:line.item_code,model:line.model,specification:line.specification,unit_name:line.unit_name,planned_quantity:line.quantity,arrived_quantity:0,status:'pending_arrival'});
}
const now=new Date().toISOString();
const existingTransit=await ctx.api.object('forge_inventory_ledger').find({where:{movement_type:'purchase_in_transit',source_id:id}});if(!existingTransit.length){const orderWarehouse=order.warehouse_id||null;for(const line of lines){if(!orderWarehouse||!line.sku_id)continue;const balanceKey=orderWarehouse+':'+line.sku_id,balances=await ctx.api.object('forge_inventory_balance').find({where:{balance_key:balanceKey}});const onHand=Number((balances[0]&&balances[0].on_hand_quantity)||0);await ctx.api.object('forge_inventory_ledger').insert({name:order.code+' '+line.name+' 采购在途',code:order.code+'-TRANSIT'+'-'+line.id.slice(-4),warehouse_id:orderWarehouse,sku_id:line.sku_id,direction:'inbound',movement_type:'purchase_in_transit',quantity:Number(line.quantity||0),before_on_hand:onHand,after_on_hand:onHand,before_available:onHand,after_available:onHand,unit_cost:Number(line.taxed_unit_price||0),amount:Number(line.taxed_subtotal||0),occurred_at:now,source_object:'forge_purchase_order',source_id:id,source_line_id:line.id,responsible_id:actor,remarks:'采购在途：订单审核通过、尚未到货，不计入在库数量'});}}
await ctx.api.object('forge_purchase_order').update({ id, status: 'approved', approved_at:now, approved_by:actor });
await ctx.api.object('forge_purchase_order_approval_log').insert({name:order.code+' 审核同意',order_id:id,action:'approved',from_status:'pending_approval',to_status:'approved',comment:note,occurred_at:now,operator_id:actor});
return { id, status: 'approved', arrival_notice_count: 1, arrival_notice_id: noticeId };
` },
});

export const PurchaseArrivalRegister = defineAction({
  name: 'purchase_arrival_register', label: '登记到货', objectName: 'forge_purchase_arrival_notice', icon: 'package-check',
  locations: [...locations], order: 20, visible: `record.status == 'pending_arrival' || record.status == 'partially_arrived'`, refreshAfter: true,
  description: '按到货通知的多条物料明细保存草稿或提交待检。', successMessage: '到货登记已保存',
  params: [
    { field: 'arrived_on', objectOverride: 'forge_purchase_receipt', required: true },
    { name: 'mode', label: '办理方式', type: 'select', required: true, options: [{ value: 'draft', label: '保存草稿' }, { value: 'submit', label: '提交待检' }] },
    { field: 'contact_name', objectOverride: 'forge_purchase_receipt' },
    { field: 'contact_phone', objectOverride: 'forge_purchase_receipt' },
    { field: 'carrier', objectOverride: 'forge_purchase_receipt' },
    { field: 'logistics_number', objectOverride: 'forge_purchase_receipt' },
    { field: 'customer_id', objectOverride: 'forge_purchase_receipt' },
    { name: 'lines_json', label: '到货物料明细', type: 'textarea', required: true },
    { field: 'remarks', objectOverride: 'forge_purchase_receipt' },
  ],
  onSuccess: { navigate: '/_console/apps/forge/page/page_purchase_arrival_workspace?id=${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const notice = ctx.record;
if (ctx.recordLoadDenied === true || !id || !notice) throw new Error('当前到货通知不存在或不可访问');
if (!['pending_arrival', 'partially_arrived'].includes(notice.status)) throw new Error('到货通知状态已变化，请刷新后重试');
const order = await ctx.api.object('forge_purchase_order').findOne({ where: { id: notice.order_id } });
if (!order || order.supplier_id !== notice.supplier_id) throw new Error('到货通知关联的采购订单不存在或供应商不一致');
const actor=ctx.session&&ctx.session.userId; if(!actor) throw new Error('无法识别当前操作人');
const mode=ctx.input.mode; if(!['draft','submit'].includes(mode)) throw new Error('办理方式必须为保存草稿或提交待检');
let inputs; try{inputs=typeof ctx.input.lines_json==='string'?JSON.parse(ctx.input.lines_json):ctx.input.lines_json;}catch{throw new Error('到货物料明细格式错误');}
if(!Array.isArray(inputs)||!inputs.length) throw new Error('至少需要一条到货物料明细');
const noticeLines=await ctx.api.object('forge_purchase_arrival_notice_line').find({where:{notice_id:id}}), byId=Object.fromEntries(noticeLines.map(line=>[line.id,line]));
const seen=new Set(), prepared=[]; const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;
let totalQuantity=0,untaxedAmount=0,taxedAmount=0;
for(const input of inputs){
  const noticeLine=byId[input.notice_line_id]; if(!noticeLine||seen.has(noticeLine.id)) throw new Error('到货明细包含无效或重复的通知物料'); seen.add(noticeLine.id);
  const quantity=Number(input.quantity||0), remaining=round4(Number(noticeLine.planned_quantity||0)-Number(noticeLine.arrived_quantity||0));
  if(!Number.isFinite(quantity)||quantity<0) throw new Error('到货数量不能为负数'); if(quantity===0) continue;
  if(quantity>remaining) throw new Error((noticeLine.item_code||noticeLine.name)+' 到货数量超过剩余可到数量');
  if(!input.warehouse_id) throw new Error((noticeLine.item_code||noticeLine.name)+' 必须选择到货仓库');
  const warehouse=await ctx.api.object('forge_warehouse').findOne({where:{id:input.warehouse_id}}); if(!warehouse) throw new Error('到货仓库不存在或不可用');
  const orderLine=await ctx.api.object('forge_purchase_order_line').findOne({where:{id:noticeLine.order_line_id}}); if(!orderLine||orderLine.order_id!==order.id) throw new Error('通知物料关联的采购订单明细不存在');
  const round2=value=>Math.round((Number(value)+Number.EPSILON)*100)/100,taxedUnit=Number(orderLine.taxed_unit_price||0),untaxedUnit=Number(orderLine.untaxed_unit_price||0),lineTaxed=round2(quantity*taxedUnit),lineUntaxed=round2(quantity*untaxedUnit);
  totalQuantity=round4(totalQuantity+quantity);taxedAmount=round4(taxedAmount+lineTaxed);untaxedAmount=round4(untaxedAmount+lineUntaxed);
  prepared.push({input,noticeLine,orderLine,quantity,warehouseId:warehouse.id,taxedUnit,untaxedUnit,lineTaxed,lineUntaxed});
}
if(!prepared.length) throw new Error('至少一条物料的到货数量必须大于0');
const year=String(ctx.input.arrived_on||'').slice(0,4)||new Date(Date.now()+8*60*60*1000).toISOString().slice(0,4), existing=await ctx.api.object('forge_purchase_receipt').find({where:{}}), code='ARR-'+year+'-'+String(existing.length+1).padStart(4,'0');
const warehouseIds=[...new Set(prepared.map(item=>item.warehouseId))], now=new Date().toISOString(), status=mode==='submit'?'pending_inspection':'draft';
const created=await ctx.api.object('forge_purchase_receipt').insert({name:code+' 采购到货登记',code,notice_id:id,order_id:order.id,order_line_id:prepared[0].orderLine.id,sku_id:prepared[0].noticeLine.sku_id,item_code:prepared[0].noticeLine.item_code||null,quantity:prepared[0].quantity,batch_number:prepared[0].input.batch_number||null,taxed_unit_price:prepared[0].taxedUnit,supplier_id:notice.supplier_id,customer_id:ctx.input.customer_id||null,warehouse_id:warehouseIds.length===1?warehouseIds[0]:null,arrival_type:'purchase',arrived_on:ctx.input.arrived_on,contact_name:ctx.input.contact_name||null,contact_phone:ctx.input.contact_phone||null,carrier:ctx.input.carrier||null,logistics_number:ctx.input.logistics_number||null,line_count:prepared.length,total_quantity:totalQuantity,untaxed_amount:untaxedAmount,taxed_amount:taxedAmount,status,submitted_at:mode==='submit'?now:null,submitted_by:mode==='submit'?actor:null,responsible_id:actor,remarks:ctx.input.remarks||('由到货通知 '+notice.code+' 登记')});
const receiptId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id)); if(!receiptId) throw new Error('到货登记创建后未返回记录ID');
const savedLines=[];for(const item of prepared){const saved=await ctx.api.object('forge_purchase_receipt_line').insert({name:item.noticeLine.name,receipt_id:receiptId,notice_id:id,notice_line_id:item.noticeLine.id,order_id:order.id,order_line_id:item.orderLine.id,sku_id:item.noticeLine.sku_id,item_code:item.noticeLine.item_code,model:item.noticeLine.model,specification:item.noticeLine.specification,unit_name:item.noticeLine.unit_name,quantity:item.quantity,warehouse_id:item.warehouseId,warehouse_location:item.input.warehouse_location||null,external_sn:item.input.external_sn||null,batch_number:item.input.batch_number||null,taxed_unit_price:item.taxedUnit,untaxed_unit_price:item.untaxedUnit,tax_rate:item.orderLine.tax_rate||13,untaxed_amount:item.lineUntaxed,taxed_amount:item.lineTaxed,status,remarks:item.input.remarks||null});const savedId=typeof saved==='string'?saved:saved&&(saved.id||(saved.record&&saved.record.id));if(!savedId)throw new Error('到货明细创建后未返回记录ID');savedLines.push({...item,receiptLineId:savedId});}
if(mode==='submit'){
  const plans=(await ctx.api.object('forge_inspection_plan').find({where:{status:'active'}}))||[],routed=[];
  for(const item of savedLines){
    const skuRow=await ctx.api.object('forge_material_sku').findOne({where:{id:item.noticeLine.sku_id}});
    const materialRow=skuRow?await ctx.api.object('forge_material').findOne({where:{id:skuRow.material_id}}):null;
    const supplierRow=notice.supplier_id?await ctx.api.object('forge_supplier').findOne({where:{id:notice.supplier_id}}):null;
    const matched=plans.find(plan=>{const scope=String(plan.scope_value||'').trim();if(!scope)return false;
      if(plan.scope_type==='material')return [materialRow&&materialRow.code,skuRow&&skuRow.code,materialRow&&materialRow.name].filter(Boolean).indexOf(scope)>=0;
      if(plan.scope_type==='category')return [materialRow&&materialRow.category,materialRow&&materialRow.purchase_category,materialRow&&materialRow.property].filter(Boolean).indexOf(scope)>=0;
      if(plan.scope_type==='supplier')return [supplierRow&&supplierRow.code,supplierRow&&supplierRow.name].filter(Boolean).indexOf(scope)>=0;
      return false;});
    routed.push({item:item,exempt:!matched||matched.inspection_method==='exempt',plan:matched||null});
  }
  const exemptRows=routed.filter(row=>row.exempt),inspectRows=routed.filter(row=>!row.exempt);
  const pendingExisting=await ctx.api.object('forge_pending_inspection').find({where:{}});let pendingSeq=pendingExisting.length;
  const autoInspectionEntries=[];for(const row of inspectRows){const item=row.item;pendingSeq+=1;const pendingCode='PIN-'+year+'-'+String(pendingSeq).padStart(4,'0');const pendingCreated=await ctx.api.object('forge_pending_inspection').insert({name:item.noticeLine.name,code:pendingCode,receipt_id:receiptId,receipt_line_id:item.receiptLineId,order_id:order.id,order_line_id:item.orderLine.id,supplier_id:notice.supplier_id,customer_id:ctx.input.customer_id||null,warehouse_id:item.warehouseId,sku_id:item.noticeLine.sku_id,item_code:item.noticeLine.item_code,model:item.noticeLine.model,specification:item.noticeLine.specification,unit_name:item.noticeLine.unit_name,arrival_quantity:item.quantity,batch_number:item.input.batch_number||null,external_sn:item.input.external_sn||null,arrived_on:ctx.input.arrived_on,status:'pending',responsible_id:actor,remarks:'由到货登记 '+code+' 按检验方案 '+((row.plan&&row.plan.code)||'')+' 提交待检'});const pendingId=typeof pendingCreated==='string'?pendingCreated:pendingCreated&&(pendingCreated.id||(pendingCreated.record&&pendingCreated.record.id));await ctx.api.object('forge_purchase_receipt_line').update({id:item.receiptLineId,status:'pending_inspection'});if(pendingId)autoInspectionEntries.push({pendingId,row,item,pendingCode});}
  for(const entry of autoInspectionEntries){const existingInspection=await ctx.api.object('forge_purchase_inspection').find({where:{pending_inspection_id:entry.pendingId}});if(existingInspection.length)continue;const method=String((entry.row.plan&&entry.row.plan.inspection_method)||'full'),existingInspections=await ctx.api.object('forge_purchase_inspection').find({where:{}}),inspectionCode='IQC-'+year+'-'+String(existingInspections.length+1).padStart(4,'0'),inspectionCreated=await ctx.api.object('forge_purchase_inspection').insert({name:entry.item.noticeLine.name,code:inspectionCode,receipt_id:receiptId,receipt_line_id:entry.item.receiptLineId,pending_inspection_id:entry.pendingId,order_id:order.id,order_line_id:entry.item.orderLine.id,supplier_id:notice.supplier_id,warehouse_id:entry.item.warehouseId,sku_id:entry.item.noticeLine.sku_id,item_code:entry.item.noticeLine.item_code,model:entry.item.noticeLine.model,specification:entry.item.noticeLine.specification,unit_name:entry.item.noticeLine.unit_name,batch_number:entry.item.input.batch_number||null,inspection_method:method,total_quantity:entry.item.quantity,accepted_quantity:0,rejected_quantity:0,result:'pending',status:'pending',inspector_id:actor,remarks:'由到货登记 '+code+' 按检验方案 '+((entry.row.plan&&entry.row.plan.code)||'')+' 自动生成'}),inspectionId=typeof inspectionCreated==='string'?inspectionCreated:inspectionCreated&&(inspectionCreated.id||(inspectionCreated.record&&inspectionCreated.record.id));await ctx.api.object('forge_pending_inspection').update({id:entry.pendingId,status:'inspection_created',inspection_id:inspectionId});await ctx.api.object('forge_purchase_receipt_line').update({id:entry.item.receiptLineId,status:'inspection_created'});}
  if(exemptRows.length){
    const inboundAll=await ctx.api.object('forge_purchase_inbound').find({where:{}}),inboundCode='IN-'+year+'-'+String(inboundAll.length+1).padStart(4,'0');
    const exemptQuantity=round4(exemptRows.reduce((sum,row)=>sum+Number(row.item.quantity||0),0)),exemptUntaxed=round4(exemptRows.reduce((sum,row)=>sum+Number(row.item.lineUntaxed||0),0)),exemptTaxed=round4(exemptRows.reduce((sum,row)=>sum+Number(row.item.lineTaxed||0),0)),firstExempt=exemptRows[0].item;
    const createdInbound=await ctx.api.object('forge_purchase_inbound').insert({name:inboundCode+' 采购入库（免检）',code:inboundCode,inbound_type:'purchase',source_type:'exempt_inspection',order_id:order.id,order_line_id:firstExempt.orderLine.id,sku_id:firstExempt.noticeLine.sku_id,item_code:firstExempt.noticeLine.item_code||null,batch_number:firstExempt.input.batch_number||null,quantity:firstExempt.quantity,unit_cost:firstExempt.taxedUnit,inventory_amount:firstExempt.lineTaxed,before_on_hand:0,after_on_hand:0,receipt_id:receiptId,supplier_id:notice.supplier_id,warehouse_id:firstExempt.warehouseId,inbound_on:ctx.input.arrived_on,line_count:exemptRows.length,total_quantity:exemptQuantity,untaxed_amount:exemptUntaxed,taxed_amount:exemptTaxed,status:'stocked',submitted_at:now,submitted_by:actor,responsible_id:actor,remarks:'免检物料由到货登记 '+code+' 直接入库'});
    const inboundId=typeof createdInbound==='string'?createdInbound:createdInbound&&(createdInbound.id||(createdInbound.record&&createdInbound.record.id));
    if(!inboundId) throw new Error('免检入库单创建后未返回记录ID');
    for(let index=0;index<exemptRows.length;index++){
      const item=exemptRows[index].item,lineQuantity=Number(item.quantity||0),lineTaxed=Number(item.lineTaxed||0),lineUntaxed=Number(item.lineUntaxed||0);
      const createdLine=await ctx.api.object('forge_purchase_inbound_line').insert({name:item.noticeLine.name,inbound_id:inboundId,receipt_id:receiptId,receipt_line_id:item.receiptLineId,order_id:order.id,order_line_id:item.orderLine.id,supplier_id:notice.supplier_id,warehouse_id:item.warehouseId,warehouse_location:item.input.warehouse_location||null,sku_id:item.noticeLine.sku_id,item_code:item.noticeLine.item_code,model:item.noticeLine.model,specification:item.noticeLine.specification,unit_name:item.noticeLine.unit_name,batch_number:item.input.batch_number||null,external_sn:item.input.external_sn||null,quantity:lineQuantity,taxed_unit_price:item.taxedUnit,untaxed_unit_price:item.untaxedUnit,tax_rate:item.orderLine.tax_rate||13,untaxed_amount:lineUntaxed,taxed_amount:lineTaxed,before_on_hand:0,after_on_hand:0,status:'stocked',remarks:'免检入库'});
      const lineId=typeof createdLine==='string'?createdLine:createdLine&&(createdLine.id||(createdLine.record&&createdLine.record.id));
      if(!lineId) throw new Error('免检入库明细创建后未返回记录ID');
      const balanceKey=item.warehouseId+':'+item.noticeLine.sku_id,balances=await ctx.api.object('forge_inventory_balance').find({where:{balance_key:balanceKey}});
      if(balances.length>1) throw new Error('同一仓库和物料存在重复库存余额');
      const balance=balances[0]||null,beforeOnHand=Number(balance&&balance.on_hand_quantity||0),reserved=Number(balance&&balance.reserved_quantity||0),beforeAvailable=Number(balance&&balance.available_quantity||0),beforeValue=Number(balance&&balance.inventory_value||0),afterOnHand=round4(beforeOnHand+lineQuantity),afterAvailable=round4(afterOnHand-reserved),afterValue=round4(beforeValue+lineTaxed),averageCost=afterOnHand>0?round4(afterValue/afterOnHand):0;
      if(balance)await ctx.api.object('forge_inventory_balance').update({id:balance.id,on_hand_quantity:afterOnHand,reserved_quantity:reserved,available_quantity:afterAvailable,average_cost:averageCost,inventory_value:afterValue,last_movement_at:now});
      else await ctx.api.object('forge_inventory_balance').insert({name:inboundCode+' '+item.noticeLine.name,balance_key:balanceKey,warehouse_id:item.warehouseId,sku_id:item.noticeLine.sku_id,on_hand_quantity:afterOnHand,reserved_quantity:0,available_quantity:afterAvailable,average_cost:averageCost,inventory_value:afterValue,last_movement_at:now,remarks:'由免检采购入库建立'});
      await ctx.api.object('forge_inventory_ledger').insert({name:inboundCode+' '+item.noticeLine.name+' 入库',code:inboundCode+'-'+String(index+1).padStart(3,'0'),warehouse_id:item.warehouseId,sku_id:item.noticeLine.sku_id,direction:'inbound',movement_type:'purchase_inbound',quantity:lineQuantity,before_on_hand:beforeOnHand,after_on_hand:afterOnHand,before_available:beforeAvailable,after_available:afterAvailable,unit_cost:Number(item.taxedUnit||0),amount:lineTaxed,occurred_at:now,source_object:'forge_purchase_inbound',source_id:inboundId,source_line_id:lineId,responsible_id:actor,remarks:'免检入库'});
      await ctx.api.object('forge_purchase_inbound_line').update({id:lineId,before_on_hand:beforeOnHand,after_on_hand:afterOnHand,status:'stocked'});
      await ctx.api.object('forge_purchase_receipt_line').update({id:item.receiptLineId,status:'exempt'});
      await ctx.api.object('forge_purchase_order_line').update({id:item.orderLine.id,inbound_quantity:round4(Number(item.orderLine.inbound_quantity||0)+lineQuantity)});
    }
    await ctx.api.object('forge_purchase_inbound_approval_log').insert({name:inboundCode+' 免检入库',inbound_id:inboundId,action:'stocked',from_status:'draft',to_status:'stocked',comment:'检验方案判定免检，到货登记直接入库',occurred_at:now,operator_id:actor});
  }
  for(const item of prepared){const next=round4(Number(item.noticeLine.arrived_quantity||0)+item.quantity), lineStatus=next>=Number(item.noticeLine.planned_quantity||0)?'arrived':'partially_arrived';await ctx.api.object('forge_purchase_arrival_notice_line').update({id:item.noticeLine.id,arrived_quantity:next,status:lineStatus});await ctx.api.object('forge_purchase_order_line').update({id:item.orderLine.id,arrived_quantity:round4(Number(item.orderLine.arrived_quantity||0)+item.quantity)});}
  const noticeNext=round4(Number(notice.arrived_quantity||0)+totalQuantity),noticeStatus=noticeNext>=Number(notice.planned_quantity||0)?'arrived':'partially_arrived',orderNext=round4(Number(order.arrived_quantity||0)+totalQuantity),orderStatus=orderNext>=Number(order.total_quantity||0)?'arrived':'partially_arrived';
  await ctx.api.object('forge_purchase_arrival_notice').update({id,arrived_quantity:noticeNext,status:noticeStatus});await ctx.api.object('forge_purchase_order').update({id:order.id,arrived_quantity:orderNext,status:orderStatus});
  await ctx.api.object('forge_purchase_receipt').update({id:receiptId,status:inspectRows.length?'pending_inspection':(exemptRows.length?'exempt_stocked':'stocked')});
}
return {id:receiptId,code,status,line_count:prepared.length,total_quantity:totalQuantity,untaxed_amount:untaxedAmount,taxed_amount:taxedAmount,notice_status:mode==='submit'?(Number(notice.arrived_quantity||0)+totalQuantity>=Number(notice.planned_quantity||0)?'arrived':'partially_arrived'):notice.status};
` },
});

export const PurchaseReceiptSubmit = defineAction({
  name:'purchase_receipt_submit',label:'提交待检',objectName:'forge_purchase_receipt',icon:'send',locations:[...locations],order:20,visible:`record.status == 'draft'`,refreshAfter:true,
  description:'把草稿到货登记提交到待检库存，并回写通知与采购订单到货进度。',successMessage:'到货登记已提交待检',
  body:{language:'js',capabilities:['api.read','api.write'],source:`
const id=ctx.recordId||(ctx.record&&ctx.record.id),receipt=ctx.record,actor=ctx.session&&ctx.session.userId;if(ctx.recordLoadDenied===true||!id||!receipt)throw new Error('当前到货登记不存在或不可访问');if(!actor)throw new Error('无法识别当前操作人');if(receipt.status!=='draft')throw new Error('到货登记状态已变化，请刷新后重试');
const notice=await ctx.api.object('forge_purchase_arrival_notice').findOne({where:{id:receipt.notice_id}}),order=await ctx.api.object('forge_purchase_order').findOne({where:{id:receipt.order_id}}),lines=await ctx.api.object('forge_purchase_receipt_line').find({where:{receipt_id:id}});if(!notice||!order||!lines.length)throw new Error('到货登记关联的通知、订单或明细不存在');
const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;let total=0;const prepared=[];
for(const line of lines){const noticeLine=await ctx.api.object('forge_purchase_arrival_notice_line').findOne({where:{id:line.notice_line_id}}),orderLine=await ctx.api.object('forge_purchase_order_line').findOne({where:{id:line.order_line_id}});if(!noticeLine||!orderLine||!line.warehouse_id)throw new Error('到货明细的通知、订单或仓库引用不完整');const quantity=Number(line.quantity||0),remaining=round4(Number(noticeLine.planned_quantity||0)-Number(noticeLine.arrived_quantity||0));if(!(quantity>0)||quantity>remaining)throw new Error((line.item_code||line.name)+' 到货数量超过当前剩余可到数量');total=round4(total+quantity);prepared.push({line,noticeLine,orderLine,quantity});}
const existingPending=await ctx.api.object('forge_pending_inspection').find({where:{receipt_id:id}});if(existingPending.length)throw new Error('该到货登记已经生成待检记录');const year=String(receipt.arrived_on||'').slice(0,4)||new Date(Date.now()+8*60*60*1000).toISOString().slice(0,4),allPending=await ctx.api.object('forge_pending_inspection').find({where:{}}),pendingBase=allPending.length;
for(let index=0;index<prepared.length;index++){const item=prepared[index],pendingCode='PIN-'+year+'-'+String(pendingBase+index+1).padStart(4,'0');await ctx.api.object('forge_pending_inspection').insert({name:item.line.name,code:pendingCode,receipt_id:id,receipt_line_id:item.line.id,order_id:order.id,order_line_id:item.orderLine.id,supplier_id:receipt.supplier_id,customer_id:receipt.customer_id||null,warehouse_id:item.line.warehouse_id,sku_id:item.line.sku_id,item_code:item.line.item_code,model:item.line.model,specification:item.line.specification,unit_name:item.line.unit_name,arrival_quantity:item.quantity,batch_number:item.line.batch_number||null,external_sn:item.line.external_sn||null,arrived_on:receipt.arrived_on,status:'pending',responsible_id:actor,remarks:'由到货登记 '+receipt.code+' 提交待检'});}
for(const item of prepared){const next=round4(Number(item.noticeLine.arrived_quantity||0)+item.quantity),lineStatus=next>=Number(item.noticeLine.planned_quantity||0)?'arrived':'partially_arrived';await ctx.api.object('forge_purchase_arrival_notice_line').update({id:item.noticeLine.id,arrived_quantity:next,status:lineStatus});await ctx.api.object('forge_purchase_order_line').update({id:item.orderLine.id,arrived_quantity:round4(Number(item.orderLine.arrived_quantity||0)+item.quantity)});await ctx.api.object('forge_purchase_receipt_line').update({id:item.line.id,status:'pending_inspection'});}
const noticeNext=round4(Number(notice.arrived_quantity||0)+total),noticeStatus=noticeNext>=Number(notice.planned_quantity||0)?'arrived':'partially_arrived',orderNext=round4(Number(order.arrived_quantity||0)+total),orderStatus=orderNext>=Number(order.total_quantity||0)?'arrived':'partially_arrived',now=new Date().toISOString();await ctx.api.object('forge_purchase_arrival_notice').update({id:notice.id,arrived_quantity:noticeNext,status:noticeStatus});await ctx.api.object('forge_purchase_order').update({id:order.id,arrived_quantity:orderNext,status:orderStatus});await ctx.api.object('forge_purchase_receipt').update({id,status:'pending_inspection',submitted_at:now,submitted_by:actor});return{id,status:'pending_inspection',total_quantity:total,notice_status:noticeStatus};
`},
});

export const PendingInspectionCreateOrder = defineAction({
  name:'pending_inspection_create_order',label:'生成检验单',objectName:'forge_pending_inspection',icon:'clipboard-plus',locations:[...locations],order:20,visible:`record.status == 'pending'`,refreshAfter:true,
  description:'按一条待检物料生成一张采购检验单。',successMessage:'采购检验单已生成',
  params:[{field:'inspection_method',objectOverride:'forge_purchase_inspection',required:true}],
  onSuccess:{navigate:'/_console/apps/forge/page/page_purchase_inspection_workspace?id=${result.id}'},
  body:{language:'js',capabilities:['api.read','api.write'],source:`
const id=ctx.recordId||(ctx.record&&ctx.record.id),pending=ctx.record,actor=ctx.session&&ctx.session.userId;if(ctx.recordLoadDenied===true||!id||!pending)throw new Error('当前待检记录不存在或不可访问');if(!actor)throw new Error('无法识别当前操作人');if(pending.status!=='pending')throw new Error('待检记录状态已变化，请刷新后重试');if(!['full','sampling'].includes(ctx.input.inspection_method))throw new Error('检验方式必须为全检或抽检');
const receipt=await ctx.api.object('forge_purchase_receipt').findOne({where:{id:pending.receipt_id}}),receiptLine=await ctx.api.object('forge_purchase_receipt_line').findOne({where:{id:pending.receipt_line_id}});if(!receipt||!receiptLine||receiptLine.status!=='pending_inspection')throw new Error('待检记录关联的到货登记或物料明细状态不正确');const existing=await ctx.api.object('forge_purchase_inspection').find({where:{pending_inspection_id:id}});if(existing.length)throw new Error('该待检物料已经生成检验单');
const year=String(pending.arrived_on||'').slice(0,4)||new Date(Date.now()+8*60*60*1000).toISOString().slice(0,4),all=await ctx.api.object('forge_purchase_inspection').find({where:{}}),code='IQC-'+year+'-'+String(all.length+1).padStart(4,'0');const created=await ctx.api.object('forge_purchase_inspection').insert({name:receiptLine.name,code,receipt_id:pending.receipt_id,receipt_line_id:pending.receipt_line_id,pending_inspection_id:id,order_id:pending.order_id,order_line_id:pending.order_line_id,supplier_id:pending.supplier_id,warehouse_id:pending.warehouse_id,sku_id:pending.sku_id,item_code:pending.item_code,model:pending.model,specification:pending.specification,unit_name:pending.unit_name,batch_number:pending.batch_number||null,inspection_method:ctx.input.inspection_method,total_quantity:pending.arrival_quantity,accepted_quantity:0,rejected_quantity:0,result:'pending',status:'pending',inspector_id:actor,remarks:'由待检记录 '+pending.code+' 生成'});const inspectionId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!inspectionId)throw new Error('检验单创建后未返回记录ID');await ctx.api.object('forge_pending_inspection').update({id,status:'inspection_created',inspection_id:inspectionId});await ctx.api.object('forge_purchase_receipt_line').update({id:pending.receipt_line_id,status:'inspection_created'});await ctx.api.object('forge_purchase_receipt').update({id:receipt.id,status:'inspection_in_progress'});return{id:inspectionId,code,status:'pending',total_quantity:pending.arrival_quantity,pending_inspection_id:id};
`},
});

export const PurchaseInspectionComplete = defineAction({
  name: 'purchase_inspection_complete', label: '完成检验', objectName: 'forge_purchase_inspection', icon: 'clipboard-check',
  locations: [...locations], order: 20, visible: `record.status == 'pending'`, refreshAfter: true,
  description: '登记合格数量，不合格数量由到货总数自动计算。', successMessage: '检验已完成',
  params: [
    { field: 'inspected_on', objectOverride: 'forge_purchase_inspection', required: true },
    { field: 'accepted_quantity', objectOverride: 'forge_purchase_inspection', required: true },
    { field: 'inspection_note', objectOverride: 'forge_purchase_inspection', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const inspection = ctx.record;
if (ctx.recordLoadDenied === true || !id || !inspection) throw new Error('当前检验单不存在或不可访问');
if (inspection.status !== 'pending') throw new Error('检验单状态已变化，请刷新后重试');
const total = Number(inspection.total_quantity || 0), accepted = Number(ctx.input.accepted_quantity);
if (!Number.isFinite(accepted) || accepted < 0 || accepted > total) throw new Error('合格数量必须在0和到货总数之间');
const note=String(ctx.input.inspection_note||'').trim();if(!note)throw new Error('检验结论不能为空');
const round4 = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
const rejected = round4(total - accepted), result = accepted === total ? 'passed' : accepted > 0 ? 'partial' : 'rejected';
const line = await ctx.api.object('forge_purchase_order_line').findOne({ where: { id: inspection.order_line_id } });
if (!line) throw new Error('检验单关联的采购订单明细不存在');
await ctx.api.object('forge_purchase_inspection').update({ id, accepted_quantity: accepted, rejected_quantity: rejected, inspected_on: ctx.input.inspected_on, result, status: 'completed', inspection_note: note });
if(inspection.pending_inspection_id)await ctx.api.object('forge_pending_inspection').update({id:inspection.pending_inspection_id,status:'inspected'});if(inspection.receipt_line_id)await ctx.api.object('forge_purchase_receipt_line').update({id:inspection.receipt_line_id,status:'inspected'});const receiptLines=await ctx.api.object('forge_purchase_receipt_line').find({where:{receipt_id:inspection.receipt_id}}),allDone=receiptLines.every(item=>item.id===inspection.receipt_line_id||['inspected','stocked','cancelled'].includes(item.status));await ctx.api.object('forge_purchase_receipt').update({ id: inspection.receipt_id, status:allDone?'inspected':'inspection_in_progress' });
await ctx.api.object('forge_purchase_order_line').update({ id: line.id, inspected_quantity: round4(Number(line.inspected_quantity || 0) + total), accepted_quantity: round4(Number(line.accepted_quantity || 0) + accepted) });
return { id, status: 'completed', result, accepted_quantity: accepted, rejected_quantity: rejected, receipt_status:allDone?'inspected':'inspection_in_progress' };
` },
});

export const PurchaseOrderCreateInbound = defineAction({
  name:'purchase_order_create_inbound',label:'新建采购入库',objectName:'forge_purchase_order',icon:'package-plus',locations:[...locations],order:40,visible:`record.status == 'arrived' || record.status == 'partially_arrived'`,refreshAfter:true,
  description:'从已完成检验的合格物料生成一张多明细采购入库单。',successMessage:'采购入库单已创建',
  params:[{name:'mode',label:'办理方式',type:'select',required:true,options:[{value:'draft',label:'保存草稿'},{value:'submit',label:'提交审批'}]},{field:'inbound_on',objectOverride:'forge_purchase_inbound',required:true},{name:'lines_json',label:'入库物料明细',type:'textarea',required:true},{field:'remarks',objectOverride:'forge_purchase_inbound'}],
  onSuccess:{navigate:'/_console/apps/forge/page/page_purchase_inbound_workspace?id=${result.id}'},
  body:{language:'js',capabilities:['api.read','api.write'],source:`
const id=ctx.recordId||(ctx.record&&ctx.record.id),order=ctx.record,actor=ctx.session&&ctx.session.userId;if(ctx.recordLoadDenied===true||!id||!order)throw new Error('当前采购订单不存在或不可访问');if(!actor)throw new Error('无法识别当前操作人');if(!['arrived','partially_arrived'].includes(order.status))throw new Error('采购订单状态不允许新建入库单');const mode=ctx.input.mode;if(!['draft','submit'].includes(mode))throw new Error('办理方式必须为保存草稿或提交审批');if(!ctx.input.inbound_on)throw new Error('入库日期不能为空');const year=String(ctx.input.inbound_on).slice(0,4)||new Date(Date.now()+8*60*60*1000).toISOString().slice(0,4),allInbounds=await ctx.api.object('forge_purchase_inbound').find({where:{}}),code='PIN-'+year+'-'+String(allInbounds.length+1).padStart(4,'0');let inputs;try{inputs=typeof ctx.input.lines_json==='string'?JSON.parse(ctx.input.lines_json):ctx.input.lines_json;}catch{throw new Error('入库物料明细格式错误');}if(!Array.isArray(inputs)||!inputs.length)throw new Error('至少需要一条入库物料明细');
const seen=new Set(),prepared=[],round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000,round2=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;let totalQuantity=0,untaxedAmount=0,taxedAmount=0;
for(const input of inputs){if(seen.has(input.inspection_id))throw new Error('入库明细包含重复检验单');seen.add(input.inspection_id);const inspection=await ctx.api.object('forge_purchase_inspection').findOne({where:{id:input.inspection_id}});if(!inspection||inspection.order_id!==id||inspection.status!=='completed'||!(Number(inspection.accepted_quantity||0)>0))throw new Error('入库明细只能选择本订单已完成且有合格数量的检验单');const existing=await ctx.api.object('forge_purchase_inbound_line').find({where:{inspection_id:inspection.id}}),used=round4(existing.filter(line=>line.status!=='cancelled').reduce((sum,line)=>sum+Number(line.quantity||0),0)),remaining=round4(Number(inspection.accepted_quantity||0)-used),quantity=Number(input.quantity||0);if(!(quantity>0)||quantity>remaining)throw new Error((inspection.item_code||inspection.name)+' 入库数量超过检验合格剩余数量');const orderLine=await ctx.api.object('forge_purchase_order_line').findOne({where:{id:inspection.order_line_id}}),receiptLine=await ctx.api.object('forge_purchase_receipt_line').findOne({where:{id:inspection.receipt_line_id}});if(!orderLine||!receiptLine)throw new Error('检验单关联的采购或到货明细不存在');const warehouseId=input.warehouse_id||inspection.warehouse_id;if(!warehouseId)throw new Error((inspection.item_code||inspection.name)+' 必须选择入库仓库');const warehouse=await ctx.api.object('forge_warehouse').findOne({where:{id:warehouseId}});if(!warehouse)throw new Error('入库仓库不存在');const taxedUnit=Number(orderLine.taxed_unit_price||0),untaxedUnit=Number(orderLine.untaxed_unit_price||0),lineTaxed=round2(quantity*taxedUnit),lineUntaxed=round2(quantity*untaxedUnit);totalQuantity=round4(totalQuantity+quantity);taxedAmount=round4(taxedAmount+lineTaxed);untaxedAmount=round4(untaxedAmount+lineUntaxed);prepared.push({input,inspection,orderLine,receiptLine,quantity,warehouseId,taxedUnit,untaxedUnit,lineTaxed,lineUntaxed});}
const status=mode==='submit'?'pending_approval':'draft',now=new Date().toISOString(),warehouseIds=[...new Set(prepared.map(item=>item.warehouseId))],receiptIds=[...new Set(prepared.map(item=>item.inspection.receipt_id))],primary=prepared[0],created=await ctx.api.object('forge_purchase_inbound').insert({name:code+' 采购入库',code,inbound_type:'purchase',source_type:'purchase_order',order_id:id,inspection_id:primary.inspection.id,order_line_id:primary.orderLine.id,sku_id:primary.inspection.sku_id,item_code:primary.inspection.item_code,batch_number:primary.inspection.batch_number||primary.receiptLine.batch_number||null,quantity:primary.quantity,unit_cost:primary.taxedUnit,inventory_amount:primary.lineTaxed,before_on_hand:0,after_on_hand:0,receipt_id:receiptIds.length===1?receiptIds[0]:null,supplier_id:order.supplier_id,warehouse_id:warehouseIds.length===1?warehouseIds[0]:null,inbound_on:ctx.input.inbound_on,line_count:prepared.length,total_quantity:totalQuantity,untaxed_amount:untaxedAmount,taxed_amount:taxedAmount,status,submitted_at:mode==='submit'?now:null,submitted_by:mode==='submit'?actor:null,responsible_id:actor,remarks:ctx.input.remarks||('由采购订单 '+order.code+' 创建')});const inboundId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!inboundId)throw new Error('采购入库单创建后未返回记录ID');for(const item of prepared)await ctx.api.object('forge_purchase_inbound_line').insert({name:item.orderLine.name,inbound_id:inboundId,inspection_id:item.inspection.id,receipt_id:item.inspection.receipt_id,receipt_line_id:item.inspection.receipt_line_id,order_id:id,order_line_id:item.orderLine.id,supplier_id:order.supplier_id,warehouse_id:item.warehouseId,warehouse_location:item.input.warehouse_location||item.receiptLine.warehouse_location||null,sku_id:item.inspection.sku_id,item_code:item.inspection.item_code,model:item.inspection.model,specification:item.inspection.specification,unit_name:item.inspection.unit_name,batch_number:item.inspection.batch_number||item.receiptLine.batch_number||null,external_sn:item.receiptLine.external_sn||null,quantity:item.quantity,taxed_unit_price:item.taxedUnit,untaxed_unit_price:item.untaxedUnit,tax_rate:item.orderLine.tax_rate||13,untaxed_amount:item.lineUntaxed,taxed_amount:item.lineTaxed,before_on_hand:0,after_on_hand:0,status,remarks:item.input.remarks||null});if(mode==='submit')await ctx.api.object('forge_purchase_inbound_approval_log').insert({name:code+' 提交审批',inbound_id:inboundId,action:'submitted',from_status:'draft',to_status:'pending_approval',comment:ctx.input.remarks||'提交审批',occurred_at:now,operator_id:actor});return{id:inboundId,code,status,line_count:prepared.length,total_quantity:totalQuantity,untaxed_amount:untaxedAmount,taxed_amount:taxedAmount};
`},
});

export const PurchaseInboundSubmit = defineAction({
  name:'purchase_inbound_submit',label:'提交审批',objectName:'forge_purchase_inbound',icon:'send',locations:[...locations],order:20,visible:`record.status == 'draft'`,refreshAfter:true,description:'把采购入库草稿提交审批。',successMessage:'采购入库单已提交审批',
  body:{language:'js',capabilities:['api.read','api.write'],source:`
const id=ctx.recordId||(ctx.record&&ctx.record.id),inbound=ctx.record,actor=ctx.session&&ctx.session.userId;if(ctx.recordLoadDenied===true||!id||!inbound)throw new Error('当前采购入库单不存在或不可访问');if(!actor)throw new Error('无法识别当前操作人');if(inbound.status!=='draft')throw new Error('入库单状态已变化，请刷新后重试');const lines=await ctx.api.object('forge_purchase_inbound_line').find({where:{inbound_id:id}});if(!lines.length||lines.some(line=>line.status!=='draft'||!(Number(line.quantity||0)>0)))throw new Error('入库单至少需要一条有效草稿物料');const now=new Date().toISOString();for(const line of lines)await ctx.api.object('forge_purchase_inbound_line').update({id:line.id,status:'pending_approval'});await ctx.api.object('forge_purchase_inbound').update({id,status:'pending_approval',submitted_at:now,submitted_by:actor});await ctx.api.object('forge_purchase_inbound_approval_log').insert({name:inbound.code+' 提交审批',inbound_id:id,action:'submitted',from_status:'draft',to_status:'pending_approval',comment:inbound.remarks||'提交审批',occurred_at:now,operator_id:actor});return{id,status:'pending_approval'};
`},
});

export const PurchaseInboundApprove = defineAction({
  name:'purchase_inbound_approve',label:'审批通过',objectName:'forge_purchase_inbound',icon:'badge-check',locations:[...locations],order:30,visible:`record.status == 'pending_approval'`,refreshAfter:true,description:'审批采购入库单；审批本身不增加库存。',successMessage:'采购入库单已审批',params:[{field:'approval_note',objectOverride:'forge_purchase_inbound',required:true}],
  body:{language:'js',capabilities:['api.read','api.write'],source:`
const id=ctx.recordId||(ctx.record&&ctx.record.id),inbound=ctx.record,actor=ctx.session&&ctx.session.userId;if(ctx.recordLoadDenied===true||!id||!inbound)throw new Error('当前采购入库单不存在或不可访问');if(!actor)throw new Error('无法识别当前操作人');if(inbound.status!=='pending_approval')throw new Error('入库单状态已变化，请刷新后重试');const note=String(ctx.input.approval_note||'').trim();if(!note)throw new Error('审批意见不能为空');const lines=await ctx.api.object('forge_purchase_inbound_line').find({where:{inbound_id:id}}),now=new Date().toISOString();if(!lines.length||lines.some(line=>line.status!=='pending_approval'))throw new Error('入库明细状态不允许审批');for(const line of lines)await ctx.api.object('forge_purchase_inbound_line').update({id:line.id,status:'approved'});await ctx.api.object('forge_purchase_inbound').update({id,status:'approved',approved_at:now,approved_by:actor,approval_note:note});await ctx.api.object('forge_purchase_inbound_approval_log').insert({name:inbound.code+' 审批通过',inbound_id:id,action:'approved',from_status:'pending_approval',to_status:'approved',comment:note,occurred_at:now,operator_id:actor});return{id,status:'approved'};
`},
});

export const PurchaseInboundStock = defineAction({
  name:'purchase_inbound_stock',label:'执行入库',objectName:'forge_purchase_inbound',icon:'boxes',locations:[...locations],order:40,visible:`record.status == 'approved'`,refreshAfter:true,description:'把已审批明细增加到库存余额并写入库存流水。',successMessage:'采购入库完成，库存已更新',
  body:{language:'js',capabilities:['api.read','api.write'],source:`
const id=ctx.recordId||(ctx.record&&ctx.record.id),inbound=ctx.record,actor=ctx.session&&ctx.session.userId;if(ctx.recordLoadDenied===true||!id||!inbound)throw new Error('当前采购入库单不存在或不可访问');if(!actor)throw new Error('无法识别当前操作人');if(inbound.status!=='approved')throw new Error('仅已审批采购入库单可以执行入库');const lines=await ctx.api.object('forge_purchase_inbound_line').find({where:{inbound_id:id}}),order=await ctx.api.object('forge_purchase_order').findOne({where:{id:inbound.order_id}});if(!order||!lines.length||lines.some(line=>line.status!=='approved'))throw new Error('采购订单或入库明细状态不正确');const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000,now=new Date().toISOString(),receiptIds=[...new Set(lines.map(line=>line.receipt_id))];let total=0;
for(let index=0;index<lines.length;index++){const line=lines[index],inspection=await ctx.api.object('forge_purchase_inspection').findOne({where:{id:line.inspection_id}});if(!inspection||inspection.status!=='completed')throw new Error('入库明细关联的检验单尚未完成');const allForInspection=await ctx.api.object('forge_purchase_inbound_line').find({where:{inspection_id:inspection.id}}),otherUsed=round4(allForInspection.filter(item=>item.id!==line.id&&item.status!=='cancelled').reduce((sum,item)=>sum+Number(item.quantity||0),0));if(Number(line.quantity||0)>round4(Number(inspection.accepted_quantity||0)-otherUsed))throw new Error((line.item_code||line.name)+' 入库数量超过检验合格剩余数量');const balanceKey=line.warehouse_id+':'+line.sku_id,balances=await ctx.api.object('forge_inventory_balance').find({where:{balance_key:balanceKey}});if(balances.length>1)throw new Error('同一仓库和物料存在重复库存余额');const balance=balances[0]||null,beforeOnHand=Number(balance&&balance.on_hand_quantity||0),reserved=Number(balance&&balance.reserved_quantity||0),beforeAvailable=Number(balance&&balance.available_quantity||0),beforeValue=Number(balance&&balance.inventory_value||0),quantity=Number(line.quantity||0),amount=Number(line.taxed_amount||0),afterOnHand=round4(beforeOnHand+quantity),afterAvailable=round4(afterOnHand-reserved),afterValue=round4(beforeValue+amount),averageCost=afterOnHand>0?round4(afterValue/afterOnHand):0;if(balance)await ctx.api.object('forge_inventory_balance').update({id:balance.id,on_hand_quantity:afterOnHand,reserved_quantity:reserved,available_quantity:afterAvailable,average_cost:averageCost,inventory_value:afterValue,last_movement_at:now});else await ctx.api.object('forge_inventory_balance').insert({name:inbound.code+' '+line.name,balance_key:balanceKey,warehouse_id:line.warehouse_id,sku_id:line.sku_id,on_hand_quantity:afterOnHand,reserved_quantity:0,available_quantity:afterAvailable,average_cost:averageCost,inventory_value:afterValue,last_movement_at:now,remarks:'由采购入库建立'});await ctx.api.object('forge_inventory_ledger').insert({name:inbound.code+' '+line.name+' 入库',code:inbound.code+'-'+String(index+1).padStart(3,'0'),warehouse_id:line.warehouse_id,sku_id:line.sku_id,direction:'inbound',movement_type:'purchase_inbound',quantity,before_on_hand:beforeOnHand,after_on_hand:afterOnHand,before_available:beforeAvailable,after_available:afterAvailable,unit_cost:Number(line.taxed_unit_price||0),amount,occurred_at:now,source_object:'forge_purchase_inbound',source_id:id,source_line_id:line.id,responsible_id:actor,remarks:inbound.remarks||('由采购入库单 '+inbound.code+' 执行')});await ctx.api.object('forge_purchase_inbound_line').update({id:line.id,before_on_hand:beforeOnHand,after_on_hand:afterOnHand,status:'stocked'});if(inspection.pending_inspection_id)await ctx.api.object('forge_pending_inspection').update({id:inspection.pending_inspection_id,status:'stocked'});const snList=String(line.external_sn||'').split(/[,，;；\s]+/).map(v=>String(v).trim()).filter(Boolean);for(const snCode of snList){const existingSn=await ctx.api.object('forge_inventory_serial_number').findOne({where:{code:snCode}});if(existingSn)continue;await ctx.api.object('forge_inventory_serial_number').insert({name:snCode,code:snCode,sku_id:line.sku_id,inbound_code:inbound.code,batch_number:line.batch_number||null,supplier_id:order.supplier_id,status:'in_stock',responsible_id:actor,remarks:'由采购入库 '+inbound.code+' 登记'});}const orderLine=await ctx.api.object('forge_purchase_order_line').findOne({where:{id:line.order_line_id}});await ctx.api.object('forge_purchase_order_line').update({id:line.order_line_id,inbound_quantity:round4(Number(orderLine.inbound_quantity||0)+quantity)});const refreshedInboundLines=await ctx.api.object('forge_purchase_inbound_line').find({where:{inspection_id:inspection.id}}),stockedForInspection=round4(refreshedInboundLines.filter(item=>item.status==='stocked').reduce((sum,item)=>sum+Number(item.quantity||0),0));await ctx.api.object('forge_purchase_receipt_line').update({id:line.receipt_line_id,status:stockedForInspection>=Number(inspection.accepted_quantity||0)?'stocked':'inspected'});total=round4(total+quantity);}
for(const receiptId of receiptIds){const receiptLines=await ctx.api.object('forge_purchase_receipt_line').find({where:{receipt_id:receiptId}});let settled=true;for(const receiptLine of receiptLines){if(receiptLine.status==='stocked'||receiptLine.status==='cancelled')continue;const inspection=await ctx.api.object('forge_purchase_inspection').findOne({where:{receipt_line_id:receiptLine.id}});if(!inspection||inspection.status!=='completed'||Number(inspection.accepted_quantity||0)>0){settled=false;break;}}if(settled)await ctx.api.object('forge_purchase_receipt').update({id:receiptId,status:'stocked'});}
const orderInbound=round4(Number(order.inbound_quantity||0)+total),orderStatus=orderInbound>=Number(order.total_quantity||0)?'completed':'partially_arrived';await ctx.api.object('forge_purchase_order').update({id:order.id,inbound_quantity:orderInbound,status:orderStatus});
if(order.payable_trigger==='inbound'){
  const existingPayables=await ctx.api.object('forge_accounts_payable').find({where:{inbound_id:id}}),activePayables=existingPayables.filter(item=>item.status!=='cancelled');
  if(activePayables.length>1)throw new Error('当前采购入库单存在多笔有效应付，请先处理重复数据');
  if(!activePayables.length){await ctx.api.object('forge_accounts_payable').insert({name:order.code+' 应付 '+inbound.code,code:'AP-'+inbound.code,source_type:'purchase_inbound',inbound_id:id,invoice_id:null,order_id:order.id,supplier_id:order.supplier_id,recognized_on:inbound.inbound_on,due_on:order.settlement_on||inbound.inbound_on,original_amount:Number(inbound.inventory_amount||0),paid_amount:0,offset_amount:0,red_reversed_amount:0,outstanding_amount:Number(inbound.inventory_amount||0),status:'unpaid',responsible_id:order.responsible_id,remarks:'由采购入库 '+inbound.code+' 自动生成，待登记进项发票'});}
}
await ctx.api.object('forge_purchase_inbound').update({id,status:'stocked',stocked_at:now,stocked_by:actor});await ctx.api.object('forge_purchase_inbound_approval_log').insert({name:inbound.code+' 执行入库',inbound_id:id,action:'stocked',from_status:'approved',to_status:'stocked',comment:'采购入库完成',occurred_at:now,operator_id:actor});return{id,status:'stocked',line_count:lines.length,total_quantity:total,order_status:orderStatus};
`},
});

export const PurchaseOrderCreate = defineAction({
  name: 'purchase_order_create', label: '新建采购订单', objectName: 'forge_purchase_order', icon: 'shopping-cart',
  locations: [...locations], order: 50, visible: `false`, refreshAfter: true,
  description: '按采购来源（库存补充/项目采购/以销定采/BOM缺料/采购申请）创建采购订单，可保存草稿或提交审核。',
  successMessage: '采购订单已创建',
  params: [
    { name: 'mode', label: '办理方式', type: 'select', required: true, options: [{ value: 'draft', label: '保存草稿' }, { value: 'submit', label: '提交审核' }] },
    { name: 'source_type', label: '采购来源', type: 'select', required: true, options: [
      { value: 'inventory_replenishment', label: '库存补充' }, { value: 'project', label: '项目采购' },
      { value: 'sales_driven', label: '以销定采' }, { value: 'bom_shortage', label: 'BOM缺料' },
      { value: 'purchase_request', label: '采购申请' },
    ] },
    { name: 'code', label: '采购订单号' },
    { name: 'supplier_id', label: '供应商', type: 'text', required: true },
    { name: 'warehouse_id', label: '目标仓库', type: 'text' },
    { name: 'expected_arrival_on', label: '期望到货日期', type: 'date', required: true },
    { name: 'payment_term', label: '付款条件', type: 'text', required: true },
    { name: 'payment_method', label: '付款方式', type: 'text', required: true },
    { name: 'project_id', label: '关联项目', type: 'text' },
    { name: 'purchase_request_id', label: '关联采购申请', type: 'text' },
    { name: 'remarks', label: '备注', type: 'textarea' },
    { name: 'lines_json', label: '采购明细', type: 'textarea', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const actor = ctx.session && ctx.session.userId;
if (!actor) throw new Error('无法识别当前操作人');
const mode = String(ctx.input.mode || '');
if (!['draft', 'submit'].includes(mode)) throw new Error('办理方式不正确');
const sourceType = String(ctx.input.source_type || '');
if (!['inventory_replenishment', 'project', 'sales_driven', 'bom_shortage', 'purchase_request'].includes(sourceType)) throw new Error('请选择采购来源');
const supplier = ctx.input.supplier_id ? await ctx.api.object('forge_supplier').findOne({ where: { id: ctx.input.supplier_id } }) : null;
if (!supplier || supplier.status !== 'active' || supplier.approval_status !== 'approved') throw new Error('供应商必须启用且已审批');
if (!ctx.input.expected_arrival_on) throw new Error('期望到货日期不能为空');
const paymentTerm = String(ctx.input.payment_term || '').trim();
if (!paymentTerm) throw new Error('付款条件不能为空');
const paymentMethod = String(ctx.input.payment_method || '').trim();
if (!paymentMethod) throw new Error('付款方式不能为空');
let rawLines = [];
try { rawLines = JSON.parse(String(ctx.input.lines_json || '[]')); } catch (error) { throw new Error('采购明细格式不正确'); }
if (!Array.isArray(rawLines) || !rawLines.length) throw new Error('采购订单至少需要一条物料明细');
const round4 = value => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
const prepared = [];
for (const item of rawLines) {
  const sku = item.sku_id ? await ctx.api.object('forge_material_sku').findOne({ where: { id: item.sku_id } }) : null;
  if (!sku) throw new Error('采购明细存在无效物料规格');
  const material = sku.material_id ? await ctx.api.object('forge_material').findOne({ where: { id: sku.material_id } }) : null;
  const quantity = Number(item.quantity || 0);
  if (!(quantity > 0)) throw new Error('采购数量必须大于0');
  const taxed = round4(Number(item.taxed_unit_price || 0));
  const rate = Number(item.tax_rate == null ? 13 : item.tax_rate);
  const untaxed = round4(taxed / (1 + rate / 100));
  prepared.push({ sku, material, quantity, taxed, untaxed, rate, subtotal: round4(quantity * taxed) });
}
const totalQuantity = round4(prepared.reduce((sum, item) => sum + item.quantity, 0));
const totalAmount = round4(prepared.reduce((sum, item) => sum + item.subtotal, 0));
const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
const year = String(ctx.input.expected_arrival_on || today).slice(0, 4) || today.slice(0, 4);
let code = String(ctx.input.code || '').trim();
if (!code) {
  const all = await ctx.api.object('forge_purchase_order').find({ where: {} });
  const head = 'PO-' + year + '-';
  let max = 0;
  for (const row of all) { const text = String(row.code || ''); if (text.slice(0, head.length) !== head) continue; const tail = Number(text.slice(head.length)); if (Number.isFinite(tail) && tail > max) max = tail; }
  code = head + String(max + 1).padStart(4, '0');
}
const duplicated = await ctx.api.object('forge_purchase_order').find({ where: { code } });
if (duplicated.length) throw new Error('采购订单号已存在：' + code);
const status = mode === 'submit' ? 'pending_approval' : 'draft';
const now = new Date().toISOString();
const created = await ctx.api.object('forge_purchase_order').insert({
  name: supplier.name + ' - 采购订单', code, supplier_id: supplier.id,
  source_type: sourceType, purchase_request_id: ctx.input.purchase_request_id || null, project_id: ctx.input.project_id || null,
  warehouse_id: ctx.input.warehouse_id || null, expected_arrival_on: ctx.input.expected_arrival_on, order_on: today,
  payment_term: paymentTerm, payment_method: paymentMethod, currency: 'cny', exchange_rate: 1, payable_trigger: 'inbound',
  responsible_id: actor, line_count: prepared.length, total_quantity: totalQuantity, total_amount: totalAmount,
  arrived_quantity: 0, inbound_quantity: 0, returned_quantity: 0, replenished_quantity: 0,
  status, submitted_at: mode === 'submit' ? now : null, submitted_by: mode === 'submit' ? actor : null,
  remarks: ctx.input.remarks ? String(ctx.input.remarks).trim() : null,
});
const orderId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
if (!orderId) throw new Error('采购订单创建后未返回记录ID');
for (const item of prepared) {
  await ctx.api.object('forge_purchase_order_line').insert({
    name: (item.material && item.material.name) || item.sku.name || item.sku.code, order_id: orderId,
    sku_id: item.sku.id, item_code: (item.material && item.material.code) || item.sku.code, model: (item.material && item.material.model) || null,
    specification: item.sku.name || null, unit_name: (item.material && item.material.unit_name) || null,
    quantity: item.quantity, arrived_quantity: 0, inspected_quantity: 0, accepted_quantity: 0, inbound_quantity: 0,
    taxed_unit_price: item.taxed, untaxed_unit_price: item.untaxed, tax_rate: item.rate, taxed_subtotal: item.subtotal,
    expected_arrival_on: ctx.input.expected_arrival_on,
  });
}
if (mode === 'submit') {
  await ctx.api.object('forge_purchase_order_approval_log').insert({ name: code + ' 提交审核', order_id: orderId, action: 'submitted', from_status: 'draft', to_status: 'pending_approval', comment: '新建并提交审核', occurred_at: now, operator_id: actor });
}
return { id: orderId, code, status, line_count: prepared.length, total_quantity: totalQuantity, total_amount: totalAmount };
` },
});

export const PurchaseOrderSyncRollups = defineAction({
  name: 'purchase_order_sync_rollups', label: '同步订单汇总', objectName: 'forge_purchase_order', icon: 'refresh-cw',
  locations: [...locations], order: 60, visible: `false`, refreshAfter: true,
  description: '按采购订单明细重算物料数、采购总数量与含税总额（供批量建单等客户端路径调用）。',
  successMessage: '采购订单汇总已同步',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
if (ctx.recordLoadDenied === true || !id) throw new Error('当前采购订单不存在或不可访问');
const lines = await ctx.api.object('forge_purchase_order_line').find({ where: { order_id: id } });
if (!lines.length) throw new Error('采购订单至少需要一条物料明细');
const round4 = value => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
const totalQuantity = round4(lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0));
const totalAmount = round4(lines.reduce((sum, line) => sum + Number(line.taxed_subtotal || 0), 0));
await ctx.api.object('forge_purchase_order').update({ id, line_count: lines.length, total_quantity: totalQuantity, total_amount: totalAmount });
return { id, line_count: lines.length, total_quantity: totalQuantity, total_amount: totalAmount };
` },
});
