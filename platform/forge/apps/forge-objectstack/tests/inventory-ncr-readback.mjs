import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const find = async object => {
  const result = await api.request(`/data/${object}?$top=500`);
  assert.equal(result.status, 200, `${object} should be readable`);
  return result.value.records;
};

const [ncrs, inspections, receipts, subcontractOrders, purchaseOrders, suppliers] = await Promise.all([
  find('forge_subcontract_ncr'),
  find('forge_purchase_inspection'),
  find('forge_subcontract_receipt'),
  find('forge_subcontract_order'),
  find('forge_purchase_order'),
  find('forge_supplier'),
]);
const receiptIds = new Set(receipts.map(row => row.id));
const subcontractOrderIds = new Set(subcontractOrders.map(row => row.id));
const purchaseOrderIds = new Set(purchaseOrders.map(row => row.id));
const supplierIds = new Set(suppliers.map(row => row.id));
const rejectedInspections = inspections.filter(row => Number(row.rejected_quantity || 0) > 0);

assert.ok(ncrs.length > 0, 'subcontract NCR rows should survive restart');
assert.ok(rejectedInspections.length > 0, 'purchase rejected inspection rows should survive restart');
assert.ok(ncrs.every(row => receiptIds.has(row.receipt_id)), 'every subcontract NCR must retain its receipt source');
assert.ok(ncrs.every(row => subcontractOrderIds.has(row.order_id)), 'every subcontract NCR must retain its order source');
assert.ok(ncrs.every(row => supplierIds.has(row.supplier_id)), 'every subcontract NCR must retain its supplier source');
assert.ok(ncrs.every(row => Number(row.defective_quantity || 0) > 0), 'every NCR must retain a positive defective quantity');
assert.ok(rejectedInspections.every(row => purchaseOrderIds.has(row.order_id)), 'every rejected inspection must retain its purchase order source');
assert.ok(rejectedInspections.every(row => supplierIds.has(row.supplier_id)), 'every rejected inspection must retain its supplier source');

console.log(`PASS unified inventory NCR API readback (${ncrs.length} subcontract NCR, ${rejectedInspections.length} rejected purchase inspection)`);
