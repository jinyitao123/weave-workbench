import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4441';
const api = await connect(endpoint);
const find = async (object, where) => {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '20' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return response.value.records || [];
};
const invoke = (id, params, authenticated = true) => api.request(
  `/actions/forge_accounts_receivable/receivable_register_collection/${id}`,
  'POST',
  { params },
  authenticated,
);

const [receivable] = await find('forge_accounts_receivable', { code: 'AR-INV-BROWSER-20260916-001' });
const [reversed] = await find('forge_accounts_receivable', { code: 'AR-INV-ISSUED-1789545797758' });
const [receipt] = await find('forge_cash_receipt', { code: 'RCV-PAGE-20260916-001' });
const [account] = await find('forge_fund_account', { code: 'FA-AR-PAGE-20260916' });
const [order] = await find('forge_sales_order', { id: receivable?.order_id });
assert.ok(receivable && reversed && receipt && account && order, '缺少应收应付页面验收材料');

assert.equal(receipt.customer_id, receivable.customer_id);
assert.equal(receipt.account_id, account.id);
assert.equal(receipt.amount, 26000);
assert.equal(receipt.allocated_amount + receipt.unallocated_amount, 26000);
assert.ok(['unallocated', 'allocated'].includes(receipt.status));
if (receipt.status === 'unallocated') {
  assert.deepEqual([receipt.allocated_amount, receipt.unallocated_amount, receivable.status, receivable.outstanding_amount], [0, 26000, 'unpaid', 26000]);
} else {
  assert.deepEqual([receipt.allocated_amount, receipt.unallocated_amount, receivable.status, receivable.outstanding_amount], [26000, 0, 'settled', 0]);
}
assert.deepEqual(
  [account.current_balance, order.id, order.code, reversed.status, reversed.outstanding_amount],
  [126000, receivable.order_id, 'SO-INV-APPROVED-BROWSER-1789545797758', 'red_reversed', 0],
);

const params = {
  code: 'RCV-INVALID-20260916',
  account_id: account.id,
  received_on: '2026-09-16',
  payment_method: 'bank_transfer',
  amount: 26001,
  counterpart_reference: '',
  remarks: '超额登记不应成功',
};
assert.equal((await invoke(receivable.id, params, false)).status, 401);
assert.equal((await invoke(receivable.id, params)).status, 400);

console.log(JSON.stringify({
  suite: 'receivables-payables-readback',
  status: 'passed',
  endpoint,
  ids: { receivable: receivable.id, receipt: receipt.id, account: account.id, order: order.id },
  accountBalance: account.current_balance,
  receiptStatus: receipt.status,
  unallocatedAmount: receipt.unallocated_amount,
}, null, 2));
