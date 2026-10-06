import { defineAction } from '@objectstack/spec';
import { PROJECT_CREATE_TARGET, PROJECT_LINK_TARGET, PROJECT_START_TARGET } from '../plugins/project-order-domain.js';
import { projectPositionAssignmentQuickJsHelpers } from './project-member-position-assignment.action.js';

const locations = ['record_header', 'record_more'] as const;
const projectManagerGuard = String.raw`
const managerActor=String(ctx.session&&ctx.session.userId||''),managerOrg=String(ctx.session&&ctx.session.organizationId||'');
if(ctx.recordLoadDenied===true||!ctx.record||!managerActor||!managerOrg||ctx.record.manager_id!==managerActor||ctx.record.organization_id!==managerOrg)throw new Error('仅当前项目经理可办理项目执行状态');
`;

const projectPlanTemplateApplyQuickJs = String.raw`
function projectPlanText(value){return value==null?'':String(value).trim();}
function projectPlanIsoDate(value){const date=projectPlanText(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return'';const instant=new Date(date+'T00:00:00.000Z');return Number.isFinite(instant.getTime())&&instant.toISOString().slice(0,10)===date?date:'';}
function projectPlanShiftDate(value,days){const date=projectPlanIsoDate(value);if(!date)throw new Error('模板含无效计划日期，请先修订模板');return new Date(Date.parse(date+'T00:00:00.000Z')+days*86400000).toISOString().slice(0,10);}
function projectPlanSourceForTemplate(category){return category==='system'?'system_template':category==='project_copy'?'copied_project':'custom_template';}
async function applyProjectPlanTemplate(ctx,planId,plan,templateId,plannedStartOn,assignmentMapInput,organizationId,actorId){
 const org=projectPlanText(organizationId||plan.organization_id),actor=projectPlanText(actorId||ctx.session&&ctx.session.userId||ctx.user&&ctx.user.id);
 if(!org||!actor||projectPlanText(plan.organization_id)!==org||projectPlanText(plan.project_id)==='')throw new Error('当前计划缺少有效组织或项目上下文');
 const template=await ctx.api.object('forge_project_plan_template').findOne({where:{id:templateId,organization_id:org,status:'active'}});
 if(!template||projectPlanText(template.organization_id)!==org||template.status!=='active')throw new Error('所选计划模板不存在、已停用或不属于当前组织');
 const category=projectPlanText(template.category);
 if(!['system','custom','project_copy'].includes(category))throw new Error('所选计划模板分类无效');
 if(category!=='system'&&projectPlanText(template.created_by)!==actor)throw new Error('只能使用本人的计划模板或本组织系统模板');
 let structure;try{structure=JSON.parse(template.structure_json||'[]')}catch{throw new Error('计划模板结构损坏，无法套用')}
 if(!Array.isArray(structure)||!structure.length)throw new Error('计划模板没有可套用的工作项');
 if(Number(template.item_count||0)!==structure.length)throw new Error('计划模板结构与工作项数量不一致，请重新保存模板');
 const existing=await ctx.api.object('forge_project_work_item').find({where:{plan_id:planId,project_id:plan.project_id,organization_id:org},limit:5001});
 if(existing.length)throw new Error('当前计划已有工作项，不能套用模板');
 const targetStart=projectPlanIsoDate(plannedStartOn||plan.planned_start_on);
 if(!targetStart)throw new Error('请选择有效的计划开始日期');
 const sourceIds=new Set(),sourceById=new Map(),sourceStarts=[],sourceEnds=[];
 for(const item of structure){const id=projectPlanText(item&&item.source_id),name=projectPlanText(item&&item.name),type=projectPlanText(item&&item.item_type),start=projectPlanIsoDate(item&&item.planned_start_on),end=projectPlanIsoDate(item&&item.planned_end_on);if(!id||sourceIds.has(id)||!name||!['phase','milestone','task'].includes(type))throw new Error('模板工作项缺少唯一来源、名称或有效类型');if(!start||!end||end<start)throw new Error('模板工作项计划日期无效，请先修订模板');if(type==='phase'&&item.parent_id)throw new Error('模板阶段不能设置上级阶段');sourceIds.add(id);sourceById.set(id,item);sourceStarts.push(start);sourceEnds.push(end);}
 const sortedStarts=sourceStarts.slice().sort(),sortedEnds=sourceEnds.slice().sort(),sourceStart=sortedStarts[0],sourceEnd=sortedEnds[sortedEnds.length-1],dateOffset=Math.round((Date.parse(targetStart+'T00:00:00.000Z')-Date.parse(sourceStart+'T00:00:00.000Z'))/86400000),targetEnd=projectPlanShiftDate(sourceEnd,dateOffset);
 let ownerMap={};try{ownerMap=assignmentMapInput&&typeof assignmentMapInput==='object'?assignmentMapInput:JSON.parse(String(assignmentMapInput||'{}'))}catch{throw new Error('负责人岗位映射格式无效')};if(!ownerMap||typeof ownerMap!=='object'||Array.isArray(ownerMap))throw new Error('负责人岗位映射格式无效');for(const key of Object.keys(ownerMap))if(!sourceIds.has(key))throw new Error('负责人岗位映射包含不属于模板的工作项');
 const byOrder=structure.slice().sort((left,right)=>(left.item_type==='phase'?0:1)-(right.item_type==='phase'?0:1)||Number(left.sort_order||0)-Number(right.sort_order||0)||projectPlanText(left.source_id).localeCompare(projectPlanText(right.source_id)));
 const idMap={},copied=[];
 for(const item of byOrder){const sourceId=projectPlanText(item.source_id);if(item.parent_id){const parentSource=sourceById.get(projectPlanText(item.parent_id));if(!parentSource||parentSource.item_type!=='phase'||!idMap[projectPlanText(item.parent_id)])throw new Error('模板阶段顺序或所属关系无效');}
  const mapped=ownerMap[sourceId]&&typeof ownerMap[sourceId]==='object'?ownerMap[sourceId]:{},ownerId=projectPlanText(mapped.owner_id||item.owner_id),assignmentId=projectPlanText(mapped.owner_position_assignment_id||item.owner_position_assignment_id);
  if(item.item_type==='task'&&(!projectPlanText(item.task_type)||!projectPlanText(item.priority)||item.estimated_hours==null||!ownerId||!assignmentId))throw new Error('模板任务必须有有效类别、优先级、负责人及项目岗位映射');
  if(item.task_type){const option=await ctx.api.object('forge_business_setting_option').findOne({where:{id:item.task_type,organization_id:org,scope:'project',setting_type:'task_type',enabled:true}});if(!option||option.enabled===false)throw new Error('模板任务类别在当前组织已停用或不可用');}
  const created=await ctx.api.object('forge_project_work_item').insert({name:projectPlanText(item.name),project_id:plan.project_id,plan_id:planId,organization_id:org,item_type:item.item_type,description:item.description||null,parent_id:item.parent_id?idMap[projectPlanText(item.parent_id)]:null,owner_id:ownerId||null,owner_position_assignment_id:assignmentId||null,task_type:item.task_type||null,priority:item.priority||null,estimated_hours:item.estimated_hours==null?null:Number(item.estimated_hours),predecessor_ids:[],planned_start_on:projectPlanShiftDate(item.planned_start_on,dateOffset),planned_end_on:projectPlanShiftDate(item.planned_end_on,dateOffset),weight:Number(item.weight||0),critical_path:item.critical_path===true,planned_deliverable:item.planned_deliverable||null});
  const createdId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!createdId)throw new Error('模板工作项创建失败');idMap[sourceId]=createdId;copied.push(item);
 }
 for(const item of copied){const predecessorIds=Array.isArray(item.predecessor_ids)?item.predecessor_ids.map(projectPlanText).filter(Boolean):[];const mapped=predecessorIds.map(sourceId=>idMap[sourceId]);if(mapped.some(value=>!value))throw new Error('模板前置工作项缺失，无法套用');if(mapped.length)await ctx.api.object('forge_project_work_item').update({id:idMap[projectPlanText(item.source_id)],predecessor_ids:mapped});}
 const planSource=projectPlanSourceForTemplate(category);await ctx.api.object('forge_project_plan').update({id:planId,source:planSource,planned_start_on:targetStart,planned_end_on:targetEnd});
 return{template_id:template.id,source:planSource,item_count:structure.length,planned_start_on:targetStart,planned_end_on:targetEnd};
}
`;


export const CustomerCreateProject = defineAction({
  name: 'customer_create_project', label: '项目立项', objectName: 'forge_customer', icon: 'briefcase-business',
  locations: [...locations], order: 60, refreshAfter: true,
  requiredPermissions: ['forge_project_operator'],
  description: '为本人客户明确选择已批准订单、活跃项目类型和有效项目经理立项；合同与订单须另行准确关联。', successMessage: '项目已立项',
  params: [
    { name: 'approved_order_id', label: '已批准销售订单', type: 'lookup', reference: 'forge_sales_order', required: true },
    { field: 'name', objectOverride: 'forge_project', required: true }, { field: 'type_id', objectOverride: 'forge_project', required: true },
    { field: 'priority', objectOverride: 'forge_project', required: true },
    { field: 'planned_start_on', objectOverride: 'forge_project', required: true }, { field: 'planned_end_on', objectOverride: 'forge_project', required: true },
    { field: 'expected_revenue', objectOverride: 'forge_project' }, { field: 'budget_amount', objectOverride: 'forge_project' },
    { name: 'manager_id', label: '项目负责人', type: 'user', required: true }, { field: 'description', objectOverride: 'forge_project' },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.project/forge_project/record/${result.id}' },
  type: 'script', target: PROJECT_CREATE_TARGET,
  ai: { exposed: true, category: 'action', requiresConfirmation: true, description: '当前员工明确办理准确订单项目动作，重新核验当前身份、原生权限、实际项目经理成员以及准确订单来源版本，不自动指派或启动项目。' },
});

export const ProjectRefreshCustomerSnapshot = defineAction({
  name: 'project_refresh_customer_snapshot', label: '补齐客户名称快照', objectName: 'forge_project', icon: 'building-2',
  locations: [...locations], order: 5, refreshAfter: true,
  requiredPermissions: ['forge_project_operator', 'sales_contract_operator'],
  visible: `record.customer_name_snapshot == null && record.created_by == current_user.id`,
  description: '仅由项目创建人同步其本人有权读取的关联客户名称到项目快照，不改变客户档案或读取权限。',
  confirmText: '将关联客户的名称写入本项目快照，让项目团队在项目页查看客户名称？客户档案和客户权限不会改变。',
  successMessage: '项目客户名称已补齐',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const project = ctx.record;
const actor = ctx.session && ctx.session.userId;
if (ctx.recordLoadDenied === true || !id || !project) throw new Error('当前项目不存在或不可访问');
if (!actor || project.created_by !== actor) throw new Error('仅项目创建人可以补齐客户名称快照');
if (String(project.customer_name_snapshot || '').trim()) return { id, status: 'unchanged' };
const customer = await ctx.api.object('forge_customer').findOne({
  where: { id: project.customer_id }, fields: ['id', 'name', 'owner_id'],
});
if (!customer || String(customer.owner_id || '') !== String(actor)) throw new Error('当前账号无法读取此项目关联客户');
const customerName = String(customer.name || '').trim();
if (!customerName) throw new Error('关联客户没有可用于项目快照的名称');
await ctx.api.object('forge_project').update({ id, customer_name_snapshot: customerName });
return { id, status: 'updated' };
` },
});

export const ProjectReadDeliveryScope = defineAction({
  name: 'project_read_delivery_scope', label: '读取项目物料与服务范围', objectName: 'forge_project', icon: 'list-checks',
  locations: [...locations], order: 6,
  requiredPermissions: ['forge_project_operator'],
  description: '仅从当前可读项目已关联的有效合同和订单读取物料/服务明细，不读取同客户的其他单据。',
  ai: { exposed: true, category: 'action', requiresConfirmation: false, description: '只读当前合法项目已关联订单的完整设备和服务范围，核对原报价、合同与订单明细，遵守当前字段权限，不授予后续写动作。' },
  successMessage: '项目物料与服务范围已读取',
  type: 'script', target: 'forgeReadProjectDeliveryScope',
});

export const ProjectStart = defineAction({
  name: 'project_start', label: '开始执行', objectName: 'forge_project', icon: 'play',
  locations: [...locations], order: 10, visible: `record.status == 'pending'`, refreshAfter: true,
  requiredPermissions: ['forge_project_manager'],
  confirmText: '开始执行后，项目基本信息应作为立项基线保留；计划、任务和团队可继续维护。是否继续？', successMessage: '项目已开始执行',
  type: 'script', target: PROJECT_START_TARGET,
  ai: { exposed: true, category: 'action', requiresConfirmation: true, description: '当前员工明确办理准确订单项目动作，重新核验当前身份、原生权限、实际项目经理成员以及准确订单来源版本，不自动指派或启动项目。' },
});

export const ProjectLinkContract = defineAction({
  name: 'project_link_contract', label: '关联合同及订单', objectName: 'forge_project', icon: 'link',
  locations: [...locations], order: 20, visible: `record.status == 'pending'`, refreshAfter: true,
  requiredPermissions: ['forge_project_operator', 'sales_contract_operator'],
  description: '仅关联本次明确选择的已批准销售订单及其已签署合同，保留准确设备与服务来源。', successMessage: '合同和订单已关联',
  params: [{ field: 'contract_id', objectOverride: 'forge_project_sales_link', required: true }, { name: 'approved_order_id', label: '已批准销售订单', type: 'lookup', reference: 'forge_sales_order', required: true }],
  type: 'script', target: PROJECT_LINK_TARGET,
  ai: { exposed: true, category: 'action', requiresConfirmation: true, description: '当前员工明确办理准确订单项目动作，重新核验当前身份、原生权限、实际项目经理成员以及准确订单来源版本，不自动指派或启动项目。' },
});

export const ProjectPause = defineAction({
  name: 'project_pause', label: '暂停', objectName: 'forge_project', icon: 'pause',
  locations: [...locations], order: 30, visible: `record.status == 'in_progress'`, refreshAfter: true,
  requiredPermissions: ['forge_project_manager'],
  description: '暂停后项目仍保留现有计划和记录，但停止按进行中状态推进。请填写暂停原因并确认。',
  params: [{ field: 'pause_reason', objectOverride: 'forge_project', required: true }], successMessage: '项目已暂停',
  body: { language: 'js', capabilities: ['api.write'], source: `${projectManagerGuard}
const id=ctx.recordId||(ctx.record&&ctx.record.id); if(!id||!ctx.record||ctx.record.status!=='in_progress') throw new Error('仅进行中项目可以暂停'); await ctx.api.object('forge_project').update({id,status:'paused',pause_reason:ctx.input.pause_reason}); return {id,status:'paused'};` },
});

export const ProjectResume = defineAction({
  name: 'project_resume', label: '恢复执行', objectName: 'forge_project', icon: 'play',
  locations: [...locations], order: 10, visible: `record.status == 'paused'`, refreshAfter: true, confirmText: '确认恢复项目执行？', successMessage: '项目已恢复执行',
  requiredPermissions: ['forge_project_manager'],
  body: { language: 'js', capabilities: ['api.write'], source: `${projectManagerGuard}
const id=ctx.recordId||(ctx.record&&ctx.record.id); if(!id||!ctx.record||ctx.record.status!=='paused') throw new Error('仅已暂停项目可以恢复执行'); await ctx.api.object('forge_project').update({id,status:'in_progress'}); return {id,status:'in_progress'};` },
});

export const ProjectTerminate = defineAction({
  name: 'project_terminate', label: '终止', objectName: 'forge_project', icon: 'octagon-x',
  locations: [...locations], order: 90, visible: `record.status == 'pending' || record.status == 'in_progress' || record.status == 'paused'`, refreshAfter: true,
  requiredPermissions: ['forge_project_manager'],
  description: '终止后项目不能继续按正常执行流程推进，现有计划、任务和业务记录将保留用于追溯。请填写终止原因并确认。',
  params: [{ field: 'termination_reason', objectOverride: 'forge_project', required: true }], successMessage: '项目已终止',
  body: { language: 'js', capabilities: ['api.write'], source: `${projectManagerGuard}
const id=ctx.recordId||(ctx.record&&ctx.record.id); if(!id||!ctx.record||!['pending','in_progress','paused'].includes(ctx.record.status)) throw new Error('当前项目不能终止'); await ctx.api.object('forge_project').update({id,status:'terminated',termination_reason:ctx.input.termination_reason}); return {id,status:'terminated'};` },
});

export const ProjectCreateManualPlan = defineAction({
  name: 'project_create_manual_plan', label: '手工创建计划', objectName: 'forge_project', icon: 'calendar-plus',
  requiredPermissions: ['forge_project_manager'],
  locations: [...locations], order: 40, visible: `record.status == 'in_progress' || record.status == 'paused'`, refreshAfter: true,
  description: '从一个阶段开始建立项目计划，也可以在后续从项目配置中心套用可用模板。', successMessage: '项目计划和首个阶段已创建',
  params: [
    { field: 'phase_name', objectOverride: 'forge_project_work_item', required: true },
    { field: 'owner_id', objectOverride: 'forge_project_work_item' },
    { field: 'planned_start_on', objectOverride: 'forge_project_work_item', required: true },
    { field: 'planned_end_on', objectOverride: 'forge_project_work_item', required: true },
    { field: 'weight', objectOverride: 'forge_project_work_item', defaultValue: 20 },
    { field: 'critical_path', objectOverride: 'forge_project_work_item', defaultValue: false },
    { field: 'planned_deliverable', objectOverride: 'forge_project_work_item' },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.project/forge_project_plan/record/${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const projectId = ctx.recordId || (ctx.record && ctx.record.id); const project = ctx.record;
if (ctx.recordLoadDenied === true || !projectId || !project) throw new Error('当前项目不存在或不可访问');
if (!['in_progress','paused'].includes(project.status)) throw new Error('仅进行中或已暂停项目可以创建计划');
if (!ctx.input.phase_name || !ctx.input.planned_start_on || !ctx.input.planned_end_on) throw new Error('首个阶段和计划日期均为必填');
if (ctx.input.planned_end_on < ctx.input.planned_start_on) throw new Error('计划结束日期不得早于计划开始日期');
const existing = await ctx.api.object('forge_project_plan').find({ where: { project_id: projectId, status: 'active' } });
if (existing.length) throw new Error('当前项目已经存在执行中的计划');
const start = Date.parse(ctx.input.planned_start_on), end = Date.parse(ctx.input.planned_end_on);
const duration = Math.floor((end - start) / 86400000);
return await ctx.api.transaction(async()=>{
  const plan = await ctx.api.object('forge_project_plan').insert({ name: project.name + '计划 V1', plan_key: projectId + ':R1', project_id: projectId,
    source: 'manual', revision: 1, planned_start_on: ctx.input.planned_start_on, planned_end_on: ctx.input.planned_end_on,
    status: 'active', item_count: 1, progress: 0, remarks: '从首个阶段手工创建' });
  const planId = typeof plan === 'string' ? plan : plan && (plan.id || (plan.record && plan.record.id));
  if (!planId) throw new Error('项目计划创建后未返回记录ID');
  const phase = await ctx.api.object('forge_project_work_item').insert({ name: ctx.input.phase_name, item_key: planId + ':1', project_id: projectId,
    plan_id: planId, item_type: 'phase', owner_id: ctx.input.owner_id || project.manager_id || null,
    planned_start_on: ctx.input.planned_start_on, planned_end_on: ctx.input.planned_end_on, duration_days: duration,
    weight: Number(ctx.input.weight == null ? 20 : ctx.input.weight), critical_path: ctx.input.critical_path === true,
    planned_deliverable: ctx.input.planned_deliverable || null, status: 'pending', progress: 0, sort_order: 10 });
  const phaseId = typeof phase === 'string' ? phase : phase && (phase.id || (phase.record && phase.record.id));
  if (!phaseId) throw new Error('首个阶段创建后未返回记录ID');
return { id: planId, project_id: projectId, phase_id: phaseId, source: 'manual', item_count: 1 };
});
` },
});

export const ProjectPlanAddWorkItem = defineAction({
  name: 'project_plan_add_work_item', label: '新增阶段/里程碑/任务', objectName: 'forge_project_plan', icon: 'list-plus',
  requiredPermissions: ['forge_project_manager'],
  locations: [...locations], order: 10, visible: `record.status == 'active'`, refreshAfter: true,
  description: '按 RISEMAP 计划页字段添加阶段、里程碑或任务。', successMessage: '计划工作项已添加',
  params: [
    { field: 'item_type', objectOverride: 'forge_project_work_item', required: true },
    { field: 'name', objectOverride: 'forge_project_work_item', required: true },
    { field: 'description', objectOverride: 'forge_project_work_item' },
    { field: 'task_type', objectOverride: 'forge_project_work_item' },
    { field: 'priority', objectOverride: 'forge_project_work_item' },
    { field: 'estimated_hours', objectOverride: 'forge_project_work_item' },
    { field: 'parent_id', objectOverride: 'forge_project_work_item' }, { field: 'owner_id', objectOverride: 'forge_project_work_item' },
    { field: 'owner_position_assignment_id', objectOverride: 'forge_project_work_item' },
    { field: 'planned_start_on', objectOverride: 'forge_project_work_item', required: true },
    { field: 'planned_end_on', objectOverride: 'forge_project_work_item', required: true },
    { field: 'predecessor_ids', objectOverride: 'forge_project_work_item', multiple: true },
    { field: 'weight', objectOverride: 'forge_project_work_item', defaultValue: 20 },
    { field: 'critical_path', objectOverride: 'forge_project_work_item', defaultValue: false },
    { field: 'planned_deliverable', objectOverride: 'forge_project_work_item' },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `${projectPositionAssignmentQuickJsHelpers}
const planId = ctx.recordId || (ctx.record && ctx.record.id); const plan = ctx.record;
if (ctx.recordLoadDenied === true || !planId || !plan) throw new Error('当前项目计划不存在或不可访问');
if (plan.status !== 'active') throw new Error('仅执行中的计划可以添加工作项');
return await ctx.api.transaction(async()=>{
if (!['phase','milestone','task'].includes(ctx.input.item_type)) throw new Error('工作项类型必须是阶段、里程碑或任务');
if (!ctx.input.name || !ctx.input.planned_start_on || !ctx.input.planned_end_on) throw new Error('名称和计划日期均为必填');
if (ctx.input.planned_end_on < ctx.input.planned_start_on) throw new Error('计划结束日期不得早于计划开始日期');
if (ctx.input.item_type === 'phase' && ctx.input.parent_id) throw new Error('阶段必须是顶层工作项');
if (ctx.input.parent_id) {
  const parent = await ctx.api.object('forge_project_work_item').findOne({ where: { id: ctx.input.parent_id } });
  if (!parent || parent.plan_id !== planId || parent.item_type !== 'phase') throw new Error('所属阶段必须来自当前计划');
}
const priorities=['urgent','high','medium','low'];
const taskTypeId=String(ctx.input.task_type||'').trim(),priority=ctx.input.priority||'medium',estimatedHours=Number(ctx.input.estimated_hours==null?8:ctx.input.estimated_hours);
  if(ctx.input.item_type==='task'&&(!ctx.input.owner_id||!String(ctx.input.owner_id).trim()))throw new Error('任务负责人必须选择当前项目有效成员');
if(ctx.input.item_type==='task'&&(!taskTypeId||!priorities.includes(priority)))throw new Error('任务类别或优先级不合法');
if(ctx.input.item_type==='task'&&(!Number.isFinite(estimatedHours)||estimatedHours<0))throw new Error('预估工时必须是大于或等于零的有效数字');
let taskTypeOption=null;
if(ctx.input.item_type==='task'){
  const project=await ctx.api.object('forge_project').findOne({where:{id:plan.project_id}});
  const projectOrganization=String(project&&project.organization_id||(ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
  if(!project||!projectOrganization)throw new Error('无法确认项目类别配置所属组织');
  taskTypeOption=await ctx.api.object('forge_business_setting_option').findOne({where:{id:taskTypeId,organization_id:projectOrganization,scope:'project',setting_type:'task_type',enabled:true}});
  if(!project||!taskTypeOption||taskTypeOption.enabled===false)throw new Error('任务类别不存在或已停用，请刷新后重试');
  if(String(taskTypeOption.organization_id||'')!==projectOrganization)throw new Error('任务类别不属于当前项目组织');
}
if (ctx.input.owner_id) {
  const ownerMembership = await ctx.api.object('forge_project_member').findOne({ where: { project_id: plan.project_id, user_id: ctx.input.owner_id, active: true } });
  if (!ownerMembership || !['manager','member'].includes(ownerMembership.member_duty)) throw new Error('负责人必须是当前项目的有效成员');
}
let ownerPositionAssignment=null;
if(ctx.input.item_type==='task'){
 const project=await ctx.api.object('forge_project').findOne({where:{id:plan.project_id}});
 const projectOrganization=String(project&&project.organization_id||(ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
 const ownerId=String(ctx.input.owner_id||'').trim();
 const ownerMembership=await ctx.api.object('forge_project_member').findOne({where:{project_id:plan.project_id,user_id:ownerId,active:true,organization_id:projectOrganization}});
 if(!project||!projectOrganization||!ownerMembership||ownerMembership.active!==true||String(ownerMembership.organization_id||'')!==projectOrganization)throw new Error('负责人必须是当前项目组织内的有效成员');
 const roleWasSpecified=Object.prototype.hasOwnProperty.call(ctx.input,'owner_position_assignment_id');
 ownerPositionAssignment=await resolveProjectPositionAssignment(plan.project_id,ownerMembership.id,ownerId,projectOrganization,roleWasSpecified?ctx.input.owner_position_assignment_id:null,!roleWasSpecified);
 if(!ownerPositionAssignment||!await projectPositionHasTaskExecution(ownerPositionAssignment.position_id))throw new Error('该岗位没有项目执行权限');
}
const predecessorIds = Array.isArray(ctx.input.predecessor_ids) ? ctx.input.predecessor_ids : (ctx.input.predecessor_ids ? [ctx.input.predecessor_ids] : []);
for (const predecessorId of predecessorIds) {
  const predecessor = await ctx.api.object('forge_project_work_item').findOne({ where: { id: predecessorId } });
  if (!predecessor || predecessor.plan_id !== planId || predecessor.item_type === 'phase') throw new Error('前置任务必须是当前计划中的任务或里程碑');
}
const duplicates = await ctx.api.object('forge_project_work_item').find({ where: { plan_id: planId, name: ctx.input.name } });
if (duplicates.length) throw new Error('当前计划已存在同名工作项');
const items = await ctx.api.object('forge_project_work_item').find({ where: { plan_id: planId } });
const start = Date.parse(ctx.input.planned_start_on), end = Date.parse(ctx.input.planned_end_on);
const duration = Math.floor((end - start) / 86400000);
const created = await ctx.api.object('forge_project_work_item').insert({ name: ctx.input.name, item_key: planId + ':' + (items.length + 1),
  project_id: plan.project_id, plan_id: planId, item_type: ctx.input.item_type, parent_id: ctx.input.parent_id || null,
  owner_id: ctx.input.owner_id || null, owner_position_assignment_id: ownerPositionAssignment&&ownerPositionAssignment.id||null, planned_start_on: ctx.input.planned_start_on, planned_end_on: ctx.input.planned_end_on,
  duration_days: duration, predecessor_ids: predecessorIds, weight: Number(ctx.input.weight == null ? 20 : ctx.input.weight),
  description: ctx.input.description || null, task_type: ctx.input.item_type==='task'?taskTypeOption.id:null,
  priority: ctx.input.item_type==='task'?priority:null, estimated_hours: ctx.input.item_type==='task'?estimatedHours:null,
  critical_path: ctx.input.critical_path === true, planned_deliverable: ctx.input.planned_deliverable || null,
  status: 'pending', progress: 0, sort_order: (items.length + 1) * 10 });
const itemId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
if (!itemId) throw new Error('计划工作项创建后未返回记录ID');
return { id: itemId, plan_id: planId, item_type: ctx.input.item_type, item_count: items.length + 1 };
});
` },
});

const projectTaskPriorities=['urgent','high','medium','low'];

export const ProjectWorkItemUpdateDetails = defineAction({
  name: 'project_work_item_update_details', label: '编辑任务', objectName: 'forge_project_work_item', icon: 'square-pen',
  requiredPermissions: ['forge_project_manager'], locations: [], refreshAfter: true,
  description: '更新项目任务的标题、描述、类别、负责人、优先级、截止日期和预估工时。', successMessage: '项目任务已更新',
  params: [
    { name: 'expected_updated_at', label: '读取版本', type: 'text', required: true },
    { field: 'name', objectOverride: 'forge_project_work_item', required: true },
    { field: 'description', objectOverride: 'forge_project_work_item' },
    { field: 'task_type', objectOverride: 'forge_project_work_item', required: true },
    { field: 'owner_id', objectOverride: 'forge_project_work_item', required: true },
    { field: 'owner_position_assignment_id', objectOverride: 'forge_project_work_item' },
    { field: 'priority', objectOverride: 'forge_project_work_item', required: true },
    { field: 'planned_end_on', objectOverride: 'forge_project_work_item', required: true },
    { field: 'estimated_hours', objectOverride: 'forge_project_work_item', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `${projectPositionAssignmentQuickJsHelpers}
const id=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim(),item=ctx.record;
if(ctx.recordLoadDenied===true||!id||!item)throw new Error('当前项目任务不存在或不可访问');
if(item.item_type!=='task')throw new Error('仅项目任务支持编辑任务资料');
const actor=String((ctx.session&&ctx.session.userId)||(ctx.user&&ctx.user.id)||'').trim();
if(!actor)throw new Error('无法确认当前操作人');
const updatedAt=String(item.updated_at||''),expected=String(ctx.input.expected_updated_at||'');
if(!expected||expected!==updatedAt)throw new Error('项目任务已被修改，请刷新后重试');
const versionTime=Date.parse(updatedAt);if(!Number.isFinite(versionTime))throw new Error('项目任务读取版本无效');
const name=String(ctx.input.name||'').trim(),description=String(ctx.input.description||'').trim()||null;
const taskTypeId=String(ctx.input.task_type||'').trim(),priority=String(ctx.input.priority||''),ownerId=String(ctx.input.owner_id||'').trim();
const dueOn=String(ctx.input.planned_end_on||'').trim(),estimatedHours=Number(ctx.input.estimated_hours);
if(!name||!ownerId||!dueOn)throw new Error('任务标题、负责人和截止日期均为必填');
if(!taskTypeId)throw new Error('请选择启用的项目任务类别');
if(!${JSON.stringify(projectTaskPriorities)}.includes(priority))throw new Error('任务优先级不合法');
if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(dueOn)||!Number.isFinite(Date.parse(dueOn+'T00:00:00.000Z'))||new Date(dueOn+'T00:00:00.000Z').toISOString().slice(0,10)!==dueOn)throw new Error('截止日期无效');
if(!Number.isFinite(estimatedHours)||estimatedHours<0)throw new Error('预估工时必须是大于或等于零的有效数字');
if(item.planned_start_on&&dueOn<item.planned_start_on)throw new Error('截止日期不得早于计划开始日期');
return await ctx.api.transaction(async()=>{
 const project=await ctx.api.object('forge_project').findOne({where:{id:item.project_id}});
 if(!project||project.id!==item.project_id)throw new Error('所属项目不存在或不可访问');
 if(project.owner_id!==actor&&project.manager_id!==actor)throw new Error('仅项目所有者或当前项目经理可以编辑项目任务资料');
 const plan=await ctx.api.object('forge_project_plan').findOne({where:{id:item.plan_id}});
 if(!plan||plan.project_id!==item.project_id||plan.status!=='active')throw new Error('仅执行中计划中的项目任务可以编辑');
 const projectOrganization=String(project.organization_id||(ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
 if(!projectOrganization)throw new Error('无法确认项目类别配置所属组织');
 const taskTypeOption=await ctx.api.object('forge_business_setting_option').findOne({where:{id:taskTypeId,organization_id:projectOrganization,scope:'project',setting_type:'task_type',enabled:true}});
 if(!taskTypeOption||taskTypeOption.enabled===false)throw new Error('任务类别不存在或已停用，请刷新后重试');
 if(String(taskTypeOption.organization_id||'')!==projectOrganization)throw new Error('任务类别不属于当前项目组织');
 const membership=await ctx.api.object('forge_project_member').findOne({where:{project_id:item.project_id,user_id:ownerId,active:true,organization_id:projectOrganization}});
 if(!membership||membership.active!==true||!['manager','member'].includes(membership.member_duty)||String(membership.organization_id||'')!==projectOrganization)throw new Error('负责人必须是当前项目组织内的有效成员');
 let ownerPositionAssignmentId=item.owner_position_assignment_id||null;
 const roleFieldProvided=Object.prototype.hasOwnProperty.call(ctx.input,'owner_position_assignment_id');
 if(roleFieldProvided||ownerId!==String(item.owner_id||'')){
  const roleAssignment=await resolveProjectPositionAssignment(item.project_id,membership.id,ownerId,projectOrganization,roleFieldProvided?ctx.input.owner_position_assignment_id:null,!roleFieldProvided);
  if(!roleAssignment||!await projectPositionHasTaskExecution(roleAssignment.position_id))throw new Error('该岗位没有项目执行权限');
  ownerPositionAssignmentId=roleAssignment&&roleAssignment.id||null;
 }
 const durationDays=Math.floor((Date.parse(dueOn+'T00:00:00.000Z')-Date.parse(item.planned_start_on+'T00:00:00.000Z'))/86400000);
 const changed=await ctx.api.object('forge_project_work_item').update({name,description,task_type:taskTypeOption.id,owner_id:ownerId,owner_position_assignment_id:ownerPositionAssignmentId,priority,planned_end_on:dueOn,duration_days:durationDays,estimated_hours:estimatedHours},{multi:true,where:{id,project_id:item.project_id,plan_id:item.plan_id,item_type:'task',updated_at:{$gte:new Date(versionTime).toISOString(),$lt:new Date(versionTime+1).toISOString()}}});
 if(changed!==1)throw new Error('项目任务已被修改，请刷新后重试');
 return{id,status:'updated',project_id:item.project_id,plan_id:item.plan_id,owner_id:ownerId,priority,planned_end_on:dueOn,estimated_hours:estimatedHours};
});
` },
});

const defaultProjectTaskTypes = [
  ['project_task_type_1', '方案设计'], ['project_task_type_2', '测试验证'], ['project_task_type_3', '文档编写'],
  ['project_task_type_4', '培训交付'], ['project_task_type_5', '问题处理'], ['project_task_type_6', '沟通协调'],
  ['project_task_type_7', '评审会议'], ['project_task_type_8', '开发实施'], ['project_task_type_9', '其他'],
  ['project_task_type_10', '外部协调'], ['project_task_type_11', '需求分析'],
].map(([code, name], index) => ({ code, name, sort_order: index + 1 }));

export const ProjectTaskTypeInitialize = defineAction({
  name: 'project_task_types_initialize', label: '初始化任务类别', objectName: 'forge_business_setting_option', icon: 'list-plus',
  requiredPermissions: ['forge_project_settings_manage'], locations: [], refreshAfter: true,
  description: '为当前组织补齐项目任务管理的默认类别；保留已存在的组织内配置。', successMessage: '项目任务类别已检查',
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const actor=String((ctx.session&&ctx.session.userId)||(ctx.user&&ctx.user.id)||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(!actor||!organizationId)throw new Error('无法确认当前操作人和组织');
const defaults=${JSON.stringify(defaultProjectTaskTypes)};
return await ctx.api.transaction(async()=>{
 const options=ctx.api.object('forge_business_setting_option');
 const existing=await options.find({where:{organization_id:organizationId,scope:'project',setting_type:'task_type'}});
 const byCode=new Map();
 for(const row of existing){const code=String(row.code||'');if(!code)continue;const prior=byCode.get(code);if(prior&&(prior.scope!=='project'||prior.setting_type!=='task_type'||String(prior.organization_id||'')!==organizationId))throw new Error('组织内任务类别编码冲突，请先核对项目配置：'+code);byCode.set(code,row);}
 for(const definition of defaults){const collision=await options.findOne({where:{organization_id:organizationId,code:definition.code}});if(collision&&(collision.scope!=='project'||collision.setting_type!=='task_type'))throw new Error('组织内任务类别编码已用于其他配置，请先核对项目配置：'+definition.code);}
 let createdCount=0,preservedCount=0;
 for(const definition of defaults){if(byCode.has(definition.code)){preservedCount++;continue;}const created=await options.insert({organization_id:organizationId,scope:'project',setting_type:'task_type',code:definition.code,name:definition.name,enabled:true,system_record:true,sort_order:definition.sort_order,description:'项目任务默认类别'});if(!created)throw new Error('项目任务类别创建失败：'+definition.code);createdCount++;}
 return{status:'initialized',created_count:createdCount,preserved_count:preservedCount};
});
` },
});

export const ProjectWorkItemDelete = defineAction({
  name: 'project_work_item_delete', label: '删除工作项', objectName: 'forge_project_work_item', icon: 'trash-2',
  requiredPermissions: ['forge_project_manager'],
  locations: [...locations], order: 90, visible: `record.status != 'completed'`, refreshAfter: true,
  confirmText: '删除后无法恢复。阶段下仍有任务或里程碑时必须先处理下级工作项。确认删除？', successMessage: '计划工作项已删除',
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const item = ctx.record;
if (ctx.recordLoadDenied === true || !id || !item) throw new Error('当前工作项不存在或不可访问');
if (item.status === 'completed') throw new Error('已完成工作项不能删除');
return await ctx.api.transaction(async()=>{
const children = await ctx.api.object('forge_project_work_item').find({ where: { parent_id: id } });
if (children.length) throw new Error('当前阶段仍有任务或里程碑，请先处理下级工作项');
const reports = await ctx.api.object('forge_project_daily_report').find({ where: { work_item_id: id } });
if (reports.length) throw new Error('当前工作项已有日报记录，不能删除');
const siblings = await ctx.api.object('forge_project_work_item').find({ where: { plan_id: item.plan_id } });
for (const sibling of siblings) {
  const predecessors = Array.isArray(sibling.predecessor_ids) ? sibling.predecessor_ids : [];
  if (predecessors.includes(id)) throw new Error('当前工作项仍被其他任务设为前置任务，不能删除');
}
  await ctx.api.object('forge_project_work_item').delete({ where: { id } });
  const remainingCount = siblings.filter(sibling => sibling.id !== id).length;
  const plan = await ctx.api.object('forge_project_plan').findOne({ where: { id: item.plan_id } });
  if (!plan) throw new Error('工作项删除后未能读取计划汇总');
  return { id, plan_id: item.plan_id, deleted: true, item_count: remainingCount, plan_progress: Number(plan.progress || 0) };
});
` },
});

export const ProjectWorkItemUpdateProgress = defineAction({
  name: 'project_work_item_update_progress', label: '更新进度', objectName: 'forge_project_work_item', icon: 'gauge',
  locations: [...locations], order: 10, visible: `record.item_type != 'phase'`, refreshAfter: true,
  description: '更新完成度、状态和实际日期，并回算计划与项目进度；尚未开始的新增工作项不立即拉低阶段进度。', successMessage: '工作项进度已更新',
  params: [
    { field: 'progress', objectOverride: 'forge_project_work_item', required: true },
    { field: 'status', objectOverride: 'forge_project_work_item' },
    { field: 'actual_start_on', objectOverride: 'forge_project_work_item' },
    { field: 'actual_end_on', objectOverride: 'forge_project_work_item' },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const item = ctx.record;
if (ctx.recordLoadDenied === true || !id || !item) throw new Error('当前工作项不存在或不可访问');
if (item.item_type === 'phase') throw new Error('阶段进度由下级任务和里程碑自动汇总');
return await ctx.api.transaction(async()=>{
const actor=String((ctx.session&&ctx.session.userId)||(ctx.user&&ctx.user.id)||''),organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||''),permissions=Array.isArray(ctx.user&&ctx.user.systemPermissions)?ctx.user.systemPermissions:[],hasWorkMember=permissions.includes('forge_project_work_member'),hasProjectManager=permissions.includes('forge_project_manager');
if(!actor||!organizationId||String(item.organization_id||'')!==organizationId)throw new Error('当前项目工作项不属于登录组织');
const project=await ctx.api.object('forge_project').findOne({where:{id:item.project_id,organization_id:organizationId}});if(!project)throw new Error('所属项目不存在或不可访问');
const membership=await ctx.api.object('forge_project_member').findOne({where:{project_id:item.project_id,organization_id:organizationId,user_id:actor,active:true}});
if(!membership||membership.active!==true||String(membership.organization_id||'')!==organizationId)throw new Error('仅当前项目有效成员可以更新任务进度');
const isProjectManager=hasProjectManager&&String(project.manager_id||'')===actor;
if(!isProjectManager&&(!hasWorkMember||String(item.owner_id||'')!==actor))throw new Error('项目成员只能更新分配给本人的任务进度');
const progress = Number(ctx.input.progress);
if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error('完成度必须在 0 到 100 之间');
let status = ctx.input.status || (progress === 0 ? 'pending' : (progress === 100 ? 'completed' : 'in_progress'));
if (!['pending','in_progress','completed','delayed','cancelled'].includes(status)) throw new Error('工作项状态不合法');
if (status === 'completed' && progress !== 100) throw new Error('已完成工作项的完成度必须是 100');
if (status === 'pending' && progress !== 0) throw new Error('未开始工作项的完成度必须是 0');
let actualStart = ctx.input.actual_start_on || item.actual_start_on || null;
let actualEnd = ctx.input.actual_end_on || item.actual_end_on || null;
if (progress > 0 && !actualStart) throw new Error('开始推进任务时必须填写实际开始日期');
if (status === 'completed' && !actualEnd) throw new Error('完成任务时必须填写实际完成日期');
if (actualEnd && !actualStart) throw new Error('填写实际完成日期前必须先有实际开始日期');
if (actualStart && actualEnd && actualEnd < actualStart) throw new Error('实际完成日期不得早于实际开始日期');
await ctx.api.object('forge_project_work_item').update({ id, progress, status, actual_start_on: actualStart, actual_end_on: actualEnd });
const phase = item.parent_id ? await ctx.api.object('forge_project_work_item').findOne({where:{id:item.parent_id}}) : null;
const plan = await ctx.api.object('forge_project_plan').findOne({where:{id:item.plan_id}});
if(!plan)throw new Error('任务进度已更新，但项目计划汇总不可读取');
return { id, progress, status, actual_start_on: actualStart, actual_end_on: actualEnd, phase_progress: phase ? Number(phase.progress||0) : null, plan_progress: Number(plan.progress||0) };
});
` },
});

export const ProjectPlanSubmitDailyReport = defineAction({
  name: 'project_plan_submit_daily_report', label: '提交日报', objectName: 'forge_project_plan', icon: 'notebook-pen',
  locations: [...locations], order: 20, visible: `record.status == 'active'`, refreshAfter: true,
  description: '提交进度页中已观察到的日报字段。附件字段保留页面提示的 20MB 边界。', successMessage: '项目日报已提交',
  params: [
    { field: 'work_item_id', objectOverride: 'forge_project_daily_report', required: true },
    { field: 'reporter_id', objectOverride: 'forge_project_daily_report', required: true },
    { field: 'report_on', objectOverride: 'forge_project_daily_report', required: true },
    { field: 'completed_today', objectOverride: 'forge_project_daily_report', required: true },
    { field: 'completion_percent', objectOverride: 'forge_project_daily_report', required: true },
    { field: 'blockage', objectOverride: 'forge_project_daily_report' }, { field: 'assistance_needed', objectOverride: 'forge_project_daily_report' },
    { field: 'expected_finish_changed', objectOverride: 'forge_project_daily_report', defaultValue: false },
    { field: 'expected_finish_on', objectOverride: 'forge_project_daily_report' }, { field: 'attachment', objectOverride: 'forge_project_daily_report' },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const planId = ctx.recordId || (ctx.record && ctx.record.id); const plan = ctx.record;
if (ctx.recordLoadDenied === true || !planId || !plan) throw new Error('当前项目计划不存在或不可访问');
if (plan.status !== 'active') throw new Error('仅执行中的计划可以提交日报');
const actor=String((ctx.session&&ctx.session.userId)||(ctx.user&&ctx.user.id)||''),organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||''),permissions=Array.isArray(ctx.user&&ctx.user.systemPermissions)?ctx.user.systemPermissions:[],hasWorkMember=permissions.includes('forge_project_work_member'),hasProjectManager=permissions.includes('forge_project_manager');
if(!actor||!organizationId)throw new Error('无法识别当前日报填报人和组织');
const project=await ctx.api.object('forge_project').findOne({where:{id:plan.project_id,organization_id:organizationId}});if(!project||String(project.organization_id||'')!==organizationId)throw new Error('项目不存在或不属于当前组织');
const membership=await ctx.api.object('forge_project_member').findOne({where:{project_id:project.id,organization_id:organizationId,user_id:actor,active:true}});
if(!membership||membership.active!==true||String(membership.organization_id||'')!==organizationId)throw new Error('仅当前项目有效成员可以提交日报');
const isProjectManager=hasProjectManager&&String(project.manager_id||'')===actor;
if(!isProjectManager&&!hasWorkMember)throw new Error('当前岗位没有项目日报办理权限');
if(String(ctx.input.reporter_id||'')!==actor)throw new Error('日报填报人必须是当前登录员工');
if (!ctx.input.completed_today || !String(ctx.input.completed_today).trim()) throw new Error('今日完成内容为必填');
const item = await ctx.api.object('forge_project_work_item').findOne({ where: { id: ctx.input.work_item_id } });
if (!item || item.plan_id !== planId || item.item_type === 'phase') throw new Error('日报工作项必须是当前计划中的任务或里程碑');
if(!isProjectManager&&String(item.owner_id||'')!==actor)throw new Error('项目成员只能为分配给本人的任务提交日报');
const progress = Number(ctx.input.completion_percent);
if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error('完成度必须在 0 到 100 之间');
const changed = ctx.input.expected_finish_changed === true;
if (changed && !ctx.input.expected_finish_on) throw new Error('预计完成日期变化时必须填写调整后的日期');
const reportOn = String(ctx.input.report_on||'').trim();if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(reportOn))throw new Error('日报日期必须填写组织业务日期');
const created = await ctx.api.object('forge_project_daily_report').insert({
  name: reportOn + ' ' + item.name + ' 日报', report_key: planId + ':' + item.id + ':' + reportOn + ':' + Date.now(),
  project_id: plan.project_id, plan_id: planId, work_item_id: item.id, reporter_id: ctx.input.reporter_id, report_on: reportOn,
  completed_today: String(ctx.input.completed_today).trim(), completion_percent: progress,
  blockage: ctx.input.blockage || null, assistance_needed: ctx.input.assistance_needed || null,
  expected_finish_changed: changed, expected_finish_on: changed ? ctx.input.expected_finish_on : null,
  attachment: ctx.input.attachment || null, owner_id: actor,
});
const reportId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
if (!reportId) throw new Error('日报创建后未返回记录ID');
return { id: reportId, plan_id: planId, work_item_id: item.id, report_on: reportOn, completion_percent: progress };
` },
});

export const ProjectPlanSaveAsTemplate = defineAction({
  name: 'project_plan_save_as_template', label: '保存为计划模板', objectName: 'forge_project_plan', icon: 'copy-check',
  requiredPermissions: ['forge_project_manager'],
  locations: [...locations], order: 80, visible: `record.status == 'active'`, refreshAfter: true,
  description: '把当前计划的阶段、里程碑和任务保存为可复用模板。', successMessage: '计划模板已保存',
  params: [{ field: 'template_name', objectOverride: 'forge_project_plan_template', required: true }, { name: 'category', label: '模板分类', type: 'select', options: [{ value: 'custom', label: '自定义模板' }, { value: 'project_copy', label: '项目复制' }], defaultValue: 'custom' }],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const planId = ctx.recordId || (ctx.record && ctx.record.id); const plan = ctx.record;
if (!planId || !plan || plan.status !== 'active') throw new Error('仅执行中的项目计划可以保存为模板');
const name = String(ctx.input.template_name || '').trim(); if (!name) throw new Error('模板名称不能为空');const category=String(ctx.input.category||'custom');if(!['custom','project_copy'].includes(category))throw new Error('普通项目成员不能创建系统模板');
const items = await ctx.api.object('forge_project_work_item').find({ where: { plan_id: planId } });
if (!items.length) throw new Error('当前计划没有可保存的阶段或工作项');
const structure = items.map(x => ({ source_id:x.id, item_type:x.item_type, name:x.name, description:x.description || null, parent_id:x.parent_id || null, predecessor_ids:Array.isArray(x.predecessor_ids)?x.predecessor_ids:[], owner_id:x.owner_id || null, owner_position_assignment_id:x.owner_position_assignment_id || null, task_type:x.task_type || null, priority:x.priority || null, estimated_hours:x.estimated_hours == null ? null : Number(x.estimated_hours), planned_start_on:x.planned_start_on, planned_end_on:x.planned_end_on, duration_days:x.duration_days || 0, weight:Number(x.weight || 0), critical_path:x.critical_path === true, planned_deliverable:x.planned_deliverable || null, sort_order:Number(x.sort_order || 0) }));
const created = await ctx.api.object('forge_project_plan_template').insert({ name, template_key: planId + ':T' + Date.now(), category, source_plan_id: planId, source_project_id: plan.project_id, structure_json: JSON.stringify(structure), item_count: structure.length, status: 'active', remarks: '由项目计划保存' });
const id = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
return { id, name, item_count: structure.length, source_plan_id: planId };
` },
});

export const ProjectPlanApplyTemplate = defineAction({
  name: 'project_plan_apply_template', label: '套用计划模板', objectName: 'forge_project_plan', icon: 'copy-plus',
  requiredPermissions: ['forge_project_manager'],
  locations: [...locations], order: 70, visible: `record.status == 'active'`, refreshAfter: true,
  description: '将模板中的阶段、里程碑和任务复制到当前执行计划。', successMessage: '计划模板已套用',
  params: [{ field: 'template_id', objectOverride: 'forge_project_plan_template', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `${projectPlanTemplateApplyQuickJs}
const planId=ctx.recordId||(ctx.record&&ctx.record.id),plan=ctx.record,actor=String(ctx.session&&ctx.session.userId||''),organizationId=String(ctx.session&&ctx.session.organizationId||'');
if(ctx.recordLoadDenied===true||!planId||!plan||plan.status!=='active')throw new Error('仅执行中的项目计划可以套用模板');
if(!actor||!organizationId||String(plan.organization_id||'')!==organizationId)throw new Error('当前计划缺少有效组织或负责人上下文');
return await ctx.api.transaction(async()=>{const applied=await applyProjectPlanTemplate(ctx,planId,plan,ctx.input.template_id,plan.planned_start_on,null,organizationId,actor);return{id:planId,...applied};});` },
});

/** Create a plan and its template-derived work items in the same transaction. */
export const ProjectCreatePlanFromTemplate = defineAction({
  name: 'project_create_plan_from_template', label: '从计划模板创建计划', objectName: 'forge_project', icon: 'copy-plus',
  requiredPermissions: ['forge_project_manager'], locations: [], refreshAfter: true,
  description: '在当前项目没有执行中计划时，从本人模板或本组织系统模板创建计划。', successMessage: '项目计划已创建',
  params: [
    { name: 'template_id', label: '计划模板', type: 'lookup', reference: 'forge_project_plan_template', required: true },
    { name: 'planned_start_on', label: '计划开始日期', type: 'date', required: true },
    { name: 'assignment_map_json', label: '计划成员岗位映射', type: 'textarea', required: false },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `${projectManagerGuard}
${projectPlanTemplateApplyQuickJs}
const projectId=String(ctx.recordId||(ctx.record&&ctx.record.id)||''),project=ctx.record,actor=String(ctx.session&&ctx.session.userId||''),organizationId=String(ctx.session&&ctx.session.organizationId||''),plannedStart=projectPlanIsoDate(ctx.input.planned_start_on);
if(!projectId||!project||projectId!==String(project.id||'')||!actor||!organizationId)throw new Error('当前项目不存在或不可访问');
if(project.organization_id!==organizationId)throw new Error('项目不属于当前组织');
if(!['in_progress','paused'].includes(project.status))throw new Error('仅进行中或已暂停项目可以创建计划');
if(!plannedStart)throw new Error('请选择有效的计划开始日期');
const templateId=String(ctx.input.template_id||'').trim();if(!templateId)throw new Error('请选择计划模板');
return await ctx.api.transaction(async()=>{
 const liveProject=await ctx.api.object('forge_project').findOne({where:{id:projectId,organization_id:organizationId,manager_id:actor}});
 if(!liveProject||liveProject.status!==project.status||String(liveProject.updated_at||'')!==String(project.updated_at||''))throw new Error('项目资料已变化或当前账号已不再是项目经理，请刷新后重试');
 const plans=ctx.api.object('forge_project_plan'),existing=await plans.find({where:{project_id:projectId,organization_id:organizationId},limit:1000});
 if(!Array.isArray(existing)||existing.length>=1000)throw new Error('项目计划历史过多，暂不能创建新计划');
 if(existing.some(row=>row.status==='active'))throw new Error('当前项目已经存在执行中的计划');
 const revision=existing.reduce((max,row)=>Math.max(max,Number(row.revision)||0),0)+1,planKey=projectId+':R'+revision;
 const created=await plans.insert({name:String(liveProject.name||'项目')+'计划 V'+revision,plan_key:planKey,project_id:projectId,organization_id:organizationId,source:'custom_template',revision,planned_start_on:plannedStart,planned_end_on:plannedStart,status:'active',item_count:0,progress:0,remarks:'从计划模板创建'});
 const planId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));if(!planId)throw new Error('项目计划创建后未返回记录ID');
 const plan={id:planId,project_id:projectId,organization_id:organizationId,planned_start_on:plannedStart,planned_end_on:plannedStart,status:'active'};
 const applied=await applyProjectPlanTemplate(ctx,planId,plan,templateId,plannedStart,ctx.input.assignment_map_json,organizationId,actor);
 return{id:planId,project_id:projectId,revision,source:applied.source,item_count:applied.item_count,planned_start_on:applied.planned_start_on,planned_end_on:applied.planned_end_on};
});` },
});
