import { defineAction } from '@objectstack/spec';

export const projectPositionAssignmentQuickJsHelpers = `
function projectPositionTimestamp(value){if(value==null||value==='')return undefined;if(value instanceof Date)return value.getTime();if(typeof value==='number')return value<1e12?value*1000:value;return Date.parse(String(value));}
function projectPositionAppointmentActive(row,now){const from=projectPositionTimestamp(row&&row.valid_from),until=projectPositionTimestamp(row&&row.valid_until);if(from!==undefined&&(!Number.isFinite(from)||now<from))return false;if(until!==undefined&&(!Number.isFinite(until)||now>=until))return false;return true;}
function projectPositionPermissionNames(value){if(Array.isArray(value))return value.map(item=>String(item||'').trim()).filter(Boolean);if(typeof value!=='string'||!value.trim())return[];try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.map(item=>String(item||'').trim()).filter(Boolean):[]}catch{return[];}}
async function projectPositionHasTaskExecution(positionId){const links=await ctx.api.object('sys_position_permission_set').find({where:{position_id:positionId},limit:1000});const setIds=[...new Set(links.map(row=>String(row.permission_set_id||'').trim()).filter(Boolean))];if(!setIds.length)return false;const sets=await ctx.api.object('sys_permission_set').find({where:{id:{$in:setIds},active:true},limit:1000});return sets.some(set=>set.active!==false&&projectPositionPermissionNames(set.system_permissions).includes('forge_project_work_member'));}
async function resolveProjectPositionAssignment(projectId,memberId,userId,organizationId,requestedId,useDefault=true){
 const assignments=ctx.api.object('forge_project_member_position_assignment');
 let assignmentId=String(requestedId||'').trim();
 if(!assignmentId&&useDefault){const defaults=await assignments.find({where:{project_id:projectId,member_id:memberId,organization_id:organizationId,active:true,is_default:true},limit:3});if(defaults.length>1)throw new Error('该项目成员有多个默认岗位，请先在团队编辑器中核对');assignmentId=String(defaults[0]&&defaults[0].id||'').trim();}
 if(!assignmentId)return null;
 const assignment=await assignments.findOne({where:{id:assignmentId,project_id:projectId,member_id:memberId,organization_id:organizationId,active:true}});
 if(!assignment||assignment.active!==true||String(assignment.position_id||'').trim()==='')throw new Error('所选项目岗位已停用或不属于当前负责人');
 const position=await ctx.api.object('sys_position').findOne({where:{id:assignment.position_id,active:true}});
 if(!position||position.active===false)throw new Error('所选组织岗位已停用');
 const appointments=await ctx.api.object('sys_user_position').find({where:{user_id:userId,organization_id:organizationId,position:position.name},limit:500});
 const activeAppointment=appointments.some(row=>String(row.user_id||'')===userId&&String(row.organization_id||'')===organizationId&&String(row.position||'')===String(position.name||'')&&projectPositionAppointmentActive(row,Date.now()));
 if(!activeAppointment)throw new Error('该成员已不再持有所选组织岗位');
 return {...assignment,position_name_snapshot:String(assignment.position_name_snapshot||position.label||position.name||'').trim()};
}
`;

const projectPositionContext = `
const actor=String((ctx.session&&ctx.session.userId)||(ctx.user&&ctx.user.id)||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(!actor||!organizationId)throw new Error('无法确认当前项目岗位维护人和组织');
function text(value){return value==null?'':String(value).trim();}
function object(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
function jsonValue(value,fallback){if(value&&typeof value==='object')return value;if(typeof value!=='string'||!value.trim())return fallback;try{return JSON.parse(value);}catch{return fallback;}}
function timestamp(value){if(value==null||value==='')return undefined;if(value instanceof Date)return value.getTime();if(typeof value==='number')return value<1e12?value*1000:value;return Date.parse(String(value));}
function validGrant(row,now){const from=timestamp(row&&row.valid_from),until=timestamp(row&&row.valid_until);if(from!==undefined&&(!Number.isFinite(from)||now<from))return false;if(until!==undefined&&(!Number.isFinite(until)||now>=until))return false;return true;}
function versionWhere(row,expected){const actual=text(row&&row.updated_at),requested=text(expected),time=timestamp(actual);if(!requested||requested!==actual||!Number.isFinite(time))throw new Error('项目成员资料已变化，请刷新后重试');return{updated_at:{$gte:new Date(time).toISOString(),$lt:new Date(time+1).toISOString()}};}
function permissionRowValue(value,fallback){return jsonValue(value,fallback);}
function permissionNames(value){const parsed=jsonValue(value,[]);if(Array.isArray(parsed))return parsed.map(text).filter(Boolean);if(typeof parsed==='string'&&parsed)return[parsed];return[];}
function hasObjectGrant(permissionSets,objectName){for(const set of permissionSets){const grants=permissionRowValue(set.object_permissions,{}),entry=object(grants[objectName]||(grants.objects&&grants.objects[objectName]));if(entry.allowRead===true||entry.read===true||entry.allowCreate===true||entry.create===true||entry.allowEdit===true||entry.edit===true||entry.allowDelete===true||entry.delete===true)return true;}return false;}
const moduleObjectMap=[
 {label:'计划与任务',objects:['forge_project_plan','forge_project_work_item','forge_project_daily_report']},
 {label:'项目成本',objects:['forge_project_cost_entry','forge_project_expense','forge_project_expense_line','forge_project_timesheet']},
 {label:'合同与订单',objects:['forge_project_sales_link','forge_sales_contract','forge_sales_order','forge_sales_contract_line','forge_sales_order_line']},
 {label:'项目BOM',objects:['forge_bom','forge_bom_node','forge_bom_shortage_analysis','forge_bom_shortage_line']},
 {label:'支出合同',objects:['forge_purchase_order','forge_purchase_order_line','forge_accounts_payable']},
 {label:'交付包',objects:['forge_commissioning_record','forge_commissioning_check','forge_delivery_package','forge_delivery_package_item','forge_customer_acceptance','forge_customer_acceptance_item','forge_acceptance_rectification']},
 {label:'附件',objects:['forge_project_attachment']},
 {label:'项目日志',objects:['forge_project_log']},
 {label:'团队管理',objects:['forge_project_member']},
];
async function projectMember(memberId){
 const member=await ctx.api.object('forge_project_member').findOne({where:{id:memberId,organization_id:organizationId}});
 if(!member||text(member.organization_id)!==organizationId)throw new Error('项目成员不存在或不属于当前组织');
 const project=await ctx.api.object('forge_project').findOne({where:{id:member.project_id,organization_id:organizationId},fields:['id','name','owner_id','manager_id','organization_id']});
 if(!project||text(project.organization_id)!==organizationId)throw new Error('所属项目不存在或不属于当前组织');
 if(text(project.owner_id)!==actor&&text(project.manager_id)!==actor)throw new Error('仅项目所有者或当前项目经理可以维护岗位分配');
 return{member,project};
}
async function nativePositionsForMember(userId,memberId){
 const appointments=await ctx.api.object('sys_user_position').find({where:{user_id:userId,organization_id:organizationId},limit:500});
 const now=Date.now(),appointmentNames=new Set(appointments.filter(row=>text(row.user_id)===userId&&text(row.organization_id)===organizationId&&text(row.position)&&validGrant(row,now)).map(row=>text(row.position)));
 const existing=await ctx.api.object('forge_project_member_position_assignment').find({where:{organization_id:organizationId,member_id:memberId},limit:500});
 const existingPositionIds=[...new Set(existing.map(row=>text(row.position_id)).filter(Boolean))];
 const byName=appointmentNames.size?await ctx.api.object('sys_position').find({where:{name:{$in:[...appointmentNames]},active:true},limit:500}):[];
 const byId=existingPositionIds.length?await ctx.api.object('sys_position').find({where:{id:{$in:existingPositionIds}},limit:500}):[];
 const positions=[...new Map([...byName,...byId].map(row=>[text(row.id),row])).values()];
 const activePositionIds=new Set(positions.filter(row=>row.active!==false&&appointmentNames.has(text(row.name))).map(row=>text(row.id)));
 const ids=positions.map(row=>text(row.id)).filter(Boolean);
 const links=ids.length?await ctx.api.object('sys_position_permission_set').find({where:{position_id:{$in:ids}},limit:1000}):[];
 const permissionSetIds=[...new Set(links.map(row=>text(row.permission_set_id)).filter(Boolean))];
 const permissionSets=permissionSetIds.length?await ctx.api.object('sys_permission_set').find({where:{id:{$in:permissionSetIds},active:true},limit:1000}):[];
 const setsById=new Map(permissionSets.map(row=>[text(row.id),row])),linksByPosition=new Map();
 for(const link of links){const id=text(link.position_id),set=setsById.get(text(link.permission_set_id));if(!id||!set)continue;const current=linksByPosition.get(id)||[];current.push(set);linksByPosition.set(id,current);}
 const positionDto=position=>{const sets=linksByPosition.get(text(position.id))||[];return{id:text(position.id),label:text(position.label)||'未命名岗位',appointed:activePositionIds.has(text(position.id)),projectTaskCapable:sets.some(set=>permissionNames(set.system_permissions).includes('forge_project_work_member')),permissionSetLabels:[...new Set(sets.map(set=>text(set.label)).filter(Boolean))],modules:moduleObjectMap.filter(module=>module.objects.some(name=>hasObjectGrant(sets,name))).map(module=>module.label)};};
 return{appointments,positions:positions.map(positionDto).filter(position=>position.appointed),positionById:new Map(positions.map(position=>[text(position.id),positionDto(position)]))};
}
`;

const projectMemberPositionAssignmentsReadSource = `${projectPositionContext}
const memberId=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim();
if(ctx.recordLoadDenied===true||!memberId)throw new Error('项目成员不存在或不可访问');
const{member,project}=await projectMember(memberId),catalog=await nativePositionsForMember(text(member.user_id),memberId);
const rows=await ctx.api.object('forge_project_member_position_assignment').find({where:{organization_id:organizationId,project_id:project.id,member_id:memberId},orderBy:[{field:'assigned_at',order:'asc'},{field:'id',order:'asc'}],limit:500});
const assignments=rows.map(row=>{const position=catalog.positionById.get(text(row.position_id));return{id:text(row.id),positionId:text(row.position_id),positionLabel:position?.label||text(row.position_name_snapshot)||'岗位任职已失效',active:row.active===true,isDefault:row.is_default===true,appointed:position?.appointed===true,projectTaskCapable:position?.projectTaskCapable===true,permissionSets:position?.permissionSetLabels||[],modules:position?.modules||[],updatedAt:row.updated_at||null};});
return{member_id:memberId,project_id:text(project.id),member_revision:member.updated_at||null,position_revision:Number(member.position_assignment_revision||0),available_positions:catalog.positions,assignments,project_task_capable:assignments.some(row=>row.active&&row.appointed&&row.projectTaskCapable),default_assignment_id:assignments.find(row=>row.active&&row.isDefault&&row.appointed&&row.projectTaskCapable)?.id||null};
`;

/** Read only current-org native appointments and the PermissionSets bound to their positions. */
export const ProjectMemberPositionAssignmentsRead = defineAction({
  name: 'project_member_position_assignments_read', label: '读取项目岗位', objectName: 'forge_project_member',
  locations: [], requiredPermissions: ['forge_project_operator'],
  body: { language: 'js', capabilities: ['api.read'], source: projectMemberPositionAssignmentsReadSource },
});

/** Same DTO for the task editor, whose native entry capability is project-manager execution. */
export const ProjectTaskOwnerPositionAssignmentsRead = defineAction({
  name: 'project_task_owner_position_assignments_read', label: '读取任务负责人岗位', objectName: 'forge_project_member',
  locations: [], requiredPermissions: ['forge_project_manager'],
  body: { language: 'js', capabilities: ['api.read'], source: projectMemberPositionAssignmentsReadSource },
});

/** A work member may read only their own current project role options for timesheet prefill. */
export const ProjectCurrentMemberPositionAssignmentsRead = defineAction({
  name: 'project_current_member_position_assignments_read', label: '读取本人工时岗位', objectName: 'forge_project',
  locations: [], requiredPermissions: ['forge_project_work_member'],
  body: { language: 'js', capabilities: ['api.read'], source: `${projectPositionContext}
const projectId=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim();
if(ctx.recordLoadDenied===true||!projectId)throw new Error('项目不存在或不可访问');
const project=await ctx.api.object('forge_project').findOne({where:{id:projectId,organization_id:organizationId},fields:['id','name','organization_id']});
if(!project||text(project.organization_id)!==organizationId)throw new Error('项目不存在或不属于当前组织');
const member=await ctx.api.object('forge_project_member').findOne({where:{project_id:projectId,organization_id:organizationId,user_id:actor,active:true}});
if(!member||member.active!==true||text(member.user_id)!==actor)throw new Error('仅当前项目有效成员可以读取本人工时岗位');
const catalog=await nativePositionsForMember(actor,text(member.id));
const rows=await ctx.api.object('forge_project_member_position_assignment').find({where:{organization_id:organizationId,project_id:projectId,member_id:member.id},orderBy:[{field:'assigned_at',order:'asc'},{field:'id',order:'asc'}],limit:500});
const assignments=rows.map(row=>{const position=catalog.positionById.get(text(row.position_id));return{id:text(row.id),positionLabel:position?.label||text(row.position_name_snapshot)||'岗位任职已失效',active:row.active===true,isDefault:row.is_default===true,appointed:position?.appointed===true};});
return{project_id:projectId,member_id:text(member.id),available_positions:catalog.positions.map(position=>({id:position.id,label:position.label,modules:position.modules})),assignments,default_assignment_id:assignments.find(row=>row.active&&row.isDefault&&row.appointed)?.id||null};
` },
});

/** Change project-local bindings to native positions; the organization assignment itself is never written. */
export const ProjectMemberPositionAssignmentsSave = defineAction({
  name: 'project_member_position_assignments_save', label: '保存项目岗位分配', objectName: 'forge_project_member',
  locations: [], requiredPermissions: ['forge_project_operator'], refreshAfter: true,
  params: [
    { name: 'expected_updated_at', label: '成员资料版本', type: 'text', required: true },
    { name: 'position_ids', label: '项目岗位', type: 'text', required: true },
    { name: 'default_position_id', label: '默认项目岗位', type: 'text', required: false },
  ],
  body: { language: 'js', capabilities: ['api.read','api.write','api.transaction'], source: `${projectPositionContext}
const memberId=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim();
if(ctx.recordLoadDenied===true||!memberId)throw new Error('项目成员不存在或不可访问');
let requested;try{requested=JSON.parse(String(ctx.input.position_ids||'[]'));}catch{throw new Error('项目岗位选择数据无效');}
if(!Array.isArray(requested)||requested.some(value=>typeof value!=='string'))throw new Error('项目岗位选择数据无效');
const selectedIds=[...new Set(requested.map(text).filter(Boolean))],defaultPositionId=text(ctx.input.default_position_id||'');
if(selectedIds.length>32)throw new Error('每位项目成员最多分配32个岗位');
if(defaultPositionId&&!selectedIds.includes(defaultPositionId))throw new Error('默认岗位必须是当前有效分配');
const expectedUpdatedAt=text(ctx.input.expected_updated_at);if(!expectedUpdatedAt)throw new Error('请刷新项目成员后再保存岗位');
return await ctx.api.transaction(async()=>{
 const{member,project}=await projectMember(memberId);
 if(member.active!==true)throw new Error('停用成员不能分配项目岗位');
 const memberCompare=versionWhere(member,expectedUpdatedAt),catalog=await nativePositionsForMember(text(member.user_id),memberId);
 const currentPositions=new Map(catalog.positions.map(row=>[row.id,row]));
 for(const positionId of selectedIds)if(!currentPositions.has(positionId))throw new Error('只能分配该员工当前组织内的有效岗位');
 const assignments=ctx.api.object('forge_project_member_position_assignment'),members=ctx.api.object('forge_project_member');
 const existing=await assignments.find({where:{organization_id:organizationId,project_id:project.id,member_id:memberId},orderBy:[{field:'id',order:'asc'}],limit:1000});
 const byPosition=new Map();for(const row of existing){const key=text(row.position_id),list=byPosition.get(key)||[];list.push(row);byPosition.set(key,list);}
 for(const rows of byPosition.values())if(rows.length>1)throw new Error('发现重复项目岗位历史关系，请先核对再修改');
 const selected=new Set(selectedIds),now=new Date().toISOString();let changed=false;
 for(const row of existing){const positionId=text(row.position_id),keep=selected.has(positionId),isDefault=keep&&positionId===defaultPositionId;if(row.active===true&&!keep){const saved=await assignments.update({active:false,is_default:false,ended_at:now},{multi:true,where:{id:row.id,project_id:project.id,member_id:memberId,organization_id:organizationId,active:true,...versionWhere(row,row.updated_at)}});if(saved!==1)throw new Error('项目岗位关系已变化，请刷新后重试');changed=true;continue;}if(row.active===true&&keep&&row.is_default!==isDefault){const saved=await assignments.update({is_default:isDefault},{multi:true,where:{id:row.id,project_id:project.id,member_id:memberId,organization_id:organizationId,active:true,...versionWhere(row,row.updated_at)}});if(saved!==1)throw new Error('项目岗位关系已变化，请刷新后重试');changed=true;continue;}if(row.active!==true&&keep){const position=currentPositions.get(positionId);const saved=await assignments.update({name:text(member.name)+' · '+position.label,position_name_snapshot:position.label,active:true,is_default:isDefault,assigned_at:now,ended_at:null},{multi:true,where:{id:row.id,project_id:project.id,member_id:memberId,organization_id:organizationId,active:false,...versionWhere(row,row.updated_at)}});if(saved!==1)throw new Error('项目岗位历史关系已变化，请刷新后重试');changed=true;}}
 for(const positionId of selectedIds){if(byPosition.has(positionId))continue;const position=currentPositions.get(positionId),key=project.id+':'+memberId+':'+positionId;const created=await assignments.insert({name:text(member.name)+' · '+position.label,assignment_key:key,project_id:project.id,member_id:memberId,position_id:positionId,position_name_snapshot:position.label,is_default:positionId===defaultPositionId,active:true,assigned_at:now,ended_at:null,remarks:null,organization_id:organizationId});if(!created)throw new Error('项目岗位关系创建失败');changed=true;}
 if(changed){const revision=Number(member.position_assignment_revision||0)+1,saved=await members.update({position_assignment_revision:revision},{multi:true,where:{id:memberId,project_id:project.id,user_id:member.user_id,organization_id:organizationId,active:true,...memberCompare}});if(saved!==1)throw new Error('项目成员已变化，岗位分配已取消，请刷新后重试');}
 return{member_id:memberId,project_id:project.id,status:changed?'updated':'unchanged',assignment_count:selectedIds.length,default_position_id:defaultPositionId||null};
});
` },
});
