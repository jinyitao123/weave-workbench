import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const page=await readFile(new URL('../src/pages/work-report.page.ts',import.meta.url),'utf8');
const obj=await readFile(new URL('../src/objects/administration.object.ts',import.meta.url),'utf8');
for(const token of ['page_work_reports','新建工作汇报','提交审阅','工作内容','工作总结','下期计划','问题与风险','汇报周期','ForgePageHeader'])assert.ok(page.includes(token),token);
for(const token of ['WorkReport','forge_work_report','completion','period_start','period_end','submitted_at'])assert.ok(obj.includes(token),token);
assert.ok(!page.includes('window.alert(')&&!page.includes('window.confirm('));
console.log(JSON.stringify({suite:'work-report-static',pages:1,objects:1,status:'passed'},null,2));
