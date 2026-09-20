import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const registry = JSON.parse(await readFile('.objectstack/acceptance/reference-data.json', 'utf8'));
const foundation = Object.fromEntries(registry.results.map(result => [result.key, result.id]));
const api = await connect();
const cases = [];

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

async function upsert(object, keyField, data) {
  const query = new URLSearchParams({ $filter: JSON.stringify({ [keyField]: data[keyField] }), $top: '10' });
  const found = await api.request(`/data/${object}?${query}`);
  assert.equal(found.status, 200, `${object} lookup`);
  const matches = found.value.records.filter(record => record[keyField] === data[keyField]);
  assert.ok(matches.length <= 1, `${object}.${keyField} must be unique in fixture`);
  const saved = matches.length
    ? await api.request(`/data/${object}/${matches[0].id}`, 'PATCH', data)
    : await api.request(`/data/${object}`, 'POST', data);
  assert.ok(saved.status >= 200 && saved.status < 300, `${object} save: ${JSON.stringify(saved.value)}`);
  return saved.value.id || saved.value.record?.id || matches[0]?.id;
}

const ids = {};
await test('creates prerequisites and a complete quote-contract-order chain', async () => {
  ids.quotationType = await upsert('forge_quotation_type', 'name', { name: '设备销售报价', code: 'equipment_sale', status: 'active' });
  ids.issuer = await upsert('forge_quotation_issuer', 'credit_code', {
    name: '苏州炬铸智能科技有限公司', short_name: '炬铸智能', credit_code: '91320594MAFORGE001',
    address: '苏州市工业园区星湖街88号', phone: '0512-66000001', email: 'sales@example.invalid',
  });
  ids.contractType = await upsert('forge_contract_type', 'name', { name: '年度设备框架合同', code: 'annual_equipment', status: 'active' });
  ids.quotation = await upsert('forge_quotation', 'code', {
    name: '800型柔性线控制柜正式报价', code: 'QT-OEM-20260909-001', customer_id: foundation.customer,
    contact_id: foundation.contact, quotation_type_id: ids.quotationType, issuer_id: ids.issuer,
    quotation_date: '2026-09-09', valid_until: '2026-10-09', payment_method: 'bank_transfer',
    payment_term: '合同签订后30%预付，发货前付清余款', responsible_id: api.userId,
    item_count: 1, subtotal: 256000, discount_amount: 12800, tax_amount: 27978.7611,
    total_amount: 243200, cost_total: 108000, business_terms: '含税、含包装，运输与现场服务另行约定。',
  });
  ids.quotationLine = await upsert('forge_quotation_line', 'item_code', {
    name: '800型柔性线控制柜', quotation_id: ids.quotation, line_type: 'material', sku_id: foundation.fg_sku,
    item_code: 'FG-RM-CAB-800', model: 'RM-CAB-800-V1', specification: '默认规格', unit_name: '台',
    quantity: 2, taxed_unit_price: 128000, untaxed_unit_price: 113274.3363, tax_rate: 13,
    discount_rate: 5, taxed_subtotal: 243200, cost_price: 54000,
  });
  ids.contract = await upsert('forge_sales_contract', 'code', {
    name: '澄岳自动化2026年度控制柜框架合同', code: 'CT-OEM-20260909-001', customer_po_number: 'CY-PO-2026-0912',
    contract_type_id: ids.contractType, customer_id: foundation.customer, contact_id: foundation.contact,
    quotation_id: ids.quotation, signed_on: '2026-09-12', starts_on: '2026-09-12', ends_on: '2027-09-11',
    responsible_id: api.userId, total_amount: 243200, has_order_amount_limit: true, order_amount_limit: 243200,
    outside_item_requires_approval: true, all_orders_require_approval: false, revenue_trigger: 'shipment',
  });
  ids.contractLine = await upsert('forge_sales_contract_line', 'item_code', {
    name: '800型柔性线控制柜', contract_id: ids.contract, quotation_line_id: ids.quotationLine, sku_id: foundation.fg_sku,
    item_code: 'FG-RM-CAB-800', model: 'RM-CAB-800-V1', specification: '默认规格', unit_name: '台',
    quantity_limit: 2, ordered_quantity: 1, taxed_unit_price: 121600, tax_rate: 13, discount_rate: 5, taxed_subtotal: 243200,
  });
  ids.order = await upsert('forge_sales_order', 'code', {
    name: '澄岳自动化控制柜首批订单', code: 'SO-OEM-20260912-001', customer_po_number: 'CY-PO-2026-0912-01',
    source_type: 'contract', customer_id: foundation.customer, contact_id: foundation.contact,
    contract_id: ids.contract, quotation_id: ids.quotation, planned_delivery_on: '2026-10-20', responsible_id: api.userId,
    use_credit: false, payment_term: '合同签订后30%预付，发货前付清余款', payment_method: 'bank_transfer',
    revenue_trigger: 'shipment', total_amount: 121600, delivery_address: '苏州市工业园区澄岳路9号',
    delivery_contact: '周启明', delivery_phone: '13800000000',
  });
  ids.orderLine = await upsert('forge_sales_order_line', 'item_code', {
    name: '800型柔性线控制柜', order_id: ids.order, contract_line_id: ids.contractLine, quotation_line_id: ids.quotationLine,
    sku_id: foundation.fg_sku, item_code: 'FG-RM-CAB-800', model: 'RM-CAB-800-V1', specification: '默认规格', unit_name: '台',
    quantity: 1, shipped_quantity: 0, invoiced_quantity: 0, taxed_unit_price: 121600,
    untaxed_unit_price: 107610.6195, tax_rate: 13, discount_rate: 5, taxed_subtotal: 121600, planned_delivery_on: '2026-10-20',
  });
});

await test('reads the chain back with exact source links and four-decimal prices', async () => {
  const quote = (await api.request(`/data/forge_quotation/${ids.quotation}`)).value.record;
  const quoteLine = (await api.request(`/data/forge_quotation_line/${ids.quotationLine}`)).value.record;
  const contract = (await api.request(`/data/forge_sales_contract/${ids.contract}`)).value.record;
  const contractLine = (await api.request(`/data/forge_sales_contract_line/${ids.contractLine}`)).value.record;
  const order = (await api.request(`/data/forge_sales_order/${ids.order}`)).value.record;
  const orderLine = (await api.request(`/data/forge_sales_order_line/${ids.orderLine}`)).value.record;
  assert.equal(quote.customer_id, foundation.customer);
  assert.equal(quote.total_amount, 243200);
  assert.equal(quoteLine.untaxed_unit_price, 113274.3363);
  assert.equal(contract.quotation_id, ids.quotation);
  assert.equal(contractLine.quotation_line_id, ids.quotationLine);
  assert.equal(order.contract_id, ids.contract);
  assert.equal(order.quotation_id, ids.quotation);
  assert.equal(orderLine.contract_line_id, ids.contractLine);
  assert.equal(orderLine.quotation_line_id, ids.quotationLine);
  assert.equal(orderLine.untaxed_unit_price, 107610.6195);
  assert.equal(orderLine.quantity, 1);
});

await test('rejects a quote without its required customer, type and issuer', async () => {
  const result = await api.request('/data/forge_quotation', 'POST', {
    name: 'Incomplete quote', code: 'QT-REJECT-MISSING', quotation_date: '2026-09-09', valid_until: '2026-10-09', responsible_id: api.userId,
  });
  assert.equal(result.status, 400);
  const fields = new Set(result.value.fields.map(field => field.field));
  for (const field of ['customer_id', 'quotation_type_id', 'issuer_id']) assert.ok(fields.has(field), field);
});

await test('rejects an order line with a missing order reference', async () => {
  const result = await api.request('/data/forge_sales_order_line', 'POST', {
    name: 'Missing order', order_id: 'missing_order', sku_id: foundation.fg_sku, quantity: 1,
  });
  assert.equal(result.status, 400);
  assert.ok(result.value.fields.some(field => field.field === 'order_id' && field.code === 'reference_not_found'));
});

await test('rejects zero and negative line quantities', async () => {
  for (const quantity of [0, -1]) {
    const result = await api.request('/data/forge_sales_order_line', 'POST', {
      name: 'Invalid quantity', order_id: ids.order, sku_id: foundation.fg_sku, quantity,
    });
    assert.equal(result.status, 400, `quantity ${quantity}`);
    assert.ok(result.value.fields.some(field => field.field === 'quantity' && field.code === 'min_value'));
  }
});

await test('drops a forged order status and preserves runtime-owned draft state', async () => {
  const result = await api.request(`/data/forge_sales_order/${ids.order}`, 'PATCH', { status: 'completed' });
  assert.equal(result.status, 200);
  const after = await api.request(`/data/forge_sales_order/${ids.order}`);
  assert.equal(after.value.record.status, 'draft');
});

await test('anonymous sales document reads and writes are rejected', async () => {
  assert.equal((await api.request('/data/forge_quotation', 'GET', undefined, false)).status, 401);
  assert.equal((await api.request('/data/forge_sales_order', 'POST', { name: 'Unauthorized' }, false)).status, 401);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'local-sales-foundation-api-acceptance', fixture: 'OEM-RM-20260909-A-sales-v0.1',
  evidenceClasses: ['runtime_observed', 'published_guide', 'forge_verified'], ids, cases,
  passed: cases.every(testCase => testCase.status === 'passed'),
  limitations: [
    'No submit, approval, reject, send, accept, convert, credit-hold, shipment, invoicing, collection, revenue or ledger workflow is implemented.',
    'Header totals and progress fields are persisted snapshots; automatic rollup and concurrent contract-limit enforcement remain unimplemented.',
    'Dependent line objects are hidden from navigation but do not yet render as embedded editable grids in document detail pages.',
  ],
};
await writeFile('.objectstack/acceptance/sales-foundation-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
