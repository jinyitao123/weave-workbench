import assert from 'node:assert/strict';
import fs from 'node:fs';
const page=fs.readFileSync(new URL('../src/pages/meeting-minutes.page.ts',import.meta.url),'utf8');
for(const token of ['ForgePageHeader','新建会议纪要','保存草稿','导出（未接入）','forge_meeting_minute'])assert(page.includes(token),token);
assert(!page.includes('alert('));
console.log('meeting-minutes static checks passed');
