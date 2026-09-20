import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const database = process.env.FORGE_DB || '.objectstack/data/objectstack.db';
const api = await connect(endpoint);
const split = JSON.parse(await readFile('.objectstack/acceptance/sales-split-fulfilment-report.json', 'utf8'));
assert.equal(split.passed, true, 'sales split fulfilment must pass before collection verification');
const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
const cases = [];
const ids = { ...split.ids, operator: api.userId, run: stamp };
const resultOf = response => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}: ${JSON.stringify(response.value)}`);
  return response.value.record;
}
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, object + ': ' + JSON.stringify(response.value));
  return (response.value.records || []).filter(record => Object.entries(where).every(([key, value]) => record[key] === value));
}
async function invoke(object, action, id, params = {}, authenticated = true) {
  return api.request(`/actions/${object}/${action}/${id}`, 'POST', { params }, authenticated);
}
async function create(object, data) {
  const response = await api.request(`/data/${object}`, 'POST', data);
  assert.ok(response.status >= 200 && response.status < 300, `${object}: ${JSON.stringify(response.value)}`);
  return response.value.id || response.value.record?.id;
}

let collectionAlreadySettled = false;

await test('current order has two issued invoices and two receivables before collection readback', async () => {
  const order = await read('forge_sales_order', ids.order);
  const invoices = await find('forge_sales_invoice', { order_id: ids.order });
  const receivables = await find('forge_accounts_receivable', { order_id: ids.order });
  ids.contract = order.contract_id;
  assert.ok(ids.contract, 'order contract id');
  assert.deepEqual({ orderStatus: order.status, invoiced: order.invoiced_amount, invoiceCount: invoices.length, receivableCount: receivables.length },
    { orderStatus: 'shipped', invoiced: 243200, invoiceCount: 2, receivableCount: 2 });
  const firstReceivable = await read('forge_accounts_receivable', ids.firstReceivable);
  const secondReceivable = await read('forge_accounts_receivable', ids.secondReceivable);
  assert.deepEqual([firstReceivable.original_amount, secondReceivable.original_amount], [121600, 121600]);
  const states = [firstReceivable.status, secondReceivable.status];
  collectionAlreadySettled = states.every(status => status === 'settled');
  if (collectionAlreadySettled) {
    assert.deepEqual([firstReceivable.outstanding_amount, secondReceivable.outstanding_amount], [0, 0]);
    assert.deepEqual([firstReceivable.collected_amount, secondReceivable.collected_amount], [121600, 121600]);
  } else {
    assert.deepEqual([
      { outstanding: firstReceivable.outstanding_amount, status: firstReceivable.status },
      { outstanding: secondReceivable.outstanding_amount, status: secondReceivable.status },
    ], [
      { outstanding: 121600, status: 'unpaid' },
      { outstanding: 121600, status: 'unpaid' },
    ]);
  }
});

if (collectionAlreadySettled) {
  await test('reads back existing approved receipts and allocation totals for the settled current order', async () => {
    const allocations = await find('forge_collection_allocation', { order_id: ids.order });
    const approved = allocations.filter(item => item.status === 'approved');
    assert.equal(approved.length, 3);
    assert.deepEqual(approved.map(item => Number(item.amount)).sort((a, b) => a - b), [60000, 61600, 121600]);
    ids.allocation1 = approved.find(item => Number(item.amount) === 60000).id;
    ids.allocation2 = approved.find(item => Number(item.amount) === 61600).id;
    ids.allocation3 = approved.find(item => Number(item.amount) === 121600).id;
    ids.receipt1 = approved.find(item => Number(item.amount) === 60000).receipt_id;
    ids.receipt2 = approved.find(item => Number(item.amount) === 61600).receipt_id;
    ids.receipt3 = approved.find(item => Number(item.amount) === 121600).receipt_id;
    const receipts = await Promise.all([read('forge_cash_receipt', ids.receipt1), read('forge_cash_receipt', ids.receipt2), read('forge_cash_receipt', ids.receipt3)]);
    assert.deepEqual(receipts.map(item => item.status), ['allocated', 'allocated', 'allocated']);
    assert.deepEqual(receipts.map(item => Number(item.amount)).sort((a, b) => a - b), [60000, 61600, 121600]);
    ids.account = receipts[0].account_id;
    const account = await read('forge_fund_account', ids.account);
    const order = await read('forge_sales_order', ids.order);
    const contract = await read('forge_sales_contract', ids.contract);
    assert.deepEqual({ orderCollected: order.collected_amount, contractCollected: contract.collected_amount, accountBalance: account.current_balance }, { orderCollected: 243200, contractCollected: 243200, accountBalance: 243200 });
  });

  await test('blocks duplicate collection against the already settled current receivable without changing totals', async () => {
    const blocked = await invoke('forge_accounts_receivable', 'receivable_register_collection', ids.secondReceivable,
      { code: `CR-SALES-OVER-${stamp}`, account_id: ids.account, received_on: '2026-09-13', payment_method: 'bank_transfer', amount: 1 });
    assert.equal(blocked.status, 400);
    assert.match(JSON.stringify(blocked.value), /仅未收款或部分收款应收|不得超过当前应收余额/);
    assert.equal((await read('forge_fund_account', ids.account)).current_balance, 243200);
  });
} else {
  await test('opens a sales collection account and rejects anonymous collection registration', async () => {
    ids.account = await create('forge_fund_account', {
      name: '销售主链当前库回款账户', code: `FA-SALES-CURRENT-${stamp}`, account_type: 'bank', bank_name: '招商银行', branch_name: '苏州工业园区支行',
      account_number: `6222${stamp}`, bank_account_type: 'general', currency: 'cny', opening_balance: 0, current_balance: 0,
      opening_on: '2026-09-13', allow_print: true, visibility_scope: 'creator_admin', status: 'active', responsible_id: api.userId,
    });
    const blocked = await invoke('forge_accounts_receivable', 'receivable_register_collection', ids.firstReceivable,
      { code: `CR-SALES-ANON-${stamp}`, account_id: ids.account, received_on: '2026-09-13', payment_method: 'bank_transfer', amount: 1 }, false);
    assert.equal(blocked.status, 401);
  });

  await test('collects the first receivable in two receipts with pending allocation review', async () => {
    const first = await invoke('forge_accounts_receivable', 'receivable_register_collection', ids.firstReceivable,
      { code: `CR-SALES-1A-${stamp}`, account_id: ids.account, received_on: '2026-09-13', payment_method: 'bank_transfer', amount: 60000, counterpart_reference: `BANK-SALES-1A-${stamp}` });
    assert.equal(first.status, 200, JSON.stringify(first.value)); ids.receipt1 = resultOf(first).id;
    const alloc1 = await invoke('forge_cash_receipt', 'cash_receipt_allocate', ids.receipt1,
      { code: `CA-SALES-1A-${stamp}`, receivable_id: ids.firstReceivable, allocated_on: '2026-09-13', amount: 60000 });
    assert.equal(alloc1.status, 200, JSON.stringify(alloc1.value)); ids.allocation1 = resultOf(alloc1).id;
    assert.equal((await read('forge_cash_receipt', ids.receipt1)).status, 'pending_review');
    assert.equal((await invoke('forge_collection_allocation', 'collection_allocation_approve', ids.allocation1)).status, 200);
    let receivable = await read('forge_accounts_receivable', ids.firstReceivable);
    assert.deepEqual({ collected: receivable.collected_amount, outstanding: receivable.outstanding_amount, status: receivable.status },
      { collected: 60000, outstanding: 61600, status: 'partially_collected' });

    const second = await invoke('forge_accounts_receivable', 'receivable_register_collection', ids.firstReceivable,
      { code: `CR-SALES-1B-${stamp}`, account_id: ids.account, received_on: '2026-09-13', payment_method: 'bank_transfer', amount: 61600, counterpart_reference: `BANK-SALES-1B-${stamp}` });
    assert.equal(second.status, 200, JSON.stringify(second.value)); ids.receipt2 = resultOf(second).id;
    const alloc2 = await invoke('forge_cash_receipt', 'cash_receipt_allocate', ids.receipt2,
      { code: `CA-SALES-1B-${stamp}`, receivable_id: ids.firstReceivable, allocated_on: '2026-09-13', amount: 61600 });
    assert.equal(alloc2.status, 200, JSON.stringify(alloc2.value)); ids.allocation2 = resultOf(alloc2).id;
    assert.equal((await invoke('forge_collection_allocation', 'collection_allocation_approve', ids.allocation2)).status, 200);
    receivable = await read('forge_accounts_receivable', ids.firstReceivable);
    const invoice = await read('forge_sales_invoice', ids.firstInvoice);
    assert.deepEqual({ arStatus: receivable.status, arOutstanding: receivable.outstanding_amount, invoiceStatus: invoice.status, invoiceOutstanding: invoice.outstanding_amount },
      { arStatus: 'settled', arOutstanding: 0, invoiceStatus: 'settled', invoiceOutstanding: 0 });
  });

  await test('collects the second receivable and rolls collection totals to order and contract', async () => {
    const receipt = await invoke('forge_accounts_receivable', 'receivable_register_collection', ids.secondReceivable,
      { code: `CR-SALES-2-${stamp}`, account_id: ids.account, received_on: '2026-09-13', payment_method: 'bank_transfer', amount: 121600, counterpart_reference: `BANK-SALES-2-${stamp}` });
    assert.equal(receipt.status, 200, JSON.stringify(receipt.value)); ids.receipt3 = resultOf(receipt).id;
    const allocation = await invoke('forge_cash_receipt', 'cash_receipt_allocate', ids.receipt3,
      { code: `CA-SALES-2-${stamp}`, receivable_id: ids.secondReceivable, allocated_on: '2026-09-13', amount: 121600 });
    assert.equal(allocation.status, 200, JSON.stringify(allocation.value)); ids.allocation3 = resultOf(allocation).id;
    assert.equal((await invoke('forge_collection_allocation', 'collection_allocation_approve', ids.allocation3)).status, 200);

    const order = await read('forge_sales_order', ids.order);
    const contract = await read('forge_sales_contract', ids.contract);
    const firstInvoice = await read('forge_sales_invoice', ids.firstInvoice);
    const secondInvoice = await read('forge_sales_invoice', ids.secondInvoice);
    const firstReceivable = await read('forge_accounts_receivable', ids.firstReceivable);
    const secondReceivable = await read('forge_accounts_receivable', ids.secondReceivable);
    const account = await read('forge_fund_account', ids.account);
    assert.deepEqual({ orderCollected: order.collected_amount, contractCollected: contract.collected_amount, firstInvoice: firstInvoice.status, secondInvoice: secondInvoice.status, firstAr: firstReceivable.status, secondAr: secondReceivable.status, accountBalance: account.current_balance },
      { orderCollected: 243200, contractCollected: 243200, firstInvoice: 'settled', secondInvoice: 'settled', firstAr: 'settled', secondAr: 'settled', accountBalance: 243200 });
  });

  await test('blocks collection beyond a settled receivable without changing ledger totals', async () => {
    const blocked = await invoke('forge_accounts_receivable', 'receivable_register_collection', ids.secondReceivable,
      { code: `CR-SALES-OVER-${stamp}`, account_id: ids.account, received_on: '2026-09-13', payment_method: 'bank_transfer', amount: 1 });
    assert.equal(blocked.status, 400);
    assert.match(JSON.stringify(blocked.value), /仅未收款或部分收款应收|不得超过当前应收余额/);
    assert.equal((await read('forge_fund_account', ids.account)).current_balance, 243200);
  });
}

await mkdir('.objectstack/acceptance', { recursive: true });
const report = { recordedAt: new Date().toISOString(), kind: 'forge-current-sales-collection-closure', fixture: 'OEM-RM-20260909-A-current-sales-main-chain-20260913', endpoint, database, ids, cases, passed: cases.every(item => item.status === 'passed'), result: { receipts: [60000, 61600, 121600], collectedAmount: 243200, receivables: 'settled', invoices: 'settled', orderCollection: 243200, accountBalance: 243200 }, boundary: collectionAlreadySettled ? 'Forge current SQLite already contained the settled sales collection state; this run verified the persisted receipts, approved allocations, settled invoices and duplicate-collection blocking without creating duplicate cash.' : 'Forge current SQLite proves sales-order receivable registration, cash receipt, allocation review, invoice settlement, order and contract collection rollup without relying on project settlement fixtures. RISEMAP same-material successful collection remains page-observed but not destructively advanced.' };
await writeFile('.objectstack/acceptance/sales-current-collection-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
