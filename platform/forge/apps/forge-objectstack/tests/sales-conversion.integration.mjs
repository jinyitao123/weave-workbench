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

async function find(object, where) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '20' });
  const result = await api.request(`/data/${object}?${query}`);
  assert.equal(result.status, 200, `${object} find`);
  return result.value.records.filter(record => Object.entries(where).every(([field, value]) => record[field] === value));
}

async function invoke(object, action, id, params = {}) {
  return api.request(`/actions/${object}/${action}/${id}`, 'POST', { params });
}

function actionResult(response) {
  return response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
}

async function removePreviousFixture() {
  try {
    const previous = JSON.parse(await readFile('.objectstack/acceptance/sales-conversion-report.json', 'utf8'));
    const deletionOrder = [
      ['forge_sales_order_line', previous.ids?.orderLine], ['forge_sales_order', previous.ids?.order],
      ['forge_sales_contract_line', previous.ids?.contractLine], ['forge_sales_contract', previous.ids?.contract],
      ['forge_quotation_line', previous.ids?.quotationLine], ['forge_quotation', previous.ids?.quotation],
    ];
    for (const [object, id] of deletionOrder) if (id) await api.request(`/data/${object}/${id}`, 'DELETE');
  } catch {}
}

await removePreviousFixture();

await test('creates and accepts an isolated quotation for conversion', async () => {
  ids.quotation = await create('forge_quotation', {
    name: '一键转换验收报价', code: 'QT-CONVERT-' + stamp + '-001', customer_id: foundation.customer,
    contact_id: foundation.contact, quotation_type_id: foundationReport.ids.quotationType, issuer_id: foundationReport.ids.issuer,
    quotation_date: '2026-09-09', valid_until: '2026-10-09', payment_method: 'bank_transfer',
    responsible_id: api.userId, business_terms: '含税、含包装，运输与现场服务另行约定。',
  });
  ids.quotationLine = await create('forge_quotation_line', {
    name: '800型柔性线控制柜', quotation_id: ids.quotation, line_type: 'material', sku_id: foundation.fg_sku,
    item_code: 'FG-RM-CAB-800-CONVERT', model: 'RM-CAB-800-V1', specification: '默认规格', unit_name: '台',
    quantity: 2, taxed_unit_price: 128000, untaxed_unit_price: 113274.3363, tax_rate: 13,
    discount_rate: 5, taxed_subtotal: 243200, cost_price: 54000,
  });
  for (const action of ['quotation_recalculate', 'quotation_submit', 'quotation_approve', 'quotation_send', 'quotation_accept']) {
    const response = await invoke('forge_quotation', action, ids.quotation);
    assert.equal(response.status, 200, `${action}: ${JSON.stringify(response.value)}`);
  }
  assert.equal((await read('forge_quotation', ids.quotation)).status, 'accepted');
});

await test('converts an accepted quotation into one contract and copied line', async () => {
  const response = await invoke('forge_quotation', 'quotation_convert_to_contract', ids.quotation, {
    contract_type_id: foundationReport.ids.contractType, code: 'SC-CONVERT-' + stamp + '-001',
    name: '一键转换验收框架合同', starts_on: '2026-09-09', ends_on: '2027-09-09',
  });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  ids.contract = actionResult(response).id;
  assert.ok(ids.contract, 'converted contract id');
  const contract = await read('forge_sales_contract', ids.contract);
  assert.deepEqual(
    { status: contract.status, quotation_id: contract.quotation_id, total_amount: contract.total_amount, order_amount_limit: contract.order_amount_limit },
    { status: 'draft', quotation_id: ids.quotation, total_amount: 243200, order_amount_limit: 243200 },
  );
  const lines = await find('forge_sales_contract_line', { contract_id: ids.contract });
  assert.equal(lines.length, 1);
  ids.contractLine = lines[0].id;
  assert.deepEqual(
    { quotation_line_id: lines[0].quotation_line_id, quantity_limit: lines[0].quantity_limit, discount_rate: lines[0].discount_rate, taxed_subtotal: lines[0].taxed_subtotal },
    { quotation_line_id: ids.quotationLine, quantity_limit: 2, discount_rate: 5, taxed_subtotal: 243200 },
  );
});

await test('rejects repeated quotation conversion without creating another contract', async () => {
  const response = await invoke('forge_quotation', 'quotation_convert_to_contract', ids.quotation, {
    contract_type_id: foundationReport.ids.contractType, code: 'SC-CONVERT-' + stamp + '-REPEAT',
    name: '重复合同', starts_on: '2026-09-09', ends_on: '2027-09-09',
  });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /已转换为合同/);
  assert.equal((await find('forge_sales_contract', { quotation_id: ids.quotation })).length, 1);
});

await test('approves the generated contract and converts all remaining quantity into one order', async () => {
  for (const action of ['contract_submit', 'contract_approve']) {
    const response = await invoke('forge_sales_contract', action, ids.contract);
    assert.equal(response.status, 200, `${action}: ${JSON.stringify(response.value)}`);
  }
  const response = await invoke('forge_sales_contract', 'contract_convert_to_sales_order', ids.contract, {
    code: 'SO-CONVERT-' + stamp + '-001', name: '一键转换验收销售订单', planned_delivery_on: '2026-10-09',
    payment_term: '订单生效后30天内付款', payment_method: 'bank_transfer', delivery_address: '苏州市工业园区澄岳路9号',
  });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  ids.order = actionResult(response).id;
  assert.ok(ids.order, 'converted order id');
  const order = await read('forge_sales_order', ids.order);
  assert.deepEqual(
    { status: order.status, source_type: order.source_type, contract_id: order.contract_id, quotation_id: order.quotation_id, total_amount: order.total_amount },
    { status: 'draft', source_type: 'contract', contract_id: ids.contract, quotation_id: ids.quotation, total_amount: 243200 },
  );
  const lines = await find('forge_sales_order_line', { order_id: ids.order });
  assert.equal(lines.length, 1);
  ids.orderLine = lines[0].id;
  assert.deepEqual(
    { contract_line_id: lines[0].contract_line_id, quotation_line_id: lines[0].quotation_line_id, quantity: lines[0].quantity, taxed_subtotal: lines[0].taxed_subtotal },
    { contract_line_id: ids.contractLine, quotation_line_id: ids.quotationLine, quantity: 2, taxed_subtotal: 243200 },
  );
});

await test('rejects repeated contract conversion and approves the generated order with exact rollup', async () => {
  const repeated = await invoke('forge_sales_contract', 'contract_convert_to_sales_order', ids.contract, {
    code: 'SO-CONVERT-' + stamp + '-REPEAT', name: '重复订单', planned_delivery_on: '2026-10-09',
    payment_term: '订单生效后30天内付款', payment_method: 'bank_transfer',
  });
  assert.equal(repeated.status, 400, JSON.stringify(repeated.value));
  assert.match(repeated.value.error.message, /已有未取消的销售订单/);
  assert.equal((await find('forge_sales_order', { contract_id: ids.contract })).length, 1);
  for (const action of ['sales_order_submit', 'sales_order_approve']) {
    const response = await invoke('forge_sales_order', action, ids.order);
    assert.equal(response.status, 200, `${action}: ${JSON.stringify(response.value)}`);
  }
  const contract = await read('forge_sales_contract', ids.contract);
  const contractLine = await read('forge_sales_contract_line', ids.contractLine);
  assert.deepEqual(
    { order_status: (await read('forge_sales_order', ids.order)).status, ordered_count: contract.ordered_count, ordered_amount: contract.ordered_amount, ordered_quantity: contractLine.ordered_quantity },
    { order_status: 'active', ordered_count: 1, ordered_amount: 243200, ordered_quantity: 2 },
  );
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'local-sales-conversion-api-acceptance',
  fixture: 'OEM-RM-20260909-A-sales-conversion-v0.3', ids, cases,
  passed: cases.every(testCase => testCase.status === 'passed'),
  limitations: [
    'Contract conversion requires contract type, code, name and dates from the user; it copies all quotation lines.',
    'Order conversion creates one order for all remaining contract quantities and blocks another non-cancelled order.',
    'Partial releases, cancelled-order replacement, concurrent conversion races and database-level idempotency remain outside this slice.',
  ],
};
await writeFile('.objectstack/acceptance/sales-conversion-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
