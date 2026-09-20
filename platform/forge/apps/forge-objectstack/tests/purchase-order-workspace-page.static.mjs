import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/purchase-order-workspace.page.ts', import.meta.url), 'utf8');

assert.match(page, /<ForgePageHeader section="供应链 \/ 采购管理" title="采购订单"/, 'order list must use the shared header');
assert.doesNotMatch(page, /供应链 \/ 采购管理 \/ 采购订单/, 'list view must not repeat the module breadcrumb already shown by the Console shell');
assert.equal(page.match(/fp-phase-index">04/g)?.length, 2, 'only the new-order and detail sub-views keep a back-to-list trail');
assert.equal(page.match(/新建采购单<\/button>/g)?.length, 1, 'primary create action must appear exactly once');
for (const [label, pattern] of [
  ['新建采购单', /route\('new'\)/],
  ['导出', /onClick=\{exportCsv\}/],
  ['付款申请', /page_purchase_payment/],
  ['收票登记', /page_purchase_invoice_entry/],
  ['刷新', /loadList/],
]) assert.match(page, pattern, `order header action missing: ${label}`);
assert.match(page, /fp-wide-table th:first-child,\.fp-wide-table td:first-child\{position:sticky;left:0/, 'order number column must stay readable while the wide table scrolls');
assert.match(page, /fp-wide-table th:last-child,\.fp-wide-table td:last-child\{position:sticky;right:0/, 'order action column must stay reachable while the wide table scrolls');
assert.doesNotMatch(page, /alert\(|confirm\(|prompt\(/, 'browser-native dialogs are forbidden');
console.log('PASS purchase order workspace uses the shared header with a single create action and sticky edge columns');
