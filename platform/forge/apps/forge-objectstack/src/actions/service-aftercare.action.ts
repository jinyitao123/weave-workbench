import { defineAction } from '@objectstack/spec';

const actionLocations = ['record_header', 'record_more'] as const;

const repairIdentity = `
const actor=String(ctx.session&&ctx.session.userId||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(!actor||!organizationId)throw new Error('无法确认当前报修处理员工及组织');
const repairs=ctx.api.object('forge_repair_request');
`;

export const ServiceRepairRequestCreate = defineAction({
  name: 'service_repair_request_create', label: '提交一般报修', objectName: 'forge_repair_request', icon: 'wrench',
  locations: [], requiredPermissions: ['forge_service_operator'], refreshAfter: true,
  params: [
    { name: 'draft_json', label: '报修信息', type: 'textarea', required: true },
    { name: 'idempotency_key', label: '请求幂等键', type: 'text', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
${repairIdentity}
let draft;try{draft=JSON.parse(String(ctx.input.draft_json||''))}catch{throw new Error('报修信息格式无效')}
if(!draft||typeof draft!=='object'||Array.isArray(draft))throw new Error('报修信息格式无效');
const refId=value=>{const row=Array.isArray(value)?value[0]:value;return String(typeof row==='string'?row:row&&(row.id||row.value||row._id)||'').trim()};
const source=String(draft.source||'一般报修').trim(),impact=String(draft.impact||'').trim(),site=String(draft.site||'').trim(),productName=String(draft.product_name||'').trim(),productSn=String(draft.product_sn||'').trim(),problem=String(draft.problem||'').trim(),contactName=String(draft.contact_name||'').trim(),contactPhone=String(draft.contact_phone||'').trim(),customerId=refId(draft.customer_id),remarks=String(draft.remarks||'').trim(),key=String(ctx.input.idempotency_key||'').trim();
if(!source||source.length>255)throw new Error('请填写有效报修来源');
if(!problem)throw new Error('请填写问题描述');
if(!contactPhone&&!contactName)throw new Error('请填写联系人或联系方式');
if(!key||key.length>128)throw new Error('提交请求缺少幂等标识');
const signature=JSON.stringify({source,impact,site,productName,productSn,problem,contactName,contactPhone,customerId,remarks});
return await ctx.api.transaction(async()=>{
  const previous=await repairs.findOne({where:{organization_id:organizationId,request_key:key}});
  if(previous){if(previous.request_signature!==signature)throw new Error('同一报修请求标识已用于不同内容');return{id:previous.id,code:previous.code,status:previous.status,repeated:true};}
  let customer=null;
  if(customerId){
    customer=await ctx.api.object('forge_customer').findOne({where:{id:customerId,organization_id:organizationId}});
    if(!customer||String(customer.organization_id||'')!==organizationId||customer.status==='inactive')throw new Error('所选客户不存在、已停用或不属于当前组织');
    const isOwner=String(customer.owner_id||'')===actor||String(customer.responsible_id||'')===actor;
    const teamMember=isOwner?null:await ctx.api.object('forge_customer_team_member').findOne({where:{customer_id:customerId,user_id:actor,organization_id:organizationId,active:true}});
    if(!isOwner&&!teamMember)throw new Error('当前员工只能关联本人可访问的客户');
  }
  const now=new Date().toISOString();
  const created=await repairs.insert({name:problem.slice(0,255),source,impact:impact||null,site:site||null,product_name:productName||null,product_sn:productSn||null,problem,customer_id:customer&&customer.id||null,contact_name:contactName||null,contact_phone:contactPhone||null,reported_at:now,reported_by:actor,status:'pending',responsible_id:actor,request_key:key,request_signature:signature,revision:1,remarks:remarks||null,owner_id:actor,organization_id:organizationId});
  const id=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));
  if(!id)throw new Error('报修记录创建后未返回记录标识');
  const saved=await repairs.findOne({where:{id,organization_id:organizationId}}),code=String(saved&&saved.code||'');
  if(!code)throw new Error('报修单号生成后未能读回');
  return{id,code,status:'pending',repeated:false};
});
` },
});

export const ServiceRepairRequestMarkDuplicate = defineAction({
  name: 'service_repair_request_mark_duplicate', label: '标记重复上报', objectName: 'forge_repair_request', icon: 'copy-check',
  locations: [...actionLocations], requiredPermissions: ['forge_service_manager'], refreshAfter: true,
  visible: `record.status == 'pending'`,
  params: [
    { name: 'expected_revision', label: '读取修订号', type: 'number', required: true },
    { name: 'note', label: '重复说明', type: 'textarea', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
${repairIdentity}
const id=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim(),expected=Number(ctx.input.expected_revision),note=String(ctx.input.note||'').trim();
if(ctx.recordLoadDenied===true||!id)throw new Error('当前报修记录不存在或不可访问');
if(!Number.isInteger(expected)||expected<1||!note||note.length>2000)throw new Error('请填写有效修订号和重复说明');
return await ctx.api.transaction(async()=>{
  const current=await repairs.findOne({where:{id,organization_id:organizationId}});
  if(!current||String(current.organization_id||'')!==organizationId)throw new Error('报修记录不存在或不属于当前组织');
  const revision=Number(current.revision||1);
  if(current.status!=='pending'||revision!==expected)throw new Error('报修记录已变化，请刷新后重试');
  const changed=await repairs.update({status:'duplicate',revision:revision+1,remarks:[current.remarks,note].filter(Boolean).join('；')},{multi:true,where:{id,organization_id:organizationId,status:'pending',revision:current.revision==null?null:revision}});
  if(changed!==1)throw new Error('报修记录已变化，请刷新后重试');
  return{id,status:'duplicate',revision:revision+1};
});
` },
});

export const ServiceRepairRequestConvertToOrder = defineAction({
  name: 'service_repair_request_convert_to_order', label: '转服务工单', objectName: 'forge_repair_request', icon: 'arrow-right-circle',
  locations: [...actionLocations], requiredPermissions: ['forge_service_manager'], refreshAfter: true,
  visible: `record.status == 'pending'`,
  params: [
    { name: 'customer_id', label: '客户', type: 'text', required: true },
    { name: 'contact_id', label: '联系人', type: 'text' },
    { name: 'service_type', label: '服务类型', type: 'text' },
    { name: 'service_mode', label: '服务方式', type: 'text', required: true },
    { name: 'urgency', label: '紧急度', type: 'text', required: true },
    { name: 'expected_revision', label: '读取修订号', type: 'number', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
${repairIdentity}
const id=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim(),expected=Number(ctx.input.expected_revision),refId=value=>{const row=Array.isArray(value)?value[0]:value;return String(typeof row==='string'?row:row&&(row.id||row.value||row._id)||'').trim();},customerId=refId(ctx.input.customer_id),contactId=refId(ctx.input.contact_id),serviceType=String(ctx.input.service_type||'').trim(),serviceMode=String(ctx.input.service_mode||'onsite').trim(),urgency=String(ctx.input.urgency||'medium').trim();
if(ctx.recordLoadDenied===true||!id)throw new Error('当前报修记录不存在或不可访问');
if(!Number.isInteger(expected)||expected<1)throw new Error('读取修订号无效，请刷新后重试');
if(!['onsite','remote','return_repair'].includes(serviceMode)||!['low','medium','high','urgent'].includes(urgency))throw new Error('服务方式或紧急度无效');
return await ctx.api.transaction(async()=>{
  const current=await repairs.findOne({where:{id,organization_id:organizationId}});
  if(!current||String(current.organization_id||'')!==organizationId)throw new Error('报修记录不存在或不属于当前组织');
  if(current.status==='converted'&&current.service_order_id){
    const existingOrder=await ctx.api.object('forge_service_order').findOne({where:{id:current.service_order_id,organization_id:organizationId}});
    if(!existingOrder)throw new Error('报修记录已转工单，但关联工单无法从当前组织读回');
    return{id,service_order_id:existingOrder.id,status:'converted',repeated:true};
  }
  const revision=Number(current.revision||1);
  if(current.status!=='pending'||revision!==expected)throw new Error('报修记录已变化，请刷新后重试');
  const customer=await ctx.api.object('forge_customer').findOne({where:{id:customerId,organization_id:organizationId}});
  if(!customer||String(customer.organization_id||'')!==organizationId||customer.status==='inactive')throw new Error('请选择当前组织内启用客户');
  let contact=null;
  if(contactId){contact=await ctx.api.object('forge_contact').findOne({where:{id:contactId,organization_id:organizationId}});if(!contact||String(contact.organization_id||'')!==organizationId||String(contact.customer_id||'')!==String(customer.id))throw new Error('所选联系人不属于当前客户');}
  if(current.customer_id&&String(current.customer_id)!==String(customer.id))throw new Error('所选客户与报修记录关联客户不一致');
  const now=new Date().toISOString(),code='SR-'+String(current.code||id);
  const created=await ctx.api.object('forge_service_order').insert({name:current.name,code,owner_id:actor,responsible_id:actor,customer_id:customer.id,contact_id:contact&&contact.id||null,contact_phone:current.contact_phone||null,service_object:current.product_name||current.product_sn||null,service_type:serviceType||null,service_mode:serviceMode,urgency,status:'pending_acceptance',revision:1,region:current.site||null,service_address:current.site||null,fault_symptom:current.problem||null,impact_scope:current.impact||null,submitted_at:now,next_step:'受理',repair_request_id:id,organization_id:organizationId});
  const serviceOrderId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));
  if(!serviceOrderId)throw new Error('服务工单创建后未返回记录标识');
  const changed=await repairs.update({status:'converted',service_order_id:serviceOrderId,revision:revision+1,responsible_id:actor},{multi:true,where:{id,organization_id:organizationId,status:'pending',revision:current.revision==null?null:revision}});
  if(changed!==1)throw new Error('报修记录已变化，请刷新后重试');
  return{id,service_order_id:serviceOrderId,status:'converted',revision:revision+1};
});
` },
});

const partActionPrefix = `
const id=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim();
const actor=String(ctx.session&&ctx.session.userId||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(ctx.recordLoadDenied===true||!id)throw new Error('当前备件工单不存在或不可访问');
if(!actor||!organizationId)throw new Error('无法确认当前服务员工及组织');
const requests=ctx.api.object('forge_service_part_request'),events=ctx.api.object('forge_service_part_request_event');
const expected=Number(ctx.input.expected_revision),eventKey=String(ctx.input.idempotency_key||'').trim(),comment=String(ctx.input.note||'').trim();
if(!Number.isInteger(expected)||expected<1)throw new Error('读取修订号无效，请刷新后重试');
if(!eventKey||eventKey.length>128)throw new Error('执行请求缺少幂等标识');
const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;
function versionWhere(row){const time=Date.parse(String(row&&row.updated_at||''));if(!Number.isFinite(time))throw new Error('库存余额读取版本无效，请刷新后重试');return{updated_at:{$gte:new Date(time).toISOString(),$lt:new Date(time+1).toISOString()}};}
function nextCode(request,type,revision){return String(request.code||id)+'-SVC-'+type+'-'+String(revision).padStart(3,'0');}
async function loadRequest(){const row=await requests.findOne({where:{id,organization_id:organizationId}});if(!row||String(row.organization_id||'')!==organizationId)throw new Error('备件工单不存在或不属于当前组织');return row;}
async function repeated(type,quantityValue){const old=await events.findOne({where:{request_id:id,event_key:eventKey,organization_id:organizationId}});if(!old)return null;if(old.event_type!==type||Number(old.quantity||0)!==Number(quantityValue||0)||String(old.comment||'')!==comment)throw new Error('该执行幂等键已用于另一项操作');return{id,status:old.to_status,repeated:true,event_id:old.id,inventory_ledger_id:old.inventory_ledger_id||null,inventory_ledger_code:old.inventory_ledger_code||null};}
async function recordEvent(request,type,from,to,quantityValue,ledgerId,ledgerCode){const created=await events.insert({name:String(request.code||id)+' '+type,request_id:id,event_type:type,event_key:eventKey,quantity:Number(quantityValue||0),from_status:from,to_status:to,inventory_ledger_id:ledgerId||null,inventory_ledger_code:ledgerCode||null,comment:comment||null,occurred_at:new Date().toISOString(),operator_id:actor,organization_id:organizationId});return typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id))||null;}
`;

export const ServicePartRequestCreate = defineAction({
  name: 'service_part_request_create', label: '新建备件工单', objectName: 'forge_service_part_request', icon: 'package-plus',
  locations: [], requiredPermissions: ['forge_service_operator'], refreshAfter: true,
  params: [
    { name: 'draft_json', label: '备件申请内容', type: 'textarea', required: true },
    { name: 'idempotency_key', label: '请求幂等键', type: 'text', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const actor=String(ctx.session&&ctx.session.userId||'').trim(),organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(!actor||!organizationId)throw new Error('无法确认当前服务员工及组织');
let draft;try{draft=JSON.parse(String(ctx.input.draft_json||''))}catch{throw new Error('备件申请内容格式无效')}
if(!draft||typeof draft!=='object'||Array.isArray(draft))throw new Error('备件申请内容格式无效');
const refId=value=>{const row=Array.isArray(value)?value[0]:value;return String(typeof row==='string'?row:row&&(row.id||row.value||row._id)||'').trim()};
const name=String(draft.name||'').trim(),serviceOrderId=refId(draft.service_order_id),skuId=refId(draft.sku_id),warehouseId=refId(draft.warehouse_id),quantity=Number(draft.requested_quantity),requestOn=String(draft.request_on||'').trim(),remarks=String(draft.remarks||'').trim(),key=String(ctx.input.idempotency_key||'').trim();
if(!name||!serviceOrderId||!skuId||!warehouseId||!Number.isFinite(quantity)||!(quantity>0)||!/^\\d{4}-\\d{2}-\\d{2}$/.test(requestOn)||!key||key.length>128)throw new Error('请填写备件工单、来源服务工单、备件、仓库、申请数量和日期');
const signature=JSON.stringify({name,serviceOrderId,skuId,warehouseId,quantity,requestOn,remarks});
return await ctx.api.transaction(async()=>{
  const requests=ctx.api.object('forge_service_part_request');
  const prior=await requests.findOne({where:{organization_id:organizationId,request_key:key}});
  if(prior){if(prior.request_signature!==signature)throw new Error('同一幂等键已用于不同备件申请');return{id:prior.id,code:prior.code,status:prior.status,execution_status:prior.execution_status,repeated:true};}
  const [order,sku,warehouse]=await Promise.all([
    ctx.api.object('forge_service_order').findOne({where:{id:serviceOrderId,organization_id:organizationId}}),
    ctx.api.object('forge_material_sku').findOne({where:{id:skuId,organization_id:organizationId}}),
    ctx.api.object('forge_warehouse').findOne({where:{id:warehouseId,organization_id:organizationId}}),
  ]);
  if(!order||String(order.organization_id||'')!==organizationId||!['pending_receive','in_progress'].includes(order.status)||String(order.engineer_id||'')!==actor||String(order.owner_id||'')!==actor||String(order.responsible_id||'')!==actor)throw new Error('备件申请必须关联指派给当前员工且未完工的服务工单');
  if(!sku||String(sku.organization_id||'')!==organizationId||sku.enabled===false)throw new Error('备件规格不存在、已停用或不属于当前组织');
  const material=sku.material_id?await ctx.api.object('forge_material').findOne({where:{id:sku.material_id,organization_id:organizationId}}):null;
  if(!material||String(material.organization_id||'')!==organizationId||material.status==='inactive')throw new Error('备件对应物料不存在、已停用或不属于当前组织');
  if(!warehouse||String(warehouse.organization_id||'')!==organizationId)throw new Error('出库仓库不存在或不属于当前组织');
  const created=await requests.insert({name,service_order_id:order.id,sku_id:sku.id,warehouse_id:warehouse.id,requested_quantity:quantity,issued_quantity:0,received_quantity:0,used_quantity:0,returned_quantity:0,request_on:requestOn,requested_by:actor,engineer_id:actor,status:'open',execution_status:'pending_outbound',request_key:key,request_signature:signature,revision:1,remarks:remarks||null,owner_id:actor,organization_id:organizationId});
  const id=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));
  if(!id)throw new Error('备件工单创建后未返回记录标识');
  const saved=await requests.findOne({where:{id,organization_id:organizationId}}),code=String(saved&&saved.code||'');
  if(!code)throw new Error('备件工单编号生成后未能读回');
  return{id,code,status:'open',execution_status:'pending_outbound',repeated:false};
});
` },
});

export const ServicePartRequestOutbound = defineAction({
  name: 'service_part_request_outbound', label: '执行出库', objectName: 'forge_service_part_request', icon: 'package-open',
  locations: [...actionLocations], requiredPermissions: ['forge_warehouse_operator'], refreshAfter: true,
  visible: `record.execution_status == 'pending_outbound'`,
  params: [
    { name: 'quantity', label: '出库数量', type: 'number', required: true },
    { name: 'expected_revision', label: '读取修订号', type: 'number', required: true },
    { name: 'idempotency_key', label: '请求幂等键', type: 'text', required: true },
    { name: 'note', label: '出库说明', type: 'textarea' },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
${partActionPrefix}
const quantity=Number(ctx.input.quantity);if(!Number.isFinite(quantity)||!(quantity>0))throw new Error('出库数量必须大于0');
return await ctx.api.transaction(async()=>{
  const prior=await repeated('outbound',quantity);if(prior)return prior;
  const current=await loadRequest();if(current.status!=='open'||current.execution_status!=='pending_outbound'||Number(current.revision||1)!==expected)throw new Error('备件工单已变化，请刷新后重试');
  if(quantity>Number(current.requested_quantity||0))throw new Error('出库数量不能超过申请数量');
  const [sku,warehouse]=await Promise.all([
    ctx.api.object('forge_material_sku').findOne({where:{id:current.sku_id,organization_id:organizationId}}),
    ctx.api.object('forge_warehouse').findOne({where:{id:current.warehouse_id,organization_id:organizationId}}),
  ]);
  if(!sku||String(sku.organization_id||'')!==organizationId||sku.enabled===false||!warehouse||String(warehouse.organization_id||'')!==organizationId)throw new Error('备件规格或出库仓库已失效或不属于当前组织');
  const material=sku.material_id?await ctx.api.object('forge_material').findOne({where:{id:sku.material_id,organization_id:organizationId}}):null;
  if(!material||String(material.organization_id||'')!==organizationId||material.status==='inactive')throw new Error('备件对应物料已失效或不属于当前组织');
  const key=String(current.warehouse_id)+':'+String(current.sku_id),balances=await ctx.api.object('forge_inventory_balance').find({where:{balance_key:key,organization_id:organizationId}});
  if(balances.length!==1)throw new Error('当前仓库与备件没有唯一库存余额');
  const balance=balances[0];if(String(balance.organization_id||'')!==organizationId)throw new Error('库存余额不属于当前组织');
  const onHand=Number(balance.on_hand_quantity||0),available=Number(balance.available_quantity||0),reserved=Number(balance.reserved_quantity||0),unitCost=Number(balance.average_cost||0),amount=round4(quantity*unitCost);
  if(available<quantity||onHand<quantity)throw new Error('当前可用库存不足，不能出库');
  const after=round4(onHand-quantity),afterAvailable=round4(after-reserved),afterValue=Math.max(0,round4(Number(balance.inventory_value||0)-amount)),now=new Date().toISOString();
  const balanceChanged=await ctx.api.object('forge_inventory_balance').update({on_hand_quantity:after,available_quantity:afterAvailable,inventory_value:afterValue,last_movement_at:now},{multi:true,where:{id:balance.id,organization_id:organizationId,balance_key:key,...versionWhere(balance)}});
  if(balanceChanged!==1)throw new Error('库存余额已被其他操作修改，请刷新后重试');
  const ledgerCode=nextCode(current,'OUT',expected),ledger=await ctx.api.object('forge_inventory_ledger').insert({name:String(current.code)+' 服务备件出库',code:ledgerCode,warehouse_id:current.warehouse_id,sku_id:current.sku_id,direction:'outbound',movement_type:'other_outbound',quantity,before_on_hand:onHand,after_on_hand:after,before_available:available,after_available:afterAvailable,unit_cost:unitCost,amount,occurred_at:now,source_object:'forge_service_part_request',source_id:id,responsible_id:actor,remarks:comment||'服务备件出库'});
  const ledgerId=typeof ledger==='string'?ledger:ledger&&(ledger.id||(ledger.record&&ledger.record.id));
  const nextRevision=Number(current.revision||1)+1;
  const changed=await requests.update({issued_quantity:quantity,inventory_issue_ledger_id:ledgerId||null,execution_status:'outbounded',last_event_at:now,revision:nextRevision},{multi:true,where:{id,organization_id:organizationId,status:'open',execution_status:'pending_outbound',revision:current.revision==null?null:Number(current.revision||1)}});
  if(changed!==1)throw new Error('备件工单已被其他操作修改，请刷新后重试');
  const eventId=await recordEvent(current,'outbound','pending_outbound','outbounded',quantity,ledgerId,ledgerCode);
  return{id,status:'open',execution_status:'outbounded',issued_quantity:quantity,inventory_movement_quantity:quantity,event_id:eventId,inventory_ledger_id:ledgerId,inventory_ledger_code:ledgerCode,revision:nextRevision};
});
` },
});

export const ServicePartRequestReceive = defineAction({
  name: 'service_part_request_receive', label: '确认收货', objectName: 'forge_service_part_request', icon: 'package-check',
  locations: [...actionLocations], requiredPermissions: ['forge_service_operator'], refreshAfter: true,
  visible: `record.execution_status == 'outbounded'`,
  params: [
    { name: 'quantity', label: '实际收货数量', type: 'number', required: true },
    { name: 'expected_revision', label: '读取修订号', type: 'number', required: true },
    { name: 'idempotency_key', label: '请求幂等键', type: 'text', required: true },
    { name: 'note', label: '收货说明', type: 'textarea' },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
${partActionPrefix}
const quantity=Number(ctx.input.quantity);if(!Number.isFinite(quantity)||!(quantity>0))throw new Error('实际收货数量必须大于0');
return await ctx.api.transaction(async()=>{
  const prior=await repeated('receive',quantity);if(prior)return prior;
  const current=await loadRequest();if(current.status!=='open'||current.execution_status!=='outbounded'||Number(current.revision||1)!==expected)throw new Error('备件工单已变化，请刷新后重试');
  if(String(current.engineer_id||'')!==actor)throw new Error('只有当前指派的服务工程师可以确认备件收货');
  if(quantity>Number(current.issued_quantity||0))throw new Error('收货数量不能超过出库数量');
  const discrepancy=quantity!==Number(current.issued_quantity||0);
  if(discrepancy&&!comment)throw new Error('收货数量与出库数量不一致，请填写差异说明');
  const next=discrepancy?'exception':'received',now=new Date().toISOString(),nextRevision=Number(current.revision||1)+1;
  const changed=await requests.update({received_quantity:quantity,execution_status:next,exception_previous_status:discrepancy?'outbounded':null,exception_reason:discrepancy?comment:null,last_event_at:now,revision:nextRevision},{multi:true,where:{id,organization_id:organizationId,status:'open',execution_status:'outbounded',revision:current.revision==null?null:Number(current.revision||1)}});
  if(changed!==1)throw new Error('备件工单已被其他操作修改，请刷新后重试');
  const eventId=await recordEvent(current,'receive','outbounded',next,quantity,null,null);
  return{id,status:'open',execution_status:next,received_quantity:quantity,event_id:eventId,revision:nextRevision};
});
` },
});

export const ServicePartRequestRecordUse = defineAction({
  name: 'service_part_request_record_use', label: '登记备件使用', objectName: 'forge_service_part_request', icon: 'wrench',
  locations: [...actionLocations], requiredPermissions: ['forge_service_operator'], refreshAfter: true,
  visible: `record.execution_status == 'received' || record.execution_status == 'partially_used'`,
  params: [
    { name: 'quantity', label: '本次使用数量', type: 'number', required: true },
    { name: 'expected_revision', label: '读取修订号', type: 'number', required: true },
    { name: 'idempotency_key', label: '请求幂等键', type: 'text', required: true },
    { name: 'note', label: '使用说明', type: 'textarea', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
${partActionPrefix}
const quantity=Number(ctx.input.quantity);if(!Number.isFinite(quantity)||!(quantity>0)||!comment)throw new Error('请填写有效使用数量和使用说明');
return await ctx.api.transaction(async()=>{
  const prior=await repeated('use',quantity);if(prior)return prior;
  const current=await loadRequest();if(current.status!=='open'||!['received','partially_used'].includes(current.execution_status)||Number(current.revision||1)!==expected)throw new Error('备件工单已变化，请刷新后重试');
  if(String(current.engineer_id||'')!==actor)throw new Error('只有当前指派的服务工程师可以登记备件使用');
  const remaining=round4(Number(current.received_quantity||0)-Number(current.used_quantity||0)-Number(current.returned_quantity||0));
  if(quantity>remaining)throw new Error('本次使用数量超过尚未使用或退库的数量');
  const used=round4(Number(current.used_quantity||0)+quantity),settled=round4(used+Number(current.returned_quantity||0)),complete=settled>=Number(current.received_quantity||0),next=complete?'used':'partially_used',nextStatus=complete?'completed':'open',now=new Date().toISOString(),nextRevision=Number(current.revision||1)+1;
  const changed=await requests.update({used_quantity:used,status:nextStatus,execution_status:next,last_event_at:now,revision:nextRevision},{multi:true,where:{id,organization_id:organizationId,status:'open',execution_status:current.execution_status,revision:current.revision==null?null:Number(current.revision||1)}});
  if(changed!==1)throw new Error('备件工单已被其他操作修改，请刷新后重试');
  const eventId=await recordEvent(current,'use',current.execution_status,next,quantity,null,null);
  return{id,status:nextStatus,execution_status:next,used_quantity:used,event_id:eventId,revision:nextRevision};
});
` },
});

export const ServicePartRequestReturn = defineAction({
  name: 'service_part_request_return', label: '执行退库', objectName: 'forge_service_part_request', icon: 'undo-2',
  locations: [...actionLocations], requiredPermissions: ['forge_warehouse_operator'], refreshAfter: true,
  visible: `record.execution_status == 'received' || record.execution_status == 'partially_used'`,
  params: [
    { name: 'quantity', label: '本次退库数量', type: 'number', required: true },
    { name: 'expected_revision', label: '读取修订号', type: 'number', required: true },
    { name: 'idempotency_key', label: '请求幂等键', type: 'text', required: true },
    { name: 'note', label: '退库说明', type: 'textarea', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
${partActionPrefix}
const quantity=Number(ctx.input.quantity);if(!Number.isFinite(quantity)||!(quantity>0)||!comment)throw new Error('请填写有效退库数量和说明');
return await ctx.api.transaction(async()=>{
  const prior=await repeated('return',quantity);if(prior)return prior;
  const current=await loadRequest();if(current.status!=='open'||!['received','partially_used'].includes(current.execution_status)||Number(current.revision||1)!==expected)throw new Error('备件工单已变化，请刷新后重试');
  const remaining=round4(Number(current.received_quantity||0)-Number(current.used_quantity||0)-Number(current.returned_quantity||0));
  if(quantity>remaining)throw new Error('退库数量超过尚未使用或退库的数量');
  const key=String(current.warehouse_id)+':'+String(current.sku_id),balances=await ctx.api.object('forge_inventory_balance').find({where:{balance_key:key,organization_id:organizationId}});
  if(balances.length!==1)throw new Error('当前仓库与备件没有唯一库存余额');
  const balance=balances[0];if(String(balance.organization_id||'')!==organizationId)throw new Error('库存余额不属于当前组织');
  const onHand=Number(balance.on_hand_quantity||0),reserved=Number(balance.reserved_quantity||0),available=Number(balance.available_quantity||0),unitCost=Number(balance.average_cost||0),amount=round4(quantity*unitCost),after=round4(onHand+quantity),afterAvailable=round4(after-reserved),afterValue=round4(Number(balance.inventory_value||0)+amount),average=after>0?round4(afterValue/after):0,now=new Date().toISOString();
  const balanceChanged=await ctx.api.object('forge_inventory_balance').update({on_hand_quantity:after,available_quantity:afterAvailable,inventory_value:afterValue,average_cost:average,last_movement_at:now},{multi:true,where:{id:balance.id,organization_id:organizationId,balance_key:key,...versionWhere(balance)}});
  if(balanceChanged!==1)throw new Error('库存余额已被其他操作修改，请刷新后重试');
  const ledgerCode=nextCode(current,'RETURN',expected),ledger=await ctx.api.object('forge_inventory_ledger').insert({name:String(current.code)+' 服务备件退库',code:ledgerCode,warehouse_id:current.warehouse_id,sku_id:current.sku_id,direction:'inbound',movement_type:'other_inbound',quantity,before_on_hand:onHand,after_on_hand:after,before_available:available,after_available:afterAvailable,unit_cost:unitCost,amount,occurred_at:now,source_object:'forge_service_part_request',source_id:id,responsible_id:actor,remarks:comment});
  const ledgerId=typeof ledger==='string'?ledger:ledger&&(ledger.id||(ledger.record&&ledger.record.id)),returned=round4(Number(current.returned_quantity||0)+quantity),used=Number(current.used_quantity||0),settled=round4(used+returned),complete=settled>=Number(current.received_quantity||0),next=complete?(used>0?'used':'returned'):(used>0?'partially_used':'received'),nextStatus=complete?'completed':'open',nextRevision=Number(current.revision||1)+1;
  const changed=await requests.update({returned_quantity:returned,status:nextStatus,execution_status:next,last_event_at:now,revision:nextRevision},{multi:true,where:{id,organization_id:organizationId,status:'open',execution_status:current.execution_status,revision:current.revision==null?null:Number(current.revision||1)}});
  if(changed!==1)throw new Error('备件工单已被其他操作修改，请刷新后重试');
  const eventId=await recordEvent(current,'return',current.execution_status,next,quantity,ledgerId,ledgerCode);
  return{id,status:nextStatus,execution_status:next,returned_quantity:returned,inventory_movement_quantity:quantity,event_id:eventId,inventory_ledger_id:ledgerId,inventory_ledger_code:ledgerCode,revision:nextRevision};
});
` },
});

export const ServicePartRequestMarkException = defineAction({
  name: 'service_part_request_mark_exception', label: '标记异常', objectName: 'forge_service_part_request', icon: 'triangle-alert',
  locations: [...actionLocations], requiredPermissions: ['forge_service_manager'], refreshAfter: true,
  visible: `record.status == 'open' && record.execution_status != 'exception'`,
  params: [
    { name: 'expected_revision', label: '读取修订号', type: 'number', required: true },
    { name: 'idempotency_key', label: '请求幂等键', type: 'text', required: true },
    { name: 'note', label: '异常说明', type: 'textarea', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
${partActionPrefix}
if(!comment||comment.length>2000)throw new Error('请填写异常说明');
return await ctx.api.transaction(async()=>{
  const prior=await repeated('exception',0);if(prior)return prior;
  const current=await loadRequest();if(current.status!=='open'||current.execution_status==='exception'||['used','returned'].includes(current.execution_status)||Number(current.revision||1)!==expected)throw new Error('当前备件工单状态不能标记异常');
  const now=new Date().toISOString(),nextRevision=Number(current.revision||1)+1;
  const changed=await requests.update({exception_previous_status:current.execution_status,exception_reason:comment,execution_status:'exception',last_event_at:now,revision:nextRevision},{multi:true,where:{id,organization_id:organizationId,status:'open',execution_status:current.execution_status,revision:current.revision==null?null:Number(current.revision||1)}});
  if(changed!==1)throw new Error('备件工单已被其他操作修改，请刷新后重试');
  const eventId=await recordEvent(current,'exception',current.execution_status,'exception',0,null,null);
  return{id,status:'open',execution_status:'exception',event_id:eventId,revision:nextRevision};
});
` },
});

export const ServicePartRequestResolveException = defineAction({
  name: 'service_part_request_resolve_exception', label: '恢复办理', objectName: 'forge_service_part_request', icon: 'rotate-ccw',
  locations: [...actionLocations], requiredPermissions: ['forge_service_manager'], refreshAfter: true,
  visible: `record.status == 'open' && record.execution_status == 'exception'`,
  params: [
    { name: 'expected_revision', label: '读取修订号', type: 'number', required: true },
    { name: 'idempotency_key', label: '请求幂等键', type: 'text', required: true },
    { name: 'note', label: '核对说明', type: 'textarea', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
${partActionPrefix}
if(!comment||comment.length>2000)throw new Error('请填写核对说明');
return await ctx.api.transaction(async()=>{
  const prior=await repeated('exception',0);if(prior)return prior;
  const current=await loadRequest(),previous=String(current.exception_previous_status||'');
  if(current.status!=='open'||current.execution_status!=='exception'||!['pending_outbound','outbounded','received','partially_used'].includes(previous)||Number(current.revision||1)!==expected)throw new Error('异常工单状态已变化，无法恢复办理');
  const now=new Date().toISOString(),nextRevision=Number(current.revision||1)+1;
  const changed=await requests.update({execution_status:previous,exception_previous_status:null,exception_reason:null,last_event_at:now,revision:nextRevision},{multi:true,where:{id,organization_id:organizationId,status:'open',execution_status:'exception',revision:current.revision==null?null:Number(current.revision||1)}});
  if(changed!==1)throw new Error('备件工单已被其他操作修改，请刷新后重试');
  const eventId=await recordEvent(current,'exception','exception',previous,0,null,null);
  return{id,status:'open',execution_status:previous,event_id:eventId,revision:nextRevision};
});
` },
});
