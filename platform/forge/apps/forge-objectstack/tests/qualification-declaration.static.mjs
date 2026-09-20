import fs from 'node:fs';
const page=fs.readFileSync(new URL('../src/pages/qualification-declaration.page.ts', import.meta.url),'utf8');
for (const token of ['ForgePageHeader','资质台账','到期提醒','政策申报','材料库','新增资质','保存资质','导出（未接入）','forge_qualification_record']) if(!page.includes(token)) throw new Error(`missing ${token}`);
if(page.includes('alert(')) throw new Error('native alert is forbidden');
console.log('PASS qualification declaration static contract');
