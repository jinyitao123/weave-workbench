import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const registry = JSON.parse(await readFile('.objectstack/acceptance/reference-data.json', 'utf8'));
const fixture = Object.fromEntries(registry.results.map(result => [result.key, result.id]));
assert.ok(fixture.warehouse, 'reference fixture warehouse is required');
assert.ok(fixture.fg_sku, 'reference fixture finished-product SKU is required');

const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const cases = [];
const ids = {};
const read = async (object, id) => (await api.request(`/data/${object}/${id}`)).value.record;
const invoke = (action, id, params = {}) => api.request(`/actions/forge_opening_inbound/${action}/${id}`, 'POST', { params });

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

await test('creates a draft opening inbound against the existing warehouse and SKU fixture', async () => {
  const created = await api.request('/data/forge_opening_inbound', 'POST', {
    name: 'OEM 控制柜期初入库', code: 'IN-OPENING-20260909-001', inbound_on: '2026-09-09',
    warehouse_id: fixture.warehouse, responsible_id: api.userId, status: 'stocked',
    remarks: 'OEM-RM-20260909-A；销售出库前建立成品期初库存。',
  });
  assert.equal(created.status, 201, JSON.stringify(created.value));
  ids.inbound = created.value.id || created.value.record?.id;
  assert.ok(ids.inbound);
  const line = await api.request('/data/forge_opening_inbound_line', 'POST', {
    name: '800型柔性线控制柜', inbound_id: ids.inbound, sku_id: fixture.fg_sku,
    item_code: 'FG-RM-CAB-800', model: 'RM-CAB-800-V1', specification: '默认规格', unit_name: '台',
    quantity: 1, taxed_unit_price: 54000, untaxed_unit_price: 47787.6106, tax_rate: 13,
    tax_amount: 6212.3894, taxed_amount: 54000,
  });
  assert.equal(line.status, 201, JSON.stringify(line.value));
  ids.line = line.value.id || line.value.record?.id;
  assert.equal((await read('forge_opening_inbound', ids.inbound)).status, 'draft', 'caller cannot forge stocked status');
});

await test('submits for approval without changing available inventory', async () => {
  const submitted = await invoke('opening_inbound_submit', ids.inbound);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.value));
  const inbound = await read('forge_opening_inbound', ids.inbound);
  assert.deepEqual({ status: inbound.status, line_count: inbound.line_count, total_quantity: inbound.total_quantity, total_amount: inbound.total_amount },
    { status: 'pending_approval', line_count: 1, total_quantity: 1, total_amount: 54000 });
  const query = new URLSearchParams({ $filter: JSON.stringify({ balance_key: `${fixture.warehouse}:${fixture.fg_sku}` }), $top: '10' });
  const balances = await api.request(`/data/forge_inventory_balance?${query}`);
  assert.equal(balances.value.records.length, 0);
});

await test('approval creates the balance and an auditable inbound ledger entry', async () => {
  const approved = await invoke('opening_inbound_approve', ids.inbound, { approval_note: '同意' });
  assert.equal(approved.status, 200, JSON.stringify(approved.value));
  const inbound = await read('forge_opening_inbound', ids.inbound);
  assert.equal(inbound.status, 'stocked');
  assert.equal(inbound.approval_note, '同意');
  assert.ok(inbound.approved_at);

  const balanceQuery = new URLSearchParams({ $filter: JSON.stringify({ balance_key: `${fixture.warehouse}:${fixture.fg_sku}` }), $top: '10' });
  const balances = (await api.request(`/data/forge_inventory_balance?${balanceQuery}`)).value.records;
  assert.equal(balances.length, 1);
  ids.balance = balances[0].id;
  assert.deepEqual({ warehouse_id: balances[0].warehouse_id, sku_id: balances[0].sku_id, on_hand_quantity: balances[0].on_hand_quantity, reserved_quantity: balances[0].reserved_quantity, available_quantity: balances[0].available_quantity, average_cost: balances[0].average_cost, inventory_value: balances[0].inventory_value }, {
    warehouse_id: fixture.warehouse, sku_id: fixture.fg_sku, on_hand_quantity: 1, reserved_quantity: 0, available_quantity: 1, average_cost: 54000, inventory_value: 54000,
  });

  const ledgerQuery = new URLSearchParams({ $filter: JSON.stringify({ source_id: ids.inbound }), $top: '10' });
  const ledgers = (await api.request(`/data/forge_inventory_ledger?${ledgerQuery}`)).value.records;
  assert.equal(ledgers.length, 1);
  ids.ledger = ledgers[0].id;
  assert.deepEqual({ direction: ledgers[0].direction, movement_type: ledgers[0].movement_type, quantity: ledgers[0].quantity, before_on_hand: ledgers[0].before_on_hand, after_on_hand: ledgers[0].after_on_hand, before_available: ledgers[0].before_available, after_available: ledgers[0].after_available, amount: ledgers[0].amount, source_line_id: ledgers[0].source_line_id }, {
    direction: 'inbound', movement_type: 'opening_inbound', quantity: 1, before_on_hand: 0, after_on_hand: 1, before_available: 0, after_available: 1, amount: 54000, source_line_id: ids.line,
  });
});

await test('a second approval accumulates the same balance and recalculates moving-average cost', async () => {
  const created = await api.request('/data/forge_opening_inbound', 'POST', {
    name: 'OEM 控制柜期初补录', code: 'IN-OPENING-20260909-002', inbound_on: '2026-09-09',
    warehouse_id: fixture.warehouse, responsible_id: api.userId,
  });
  assert.equal(created.status, 201, JSON.stringify(created.value));
  ids.secondInbound = created.value.id || created.value.record?.id;
  const line = await api.request('/data/forge_opening_inbound_line', 'POST', {
    name: '800型柔性线控制柜', inbound_id: ids.secondInbound, sku_id: fixture.fg_sku,
    item_code: 'FG-RM-CAB-800', model: 'RM-CAB-800-V1', specification: '默认规格', unit_name: '台',
    quantity: 2, taxed_unit_price: 60000, untaxed_unit_price: 53097.3451, tax_rate: 13,
    tax_amount: 13805.3098, taxed_amount: 120000,
  });
  assert.equal(line.status, 201, JSON.stringify(line.value));
  ids.secondLine = line.value.id || line.value.record?.id;
  assert.equal((await invoke('opening_inbound_submit', ids.secondInbound)).status, 200);
  assert.equal((await invoke('opening_inbound_approve', ids.secondInbound, { approval_note: '同意补录' })).status, 200);

  const balance = await read('forge_inventory_balance', ids.balance);
  assert.deepEqual({ on_hand_quantity: balance.on_hand_quantity, reserved_quantity: balance.reserved_quantity, available_quantity: balance.available_quantity, average_cost: balance.average_cost, inventory_value: balance.inventory_value },
    { on_hand_quantity: 3, reserved_quantity: 0, available_quantity: 3, average_cost: 58000, inventory_value: 174000 });
  const ledgerQuery = new URLSearchParams({ $filter: JSON.stringify({ source_id: ids.secondInbound }), $top: '10' });
  const ledgers = (await api.request(`/data/forge_inventory_ledger?${ledgerQuery}`)).value.records;
  assert.equal(ledgers.length, 1);
  ids.secondLedger = ledgers[0].id;
  assert.deepEqual({ before_on_hand: ledgers[0].before_on_hand, after_on_hand: ledgers[0].after_on_hand, before_available: ledgers[0].before_available, after_available: ledgers[0].after_available, quantity: ledgers[0].quantity },
    { before_on_hand: 1, after_on_hand: 3, before_available: 1, after_available: 3, quantity: 2 });
});

await test('prevents duplicate approval and external balance forgery', async () => {
  const duplicate = await invoke('opening_inbound_approve', ids.inbound, { approval_note: '重复审批' });
  assert.equal(duplicate.status, 400);
  assert.match(duplicate.value.error.message, /仅待审批/);
  const patched = await api.request(`/data/forge_inventory_balance/${ids.balance}`, 'PATCH', { available_quantity: 999, on_hand_quantity: 999 });
  assert.equal(patched.status, 200);
  const balance = await read('forge_inventory_balance', ids.balance);
  assert.equal(balance.on_hand_quantity, 3);
  assert.equal(balance.available_quantity, 3);
});

await test('rejects an empty opening inbound before approval', async () => {
  const created = await api.request('/data/forge_opening_inbound', 'POST', {
    name: '空期初入库单', code: 'IN-OPENING-20260909-EMPTY', inbound_on: '2026-09-09',
    warehouse_id: fixture.warehouse, responsible_id: api.userId,
  });
  assert.equal(created.status, 201);
  const id = created.value.id || created.value.record?.id;
  const submitted = await invoke('opening_inbound_submit', id);
  assert.equal(submitted.status, 400);
  assert.match(submitted.value.error.message, /至少需要一条/);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'local-opening-inventory-api-acceptance', fixture: 'OEM-RM-20260909-A-inventory-v0.1',
  endpoint, database: '.objectstack/inventory.sqlite',
  ids: { ...ids, warehouse: fixture.warehouse, sku: fixture.fg_sku }, cases,
  passed: cases.every(item => item.status === 'passed'),
  observedBoundary: 'Submitting an opening inbound does not change stock. Approval creates one warehouse-SKU balance and one source-linked ledger entry, increasing both on-hand and available quantity.',
  limitations: [
    'The action writes balance, ledger and document state sequentially because ObjectStack 17.3.0 audit writes have timed out inside ctx.api.transaction in this repository.',
    'This slice covers inbound increases. Sales outbound must consume forge_inventory_balance and append an outbound ledger entry in a separate integration change.',
    'Approved-line edit locking, serial/batch tracking, storage locations, rejection, reversal and concurrent approval locking remain outside this slice.',
  ],
};
await writeFile('.objectstack/acceptance/inventory-opening-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
