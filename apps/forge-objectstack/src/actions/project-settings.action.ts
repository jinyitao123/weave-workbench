import { defineAction } from '@objectstack/spec';

const projectPositionPermissionCatalogSource = `
const actor=String((ctx.session&&ctx.session.userId)||(ctx.user&&ctx.user.id)||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(!actor||!organizationId)throw new Error('无法确认当前岗位目录组织');
const member=await ctx.api.object('sys_member').findOne({where:{user_id:actor,organization_id:organizationId}});
if(!member||String(member.organization_id||'')!==organizationId||String(member.user_id||'')!==actor)throw new Error('当前账号不属于所选组织');
function text(value){return value==null?'':String(value).trim();}
function row(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
function jsonObject(value){if(value&&typeof value==='object'&&!Array.isArray(value))return value;if(typeof value!=='string'||!value.trim())return{};try{const parsed=JSON.parse(value);return row(parsed)}catch{return{}}}
const moduleObjects=[
 {label:'概览',objects:['forge_project']},
 {label:'计划与任务',objects:['forge_project_plan','forge_project_work_item','forge_project_daily_report']},
 {label:'项目成本',objects:['forge_project_cost_entry','forge_project_expense','forge_project_expense_line','forge_project_timesheet']},
 {label:'合同与订单',objects:['forge_project_sales_link','forge_sales_contract','forge_sales_order','forge_sales_contract_line','forge_sales_order_line']},
 {label:'项目BOM',objects:['forge_bom','forge_bom_node','forge_bom_shortage_analysis','forge_bom_shortage_line']},
 {label:'支出合同',objects:['forge_purchase_order','forge_purchase_order_line','forge_accounts_payable']},
 {label:'交付包',objects:['forge_commissioning_record','forge_commissioning_check','forge_delivery_package','forge_delivery_package_item','forge_customer_acceptance','forge_customer_acceptance_item','forge_acceptance_rectification']},
 {label:'Goodwill',objects:['forge_goodwill_order','forge_goodwill_order_line','forge_goodwill_shipment']},
 {label:'附件',objects:['forge_project_attachment']},
 {label:'项目日志',objects:['forge_project_log']},
 {label:'团队管理',objects:['forge_project_member']},
];
const positions=await ctx.api.object('sys_position').find({where:{organization_id:organizationId},orderBy:[{field:'name',order:'asc'},{field:'id',order:'asc'}],limit:501});
if(!Array.isArray(positions)||positions.length>500)throw new Error('组织岗位目录超过可读取范围，请联系系统管理员');
const positionIds=[...new Set(positions.map(position=>text(position.id)).filter(Boolean))];
const links=positionIds.length?await ctx.api.object('sys_position_permission_set').find({where:{position_id:{$in:positionIds}},orderBy:[{field:'position_id',order:'asc'},{field:'permission_set_id',order:'asc'}],limit:2001}):[];
if(!Array.isArray(links)||links.length>2000)throw new Error('岗位权限关联超过可读取范围，请联系系统管理员');
const setIds=[...new Set(links.map(link=>text(link.permission_set_id)).filter(Boolean))];
const sets=setIds.length?await ctx.api.object('sys_permission_set').find({where:{id:{$in:setIds},active:true},orderBy:[{field:'label',order:'asc'},{field:'id',order:'asc'}],limit:1001}):[];
if(!Array.isArray(sets)||sets.length>1000)throw new Error('PermissionSet目录超过可读取范围，请联系系统管理员');
const setsById=new Map(sets.map(set=>[text(set.id),set])),linksByPosition=new Map();
for(const link of links){const positionId=text(link.position_id),set=setsById.get(text(link.permission_set_id));if(!positionId||!set)continue;const current=linksByPosition.get(positionId)||[];current.push(set);linksByPosition.set(positionId,current)}
const capabilities=setList=>moduleObjects.map(module=>{const sources=[];for(const set of setList){const raw=jsonObject(set.object_permissions),objects=row(raw.objects||raw);for(const objectName of module.objects){const grant=row(objects[objectName]);const read=grant.allowRead===true||grant.read===true,create=grant.allowCreate===true||grant.create===true,edit=grant.allowEdit===true||grant.edit===true,remove=grant.allowDelete===true||grant.delete===true;if(read||create||edit||remove)sources.push({read,create,edit,delete:remove});}}return{label:module.label,read:sources.some(value=>value.read),create:sources.some(value=>value.create),edit:sources.some(value=>value.edit),delete:sources.some(value=>value.delete),declared:sources.length>0};});
return{organization_id:organizationId,positions:positions.map(position=>{const id=text(position.id),setList=linksByPosition.get(id)||[];return{id,label:text(position.label)||text(position.name)||'未命名岗位',name:text(position.name),active:position.active===true,permission_set_labels:[...new Set(setList.map(set=>text(set.label)).filter(Boolean))],module_capabilities:capabilities(setList)}}).sort((a,b)=>a.label.localeCompare(b.label,'zh-CN')||a.name.localeCompare(b.name))};
`;

/** Read only current-organization positions and their declared native PermissionSet object grants. */
export const ProjectPositionPermissionCatalogRead = defineAction({
  name: 'project_position_permission_catalog_read', label: '读取组织岗位权限目录',
  locations: [], requiredPermissions: ['forge_project_settings_manage'],
  body: { language: 'js', capabilities: ['api.read'], source: projectPositionPermissionCatalogSource },
});
