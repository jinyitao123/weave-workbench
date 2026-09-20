import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const api = await connect(process.env.FORGE_URL || 'http://localhost:4441');
const resultOf = response => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
const create = async (object, data) => {
  const response = await api.request(`/data/${object}`, 'POST', data);
  assert.equal(response.status, 201, JSON.stringify(response.value));
  return response.value.record ?? response.value;
};
const read = async (object, id) => {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return response.value.record;
};
const invoke = (object, action, id, params = {}, authenticated = true) =>
  api.request(`/actions/${object}/${action}/${id}`, 'POST', { params }, authenticated);
const invokeOk = async (object, action, id, params = {}) => {
  const response = await invoke(object, action, id, params);
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return resultOf(response);
};

const stamp = Date.now();
const category = await create('forge_customer_category', { name: '开票任务验收客户', code: `CUST-INV-${stamp}`, status: 'active' });
const customer = await create('forge_customer', {
  name: '苏州开票任务验收有限公司', customer_type: 'company', category_id: category.id,
  invoice_type: '增值税专用发票', tax_number: `91320594${stamp}`, payment_days: 30,
  responsible_id: api.userId,
});
const unit = await create('forge_unit', { name: '台', code: `UNIT-INV-${stamp}`, status: 'active' });
const materialCategory = await create('forge_material_category', { name: '开票验收设备', code: `MAT-CAT-INV-${stamp}`, status: 'active' });
const material = await create('forge_material', {
  name: '开票验收控制柜', code: `MAT-INV-${stamp}`, model: 'INV-CAB-01', category_id: materialCategory.id,
  unit_id: unit.id, property: 'finished', source_type: 'manufactured', status: 'active', responsible_id: api.userId,
});
const sku = await create('forge_material_sku', {
  name: '标准配置', code: `SKU-INV-${stamp}`, material_id: material.id, sale_price: 12000, cost_price: 8000, enabled: true,
});
const warehouseType = await create('forge_warehouse_type', { name: '开票验收仓库', code: `WH-TYPE-INV-${stamp}`, status: 'active' });
const warehouse = await create('forge_warehouse', {
  name: '开票任务验收仓', code: `WH-INV-${stamp}`, type_id: warehouseType.id, responsible_id: api.userId,
  phone: '0512-00000000', area: 100, address: '苏州市开票任务验收区',
});
const inboundType = await create('forge_other_inbound_type', { name: '开票任务验收备料', code: `OIN-TYPE-INV-${stamp}`, status: 'active' });
const inbound = await create('forge_other_inbound', {
  name: '开票任务验收备料', code: `OIN-INV-${stamp}`, inbound_type_id: inboundType.id, warehouse_id: warehouse.id,
  inbound_on: '2026-09-16', source_code: `INV-TASK-${stamp}`, handler_id: api.userId,
});
await create('forge_other_inbound_line', {
  name: material.name, inbound_id: inbound.id, sku_id: sku.id, item_code: material.code, model: material.model,
  specification: sku.name, unit_name: unit.name, quantity: 5, taxed_unit_price: 8000, taxed_amount: 40000,
});
await invokeOk('forge_other_inbound', 'other_inbound_submit', inbound.id);
await invokeOk('forge_other_inbound', 'other_inbound_approve', inbound.id, { approval_note: '开票任务页面验收备料已核对' });
await invokeOk('forge_other_inbound', 'other_inbound_stock', inbound.id);

async function makeRequest(suffix, amount) {
  const order = await create('forge_sales_order', {
    name: `开票任务验收订单 ${suffix}`, code: `SO-INV-${suffix}-${stamp}`, source_type: 'direct', customer_id: customer.id,
    planned_delivery_on: '2026-09-30', responsible_id: api.userId, payment_term: '开票后30天', payment_method: 'bank_transfer',
    revenue_trigger: 'shipment', total_amount: amount, shipped_amount: amount, invoiced_amount: 0, status: 'shipped',
  });
  await create('forge_sales_order_line', {
    name: '开票验收控制柜', order_id: order.id, sku_id: sku.id, item_code: material.code, model: material.model,
    specification: '标准配置', unit_name: '台', quantity: 1, shipped_quantity: 1, invoiced_quantity: 0,
    taxed_unit_price: amount, untaxed_unit_price: Number((amount / 1.13).toFixed(4)), tax_rate: 13,
    discount_rate: 0, taxed_subtotal: amount, planned_delivery_on: '2026-09-30',
  });
  await invokeOk('forge_sales_order', 'sales_order_submit', order.id);
  await invokeOk('forge_sales_order', 'sales_order_approve', order.id);
  const shipment = await invokeOk('forge_sales_order', 'sales_order_create_shipment', order.id, {
    code: `SHP-INV-${suffix}-${stamp}`, shipment_on: '2026-09-16', recipient: '页面验收收货人',
    recipient_phone: '13800000000', delivery_address: '苏州市开票任务验收区', quantity: 1,
  });
  await invokeOk('forge_sales_shipment', 'sales_shipment_create_outbound', shipment.id, {
    code: `OUT-INV-${suffix}-${stamp}`, warehouse_id: warehouse.id, outbound_on: '2026-09-16', quantity: 1, customer_pickup: false,
  });
  const request = await invokeOk('forge_sales_order', 'sales_order_request_invoice', order.id, {
    code: `IR-${suffix}-${stamp}`, requested_quantity: 1, requested_on: '2026-09-16',
    expected_invoice_on: '2026-09-18', due_on: '2026-10-18', remarks: `开票任务页面验收 ${suffix}`,
  });
  return { orderId: order.id, requestId: request.id, amount };
}

const pendingApprove = await makeRequest('PENDING-APPROVE', 12000);
const pendingReject = await makeRequest('PENDING-REJECT', 18000);
const approvedForBrowser = await makeRequest('APPROVED-BROWSER', 26000);
const rejected = await makeRequest('REJECTED', 8000);
const issued = await makeRequest('ISSUED', 36000);

assert.equal((await invoke('forge_sales_invoice_request', 'sales_invoice_request_approve', pendingApprove.requestId, {}, false)).status, 401);
const blankApproval = await invoke('forge_sales_invoice_request', 'sales_invoice_request_approve', pendingApprove.requestId, { review_comment: ' ' });
assert.equal(blankApproval.status, 400, JSON.stringify(blankApproval.value));
assert.match(blankApproval.value.error.message, /审批意见不能为空|review_comment/);

await invokeOk('forge_sales_invoice_request', 'sales_invoice_request_approve', approvedForBrowser.requestId, { review_comment: '金额与交付材料已核对，留待页面登记开票' });
const blankInvoice = await invoke('forge_sales_invoice_request', 'sales_invoice_request_issue', approvedForBrowser.requestId, { invoice_code: ' ' });
assert.equal(blankInvoice.status, 400, JSON.stringify(blankInvoice.value));
assert.match(blankInvoice.value.error.message, /发票编号不能为空|invoice_code/);

await invokeOk('forge_sales_invoice_request', 'sales_invoice_request_reject', rejected.requestId, { review_comment: '客户开票资料不完整' });
const wrongState = await invoke('forge_sales_invoice_request', 'sales_invoice_request_approve', rejected.requestId, { review_comment: '不应重复审批' });
assert.equal(wrongState.status, 400, JSON.stringify(wrongState.value));

await invokeOk('forge_sales_invoice_request', 'sales_invoice_request_approve', issued.requestId, { review_comment: '交付与开票金额一致' });
const issuedResult = await invokeOk('forge_sales_invoice_request', 'sales_invoice_request_issue', issued.requestId, { invoice_code: `INV-ISSUED-${stamp}` });
const [issuedRequest, invoice, receivable] = await Promise.all([
  read('forge_sales_invoice_request', issued.requestId),
  read('forge_sales_invoice', issuedResult.id),
  read('forge_accounts_receivable', issuedResult.receivable_id),
]);
assert.deepEqual(
  { request: issuedRequest.status, invoice: invoice.status, receivable: receivable.status, invoiceId: issuedRequest.invoice_id },
  { request: 'issued', invoice: 'issued', receivable: 'unpaid', invoiceId: invoice.id },
);

const fixtures = {
  suite: 'invoice-task-workspace', status: 'passed', createdAt: new Date().toISOString(),
  customerId: customer.id,
  records: { pendingApprove, pendingReject, approvedForBrowser, rejected, issued: { ...issued, invoiceId: invoice.id, receivableId: receivable.id } },
  expectedInitialPage: { pendingReview: 2, approved: 1, rejected: 1, issued: 1, approvedAmount: approvedForBrowser.amount, all: 5 },
};
await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/invoice-task-workspace.json', `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(JSON.stringify(fixtures, null, 2));
