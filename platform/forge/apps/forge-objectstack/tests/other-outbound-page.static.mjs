import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/other-outbound-workspace.page.ts', import.meta.url), 'utf8');

assert.match(page, /<ForgePageHeader section="出库管理" title="其他出库" description="管理所有出库单和待出库发货单"/, 'list view must use the shared header with an explicit title');
assert.doesNotMatch(page, /fp-list-context/, 'list view must not render its own breadcrumb on top of the shared header');
assert.doesNotMatch(page, /<h1 className="fp-title">其他出库<\/h1>/, 'list view must not duplicate the title outside the shared header');
assert.match(
  page,
  /actions=\{<><button className="fp-button primary" onClick=\{\(\)=>window\.location\.href=window\.location\.pathname\+'\?new=1'\}>新建其他出库<\/button><button className="fp-button" onClick=\{load\}>刷新<\/button><\/>\}\/>/,
  'header toolbar must keep the create and refresh actions',
);
assert.equal(page.match(/新建其他出库<\/button>/g)?.length, 2, 'create action appears once in the header and once as the empty-state CTA');
assert.doesNotMatch(page, /alert\(|confirm\(|prompt\(/, 'browser-native dialogs are forbidden');
console.log('PASS other outbound list uses the shared header and keeps create/refresh actions');
