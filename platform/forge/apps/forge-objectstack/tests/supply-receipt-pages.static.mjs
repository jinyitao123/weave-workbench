import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = file => readFile(new URL(`../src/pages/${file}`, import.meta.url), 'utf8');
const [notice, arrival, inspection, inbound, shared] = await Promise.all([
  read('purchase-arrival-notice.page.ts'),
  read('purchase-arrival-workspace.page.ts'),
  read('purchase-inspection-workspace.page.ts'),
  read('purchase-inbound-workspace.page.ts'),
  read('product-ui.ts'),
]);

for (const source of [notice, arrival, inspection, inbound]) {
  assert.match(source, /ForgePageHeader/);
  assert.doesNotMatch(source, /window\.(alert|confirm|prompt)\s*\(/);
}

assert.match(shared, /badge\|\|String\(area\)/);
assert.match(notice, /登记所选到货/);
assert.doesNotMatch(notice, /合并到货登记/);
assert.match(arrival, /purchase_arrival_register/);
assert.match(arrival, /purchase_receipt_submit/);
assert.match(inspection, /pending_inspection_create_order/);
assert.match(inspection, /purchase_inspection_complete/);
assert.match(inspection, /setTimeout\(load,500\)/);
assert.match(inbound, /purchase_inbound_submit/);
assert.match(inbound, /purchase_inbound_approve/);
assert.match(inbound, /purchase_inbound_stock/);
assert.match(inbound, /确认后将增加仓库库存/);
assert.match(inbound, /ForgeDialog open=\{!!confirm\}/);
assert.match(inbound, /onConfirm=\{\(\)=>confirm&&runConfirmed\(confirm\)\}/);

console.log('PASS supply receipt pages expose the real arrival, inspection, approval, and stock actions');
