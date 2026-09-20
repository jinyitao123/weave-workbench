import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/purchase-request.page.ts', import.meta.url), 'utf8');
const routing = await readFile(new URL('../src/pages/supply-production-routing.page.ts', import.meta.url), 'utf8');
const objects = await readFile(new URL('../src/objects/procurement.object.ts', import.meta.url), 'utf8');
const actions = await readFile(new URL('../src/actions/procurement.action.ts', import.meta.url), 'utf8');

for (const marker of [
  'ForgeHero', 'ForgeSelectControl', 'ForgeDateInput', 'ForgeDialog',
  '从物料库选择', '手动添加', '快速粘贴', 'saveDraft', '保存并提交审批',
  'purchase_request_submit', 'purchase_request_approve', 'purchase_request_reject',
]) assert.match(page, new RegExp(marker), `purchase request page missing ${marker}`);

for (const marker of ['entry_mode', 'category_name']) {
  assert.match(objects, new RegExp(marker), `purchase request model missing ${marker}`);
}
assert.match(actions, /手工明细必须填写物料名称、型号、物料分类和单位/);
assert.doesNotMatch(routing, /page_purchase_request_pool/, 'generic routing page must not shadow dedicated purchase request page');
assert.doesNotMatch(page, /alert\(|confirm\(|prompt\(/, 'browser-native dialogs are forbidden');
assert.match(page, /附件存储尚未接入/);

// 采购申请精修基线：不重复堆叠导航、日期起止含义明确、状态与操作列在宽表下可达。
assert.doesNotMatch(page, /fp-list-context/, 'page must not render its own breadcrumb on top of ForgeHero');
assert.match(page, /pr-range-label">申请日期</, 'date filters must be labelled as one 申请日期 range');
assert.match(page, /pr-range-sep">~</, 'date range must state the 起 / 止 relationship');
assert.match(page, /aria-label="申请开始日期"/, 'range start keeps an explicit accessible label');
assert.match(page, /aria-label="申请结束日期"/, 'range end keeps an explicit accessible label');
assert.match(page, /pr-table th:last-child,\.pr-table td:last-child\{position:sticky;right:0/, 'action column must stay reachable while the wide table scrolls');
assert.match(page, /pr-table th:first-child,\.pr-table td:first-child\{position:sticky;left:0/, 'application code column must stay readable while the wide table scrolls');
assert.match(page, /pr-table td:nth-child\(2\)[\s\S]{0,200}word-break:break-word/, 'long text columns must wrap instead of stretching the row');
assert.match(page, /<ForgeHero[\s\S]{0,360}next=\{\{label:"采购待办池",href:forgeBase\+'\/page\/page_purchase_todo_pool',title:"下一步操作 · 采购待办池"\}\}/, 'next-step entry must stay available in the hero');
assert.match(
  page,
  /\.forge-purchase-request \.pr-table td\.fp-empty-cell \.fp-empty\{position:sticky;right:0/,
  'empty state must stay inside the visible area of the wide table on narrow screens',
);

console.log('PASS purchase request is a dedicated executable page with mixed detail entry and approval actions');
