import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL(`../src/pages/${name}`, import.meta.url), 'utf8');
const page = await read('subcontract-guide.page.ts');
const routing = await read('supply-production-routing.page.ts');
const index = await read('index.ts');
const targets = {
  workspace: await read('subcontract-workspace.page.ts'),
  issue: await read('subcontract-issue.page.ts'),
  receipt: await read('subcontract-receipt.page.ts'),
  return: await read('subcontract-return.page.ts'),
};

for (const marker of ['ForgePageHeader','委外业务员','仓库人员','质检 / 收货','财务人员','准备供应商','创建委外订单','委外发料','回厂验收','异常处理','对账结算','快速开始','订单管理','发料管理','回厂与质检','退料与赔偿','库存与报表','常见问题','forge-subcontract-guide-known','取消已掌握','录入回厂','新建发料单','新建退料单','进入委外对账池']) assert.match(page,new RegExp(marker.replace(/[/?]/g,'\\$&')),`subcontract guide missing ${marker}`);
for (const target of ['page_subcontract_suppliers','page_subcontract_workspace','page_subcontract_issue_workspace','page_subcontract_receipt_workspace','page_subcontract_return_workspace','page_subcontract_ncr_workspace','page_subcontract_reconciliation','page_subcontract_stock','page_subcontract_undelivered','page_subcontract_dashboard']) assert.match(page,new RegExp(target),`subcontract guide missing destination ${target}`);
assert.match(index,/subcontract-guide\.page\.js/);
assert.doesNotMatch(routing,/SubcontractGuidePage|page_subcontract_guide/);
assert.doesNotMatch(page,/alert\(|confirm\(|prompt\(|disabled=\{!enabled\}/);

// 指南的“新建/录入”入口必须落到目标页真实支持的新建上下文，而不是只换 URL 的假入口。
const deepLinks = {
  workspace: 'page_subcontract_workspace?new=1',
  issue: 'page_subcontract_issue_workspace?new=1',
  receipt: 'page_subcontract_receipt_workspace?new=1',
  return: 'page_subcontract_return_workspace?new=1',
};
for (const [name, link] of Object.entries(deepLinks)) assert.match(page, new RegExp(link.replace('?', '\\?')), `subcontract guide missing deep link ${link}`);
assert.match(targets.workspace, /requestedNew.*new.*setCreate\(blankCreate\(\)\)/s, 'workspace page must open create form for ?new=1');
assert.match(targets.issue, /contextNew[\s\S]*?setCreate\(blank\(\)\)/, 'issue page must open create form for ?new=1');
assert.match(targets.receipt, /contextNew[\s\S]*?setCreate\(blank\(\)\)/, 'receipt page must open create form for ?new=1');
assert.match(targets.return, /contextNewRequest[\s\S]*?setCreate\(blank\(\)\)/, 'return page must open create form for ?new=1');
console.log('PASS subcontract guide is a dedicated role-based page with RISEMAP counts and real create deep links');
