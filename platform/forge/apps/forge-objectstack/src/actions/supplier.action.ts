import { defineAction } from '@objectstack/spec';

const locations = ['record_header', 'record_more'] as const;

export const SupplierSubmitApproval = defineAction({
  name: 'supplier_submit_approval', label: '提交审批', objectName: 'forge_supplier', icon: 'send',
  locations: [...locations], order: 10, visible: `record.approval_status == 'draft' || record.approval_status == 'rejected'`, refreshAfter: true,
  successMessage: '供应商已提交审批',
  body: { language: 'js', capabilities: ['api.write'], source: `
const id=ctx.recordId||(ctx.record&&ctx.record.id), supplier=ctx.record, actor=ctx.session&&ctx.session.userId;
if(ctx.recordLoadDenied===true||!id||!supplier) throw new Error('当前供应商不存在或不可访问');
if(!actor) throw new Error('无法识别当前操作人');
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
const decision=ctx.input.decision, comment=String(ctx.input.comment||'').trim();
if(!['approve','reject'].includes(decision)||!comment) throw new Error('审批结论和审批意见不能为空');
const next=decision==='approve'?'approved':'rejected', action=decision==='approve'?'approved':'rejected', now=new Date().toISOString();
await ctx.api.object('forge_supplier').update({id,approval_status:next,approval_note:comment,approved_by:actor,approved_at:now});
await ctx.api.object('forge_supplier_approval_log').insert({name:supplier.name+' '+(decision==='approve'?'同意':'驳回'),supplier_id:id,action,from_status:'pending_approval',to_status:next,comment,occurred_at:now,operator_id:actor});
return {id,status:next};
` },
});
