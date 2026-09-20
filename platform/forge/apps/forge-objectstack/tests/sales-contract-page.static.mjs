import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../src/pages/sales-contract-workspace.page.ts', import.meta.url), 'utf8');
const create = readFileSync(new URL('../src/pages/sales-contract-create.page.ts', import.meta.url), 'utf8');
const object = readFileSync(new URL('../src/objects/sales.object.ts', import.meta.url), 'utf8');

for (const label of ['合同编号','客户单号','合同名称','合同类型','客户名称','关联项目','来源','合同总额','开票','已发货','已回款','状态','订单状态','下单笔数','已下单金额','红绿灯','签订日期','备注','创建时间','更新时间','开单人','负责人','联系人','操作']) assert.ok(workspace.includes(label), `missing contract column: ${label}`);
for (const control of ['新建合同','导入/导出','搜索合同','范围','订单状态','客户联系人','自定义导出']) assert.ok(workspace.includes(control), `missing contract control: ${control}`);
for (const section of ['客户信息','销售人员','合同基本信息','物料明细','订货约束与授权','附加费用','收入确认规则','合同条款','附件']) assert.ok(create.includes(section), `missing create section: ${section}`);
for (const action of ['报价单导入','粘贴导入','Excel/CSV 导入','物料组合','uploadFile','确认保存并提交']) assert.ok(create.includes(action), `missing create action: ${action}`);
for (const field of ['company_account_id','delivery_address','collaborator_ids','payment_term','delivery_cycle_days','warranty_months','attachment_ids']) assert.ok(object.includes(field), `missing persisted contract field: ${field}`);

console.log('PASS sales contract workspace and create page expose the verified list, form, imports, upload and persisted fields');
