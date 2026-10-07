import assert from 'node:assert/strict';
import test from 'node:test';
import {ProjectTaskWorkspacePage} from '../src/pages/project-task-workspace.page.ts';
import {createServicePageHarness,serviceText} from './service-page-react-harness.mjs';
const records={forge_project:[{id:'project-a',name:'授权项目',code:'P-A',manager_id:'actor-a'}],forge_project_plan:[{id:'plan-a',name:'执行计划',project_id:'project-a',status:'active'}],forge_project_work_item:[{id:'task-a',name:'授权执行任务',project_id:'project-a',plan_id:'plan-a',item_type:'task',owner_id:'actor-a',task_type:'type-a',status:'pending',priority:'medium'}],forge_project_member:[{id:'member-a',project_id:'project-a',user_id:'actor-a',name:'项目执行人',active:true}],forge_business_setting_option:[{id:'type-a',name:'交付任务',scope:'project',setting_type:'task_type',enabled:true}]};
function nodes(value,predicate,seen=new Set()){if(!value||typeof value!=='object'||seen.has(value))return[];seen.add(value);return[...(predicate(value)?[value]:[]),...Object.values(value).flatMap(item=>Array.isArray(item)?item.flatMap(child=>nodes(child,predicate,seen)):nodes(item,predicate,seen))]}
const response=(value,status=200)=>({ok:status<400,status,headers:new Headers(),json:async()=>value});
function fixture(failures={},permissionFailure=0){return createServicePageHarness(ProjectTaskWorkspacePage,{globals:{ExportConfigurationDialog:function ExportConfigurationDialog(){},window:{location:{search:'',href:'',origin:'http://service-page.test'}}},transport:async(url,options={})=>{assert.equal(options.method||'GET','GET');const parsed=new URL(url),path=parsed.pathname.replace('/api/v1','');if(path==='/auth/me/permissions')return permissionFailure?response({error:'expired'},permissionFailure):response({systemPermissions:['forge_project_manager'],objects:{forge_project_work_item:{allowCreate:true,allowExport:true}}});const object=path.split('/').at(-1);if(failures[object])return response({error:'backend diagnostic'},failures[object]);const all=records[object]||[],skip=Number(parsed.searchParams.get('$skip')||0),top=Number(parsed.searchParams.get('$top')||100);return response({records:all.slice(skip,skip+top),totalCount:all.length})}})}

test('expired task or auxiliary reads remove all task rows and show a session error without fake empty tasks',async()=>{
 for(const failure of [{forge_project_work_item:401},{forge_business_setting_option:401}]){const h=fixture(failure);const tree=await h.flushEffects();assert.ok(serviceText(tree).includes('登录状态已失效'));assert.equal(nodes(tree,n=>n.type==='RecordTable').length,0);assert.equal(nodes(tree,n=>n.type==='ForgeEmpty'&&n.props.title==='暂无匹配任务').length,0)}
});

test('permissions rejection is explicit and does not start project data reads',async()=>{
 const h=fixture({},403),tree=await h.flushEffects();assert.ok(serviceText(tree).includes('无权读取任务权限'));assert.equal(h.calls.some(call=>call.path.startsWith('/data/')),false);assert.equal(nodes(tree,n=>n.type==='RecordTable').length,0)
});

test('task-type denial preserves authorized task rows and disables create rather than claiming no settings',async()=>{
 const h=fixture({forge_business_setting_option:403}),tree=await h.flushEffects();assert.ok(serviceText(tree).includes('授权执行任务'));assert.ok(serviceText(tree).includes('无权读取任务类别'));const create=nodes(tree,n=>n.type==='button'&&serviceText(n).trim()==='新建任务')[0];assert.equal(create.props.disabled,true);assert.ok(!serviceText(tree).includes('当前项目没有启用任务类别'))
});
