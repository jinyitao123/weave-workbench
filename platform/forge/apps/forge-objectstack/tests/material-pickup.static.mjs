import fs from 'node:fs';
const page=fs.readFileSync(new URL('../src/pages/material-pickup.page.ts', import.meta.url),'utf8');
for (const token of ['ForgePageHeader','提交申请','领取申请','物品库','领取记录','保存申请','物品库（未接入）','forge_material_pickup_request']) if(!page.includes(token)) throw new Error(`missing ${token}`);
if(page.includes('alert(')) throw new Error('native alert is forbidden'); console.log('PASS material pickup static contract');
