import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const page=await readFile(new URL('../src/pages/document-center.page.ts',import.meta.url),'utf8');
const obj=await readFile(new URL('../src/objects/administration.object.ts',import.meta.url),'utf8');
for(const token of ['page_document_center','新建文件夹','上传文件（未接入）','最近收藏','按日期','列表','网格','访问权限','ForgePageHeader'])assert.ok(page.includes(token),token);
for(const token of ['DocumentEntry','forge_document_entry','entry_type','parent_id','favorite','updated_at'])assert.ok(obj.includes(token),token);
assert.ok(!page.includes('window.alert(')&&!page.includes('window.confirm('));
console.log(JSON.stringify({suite:'document-center-static',pages:1,objects:1,status:'passed'},null,2));
