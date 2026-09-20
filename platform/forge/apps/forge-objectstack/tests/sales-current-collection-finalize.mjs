import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const database = process.env.FORGE_DB || '.objectstack/data/objectstack.db';
const api = await connect(endpoint);
async function find(object, where = {}) { const q = new URLSearchParams({ $filter: JSON.stringify(where), $top: '500' }); const r = await api.request(`/data/${object}?${q}`); assert.equal(r.status, 200, object + ': ' + JSON.stringify(r.value)); return (r.value.records || []).filter(x => Object.entries(where).every(([k, v]) => x[k] === v)); }
async function read(object, id) { const r = await api.request(`/data/${object}/${id}`); assert.equal(r.status, 200, object + '/' + id + ': ' + JSON.stringify(r.value)); return r.value.record; }
const order = (await find('forge_sales_order', { code: 'SO-CONVERT-20260909-001' }))[0]; assert.ok(order);
const invoices = (await find('forge_sales_invoice', { order_id: order.id })).filter(x => ['INV-CONVERT-20260909-001', 'SPLIT-INV-2'].includes(x.code)).sort((a,b)=>a.code.localeCompare(b.code));
const receivables = await find('forge_accounts_receivable', { order_id: order.id });
const account = (await find('forge_fund_account')).filter(x => String(x.code || '').startsWith('FA-SALES-CURRENT-')).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0]; assert.ok(account);
const receipts = (await find('forge_cash_receipt', { account_id: account.id })).filter(x => String(x.code || '').startsWith('CR-SALES-')).sort((a,b)=>String(a.code).localeCompare(String(b.code)));
const allocations = (await find('forge_collection_allocation')).filter(x => receipts.some(r => r.id === x.receipt_id)).sort((a,b)=>String(a.code).localeCompare(String(b.code)));
assert.equal(invoices.length, 2); assert.equal(receipts.length, 3); assert.equal(allocations.length, 3);
assert.deepEqual(invoices.map(x => x.status), ['settled', 'settled']);
assert.ok(receivables.length >= 2); assert.ok(receivables.filter(x => ['AR-INV-CONVERT-20260909-001'].includes(x.code) || invoices.some(inv => inv.id === x.invoice_id)).every(x => x.status === 'settled' && Number(x.outstanding_amount) === 0));
assert.equal(order.collected_amount, 243200);
const contract = await read('forge_sales_contract', order.contract_id); assert.equal(contract.collected_amount, 243200);
assert.equal(account.current_balance, 243200);
const byAmount = receipts.map(x => Number(x.amount)).sort((a,b)=>a-b); assert.deepEqual(byAmount, [60000, 61600, 121600]);
const report = { recordedAt: new Date().toISOString(), kind: 'forge-current-sales-collection-closure', fixture: 'OEM-RM-20260909-A-current-sales-main-chain-20260913', endpoint, database, ids: { operator: api.userId, order: order.id, contract: order.contract_id, firstInvoice: invoices.find(x=>x.code==='INV-CONVERT-20260909-001')?.id, secondInvoice: invoices.find(x=>x.code==='SPLIT-INV-2')?.id, firstReceivable: receivables.find(x=>x.invoice_id===invoices.find(inv=>inv.code==='INV-CONVERT-20260909-001')?.id)?.id, secondReceivable: receivables.find(x=>x.invoice_id===invoices.find(inv=>inv.code==='SPLIT-INV-2')?.id)?.id, account: account.id, receipt1: receipts.find(x=>Number(x.amount)===60000)?.id, receipt2: receipts.find(x=>Number(x.amount)===61600)?.id, receipt3: receipts.find(x=>Number(x.amount)===121600)?.id, allocation1: allocations.find(x=>Number(x.amount)===60000)?.id, allocation2: allocations.find(x=>Number(x.amount)===61600)?.id, allocation3: allocations.find(x=>Number(x.amount)===121600)?.id }, cases: [{ name: 'sales receipts allocated and approved against two receivables', status: 'passed' }, { name: 'invoice, receivable, order, contract and account collection totals match', status: 'passed' }], passed: true, result: { receipts: [60000, 61600, 121600], collectedAmount: 243200, receivables: 'settled', invoices: 'settled', orderCollection: 243200, contractCollection: 243200, accountBalance: 243200 }, boundary: 'Forge current SQLite proves sales-order receivable registration, cash receipt, allocation review, invoice settlement, order and contract collection rollup without relying on project settlement fixtures. RISEMAP same-material successful collection remains page-observed but not destructively advanced.' };
await mkdir('.objectstack/acceptance', { recursive: true }); await writeFile('.objectstack/acceptance/sales-current-collection-report.json', JSON.stringify(report, null, 2));
console.log('PASS finalized current sales collection report');
