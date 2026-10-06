import { defineAction } from '@objectstack/spec';
import { projectPositionAssignmentQuickJsHelpers } from './project-member-position-assignment.action.js';

export const projectTimeCostSharedHelpers = `
function feeText(value){return value==null?'':String(value).trim();}
function feeNumber(value,label,{required=true,min=0,max=Number.MAX_SAFE_INTEGER}={}){if(value==null||value===''){if(required)throw new Error(label+'不能为空');return null;}const number=Number(value);if(!Number.isFinite(number)||number<min||number>max)throw new Error(label+'数值无效');return number;}
function feeDate(value,label){const date=feeText(value);if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date))throw new Error(label+'必须是有效日期');const parsed=new Date(date+'T00:00:00.000Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)throw new Error(label+'必须是有效日期');return date;}
function dateBefore(value){const date=new Date(value+'T00:00:00.000Z');date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10);}
function feeEffective(row,date){const from=feeText(row.effective_from),to=feeText(row.effective_to);return Boolean(from&&from<=date&&(!to||date<=to));}
function maxRevision(rows){return rows.reduce((max,row)=>Math.max(max,Number(row.revision||0)),0);}
function rowObject(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
async function timeCostSettings(){const rows=await ctx.api.object('forge_project_time_cost_settings').find({where:{organization_id:organizationId},orderBy:[{field:'revision',order:'desc'}],limit:1001});if(!Array.isArray(rows)||rows.length>1000)throw new Error('工时成本设置历史超过可核对范围');const active=rows.filter(row=>row.active===true);if(active.length>1)throw new Error('组织存在多个有效工时成本配置，请先核对');return active[0]||null;}
async function effectiveOne(objectName,where,date,label){const rows=await ctx.api.object(objectName).find({where:{...where,organization_id:organizationId},orderBy:[{field:'revision',order:'desc'},{field:'id',order:'desc'}],limit:501});if(!Array.isArray(rows)||rows.length>500)throw new Error(label+'历史超过可核对范围');const active=rows.filter(row=>feeEffective(row,date));if(active.length>1)throw new Error(label+'在当前日期存在重复有效配置');return active[0]||null;}
async function projectTimesheetFeeQuote(args){
 const {projectId,memberId,workerId,positionAssignment,timeType,workOn}=args;
 const date=feeDate(workOn,'工时日期');
 const settings=await timeCostSettings();
 const positionId=feeText(positionAssignment&&positionAssignment.position_id);
 if(!positionId)return{configured:false,source:'manual',reason:'当前项目成员没有默认岗位费率，请按本单费率填报',settings};
 const membership=await ctx.api.object('sys_member').findOne({where:{id:memberId,user_id:workerId,organization_id:organizationId}});
 if(!membership)throw new Error('工时填报人组织成员关系不可用');
 const memberRule=await effectiveOne('forge_project_member_fee',{member_id:memberId,position_id:positionId},date,'员工费率');
 const roleRule=await effectiveOne('forge_project_role_fee',{position_id:positionId},date,'岗位费率');
 let source='role_rate',baseRate=null,memberRuleId=null,roleRuleId=null,roleRevision=null,uplift=null;
 if(memberRule){memberRuleId=feeText(memberRule.id);source='member_role_rate';
  if(memberRule.actual_hourly_rate!==null&&memberRule.actual_hourly_rate!==undefined&&memberRule.actual_hourly_rate!==''){baseRate=Number(memberRule.actual_hourly_rate);source='employee_final_rate';}
  else if(memberRule.pay_method==='salary_reference'){
   const salary=memberRule.monthly_salary;if(salary===null||salary===undefined||salary==='')return{configured:false,source:'manual',reason:'员工薪资参考未配置，请按本单费率填报',settings,memberRuleId};
   if(!settings||settings.management_uplift_percent===null||settings.management_uplift_percent===undefined||settings.management_uplift_percent==='')return{configured:false,source:'manual',reason:'管理加成尚未配置，薪资参考费率未就绪',settings,memberRuleId};
   const monthly=Number(salary);if(!Number.isFinite(monthly)||monthly<0)throw new Error('员工薪资参考值无效');uplift=Number(settings.management_uplift_percent);baseRate=Math.round((monthly/174*(1+uplift/100)+Number.EPSILON)*10000)/10000;source='salary_reference';
  }else{if(!roleRule)return{configured:false,source:'manual',reason:'当前组织尚未配置该岗位费率，请按本单费率填报',settings,memberRuleId};baseRate=Number(roleRule.normal_rate);roleRuleId=feeText(roleRule.id);roleRevision=Number(roleRule.revision);source='role_rate';}
 }else{
  if(!roleRule)return{configured:false,source:'manual',reason:'当前组织尚未配置该岗位费率，请按本单费率填报',settings};
  baseRate=Number(roleRule.normal_rate);roleRuleId=feeText(roleRule.id);roleRevision=Number(roleRule.revision);source='role_rate';
 }
 if(!Number.isFinite(baseRate)||baseRate<0)throw new Error('费率配置数值无效');
 let projectOverride=null;
 if(source==='role_rate'){
  projectOverride=await effectiveOne('forge_project_fee_override',{project_id:projectId,position_id:positionId},date,'项目费率覆盖');
  if(projectOverride){if(feeText(projectOverride.role_fee_id)!==roleRuleId||Number(projectOverride.role_fee_revision)!==roleRevision||Math.abs(Number(projectOverride.base_normal_rate_snapshot)-Number(roleRule.normal_rate))>0.0001)throw new Error('项目费率覆盖引用的岗位费率版本已变化，请重新核对');baseRate=Number(projectOverride.override_normal_rate);source='project_override';}
 }
 let multiplier=null,rate=baseRate;
 if(timeType==='overtime'){
  const day=new Date(date+'T00:00:00.000Z').getUTCDay(),weekend=day===0||day===6;
  const globalMultiplier=settings&&(weekend?settings.weekend_overtime_multiplier:settings.workday_overtime_multiplier);
  const roleMultiplier=roleRule&&roleRule.overtime_multiplier;
  const value=globalMultiplier!==null&&globalMultiplier!==undefined&&globalMultiplier!==''?globalMultiplier:roleMultiplier;
  if(value===null||value===undefined||value==='')return{configured:false,source:'manual',reason:'当前加班倍率未配置，请按本单费率填报',settings,memberRuleId,roleRuleId,roleRevision,projectOverrideId:projectOverride&&projectOverride.id};
  multiplier=Number(value);if(!Number.isFinite(multiplier)||multiplier<0)throw new Error('加班倍率配置无效');rate=baseRate*multiplier;
 }else if(timeType==='travel'){
  if(!roleRule||roleRule.travel_rate===null||roleRule.travel_rate===undefined||roleRule.travel_rate==='')return{configured:false,source:'manual',reason:'当前岗位出差费率未配置，请按本单费率填报',settings,memberRuleId,roleRuleId,roleRevision,projectOverrideId:projectOverride&&projectOverride.id};
  rate=Number(roleRule.travel_rate);source='role_travel_rate';
 }
 if(!Number.isFinite(rate)||rate<0)throw new Error('计算费率无效');
 return{configured:true,source,rate,baseRate,multiplier,uplift,memberRuleId,roleRuleId,roleRevision,projectOverrideId:projectOverride&&feeText(projectOverride.id)||null,projectOverrideRevision:projectOverride?Number(projectOverride.revision):null,settingsRevision:settings?Number(settings.revision):null,monthlyHoursLimit:roleRule&&roleRule.monthly_hours_limit!=null?Number(roleRule.monthly_hours_limit):null,settings};
}
async function closeEffectiveRow(objectName,row,effectiveFrom){const end=dateBefore(effectiveFrom);if(feeText(row.effective_from)>=effectiveFrom)throw new Error('新费率生效日必须晚于现有费率生效日');if(row.effective_to&&feeText(row.effective_to)<end)throw new Error('费率历史区间不连续，请核对后再保存');const updatedAt=feeText(row.updated_at),instant=Date.parse(updatedAt);if(!Number.isFinite(instant))throw new Error('费率读取版本无效');const changed=await ctx.api.object(objectName).update({effective_to:end,active:false},{multi:true,where:{id:row.id,organization_id:organizationId,active:true,updated_at:{$gte:new Date(instant).toISOString(),$lt:new Date(instant+1).toISOString()}}});if(changed!==1)throw new Error('费率规则已被修改，请刷新后重试');}
`;

const feeContext = `
const actor=String((ctx.session&&ctx.session.userId)||(ctx.user&&ctx.user.id)||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(!actor||!organizationId)throw new Error('无法确认当前费率管理人和组织');
${projectTimeCostSharedHelpers}
async function currentNativeOrganizationMember(){const member=await ctx.api.object('sys_member').findOne({where:{user_id:actor,organization_id:organizationId}});if(!member||feeText(member.user_id)!==actor||feeText(member.organization_id)!==organizationId)throw new Error('当前账号不是当前组织的原生成员');return member;}
`;


export const ProjectTimeCostWorkspaceQuery = defineAction({
  name: 'project_time_cost_workspace_query', label: '读取项目工时成本配置',
  locations: [], requiredPermissions: ['forge_project_settings_manage'],
  params: [{ name: 'business_date', label: '组织业务日期', type: 'text', required: true }],
  body: { language: 'js', capabilities: ['api.read'], source: `${feeContext}
const memberships=await ctx.api.object('sys_member').find({where:{organization_id:organizationId},orderBy:[{field:'id',order:'asc'}],limit:1001});if(!Array.isArray(memberships)||memberships.length>1000)throw new Error('组织成员列表超过可读取范围');
await currentNativeOrganizationMember();
const userIds=[...new Set(memberships.map(row=>feeText(row.user_id)).filter(Boolean))],users=userIds.length?await ctx.api.object('sys_user').find({where:{id:{$in:userIds}},limit:1001}):[];if(!Array.isArray(users)||users.length>1000)throw new Error('员工账号列表超过可读取范围');
const positions=await ctx.api.object('sys_position').find({where:{organization_id:organizationId},orderBy:[{field:'label',order:'asc'},{field:'id',order:'asc'}],limit:501});if(!Array.isArray(positions)||positions.length>500)throw new Error('组织岗位目录超过可读取范围');
const appointments=await ctx.api.object('sys_user_position').find({where:{organization_id:organizationId},limit:5001});if(!Array.isArray(appointments)||appointments.length>5000)throw new Error('组织任职列表超过可读取范围');
const today=feeDate(ctx.input.business_date,'组织业务日期');
const userById=new Map(users.filter(user=>user.banned!==true).map(user=>[feeText(user.id),user])),positionByName=new Map(positions.filter(position=>position.active===true).map(position=>[feeText(position.name),position]));
const roster=memberships.filter(member=>userById.has(feeText(member.user_id))).map(member=>{const user=userById.get(feeText(member.user_id)),validPositions=appointments.filter(row=>feeText(row.user_id)===feeText(member.user_id)&&feeText(row.organization_id)===organizationId&&(!row.valid_from||feeText(row.valid_from).slice(0,10)<=today)&&(!row.valid_until||feeText(row.valid_until).slice(0,10)>today)).map(row=>positionByName.get(feeText(row.position))).filter(Boolean);return{member_id:feeText(member.id),user_id:feeText(member.user_id),name:feeText(user.display_name)||feeText(user.name)||feeText(user.username)||'未命名账号',positions:[...new Map(validPositions.map(position=>[feeText(position.id),{id:feeText(position.id),label:feeText(position.label)||feeText(position.name)}])).values()]}}).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
const roleFees=await ctx.api.object('forge_project_role_fee').find({where:{organization_id:organizationId},orderBy:[{field:'position_label_snapshot',order:'asc'},{field:'revision',order:'desc'}],limit:2001});if(!Array.isArray(roleFees)||roleFees.length>2000)throw new Error('岗位费率列表超过可读取范围');
const memberFees=await ctx.api.object('forge_project_member_fee').find({where:{organization_id:organizationId},orderBy:[{field:'member_id',order:'asc'},{field:'revision',order:'desc'}],limit:5001});if(!Array.isArray(memberFees)||memberFees.length>5000)throw new Error('成员费率列表超过可读取范围');
const settings=await timeCostSettings();
return{organization_id:organizationId,business_date:today,roster,positions:positions.map(position=>({id:feeText(position.id),label:feeText(position.label)||feeText(position.name),active:position.active===true})),role_fees:roleFees,member_fees:memberFees,settings};` },
});

export const ProjectTimesheetRateQuote = defineAction({
  name: 'project_timesheet_rate_quote', label: '查询工时费率',
  locations: [], requiredPermissions: ['forge_project_work_member'],
  params: [
    { name: 'project_id', label: '项目', type: 'text', required: true },
    { name: 'position_assignment_id', label: '项目岗位', type: 'text', required: false },
    { name: 'work_on', label: '工时日期', type: 'text', required: true },
    { name: 'time_type', label: '工时类型', type: 'text', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read'], source: `${feeContext}
${projectPositionAssignmentQuickJsHelpers}
const projectId=feeText(ctx.input.project_id),workOn=feeDate(ctx.input.work_on,'工时日期'),timeType=feeText(ctx.input.time_type||'normal');if(!projectId||!['normal','overtime','travel'].includes(timeType))throw new Error('费率查询参数无效');
 const project=await ctx.api.object('forge_project').findOne({where:{id:projectId,organization_id:organizationId}});if(!project||feeText(project.organization_id)!==organizationId)throw new Error('项目不存在或不属于当前组织');
 const member=await ctx.api.object('forge_project_member').findOne({where:{project_id:projectId,organization_id:organizationId,user_id:actor,active:true}});if(!member||member.active!==true)throw new Error('仅当前项目有效成员可以查询本人工时费率');
 const nativeMember=await ctx.api.object('sys_member').findOne({where:{user_id:actor,organization_id:organizationId}});if(!nativeMember||feeText(nativeMember.user_id)!==actor||feeText(nativeMember.organization_id)!==organizationId)throw new Error('当前账号不是当前组织的原生成员');
const assignment=await resolveProjectPositionAssignment(projectId,feeText(member.id),actor,organizationId,ctx.input.position_assignment_id,true);
const quote=await projectTimesheetFeeQuote({projectId,memberId:feeText(nativeMember.id),workerId:actor,positionAssignment:assignment,timeType,workOn});return{...quote,position_id:assignment&&feeText(assignment.position_id)||null,time_type:timeType,work_on:workOn};` },
});

export const ProjectRoleFeeSave = defineAction({
  name: 'project_role_fee_save', label: '保存岗位费率', locations: [], requiredPermissions: ['forge_project_settings_manage'],
  params: [
    { name: 'position_id', label: '组织岗位', type: 'text', required: true }, { name: 'grade_code', label: '职级代码', type: 'text', required: true },
    { name: 'normal_rate', label: '正常费率', type: 'number', required: true }, { name: 'overtime_multiplier', label: '加班倍率', type: 'number', required: true },
    { name: 'travel_rate', label: '出差费率', type: 'number', required: false }, { name: 'monthly_hours_limit', label: '月工时上限', type: 'number', required: false },
    { name: 'effective_from', label: '生效日期', type: 'text', required: true }, { name: 'expected_revision', label: '当前修订', type: 'number', required: true },
    { name: 'description', label: '描述', type: 'text', required: false },
  ],
  body: { language: 'js', capabilities: ['api.read','api.write','api.transaction'], source: `${feeContext}
const positionId=feeText(ctx.input.position_id),effectiveFrom=feeDate(ctx.input.effective_from,'生效日期'),normalRate=feeNumber(ctx.input.normal_rate,'正常费率'),overtimeMultiplier=feeNumber(ctx.input.overtime_multiplier,'加班倍率',{min:0,max:10}),travelRate=feeNumber(ctx.input.travel_rate,'出差费率',{required:false,min:0}),monthlyLimit=feeNumber(ctx.input.monthly_hours_limit,'月工时上限',{required:false,min:0}),expected=feeNumber(ctx.input.expected_revision,'当前修订',{min:0});
if(!positionId)throw new Error('请选择原生组织岗位');if(!feeText(ctx.input.grade_code))throw new Error('职级代码不能为空');
await currentNativeOrganizationMember();
return await ctx.api.transaction(async()=>{const position=await ctx.api.object('sys_position').findOne({where:{id:positionId,organization_id:organizationId,active:true}});if(!position||position.active!==true)throw new Error('岗位不存在、已停用或不属于当前组织');const fees=ctx.api.object('forge_project_role_fee'),history=await fees.find({where:{organization_id:organizationId,position_id:positionId},orderBy:[{field:'revision',order:'desc'}],limit:1000});if(history.length>=1000)throw new Error('岗位费率历史超过可读取范围');const revision=maxRevision(history);if(revision!==expected)throw new Error('岗位费率已被其他人修改，请刷新后重试');const latest=history[0]||null;if(latest&&effectiveFrom<=feeText(latest.effective_from))throw new Error('新岗位费率生效日必须晚于上次生效日');if(latest&&latest.active===true&&!latest.effective_to)await closeEffectiveRow('forge_project_role_fee',latest,effectiveFrom);const next=revision+1,name=feeText(position.label)||feeText(position.name),created=await fees.insert({name:name+' · '+feeText(ctx.input.grade_code)+' · R'+next,rule_key:organizationId+':'+positionId+':'+next,position_id:positionId,position_label_snapshot:name,grade_code:feeText(ctx.input.grade_code),normal_rate:normalRate,overtime_multiplier:overtimeMultiplier,overtime_rate_snapshot:Math.round((normalRate*overtimeMultiplier+Number.EPSILON)*10000)/10000,travel_rate:travelRate,monthly_hours_limit:monthlyLimit,effective_from:effectiveFrom,effective_to:null,revision:next,active:true,description:feeText(ctx.input.description)||null,organization_id:organizationId,responsible_id:actor});const id=created&&created.id||created&&created.record&&created.record.id;if(!id)throw new Error('岗位费率修订创建失败');return{id,revision:next,position_id:positionId,effective_from:effectiveFrom,status:'active'};});` },
});

export const ProjectMemberFeeSave = defineAction({
  name: 'project_member_fee_save', label: '保存员工工时费率', locations: [], requiredPermissions: ['forge_project_settings_manage'],
  params: [
    { name: 'member_id', label: '组织成员', type: 'text', required: true }, { name: 'position_id', label: '组织岗位', type: 'text', required: true },
    { name: 'pay_method', label: '费率方式', type: 'text', required: true }, { name: 'monthly_salary', label: '月均工资', type: 'number', required: false },
    { name: 'actual_hourly_rate', label: '实际最终费率', type: 'number', required: false }, { name: 'effective_from', label: '生效日期', type: 'text', required: true },
    { name: 'expected_revision', label: '当前修订', type: 'number', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read','api.write','api.transaction'], source: `${feeContext}
const memberId=feeText(ctx.input.member_id),positionId=feeText(ctx.input.position_id),method=feeText(ctx.input.pay_method),effectiveFrom=feeDate(ctx.input.effective_from,'生效日期'),salary=feeNumber(ctx.input.monthly_salary,'月均工资',{required:false,min:0}),actualRate=feeNumber(ctx.input.actual_hourly_rate,'实际最终费率',{required:false,min:0}),expected=feeNumber(ctx.input.expected_revision,'当前修订',{min:0});
if(!memberId||!positionId||!['role_rate','salary_reference'].includes(method))throw new Error('成员、岗位和费率方式必须有效');if(method==='salary_reference'&&salary===null&&actualRate===null)throw new Error('薪资参考方式必须配置月均工资或实际最终费率');
await currentNativeOrganizationMember();
return await ctx.api.transaction(async()=>{const member=await ctx.api.object('sys_member').findOne({where:{id:memberId,organization_id:organizationId}});if(!member||feeText(member.organization_id)!==organizationId)throw new Error('员工必须是当前组织成员');const user=await ctx.api.object('sys_user').findOne({where:{id:member.user_id}});if(!user||user.banned===true)throw new Error('员工账号不可用');const position=await ctx.api.object('sys_position').findOne({where:{id:positionId,organization_id:organizationId,active:true}});if(!position||position.active!==true)throw new Error('组织岗位不存在或已停用');const appointments=await ctx.api.object('sys_user_position').find({where:{user_id:member.user_id,organization_id:organizationId,position:position.name},limit:500});const appointed=appointments.some(row=>(!row.valid_from||feeText(row.valid_from).slice(0,10)<=effectiveFrom)&&(!row.valid_until||feeText(row.valid_until).slice(0,10)>effectiveFrom));if(!appointed)throw new Error('员工在该生效日期没有对应的有效组织岗位任职');const fees=ctx.api.object('forge_project_member_fee'),history=await fees.find({where:{organization_id:organizationId,member_id:memberId,position_id:positionId},orderBy:[{field:'revision',order:'desc'}],limit:1000});if(history.length>=1000)throw new Error('员工费率历史超过可读取范围');const revision=maxRevision(history);if(revision!==expected)throw new Error('员工费率已被其他人修改，请刷新后重试');const latest=history[0]||null;if(latest&&effectiveFrom<=feeText(latest.effective_from))throw new Error('新员工费率生效日必须晚于上次生效日');if(latest&&latest.active===true&&!latest.effective_to)await closeEffectiveRow('forge_project_member_fee',latest,effectiveFrom);const next=revision+1,created=await fees.insert({name:(feeText(user.display_name)||feeText(user.name)||'组织成员')+' · '+(feeText(position.label)||feeText(position.name))+' · R'+next,rule_key:organizationId+':'+memberId+':'+positionId+':'+next,member_id:memberId,position_id:positionId,pay_method:method,monthly_salary:salary,actual_hourly_rate:actualRate,effective_from:effectiveFrom,effective_to:null,revision:next,active:true,organization_id:organizationId,responsible_id:actor});const id=created&&created.id||created&&created.record&&created.record.id;if(!id)throw new Error('员工费率修订创建失败');return{id,revision:next,member_id:memberId,position_id:positionId,effective_from:effectiveFrom,status:'active'};});` },
});

export const ProjectFeeOverrideWorkspaceQuery = defineAction({
  name: 'project_fee_override_workspace_query', label: '读取项目费率覆盖', locations: [],
  requiredPermissions: ['forge_project_settings_manage','forge_project_manager'],
  params: [{ name: 'project_id', label: '项目', type: 'text', required: true }],
  body: { language: 'js', capabilities: ['api.read'], source: `${feeContext}
await currentNativeOrganizationMember();
const projectId=feeText(ctx.input.project_id);if(!projectId)throw new Error('请选择项目');const project=await ctx.api.object('forge_project').findOne({where:{id:projectId,organization_id:organizationId}});if(!project||feeText(project.organization_id)!==organizationId||feeText(project.manager_id)!==actor)throw new Error('项目费率覆盖仅当前项目经理可以读取');const rows=await ctx.api.object('forge_project_fee_override').find({where:{organization_id:organizationId,project_id:projectId},orderBy:[{field:'position_id',order:'asc'},{field:'revision',order:'desc'}],limit:1001});if(!Array.isArray(rows)||rows.length>1000)throw new Error('项目费率覆盖超过可读取范围');return{project_id:projectId,project_name:feeText(project.name),overrides:rows};` },
});

export const ProjectFeeOverrideSave = defineAction({
  name: 'project_fee_override_save', label: '保存项目费率覆盖', locations: [],
  requiredPermissions: ['forge_project_settings_manage','forge_project_manager'],
  params: [
    { name: 'project_id', label: '项目', type: 'text', required: true }, { name: 'position_id', label: '组织岗位', type: 'text', required: true },
    { name: 'override_normal_rate', label: '覆盖费率', type: 'number', required: true }, { name: 'effective_from', label: '生效日期', type: 'text', required: true },
    { name: 'reason', label: '覆盖原因', type: 'text', required: true }, { name: 'expected_revision', label: '当前修订', type: 'number', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read','api.write','api.transaction'], source: `${feeContext}
const projectId=feeText(ctx.input.project_id),positionId=feeText(ctx.input.position_id),overrideRate=feeNumber(ctx.input.override_normal_rate,'覆盖费率'),effectiveFrom=feeDate(ctx.input.effective_from,'生效日期'),reason=feeText(ctx.input.reason),expected=feeNumber(ctx.input.expected_revision,'当前修订',{min:0});if(!projectId||!positionId||!reason)throw new Error('项目、岗位和覆盖原因均为必填');
await currentNativeOrganizationMember();
return await ctx.api.transaction(async()=>{const project=await ctx.api.object('forge_project').findOne({where:{id:projectId,organization_id:organizationId}});if(!project||feeText(project.organization_id)!==organizationId||feeText(project.manager_id)!==actor)throw new Error('项目费率覆盖仅当前项目经理可以维护');const position=await ctx.api.object('sys_position').findOne({where:{id:positionId,organization_id:organizationId,active:true}});if(!position||position.active!==true)throw new Error('岗位不存在或已停用');const base=await effectiveOne('forge_project_role_fee',{position_id:positionId},effectiveFrom,'岗位费率');if(!base)throw new Error('请先在组织岗位费率中配置该岗位的有效费率');const overrides=ctx.api.object('forge_project_fee_override'),history=await overrides.find({where:{organization_id:organizationId,project_id:projectId,position_id:positionId},orderBy:[{field:'revision',order:'desc'}],limit:1000});if(history.length>=1000)throw new Error('项目费率覆盖历史超过可读取范围');const revision=maxRevision(history);if(revision!==expected)throw new Error('项目费率覆盖已被其他人修改，请刷新后重试');const latest=history[0]||null;if(latest&&effectiveFrom<=feeText(latest.effective_from))throw new Error('新覆盖生效日必须晚于上次生效日');if(latest&&latest.active===true&&!latest.effective_to)await closeEffectiveRow('forge_project_fee_override',latest,effectiveFrom);const next=revision+1,baseRate=Number(base.normal_rate),created=await overrides.insert({name:feeText(project.name)+' · '+(feeText(position.label)||feeText(position.name))+' · R'+next,rule_key:organizationId+':'+projectId+':'+positionId+':'+next,project_id:projectId,position_id:positionId,role_fee_id:base.id,role_fee_revision:Number(base.revision),base_normal_rate_snapshot:baseRate,override_normal_rate:overrideRate,difference_snapshot:Math.round((overrideRate-baseRate+Number.EPSILON)*10000)/10000,effective_from:effectiveFrom,effective_to:null,reason,revision:next,active:true,organization_id:organizationId,responsible_id:actor});const id=created&&created.id||created&&created.record&&created.record.id;if(!id)throw new Error('项目费率覆盖修订创建失败');return{id,revision:next,project_id:projectId,position_id:positionId,status:'active'};});` },
});

export const ProjectTimeCostSettingsSave = defineAction({
  name: 'project_time_cost_settings_save', label: '保存工时成本全局设置', locations: [], requiredPermissions: ['forge_project_settings_manage'],
  params: [{ name: 'settings_json', label: '工时成本设置', type: 'text', required: true }, { name: 'expected_revision', label: '当前修订', type: 'number', required: true }],
  body: { language: 'js', capabilities: ['api.read','api.write','api.transaction'], source: `${feeContext}
let values;try{values=JSON.parse(String(ctx.input.settings_json||''))}catch{throw new Error('工时成本设置格式无效')}values=rowObject(values);const allowed=['standard_hours_per_day','overtime_start_after_hours','max_hours_per_day','auto_approval_threshold_hours','workday_overtime_multiplier','weekend_overtime_multiplier','management_uplift_percent','budget_warning_percent'];if(Object.keys(values).some(key=>!allowed.includes(key)))throw new Error('存在不支持的工时成本设置项');const nextValues={};for(const key of allowed){const value=values[key];nextValues[key]=value==null||value===''?null:feeNumber(value,key,{min:0,max:['standard_hours_per_day','overtime_start_after_hours','max_hours_per_day','auto_approval_threshold_hours'].includes(key)?24:1000});}if(nextValues.standard_hours_per_day!=null&&nextValues.max_hours_per_day!=null&&nextValues.max_hours_per_day<nextValues.standard_hours_per_day)throw new Error('每日最高工时不得小于标准工作时长');if(nextValues.overtime_start_after_hours!=null&&nextValues.max_hours_per_day!=null&&nextValues.overtime_start_after_hours>nextValues.max_hours_per_day)throw new Error('加班起算时长不得高于每日最高工时');if(nextValues.auto_approval_threshold_hours!=null&&nextValues.max_hours_per_day!=null&&nextValues.auto_approval_threshold_hours>nextValues.max_hours_per_day)throw new Error('自动审批阈值不得高于每日最高工时');const expected=feeNumber(ctx.input.expected_revision,'当前修订',{min:0});
await currentNativeOrganizationMember();
return await ctx.api.transaction(async()=>{const settings=ctx.api.object('forge_project_time_cost_settings'),history=await settings.find({where:{organization_id:organizationId},orderBy:[{field:'revision',order:'desc'}],limit:1001});if(!Array.isArray(history)||history.length>1000)throw new Error('工时成本设置历史超过可读取范围');const revision=maxRevision(history);if(revision!==expected)throw new Error('工时成本设置已被其他人修改，请刷新后重试');const latest=history[0]||null;if(latest&&latest.active===true){const updatedAt=feeText(latest.updated_at),instant=Date.parse(updatedAt);if(!Number.isFinite(instant))throw new Error('工时成本配置版本无效');const changed=await settings.update({active:false},{multi:true,where:{id:latest.id,organization_id:organizationId,active:true,updated_at:{$gte:new Date(instant).toISOString(),$lt:new Date(instant+1).toISOString()}}});if(changed!==1)throw new Error('工时成本设置已被修改，请刷新后重试');}const next=revision+1,created=await settings.insert({name:'项目工时成本设置 · R'+next,...nextValues,revision:next,active:true,organization_id:organizationId,responsible_id:actor});const id=created&&created.id||created&&created.record&&created.record.id;if(!id)throw new Error('工时成本设置修订创建失败');return{id,revision:next,status:'saved'};});` },
});
