import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4441';
const api = await connect(endpoint);
const find = async (object, where) => {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '50' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return response.value.records || [];
};
const invoke = (object, action, id, params = {}, authenticated = true) => api.request(
  `/actions/${object}/${action}/${id}`,
  'POST',
  { params },
  authenticated,
);

const [receivable] = await find('forge_accounts_receivable', { code: 'AR-INV-BROWSER-20260916-001' });
const [invoice] = await find('forge_sales_invoice', { id: receivable?.invoice_id });
const [order] = await find('forge_sales_order', { id: receivable?.order_id });
const [receipt] = await find('forge_cash_receipt', { code: 'RCV-PAGE-20260916-001' });
const [account] = await find('forge_fund_account', { code: 'FA-AR-PAGE-20260916' });
assert.ok(receivable && invoice && order && receipt && account, '缺少收款流水页面验收材料');

const allocations = await find('forge_collection_allocation', { receipt_id: receipt.id });
const cancelled = allocations.find((row) => row.code === 'CA-PAGE-20260916-CANCEL');
const reversed = allocations.find((row) => row.code === 'CA-PAGE-20260916-001');
const approved = allocations.find((row) => row.code === 'CA-PAGE-20260916-FINAL');
assert.ok(cancelled && reversed && approved, '缺少取消、反核销或最终核销记录');
assert.deepEqual(
  {
    receipt: [receipt.status, receipt.amount, receipt.allocated_amount, receipt.unallocated_amount],
    allocationStatuses: [cancelled.status, reversed.status, approved.status],
    receivable: [receivable.status, receivable.collected_amount, receivable.outstanding_amount],
    invoice: [invoice.status, invoice.collected_amount, invoice.outstanding_amount],
    orderCollected: order.collected_amount,
    accountBalance: account.current_balance,
  },
  {
    receipt: ['allocated', 26000, 26000, 0],
    allocationStatuses: ['cancelled', 'reversed', 'approved'],
    receivable: ['settled', 26000, 0],
    invoice: ['settled', 26000, 0],
    orderCollected: 26000,
    accountBalance: 126000,
  },
);

const logs = await find('forge_collection_reversal_log', { receipt_id: receipt.id });
assert.ok(logs.some((row) => row.allocation_id === reversed.id && row.action === 'writeoff_reversed' && row.amount === 26000));
assert.equal((await invoke('forge_collection_allocation', 'collection_allocation_approve', approved.id, {}, false)).status, 401);
assert.equal((await invoke('forge_collection_allocation', 'collection_allocation_approve', approved.id)).status, 400);
assert.equal((await invoke('forge_cash_receipt', 'cash_receipt_reverse', receipt.id, { reversal_reason: '不得越过已审核核销撤销' })).status, 400);
assert.equal((await invoke('forge_cash_receipt', 'cash_receipt_allocate', receipt.id, {
  code: 'CA-PAGE-20260916-DUPLICATE',
  receivable_id: receivable.id,
  allocated_on: '2026-09-16',
  amount: 1,
  remarks: '已完成流水不得再次分配',
})).status, 400);

console.log(JSON.stringify({
  suite: 'sales-collection-flow-page-readback',
  status: 'passed',
  endpoint,
  ids: { receipt: receipt.id, allocation: approved.id, receivable: receivable.id, invoice: invoice.id, order: order.id, account: account.id },
  result: { receipt: receipt.status, receivable: receivable.status, invoice: invoice.status, orderCollected: order.collected_amount, accountBalance: account.current_balance },
}, null, 2));
