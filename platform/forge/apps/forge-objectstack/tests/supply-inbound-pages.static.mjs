import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = name => readFile(new URL('../src/' + name, import.meta.url), 'utf8');
const [other, all, lines, object] = await Promise.all([
  read('pages/other-inbound-workspace.page.ts'),
  read('pages/all-inbounds.page.ts'),
  read('pages/inbound-lines-list.page.ts'),
  read('objects/inventory.object.ts'),
]);

for (const page of [other, all, lines]) assert.match(page, /ForgePageHeader/, 'inbound pages must use the shared page header');
for (const token of ['往来单位（可选）', '到货原因', '下载模板', '表格导入', '选择当前页其他入库单']) assert.match(other, new RegExp(token));
for (const token of ["find('forge_other_inbound')", "_kind:'other'", 'page_other_inbounds?id=']) assert.ok(all.includes(token), `all-inbounds missing ${token}`);
for (const token of ['选择当前页入库明细', 'counterparty_type', 'forge_customer']) assert.match(lines, new RegExp(token));
for (const token of ['counterparty_type', 'customer_id', 'supplier_id', 'arrival_reason']) assert.match(object, new RegExp(token));
assert.doesNotMatch(other, /alert\(|confirm\(|prompt\(/, 'browser-native dialogs are forbidden');
console.log('PASS supply inbound pages static contract');
