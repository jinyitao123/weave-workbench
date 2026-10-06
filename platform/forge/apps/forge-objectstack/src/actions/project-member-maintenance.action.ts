import { defineAction } from '@objectstack/spec';

const projectMemberContext = `
const actor=String((ctx.session&&ctx.session.userId)||(ctx.user&&ctx.user.id)||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(!actor||!organizationId)throw new Error('无法确认当前操作人和组织');
function requiredDate(value,label){const text=String(value||'').trim();if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(text))throw new Error(label+'必须是有效日期');const parsed=new Date(text+'T00:00:00.000Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==text)throw new Error(label+'必须是有效日期');return text;}
function updatedAtWhere(row,expected){const actual=String(row&&row.updated_at||'');if(!expected||String(expected)!==actual)throw new Error('项目成员已被修改，请刷新后重试');const time=Date.parse(actual);if(!Number.isFinite(time))throw new Error('项目成员读取版本无效');return{updated_at:{$gte:new Date(time).toISOString(),$lt:new Date(time+1).toISOString()}};}
async function managedProject(projectId){const project=await ctx.api.object('forge_project').findOne({where:{id:projectId,organization_id:organizationId},fields:['id','name','owner_id','manager_id','organization_id','status']});if(!project||String(project.organization_id||'')!==organizationId)throw new Error('项目不存在或不属于当前组织');if(project.owner_id!==actor&&project.manager_id!==actor)throw new Error('仅项目所有者或当前项目经理可以维护团队');return project;}
function activeRow(row){if(!row)return false;const value=row.active;return value==null||![false,0,'0','false'].includes(value);}
function activeGrant(row,now){if(!row)return false;const epoch=value=>{if(value==null||value==='')return undefined;if(typeof value==='number')return value<1e12?value*1000:value;if(value instanceof Date)return value.getTime();if(typeof value==='string')return Date.parse(value);return Number.NaN;};const from=epoch(row.valid_from??row.validFrom),until=epoch(row.valid_until??row.validUntil);if(from!==undefined&&!(now>=from))return false;if(until!==undefined&&!(now<until))return false;return true;}
async function validTarget(userId){const [user,membership]=await Promise.all([ctx.api.object('sys_user').findOne({where:{id:userId}}),ctx.api.object('sys_member').findOne({where:{user_id:userId,organization_id:organizationId}})]);const now=Date.now();if(!user||!activeRow(user)||user.banned===true||!membership||!activeRow(membership)||!activeGrant(membership,now))throw new Error('项目成员必须是当前组织内有效账号');return user;}
function displayName(user){return String(user.display_name||user.name||user.username||'项目成员').trim()||'项目成员';}
function relationKey(projectId,userId){return projectId+':'+userId;}
`;

export const ProjectMemberAdd = defineAction({
  name: 'project_member_add',
  label: '添加项目成员',
  objectName: 'forge_project',
  icon: 'user-plus',
  locations: [],
  requiredPermissions: ['forge_project_operator'],
  refreshAfter: true,
  params: [
    { field: 'user_id', objectOverride: 'forge_project_member', required: true },
    { name: 'member_duty', label: '项目角色', type: 'select', required: true, defaultValue: 'member', options: [{ value: 'member', label: '项目成员' }] },
    { field: 'joined_on', objectOverride: 'forge_project_member', required: true },
    { field: 'remarks', objectOverride: 'forge_project_member' },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `${projectMemberContext}
const projectId=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim();if(ctx.recordLoadDenied===true||!projectId)throw new Error('当前项目不存在或不可访问');
const userId=String(ctx.input.user_id||'').trim(),duty=String(ctx.input.member_duty||'member'),joinedOn=requiredDate(ctx.input.joined_on,'加入日期'),remarks=String(ctx.input.remarks||'').trim()||null;if(!userId)throw new Error('请选择项目成员');if(duty!=='member')throw new Error('添加成员只能使用“项目成员”角色');
return await ctx.api.transaction(async()=>{const project=await managedProject(projectId);if(userId===String(project.manager_id||''))throw new Error('项目负责人已由项目关系维护，不能作为普通成员重复添加');const user=await validTarget(userId),membershipKey=relationKey(projectId,userId),members=ctx.api.object('forge_project_member'),existing=await members.findOne({where:{membership_key:membershipKey,organization_id:organizationId}});if(existing){if(String(existing.project_id||'')!==projectId||String(existing.user_id||'')!==userId||String(existing.organization_id||'')!==organizationId)throw new Error('项目成员关系键冲突，拒绝覆盖其他关系');if(existing.member_duty!=='member')throw new Error('项目负责人关系不能作为普通成员重复添加');if(existing.active===true)return{id:existing.id,status:'unchanged',member_duty:'member'};const compare=updatedAtWhere(existing,existing.updated_at),changed=await members.update({active:true,joined_on:joinedOn,name:displayName(user),remarks},{multi:true,where:{id:existing.id,project_id:projectId,user_id:userId,membership_key:membershipKey,organization_id:organizationId,active:false,member_duty:'member',...compare}});if(changed!==1)throw new Error('项目成员已被修改，请刷新后重试');return{id:existing.id,status:'reactivated',member_duty:'member'};}const created=await members.insert({name:displayName(user),membership_key:membershipKey,project_id:projectId,user_id:userId,member_duty:'member',joined_on:joinedOn,active:true,remarks,organization_id:organizationId});const id=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!id)throw new Error('项目成员创建后未返回记录标识');return{id,status:'created',member_duty:'member'};});
` },
});

export const ProjectMemberUpdate = defineAction({
  name: 'project_member_update',
  label: '保存项目成员',
  objectName: 'forge_project_member',
  icon: 'user-round-pen',
  locations: [],
  requiredPermissions: ['forge_project_operator'],
  refreshAfter: true,
  visible: `record.active == true && record.member_duty == 'member'`,
  params: [
    { name: 'expected_updated_at', label: '读取版本', type: 'text', required: true },
    { field: 'joined_on', objectOverride: 'forge_project_member', required: true },
    { field: 'remarks', objectOverride: 'forge_project_member' },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `${projectMemberContext}
const memberId=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim();if(ctx.recordLoadDenied===true||!memberId)throw new Error('项目成员不存在或不可访问');const joinedOn=requiredDate(ctx.input.joined_on,'加入日期'),remarks=String(ctx.input.remarks||'').trim()||null;
return await ctx.api.transaction(async()=>{const members=ctx.api.object('forge_project_member'),member=await members.findOne({where:{id:memberId,organization_id:organizationId}});if(!member||String(member.organization_id||'')!==organizationId)throw new Error('项目成员不存在或不属于当前组织');const project=await managedProject(String(member.project_id||''));if(member.member_duty==='manager'||String(member.user_id||'')===String(project.manager_id||''))throw new Error('当前项目负责人关系只读，不能修改');if(member.active!==true||member.member_duty!=='member')throw new Error('仅有效的普通项目成员可以修改');const compare=updatedAtWhere(member,ctx.input.expected_updated_at),changed=await members.update({joined_on:joinedOn,remarks},{multi:true,where:{id:memberId,project_id:project.id,user_id:member.user_id,membership_key:member.membership_key,organization_id:organizationId,active:true,member_duty:'member',...compare}});if(changed!==1)throw new Error('项目成员已被修改，请刷新后重试');return{id:memberId,status:'updated',member_duty:'member'};});
` },
});

export const ProjectMemberDeactivate = defineAction({
  name: 'project_member_deactivate',
  label: '移出项目',
  objectName: 'forge_project_member',
  icon: 'user-round-minus',
  locations: [],
  requiredPermissions: ['forge_project_operator'],
  refreshAfter: true,
  visible: `record.active == true && record.member_duty == 'member'`,
  description: '停用该成员在当前项目中的有效关系；历史关系保留，不能移除当前项目负责人。',
  params: [{ name: 'expected_updated_at', label: '读取版本', type: 'text', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `${projectMemberContext}
const memberId=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim();if(ctx.recordLoadDenied===true||!memberId)throw new Error('项目成员不存在或不可访问');
return await ctx.api.transaction(async()=>{
 const members=ctx.api.object('forge_project_member'),member=await members.findOne({where:{id:memberId,organization_id:organizationId}});
 if(!member||String(member.organization_id||'')!==organizationId)throw new Error('项目成员不存在或不属于当前组织');
 const project=await managedProject(String(member.project_id||''));
 if(member.member_duty==='manager'||String(member.user_id||'')===String(project.manager_id||''))throw new Error('不能移除当前项目负责人');
 if(member.active!==true||member.member_duty!=='member')throw new Error('仅有效的普通项目成员可以移出项目');
 const assignments=ctx.api.object('forge_project_member_position_assignment'),activeAssignments=await assignments.find({where:{project_id:project.id,member_id:memberId,organization_id:organizationId,active:true},limit:500});
 for(const assignment of activeAssignments){const assignmentVersion=updatedAtWhere(assignment,assignment.updated_at),saved=await assignments.update({active:false,is_default:false,ended_at:new Date().toISOString()},{multi:true,where:{id:assignment.id,project_id:project.id,member_id:memberId,organization_id:organizationId,active:true,...assignmentVersion}});if(saved!==1)throw new Error('项目岗位关系已变化，请刷新后重试');}
 const revision=Number(member.position_assignment_revision||0)+(activeAssignments.length?1:0),compare=updatedAtWhere(member,ctx.input.expected_updated_at),changed=await members.update({active:false,position_assignment_revision:revision},{multi:true,where:{id:memberId,project_id:project.id,user_id:member.user_id,membership_key:member.membership_key,organization_id:organizationId,active:true,member_duty:'member',...compare}});
 if(changed!==1)throw new Error('项目成员已被修改，请刷新后重试');
 return{id:memberId,status:'deactivated',member_duty:'member',ended_assignment_count:activeAssignments.length};
});
` },
});
