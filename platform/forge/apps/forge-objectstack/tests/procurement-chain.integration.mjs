import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
import { seedReferenceData } from '../scripts/seed-reference-data.mjs';

const { ids: fixtureIds } = await seedReferenceData();
const api = await connect();
const cases = [];
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const ids = { supplier: fixtureIds.supplier, sku: fixtureIds.plc_sku, warehouse: fixtureIds.warehouse };
let submittedDuringSupplierPrerequisite = false;

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}

async function read(object, id) {
  const result = await api.request(`/data/${object}/${id}`);
  assert.equal(result.status, 200, `${object} read: ${JSON.stringify(result.value)}`);
  return result.value.record;
}

async function find(object, where) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '50' });
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

try {
  const previous = JSON.parse(await readFile('.objectstack/acceptance/procurement-chain-report.json', 'utf8'));
  if (previous.ids?.arrivalNoticeLine) await api.request(`/data/forge_purchase_arrival_notice_line/${previous.ids.arrivalNoticeLine}`, 'DELETE');
  if (previous.ids?.arrivalNotice) await api.request(`/data/forge_purchase_arrival_notice/${previous.ids.arrivalNotice}`, 'DELETE');
  if (previous.ids?.orderLine) await api.request(`/data/forge_purchase_order_line/${previous.ids.orderLine}`, 'DELETE');
  if (previous.ids?.order) await api.request(`/data/forge_purchase_order/${previous.ids.order}`, 'DELETE');
} catch {}

await test('creates a draft purchase order with one existing supplier and SKU fixture', async () => {
  const orderResult = await api.request('/data/forge_purchase_order', 'POST', {
    name: '锐联电气 PLC 补库采购订单', code: 'PO-RM-' + stamp + '-001', supplier_id: ids.supplier,
    source_type: 'inventory_replenishment', warehouse_id: ids.warehouse, expected_arrival_on: '2026-09-22',
    payment_term: '到货验收合格后30天付款', payment_method: 'bank_transfer', currency: 'cny', exchange_rate: 1,
    payable_trigger: 'inbound', responsible_id: api.userId, remarks: 'OEM-RM-20260909-A 采购最小链验收',
  });
  assert.equal(orderResult.status, 201, JSON.stringify(orderResult.value));
  ids.order = orderResult.value.id || orderResult.value.record?.id;
  const lineResult = await api.request('/data/forge_purchase_order_line', 'POST', {
    name: 'PLC CPU 1215C', order_id: ids.order, sku_id: ids.sku, item_code: 'RM-PLC-1215C',
    model: 'CPU 1215C DC/DC/DC', specification: '默认规格', unit_name: '件', quantity: 2,
    arrived_quantity: 0, inspected_quantity: 0, accepted_quantity: 0, inbound_quantity: 0,
    taxed_unit_price: 6800, untaxed_unit_price: 6017.6991, tax_rate: 13, taxed_subtotal: 13600,
    expected_arrival_on: '2026-09-22',
  });
  assert.equal(lineResult.status, 201, JSON.stringify(lineResult.value));
  ids.orderLine = lineResult.value.id || lineResult.value.record?.id;
  const line = await read('forge_purchase_order_line', ids.orderLine);
  assert.equal(line.sku_id, fixtureIds.plc_sku);
  assert.equal(line.order_id, ids.order);
});

await test('requires supplier approval when needed and accepts an already approved supplier', async () => {
  const supplier = await read('forge_supplier', ids.supplier);
  const response = await invoke('forge_purchase_order', 'purchase_order_submit', ids.order);
  if (supplier.status === 'approved' || supplier.approval_status === 'approved') {
    assert.equal(response.status, 200, JSON.stringify(response.value));
    assert.equal(actionResult(response).status, 'pending_approval');
    submittedDuringSupplierPrerequisite = true;
    return;
  }
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /已审批/);
  assert.equal((await invoke('forge_supplier', 'supplier_submit_approval', ids.supplier)).status, 200);
  const approved = await invoke('forge_supplier', 'supplier_review', ids.supplier, { decision: 'approve', comment: '采购基础链供应商审批' });
  assert.equal(approved.status, 200, JSON.stringify(approved.value));
});

await test('submits the order and rolls line quantity and amount into the header', async () => {
  if (!submittedDuringSupplierPrerequisite) {
    const response = await invoke('forge_purchase_order', 'purchase_order_submit', ids.order);
    assert.equal(response.status, 200, JSON.stringify(response.value));
    assert.equal(actionResult(response).status, 'pending_approval');
  }
  const order = await read('forge_purchase_order', ids.order);
  assert.deepEqual(
    { status: order.status, line_count: order.line_count, total_quantity: order.total_quantity, total_amount: order.total_amount },
    { status: 'pending_approval', line_count: 1, total_quantity: 2, total_amount: 13600 },
  );
});

await test('approves the order and creates one order-level pending-arrival notice with one line', async () => {
  const response = await invoke('forge_purchase_order', 'purchase_order_approve', ids.order, { approval_note: '采购基础链订单审核' });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  assert.equal(actionResult(response).status, 'approved');
  const notices = await find('forge_purchase_arrival_notice', { order_id: ids.order });
  assert.equal(notices.length, 1);
  ids.arrivalNotice = notices[0].id;
  assert.deepEqual(
    { order_id: notices[0].order_id, supplier_id: notices[0].supplier_id, warehouse_id: notices[0].warehouse_id,
      line_count: notices[0].line_count, planned_quantity: notices[0].planned_quantity, arrived_quantity: notices[0].arrived_quantity, status: notices[0].status },
    { order_id: ids.order, supplier_id: ids.supplier, warehouse_id: ids.warehouse,
      line_count: 1, planned_quantity: 2, arrived_quantity: 0, status: 'pending_arrival' },
  );
  const noticeLines = await find('forge_purchase_arrival_notice_line', { notice_id: ids.arrivalNotice });
  assert.equal(noticeLines.length, 1); ids.arrivalNoticeLine = noticeLines[0].id;
  assert.deepEqual({ order_line_id: noticeLines[0].order_line_id, sku_id: noticeLines[0].sku_id, planned_quantity: noticeLines[0].planned_quantity },
    { order_line_id: ids.orderLine, sku_id: ids.sku, planned_quantity: 2 });
  const order = await read('forge_purchase_order', ids.order);
  assert.equal(order.status, 'approved');
  const line = await read('forge_purchase_order_line', ids.orderLine);
  assert.deepEqual(
    { arrived_quantity: line.arrived_quantity, inspected_quantity: line.inspected_quantity, accepted_quantity: line.accepted_quantity, inbound_quantity: line.inbound_quantity },
    { arrived_quantity: 0, inspected_quantity: 0, accepted_quantity: 0, inbound_quantity: 0 },
  );
});

await test('rejects a second approval and does not duplicate the notice', async () => {
  const response = await invoke('forge_purchase_order', 'purchase_order_approve', ids.order, { approval_note: '重复审核' });
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /状态已变化/);
  assert.equal((await find('forge_purchase_arrival_notice', { order_id: ids.order })).length, 1);
  assert.equal((await find('forge_purchase_arrival_notice_line', { notice_id: ids.arrivalNotice })).length, 1);
});

await test('rejects submitting a purchase order without any material line', async () => {
  const result = await api.request('/data/forge_purchase_order', 'POST', {
    name: '无明细采购订单', code: 'PO-RM-' + stamp + '-EMPTY', supplier_id: ids.supplier, warehouse_id: ids.warehouse,
    expected_arrival_on: '2026-09-22', payment_term: '30天', responsible_id: api.userId,
  });
  assert.equal(result.status, 201, JSON.stringify(result.value));
  const emptyId = result.value.id || result.value.record?.id;
  try {
    const response = await invoke('forge_purchase_order', 'purchase_order_submit', emptyId);
    assert.equal(response.status, 400, JSON.stringify(response.value));
    assert.match(response.value.error.message, /至少需要一条物料明细/);
  } finally { await api.request(`/data/forge_purchase_order/${emptyId}`, 'DELETE'); }
});

await test('rejects anonymous procurement reads and writes', async () => {
  assert.equal((await api.request('/data/forge_purchase_order', 'GET', undefined, false)).status, 401);
  assert.equal((await api.request('/data/forge_purchase_order', 'POST', { name: 'Unauthorized' }, false)).status, 401);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'local-procurement-chain-api-acceptance',
  fixture: 'OEM-RM-20260909-A-procurement-v0.1', ids, cases,
  runtime: { url: process.env.FORGE_URL || 'http://localhost:4310', database: 'file:./.objectstack/procurement.sqlite', isolatedFromMainPort4310: true },
  passed: cases.every(testCase => testCase.status === 'passed'),
  observedBoundary: 'An approved purchase order produces one order-level pending-arrival notice with material lines. It does not claim physical receipt, quality inspection, accepted quantity, purchase inbound, stock movement, accounts payable or invoice progress.',
  limitations: [
    'The supplier must complete its independent approval before the purchase order can be submitted.',
    'Actual arrival registration, pending-inspection inventory, inspection orders, qualified/unqualified splits and purchase inbound remain outside this slice.',
    'Approval creates notices sequentially with idempotent line lookup because ObjectStack 17.3.0 transaction-wrapped audit writes have timed out in this app; concurrent approvals are not yet proven.',
    'Payment application, purchase invoicing, returns and accounts-payable generation are not implemented.',
  ],
};
await writeFile('.objectstack/acceptance/procurement-chain-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
