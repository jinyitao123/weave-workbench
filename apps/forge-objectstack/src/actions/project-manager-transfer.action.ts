import { defineAction } from '@objectstack/spec';

export const ProjectManagerTransfer = defineAction({
  name: 'project_manager_transfer',
  label: '变更项目负责人',
  objectName: 'forge_project',
  icon: 'user-round-cog',
  // The custom Project Center handoff dialog calls this authorized Action and
  // supplies the current row version; do not expose its carry-over token as a
  // native record-header dialog field.
  locations: [],
  order: 15,
  requiredPermissions: ['forge_project_operator'],
  refreshAfter: true,
  visible: `record.manager_id != null`,
  description: '变更项目负责人，并同步维护项目团队中的负责人关系。确认后，新负责人接管项目，原负责人关系保留为停用历史。',
  successMessage: '项目负责人已变更',
  params: [
    { name: 'manager_id', label: '新项目负责人', type: 'user', required: true },
    { name: 'updated_at', label: '当前项目版本', type: 'text', required: true, defaultFromRow: true, carryOver: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const actor=String((ctx.session&&ctx.session.userId)||(ctx.user&&ctx.user.id)||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
const projectId=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim();
if(ctx.recordLoadDenied===true||!projectId||!ctx.record)throw new Error('项目不存在或当前账号无权读取');
if(!actor||!organizationId)throw new Error('无法确认当前操作人和组织');
function epoch(value){if(value instanceof Date)return value.getTime();if(typeof value==='number')return value;return Date.parse(String(value||''));}
function updatedAtWhere(expected,current){const expectedText=String(expected||'').trim(),currentText=String(current||'').trim(),time=epoch(currentText);if(!expectedText||expectedText!==currentText||!Number.isFinite(time))throw new Error('项目资料已变化，请刷新后重新办理');return{updated_at:{$gte:new Date(time).toISOString(),$lt:new Date(time+1).toISOString()}};}
function displayName(user){return String(user.display_name||user.name||user.username||'项目成员').trim()||'项目成员';}
return await ctx.api.transaction(async()=>{
  const projects=ctx.api.object('forge_project'),members=ctx.api.object('forge_project_member');
  const project=await projects.findOne({where:{id:projectId,organization_id:organizationId},fields:['id','name','owner_id','manager_id','manager_name_snapshot','organization_id','updated_at']});
  if(!project||String(project.organization_id||'')!==organizationId)throw new Error('项目不存在或不属于当前组织');
  if(String(project.owner_id||'')!==actor&&String(project.manager_id||'')!==actor)throw new Error('仅项目所有者或当前项目经理可以变更负责人');
  const nextManagerId=String(ctx.input.manager_id||'').trim();
  if(!nextManagerId)throw new Error('请选择新的项目负责人');
  const versionWhere=updatedAtWhere(ctx.input.updated_at,project.updated_at);
  const managerRows=await members.find({where:{project_id:projectId,organization_id:organizationId,member_duty:'manager',active:true}});
  if(managerRows.length!==1||String(managerRows[0].user_id||'')!==String(project.manager_id||''))throw new Error('当前项目负责人关系不完整，请先核对项目团队');
  if(nextManagerId===String(project.manager_id||''))return{id:projectId,status:'unchanged',manager_name:project.manager_name_snapshot||'当前项目负责人'};
  const pendingTimesheets=await ctx.api.object('forge_project_timesheet').find({where:{project_id:projectId,organization_id:organizationId,status:'pending_review'},fields:['id','approval_status'],limit:500});
  const pendingExpenses=await ctx.api.object('forge_project_expense').find({where:{project_id:projectId,organization_id:organizationId,status:'pending_review'},fields:['id','approval_status'],limit:500});
  if(pendingTimesheets.length||pendingExpenses.length)throw new Error('项目仍有待审批或审批结果待入账的工时/费用，请完成审批和成本入账后再交接负责人');
  const user=await ctx.api.object('sys_user').findOne({where:{id:nextManagerId}});
  if(!user||user.active===false||user.banned===true)throw new Error('新项目负责人必须是当前组织内有效账号');
  const currentManager=String(project.manager_id||'');
  const changed=await projects.update({manager_transfer_target_id:nextManagerId},{multi:true,where:{id:projectId,organization_id:organizationId,manager_id:currentManager,...versionWhere}});
  if(changed!==1)throw new Error('项目资料已被其他人修改，请刷新后重新办理');
  return{id:projectId,status:'transferred',manager_name:displayName(user)};
});
` },
});
