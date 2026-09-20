import fs from 'node:fs';
const page=fs.readFileSync(new URL('../src/pages/sales-customers.page.ts',import.meta.url),'utf8');
for(const token of ['ForgePageHeader','新增客户','创建客户','我负责的','我参与的','下属负责的','下属参与的','主要联系人电话','协同销售','红绿灯','工商信息 0/8','联系人','客户资料 1/5','标签与团队','开票信息 0/6','商务条件 0/2','商务信息 0/4','forge_customer','forge_customer_team_member','forge_contact','forge_contact_channel','维护团队','subordinateIds','team_member_ids','/auth/get-session','currentUserId'])if(!page.includes(token))throw new Error(`missing ${token}`);
for(const scope of ['participated','subordinate_owned','subordinate_participated'])if(!page.includes(scope))throw new Error(`scope tab ${scope} must perform a real filter`);
if(page.includes('setScopeInfo')||page.includes('范围入口说明'))throw new Error('scope tabs must not use placeholder dialogs');
if(page.includes('alert(')||page.includes('confirm(')||page.includes('<select'))throw new Error('native browser control is forbidden');
console.log('PASS sales customers static contract');
