import type {Plugin,PluginContext}from'@objectstack/core';
import type {IObjectQLEngine}from'@objectstack/spec/contracts';
import type {HookContext}from'@objectstack/spec/data';
import type {ExecutionContext}from'@objectstack/spec/kernel';
type Row=Record<string,unknown>;
const row=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
function scope(hook:HookContext):ExecutionContext{return{isSystem:true,userId:hook.session?.userId||hook.user?.id,tenantId:hook.session?.organizationId||hook.user?.organizationId,...(hook.transaction!==undefined?{transaction:hook.transaction}:{})}as ExecutionContext}
export function formatOrganizationBusinessDate(instant:Date,timezone:string|null|undefined):string{
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant);
 let year='',month='',day='';
 for(let index=0;index<parts.length;index++){
  const part=parts[index];
  if(part.type==='year')year=part.value;else if(part.type==='month')month=part.value;else if(part.type==='day')day=part.value;
 }
 return year+'-'+month+'-'+day;
}
export type OrganizationBusinessContext = { business_date: string; timezone: string };
export async function organizationBusinessContext(engine:IObjectQLEngine,context:ExecutionContext,instant=new Date()):Promise<OrganizationBusinessContext>{
 if(!context.tenantId)throw new Error('业务日期缺少组织上下文');
 const organization=await engine.findOne('sys_organization',{where:{id:context.tenantId},fields:['id','timezone']},{context});
 if(!organization)throw new Error('无法读取组织业务时区');
 const timezone=organization.timezone==null?'UTC':String(organization.timezone)||'UTC';
 try{return{business_date:formatOrganizationBusinessDate(instant,timezone),timezone}}catch{throw new Error('组织业务时区无效，请维护组织设置')}
}
export async function organizationBusinessDate(engine:IObjectQLEngine,context:ExecutionContext,instant=new Date()):Promise<string>{
 return(await organizationBusinessContext(engine,context,instant)).business_date;
}
/** Project has no BU reference; system-managed calendar dates follow the organization root. */
export class ProjectBusinessDatePlugin implements Plugin{
 name='com.inoforge.forge.project-business-date';version='1.0.0';type='standard'as const;init():void{}
 start(ctx:PluginContext):void{ctx.hook('kernel:ready',()=>{const engine=ctx.getService<IObjectQLEngine>('objectql');
  engine.registerHook('beforeInsert',async hook=>{const input=row(hook.input),values=input.data&&typeof input.data==='object'?row(input.data):input;if(!values.joined_on)values.joined_on=await organizationBusinessDate(engine,scope(hook))},{object:'forge_project_member',priority:90,packageId:this.name});
  engine.registerHook('beforeUpdate',async hook=>{const input=row(hook.input),values=input.data&&typeof input.data==='object'?row(input.data):input;if(row(hook.previous).status==='pending'&&values.status==='in_progress')values.actual_start_on=await organizationBusinessDate(engine,scope(hook))},{object:'forge_project',priority:90,packageId:this.name});
 })}
}
