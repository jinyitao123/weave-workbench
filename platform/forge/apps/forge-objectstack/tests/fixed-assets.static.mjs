import assert from 'node:assert/strict';import fs from 'node:fs';
const page=fs.readFileSync(new URL('../src/pages/fixed-assets.page.ts',import.meta.url),'utf8');
for(const token of ['ForgePageHeader','新增资产','保存资产','导入/导出（未接入）','执行月度折旧（未接入）','forge_fixed_asset'])assert(page.includes(token),token);
assert(!page.includes('alert('));console.log('fixed-assets static checks passed');
