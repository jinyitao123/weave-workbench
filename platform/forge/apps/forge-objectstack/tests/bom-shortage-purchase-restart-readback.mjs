import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const reportPath = '.objectstack/acceptance/bom-shortage-purchase-report.json';
const report = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(report.passed, true, 'purchase acceptance must pass before restart readback');
const api = await connect();
const read = async (object, id) => {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}: ${JSON.stringify(response.value)}`);
  return response.value.record;
};
const find = async (object, where) => {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '100' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`);
  return response.value.records.filter(record => Object.entries(where).every(([key, value]) => record[key] === value));
};

const supplier = await read('forge_supplier', report.ids.supplier);
const order = await read('forge_purchase_order', report.ids.order);
const notice = await read('forge_purchase_arrival_notice', report.ids.arrivalNotice);
assert.deepEqual({ supplier: supplier.approval_status, order: order.status, source: order.source_type, quantity: order.total_quantity,
  amount: order.total_amount, notice: notice.status, noticeLines: notice.line_count, planned: notice.planned_quantity, arrived: notice.arrived_quantity },
{ supplier: 'approved', order: 'approved', source: 'bom_shortage', quantity: 5,
  amount: 16320, notice: 'pending_arrival', noticeLines: 4, planned: 5, arrived: 0 });
assert.equal((await find('forge_purchase_order_line', { order_id: order.id })).length, 4);
assert.equal((await find('forge_purchase_arrival_notice', { order_id: order.id })).length, 1);
assert.equal((await find('forge_purchase_arrival_notice_line', { notice_id: notice.id })).length, 4);
assert.equal((await find('forge_purchase_order_approval_log', { order_id: order.id })).length, 2);
assert.equal((await find('forge_supplier_approval_log', { supplier_id: supplier.id })).length, 2);
if (report.ids.browserOrder) {
  const browserOrder = await read('forge_purchase_order', report.ids.browserOrder);
  const browserNotice = await read('forge_purchase_arrival_notice', report.ids.browserArrivalNotice);
  assert.deepEqual({ status: browserOrder.status, lines: browserOrder.line_count, quantity: browserOrder.total_quantity, amount: browserOrder.total_amount,
    notice: browserNotice.status, noticeLines: browserNotice.line_count, planned: browserNotice.planned_quantity },
  { status: 'approved', lines: 4, quantity: 8, amount: 33260, notice: 'pending_arrival', noticeLines: 4, planned: 8 });
}
report.restartVerification = { verifiedAt: new Date().toISOString(), status: 'passed', database: process.env.FORGE_DB || report.database,
  assertion: report.ids.browserOrder
    ? 'API and browser approved orders, their logs, and one four-line notice per order survived a full stop/start'
    : 'approved supplier, four-line order, two approval logs, one notice header and four notice lines survived a full stop/start' };
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log('PASS BOM shortage purchase and order-level arrival notice survived full server restart');
