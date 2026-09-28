import { defineAction } from '@objectstack/spec';

/** Convert only current, assigned production shortages into a purchase request. */
export const ProductionShortageCreatePurchaseRequest = defineAction({
  name: 'production_shortage_create_purchase_request',
  label: '生成采购申请',
  objectName: 'forge_assembly_material_line',
  requiredPermissions: ['forge_production_operator'],
  locations: [],
  refreshAfter: true,
  params: [{ name: 'source_line_ids_json', label: '缺料来源', type: 'textarea', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const actor=ctx.session&&ctx.session.userId,organizationId=String(ctx.session&&ctx.session.organizationId||'');
if(!actor||!organizationId)throw new Error('无法确认当前生产员工及组织');
let sourceIds;try{sourceIds=JSON.parse(String(ctx.input.source_line_ids_json||''))}catch{throw new Error('缺料来源格式无效')}
if(!Array.isArray(sourceIds)||!sourceIds.length||sourceIds.length>100)throw new Error('请选择1至100条有效缺料明细');
sourceIds=sourceIds.map(value=>String(value||'').trim());
if(sourceIds.some(value=>!value)||new Set(sourceIds).size!==sourceIds.length)throw new Error('缺料来源包含空项或重复项');
const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;
const lineRows=[],ordersById=new Map(),groups=new Map();
for(const lineId of sourceIds){
  const line=await ctx.api.object('forge_assembly_material_line').findOne({where:{id:lineId}});
  if(!line)throw new Error('部分缺料明细已不存在或不可访问，请刷新后重试');
  let order=ordersById.get(line.assembly_id);
  if(!order){order=await ctx.api.object('forge_assembly_order').findOne({where:{id:line.assembly_id}});ordersById.set(line.assembly_id,order);}
  if(!order||order.status!=='waiting_pick')throw new Error('缺料来源组装单已变化，请刷新后重试');
  if(order.owner_id!==actor&&order.responsible_id!==actor)throw new Error('只能为本人负责的组装单生成采购申请');
  if(String(order.organization_id||'')!==organizationId)throw new Error('缺料来源组装单不属于当前组织');
  if(!String(order.code||'').trim())throw new Error('缺料来源组装单缺少可追溯编号');
  const shortage=round4(Number(line.shortage_quantity||0));
  if(!(shortage>0))throw new Error('所选缺料已补齐或数量发生变化，请刷新后重试');
  const sku=line.sku_id?await ctx.api.object('forge_material_sku').findOne({where:{id:line.sku_id}}):null;
  if(line.sku_id&&!sku)throw new Error('缺料来源规格不存在或不可访问');
  if(sku&&line.material_id&&sku.material_id!==line.material_id)throw new Error('缺料来源物料与规格不匹配');
  const material=line.material_id?await ctx.api.object('forge_material').findOne({where:{id:line.material_id}}):sku&&sku.material_id?await ctx.api.object('forge_material').findOne({where:{id:sku.material_id}}):null;
  if(!material||String(material.organization_id||'')!==organizationId||material.status==='inactive')throw new Error('缺料物料不存在、已停用或不属于当前组织');
  if(sku&&(sku.enabled===false||String(sku.organization_id||'')!==organizationId))throw new Error('缺料规格已停用或不属于当前组织');
  const itemCode=String(line.item_code||material.code||'').trim(),name=String(line.name||material.name||'').trim(),model=String(line.model||material.model||'').trim(),specification=String(line.specification||sku&&sku.name||'').trim(),unitName=String(line.unit_name||'件').trim();
  if(!name||!unitName||(!sku&&(!itemCode||!model||!specification)))throw new Error('缺料来源缺少可采购的物料名称、规格或单位');
  const unitCost=Number(line.unit_cost==null?(sku&&sku.cost_price||0):line.unit_cost);
  if(!Number.isFinite(unitCost)||unitCost<0)throw new Error('缺料来源预计单价无效');
  const key=[sku&&sku.id||'',material.id,itemCode,model,specification,unitName].join('|');
  let row=groups.get(key);
  if(!row){row={name,itemCode,model,specification,unitName,skuId:sku&&sku.id||null,materialId:material.id,categoryName:sku?'':'生产缺料',quantity:0,amount:0,sourceCodes:new Set()};groups.set(key,row);}
  row.quantity=round4(row.quantity+shortage);row.amount=round4(row.amount+shortage*unitCost);row.sourceCodes.add(order.code);
  lineRows.push({line,order,shortage});
}
const groupRows=[...groups.values()];
if(!groupRows.length)throw new Error('没有可采购的缺料项');
const assemblyCodes=[...new Set(lineRows.map(x=>x.order.code))].sort(),sourceText=assemblyCodes.join('、');
const requestLines=groupRows.map(row=>({
  name:row.name,entry_mode:row.skuId?'library':'manual',sku_id:row.skuId,item_code:row.itemCode,model:row.model,
  specification:row.specification,category_name:row.categoryName,unit_name:row.unitName,quantity:row.quantity,
  taxed_unit_price:row.quantity>0?round4(row.amount/row.quantity):0,tax_rate:13,taxed_subtotal:row.amount,
  expected_arrival_on:null,remarks:'由缺料待办生成；来源组装单：'+[...row.sourceCodes].sort().join('、'),
}));
const today=new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10),completionDates=lineRows.map(x=>x.order.planned_completion_on).filter(Boolean).sort(),expected=completionDates[0]||today;
for(const line of requestLines)line.expected_arrival_on=expected;
const totalQuantity=round4(requestLines.reduce((sum,line)=>sum+Number(line.quantity||0),0)),totalAmount=round4(requestLines.reduce((sum,line)=>sum+Number(line.taxed_subtotal||0),0));
const allRequests=await ctx.api.object('forge_purchase_request').find({where:{organization_id:organizationId}}),head='PR-'+today.slice(0,4)+'-';
let max=0;for(const row of allRequests){const code=String(row.code||'');if(code.slice(0,head.length)!==head)continue;const tail=Number(code.slice(head.length));if(Number.isFinite(tail)&&tail>max)max=tail;}
const code=head+String(max+1).padStart(4,'0'),sourceRemark=('由缺料待办生成；来源组装单：'+sourceText+'；物料缺口：'+groupRows.map(row=>(row.itemCode||row.name)+'×'+row.quantity).sort().join('、')).slice(0,3500);
if(allRequests.some(row=>['draft','pending_approval','approved'].includes(row.status)&&row.remarks===sourceRemark))throw new Error('这些组装单已生成采购申请，请先核对现有申请');
return await ctx.api.transaction(async()=>{
  const duplicate=await ctx.api.object('forge_purchase_request').find({where:{organization_id:organizationId,code}});if(duplicate.length)throw new Error('采购申请编号已存在，请刷新后重试');
  const saved=await ctx.api.object('forge_purchase_request').insert({name:'生产缺料采购申请 · '+assemblyCodes.length+' 张组装单',code,owner_id:actor,priority:'high',responsible_id:actor,currency:'cny',request_on:today,expected_arrival_on:expected,purchase_reason:'生产组装缺料',line_count:requestLines.length,total_quantity:totalQuantity,estimated_taxed_amount:totalAmount,status:'draft',remarks:sourceRemark});
  const requestId=typeof saved==='string'?saved:saved&&(saved.id||(saved.record&&saved.record.id));if(!requestId)throw new Error('采购申请创建后未返回记录ID');
  for(const line of requestLines)await ctx.api.object('forge_purchase_request_line').insert({...line,request_id:requestId});
  return{id:requestId,code,status:'draft',line_count:requestLines.length,total_quantity:totalQuantity,estimated_taxed_amount:totalAmount,source_assembly_codes:assemblyCodes};
});
` },
});

/** Expose this organization's todo queue only to authenticated procurement operators. */
export const PurchaseTodoPoolRead = defineAction({
  name: 'purchase_todo_pool_read',
  label: '读取采购待办',
  objectName: 'forge_purchase_pending_item',
  requiredPermissions: ['forge_procurement_operator'],
  locations: [],
  body: { language: 'js', capabilities: ['api.read'], source: `
const actor=ctx.session&&ctx.session.userId,organizationId=String(ctx.session&&ctx.session.organizationId||'');
if(!actor||!organizationId)throw new Error('无法确认当前采购经办人及组织');
const rows=await ctx.api.object('forge_purchase_pending_item').find({where:{organization_id:organizationId}});
const queueStatuses=['ready','assigned','inquiring','partially_ordered','on_hold'];
return{actor_id:actor,records:rows.filter(row=>String(row.organization_id||'')===organizationId&&(queueStatuses.includes(row.status)||row.responsible_id===actor))};
` },
});

/** Apply procurement todo mutations atomically after reloading their sources. */
export const PurchaseTodoPoolApply = defineAction({
  name: 'purchase_todo_pool_apply',
  label: '办理采购待办',
  objectName: 'forge_purchase_pending_item',
  requiredPermissions: ['forge_procurement_operator'],
  locations: [],
  refreshAfter: true,
  params: [
    { name: 'operation', label: '操作', type: 'select', required: true, options: [
      { value: 'order', label: '创建采购订单' }, { value: 'assign', label: '指定供应商' },
      { value: 'hold', label: '暂缓' }, { value: 'close', label: '关闭' },
    ] },
    { name: 'item_ids_json', label: '采购待办', type: 'textarea', required: true },
    { name: 'supplier_id', label: '供应商' }, { name: 'warehouse_id', label: '目标仓库' },
    { name: 'expected_arrival_on', label: '期望到货日期' }, { name: 'payment_term', label: '付款条件' },
    { name: 'payment_method', label: '付款方式' }, { name: 'code', label: '采购订单号' },
    { name: 'reason', label: '办理原因' },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const actor=ctx.session&&ctx.session.userId,organizationId=String(ctx.session&&ctx.session.organizationId||''),operation=String(ctx.input.operation||'');
if(!actor||!organizationId)throw new Error('无法确认当前采购经办人及组织');
if(!['order','assign','hold','close'].includes(operation))throw new Error('采购待办操作无效');
let ids;try{ids=JSON.parse(String(ctx.input.item_ids_json||''))}catch{throw new Error('采购待办选择格式无效')}
if(!Array.isArray(ids)||!ids.length||ids.length>100)throw new Error('请选择1至100条采购待办');
ids=ids.map(value=>String(value||'').trim());if(ids.some(value=>!value)||new Set(ids).size!==ids.length)throw new Error('采购待办包含空项或重复项');
const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000,items=[],requestsById=new Map(),linesById=new Map();
for(const id of ids){
  const item=await ctx.api.object('forge_purchase_pending_item').findOne({where:{id}});
  if(!item||String(item.organization_id||'')!==organizationId)throw new Error('部分采购待办不存在或不属于当前组织');
  const permittedStatuses=operation==='assign'?['ready','assigned','inquiring','partially_ordered','on_hold']:operation==='close'?['ready','assigned','inquiring','partially_ordered','on_hold']:['ready','assigned','inquiring','partially_ordered'];
  if(!permittedStatuses.includes(item.status))throw new Error('所选采购待办状态已变化，请刷新后重试');
  const requestId=String(item.request_id||'');let request=requestsById.get(requestId);
  if(!request){request=await ctx.api.object('forge_purchase_request').findOne({where:{id:requestId}});requestsById.set(requestId,request);}
  if(!request||request.status!=='approved'||String(request.organization_id||'')!==organizationId)throw new Error('采购待办来源申请未获批准或不可访问');
  const applicantId=request.submitted_by||request.responsible_id;
  const sourceOwned=item.status==='ready'&&item.responsible_id===request.responsible_id;
  const claimedByActor=item.responsible_id===actor&&item.owner_id===actor;
  if((!sourceOwned&&!claimedByActor)||item.applicant_id!==applicantId)throw new Error('采购待办已由其他经办人认领，或与来源申请归属不匹配');
  let line=linesById.get(item.request_line_id);
  if(!line){line=await ctx.api.object('forge_purchase_request_line').findOne({where:{id:item.request_line_id}});linesById.set(item.request_line_id,line);}
  if(!line||line.request_id!==requestId)throw new Error('采购待办来源申请明细不匹配');
  const requested=Number(item.requested_quantity),locked=Number(item.locked_quantity||0),ordered=Number(item.ordered_quantity||0),remaining=round4(requested-locked-ordered),storedRemaining=round4(Number(item.remaining_quantity||0));
  if(!(requested>0)||locked<0||ordered<0||Math.abs(requested-Number(line.quantity||0))>0.0001||Math.abs(remaining-storedRemaining)>0.0001)throw new Error('采购待办数量与来源申请不一致，请先核对');
  if(!(remaining>0))throw new Error('采购待办没有剩余可下单数量');
  items.push({item,request,line,remaining});
}
const ensureCurrent=async()=>{
  const rows=await ctx.api.object('forge_purchase_pending_item').find({where:{organization_id:organizationId}}),byId=new Map(rows.map(row=>[row.id,row]));
  for(const snapshot of items){
    const current=byId.get(snapshot.item.id);
    if(!current||current.organization_id!==snapshot.item.organization_id||current.responsible_id!==snapshot.item.responsible_id||current.applicant_id!==snapshot.item.applicant_id||current.request_id!==snapshot.item.request_id||current.request_line_id!==snapshot.item.request_line_id||current.status!==snapshot.item.status||Math.abs(Number(current.requested_quantity||0)-Number(snapshot.item.requested_quantity||0))>0.0001||Math.abs(Number(current.locked_quantity||0)-Number(snapshot.item.locked_quantity||0))>0.0001||Math.abs(Number(current.ordered_quantity||0)-Number(snapshot.item.ordered_quantity||0))>0.0001||Math.abs(Number(current.remaining_quantity||0)-Number(snapshot.item.remaining_quantity||0))>0.0001)throw new Error('采购待办已被其他操作更新，请刷新后重试');
    const request=await ctx.api.object('forge_purchase_request').findOne({where:{id:snapshot.request.id}}),line=await ctx.api.object('forge_purchase_request_line').findOne({where:{id:snapshot.line.id}});
    if(!request||request.status!=='approved'||String(request.organization_id||'')!==organizationId||!line||line.request_id!==request.id||Math.abs(Number(line.quantity||0)-Number(snapshot.line.quantity||0))>0.0001)throw new Error('采购待办来源申请或明细已变化，请刷新后重试');
    const applicantId=request.submitted_by||request.responsible_id,sourceOwned=current.status==='ready'&&current.responsible_id===request.responsible_id,claimedByActor=current.responsible_id===actor&&current.owner_id===actor;
    if((!sourceOwned&&!claimedByActor)||current.applicant_id!==applicantId)throw new Error('采购待办已由其他经办人认领，或与来源申请归属不匹配');
  }
};
if(operation==='assign'||operation==='order'){
  const supplier=await ctx.api.object('forge_supplier').findOne({where:{id:ctx.input.supplier_id}});
  if(!supplier||String(supplier.organization_id||'')!==organizationId||supplier.status!=='active'||supplier.approval_status!=='approved')throw new Error('供应商必须属于当前组织、启用且已审批');
  if(operation==='assign')return await ctx.api.transaction(async()=>{
    await ensureCurrent();
    const currentSupplier=await ctx.api.object('forge_supplier').findOne({where:{id:supplier.id}});if(!currentSupplier||String(currentSupplier.organization_id||'')!==organizationId||currentSupplier.status!=='active'||currentSupplier.approval_status!=='approved')throw new Error('供应商状态已变化，请刷新后重试');
    for(const row of items)await ctx.api.object('forge_purchase_pending_item').update({id:row.item.id,owner_id:actor,responsible_id:actor,assigned_supplier_id:supplier.id,status:'assigned'});
    return{operation:'assign',count:items.length,message:'已为 '+items.length+' 条采购待办指定供应商'};
  });
}
if(operation==='hold'||operation==='close'){
  const reason=String(ctx.input.reason||'').trim();if(!reason)throw new Error(operation==='hold'?'请填写暂缓原因':'请填写关闭原因');
  return await ctx.api.transaction(async()=>{
    await ensureCurrent();
    for(const row of items)await ctx.api.object('forge_purchase_pending_item').update({id:row.item.id,owner_id:actor,responsible_id:actor,status:operation==='hold'?'on_hold':'closed',remaining_quantity:operation==='close'?0:row.item.remaining_quantity,remarks:reason});
    return{operation,count:items.length,message:operation==='hold'?'已暂缓 '+items.length+' 条采购待办':'已关闭 '+items.length+' 条采购待办'};
  });
}
const requestIds=[...new Set(items.map(row=>row.request.id))];if(requestIds.length!==1)throw new Error('一次批量下单只能选择同一采购申请中的待办');
const supplierId=String(ctx.input.supplier_id||''),warehouseId=String(ctx.input.warehouse_id||''),expected=String(ctx.input.expected_arrival_on||''),paymentTerm=String(ctx.input.payment_term||'').trim(),paymentMethod=String(ctx.input.payment_method||'').trim();
if(!supplierId||!warehouseId||!expected||!paymentTerm)throw new Error('供应商、目标仓库、到货日期和付款条件不能为空');
if(!['bank_transfer','wire_transfer','bank_acceptance','online_payment','cash','other'].includes(paymentMethod))throw new Error('付款方式无效');
const warehouse=await ctx.api.object('forge_warehouse').findOne({where:{id:warehouseId}});if(!warehouse||String(warehouse.organization_id||'')!==organizationId)throw new Error('目标仓库不存在或不属于当前组织');
const request=items[0].request,prepared=[];
for(const row of items){
  const sku=row.line.sku_id?await ctx.api.object('forge_material_sku').findOne({where:{id:row.line.sku_id}}):null;
  if(!sku||sku.enabled===false||String(sku.organization_id||'')!==organizationId)throw new Error('采购申请包含未关联或已停用物料规格，不能建单');
  const material=sku.material_id?await ctx.api.object('forge_material').findOne({where:{id:sku.material_id}}):null;
  if(!material||material.status==='inactive'||String(material.organization_id||'')!==organizationId)throw new Error('采购申请物料不存在、已停用或不属于当前组织');
  const unitPrice=Number(row.line.taxed_unit_price||0),taxRate=Number(row.line.tax_rate||0);
  if(!Number.isFinite(unitPrice)||unitPrice<0||!Number.isFinite(taxRate)||taxRate<0||taxRate>100)throw new Error('采购申请明细价格或税率无效');
  prepared.push({row,sku,material,unitPrice,taxRate,subtotal:round4(row.remaining*unitPrice)});
}
let orderCode=String(ctx.input.code||'').trim();
if(!orderCode){const allOrders=await ctx.api.object('forge_purchase_order').find({where:{organization_id:organizationId}}),head='PO-'+expected.slice(0,4)+'-';let max=0;for(const row of allOrders){const text=String(row.code||'');if(text.slice(0,head.length)!==head)continue;const tail=Number(text.slice(head.length));if(Number.isFinite(tail)&&tail>max)max=tail;}orderCode=head+String(max+1).padStart(4,'0');}
if(orderCode.length>80)throw new Error('采购订单号过长');
const duplicates=await ctx.api.object('forge_purchase_order').find({where:{organization_id:organizationId,code:orderCode}});if(duplicates.length)throw new Error('采购订单号已存在，请刷新后重试');
const totalQuantity=round4(prepared.reduce((sum,x)=>sum+x.row.remaining,0)),totalAmount=round4(prepared.reduce((sum,x)=>sum+x.subtotal,0));
const today=new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10),now=new Date().toISOString();
return await ctx.api.transaction(async()=>{
  await ensureCurrent();
  const currentSupplier=await ctx.api.object('forge_supplier').findOne({where:{id:supplierId}});
  if(!currentSupplier||currentSupplier.status!=='active'||currentSupplier.approval_status!=='approved'||String(currentSupplier.organization_id||'')!==organizationId)throw new Error('供应商状态已变化，请刷新后重试');
  const currentWarehouse=await ctx.api.object('forge_warehouse').findOne({where:{id:warehouseId}});if(!currentWarehouse||String(currentWarehouse.organization_id||'')!==organizationId)throw new Error('目标仓库状态已变化，请刷新后重试');
  const duplicateInTransaction=await ctx.api.object('forge_purchase_order').find({where:{organization_id:organizationId,code:orderCode}});if(duplicateInTransaction.length)throw new Error('采购订单号已被使用，请刷新后重试');
  const saved=await ctx.api.object('forge_purchase_order').insert({name:items[0].request.name+' - 采购订单',code:orderCode,owner_id:actor,supplier_id:supplierId,source_type:'purchase_request',purchase_request_id:request.id,project_id:request.project_id||items[0].item.project_id||null,warehouse_id:warehouseId,expected_arrival_on:expected,order_on:today,payment_term:paymentTerm,payment_method:paymentMethod,currency:request.currency||'cny',exchange_rate:1,payable_trigger:'inbound',responsible_id:actor,line_count:prepared.length,total_quantity:totalQuantity,total_amount:totalAmount,arrived_quantity:0,inbound_quantity:0,returned_quantity:0,replenished_quantity:0,status:'draft',remarks:'由采购待办池创建'});
  const orderId=typeof saved==='string'?saved:saved&&(saved.id||(saved.record&&saved.record.id));if(!orderId)throw new Error('采购订单创建后未返回记录ID');
  for(const entry of prepared){const {row,sku,material,unitPrice,taxRate,subtotal}=entry;await ctx.api.object('forge_purchase_order_line').insert({name:row.item.name,order_id:orderId,owner_id:actor,purchase_request_line_id:row.line.id,sku_id:sku.id,item_code:row.item.item_code||material.code,model:row.item.model||material.model,specification:row.item.specification||sku.name,unit_name:row.item.unit_name||material.unit_name,quantity:row.remaining,arrived_quantity:0,inspected_quantity:0,accepted_quantity:0,inbound_quantity:0,taxed_unit_price:unitPrice,untaxed_unit_price:round4(unitPrice/(1+taxRate/100)),tax_rate:taxRate,taxed_subtotal:subtotal,expected_arrival_on:expected});await ctx.api.object('forge_purchase_pending_item').update({id:row.item.id,owner_id:actor,responsible_id:actor,assigned_supplier_id:supplierId,ordered_quantity:round4(Number(row.item.ordered_quantity||0)+row.remaining),remaining_quantity:0,status:'ordered'});}
  const remainingItems=await ctx.api.object('forge_purchase_pending_item').find({where:{request_id:request.id}});
  if(remainingItems.length&&remainingItems.every(row=>['ordered','closed'].includes(row.status)||Number(row.remaining_quantity||0)<=0))await ctx.api.object('forge_purchase_request').update({id:request.id,status:'converted'});
  return{id:orderId,code:orderCode,status:'draft',line_count:prepared.length,total_quantity:totalQuantity,total_amount:totalAmount,message:'采购订单草稿已创建：'+orderCode};
});
` },
});
