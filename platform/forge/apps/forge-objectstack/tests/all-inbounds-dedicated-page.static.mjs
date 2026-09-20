import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/all-inbounds.page.ts', import.meta.url), 'utf8');
const routing = await readFile(new URL('../src/pages/supply-production-routing.page.ts', import.meta.url), 'utf8');
const index = await readFile(new URL('../src/pages/index.ts', import.meta.url), 'utf8');

for (const marker of [
  'ForgePageHeader', 'ForgeSelectControl', 'ForgeDialog', 'ForgeStatus',
  'forge_purchase_inbound', 'forge_production_inbound', 'forge_opening_inbound', 'forge_subcontract_inbound',
  'selectedRows', '选择当前页入库单', '只打印已勾选记录',
  'page_purchase_inbound_workspace?new=1', 'page_other_inbounds?new=1', 'page_sales_return_workspace',
]) assert.match(page, new RegExp(marker.replace(/[?]/g, '\\?')), `all inbounds page missing ${marker}`);

assert.match(index, /all-inbounds\.page\.js/);
assert.doesNotMatch(routing, /export const AllInboundsPage/, 'routing module must not export the dedicated all-inbounds page');
assert.doesNotMatch(page, /alert\(|confirm\(|prompt\(/, 'browser-native dialogs are forbidden');
assert.doesNotMatch(page, /打印条码" disabled=\{!filtered\.length\}/, 'printing must depend on selected rows');

console.log('PASS all inbounds is a dedicated aggregate page with selected-row printing and real inbound routes');
