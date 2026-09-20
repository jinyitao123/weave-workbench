import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4387';
const database = process.env.FORGE_DB || '.objectstack/data/objectstack.db';
const base = JSON.parse(await readFile('.objectstack/acceptance/subcontract-order-report.json', 'utf8'));
const api = await connect(endpoint), cases = [], ids = { ...base.ids, operator: api.userId }, stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
const round4 = value => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
async function test(name, run) { try { await run(); cases.push({ name, status: 'passed' }); console.log('PASS ' + name); } catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error('FAIL ' + name + ': ' + error.message); } }
async function create(object, values) { const r = await api.request('/data/' + object, 'POST', values); assert.equal(r.status, 201, object + ': ' + JSON.stringify(r.value)); return r.value.id || r.value.record?.id; }
async function read(object, id) { const r = await api.request('/data/' + object + '/' + id); assert.equal(r.status, 200, object + '/' + id); return r.value.record; }
async function find(object, where = {}) { const q = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' }), r = await api.request('/data/' + object + '?' + q); assert.equal(r.status, 200, object); return (r.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value)); }
const invoke = (object, action, id, params = {}, authenticated = true) => api.request('/actions/' + object + '/' + action + '/' + id, 'POST', { params }, authenticated);
const resultOf = r => r.value?.result ?? r.value?.data?.result ?? r.value?.data ?? r.value;

ids.openingInbound = await create('forge_opening_inbound', {
  name: '委外发料验收期初入库', code: `IN-SC-ISSUE-${stamp}`, inbound_on: '2026-09-12',
  warehouse_id: ids.issueWarehouse, responsible_id: api.userId, remarks: '为委外发料建立真实库存账',
});
ids.openingInboundLine = await create('forge_opening_inbound_line', {
  name: 'SC-RM-001 委外原料', inbound_id: ids.openingInbound, sku_id: ids.rawSku,
  item_code: 'SC-RM-001', model: 'SC-RM-001', specification: '默认规格', unit_name: '件',
  quantity: 30, taxed_unit_price: 12.5, untaxed_unit_price: 11.0619, tax_rate: 13,
  tax_amount: 43.1416, taxed_amount: 375,
});
let stockSetup = await invoke('forge_opening_inbound', 'opening_inbound_submit', ids.openingInbound);
assert.equal(stockSetup.status, 200, JSON.stringify(stockSetup.value));
stockSetup = await invoke('forge_opening_inbound', 'opening_inbound_approve', ids.openingInbound, { approval_note: '委外发料验收期初库存建账' });
assert.equal(stockSetup.status, 200, JSON.stringify(stockSetup.value));
const sourceBalances = await find('forge_inventory_balance', { balance_key: ids.issueWarehouse + ':' + ids.rawSku });
assert.equal(sourceBalances.length, 1, JSON.stringify(sourceBalances));
ids.sourceBalance = sourceBalances[0].id;
const sourceBaseline = { onHand: Number(sourceBalances[0].on_hand_quantity || 0), reserved: Number(sourceBalances[0].reserved_quantity || 0), available: Number(sourceBalances[0].available_quantity || 0), value: Number(sourceBalances[0].inventory_value || 0) };

await test('denies anonymous issue creation and blocks non-eligible order branches or quantities above the configured limit', async () => {
  let r = await invoke('forge_subcontract_order', 'subcontract_issue_create', ids.customerSuppliedOrder, { issue_code: `SI-ANON-${stamp}`, issue_type: 'normal', issue_on: '2026-09-12', lines_json: JSON.stringify([{ plan_id: ids.customerPlan, quantity: 1 }]) }, false);
  assert.equal(r.status, 401);
  r = await invoke('forge_subcontract_order', 'subcontract_issue_create', ids.turnkeyOrder, { issue_code: `SI-TURNKEY-${stamp}`, issue_type: 'normal', issue_on: '2026-09-12', lines_json: JSON.stringify([{ plan_id: ids.customerPlan, quantity: 1 }]) });
  assert.ok(r.status >= 400, JSON.stringify(r.value));
  r = await invoke('forge_subcontract_order', 'subcontract_issue_create', ids.customerSuppliedOrder, { issue_code: `SI-OVER-${stamp}`, issue_type: 'overconsumption', issue_on: '2026-09-12', lines_json: JSON.stringify([{ plan_id: ids.customerPlan, quantity: 31 }]) });
  assert.ok(r.status >= 400, JSON.stringify(r.value));
});

await test('creates a normal issue within the configured 1.5x limit', async () => {
  const r = await invoke('forge_subcontract_order', 'subcontract_issue_create', ids.customerSuppliedOrder, { issue_code: `SI-API-${stamp}-001`, issue_type: 'normal', issue_on: '2026-09-12', lines_json: JSON.stringify([{ plan_id: ids.customerPlan, quantity: 6, batch_number: 'SC-BATCH-001' }]), remarks: '首批委外发料' });
  assert.equal(r.status, 200, JSON.stringify(r.value)); ids.issue = resultOf(r).id; ids.issueLine = resultOf(r).line_ids[0];
  const [issue, line] = await Promise.all([read('forge_subcontract_issue', ids.issue), read('forge_subcontract_issue_line', ids.issueLine)]);
  assert.deepEqual({ status: issue.status, qty: issue.total_quantity, warehouse: issue.warehouse_id, line: [line.planned_quantity, line.remaining_snapshot, line.issue_quantity, line.batch_number] }, { status: 'draft', qty: 6, warehouse: ids.issueWarehouse, line: [20, 20, 6, 'SC-BATCH-001'] });
  const tooMuch = await invoke('forge_subcontract_order', 'subcontract_issue_create', ids.customerSuppliedOrder, { issue_code: `SI-TOO-MUCH-${stamp}`, issue_type: 'normal', issue_on: '2026-09-12', lines_json: JSON.stringify([{ plan_id: ids.customerPlan, quantity: 25 }]) });
  assert.ok(tooMuch.status >= 400, JSON.stringify(tooMuch.value));
});

await test('submits and approves with source inventory lock and generated outbound', async () => {
  let r = await invoke('forge_subcontract_issue', 'subcontract_issue_submit', ids.issue); assert.equal(r.status, 200, JSON.stringify(r.value));
  r = await invoke('forge_subcontract_issue', 'subcontract_issue_review', ids.issue, { decision: 'approve', comment: '订单与批次核对通过，同意锁定并出库' }); assert.equal(r.status, 200, JSON.stringify(r.value)); ids.outbound = resultOf(r).outbound_id;
  const [issue, line, balance, outbound] = await Promise.all([read('forge_subcontract_issue', ids.issue), read('forge_subcontract_issue_line', ids.issueLine), read('forge_inventory_balance', ids.sourceBalance), read('forge_subcontract_outbound', ids.outbound)]);
  assert.deepEqual({ issue: issue.status, line: [line.status, line.reserved_quantity], stockDelta: [round4(Number(balance.on_hand_quantity)-sourceBaseline.onHand), round4(Number(balance.reserved_quantity)-sourceBaseline.reserved), round4(Number(balance.available_quantity)-sourceBaseline.available)], outbound: outbound.status }, { issue: 'ready_to_issue', line: ['reserved', 6], stockDelta: [0, 6, -6], outbound: 'pending' });
});

await test('rejects another issue without locking inventory', async () => {
  let r = await invoke('forge_subcontract_order', 'subcontract_issue_create', ids.customerSuppliedOrder, { issue_code: `SI-API-REJECT-${stamp}`, issue_type: 'normal', issue_on: '2026-09-13', lines_json: JSON.stringify([{ plan_id: ids.customerPlan, quantity: 4 }]) }); assert.equal(r.status, 200, JSON.stringify(r.value)); ids.rejectedIssue = resultOf(r).id;
  await invoke('forge_subcontract_issue', 'subcontract_issue_submit', ids.rejectedIssue);
  r = await invoke('forge_subcontract_issue', 'subcontract_issue_review', ids.rejectedIssue, { decision: 'reject', comment: '批次信息缺失，退回补充' }); assert.equal(r.status, 200, JSON.stringify(r.value));
  const balance = await read('forge_inventory_balance', ids.sourceBalance); assert.deepEqual([round4(Number(balance.on_hand_quantity)-sourceBaseline.onHand), round4(Number(balance.reserved_quantity)-sourceBaseline.reserved), round4(Number(balance.available_quantity)-sourceBaseline.available)], [0, 6, -6]);
});

await test('dispatches to source and subcontract stock ledgers exactly once', async () => {
  let r = await invoke('forge_subcontract_issue', 'subcontract_issue_dispatch', ids.issue, { comment: '仓库实物复核完成，确认发往供应商' }); assert.equal(r.status, 200, JSON.stringify(r.value)); assert.equal(resultOf(r).inventory_amount, 75);
  r = await invoke('forge_subcontract_issue', 'subcontract_issue_dispatch', ids.issue, { comment: '重复出库' }); assert.ok(r.status >= 400, JSON.stringify(r.value));
  const [balance, plan, order, outbound, sourceLedgers, stockBalances, stockLedgers] = await Promise.all([read('forge_inventory_balance', ids.sourceBalance), read('forge_subcontract_material_plan', ids.customerPlan), read('forge_subcontract_order', ids.customerSuppliedOrder), read('forge_subcontract_outbound', ids.outbound), find('forge_inventory_ledger', { source_id: ids.issue }), find('forge_subcontract_stock_balance', { order_id: ids.customerSuppliedOrder }), find('forge_subcontract_stock_ledger', { source_id: ids.issue })]);
  ids.stockBalance = stockBalances[0]?.id; ids.stockLedger = stockLedgers[0]?.id; ids.sourceLedger = sourceLedgers[0]?.id;
  assert.deepEqual({ sourceDelta: [round4(Number(balance.on_hand_quantity)-sourceBaseline.onHand), round4(Number(balance.reserved_quantity)-sourceBaseline.reserved), round4(Number(balance.available_quantity)-sourceBaseline.available), round4(Number(balance.inventory_value)-sourceBaseline.value)], plan: plan.issued_quantity, order: [order.status, order.issued_quantity], outbound: outbound.status, ledgers: [sourceLedgers.length, stockLedgers.length], stock: [stockBalances[0]?.cumulative_issued_quantity, stockBalances[0]?.on_hand_quantity, stockBalances[0]?.inventory_value] }, { sourceDelta: [-6, 0, -6, -75], plan: 6, order: ['in_progress', 6], outbound: 'outbounded', ledgers: [1, 1], stock: [6, 6, 75] });
});

await test('records supplier sign-off without starting processing or moving stock again', async () => {
  const r = await invoke('forge_subcontract_issue', 'subcontract_issue_sign', ids.issue, { sign_note: '供应商收货 6 件，外包装完好' }); assert.equal(r.status, 200, JSON.stringify(r.value)); assert.equal(resultOf(r).processing_started, false);
  const [issue, line, balance, stock, logs] = await Promise.all([read('forge_subcontract_issue', ids.issue), read('forge_subcontract_issue_line', ids.issueLine), read('forge_inventory_balance', ids.sourceBalance), read('forge_subcontract_stock_balance', ids.stockBalance), find('forge_subcontract_issue_log', { issue_id: ids.issue })]);
  assert.deepEqual({ issue: issue.status, line: line.status, sourceDelta: [round4(Number(balance.on_hand_quantity)-sourceBaseline.onHand), round4(Number(balance.available_quantity)-sourceBaseline.available)], stock: stock.on_hand_quantity, actions: logs.map(x => x.action).sort() }, { issue: 'signed', line: 'signed', sourceDelta: [-6, -6], stock: 6, actions: ['approved', 'issued', 'signed', 'submitted'] });
});

const report = { suite: 'subcontract-issue-inventory', endpoint, database, ids, cases, passed: cases.every(x => x.status === 'passed'), completedAt: new Date().toISOString(), result: { apiIssue: { code: `SI-API-${stamp}-001`, quantity: 6, inventoryAmount: 75, status: 'signed' }, sourceInventory: { before: sourceBaseline.onHand, after: round4(sourceBaseline.onHand - 6), reserved: sourceBaseline.reserved, available: round4(sourceBaseline.available - 6) }, subcontractStock: { issued: 6, onHand: 6, value: 75 }, rejectedIssue: { code: `SI-API-REJECT-${stamp}`, stockLock: 0 }, logs: 6 }, risemapLiveEvidence: { list: '/subcontract/issues', create: '/subcontract/issues/new', guide: '/subcontract/guide#发料管理', observed: ['列表四项状态概览和八列表头', '新建页正常发料与超耗补料入口、订单、日期、经办人、只读供应商和备注', '只有已审核甲供料且仍有待发数量的订单可选', '审核后生成委外出库单和库存锁定', '实际发出后生成原仓出库和供应商委外仓入库流水', '供应商签收不自动开始加工'] }, boundary: '已闭环正常委外发料的订单资格、草稿、提交、驳回、审核锁定、委外出库、供应商侧在外库存和签收。超耗补料、并发事务、撤回、回厂倒冲与余料退回进入后续切片。' };
await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/subcontract-issue-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
