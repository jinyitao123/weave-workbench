import assert from 'node:assert/strict';
import fs from 'node:fs';
const page=fs.readFileSync(new URL('../src/pages/employee-records.page.ts',import.meta.url),'utf8');
for(const token of ['ForgePageHeader','新增员工','保存员工','导入/导出（未接入）','批量删除（未接入）','forge_employee_record'])assert(page.includes(token),token);
assert(!page.includes('alert('));
console.log('employee-records static checks passed');
