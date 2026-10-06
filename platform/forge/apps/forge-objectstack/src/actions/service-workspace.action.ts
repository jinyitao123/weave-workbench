import { defineAction } from '@objectstack/spec';

const serviceConfigCategories = ['order_type', 'status_urgency', 'warranty_rule', 'sla_rule', 'fee_type', 'payment_template', 'service_staff', 'quotation_setting', 'customer_portal'];
const serviceConfigStatuses = ['active', 'inactive'];

const serviceConfigIdentity = `
const actor=String(ctx.session&&ctx.session.userId||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(!actor||!organizationId)throw new Error('无法确认当前服务配置维护人和组织');
const configs=ctx.api.object('forge_service_config_item');
`;

export const ServiceConfigCreate = defineAction({
  name: 'service_config_create', label: '新建服务配置', objectName: 'forge_service_config_item', icon: 'plus',
  locations: [], requiredPermissions: ['forge_service_manager'], refreshAfter: true,
  params: [{ name: 'draft_json', label: '服务配置内容', type: 'textarea', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
${serviceConfigIdentity}
let draft;try{draft=JSON.parse(String(ctx.input.draft_json||''))}catch{throw new Error('服务配置内容格式无效')}
const name=String(draft&&draft.name||'').trim(),code=String(draft&&draft.code||'').trim(),category=String(draft&&draft.category||'').trim(),status=String(draft&&draft.status||'active').trim(),description=String(draft&&draft.description||'').trim(),remarks=String(draft&&draft.remarks||'').trim();
if(!name||name.length>255||!code||code.length>100)throw new Error('请填写配置名称和编码');
if(!${JSON.stringify(serviceConfigCategories)}.includes(category))throw new Error('请选择有效的服务配置分类');
if(!${JSON.stringify(serviceConfigStatuses)}.includes(status))throw new Error('请选择有效的服务配置状态');
return await ctx.api.transaction(async()=>{
  const duplicate=await configs.findOne({where:{organization_id:organizationId,code}});
  if(duplicate)throw new Error('当前组织已存在相同配置编码');
  const created=await configs.insert({name,code,category,status,description,remarks,revision:1,owner_id:actor,organization_id:organizationId});
  const id=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));
  if(!id)throw new Error('服务配置创建后未返回记录标识');
  return{id,name,code,category,status,revision:1};
});
` },
});

export const ServiceConfigUpdate = defineAction({
  name: 'service_config_update', label: '编辑服务配置', objectName: 'forge_service_config_item', icon: 'pencil',
  locations: [], requiredPermissions: ['forge_service_manager'], refreshAfter: true,
  params: [
    { name: 'draft_json', label: '服务配置内容', type: 'textarea', required: true },
    { name: 'expected_revision', label: '读取修订号', type: 'number', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
${serviceConfigIdentity}
const id=String(ctx.recordId||ctx.input.id||'').trim();
if(ctx.recordLoadDenied===true||!id)throw new Error('当前服务配置不存在或不可访问');
let draft;try{draft=JSON.parse(String(ctx.input.draft_json||''))}catch{throw new Error('服务配置内容格式无效')}
const name=String(draft&&draft.name||'').trim(),code=String(draft&&draft.code||'').trim(),category=String(draft&&draft.category||'').trim(),status=String(draft&&draft.status||'active').trim(),description=String(draft&&draft.description||'').trim(),remarks=String(draft&&draft.remarks||'').trim();
if(!name||name.length>255||!code||code.length>100)throw new Error('请填写配置名称和编码');
if(!${JSON.stringify(serviceConfigCategories)}.includes(category))throw new Error('请选择有效的服务配置分类');
if(!${JSON.stringify(serviceConfigStatuses)}.includes(status))throw new Error('请选择有效的服务配置状态');
const expected=Number(ctx.input.expected_revision);
if(!Number.isInteger(expected)||expected<1)throw new Error('读取修订号无效，请刷新后重试');
return await ctx.api.transaction(async()=>{
  const current=await configs.findOne({where:{id,organization_id:organizationId}});
  if(!current||String(current.organization_id||'')!==organizationId)throw new Error('服务配置不存在或不属于当前组织');
  const revision=Number(current.revision||1);
  if(revision!==expected)throw new Error('服务配置已被其他操作修改，请刷新后重试');
  const duplicate=await configs.findOne({where:{organization_id:organizationId,code}});
  if(duplicate&&String(duplicate.id)!==id)throw new Error('当前组织已存在相同配置编码');
  const changed=await configs.update({name,code,category,status,description,remarks,revision:revision+1},{multi:true,where:{id,organization_id:organizationId,revision:current.revision==null?null:revision}});
  if(changed!==1)throw new Error('服务配置已被其他操作修改，请刷新后重试');
  return{id,name,code,category,status,revision:revision+1};
});
` },
});

export const ServiceConfigDeactivate = defineAction({
  name: 'service_config_deactivate', label: '停用服务配置', objectName: 'forge_service_config_item', icon: 'ban',
  locations: [], requiredPermissions: ['forge_service_manager'], refreshAfter: true,
  params: [{ name: 'expected_revision', label: '读取修订号', type: 'number', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
${serviceConfigIdentity}
const id=String(ctx.recordId||ctx.input.id||'').trim(),expected=Number(ctx.input.expected_revision);
if(ctx.recordLoadDenied===true||!id)throw new Error('当前服务配置不存在或不可访问');
if(!Number.isInteger(expected)||expected<1)throw new Error('读取修订号无效，请刷新后重试');
return await ctx.api.transaction(async()=>{
  const current=await configs.findOne({where:{id,organization_id:organizationId}});
  if(!current||String(current.organization_id||'')!==organizationId)throw new Error('服务配置不存在或不属于当前组织');
  if(current.status!=='active')throw new Error('只有启用状态的服务配置可以停用');
  const revision=Number(current.revision||1);
  if(revision!==expected)throw new Error('服务配置已被其他操作修改，请刷新后重试');
  const changed=await configs.update({status:'inactive',revision:revision+1},{multi:true,where:{id,organization_id:organizationId,status:'active',revision:current.revision==null?null:revision}});
  if(changed!==1)throw new Error('服务配置已被其他操作修改，请刷新后重试');
  return{id,status:'inactive',revision:revision+1};
});
` },
});

export const ServiceConfigDelete = defineAction({
  name: 'service_config_delete', label: '删除服务配置', objectName: 'forge_service_config_item', icon: 'trash-2',
  locations: [], requiredPermissions: ['forge_service_manager'], refreshAfter: true,
  params: [{ name: 'expected_revision', label: '读取修订号', type: 'number', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
${serviceConfigIdentity}
const id=String(ctx.recordId||ctx.input.id||'').trim(),expected=Number(ctx.input.expected_revision);
if(ctx.recordLoadDenied===true||!id)throw new Error('当前服务配置不存在或不可访问');
if(!Number.isInteger(expected)||expected<1)throw new Error('读取修订号无效，请刷新后重试');
return await ctx.api.transaction(async()=>{
  const current=await configs.findOne({where:{id,organization_id:organizationId}});
  if(!current||String(current.organization_id||'')!==organizationId)throw new Error('服务配置不存在或不属于当前组织');
  if(current.status!=='inactive')throw new Error('删除前请先停用服务配置');
  const revision=Number(current.revision||1);
  if(revision!==expected)throw new Error('服务配置已被其他操作修改，请刷新后重试');
  if(current.category==='order_type'){
    const references=await ctx.api.object('forge_service_order').find({where:{organization_id:organizationId,service_type:current.name}});
    if(references.length)throw new Error('该工单类型已被服务工单引用，不能删除');
  }
  const deleted=await configs.delete({where:{id,organization_id:organizationId,status:'inactive',revision:current.revision==null?null:revision}});
  if(deleted!==1)throw new Error('服务配置已被其他操作修改，请刷新后重试');
  return{id,deleted:true};
});
` },
});

const warrantyIdentity = `
const id=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim();
const actor=String(ctx.session&&ctx.session.userId||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(ctx.recordLoadDenied===true||!id||!ctx.record)throw new Error('当前质保卡不存在或不可访问');
if(!actor||!organizationId)throw new Error('无法确认当前服务员工及组织');
const warranties=ctx.api.object('forge_warranty_card');
const events=ctx.api.object('forge_warranty_card_event');
const datePattern=/^\\d{4}-\\d{2}-\\d{2}$/;
const validDate=value=>datePattern.test(String(value||''))&&!Number.isNaN(Date.parse(String(value)+'T00:00:00Z'));
const today=new Date().toISOString().slice(0,10);
const key=String(ctx.input.idempotency_key||'').trim();
if(!key||key.length>128)throw new Error('请求幂等键缺失，请重新提交');
`;

export const WarrantyCardActivate = defineAction({
  name: 'warranty_card_activate', label: '激活质保卡', objectName: 'forge_warranty_card', icon: 'shield-check',
  locations: [], requiredPermissions: ['forge_service_manager'], refreshAfter: true,
  params: [
    { name: 'starts_on', label: '开始日期', type: 'text', required: true },
    { name: 'ends_on', label: '到期日期', type: 'text', required: true },
    { name: 'expected_revision', label: '读取修订号', type: 'number', required: true },
    { name: 'idempotency_key', label: '请求幂等键', type: 'text', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
${warrantyIdentity}
const startsOn=String(ctx.input.starts_on||'').trim(),endsOn=String(ctx.input.ends_on||'').trim(),expected=Number(ctx.input.expected_revision);
if(!validDate(startsOn)||startsOn>today||!validDate(endsOn)||endsOn<=startsOn)throw new Error('质保开始日期须不晚于今天，到期日期须晚于开始日期');
if(!Number.isInteger(expected)||expected<1)throw new Error('读取修订号无效，请刷新后重试');
return await ctx.api.transaction(async()=>{
  const prior=await events.findOne({where:{warranty_id:id,idempotency_key:key,organization_id:organizationId}});
  if(prior){if(prior.event_type==='activated'&&prior.starts_on===startsOn&&prior.ends_on===endsOn)return{id,status:prior.next_status,starts_on:prior.starts_on,ends_on:prior.ends_on,repeated:true};throw new Error('该请求幂等键已用于另一项质保变更');}
  const current=await warranties.findOne({where:{id,organization_id:organizationId}});
  if(!current||String(current.organization_id||'')!==organizationId)throw new Error('质保卡不存在或不属于当前组织');
  if(current.status!=='pending_activation')throw new Error('只有待激活质保卡可以激活');
  const revision=Number(current.revision||1);
  if(revision!==expected)throw new Error('质保卡已被其他操作修改，请刷新后重试');
  const now=new Date().toISOString();
  const changed=await warranties.update({status:'active',starts_on:startsOn,ends_on:endsOn,activated_at:now,activated_by:actor,revision:revision+1},{multi:true,where:{id,organization_id:organizationId,status:'pending_activation',revision:current.revision==null?null:revision}});
  if(changed!==1)throw new Error('质保卡已被其他操作修改，请刷新后重试');
  await events.insert({name:'质保卡激活',warranty_id:id,event_type:'activated',idempotency_key:key,previous_status:current.status,next_status:'active',previous_starts_on:current.starts_on||null,starts_on:startsOn,previous_ends_on:current.ends_on||null,ends_on:endsOn,note:'激活质保卡',occurred_at:now,operator_id:actor,organization_id:organizationId});
  return{id,status:'active',starts_on:startsOn,ends_on:endsOn,revision:revision+1};
});
` },
});

export const WarrantyCardExtend = defineAction({
  name: 'warranty_card_extend', label: '延长质保', objectName: 'forge_warranty_card', icon: 'calendar-plus',
  locations: [], requiredPermissions: ['forge_service_manager'], refreshAfter: true,
  params: [
    { name: 'ends_on', label: '延长至', type: 'text', required: true },
    { name: 'note', label: '延保说明', type: 'textarea', required: true },
    { name: 'expected_revision', label: '读取修订号', type: 'number', required: true },
    { name: 'idempotency_key', label: '请求幂等键', type: 'text', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
${warrantyIdentity}
const endsOn=String(ctx.input.ends_on||'').trim(),note=String(ctx.input.note||'').trim(),expected=Number(ctx.input.expected_revision);
if(!validDate(endsOn)||endsOn<today)throw new Error('新的到期日期必须是今天或之后的有效日期');
if(!note||note.length>2000)throw new Error('请填写延保说明');
if(!Number.isInteger(expected)||expected<1)throw new Error('读取修订号无效，请刷新后重试');
return await ctx.api.transaction(async()=>{
  const prior=await events.findOne({where:{warranty_id:id,idempotency_key:key,organization_id:organizationId}});
  if(prior){if(prior.event_type==='extended'&&prior.ends_on===endsOn&&prior.note===note)return{id,status:prior.next_status,ends_on:prior.ends_on,repeated:true};throw new Error('该请求幂等键已用于另一项质保变更');}
  const current=await warranties.findOne({where:{id,organization_id:organizationId}});
  if(!current||String(current.organization_id||'')!==organizationId)throw new Error('质保卡不存在或不属于当前组织');
  if(!['active','grace_period','expired'].includes(current.status))throw new Error('当前质保卡状态不允许延保');
  if(!validDate(current.ends_on)||endsOn<=String(current.ends_on))throw new Error('延长后的到期日期必须晚于原到期日期');
  const revision=Number(current.revision||1);
  if(revision!==expected)throw new Error('质保卡已被其他操作修改，请刷新后重试');
  const now=new Date().toISOString();
  const changed=await warranties.update({status:'active',ends_on:endsOn,revision:revision+1},{multi:true,where:{id,organization_id:organizationId,status:current.status,ends_on:current.ends_on,revision:current.revision==null?null:revision}});
  if(changed!==1)throw new Error('质保卡已被其他操作修改，请刷新后重试');
  await events.insert({name:'质保卡延保',warranty_id:id,event_type:'extended',idempotency_key:key,previous_status:current.status,next_status:'active',previous_starts_on:current.starts_on||null,starts_on:current.starts_on||null,previous_ends_on:current.ends_on,ends_on:endsOn,note,occurred_at:now,operator_id:actor,organization_id:organizationId});
  return{id,status:'active',ends_on:endsOn,revision:revision+1};
});
` },
});

export const ServiceOrderAttachEvidence = defineAction({
  name: 'service_order_attach_evidence', label: '关联现场图片', objectName: 'forge_service_order', icon: 'paperclip',
  locations: [], requiredPermissions: ['forge_service_operator'], refreshAfter: true,
  params: [
    { name: 'file_ids', label: '已上传文件标识', type: 'textarea', required: true },
    { name: 'expected_updated_at', label: '读取时间', type: 'text', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim();
const actor=String(ctx.session&&ctx.session.userId||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(ctx.recordLoadDenied===true||!id||!ctx.record)throw new Error('当前服务工单不存在或不可访问');
if(!actor||!organizationId)throw new Error('无法确认当前服务员工及组织');
const expected=String(ctx.input.expected_updated_at||'').trim(),expectedTime=Date.parse(expected);
if(!expected||!Number.isFinite(expectedTime))throw new Error('服务工单读取版本无效，请刷新后重试');
let raw;try{raw=JSON.parse(String(ctx.input.file_ids||''))}catch{throw new Error('现场图片文件清单无效')}
const tokens=value=>Array.isArray(value)?value.flatMap(tokens):value&&typeof value==='object'?tokens(value.id||value.fileId):typeof value==='string'?[value.trim()]:[];
const fileIds=[...new Set(tokens(raw).filter(Boolean))];
if(!fileIds.length||fileIds.length>20)throw new Error('请关联 1 至 20 张现场图片');
const orders=ctx.api.object('forge_service_order'),files=ctx.api.object('sys_file');
return await ctx.api.transaction(async()=>{
  const current=await orders.findOne({where:{id,organization_id:organizationId}});
  if(!current||String(current.organization_id||'')!==organizationId)throw new Error('服务工单不存在或不属于当前组织');
  if(current.status!=='in_progress'||String(current.engineer_id||'')!==actor||String(current.owner_id||'')!==actor||String(current.responsible_id||'')!==actor)throw new Error('只有当前指派且正在服务中的工程师可以关联现场图片');
  const existing=tokens(current.onsite_evidence_attachments);
  const allAlreadyAttached=fileIds.every(fileId=>existing.includes(fileId));
  if(allAlreadyAttached){
    for(const fileId of fileIds){const file=await files.findOne({where:{id:fileId}});if(!file||file.ref_object!=='forge_service_order'||String(file.ref_id||'')!==id||file.ref_field!=='onsite_evidence_attachments')throw new Error('现场图片关联状态未确认，请刷新后核对');}
    return{id,attachment_count:existing.length,onsite_evidence_attachments:existing,repeated:true};
  }
  if(String(current.updated_at||'')!==expected)throw new Error('服务工单已被其他操作修改，请刷新后重试');
  const combined=[...new Set([...existing,...fileIds])];
  if(combined.length>20)throw new Error('工单现场图片最多保留 20 张');
  for(const fileId of fileIds){
    const file=await files.findOne({where:{id:fileId}});
    if(!file||file.status!=='committed'||String(file.owner_id||'')!==actor||String(file.organization_id||'')!==organizationId||!String(file.mime_type||'').toLowerCase().startsWith('image/'))throw new Error('现场图片尚未上传完成、类型无效或不属于当前员工及组织');
    if(file.ref_id!=null&&!(file.ref_object==='forge_service_order'&&String(file.ref_id)===id&&file.ref_field==='onsite_evidence_attachments'))throw new Error('现场图片已关联到其他业务记录');
  }
  const lower=new Date(expectedTime).toISOString(),upper=new Date(expectedTime+1).toISOString(),revision=Number(current.revision||1);
  const versionChanged=await orders.update({revision:revision+1},{multi:true,where:{id,organization_id:organizationId,status:'in_progress',engineer_id:actor,owner_id:actor,responsible_id:actor,revision:current.revision==null?null:revision,updated_at:{$gte:lower,$lt:upper}}});
  if(versionChanged!==1)throw new Error('服务工单已被其他操作修改，请刷新后重试');
  // File ownership is exclusive in ObjectStack 17.5. Use one by-id write so the
  // storage hook can claim each sys_file for this record field; predicate bulk
  // writes are deliberately refused by the native file-reference middleware.
  await orders.update({id,revision:revision+1,onsite_evidence_attachments:combined});
  const saved=await orders.findOne({where:{id,organization_id:organizationId}});
  if(!saved||tokens(saved.onsite_evidence_attachments).length!==combined.length)throw new Error('现场图片关联结果尚未确认，请刷新后核对');
  for(const fileId of combined){const file=await files.findOne({where:{id:fileId}});if(!file||file.ref_object!=='forge_service_order'||String(file.ref_id||'')!==id||file.ref_field!=='onsite_evidence_attachments')throw new Error('ObjectStack 尚未确认现场图片字段归属，请刷新后重试');}
  return{id,attachment_count:combined.length,onsite_evidence_attachments:tokens(saved.onsite_evidence_attachments),repeated:false};
});
` },
});
