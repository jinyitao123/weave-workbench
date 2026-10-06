import { defineAction } from '@objectstack/spec';
import { projectPositionAssignmentQuickJsHelpers } from './project-member-position-assignment.action.js';
import { projectTimeCostSharedHelpers } from './project-time-cost.action.js';

const locations = ['record_header', 'record_more'] as const;

export const ProjectRecordTimesheet = defineAction({
  name: 'project_record_timesheet', label: '填报项目工时', objectName: 'forge_project', icon: 'clock-3', locations: [...locations], order: 100,
  requiredPermissions: ['forge_project_work_member'],
  visible: `record.status != 'settled' && record.status != 'terminated' && record.status != 'archived'`, refreshAfter: true,
  params: [
    { field: 'code', objectOverride: 'forge_project_timesheet', required: true }, { field: 'worker_id', objectOverride: 'forge_project_timesheet', required: true },
    { field: 'worker_position_assignment_id', objectOverride: 'forge_project_timesheet' },
    { field: 'work_item_id', objectOverride: 'forge_project_timesheet' }, { field: 'work_on', objectOverride: 'forge_project_timesheet', required: true },
    { field: 'work_content', objectOverride: 'forge_project_timesheet', required: true }, { field: 'time_type', objectOverride: 'forge_project_timesheet', required: true, defaultValue: 'normal' },
    { field: 'hours', objectOverride: 'forge_project_timesheet', required: true }, { field: 'hourly_rate', objectOverride: 'forge_project_timesheet' },
    { field: 'remarks', objectOverride: 'forge_project_timesheet' },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.project/page_project_timesheet_cost?timesheet=${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `${projectPositionAssignmentQuickJsHelpers}
${projectTimeCostSharedHelpers}
const projectId=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim(),initial=ctx.record;
const actor=String((ctx.session&&ctx.session.userId)||(ctx.user&&ctx.user.id)||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(ctx.recordLoadDenied===true||!projectId||!initial)throw new Error('当前项目不存在或不可访问');
if(!actor||!organizationId)throw new Error('无法确认当前填报人和组织');
const code=String(ctx.input.code||'').trim(),workerId=String(ctx.input.worker_id||'').trim(),workOn=String(ctx.input.work_on||'').trim(),workContent=String(ctx.input.work_content||'').trim();
const timeType=String(ctx.input.time_type||'normal'),hours=Number(ctx.input.hours),manualRate=ctx.input.hourly_rate==null||ctx.input.hourly_rate===''?null:Number(ctx.input.hourly_rate);
if(!code)throw new Error('工时单号不能为空');
if(workerId!==actor)throw new Error('项目成员只能填报本人实际工时');
if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(workOn)||!Number.isFinite(Date.parse(workOn+'T00:00:00Z')))throw new Error('工时日期无效');
if(!workContent)throw new Error('工作内容不能为空');
if(!['normal','overtime','travel'].includes(timeType))throw new Error('工时类型无效');
if(!(hours>=0.25&&hours<=24)||!Number.isFinite(hours))throw new Error('单条工时必须在0.25至24小时之间');
return await ctx.api.transaction(async()=>{
 const projects=ctx.api.object('forge_project'),members=ctx.api.object('forge_project_member'),timesheets=ctx.api.object('forge_project_timesheet');
 const project=await projects.findOne({where:{id:projectId,organization_id:organizationId}});
 if(!project||String(project.organization_id||'')!==organizationId)throw new Error('项目不存在或不属于当前组织');
 if(['settled','terminated','archived'].includes(project.status))throw new Error('已结算、已终止或已归档项目不可填报工时');
 const member=await members.findOne({where:{project_id:projectId,organization_id:organizationId,user_id:actor,active:true}});
 if(!member||member.active!==true)throw new Error('填报人必须是当前项目的有效成员');
 const nativeMember=await ctx.api.object('sys_member').findOne({where:{user_id:actor,organization_id:organizationId}});
 if(!nativeMember||String(nativeMember.organization_id||'')!==organizationId||String(nativeMember.user_id||'')!==actor)throw new Error('填报人必须是当前组织的原生成员');
 const roleAssignment=await resolveProjectPositionAssignment(projectId,member.id,actor,organizationId,ctx.input.worker_position_assignment_id,true);
 const feeQuote=await projectTimesheetFeeQuote({projectId,memberId:String(nativeMember.id),workerId:actor,positionAssignment:roleAssignment,timeType,workOn});
 const rate=feeQuote.configured?Number(feeQuote.rate):manualRate;
 if(rate===null||!Number.isFinite(rate)||rate<0)throw new Error(feeQuote.reason||'工时费率不得小于0');
 const expectedCost=Math.round((hours*rate+Number.EPSILON)*100)/100;
 const currentSheets=await timesheets.find({where:{organization_id:organizationId,worker_id:actor,work_on:workOn},limit:1001});
 if(!Array.isArray(currentSheets)||currentSheets.length>1000)throw new Error('当日工时记录超过可核对范围，请联系管理员');
 const dayRows=currentSheets.filter(row=>row.status!=='rejected'),dayHours=dayRows.reduce((sum,row)=>sum+Number(row.hours||0),0),normalHours=dayRows.filter(row=>row.time_type==='normal').reduce((sum,row)=>sum+Number(row.hours||0),0);
 const dailyLimit=feeQuote.settings&&feeQuote.settings.max_hours_per_day;
 if(dailyLimit!=null&&Number.isFinite(Number(dailyLimit))&&dayHours+hours>Number(dailyLimit)+0.0001)throw new Error('当日总工时将超过组织设定上限');
 const normalLimit=feeQuote.settings&&(feeQuote.settings.overtime_start_after_hours??feeQuote.settings.standard_hours_per_day);
 if(timeType==='normal'&&normalLimit!=null&&Number.isFinite(Number(normalLimit))&&normalHours+hours>Number(normalLimit)+0.0001)throw new Error('正常工时将超过每日加班起算时长，请将加班部分按加班工时记录');
 if(timeType==='overtime'&&normalLimit!=null&&Number.isFinite(Number(normalLimit))&&normalHours+0.0001<Number(normalLimit))throw new Error('请先补齐每日标准工时，再登记加班工时');
 if(feeQuote.configured&&feeQuote.monthlyHoursLimit!=null){const monthStart=workOn.slice(0,7)+'-01',monthEnd=new Date(Date.UTC(Number(workOn.slice(0,4)),Number(workOn.slice(5,7)),0)).toISOString().slice(0,10),monthRows=await timesheets.find({where:{organization_id:organizationId,worker_id:actor,position_id_snapshot:roleAssignment&&roleAssignment.position_id,work_on:{$gte:monthStart,$lte:monthEnd}},limit:2001});if(!Array.isArray(monthRows)||monthRows.length>2000)throw new Error('当月岗位工时超过可核对范围，请联系管理员');const used=monthRows.filter(row=>row.status!=='rejected').reduce((sum,row)=>sum+Number(row.hours||0),0);if(used+hours>feeQuote.monthlyHoursLimit+0.0001)throw new Error('当月工时将超过该岗位设置的月工时上限');}
 if(ctx.input.work_item_id){
  const item=await ctx.api.object('forge_project_work_item').findOne({where:{id:ctx.input.work_item_id,organization_id:organizationId}});
  if(!item||String(item.project_id||'')!==projectId||item.item_type!=='task')throw new Error('关联任务必须是当前项目有效任务');
 }
 const created=await timesheets.insert({
  name:String(project.code||project.name)+' '+workOn+' 工时',code,organization_id:organizationId,project_id:projectId,
  work_item_id:ctx.input.work_item_id||null,worker_id:actor,worker_position_assignment_id:roleAssignment&&roleAssignment.id||null,worker_position_name_snapshot:roleAssignment&&roleAssignment.position_name_snapshot||null,position_id_snapshot:roleAssignment&&roleAssignment.position_id||null,work_on:workOn,work_content:workContent,time_type:timeType,
  hours,hourly_rate:rate,fee_source_snapshot:feeQuote.configured?feeQuote.source:'manual_entry',fee_member_rule_id_snapshot:feeQuote.memberRuleId||null,fee_role_rule_id_snapshot:feeQuote.roleRuleId||null,fee_role_revision_snapshot:feeQuote.roleRevision||null,fee_project_override_id_snapshot:feeQuote.projectOverrideId||null,fee_settings_revision_snapshot:feeQuote.settingsRevision||null,fee_base_rate_snapshot:feeQuote.configured?feeQuote.baseRate:rate,fee_multiplier_snapshot:feeQuote.multiplier??null,fee_management_uplift_snapshot:feeQuote.uplift??null,cost_amount:expectedCost,status:'draft',approval_status:null,approval_manager_id:null,
  submitted_at:null,reviewed_at:null,reviewer_id:null,review_comment:null,owner_id:actor,responsible_id:actor,remarks:ctx.input.remarks||null,
 });
 const id=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));
 if(!id)throw new Error('工时记录创建后未返回ID');
 return{id,project_id:projectId,worker_id:actor,status:'draft',hours,hourly_rate:rate,fee_source:feeQuote.configured?feeQuote.source:'manual_entry',fee_rule_revision:feeQuote.roleRevision||null,cost_amount:expectedCost};
});
` },
});

export const ProjectTimesheetSubmit = defineAction({
  name: 'project_timesheet_submit', label: '提交审核', objectName: 'forge_project_timesheet', icon: 'send', locations: [...locations], order: 10,
  requiredPermissions: ['forge_project_work_member'], visible: `record.status == 'draft'`, refreshAfter: true,
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `${projectTimeCostSharedHelpers}
const id=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim(),initial=ctx.record;
const actor=String((ctx.session&&ctx.session.userId)||(ctx.user&&ctx.user.id)||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(ctx.recordLoadDenied===true||!id||!initial)throw new Error('工时记录不存在或不可访问');
if(!actor||!organizationId)throw new Error('无法确认当前提交人和组织');
if(initial.status!=='draft')throw new Error('仅草稿工时可以提交');
if(String(initial.worker_id||'')!==actor||String(initial.responsible_id||'')!==actor)throw new Error('仅本人工时草稿可以提交');
const expectedUpdatedAt=String(initial.updated_at||''),expectedTime=Date.parse(expectedUpdatedAt);
if(!Number.isFinite(expectedTime))throw new Error('工时记录读取版本无效');
const timesheets=ctx.api.object('forge_project_timesheet'),projects=ctx.api.object('forge_project'),members=ctx.api.object('forge_project_member');
const sheet=await timesheets.findOne({where:{id,organization_id:organizationId}});
 if(!sheet||String(sheet.organization_id||'')!==organizationId||sheet.status!=='draft'||String(sheet.updated_at||'')!==expectedUpdatedAt)throw new Error('工时记录已变化或不再是草稿，请刷新后重试');
 if(String(sheet.worker_id||'')!==actor||String(sheet.responsible_id||'')!==actor)throw new Error('仅本人工时草稿可以提交');
 const project=await projects.findOne({where:{id:sheet.project_id,organization_id:organizationId}});
 if(!project||String(project.organization_id||'')!==organizationId)throw new Error('关联项目不存在或不属于当前组织');
 if(['settled','terminated','archived'].includes(project.status))throw new Error('已结算、已终止或已归档项目不可提交工时');
 const worker=await members.findOne({where:{project_id:project.id,organization_id:organizationId,user_id:actor,active:true}});
 if(!worker||worker.active!==true)throw new Error('工时人员已不属于当前项目有效团队');
 const managerId=String(project.manager_id||'').trim();
 if(!managerId)throw new Error('项目当前没有负责人，不能发起原生审批');
 const manager=await members.findOne({where:{project_id:project.id,organization_id:organizationId,user_id:managerId,member_duty:'manager',active:true}});
 if(!manager||manager.active!==true||manager.member_duty!=='manager')throw new Error('项目负责人不是当前有效团队成员，不能发起原生审批');
 const hours=Number(sheet.hours),rate=Number(sheet.hourly_rate),cost=Number(sheet.cost_amount);
 if(!(hours>=0.25&&hours<=24)||!Number.isFinite(rate)||rate<0||!Number.isFinite(cost)||cost<0)throw new Error('工时或费率数据无效');
 const expectedCost=Math.round((hours*rate+Number.EPSILON)*100)/100;
 if(Math.abs(expectedCost-cost)>0.01)throw new Error('工时成本与本单费率不一致');
const settings=await timeCostSettings(),threshold=settings&&settings.auto_approval_threshold_hours,autoEligible=threshold!==null&&threshold!==undefined&&threshold!==''&&Number.isFinite(Number(threshold))&&hours<=Number(threshold)+0.0001;
const changed=await timesheets.update({status:'pending_review',approval_status:null,approval_manager_id:autoEligible?null:managerId,approval_manager_snapshot:managerId,auto_approval_eligible_snapshot:autoEligible,auto_approval_threshold_snapshot:threshold==null?null:Number(threshold),auto_approval_settings_revision_snapshot:settings?Number(settings.revision):null,submitted_at:new Date().toISOString()},{multi:true,where:{id,organization_id:organizationId,project_id:project.id,worker_id:actor,responsible_id:actor,status:'draft',updated_at:{$gte:new Date(expectedTime).toISOString(),$lt:new Date(expectedTime+1).toISOString()}}});
if(changed!==1)throw new Error('工时记录已被修改，请刷新后重试');
return{id,status:'pending_review',approval_manager_id:autoEligible?null:managerId,automatic:!!autoEligible,auto_approval_threshold_hours:threshold==null?null:Number(threshold)};
` },
});
