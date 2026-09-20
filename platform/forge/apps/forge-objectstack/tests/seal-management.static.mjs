import assert from 'node:assert/strict';
import fs from 'node:fs';
const page=fs.readFileSync(new URL('../src/pages/seal-management.page.ts',import.meta.url),'utf8');
for(const token of ['ForgePageHeader','新建用章申请','保存草稿','导出（未接入）','forge_seal_application'])assert(page.includes(token),token);
assert(!page.includes('alert('));
console.log('seal-management static checks passed');
