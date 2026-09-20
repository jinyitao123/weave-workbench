import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4442';
const database = process.env.FORGE_DB || '.objectstack/acceptance/subcontract-return.sqlite';

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`tests/${script}`], { cwd: process.cwd(), env: { ...process.env, FORGE_URL: endpoint, FORGE_DB: database }, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${script} exited with ${code}`)));
  });
}
async function find(api, object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '500' });
  const response = await api.request(`/data/${object}?${query}`); assert.equal(response.status, 200, object);
  return (response.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
}
async function invoke(api, object, action, id, params = {}) {
  const response = await api.request(`/actions/${object}/${action}/${id}`, 'POST', { params });
  assert.equal(response.status, 200, `${object}/${action}: ${JSON.stringify(response.value)}`);
  return response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
}
async function expectFailure(api, object, action, id, params, message) {
  const response = await api.request(`/actions/${object}/${action}/${id}`, 'POST', { params });
  assert.equal(response.status, 400, message); assert.match(JSON.stringify(response.value), /退料|在外余量|不可|超过/);
}

await run('subcontract-order.integration.mjs');
await run('subcontract-issue.integration.mjs');
const orderReport = JSON.parse(await readFile('.objectstack/acceptance/subcontract-order-report.json', 'utf8'));
const api = await connect(endpoint);
const orderId = orderReport.ids.customerSuppliedOrder;
const order = (await find(api, 'forge_subcontract_order', { id: orderId }))[0];
assert.equal(order.supply_mode, 'customer_supplied');
const plans = await find(api, 'forge_subcontract_material_plan', { order_id: orderId });
assert.ok(plans.length, 'return sample needs a material plan');
const plan = plans[0];
const stocks = await find(api, 'forge_subcontract_stock_balance', { balance_key: `${order.supplier_id}:${orderId}:${plan.sku_id}` });
assert.equal(stocks.length, 1, 'return sample needs one supplier stock balance');
const before = stocks[0]; assert.ok(Number(before.on_hand_quantity) > 0, 'return sample needs positive outside quantity');
const quantity = Math.min(1, Number(before.on_hand_quantity));
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const reasons = await find(api, 'forge_subcontract_business_setting', { category: 'return_reason' });
let returnReason = reasons.find(row => row.name === '余料退回');
if (!returnReason) {
  const response = await api.request('/data/forge_subcontract_business_setting', 'POST', { name: '余料退回', code: 'SUB-RETURN-SURPLUS', category: 'return_reason', enabled: true, sort_order: 10, description: '委外退料原因前置配置。' });
  assert.equal(response.status, 201, JSON.stringify(response.value));
  returnReason = response.value.record || response.value;
}
await api.request('/data/forge_subcontract_business_setting/' + returnReason.id, 'PATCH', { enabled: false });
await expectFailure(api, 'forge_subcontract_order', 'subcontract_return_create', orderId, {
  return_code: `RET-CHAIN-${runId}-DISABLED`, return_on: '2026-09-12', reason_setting_id: returnReason.id, reason: 'excess_material',
  lines_json: JSON.stringify([{ plan_id: plan.id, quantity }]),
}, 'disabled return reason must be blocked');
await api.request('/data/forge_subcontract_business_setting/' + returnReason.id, 'PATCH', { enabled: true });

const created = await invoke(api, 'forge_subcontract_order', 'subcontract_return_create', orderId, {
  return_code: `RET-CHAIN-${runId}-001`, return_on: '2026-09-12', reason_setting_id: returnReason.id, reason: 'excess_material',
  lines_json: JSON.stringify([{ plan_id: plan.id, quantity }]), remarks: '委外退料闭环验收',
});
assert.equal(created.status, 'draft');
const createdReturn = (await find(api, 'forge_subcontract_return', { id: created.id }))[0];
assert.equal(createdReturn.reason_setting_id, returnReason.id, 'return must preserve the selected active business reason');
const draftStock = (await find(api, 'forge_subcontract_stock_balance', { id: before.id }))[0];
assert.equal(Number(draftStock.on_hand_quantity), Number(before.on_hand_quantity), 'draft must not change stock');
await expectFailure(api, 'forge_subcontract_order', 'subcontract_return_create', orderId, {
  return_code: `RET-CHAIN-${runId}-OVER`, return_on: '2026-09-12', reason: 'excess_material',
  lines_json: JSON.stringify([{ plan_id: plan.id, quantity: Number(before.on_hand_quantity) + 1 }]),
}, 'over-return must be blocked');

const confirmed = await invoke(api, 'forge_subcontract_return', 'subcontract_return_confirm', created.id, { confirm_note: '订单余量和退料数量已复核' });
assert.equal(confirmed.status, 'pending_inbound');
const pendingStock = (await find(api, 'forge_subcontract_stock_balance', { id: before.id }))[0];
assert.equal(Number(pendingStock.on_hand_quantity), Number(before.on_hand_quantity), 'confirmation must only create inbound');
const inbound = (await find(api, 'forge_subcontract_return_inbound', { return_id: created.id }))[0];
assert.equal(inbound.status, 'pending');
await invoke(api, 'forge_subcontract_return_inbound', 'subcontract_return_inbound_confirm', inbound.id, { stock_note: '仓库已核对退回物料' });
const finalReturn = (await find(api, 'forge_subcontract_return', { id: created.id }))[0];
const finalInbound = (await find(api, 'forge_subcontract_return_inbound', { id: inbound.id }))[0];
const finalStock = (await find(api, 'forge_subcontract_stock_balance', { id: before.id }))[0];
const ledger = await find(api, 'forge_subcontract_stock_ledger', { source_id: created.id, movement_type: 'material_return' });
const finalLine = (await find(api, 'forge_subcontract_return_line', { return_id: created.id }))[0];
assert.deepEqual({ returnStatus: finalReturn.status, inboundStatus: finalInbound.status, lineStatus: finalLine.status, onHand: Number(finalStock.on_hand_quantity), returned: Number(finalStock.returned_quantity), ledger: ledger.length }, { returnStatus: 'stocked', inboundStatus: 'stocked', lineStatus: 'stocked', onHand: Number(before.on_hand_quantity) - quantity, returned: Number(before.returned_quantity || 0) + quantity, ledger: 1 });
const report = { suite: 'subcontract-return', passed: true, database, orderId, returnId: created.id, inboundId: inbound.id, lineId: finalLine.id, stockId: finalStock.id, sourceId: created.id, movementType: 'material_return', quantity, result: { returnStatus: finalReturn.status, inboundStatus: finalInbound.status, stockAfter: finalStock.on_hand_quantity, returnedTotal: finalStock.returned_quantity, ledgerRows: ledger.length }, boundary: '证明本地 Forge 委外退料链和服务端阻断；不证明 RISEMAP 写入行为、权限隔离或页面独立验收。' };
await writeFile('.objectstack/acceptance/subcontract-return-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
