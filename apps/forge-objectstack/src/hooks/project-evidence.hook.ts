import { defineHook } from '@objectstack/spec/data';

const assignmentGuard = `
const actor=String(ctx.session&&ctx.session.userId||ctx.user&&ctx.user.id||'');
const organizationId=String(ctx.session&&ctx.session.organizationId||ctx.user&&ctx.user.organizationId||'');
const projectId=String(ctx.input&&ctx.input.project_id||'');
if(!actor||!organizationId||!projectId)throw new Error('项目、员工和组织不能为空');
const project=await ctx.api.object('forge_project').findOne({where:{id:projectId}});
if(!project||String(project.organization_id||'')!==organizationId)throw new Error('项目不存在或不属于当前组织');
const members=await ctx.api.object('forge_project_member').find({where:{project_id:projectId,user_id:actor,active:true}});
if(project.manager_id!==actor&&project.owner_id!==actor&&!members.some(row=>row.active===true))throw new Error('仅项目负责人或有效成员可登记项目资料');
`;

export const ProjectAttachmentAssignmentGuard = defineHook({
  name: 'project_attachment_assignment_guard',
  object: 'forge_project_attachment',
  events: ['beforeInsert'],
  priority: 100,
  runAs: 'system',
  description: '项目资料仅由获分配项目的员工上传，上传人归属由登录身份确定。',
  body: {
    language: 'js', capabilities: ['api.read'],
    source: `${assignmentGuard}
ctx.input.uploaded_by=actor;
if(!ctx.input.uploaded_at)ctx.input.uploaded_at=new Date().toISOString();
`,
  },
});

export const ProjectLogAssignmentGuard = defineHook({
  name: 'project_log_assignment_guard',
  object: 'forge_project_log',
  events: ['beforeInsert'],
  priority: 100,
  runAs: 'system',
  description: '项目日志仅由获分配项目的员工登记，作者归属由登录身份确定。',
  body: {
    language: 'js', capabilities: ['api.read'],
    source: `${assignmentGuard}
ctx.input.author_id=actor;
if(!ctx.input.logged_at)ctx.input.logged_at=new Date().toISOString();
`,
  },
});
