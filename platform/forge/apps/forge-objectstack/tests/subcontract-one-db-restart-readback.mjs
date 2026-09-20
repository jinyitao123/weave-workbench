import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const report = JSON.parse(await readFile('.objectstack/acceptance/subcontract-inbound-report.json', 'utf8'));
const chainReport = JSON.parse(await readFile('.objectstack/acceptance/subcontract-one-db-chain-report.json', 'utf8'));
assert.equal(report.passed, true, '回厂入库阶段报告未通过');
assert.equal(chainReport.passed, true, '连续委外链报告未通过');
const api = await connect(process.env.FORGE_URL || 'http://localhost:4310');
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}`);
  return response.value.record;
}
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, object);
  return (response.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
}

const [receipt, inbound, consumption, stock, order, orderLine, plan, finishedBalances, stockLedgers, inventoryLedgers, ncr, reconciliation, payable] = await Promise.all([
  read('forge_subcontract_receipt', report.ids.receipt),
  read('forge_subcontract_inbound', report.ids.inbound),
  read('forge_subcontract_receipt_consumption', report.ids.consumption),
  read('forge_subcontract_stock_balance', report.ids.stockBalance),
  read('forge_subcontract_order', report.ids.customerSuppliedOrder),
  read('forge_subcontract_order_line', report.ids.customerLine),
  read('forge_subcontract_material_plan', report.ids.customerPlan),
  find('forge_inventory_balance', { balance_key: `${report.ids.receiptWarehouse}:${report.ids.finishedSku}` }),
  find('forge_subcontract_stock_ledger', { source_id: report.ids.inbound }),
  find('forge_inventory_ledger', { source_id: report.ids.inbound }),
  read('forge_subcontract_ncr', chainReport.ids.ncr),
  read('forge_subcontract_reconciliation', chainReport.ids.reconciliation),
  read('forge_accounts_payable', chainReport.ids.payable),
]);

const finished = finishedBalances[0];
const inventoryLedger = inventoryLedgers[0];
const finishedBeforeOnHand = Number(report.result.confirmed.finishedBeforeOnHand || 0);
const finishedBeforeValue = Number(report.result.confirmed.finishedBeforeValue || 0);
assert.deepEqual({
  receipt: receipt.status,
  inbound: [inbound.status, inbound.material_amount, inbound.inventory_amount, inbound.valuation_status],
  consumption: [consumption.status, consumption.unit_cost, consumption.amount],
  stock: [stock.on_hand_quantity, stock.backflushed_quantity, stock.inventory_value],
  order: [order.status, order.received_quantity, order.backflushed_quantity, order.overconsumption_quantity],
  orderLine: [orderLine.received_good_quantity, orderLine.received_bad_quantity],
  plan: [plan.backflushed_quantity, plan.overconsumption_quantity],
  finishedDelta: [finishedBalances.length, Number(finished?.on_hand_quantity || 0) - finishedBeforeOnHand, Number(finished?.inventory_value || 0) - finishedBeforeValue],
  inventoryLedger: [inventoryLedgers.length, inventoryLedger?.movement_type, inventoryLedger?.quantity, inventoryLedger?.unit_cost, inventoryLedger?.amount],
  ledgers: [stockLedgers.length, inventoryLedgers.length],
  ncr: ncr.status,
  reconciliation: reconciliation.status,
  payable: [payable.reconciliation_id, payable.original_amount],
}, {
  receipt: 'stocked',
  inbound: ['stocked', 75, 146, 'fully_costed'],
  consumption: ['backflushed', 12.5, 75],
  stock: [0, 6, 0],
  order: ['in_progress', 2, 6, 0.18],
  orderLine: [2, 0],
  plan: [6, 0.18],
  finishedDelta: [1, report.result.confirmed.finishedQuantity, report.result.confirmed.finishedAmount],
  inventoryLedger: [1, 'subcontract_receipt_inbound', report.result.confirmed.finishedQuantity, report.result.confirmed.finishedUnitCost, report.result.confirmed.finishedAmount],
  ledgers: [1, 1],
  ncr: 'executed',
  reconciliation: 'payable_generated',
  payable: [chainReport.ids.reconciliation, 71],
});
console.log(JSON.stringify({
  suite: 'subcontract-one-db-restart-readback',
  status: 'passed',
  database: process.env.FORGE_DB || chainReport.database,
  source_ids: { order: chainReport.ids.order, issue: chainReport.ids.issue, receipt: chainReport.ids.receipt, inbound: chainReport.ids.inbound, ncr: chainReport.ids.ncr, reconciliation: chainReport.ids.reconciliation, payable: chainReport.ids.payable },
  assertion: '同一 SQLite 停服重启后按原单据 ID 回读委外链结果、库存、倒冲、流水、质量处置、对账和应付',
}, null, 2));
