import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const foundationReport = JSON.parse(await readFile('.objectstack/acceptance/sales-foundation-report.json', 'utf8'));
const registry = JSON.parse(await readFile('.objectstack/acceptance/reference-data.json', 'utf8'));
const foundation = Object.fromEntries(registry.results.map(result => [result.key, result.id]));
const api = await connect();
const cases = [];
const ids = {};
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

async function create(object, data) {
  const result = await api.request(`/data/${object}`, 'POST', data);
  assert.ok(result.status >= 200 && result.status < 300, `${object} create: ${JSON.stringify(result.value)}`);
  return result.value.id || result.value.record?.id;
}

async function read(object, id) {
  const result = await api.request(`/data/${object}/${id}`);
  assert.equal(result.status, 200, `${object} read`);
  return result.value.record;
}

async function invoke(object, action, id, authenticated = true) {
  return api.request(`/actions/${object}/${action}/${id}`, 'POST', {}, authenticated);
}

async function removePreviousFixture() {
  try {
    const previous = JSON.parse(await readFile('.objectstack/acceptance/sales-workflow-report.json', 'utf8'));
    const deletionOrder = [
      ['forge_sales_order_line', previous.ids?.orderLine],
      ['forge_sales_order_line', previous.ids?.overOrderLine],
      ['forge_sales_order', previous.ids?.order],
      ['forge_sales_order', previous.ids?.overOrder],
      ['forge_sales_contract_line', previous.ids?.contractLine],
      ['forge_sales_contract', previous.ids?.contract],
      ['forge_quotation_line', previous.ids?.quotationLine],
      ['forge_quotation', previous.ids?.quotation],
    ];
    for (const [object, id] of deletionOrder) if (id) await api.request(`/data/${object}/${id}`, 'DELETE');
  } catch {}
}

await removePreviousFixture();

await test('creates an isolated draft quote-contract-order workflow fixture', async () => {
  ids.quotation = await create('forge_quotation', {
    name: '工作流验收报价', code: 'QT-WF-' + stamp + '-001', customer_id: foundation.customer,
    contact_id: foundation.contact, quotation_type_id: foundationReport.ids.quotationType, issuer_id: foundationReport.ids.issuer,
    quotation_date: '2026-09-09', valid_until: '2026-10-09', payment_method: 'bank_transfer',
    responsible_id: api.userId, remarks: 'OEM-RM-20260909-A workflow fixture',
  });
  ids.quotationLine = await create('forge_quotation_line', {
    name: '800型柔性线控制柜', quotation_id: ids.quotation, line_type: 'material', sku_id: foundation.fg_sku,
    item_code: 'FG-RM-CAB-800-WF', model: 'RM-CAB-800-V1', specification: '默认规格', unit_name: '台',
    quantity: 2, taxed_unit_price: 128000, untaxed_unit_price: 113274.3363, tax_rate: 13,
    discount_rate: 5, taxed_subtotal: 243200, cost_price: 54000,
  });
  ids.contract = await create('forge_sales_contract', {
    name: '工作流验收框架合同', code: 'SC-WF-' + stamp + '-001', contract_type_id: foundationReport.ids.contractType,
    customer_id: foundation.customer, contact_id: foundation.contact, quotation_id: ids.quotation,
    signed_on: '2026-09-09', starts_on: '2026-09-09', ends_on: '2027-09-09', responsible_id: api.userId,
    has_order_amount_limit: true, order_amount_limit: 243200, outside_item_requires_approval: true,
    revenue_trigger: 'shipment', remarks: 'OEM-RM-20260909-A workflow fixture',
  });
  ids.contractLine = await create('forge_sales_contract_line', {
    name: '800型柔性线控制柜', contract_id: ids.contract, quotation_line_id: ids.quotationLine, sku_id: foundation.fg_sku,
    item_code: 'FG-RM-CAB-800-WF', model: 'RM-CAB-800-V1', specification: '默认规格', unit_name: '台',
    quantity_limit: 2, ordered_quantity: 0, taxed_unit_price: 128000, tax_rate: 13, discount_rate: 5, taxed_subtotal: 243200,
  });
});

await test('blocks contract submission until its source quote is accepted', async () => {
  const blocked = await invoke('forge_sales_contract', 'contract_submit', ids.contract);
  assert.equal(blocked.status, 400, JSON.stringify(blocked.value));
  assert.match(blocked.value.error.message, /来源报价需为已接受状态/);
  assert.equal((await read('forge_sales_contract', ids.contract)).status, 'draft');
});

await test('runs quote calculation, approval, sending and customer acceptance in order', async () => {
  let result = await invoke('forge_quotation', 'quotation_recalculate', ids.quotation);
  assert.equal(result.status, 200, JSON.stringify(result.value));
  let quote = await read('forge_quotation', ids.quotation);
  assert.deepEqual(
    { item_count: quote.item_count, subtotal: quote.subtotal, discount_amount: quote.discount_amount, tax_amount: quote.tax_amount, total_amount: quote.total_amount, cost_total: quote.cost_total },
    { item_count: 1, subtotal: 256000, discount_amount: 12800, tax_amount: 27978.7611, total_amount: 243200, cost_total: 108000 },
  );
  for (const [action, status] of [
    ['quotation_submit', 'pending_approval'], ['quotation_approve', 'approved'],
    ['quotation_send', 'sent'], ['quotation_accept', 'accepted'],
  ]) {
    result = await invoke('forge_quotation', action, ids.quotation);
    assert.equal(result.status, 200, `${action}: ${JSON.stringify(result.value)}`);
    quote = await read('forge_quotation', ids.quotation);
    assert.equal(quote.status, status, action);
  }
});

await test('submits and approves the accepted-quote contract', async () => {
  let result = await invoke('forge_sales_contract', 'contract_submit', ids.contract);
  assert.equal(result.status, 200, JSON.stringify(result.value));
  let contract = await read('forge_sales_contract', ids.contract);
  assert.equal(contract.status, 'pending_approval');
  assert.equal(contract.total_amount, 243200);
  result = await invoke('forge_sales_contract', 'contract_approve', ids.contract);
  assert.equal(result.status, 200, JSON.stringify(result.value));
  contract = await read('forge_sales_contract', ids.contract);
  assert.equal(contract.status, 'active');
});

await test('rejects a contract order that exceeds the material quantity limit', async () => {
  ids.overOrder = await create('forge_sales_order', {
    name: '超限订单', code: 'SO-WF-OVER-' + stamp + '-001', source_type: 'contract', customer_id: foundation.customer,
    contact_id: foundation.contact, contract_id: ids.contract, quotation_id: ids.quotation,
    planned_delivery_on: '2026-10-09', responsible_id: api.userId, payment_term: '订单生效后30天内付款',
    payment_method: 'bank_transfer', revenue_trigger: 'shipment', delivery_address: '苏州市工业园区澄岳路9号',
  });
  ids.overOrderLine = await create('forge_sales_order_line', {
    name: '800型柔性线控制柜', order_id: ids.overOrder, contract_line_id: ids.contractLine,
    quotation_line_id: ids.quotationLine, sku_id: foundation.fg_sku, item_code: 'FG-RM-CAB-800-WF-OVER',
    model: 'RM-CAB-800-V1', specification: '默认规格', unit_name: '台', quantity: 3,
    taxed_unit_price: 128000, untaxed_unit_price: 113274.3363, tax_rate: 13, discount_rate: 5, taxed_subtotal: 364800,
  });
  const blocked = await invoke('forge_sales_order', 'sales_order_submit', ids.overOrder);
  assert.equal(blocked.status, 400, JSON.stringify(blocked.value));
  assert.match(blocked.value.error.message, /超过合同剩余额度|超过合同剩余数量/);
  assert.equal((await read('forge_sales_order', ids.overOrder)).status, 'draft');
});

await test('approves an exact-limit order and atomically rolls progress up to the contract', async () => {
  ids.order = await create('forge_sales_order', {
    name: '工作流验收销售订单', code: 'SO-WF-' + stamp + '-001', source_type: 'contract', customer_id: foundation.customer,
    contact_id: foundation.contact, contract_id: ids.contract, quotation_id: ids.quotation,
    planned_delivery_on: '2026-10-09', responsible_id: api.userId, payment_term: '订单生效后30天内付款',
    payment_method: 'bank_transfer', revenue_trigger: 'shipment', delivery_address: '苏州市工业园区澄岳路9号',
  });
  ids.orderLine = await create('forge_sales_order_line', {
    name: '800型柔性线控制柜', order_id: ids.order, contract_line_id: ids.contractLine,
    quotation_line_id: ids.quotationLine, sku_id: foundation.fg_sku, item_code: 'FG-RM-CAB-800-WF-ORDER',
    model: 'RM-CAB-800-V1', specification: '默认规格', unit_name: '台', quantity: 2,
    taxed_unit_price: 128000, untaxed_unit_price: 113274.3363, tax_rate: 13, discount_rate: 5, taxed_subtotal: 243200,
  });
  let result = await invoke('forge_sales_order', 'sales_order_submit', ids.order);
  assert.equal(result.status, 200, JSON.stringify(result.value));
  assert.equal((await read('forge_sales_order', ids.order)).status, 'pending_approval');
  result = await invoke('forge_sales_order', 'sales_order_approve', ids.order);
  assert.equal(result.status, 200, JSON.stringify(result.value));
  const order = await read('forge_sales_order', ids.order);
  const contract = await read('forge_sales_contract', ids.contract);
  const contractLine = await read('forge_sales_contract_line', ids.contractLine);
  assert.equal(order.status, 'active');
  assert.equal(order.total_amount, 243200);
  assert.deepEqual(
    { status: contract.status, ordered_count: contract.ordered_count, ordered_amount: contract.ordered_amount, ordered_quantity: contractLine.ordered_quantity },
    { status: 'active', ordered_count: 1, ordered_amount: 243200, ordered_quantity: 2 },
  );
});

await test('rejects anonymous workflow action dispatch', async () => {
  const result = await invoke('forge_quotation', 'quotation_recalculate', ids.quotation, false);
  assert.equal(result.status, 401);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'local-sales-workflow-api-acceptance',
  fixture: 'OEM-RM-20260909-A-sales-workflow-v0.2', ids, cases,
  observedParity: {
    risemap: ['quote draft -> pending approval -> approved -> sent -> accepted', 'accepted quote gates contract creation', 'contract approval -> active', 'order approval -> active', 'approved order rolls amount/count into contract'],
    forge: ['same lifecycle path executed through declared record actions', 'exact-limit order rolled 243200 and quantity 2 into its contract'],
  },
  passed: cases.every(testCase => testCase.status === 'passed'),
  limitations: [
    'Approval is a single-role action without assignee routing, comments, rejection or withdrawal records.',
    'Quotation-to-contract and contract-to-order conversion still require record creation; the lifecycle gates and rollups are implemented.',
    'Shipment, invoice, collection, revenue recognition and accounting ledgers remain outside this workflow slice.',
  ],
};
await writeFile('.objectstack/acceptance/sales-workflow-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
