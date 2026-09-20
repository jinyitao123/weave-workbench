import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint=process.env.FORGE_URL||'http://localhost:4356',api=await connect(endpoint);
const response=await api.request('/data/forge_production_data_task?$top=500');
assert.equal(response.status,200,JSON.stringify(response.value));
const tasks=response.value.records||[],completed=tasks.filter(row=>row.status==='completed');
assert.ok(completed.length,'至少需要一条页面生成的已完成导出任务');
const task=completed.sort((a,b)=>String(b.submitted_at).localeCompare(String(a.submitted_at)))[0];
assert.equal(Number(task.progress),100);
assert.ok(Number(task.row_count)>0);
assert.ok(task.result_name?.endsWith('.csv'));
assert.ok(task.result_content?.startsWith('\ufeff'));
assert.ok(task.source_page?.startsWith('/_console/apps/forge/page/'));

const sources=[
  ['production-assembly-workspace.page.ts',['assembly']],
  ['production-transform-workspace.page.ts',['disassembly','replacement']],
  ['production-inventory-workspace.page.ts',['production_inbound','production_outbound']],
];
for(const [file,keys] of sources){const text=await readFile(new URL('../src/pages/'+file,import.meta.url),'utf8');for(const key of keys){assert.ok(text.includes("saveProductionExport(request,'"+key+"'"),file+' 缺少 '+key+' 导出任务接入');assert.ok(text.includes("openProductionDataTasks('"+key+"')"),file+' 缺少 '+key+' 任务入口')}}
const materialPage=await readFile(new URL('../src/pages/production-material-workspace.page.ts',import.meta.url),'utf8');
assert.ok(materialPage.includes('saveProductionExport(request,docType')&&materialPage.includes('openProductionDataTasks(docType)'));
for(const key of ['issue','supply','return'])assert.ok(materialPage.includes(key),key);
const taskPage=await readFile(new URL('../src/pages/production-data-task.page.ts',import.meta.url),'utf8');
for(const label of ['任务','来源','状态','进度','结果','失败原因','提交时间','下载结果','刷新','上一页','下一页'])assert.ok(taskPage.includes(label),label);
console.log(`PASS production data tasks: ${completed.length} completed, latest ${task.source_label} ${task.row_count} rows${process.argv.includes('--restart')?' after restart':''}`);
