import { defineAction } from '@objectstack/spec';

/**
 * Uploads one already committed ObjectStack storage file to the project loaded
 * by the native Action route. Generic attachment CRUD is not used by the page.
 */
export const ProjectAttachmentCreate = defineAction({
  name: 'project_attachment_create',
  label: '上传项目附件',
  objectName: 'forge_project',
  icon: 'paperclip',
  locations: [],
  refreshAfter: true,
  params: [
    { name: 'file_id', label: '已上传文件', type: 'text', required: true },
    { name: 'category', label: '资料分类', type: 'select', required: true, options: [
      { label: '合同资料', value: 'contract' },
      { label: '技术资料', value: 'technical' },
      { label: '交付资料', value: 'delivery' },
      { label: '其他资料', value: 'other' },
    ] },
    { name: 'remarks', label: '备注', type: 'textarea' },
  ],
  body: {
    language: 'js',
    capabilities: ['api.read', 'api.write', 'api.transaction'],
    source: `
const projectId=String(ctx.recordId||ctx.record&&ctx.record.id||'').trim(),actor=String(ctx.session&&ctx.session.userId||'').trim(),organizationId=String(ctx.session&&ctx.session.organizationId||ctx.user&&ctx.user.organizationId||'').trim(),project=ctx.record||{},permissions=Array.isArray(ctx.user&&ctx.user.systemPermissions)?ctx.user.systemPermissions:[];
if(ctx.recordLoadDenied===true||!projectId||!project.id||String(project.id)!==projectId||!actor||!organizationId||String(project.organization_id||'')!==organizationId)throw new Error('当前项目不存在或不可访问');
if(!permissions.includes('forge_project_work_member')&&!permissions.includes('forge_project_manager'))throw new Error('当前账号没有项目附件上传权限');
const fileId=String(ctx.input.file_id||'').trim(),category=String(ctx.input.category||'other').trim(),remarks=String(ctx.input.remarks||'').trim();
if(!fileId)throw new Error('请选择已上传的文件');
if(!['contract','technical','delivery','other'].includes(category))throw new Error('资料分类无效');
if(remarks.length>5000)throw new Error('备注不能超过 5000 个字符');
const files=ctx.api.object('sys_file'),attachments=ctx.api.object('forge_project_attachment'),now=new Date().toISOString();
return await ctx.api.transaction(async()=>{
  const file=await files.findOne({where:{id:fileId}});
  if(!file||file.status!=='committed'||String(file.owner_id||'')!==actor||String(file.organization_id||'')!==organizationId)throw new Error('文件尚未上传完成，或不属于当前员工及组织');
  if(file.ref_id!=null||file.ref_object!=null||file.ref_field!=null) {
    if(file.ref_object==='forge_project_attachment'&&String(file.ref_field||'')==='attachment') {
      const linked=await attachments.findOne({where:{id:String(file.ref_id),project_id:projectId,organization_id:organizationId}});
      if(linked&&String(linked.uploaded_by||'')===actor&&String(linked.attachment_key||'').trim())return{id:linked.id,attachment_key:linked.attachment_key,name:linked.name,replayed:true};
    }
    throw new Error('该文件已关联其他业务记录，不能重复使用');
  }
  const name=String(file.name||'').trim();
  if(!name||name.length>255)throw new Error('文件名称无效');
  const created=await attachments.insert({
    name,project_id:projectId,attachment:fileId,category,
    uploaded_by:actor,uploaded_at:now,remarks:remarks||null,organization_id:organizationId,
  });
  const id=typeof created==='string'?created:created&&(created.id||created.record&&created.record.id);
  if(!id)throw new Error('项目附件保存后没有返回记录标识');
  const saved=await attachments.findOne({where:{id,project_id:projectId,organization_id:organizationId}});
  const held=await files.findOne({where:{id:fileId}});
  if(!saved||String(saved.uploaded_by||'')!==actor||String(saved.project_id||'')!==projectId||!saved.attachment_key)throw new Error('项目附件保存结果尚未确认，请重试');
  if(!held||held.ref_object!=='forge_project_attachment'||String(held.ref_id||'')!==String(id)||held.ref_field!=='attachment')throw new Error('ObjectStack 尚未确认项目附件文件归属，已取消本次保存');
  return{id,attachment_key:saved.attachment_key,name:saved.name,replayed:false};
});
`,
  },
});
