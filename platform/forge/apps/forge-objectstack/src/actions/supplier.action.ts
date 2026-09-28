import { defineAction } from '@objectstack/spec';

const locations = ['record_header', 'record_more'] as const;

export const SupplierSaveDraft = defineAction({
  name: 'supplier_save_draft', label: '保存供应商草稿', objectName: 'forge_supplier', icon: 'file-plus-2',
  requiredPermissions: ['forge_procurement_operator'], locations: [], refreshAfter: true,
  params: [{ name: 'draft_json', label: '供应商资料', type: 'textarea', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const actor=ctx.session&&ctx.session.userId,organizationId=String(ctx.session&&ctx.session.organizationId||'');
if(!actor||!organizationId)throw new Error('无法确认当前采购员工及组织');
let draft;try{draft=JSON.parse(String(ctx.input.draft_json||''))}catch{throw new Error('供应商资料格式无效')}
if(!draft||typeof draft!=='object'||Array.isArray(draft))throw new Error('供应商资料格式无效');
const name=String(draft.name||'').trim(),code=String(draft.code||'').trim(),contact=String(draft.contact_name||'').trim(),phone=String(draft.phone||'').trim();
if(!name||!draft.category_id||!draft.level_id||!contact||!phone)throw new Error('供应商名称、分类、级别、联系人和联系电话必须完整');
if(draft.status&&draft.status!=='active')throw new Error('新供应商只能保存为启用草稿，停用由主管办理');
for(const [object,id] of [['forge_supplier_category',draft.category_id],['forge_supplier_level',draft.level_id]]){
  const ref=await ctx.api.object(object).findOne({where:{id}});
  if(!ref||ref.status==='inactive'||String(ref.organization_id||'')!==organizationId)throw new Error('供应商分类或级别不存在、已停用或不属于当前组织');
}
const payload={name,code:code||null,category_id:draft.category_id,level_id:draft.level_id,contact_name:contact,phone,email:String(draft.email||'').trim()||null,supplier_type:String(draft.supplier_type||'').trim()||null,payment_term:String(draft.payment_term||'').trim()||null,address:String(draft.address||'').trim()||null,status:'active',owner_id:actor,responsible_id:actor};
const id=ctx.recordId||(ctx.record&&ctx.record.id);
if(id){
  if(ctx.recordLoadDenied===true||!ctx.record||!['draft','rejected'].includes(ctx.record.approval_status))throw new Error('仅本人未通过的供应商草稿可修改');
  if(ctx.record.owner_id!==actor&&ctx.record.responsible_id!==actor)throw new Error('仅供应商经办人可修改本人草稿');
  await ctx.api.object('forge_supplier').update({id,...payload,approval_status:'draft'});
  return{id,status:'draft'};
}
const saved=await ctx.api.object('forge_supplier').insert({...payload,approval_status:'draft'});
const createdId=typeof saved==='string'?saved:saved&&(saved.id||(saved.record&&saved.record.id));
if(!createdId)throw new Error('供应商保存后未返回记录');
return{id:createdId,status:'draft'};
` },
});

export const SupplierSubmitApproval = defineAction({
  name: 'supplier_submit_approval', label: '提交审批', objectName: 'forge_supplier', icon: 'send',
  requiredPermissions: ['forge_procurement_operator'],
  locations: [...locations], order: 10, visible: `record.approval_status == 'draft' || record.approval_status == 'rejected'`, refreshAfter: true,
  successMessage: '供应商已提交审批',
  body: { language: 'js', capabilities: ['api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id), supplier=ctx.record, actor=ctx.session&&ctx.session.userId;
if(ctx.recordLoadDenied===true||!id||!supplier) throw new Error('当前供应商不存在或不可访问');
if(!actor) throw new Error('无法识别当前操作人');
if(supplier.owner_id!==actor&&supplier.responsible_id!==actor)throw new Error('仅供应商经办人可提交本人草稿');
if(!['draft','rejected'].includes(supplier.approval_status)) throw new Error('供应商审批状态已变化，请刷新后重试');
if(!supplier.name||!supplier.category_id||!supplier.level_id||!supplier.contact_name||!supplier.phone) throw new Error('供应商名称、分类、级别、联系人和联系电话必须完整');
const now=new Date().toISOString();
await ctx.api.object('forge_supplier').update({id,approval_status:'pending_approval',approval_note:null,approved_by:null,approved_at:null});
await ctx.api.object('forge_supplier_approval_log').insert({name:supplier.name+' 提交审批',supplier_id:id,action:'submitted',from_status:supplier.approval_status,to_status:'pending_approval',comment:'提交审批',occurred_at:now,operator_id:actor});
return {id,status:'pending_approval'};
` },
});

export const SupplierReview = defineAction({
  name: 'supplier_review', label: '审批供应商', objectName: 'forge_supplier', icon: 'circle-check',
  requiredPermissions: ['forge_procurement_reviewer'],
  locations: [...locations], order: 20, visible: `record.approval_status == 'pending_approval'`, refreshAfter: true,
  params: [
    { name: 'decision', label: '审批结论', type: 'select', required: true, options: [{ value: 'approve', label: '同意' }, { value: 'reject', label: '驳回' }] },
    { name: 'comment', label: '审批意见', type: 'textarea', required: true },
  ],
  successMessage: '供应商审批已完成',
  body: { language: 'js', capabilities: ['api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id), supplier=ctx.record, actor=ctx.session&&ctx.session.userId;
if(ctx.recordLoadDenied===true||!id||!supplier) throw new Error('当前供应商不存在或不可访问');
if(!actor) throw new Error('无法识别当前操作人');
if(supplier.approval_status!=='pending_approval') throw new Error('供应商审批状态已变化，请刷新后重试');
if(supplier.owner_id===actor||supplier.responsible_id===actor||supplier.created_by===actor) throw new Error('供应商经办人不能审核本人提交的供应商');
const decision=ctx.input.decision, comment=String(ctx.input.comment||'').trim();
if(!['approve','reject'].includes(decision)||!comment) throw new Error('审批结论和审批意见不能为空');
const next=decision==='approve'?'approved':'rejected', action=decision==='approve'?'approved':'rejected', now=new Date().toISOString();
await ctx.api.object('forge_supplier').update({id,approval_status:next,approval_note:comment,approved_by:actor,approved_at:now});
await ctx.api.object('forge_supplier_approval_log').insert({name:supplier.name+' '+(decision==='approve'?'同意':'驳回'),supplier_id:id,action,from_status:'pending_approval',to_status:next,comment,occurred_at:now,operator_id:actor});
return {id,status:next};
` },
});
