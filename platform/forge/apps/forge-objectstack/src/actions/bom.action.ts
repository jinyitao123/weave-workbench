import { defineAction } from '@objectstack/spec';

const locations = ['record_header', 'record_more'] as const;

export const BomDraftCreate = defineAction({
  name: 'bom_draft_create', label: '新建BOM草稿', objectName: 'forge_bom', icon: 'file-plus-2',
  requiredPermissions: ['forge_production_operator'], locations: [], refreshAfter: true,
  params: [{ name: 'draft_json', label: 'BOM草稿', type: 'textarea', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const actor=ctx.session&&ctx.session.userId,organizationId=String(ctx.session&&ctx.session.organizationId||'');
if(!actor||!organizationId)throw new Error('无法确认当前生产员工及组织');
let draft;try{draft=JSON.parse(String(ctx.input.draft_json||''))}catch{throw new Error('BOM草稿格式无效')}
if(!draft||typeof draft!=='object'||Array.isArray(draft))throw new Error('BOM草稿格式无效');
const name=String(draft.name||'').trim(),code=String(draft.code||'').trim(),type=String(draft.bom_type||'standard');
if(!name||!code||!draft.material_id)throw new Error('请填写BOM名称、编号和成品物料');
if(!['standard','project','trial'].includes(type))throw new Error('BOM类型无效');
if(type==='project'&&!draft.project_id)throw new Error('项目BOM须关联项目');
const material=await ctx.api.object('forge_material').findOne({where:{id:draft.material_id}});
if(!material||material.status==='inactive'||String(material.organization_id||'')!==organizationId)throw new Error('成品物料不可用或不属于当前组织');
if(draft.project_id){const project=await ctx.api.object('forge_project').findOne({where:{id:draft.project_id}});if(!project||String(project.organization_id||'')!==organizationId)throw new Error('关联项目不存在或不属于当前组织')}
const duplicate=await ctx.api.object('forge_bom').find({where:{code}});if(duplicate.length)throw new Error('BOM编号已存在');
return await ctx.api.transaction(async()=>{
  const created=await ctx.api.object('forge_bom').insert({name,code,owner_id:actor,material_id:material.id,product_name:String(draft.product_name||material.name).trim(),bom_type:type,project_id:draft.project_id||null,change_note:String(draft.change_note||'').trim()||null,status:'draft',version:'V1.0',node_count:0});
  const id=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!id)throw new Error('BOM创建后未返回记录');
  await ctx.api.object('forge_bom_node').insert({name:material.name,bom_id:id,owner_id:actor,parent_id:null,sku_id:null,node_type:'root',quantity:1,is_leaf:false,sort_order:0,bom_status:'draft'});
  return{id,status:'draft',node_count:0};
});
` },
});

export const BomAddComponent = defineAction({
  name: 'bom_add_component', label: '添加BOM物料', objectName: 'forge_bom', icon: 'list-plus',
  requiredPermissions: ['forge_production_operator'], locations: [...locations], refreshAfter: true,
  visible: `record.status == 'draft'`,
  params: [
    { field: 'sku_id', objectOverride: 'forge_bom_node', required: true },
    { field: 'quantity', objectOverride: 'forge_bom_node', required: true },
    { field: 'position', objectOverride: 'forge_bom_node' },
    { field: 'loss_rate', objectOverride: 'forge_bom_node' },
    { field: 'is_key_part', objectOverride: 'forge_bom_node' },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id),bom=ctx.record,actor=ctx.session&&ctx.session.userId;
if(ctx.recordLoadDenied===true||!id||!bom||!actor)throw new Error('当前BOM不存在或不可访问');
if(bom.status!=='draft'||bom.owner_id!==actor)throw new Error('仅BOM编制人可修改本人草稿');
const quantity=Number(ctx.input.quantity),loss=Number(ctx.input.loss_rate||0);
if(!(quantity>0)||!Number.isFinite(quantity)||loss<0||loss>100)throw new Error('单机用量或损耗率无效');
const sku=await ctx.api.object('forge_material_sku').findOne({where:{id:ctx.input.sku_id}});
const material=sku&&await ctx.api.object('forge_material').findOne({where:{id:sku.material_id}});
if(!sku||sku.enabled===false||!material||material.status==='inactive'||String(sku.organization_id||'')!==String(bom.organization_id||'')||String(material.organization_id||'')!==String(bom.organization_id||''))throw new Error('物料规格不可用或不属于当前组织');
if(material.id===bom.material_id)throw new Error('成品不能作为自身BOM子项');
const nodes=await ctx.api.object('forge_bom_node').find({where:{bom_id:id}}),roots=nodes.filter(node=>!node.parent_id);
if(roots.length!==1||roots[0].node_type!=='root')throw new Error('BOM根节点不完整');
const created=await ctx.api.object('forge_bom_node').insert({name:material.name,bom_id:id,owner_id:actor,parent_id:roots[0].id,sku_id:sku.id,node_type:'material',quantity,position:String(ctx.input.position||'').trim()||null,loss_rate:loss,is_key_part:ctx.input.is_key_part===true,is_leaf:true,sort_order:nodes.length,bom_status:'draft'});
const nodeId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));
if(!nodeId)throw new Error('BOM物料添加失败');
await ctx.api.object('forge_bom').update({id,node_count:nodes.length});
return{id:nodeId,bom_id:id,node_count:nodes.length};
` },
});

export const BomSubmitReview = defineAction({
  name: 'bom_submit_review', label: '提交评审', objectName: 'forge_bom', icon: 'send',
  requiredPermissions: ['forge_production_operator'],
  locations: [...locations], order: 10, visible: `record.status == 'draft'`, refreshAfter: true,
  description: '校验成品、根节点和物料明细，冻结成本快照后进入待评审。', successMessage: 'BOM已提交评审',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id); const bom=ctx.record,actor=ctx.session&&ctx.session.userId;
if(ctx.recordLoadDenied===true||!id||!bom) throw new Error('当前BOM不存在或不可访问');
if(!actor||bom.owner_id!==actor)throw new Error('仅BOM编制人可提交本人草稿');
if(bom.status!=='draft') throw new Error('仅草稿BOM可以提交评审');
if(!bom.material_id) throw new Error('提交评审前必须选择成品物料');
const nodes=await ctx.api.object('forge_bom_node').find({where:{bom_id:id}});
const roots=nodes.filter(node=>!node.parent_id);
if(roots.length!==1||roots[0].node_type!=='root') throw new Error('BOM必须且只能有一个根节点');
const components=nodes.filter(node=>node.parent_id);
if(!components.length) throw new Error('BOM至少需要一个物料子项');
let total=0;
for(const node of components){
  if(!node.sku_id) throw new Error('所有物料子项必须选择物料规格');
  if(Number(node.quantity)<=0) throw new Error('单机用量必须大于0');
  const sku=await ctx.api.object('forge_material_sku').findOne({where:{id:node.sku_id}});
  if(!sku||sku.enabled===false) throw new Error('BOM包含不存在或已停用的物料规格');
  total+=Number(sku.cost_price||0)*Number(node.quantity)*(1+Number(node.loss_rate||0)/100)/(1+Number(bom.tax_rate||13)/100);
}
const now=new Date().toISOString();
const cost=Math.round((total+Number.EPSILON)*100)/100;
await ctx.api.object('forge_bom').update({id,status:'pending_review',node_count:components.length,total_cost:cost,submitted_at:now,submitted_by:actor});
for(const node of nodes) await ctx.api.object('forge_bom_node').update({id:node.id,bom_status:'pending_review'});
await ctx.api.object('forge_bom_approval_log').insert({name:'提交评审',event_key:id+':submitted:'+Date.now(),bom_id:id,action:'submitted',actor_id:actor,occurred_at:now,from_status:'draft',to_status:'pending_review',comment:'结构与成本快照已冻结'});
return {id,status:'pending_review',node_count:components.length,total_cost:cost};
` },
});

export const BomReview = defineAction({
  name: 'bom_review', label: '评审BOM', objectName: 'forge_bom', icon: 'badge-check',
  requiredPermissions: ['forge_production_reviewer'],
  locations: [...locations], order: 10, visible: `record.status == 'pending_review'`, refreshAfter: true,
  params: [
    { name: 'decision', label: '评审结论', type: 'select', required: true, options: [{ label: '同意', value: 'approve' }, { label: '退回', value: 'reject' }] },
    { name: 'comment', label: '评审意见', type: 'textarea', required: true },
  ],
  successMessage: 'BOM评审已完成',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id); const bom=ctx.record;
if(ctx.recordLoadDenied===true||!id||!bom||bom.status!=='pending_review') throw new Error('仅待评审BOM可以评审');
if(!['approve','reject'].includes(ctx.input.decision)) throw new Error('评审结论不合法');
if(!ctx.input.comment||!String(ctx.input.comment).trim()) throw new Error('评审意见为必填');
const now=new Date().toISOString(); const actor=ctx.session&&ctx.session.userId;
if(!actor) throw new Error('无法识别当前操作人'); if(bom.owner_id===actor||bom.responsible_id===actor||bom.created_by===actor) throw new Error('BOM编制人不能复核本人版本');
const approved=ctx.input.decision==='approve'; const status=approved?'active':'draft';
const nodes=await ctx.api.object('forge_bom_node').find({where:{bom_id:id}});
await ctx.api.object('forge_bom').update({id,status,effective_at:approved?now:null,approved_by:approved?actor:null});
for(const node of nodes) await ctx.api.object('forge_bom_node').update({id:node.id,bom_status:status});
await ctx.api.object('forge_bom_approval_log').insert({name:approved?'评审通过':'评审退回',event_key:id+':review:'+Date.now(),bom_id:id,action:approved?'approved':'rejected',actor_id:actor,occurred_at:now,from_status:'pending_review',to_status:status,comment:String(ctx.input.comment).trim()});
return {id,status,effective_at:approved?now:null};
` },
});

export const BomCopyNewVersion = defineAction({
  name: 'bom_copy_new_version', label: '复制到新版本', objectName: 'forge_bom', icon: 'git-branch-plus',
  requiredPermissions: ['forge_production_operator'],
  locations: [...locations], order: 20, visible: `record.status == 'active'`, refreshAfter: true,
  params: [{ field: 'change_note', objectOverride: 'forge_bom', required: true }],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.supply-chain/forge_bom/record/${result.id}' }, successMessage: '新版本草稿已创建',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id); const bom=ctx.record;
if(ctx.recordLoadDenied===true||!id||!bom||bom.status!=='active') throw new Error('仅已生效BOM可以复制新版本');
if(!ctx.input.change_note||!String(ctx.input.change_note).trim()) throw new Error('版本变更说明为必填');
const match=/^V(\\d+)\\.(\\d+)$/.exec(bom.version||'V1.0'); const major=match?Number(match[1]):1; const minor=(match?Number(match[2]):0)+1;
const version='V'+major+'.'+minor; const actor=ctx.session&&ctx.session.userId; if(!actor) throw new Error('无法识别当前操作人');
const created=await ctx.api.object('forge_bom').insert({name:bom.name,code:bom.code+'-R'+minor,product_name:bom.product_name,material_id:bom.material_id,bom_type:bom.bom_type,
  version,family_key:bom.family_key||id,source_bom_id:id,project_id:bom.project_id||null,customer_id:bom.customer_id||null,status:'draft',tax_rate:Number(bom.tax_rate||13),node_count:bom.node_count,total_cost:bom.total_cost,change_note:String(ctx.input.change_note).trim(),remarks:bom.remarks||null});
const newId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id)); if(!newId) throw new Error('新版本创建后未返回记录ID');
const nodes=await ctx.api.object('forge_bom_node').find({where:{bom_id:id}}); const copied={}; let remaining=nodes.slice();
while(remaining.length){let moved=0; const next=[]; for(const node of remaining){if(!node.parent_id||copied[node.parent_id]){const row=await ctx.api.object('forge_bom_node').insert({name:node.name,bom_id:newId,parent_id:node.parent_id?copied[node.parent_id]:null,sku_id:node.sku_id||null,node_type:node.node_type,quantity:node.quantity,position:node.position||null,loss_rate:Number(node.loss_rate||0),is_key_part:node.is_key_part===true,is_leaf:node.is_leaf!==false,sort_order:Number(node.sort_order||0),bom_status:'draft',remarks:node.remarks||null}); const rowId=typeof row==='string'?row:row&&(row.id||(row.record&&row.record.id)); copied[node.id]=rowId; moved++;}else next.push(node);} if(!moved) throw new Error('BOM结构存在循环，无法复制'); remaining=next;}
const now=new Date().toISOString();
await ctx.api.object('forge_bom_approval_log').insert({name:'复制新版本 '+version,event_key:id+':copied:'+Date.now(),bom_id:id,action:'copied',actor_id:actor,occurred_at:now,from_status:'active',to_status:'active',comment:'创建草稿 '+version+'：'+String(ctx.input.change_note).trim()});
return {id:newId,source_bom_id:id,version,status:'draft',node_count:nodes.filter(node=>node.parent_id).length};
` },
});

export const BomCreateProjectVariant = defineAction({
  name: 'bom_create_project_variant', label: '从标准BOM创建项目BOM', objectName: 'forge_bom', icon: 'folder-git-2',
  requiredPermissions: ['forge_production_operator'],
  locations: [...locations], order: 30, visible: `record.status == 'active' && record.bom_type == 'standard'`, refreshAfter: true,
  params: [{ field: 'project_id', objectOverride: 'forge_bom', required: true }, { field: 'change_note', objectOverride: 'forge_bom' }],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.supply-chain/forge_bom/record/${result.id}' }, successMessage: '项目BOM草稿已创建',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id); const bom=ctx.record;
if(ctx.recordLoadDenied===true||!id||!bom||bom.status!=='active'||bom.bom_type!=='standard') throw new Error('仅已生效标准BOM可以派生项目BOM');
const project=await ctx.api.object('forge_project').findOne({where:{id:ctx.input.project_id}}); if(!project) throw new Error('适用项目不存在或不可访问');
const projectBoms=await ctx.api.object('forge_bom').find({where:{project_id:project.id,bom_type:'project'}}); const existing=projectBoms.filter(item=>!['inactive','archived'].includes(item.status)); if(existing.length) throw new Error('该项目已经存在有效或待处理的项目BOM');
const created=await ctx.api.object('forge_bom').insert({name:bom.name+' (项目BOM)',code:bom.code+'-'+project.code,product_name:bom.product_name,material_id:bom.material_id,bom_type:'project',version:'V1.0',family_key:project.id,
  source_bom_id:id,project_id:project.id,customer_id:project.customer_id,status:'draft',tax_rate:Number(bom.tax_rate||13),node_count:bom.node_count,total_cost:bom.total_cost,change_note:ctx.input.change_note||'派生自标准BOM',remarks:bom.remarks||null});
const newId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id)); if(!newId) throw new Error('项目BOM创建后未返回记录ID');
const nodes=await ctx.api.object('forge_bom_node').find({where:{bom_id:id}}); const copied={}; let remaining=nodes.slice();
while(remaining.length){let moved=0; const next=[]; for(const node of remaining){if(!node.parent_id||copied[node.parent_id]){const row=await ctx.api.object('forge_bom_node').insert({name:node.name,bom_id:newId,parent_id:node.parent_id?copied[node.parent_id]:null,sku_id:node.sku_id||null,node_type:node.node_type,quantity:node.quantity,position:node.position||null,loss_rate:Number(node.loss_rate||0),is_key_part:node.is_key_part===true,is_leaf:node.is_leaf!==false,sort_order:Number(node.sort_order||0),bom_status:'draft',remarks:node.remarks||null}); const rowId=typeof row==='string'?row:row&&(row.id||(row.record&&row.record.id)); copied[node.id]=rowId; moved++;}else next.push(node);} if(!moved) throw new Error('BOM结构存在循环，无法复制'); remaining=next;}
return {id:newId,source_bom_id:id,project_id:project.id,customer_id:project.customer_id,version:'V1.0',status:'draft',node_count:nodes.filter(node=>node.parent_id).length};
` },
});

export const BomInvalidate = defineAction({
  name: 'bom_invalidate', label: '失效', objectName: 'forge_bom', icon: 'ban',
  requiredPermissions: ['forge_production_reviewer'],
  locations: [...locations], order: 90, visible: `record.status == 'active'`, refreshAfter: true,
  params: [{ name: 'reason', label: '失效原因', type: 'textarea', required: true }], successMessage: 'BOM已失效',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id); const bom=ctx.record;
if(ctx.recordLoadDenied===true||!id||!bom||bom.status!=='active') throw new Error('仅已生效BOM可以失效');
if(!ctx.input.reason||!String(ctx.input.reason).trim()) throw new Error('失效原因为必填');
const now=new Date().toISOString(); const actor=ctx.session&&ctx.session.userId; if(!actor) throw new Error('无法识别当前操作人');
await ctx.api.object('forge_bom').update({id,status:'inactive',invalidated_at:now});
const nodes=await ctx.api.object('forge_bom_node').find({where:{bom_id:id}}); for(const node of nodes) await ctx.api.object('forge_bom_node').update({id:node.id,bom_status:'inactive'});
await ctx.api.object('forge_bom_approval_log').insert({name:'BOM失效',event_key:id+':invalidated:'+Date.now(),bom_id:id,action:'invalidated',actor_id:actor,occurred_at:now,from_status:'active',to_status:'inactive',comment:String(ctx.input.reason).trim()});
return {id,status:'inactive',invalidated_at:now};
` },
});
