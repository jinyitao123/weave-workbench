import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL;
assert.equal(endpoint, 'http://localhost:4441', 'This fixture is scoped to the isolated finance-core server');
const api = await connect(endpoint);
const reportPath = '.objectstack/acceptance/finance-input-page.json';
const resultOf = response => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
const read = async (object, id) => {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return response.value.record;
};
const find = async (object, where) => {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '50' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return response.value.records.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
};
const create = async (object, data) => {
  const response = await api.request(`/data/${object}`, 'POST', data);
  assert.equal(response.status, 201, JSON.stringify(response.value));
  return response.value.id || response.value.record?.id;
};
const invoke = async (object, action, id, params = {}) => {
  const response = await api.request(`/actions/${object}/${action}/${id}`, 'POST', { params });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return resultOf(response);
};

if (process.argv.includes('--setup')) {
  const procurement = JSON.parse(await readFile('.objectstack/acceptance/procurement-chain-report.json', 'utf8'));
  const refs = procurement.ids;
  const stamp = Date.now();
  const date = new Date().toISOString().slice(0, 10);
  const invoices = {};
  for (const [kind, taxRate] of [['certify', 13], ['exclude', 13], ['zero', 0]]) {
    const order = await create('forge_purchase_order', {
      name: `对照进项发票-${kind}`, code: `PO-INPUT-${stamp}-${kind}`, supplier_id: refs.supplier,
      source_type: 'inventory_replenishment', warehouse_id: refs.warehouse, expected_arrival_on: date,
      payment_term: '对照测试，不执行实际付款', payment_method: 'bank_transfer', currency: 'cny',
      exchange_rate: 1, payable_trigger: 'inbound', responsible_id: api.userId,
      remarks: '独立测试库进项页面操作材料，不是 RISEMAP 同材料验收。',
    });
    await create('forge_purchase_order_line', {
      name: '对照进项物料', order_id: order, sku_id: refs.sku, item_code: 'INPUT-PAGE-TEST',
      quantity: 1, taxed_unit_price: 113, untaxed_unit_price: Number((113 / (1 + taxRate / 100)).toFixed(4)),
      tax_rate: taxRate, taxed_subtotal: 113, expected_arrival_on: date,
    });
    await invoke('forge_purchase_order', 'purchase_order_submit', order);
    await invoke('forge_purchase_order', 'purchase_order_approve', order, { approval_note: '对照进项页面材料' });
    const [notice] = await find('forge_purchase_arrival_notice', { order_id: order });
    const [noticeLine] = await find('forge_purchase_arrival_notice_line', { notice_id: notice.id });
    await invoke('forge_purchase_arrival_notice', 'purchase_arrival_register', notice.id, {
      arrived_on: date, mode: 'submit',
      lines_json: JSON.stringify([{ notice_line_id: noticeLine.id, quantity: 1, warehouse_id: refs.warehouse }]),
      remarks: '对照进项页面材料，遵循当前免检自动入库规则。',
    });
    const [inbound] = await find('forge_purchase_inbound', { order_id: order });
    assert.equal(inbound?.status, 'stocked');
    const invoiceNumber = `TEST-INPUT-${stamp}-${kind}`;
    const invoice = await invoke('forge_purchase_inbound', 'purchase_inbound_register_invoice', inbound.id, {
      code: `REG-INPUT-${stamp}-${kind}`, invoice_number: invoiceNumber,
      invoice_on: date, due_on: date, remarks: `对照进项页面-${kind}`,
    });
    const saved = await read('forge_purchase_invoice', invoice.id);
    assert.equal(saved.status, 'normal');
    assert.equal(saved.deduction_status, 'pending');
    assert.equal(saved.invoice_number, invoiceNumber);
    invoices[kind] = { id: invoice.id, invoiceNumber, order, inbound: inbound.id, taxRate };
  }
  await mkdir('.objectstack/acceptance', { recursive: true });
  await writeFile(reportPath, JSON.stringify({ endpoint, invoices, preparedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ setup: 'passed', endpoint, invoices }, null, 2));
} else {
  const fixture = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(fixture.endpoint, endpoint);
  if (process.argv.includes('--exercise-api')) {
    const exclude = fixture.invoices.exclude.id;
    const missingReason = await api.request(`/actions/forge_purchase_invoice/purchase_invoice_mark_not_deductible/${exclude}`, 'POST', { params: {} });
    assert.equal(missingReason.status, 400);
    assert.match(missingReason.value.error?.message || '', /不抵扣原因不能为空|deduction_reason.*required/);
    assert.equal((await read('forge_purchase_invoice', exclude)).deduction_status, 'pending');
    await invoke('forge_purchase_invoice', 'purchase_invoice_certify_deduction', fixture.invoices.certify.id);
    await invoke('forge_purchase_invoice', 'purchase_invoice_mark_not_deductible', exclude, { deduction_reason: '进项页面对照不抵扣原因' });
    fixture.apiExercisedAt = new Date().toISOString();
    fixture.browserOperations = false;
    await writeFile(reportPath, JSON.stringify(fixture, null, 2));
  }
  const expected = { certify: 'certified', exclude: 'not_deductible', zero: 'pending' };
  for (const [kind, material] of Object.entries(fixture.invoices)) {
    const saved = await read('forge_purchase_invoice', material.id);
    assert.equal(saved.invoice_number, material.invoiceNumber);
    assert.equal(saved.deduction_status, expected[kind], `${kind}: action result persisted`);
    assert.equal(saved.tax_rate, material.taxRate);
    if (kind !== 'zero') {
      assert.ok(saved.deducted_at && saved.deduction_operator_id);
      assert.ok(saved.deduction_reason);
      const duplicate = await api.request(`/actions/forge_purchase_invoice/purchase_invoice_certify_deduction/${material.id}`, 'POST', { params: {} });
      assert.equal(duplicate.status, 400, 'Completed deduction must reject a repeated action');
    }
  }
  const zero = await api.request(`/actions/forge_purchase_invoice/purchase_invoice_certify_deduction/${fixture.invoices.zero.id}`, 'POST', { params: {} });
  assert.equal(zero.status, 400);
  assert.match(zero.value.error?.message || '', /零税率/);
  const anonymous = await api.request(`/actions/forge_purchase_invoice/purchase_invoice_certify_deduction/${fixture.invoices.zero.id}`, 'POST', { params: {} }, false);
  assert.equal(anonymous.status, 401);
  console.log(JSON.stringify({ suite: 'finance-input-page-readback', status: 'passed', endpoint, expected }, null, 2));
}
