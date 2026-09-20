import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4347';
const database = process.env.FORGE_DB || '.objectstack/otc-shortage-analysis.sqlite';
const api = await connect(endpoint);
const cases = [];
const ids = { operator: api.userId };
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const round4 = value => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '1000' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`);
  return response.value.records.filter(record => Object.entries(where).every(([key, value]) => record[key] === value));
}
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}`);
  return response.value.record;
}
async function create(object, data) {
  const response = await api.request('/data/' + object, 'POST', data);
  assert.equal(response.status, 201, `${object}: ${JSON.stringify(response.value)}`);
  return response.value.id || response.value.record?.id;
}
async function invoke(action, id, params = {}, authenticated = true) {
  return api.request(`/actions/forge_bom/${action}/${id}`, 'POST', { params }, authenticated);
}
function result(response) { return response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value; }

const boms = await find('forge_bom', { status: 'active' });
const bom = boms.find(item => item.bom_type === 'project') || boms[0];
assert.ok(bom, 'active BOM is required');
ids.bom = bom.id;
const nodes = (await find('forge_bom_node', { bom_id: bom.id })).filter(node => node.parent_id && node.sku_id);
assert.equal(nodes.length, 4);
const skuById = Object.fromEntries(await Promise.all(nodes.map(async node => [node.sku_id, await read('forge_material_sku', node.sku_id)])));
const materialById = Object.fromEntries(await Promise.all(Object.values(skuById).map(async sku => [sku.material_id, await read('forge_material', sku.material_id)])));
const materialsBySku = Object.fromEntries(Object.values(skuById).map(sku => [sku.id, materialById[sku.material_id]]));

async function expectation(planned) {
  let totalRequired = 0, totalFulfilled = 0, purchaseAmount = 0, maxProducible = null;
  const rows = [];
  for (const node of nodes) {
    const sku = skuById[node.sku_id], material = materialsBySku[node.sku_id];
    const balances = await find('forge_inventory_balance', { sku_id: sku.id });
    const available = round4(balances.reduce((sum, item) => sum + Number(item.available_quantity || 0), 0));
    const perUnit = Number(node.quantity || 0), required = round4(perUnit * planned), virtual = material.source_type === 'virtual';
    const shortage = virtual ? 0 : round4(Math.max(0, required - available));
    const fulfilled = virtual ? required : Math.min(required, available);
    const untaxed = round4(Number(sku.cost_price || 0) / (1 + Number(bom.tax_rate || 13) / 100));
    const subtotal = round4(shortage * untaxed);
    totalRequired += required; totalFulfilled += fulfilled;
    if (material.source_type === 'purchased') purchaseAmount += subtotal;
    if (!virtual && perUnit > 0) {
      const producible = Math.floor(available / perUnit);
      maxProducible = maxProducible === null ? producible : Math.min(maxProducible, producible);
    }
    rows.push({ code: material.code, available, required, shortage, subtotal });
  }
  return {
    planned,
    component_count: rows.length,
    shortage_count: rows.filter(row => row.shortage > 0).length,
    kit_rate: totalRequired > 0 ? round2(totalFulfilled / totalRequired * 100) : 100,
    max_producible_quantity: maxProducible === null ? 0 : maxProducible,
    estimated_purchase_amount: round2(purchaseAmount),
    rows,
  };
}

await test('rejects anonymous shortage analysis', async () => {
  assert.equal((await invoke('bom_analyze_shortage', bom.id, { planned_quantity: 1 }, false)).status, 401);
});

await test('rejects non-positive planned quantity', async () => {
  const response = await invoke('bom_analyze_shortage', bom.id, { planned_quantity: 0 });
  assert.equal(response.status, 400, JSON.stringify(response.value));
});

let firstExpected;
await test('calculates shortage from the current persisted stock', async () => {
  firstExpected = await expectation(1);
  const response = await invoke('bom_analyze_shortage', bom.id, { planned_quantity: 1 });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const summary = result(response); ids.firstAnalysis = summary.id;
  assert.deepEqual({ planned: summary.planned_quantity, components: summary.component_count, shortage: summary.shortage_count, kit: summary.kit_rate, max: summary.max_producible_quantity, amount: summary.estimated_purchase_amount },
    { planned: firstExpected.planned, components: firstExpected.component_count, shortage: firstExpected.shortage_count, kit: firstExpected.kit_rate, max: firstExpected.max_producible_quantity, amount: firstExpected.estimated_purchase_amount });
  const lines = await find('forge_bom_shortage_line', { analysis_id: summary.id });
  assert.equal(lines.length, 4);
  const byCode = Object.fromEntries(lines.map(line => [line.item_code, line]));
  for (const row of firstExpected.rows) assert.equal(byCode[row.code].shortage_quantity, row.shortage);
});

await test('adds available stock through an approved opening inbound', async () => {
  const warehouse = (await find('forge_warehouse'))[0]; assert.ok(warehouse); ids.warehouse = warehouse.id;
  ids.inbound = await create('forge_opening_inbound', { name: 'BOM齐套分析补充库存', code: 'IN-BOM-MRP-' + stamp, inbound_on: '2026-09-10', warehouse_id: warehouse.id, responsible_id: api.userId });
  const stock = {};
  for (const node of nodes.slice(0, 3)) stock[materialsBySku[node.sku_id].code] = Math.max(1, Number(node.quantity || 1));
  for (const node of nodes) {
    const sku = skuById[node.sku_id], material = materialsBySku[node.sku_id], quantity = stock[material.code];
    if (!quantity) continue;
    await create('forge_opening_inbound_line', { name: material.name, inbound_id: ids.inbound, sku_id: sku.id, item_code: material.code, model: material.model, specification: sku.name, unit_name: '件', quantity, taxed_unit_price: sku.cost_price, untaxed_unit_price: round4(sku.cost_price / 1.13), tax_rate: 13, taxed_amount: round4(quantity * sku.cost_price) });
  }
  const submit = await api.request(`/actions/forge_opening_inbound/opening_inbound_submit/${ids.inbound}`, 'POST', { params: {} });
  assert.equal(submit.status, 200, JSON.stringify(submit.value));
  const approve = await api.request(`/actions/forge_opening_inbound/opening_inbound_approve/${ids.inbound}`, 'POST', { params: { approval_note: '用于BOM齐套分析' } });
  assert.equal(approve.status, 200, JSON.stringify(approve.value));
});

await test('recalculates after stock changes and keeps the first snapshot immutable', async () => {
  const secondExpected = await expectation(2);
  const response = await invoke('bom_analyze_shortage', bom.id, { planned_quantity: 2 });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const summary = result(response); ids.secondAnalysis = summary.id;
  assert.deepEqual({ planned: summary.planned_quantity, components: summary.component_count, shortage: summary.shortage_count, kit: summary.kit_rate, max: summary.max_producible_quantity, amount: summary.estimated_purchase_amount },
    { planned: secondExpected.planned, components: secondExpected.component_count, shortage: secondExpected.shortage_count, kit: secondExpected.kit_rate, max: secondExpected.max_producible_quantity, amount: secondExpected.estimated_purchase_amount });
  const first = await read('forge_bom_shortage_analysis', ids.firstAnalysis);
  assert.deepEqual({ shortage: first.shortage_count, kit: first.kit_rate, amount: first.estimated_purchase_amount }, { shortage: firstExpected.shortage_count, kit: firstExpected.kit_rate, amount: firstExpected.estimated_purchase_amount });
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'risemap-aligned-bom-shortage-current-stock', endpoint, database, ids, cases,
  passed: cases.every(item => item.status === 'passed'),
  risemapObserved: { plannedQuantity: 1, columns: ['物料编码','名称','规格','型号','单位','单机用量','总需求','库存','锁定','可用','缺口','供应商','单价','小计'] },
  boundary: 'This script proves BOM shortage snapshots from the currently persisted stock. It does not claim RISEMAP same-material write completion.',
};
await writeFile('.objectstack/acceptance/bom-shortage-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
