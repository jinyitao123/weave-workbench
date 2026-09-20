import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const inspectionReport = JSON.parse(await readFile('.objectstack/acceptance/multiline-inspection-report.json', 'utf8'));
assert.ok(inspectionReport.cases?.every(item => item.status === 'passed'), 'multiline inspection acceptance must pass first');
const endpoint = process.env.FORGE_URL || 'http://localhost:4355';
const database = process.env.FORGE_DB || '.objectstack/otc-multiline-inbound-final.sqlite';
const api = await connect(endpoint); const cases = []; const ids = { order: inspectionReport.ids.order, receipt: inspectionReport.ids.receipt };
async function test(name, run) { try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); } catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); } }
async function find(object, where = {}) { const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '100' }); const response = await api.request(`/data/${object}?${query}`); assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`); return response.value.records.filter(record => Object.entries(where).every(([key, value]) => record[key] === value)); }
async function read(object, id) { const response = await api.request(`/data/${object}/${id}`); assert.equal(response.status, 200, `${object}/${id}: ${JSON.stringify(response.value)}`); return response.value.record; }
const invoke = (object, action, id, params = {}, authenticated = true) => api.request(`/actions/${object}/${action}/${id}`, 'POST', { params }, authenticated);
const resultOf = response => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
const inspections = (await find('forge_purchase_inspection', { order_id: ids.order })).filter(item => item.status === 'completed' && Number(item.accepted_quantity) > 0);
assert.equal(inspections.length, 3); ids.inspections = inspections.map(item => item.id);
const lines = inspections.map(item => ({ inspection_id: item.id, quantity: item.accepted_quantity, warehouse_id: item.warehouse_id, warehouse_location: `IQC-${item.item_code}`, remarks: '检验合格数量入库' }));
const params = (mode, selected = lines) => ({ mode, inbound_on: '2026-09-10', remarks: 'OEM-RM-20260909-A 多物料采购入库验收', lines_json: JSON.stringify(selected) });
const beforeBalances = Object.fromEntries(await Promise.all(inspections.map(async item => { const list = await find('forge_inventory_balance', { balance_key: `${item.warehouse_id}:${item.sku_id}` }); assert.ok(list.length <= 1); return [item.sku_id, Number(list[0]?.on_hand_quantity || 0)]; })));
const beforeLedgers = (await find('forge_inventory_ledger')).length;
const beforePayables = (await find('forge_accounts_payable')).length;

await test('rejects anonymous, malformed and over-accepted inbound creation', async () => {
  assert.equal((await invoke('forge_purchase_order', 'purchase_order_create_inbound', ids.order, params('draft'), false)).status, 401);
  const malformed = await invoke('forge_purchase_order', 'purchase_order_create_inbound', ids.order, { ...params('draft'), lines_json: '{bad' });
  assert.equal(malformed.status, 400, JSON.stringify(malformed.value)); assert.match(malformed.value.error.message, /格式错误/);
  const over = await invoke('forge_purchase_order', 'purchase_order_create_inbound', ids.order, params('draft', [{ ...lines[0], quantity: Number(lines[0].quantity) + 1 }]));
  assert.equal(over.status, 400, JSON.stringify(over.value)); assert.match(over.value.error.message, /超过检验合格剩余数量/);
});

await test('creates one auto-numbered three-line draft without touching stock or payables', async () => {
  const response = await invoke('forge_purchase_order', 'purchase_order_create_inbound', ids.order, params('draft'));
  assert.equal(response.status, 200, JSON.stringify(response.value)); const result = resultOf(response); ids.inbound = result.id;
  assert.deepEqual({ code: result.code, status: result.status, lines: result.line_count, quantity: result.total_quantity, untaxed: result.untaxed_amount, taxed: result.taxed_amount },
    { code: 'PIN-2026-0001', status: 'draft', lines: 3, quantity: 3, untaxed: 9610.62, taxed: 10860 });
  const inbound = await read('forge_purchase_inbound', ids.inbound); assert.deepEqual({ receipt: inbound.receipt_id, order: inbound.order_id, lines: inbound.line_count, quantity: inbound.total_quantity, status: inbound.status }, { receipt: ids.receipt, order: ids.order, lines: 3, quantity: 3, status: 'draft' });
  const saved = await find('forge_purchase_inbound_line', { inbound_id: ids.inbound }); ids.lines = saved.map(item => item.id); assert.equal(saved.length, 3); assert.ok(saved.every(item => item.status === 'draft'));
  assert.equal((await find('forge_inventory_ledger')).length, beforeLedgers); assert.equal((await find('forge_accounts_payable')).length, beforePayables);
  for (const inspection of inspections) { const balances = await find('forge_inventory_balance', { balance_key: `${inspection.warehouse_id}:${inspection.sku_id}` }); assert.equal(Number(balances[0]?.on_hand_quantity || 0), beforeBalances[inspection.sku_id]); }
});

await test('reserves accepted quantities at draft stage and blocks a duplicate claim', async () => {
  const duplicate = await invoke('forge_purchase_order', 'purchase_order_create_inbound', ids.order, params('submit'));
  assert.equal(duplicate.status, 400, JSON.stringify(duplicate.value)); assert.match(duplicate.value.error.message, /超过检验合格剩余数量/);
  assert.equal((await find('forge_purchase_inbound', { order_id: ids.order })).length, 1);
});

await test('submits and approves without inventory movement and requires an approval comment', async () => {
  let response = await invoke('forge_purchase_inbound', 'purchase_inbound_submit', ids.inbound); assert.equal(response.status, 200, JSON.stringify(response.value));
  assert.equal((await read('forge_purchase_inbound', ids.inbound)).status, 'pending_approval'); assert.equal((await find('forge_inventory_ledger')).length, beforeLedgers);
  response = await invoke('forge_purchase_inbound', 'purchase_inbound_approve', ids.inbound, { approval_note: ' ' }); assert.equal(response.status, 400, JSON.stringify(response.value)); assert.match(response.value.error.message, /审批意见不能为空|approval_note/);
  response = await invoke('forge_purchase_inbound', 'purchase_inbound_approve', ids.inbound, { approval_note: '数量、检验结果与仓库信息已核对' }); assert.equal(response.status, 200, JSON.stringify(response.value));
  assert.equal((await read('forge_purchase_inbound', ids.inbound)).status, 'approved'); assert.equal((await find('forge_inventory_ledger')).length, beforeLedgers); assert.equal((await find('forge_accounts_payable')).length, beforePayables);
});

await test('stocks each approved material exactly once and rolls up receipt and order state', async () => {
  const response = await invoke('forge_purchase_inbound', 'purchase_inbound_stock', ids.inbound); assert.equal(response.status, 200, JSON.stringify(response.value)); const result = resultOf(response);
  assert.deepEqual({ status: result.status, lines: result.line_count, quantity: result.total_quantity, order: result.order_status }, { status: 'stocked', lines: 3, quantity: 3, order: 'partially_arrived' });
  const savedLines = await find('forge_purchase_inbound_line', { inbound_id: ids.inbound }); assert.ok(savedLines.every(item => item.status === 'stocked' && item.after_on_hand === item.before_on_hand + item.quantity));
  const ledgers = (await find('forge_inventory_ledger', { source_id: ids.inbound })).filter(item => item.source_object === 'forge_purchase_inbound'); assert.equal(ledgers.length, 3); assert.equal(ledgers.reduce((sum, item) => sum + Number(item.quantity), 0), 3);
  for (const inspection of inspections) { const balances = await find('forge_inventory_balance', { balance_key: `${inspection.warehouse_id}:${inspection.sku_id}` }); assert.equal(Number(balances[0]?.on_hand_quantity || 0), beforeBalances[inspection.sku_id] + Number(inspection.accepted_quantity)); }
  assert.equal((await read('forge_purchase_receipt', ids.receipt)).status, 'stocked'); const order = await read('forge_purchase_order', ids.order); assert.deepEqual({ inbound: order.inbound_quantity, status: order.status }, { inbound: 3, status: 'partially_arrived' });
  assert.equal((await find('forge_accounts_payable')).length, beforePayables, 'purchase inbound must not fabricate an unverified payable');
  const logs = await find('forge_purchase_inbound_approval_log', { inbound_id: ids.inbound }); assert.deepEqual(logs.map(item => item.action).sort(), ['approved', 'stocked', 'submitted']);
});

await test('blocks repeated stock execution', async () => {
  const response = await invoke('forge_purchase_inbound', 'purchase_inbound_stock', ids.inbound); assert.equal(response.status, 400, JSON.stringify(response.value)); assert.match(response.value.error.message, /仅已审批|状态/);
  assert.equal((await find('forge_inventory_ledger', { source_id: ids.inbound })).length, 3);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = { recordedAt: new Date().toISOString(), kind: 'risemap-aligned-multiline-purchase-inbound-acceptance', fixture: 'OEM-RM-20260909-A-multiline-inbound-v0.1', endpoint, database, ids, beforeBalances, cases, passed: cases.every(item => item.status === 'passed'),
  risemapObserved: { entry: '采购入库', source: '未完成采购订单', workflow: ['草稿','待审批','已审批','已入库'], lineColumns: ['入库日期','入库单号','入库类型','仓库','往来单位','制单人','物料','规格型号','单位','数量','含税单价','不含税单价','税率','含税金额','库位','批次','状态'] },
  boundary: 'This slice proves order-level multi-line purchase inbound, approval and inventory posting. RISEMAP same-material submission outcome and payable trigger remain pending confirmation; no payable is created.' };
await writeFile('.objectstack/acceptance/multiline-inbound-report.json', JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;
