import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4517';
const database = process.env.FORGE_DB || '.objectstack/otc-audit-walkthrough-20260921.sqlite';
const api = await connect(endpoint);

async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '500' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`);
  return (response.value.records || []).filter(record =>
    Object.entries(where).every(([field, value]) => record[field] === value),
  );
}

async function one(object, where) {
  const records = await find(object, where);
  assert.equal(records.length, 1, `${object} must contain exactly one ${JSON.stringify(where)}`);
  return records[0];
}

const project = await one('forge_project', { code: 'PRJ-2026-002' });
const order = await one('forge_sales_order', { code: 'SO-HC-20260923-001' });
const orderLine = await one('forge_sales_order_line', { order_id: order.id });
const shipment = await one('forge_sales_shipment', { code: 'DN-HC-20261030-001' });
const shipmentLine = await one('forge_sales_shipment_line', { shipment_id: shipment.id });
const contract = await one('forge_sales_contract', { id: order.contract_id });
const link = await one('forge_project_sales_link', { project_id: project.id });

assert.deepEqual(
  {
    order: [order.status, order.shipped_amount, order.invoiced_amount, order.collected_amount],
    orderLine: [orderLine.shipped_quantity, orderLine.invoiced_quantity],
    shipment: [shipment.status, shipment.outbound_quantity, shipment.total_amount],
    shipmentLine: [shipmentLine.outbound_quantity, shipmentLine.taxed_subtotal],
    contract: [contract.shipped_amount, contract.invoiced_amount, contract.collected_amount],
    link: [link.order_amount, link.invoice_amount, link.collected_amount],
    project: [project.contract_amount, project.invoice_amount, project.collected_amount],
  },
  {
    order: ['shipped', 243200, 243200, 243200],
    orderLine: [2, 2],
    shipment: ['outbounded', 2, 243200],
    shipmentLine: [2, 243200],
    contract: [243200, 243200, 243200],
    link: [243200, 243200, 243200],
    project: [243200, 243200, 243200],
  },
);

console.log(JSON.stringify({
  suite: 'otc-ledger-reconciliation-restart-readback',
  status: 'passed',
  endpoint,
  database,
  recordsRead: 7,
}, null, 2));
