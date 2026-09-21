import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:3001';
const api = await connect(endpoint);
const rowsOf = value => value.records || value.data?.records || value.data || [];
const find = async object => {
  const response = await api.request(`/data/${object}?$top=2000`);
  assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`);
  return rowsOf(response.value);
};
const valid = row => !['cancelled', 'voided', 'reversed', 'red_reversed', 'rejected', 'draft'].includes(row.status);
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);

const [orders, contracts, receivables, payables, balances, accounts, assets] = await Promise.all([
  'forge_sales_order', 'forge_sales_contract', 'forge_accounts_receivable', 'forge_accounts_payable',
  'forge_inventory_balance', 'forge_fund_account', 'forge_fixed_asset',
].map(find));

const effectiveOrders = orders.filter(valid);
const effectiveContracts = contracts.filter(valid);
const activeReceivables = receivables.filter(row => valid(row) && Number(row.outstanding_amount || 0) > 0);
const activePayables = payables.filter(row => valid(row) && Number(row.outstanding_amount || 0) > 0);
const activeAccounts = accounts.filter(row => row.status === 'active');
const activeAssets = assets.filter(row => row.status !== 'scrapped');
const metrics = {
  salesOrderAmount: sum(effectiveOrders, 'total_amount'),
  salesContractAmount: sum(effectiveContracts, 'total_amount'),
  receivableBalance: sum(activeReceivables, 'outstanding_amount'),
  payableBalance: sum(activePayables, 'outstanding_amount'),
  inventoryBalance: sum(balances, 'inventory_value'),
  fundBalance: sum(activeAccounts, 'current_balance'),
  fixedAssetNetValue: sum(activeAssets, 'net_value'),
};
metrics.netFundOccupation = metrics.receivableBalance + metrics.inventoryBalance - metrics.payableBalance;
metrics.totalAssets = metrics.fundBalance + metrics.receivableBalance + metrics.inventoryBalance + metrics.fixedAssetNetValue;
metrics.totalLiabilities = metrics.payableBalance;
metrics.ownerEquity = metrics.totalAssets - metrics.totalLiabilities;

assert.ok(effectiveOrders.length > 0, '财务总览需要有效销售订单作为经营金额材料');
assert.ok(effectiveContracts.length > 0, '财务总览需要有效销售合同作为签约材料');
assert.ok(balances.length > 0 && metrics.inventoryBalance > 0, '财务总览需要非零库存余额');
assert.ok(activeAssets.length > 0 && metrics.fixedAssetNetValue > 0, '资产负债视图需要非零固定资产净值');
assert.equal(metrics.salesOrderAmount, 729600);
assert.equal(metrics.salesContractAmount, 729600);
assert.equal(metrics.inventoryBalance, 353500);
assert.equal(metrics.fixedAssetNetValue, 11810);
assert.equal(metrics.totalAssets, 365310);

console.log(JSON.stringify({
  suite: 'finance-overview-data', status: 'passed', endpoint,
  counts: { orders: effectiveOrders.length, contracts: effectiveContracts.length, receivables: activeReceivables.length, payables: activePayables.length, balances: balances.length, accounts: activeAccounts.length, assets: activeAssets.length },
  metrics,
  boundary: '这些数值来自 Forge 当前真实业务对象，仅证明 Forge 页面汇总与持久数据一致；RISEMAP 与 Forge 尚非同一组业务材料。',
}, null, 2));
