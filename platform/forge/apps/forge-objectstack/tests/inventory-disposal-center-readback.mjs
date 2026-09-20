import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const find = async object => {
  const result = await api.request(`/data/${object}?$top=500`);
  assert.equal(result.status, 200, `${object} should be readable`);
  return result.value.records;
};

const [ncrs, returns, operations, receipts, subcontractOrders, purchaseOrders, suppliers] = await Promise.all([
  find('forge_subcontract_ncr'),
  find('forge_purchase_return'),
  find('forge_inventory_operation'),
  find('forge_subcontract_receipt'),
  find('forge_subcontract_order'),
  find('forge_purchase_order'),
  find('forge_supplier'),
]);
const receiptIds = new Set(receipts.map(row => row.id));
const subcontractOrderIds = new Set(subcontractOrders.map(row => row.id));
const purchaseOrderIds = new Set(purchaseOrders.map(row => row.id));
const supplierIds = new Set(suppliers.map(row => row.id));
const executableNcrs = ncrs.filter(row => row.disposition);
const damages = operations.filter(row => row.operation_type === 'damage');

assert.ok(executableNcrs.length > 0, 'disposal center must retain at least one configured NCR');
assert.ok(returns.length > 0, 'disposal center must retain procurement return executions');
assert.ok(executableNcrs.every(row => receiptIds.has(row.receipt_id)), 'NCR execution must retain receipt source');
assert.ok(executableNcrs.every(row => subcontractOrderIds.has(row.order_id)), 'NCR execution must retain subcontract order source');
assert.ok(returns.every(row => purchaseOrderIds.has(row.order_id)), 'procurement return execution must retain purchase order source');
assert.ok(returns.every(row => supplierIds.has(row.supplier_id)), 'procurement return execution must retain supplier source');
assert.ok(executableNcrs.every(row => Number(row.disposition_quantity || row.defective_quantity || 0) > 0), 'NCR execution quantity must remain positive');
assert.ok(returns.every(row => Number(row.total_quantity || 0) > 0), 'return execution quantity must remain positive');

console.log(`PASS disposal center API readback (${executableNcrs.length} NCR, ${returns.length} returns, ${damages.length} damage orders)`);
