import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const reportPath = '.objectstack/acceptance/bom-shortage-purchase-report.json';
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const api = await connect();
const find = async (object, where) => {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '100' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`);
  return response.value.records.filter(record => Object.entries(where).every(([key, value]) => record[key] === value));
};
const orders = await find('forge_purchase_order', { code: process.env.FORGE_UI_ORDER_CODE || 'PO-FORGE-UI-20260910-001' });
assert.equal(orders.length, 1, 'browser-created order must exist exactly once');
const order = orders[0];
assert.deepEqual({ status: order.status, lines: order.line_count, amount: order.total_amount, warehouse: order.warehouse_id },
  { status: 'approved', lines: 4, amount: 33260, warehouse: null });
const notices = await find('forge_purchase_arrival_notice', { order_id: order.id });
assert.equal(notices.length, 1);
assert.deepEqual({ status: notices[0].status, lines: notices[0].line_count, planned: notices[0].planned_quantity, arrived: notices[0].arrived_quantity },
  { status: 'pending_arrival', lines: 4, planned: 8, arrived: 0 });
assert.equal((await find('forge_purchase_arrival_notice_line', { notice_id: notices[0].id })).length, 4);
assert.equal((await find('forge_purchase_order_approval_log', { order_id: order.id })).length, 2);
report.ids.browserOrder = order.id;
report.ids.browserArrivalNotice = notices[0].id;
report.browserVerification = { verifiedAt: new Date().toISOString(), status: 'passed',
  action: 'created and approved in the built-in browser', orderCode: order.code, lineCount: 4, totalQuantity: order.total_quantity,
  taxedTotal: order.total_amount, noticeCount: 1, noticeLineCount: 4, targetWarehouse: null };
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log('PASS built-in browser order persisted with one four-line pending-arrival notice');
