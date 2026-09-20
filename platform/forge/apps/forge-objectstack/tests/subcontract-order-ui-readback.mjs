import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/subcontract-order-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
const endpoint = process.env.FORGE_URL || 'http://localhost:4386';
const api = await connect(endpoint);
async function find(object, where) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, object);
  return (response.value.records || []).filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
}

const [order] = await find('forge_subcontract_order', { code: process.env.FORGE_BROWSER_SUBCONTRACT_ORDER || 'SC-BROWSER-001' });
assert.ok(order, 'browser-created subcontract order');
const [lines, plans, logs] = await Promise.all([
  find('forge_subcontract_order_line', { order_id: order.id }),
  find('forge_subcontract_material_plan', { order_id: order.id }),
  find('forge_subcontract_order_approval_log', { order_id: order.id }),
]);
assert.deepEqual({
  status: order.status,
  mode: order.supply_mode,
  amount: order.processing_amount,
  quantity: order.total_quantity,
  issue: order.issue_planned_quantity,
  due: order.expected_delivery_on,
  note: order.approval_note,
}, {
  status: 'approved',
  mode: 'customer_supplied',
  amount: 177,
  quantity: 2,
  issue: 4,
  due: '2026-10-10',
  note: '供应商能力与甲供料计划核验通过，进入发料环节',
});
assert.equal(lines.length, 1);
assert.deepEqual({ code: lines[0].item_code, process: lines[0].process_type, quantity: lines[0].quantity, price: lines[0].unit_price, subtotal: lines[0].subtotal, due: lines[0].expected_delivery_on, drawing: lines[0].drawing_number }, { code: 'SC-FG-001', process: '钣金折弯、喷涂', quantity: 2, price: 88.5, subtotal: 177, due: '2026-10-10', drawing: 'DWG-SC-BROWSER-001' });
assert.equal(plans.length, 1);
assert.deepEqual({ code: plans[0].item_code, planned: plans[0].planned_quantity, standard: plans[0].standard_quantity }, { code: 'SC-RM-001', planned: 4, standard: 3.8 });
assert.deepEqual(logs.map((row) => row.action).sort(), ['approved', 'submitted']);
report.ids.browserOrder = order.id;
report.ids.browserLine = lines[0].id;
report.ids.browserPlan = plans[0].id;
report.browserVerification = {
  status: 'passed',
  verifiedAt: new Date().toISOString(),
  browser: 'Codex 内置浏览器',
  pageUrl: `${endpoint}/_console/apps/forge/page/page_subcontract_workspace`,
  risemapLiveComparison: report.risemapLiveEvidence,
  observed: [
    '内置浏览器实时核对 RISEMAP 委外指南、看板、订单列表、新建订单和供应商页面',
    'Forge 页面对齐委外看板、十列订单列表、供应商能力开通和新建订单分区',
    '填写甲供料订单、加工件、价格、交期、图纸号和人工发料计划',
    '提交后列表显示待审核、加工费 177 元、发料计划 4 和交期 2026-10-10',
    '审核通过后列表显示甲供料和已审核，下一业务步骤为创建委外发料单',
    'API 回读订单、加工件、发料计划和两条审核日志与页面一致',
  ],
};
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
console.log('PASS browser-created subcontract order and approval state read back');
