import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const api = await connect();
const cases = [];
const ids = {};
const round4 = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
const find = async (object, where) => {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '20' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object} query`);
  return response.value.records.filter(record => Object.entries(where).every(([field, value]) => record[field] === value));
};
const findOne = async (object, where) => {
  const records = await find(object, where); assert.equal(records.length, 1, `${object} exact result`); return records[0];
};
const read = async (object, id) => {
  const response = await api.request(`/data/${object}/${id}`); assert.equal(response.status, 200); return response.value.record;
};
const invoke = async (object, action, id, params = {}) => {
  const response = await api.request(`/actions/${object}/${action}/${id}`, 'POST', { params });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
};
const test = async (name, run) => {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
};

const order = await findOne('forge_sales_order', { code: 'SO-CONVERT-20260909-001' });
const contract = await read('forge_sales_contract', order.contract_id);
const receivables = (await find('forge_accounts_receivable', { order_id: order.id })).sort((a, b) => a.code.localeCompare(b.code));
assert.equal(receivables.length, 2, 'two unpaid receivables are required');
assert.deepEqual(receivables.map(item => [item.status, item.outstanding_amount]), [['unpaid', 121600], ['unpaid', 121600]]);
ids.order = order.id; ids.contract = contract.id; ids.firstReceivable = receivables[0].id; ids.secondReceivable = receivables[1].id;

await test('registers physical receipts in an active fund account without writing off receivables', async () => {
  const account = await api.request('/data/forge_fund_account', 'POST', {
    name: '销售回款验收账户', code: 'FA-SALES-20260909', account_type: 'bank', bank_name: '中国银行',
    account_number: '6222000000000000', currency: 'cny', opening_balance: 0, opening_on: '2026-09-09',
    responsible_id: api.userId,
  });
  assert.equal(account.status, 201, JSON.stringify(account.value)); ids.account = account.value.id || account.value.record?.id;
  const first = await invoke('forge_accounts_receivable', 'receivable_register_collection', ids.firstReceivable, {
    code: 'CR-SALES-20260909-001', account_id: ids.account, received_on: '2026-09-09', payment_method: 'bank_transfer',
    amount: 121600, counterpart_reference: 'BANK-DEMO-001',
  });
  ids.firstReceipt = first.id;
  assert.deepEqual(await receiptState(ids.firstReceipt), { amount: 121600, allocated: 0, unallocated: 121600, status: 'unallocated' });
  assert.equal((await read('forge_accounts_receivable', ids.firstReceivable)).outstanding_amount, 121600);
  assert.equal((await read('forge_fund_account', ids.account)).current_balance, 121600);
});

async function receiptState(id) {
  const receipt = await read('forge_cash_receipt', id);
  return { amount: receipt.amount, allocated: receipt.allocated_amount, unallocated: receipt.unallocated_amount, status: receipt.status };
}

await test('supports unlinking a pending allocation before write-off', async () => {
  const pending = await invoke('forge_cash_receipt', 'cash_receipt_allocate', ids.firstReceipt, {
    code: 'CA-SALES-20260909-CANCEL', receivable_id: ids.firstReceivable, allocated_on: '2026-09-09', amount: 60000,
  });
  ids.cancelledAllocation = pending.id;
  assert.equal((await read('forge_accounts_receivable', ids.firstReceivable)).outstanding_amount, 121600, 'pending allocation must not write off AR');
  assert.deepEqual(await receiptState(ids.firstReceipt), { amount: 121600, allocated: 60000, unallocated: 61600, status: 'partially_allocated' });
  await invoke('forge_collection_allocation', 'collection_allocation_cancel', pending.id);
  assert.equal((await read('forge_collection_allocation', pending.id)).status, 'cancelled');
  assert.deepEqual(await receiptState(ids.firstReceipt), { amount: 121600, allocated: 0, unallocated: 121600, status: 'unallocated' });
});

await test('approves two exact allocations and settles invoices, receivables, order and contract', async () => {
  const firstAllocation = await invoke('forge_cash_receipt', 'cash_receipt_allocate', ids.firstReceipt, {
    code: 'CA-SALES-20260909-001', receivable_id: ids.firstReceivable, allocated_on: '2026-09-09', amount: 121600,
  });
  ids.firstAllocation = firstAllocation.id;
  await invoke('forge_collection_allocation', 'collection_allocation_approve', firstAllocation.id);

  const secondReceipt = await invoke('forge_accounts_receivable', 'receivable_register_collection', ids.secondReceivable, {
    code: 'CR-SALES-20260909-002', account_id: ids.account, received_on: '2026-09-09', payment_method: 'bank_transfer',
    amount: 121600, counterpart_reference: 'BANK-DEMO-002',
  });
  ids.secondReceipt = secondReceipt.id;
  const secondAllocation = await invoke('forge_cash_receipt', 'cash_receipt_allocate', secondReceipt.id, {
    code: 'CA-SALES-20260909-002', receivable_id: ids.secondReceivable, allocated_on: '2026-09-09', amount: 121600,
  });
  ids.secondAllocation = secondAllocation.id;
  await invoke('forge_collection_allocation', 'collection_allocation_approve', secondAllocation.id);

  for (const receivable of receivables) {
    const current = await read('forge_accounts_receivable', receivable.id);
    assert.deepEqual({ collected: current.collected_amount, outstanding: current.outstanding_amount, status: current.status },
      { collected: 121600, outstanding: 0, status: 'settled' });
    const invoice = await read('forge_sales_invoice', current.invoice_id);
    assert.deepEqual({ collected: invoice.collected_amount, outstanding: invoice.outstanding_amount, status: invoice.status },
      { collected: 121600, outstanding: 0, status: 'settled' });
  }
  assert.equal((await read('forge_sales_order', order.id)).collected_amount, 243200);
  assert.equal((await read('forge_sales_contract', contract.id)).collected_amount, 243200);
  assert.equal((await read('forge_fund_account', ids.account)).current_balance, 243200);
  assert.equal(round4((await find('forge_collection_allocation', { status: 'approved' })).reduce((sum, item) => sum + Number(item.amount || 0), 0)), 243200);
});

await test('rejects collection beyond the remaining receivable balance', async () => {
  const response = await api.request(`/actions/forge_accounts_receivable/receivable_register_collection/${ids.firstReceivable}`, 'POST', {
    params: { code: 'CR-SALES-20260909-OVER', account_id: ids.account, received_on: '2026-09-09', payment_method: 'bank_transfer', amount: 1 },
  });
  assert.equal(response.status, 400); assert.match(response.value.error.message, /仅未收款或部分收款/);
  assert.equal((await find('forge_cash_receipt', { code: 'CR-SALES-20260909-OVER' })).length, 0);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'local-sales-collection-writeoff-api-acceptance', ids, cases,
  passed: cases.every(item => item.status === 'passed'),
  runtime: { url: process.env.FORGE_URL, database: process.env.FORGE_DB },
  observedBoundary: 'Physical receipt increases the fund-account balance; pending allocation leaves AR unchanged; approval writes off invoice and receivable and rolls collection totals to the order and contract.',
  limitations: [
    'RISEMAP same-input successful receipt allocation and approval remain unverified; current rules follow the saved page contract only.',
    'Writes remain sequential because ObjectStack 17.3.0 action transactions time out during audit persistence.',
    'Concurrent allocation, reversal after approval, overpayment/prepayment, fees, exchange rates and bank reconciliation remain outside this slice.',
  ],
};
await writeFile('.objectstack/acceptance/sales-collection-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
