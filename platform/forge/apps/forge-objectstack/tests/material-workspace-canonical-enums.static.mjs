import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [model, object, page] = await Promise.all([
  readFile(path.join(appDir, 'src/model.ts'), 'utf8'),
  readFile(path.join(appDir, 'src/objects/material.object.ts'), 'utf8'),
  readFile(path.join(appDir, 'src/pages/material-workspace.page.ts'), 'utf8'),
]);
assert.match(model, /贸易商品: 'traded'/);
assert.match(model, /备件: 'spare'/);
assert.match(model, /外协: 'subcontracted'/);
assert.match(object, /choice\('物料属性', materialPropertyLabels/);
assert.match(object, /choice\('来源类型', materialSourceTypeLabels/);
assert.match(page, /materialPropertyOptions, materialSourceTypeOptions/);
assert.match(page, /ForgeApiRequest\(adapter,path/);
assert.match(page, /form:\{\.\.\.d\.form,error:String\(e\.message\|\|e\)\}/, 'Model validation errors must remain visible in the material dialog');
assert.equal((page.match(/propertyOptions\.map\(p=><option key=\{p\.value\} value=\{p\.value\}>\{p\.label\}<\/option>\)/g) || []).length, 2, 'Both material-property selectors must render each canonical option value and label');
assert.match(page, /sourceOptions\.map\(p=><option key=\{p\.value\} value=\{p\.value\}>\{p\.label\}<\/option>\)/, 'The source selector must render each canonical option value and label');
assert.doesNotMatch(page, /\b(?:propertyOptions|sourceOptions)\.map\(p=><option key=\{p\[0\]\}/, 'The select components must not treat canonical object options as tuples');
assert.doesNotMatch(page, /trade_goods|spare_part|'outsourced'/);
console.log('PASS material choices render canonical model values and labels through the shared API error handler');
