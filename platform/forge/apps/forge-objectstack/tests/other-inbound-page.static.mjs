import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/other-inbound-workspace.page.ts', import.meta.url), 'utf8');

assert.match(page, /<ForgePageHeader section="入库管理" title="其他入库" description="管理所有其他入库单据"/, 'list view must use the shared header with an explicit title');
assert.doesNotMatch(page, /fp-list-context/, 'list view must not render its own breadcrumb on top of the shared header');
assert.match(
  page,
  /actions=\{<><button className="fp-button primary" onClick=\{\(\)=>window\.location\.href=window\.location\.pathname\+'\?new=1'\}>新建其他入库<\/button>/,
  'header toolbar must lead with the create action',
);
assert.equal(page.match(/新建其他入库<\/button>/g)?.length, 2, 'create action appears once in the header and once as the empty-state CTA');
for (const [label, pattern] of [
  ['新建其他入库', /window\.location\.pathname\+'\?new=1'/],
  ['打印条码', /setPrintOpen\(true\)/],
  ['导出', /onClick=\{exportRows\}/],
  ['刷新', /onClick=\{load\}/],
]) assert.match(page, pattern, `其他入库 header action missing: ${label}`);
assert.doesNotMatch(page, /alert\(|confirm\(|prompt\(/, 'browser-native dialogs are forbidden');
assert.match(page, /fp-inbound-table th:first-child,\.forge-other-inbound \.fp-inbound-table td:first-child\{position:sticky;left:0/, 'inbound number column must stay readable while the 12-column table scrolls');
assert.match(page, /fp-inbound-table th:last-child,\.forge-other-inbound \.fp-inbound-table td:last-child\{position:sticky;right:0/, 'status and row actions must stay reachable while the table scrolls');
assert.match(page, /fp-inbound-table\{min-width:1180px\}/, 'the 12-column list must declare its own minimum width instead of squeezing columns');
console.log('PASS other inbound list uses the shared header with a single create action and intact toolbar');
