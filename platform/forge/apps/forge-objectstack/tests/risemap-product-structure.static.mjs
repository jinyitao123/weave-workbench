import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stack = JSON.parse(await readFile('dist/objectstack.json', 'utf8'));
const app = stack.apps.find((item) => item.name === 'forge');
assert.ok(app, 'Forge app exists');

assert.deepEqual(
  app.areas.map((area) => area.label),
  ['工作台', '供应链', '销售', '生产', '项目', '行政', '财务', '报表', '系统'],
  'default navigation follows the observed RISEMAP functional domains',
);

const production = app.areas.find((area) => area.id === 'production');
const subcontract = production.navigation.find((item) => item.id === 'subcontract_management');
assert.deepEqual(
  subcontract.children.map((item) => item.label),
  ['进入委外管理上手指南', '委外看板', '委外订单', '委外发料', '委外回厂', '委外退料', '委外对账', '委外供应商', '加工价目', '委外库存', '批次追溯', '委外未交', '委外进货', '委外对账单'],
  'subcontract navigation preserves the observed RISEMAP entries and the Forge pricing entry',
);
assert.ok(subcontract.children.every((item) => item.type === 'page'), 'subcontract business navigation only exposes task pages');

const allNavigation = app.areas.flatMap((area) => area.navigation.flatMap((item) => item.children || [item]));
const exposedObjects = new Set(allNavigation.filter((item) => item.type === 'object').map((item) => item.objectName));
for (const hidden of [
  'forge_subcontract_order_line',
  'forge_subcontract_material_plan',
  'forge_subcontract_order_approval_log',
  'forge_subcontract_outbound',
  'forge_subcontract_inbound',
  'forge_subcontract_stock_ledger',
  'forge_subcontract_receipt_consumption',
  'forge_subcontract_ncr_log',
]) assert.equal(exposedObjects.has(hidden), false, `${hidden} stays out of business navigation`);

const pageNames = new Set(stack.pages.map((item) => item.name));
for (const item of subcontract.children) assert.ok(pageNames.has(item.pageName), `${item.pageName} is defined`);

console.log('PASS RISEMAP domain navigation, subcontract entry map, and dependent-object hiding');
