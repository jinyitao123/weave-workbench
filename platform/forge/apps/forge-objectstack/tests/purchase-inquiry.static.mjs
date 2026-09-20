import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/purchase-inquiry.page.ts', import.meta.url), 'utf8');
const objects = await readFile(new URL('../src/objects/procurement.object.ts', import.meta.url), 'utf8');

for (const marker of ['ForgePageHeader', 'createInquiry', 'saveLine', 'invite', 'publish', 'saveQuote', 'chooseQuote', 'convert', 'closeInquiry']) {
  assert.match(page, new RegExp(marker), `purchase inquiry page missing ${marker}`);
}
for (const object of ['forge_purchase_inquiry_line', 'forge_purchase_inquiry_quote', 'forge_purchase_inquiry_quote_line']) {
  assert.match(objects, new RegExp(object), `purchase inquiry object model missing ${object}`);
}
assert.doesNotMatch(page, /报价发布和供应商报价收集功能待|功能待按 RISEMAP|仅保留入口/);
assert.match(page, /手动创建/);
assert.match(page, /从采购需求创建/);
assert.match(page, /从销售合同创建/);
console.log('PASS purchase inquiry page exposes a real RFQ workflow instead of a placeholder dialog');
