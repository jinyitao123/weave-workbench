import fs from 'node:fs';
const page=fs.readFileSync(new URL('../src/pages/sales-contacts.page.ts',import.meta.url),'utf8');
for(const token of ['ForgePageHeader','联系人总数','不在原公司','关键决策人 KP','已跳槽','已离职','已退休','紧凑行高','01 任职资料','02 联系方式','03 补充说明','添加联系方式','确认删除联系人','forge_contact_channel'])if(!page.includes(token))throw new Error(`missing ${token}`);
if(page.includes('alert(')||page.includes('confirm(')||page.includes('<select'))throw new Error('native browser control is forbidden');
console.log('PASS sales contacts static contract');
