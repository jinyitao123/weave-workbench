import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/supplier-price-book.page.ts', import.meta.url), 'utf8');
const routing = await readFile(new URL('../src/pages/supply-production-routing.page.ts', import.meta.url), 'utf8');
const objects = await readFile(new URL('../src/objects/procurement.object.ts', import.meta.url), 'utf8');
const actions = await readFile(new URL('../src/actions/procurement.action.ts', import.meta.url), 'utf8');

for (const marker of [
  'ForgePageHeader', 'ForgeSelectControl', 'ForgeDateInput', 'ForgeDialog',
  'createBook', 'saveLine', 'importLines', 'exportBooks', 'exportLines',
  '净价 = 目录价', 'supplier_price_book_activate', 'supplier_price_book_void',
]) assert.match(page, new RegExp(marker), `supplier price book page missing ${marker}`);

for (const object of [
  'forge_supplier_price_book_line',
  'forge_supplier_price_book_status_log',
  'forge_supplier_price_book_batch_task',
]) assert.match(objects, new RegExp(object), `supplier price book model missing ${object}`);

for (const action of ['SupplierPriceBookActivate', 'SupplierPriceBookVoid']) {
  assert.match(actions, new RegExp(action), `supplier price book action missing ${action}`);
}

assert.doesNotMatch(routing, /page_supplier_price_book/, 'generic routing page must not shadow dedicated supplier price book page');
assert.doesNotMatch(routing, /pages\[\d+\]/, 'dedicated routing exports must not depend on array positions when pages are split out');
assert.doesNotMatch(page, /价格条目维护待|仅保留入口|当前没有运行中的价格本批量任务/);
console.log('PASS supplier price book is a dedicated executable page with pricing, lifecycle and durable batch tasks');
