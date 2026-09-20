import { defineAction } from '@objectstack/spec';

const locations = ['record_header', 'record_more'] as const;

export const BomSubmitReview = defineAction({
  name: 'bom_submit_review', label: '提交评审', objectName: 'forge_bom', icon: 'send',
  locations: [...locations], order: 10, visible: `record.status == 'draft'`, refreshAfter: true,
  description: '校验成品、根节点和物料明细，冻结成本快照后进入待评审。', successMessage: 'BOM已提交评审',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id); const bom=ctx.record;
if(ctx.recordLoadDenied===true||!id||!bom) throw new Error('当前BOM不存在或不可访问');
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
const now=new Date().toISOString(); const actor=ctx.session&&ctx.session.userId;
if(!actor) throw new Error('无法识别当前操作人');
const cost=Math.round((total+Number.EPSILON)*100)/100;
await ctx.api.object('forge_bom').update({id,status:'pending_review',node_count:components.length,total_cost:cost,submitted_at:now,submitted_by:actor});
for(const node of nodes) await ctx.api.object('forge_bom_node').update({id:node.id,bom_status:'pending_review'});
await ctx.api.object('forge_bom_approval_log').insert({name:'提交评审',event_key:id+':submitted:'+Date.now(),bom_id:id,action:'submitted',actor_id:actor,occurred_at:now,from_status:'draft',to_status:'pending_review',comment:'结构与成本快照已冻结'});
return {id,status:'pending_review',node_count:components.length,total_cost:cost};
` },
});

export const BomReview = defineAction({
  name: 'bom_review', label: '评审BOM', objectName: 'forge_bom', icon: 'badge-check',
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
if(!actor) throw new Error('无法识别当前操作人');
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
  locations: [...locations], order: 20, visible: `record.status == 'active'`, refreshAfter: true,
  params: [{ field: 'change_note', objectOverride: 'forge_bom', required: true }],
  onSuccess: { navigate: '/_console/apps/forge/forge_bom/record/${result.id}' }, successMessage: '新版本草稿已创建',
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
  locations: [...locations], order: 30, visible: `record.status == 'active' && record.bom_type == 'standard'`, refreshAfter: true,
  params: [{ field: 'project_id', objectOverride: 'forge_bom', required: true }, { field: 'change_note', objectOverride: 'forge_bom' }],
  onSuccess: { navigate: '/_console/apps/forge/forge_bom/record/${result.id}' }, successMessage: '项目BOM草稿已创建',
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
