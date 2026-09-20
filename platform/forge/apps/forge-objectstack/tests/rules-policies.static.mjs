import assert from 'node:assert/strict';
import fs from 'node:fs';
const page=fs.readFileSync(new URL('../src/pages/rules-policies.page.ts', import.meta.url),'utf8');
for (const token of ['ForgePageHeader','新增制度','保存草稿','导出汇编（未接入）','类别管理尚未接入','forge_rule_policy']) assert(page.includes(token), token);
assert(!page.includes('alert('));
console.log('rules-policies static checks passed');
