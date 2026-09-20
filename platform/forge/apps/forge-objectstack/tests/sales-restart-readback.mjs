import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const reportPath = '.objectstack/acceptance/sales-foundation-report.json';
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const workflowReportPath = '.objectstack/acceptance/sales-workflow-report.json';
const workflowReport = JSON.parse(await readFile(workflowReportPath, 'utf8'));
const conversionReportPath = '.objectstack/acceptance/sales-conversion-report.json';
const conversionReport = JSON.parse(await readFile(conversionReportPath, 'utf8'));
const shipmentReportPath = '.objectstack/acceptance/sales-shipment-report.json';
const shipmentReport = JSON.parse(await readFile(shipmentReportPath, 'utf8'));
const outboundReport = JSON.parse(await readFile('.objectstack/acceptance/sales-outbound-report.json', 'utf8'));
assert.equal(report.passed, true, 'sales foundation acceptance must pass before restart verification');
assert.equal(workflowReport.passed, true, 'sales workflow acceptance must pass before restart verification');
assert.equal(conversionReport.passed, true, 'sales conversion acceptance must pass before restart verification');
assert.equal(shipmentReport.passed, true, 'sales shipment acceptance must pass before restart verification');

const api = await connect();
const expectations = [
  ['forge_quotation', report.ids.quotation, 'code', 'QT-OEM-20260909-001'],
  ['forge_quotation_line', report.ids.quotationLine, 'quotation_id', report.ids.quotation],
  ['forge_sales_contract', report.ids.contract, 'quotation_id', report.ids.quotation],
  ['forge_sales_contract_line', report.ids.contractLine, 'contract_id', report.ids.contract],
  ['forge_sales_order', report.ids.order, 'contract_id', report.ids.contract],
  ['forge_sales_order_line', report.ids.orderLine, 'order_id', report.ids.order],
];
for (const [object, id, field, expected] of expectations) {
  const result = await api.request(`/data/${object}/${id}`);
  assert.equal(result.status, 200, `${object} persisted across restart`);
  assert.equal(result.value.record[field], expected, `${object}.${field}`);
}
const orderLine = (await api.request(`/data/forge_sales_order_line/${report.ids.orderLine}`)).value.record;
assert.equal(orderLine.untaxed_unit_price, 107610.6195, 'four-decimal order price persisted across restart');

const workflowExpectations = [
  ['forge_quotation', workflowReport.ids.quotation, 'status', 'accepted'],
  ['forge_quotation_line', workflowReport.ids.quotationLine, 'quotation_id', workflowReport.ids.quotation],
  ['forge_sales_contract', workflowReport.ids.contract, 'status', 'active'],
  ['forge_sales_contract_line', workflowReport.ids.contractLine, 'ordered_quantity', 2],
  ['forge_sales_order', workflowReport.ids.order, 'status', 'active'],
  ['forge_sales_order_line', workflowReport.ids.orderLine, 'contract_line_id', workflowReport.ids.contractLine],
];
for (const [object, id, field, expected] of workflowExpectations) {
  const result = await api.request(`/data/${object}/${id}`);
  assert.equal(result.status, 200, `${object} workflow record persisted across restart`);
  assert.equal(result.value.record[field], expected, `${object}.${field}`);
}
const workflowContract = (await api.request(`/data/forge_sales_contract/${workflowReport.ids.contract}`)).value.record;
assert.deepEqual(
  { ordered_count: workflowContract.ordered_count, ordered_amount: workflowContract.ordered_amount },
  { ordered_count: 1, ordered_amount: 243200 },
  'contract workflow rollup persisted across restart',
);

const conversionExpectations = [
  ['forge_quotation', conversionReport.ids.quotation, 'status', 'accepted'],
  ['forge_quotation_line', conversionReport.ids.quotationLine, 'quotation_id', conversionReport.ids.quotation],
  ['forge_sales_contract', conversionReport.ids.contract, 'quotation_id', conversionReport.ids.quotation],
  ['forge_sales_contract_line', conversionReport.ids.contractLine, 'quotation_line_id', conversionReport.ids.quotationLine],
  ['forge_sales_order', conversionReport.ids.order, 'contract_id', conversionReport.ids.contract],
  ['forge_sales_order_line', conversionReport.ids.orderLine, 'contract_line_id', conversionReport.ids.contractLine],
];
for (const [object, id, field, expected] of conversionExpectations) {
  const result = await api.request(`/data/${object}/${id}`);
  assert.equal(result.status, 200, `${object} converted record persisted across restart`);
  assert.equal(result.value.record[field], expected, `${object}.${field}`);
}
const convertedContract = (await api.request(`/data/forge_sales_contract/${conversionReport.ids.contract}`)).value.record;
const convertedOrder = (await api.request(`/data/forge_sales_order/${conversionReport.ids.order}`)).value.record;
assert.deepEqual(
  { contract_status: convertedContract.status, ordered_count: convertedContract.ordered_count, ordered_amount: convertedContract.ordered_amount, order_status: convertedOrder.status, order_amount: convertedOrder.total_amount },
  { contract_status: 'active', ordered_count: 1, ordered_amount: 243200, order_status: 'partially_shipped', order_amount: 243200 },
  'converted chain states and rollup persisted across restart',
);

const shipmentExpectations = [
  ['forge_sales_shipment', shipmentReport.ids.shipment, 'status', 'outbounded'],
  ['forge_sales_shipment_line', shipmentReport.ids.shipmentLine, 'order_line_id', shipmentReport.ids.orderLine],
  ['forge_sales_order', shipmentReport.ids.order, 'shipment_count', 1],
  ['forge_sales_order_line', shipmentReport.ids.orderLine, 'shipped_quantity', 1],
];
for (const [object, id, field, expected] of shipmentExpectations) {
  const result = await api.request(`/data/${object}/${id}`);
  assert.equal(result.status, 200, `${object} shipment record persisted across restart`);
  assert.equal(result.value.record[field], expected, `${object}.${field}`);
}
const persistedShipment = (await api.request(`/data/forge_sales_shipment/${shipmentReport.ids.shipment}`)).value.record;
const persistedShipmentOrder = (await api.request(`/data/forge_sales_order/${shipmentReport.ids.order}`)).value.record;
assert.deepEqual(
  { quantity: persistedShipment.total_quantity, amount: persistedShipment.total_amount, outbound_quantity: persistedShipment.outbound_quantity, planned_amount: persistedShipmentOrder.planned_shipment_amount },
  { quantity: 1, amount: 128000, outbound_quantity: 1, planned_amount: 128000 },
  'shipment plan and actual outbound progress persisted together',
);
const persistedOutbound = (await api.request(`/data/forge_sales_outbound/${outboundReport.ids.outbound}`)).value.record;
assert.deepEqual({ status: persistedOutbound.status, sku_id: persistedOutbound.sku_id, quantity: persistedOutbound.quantity,
  available_quantity: persistedOutbound.available_quantity, before_on_hand: persistedOutbound.before_on_hand,
  after_on_hand: persistedOutbound.after_on_hand, unit_cost: persistedOutbound.unit_cost, inventory_amount: persistedOutbound.inventory_amount },
  { status: 'outbounded', sku_id: outboundReport.ids.sku, quantity: 1, available_quantity: 3,
    before_on_hand: 3, after_on_hand: 2, unit_cost: 58000, inventory_amount: 58000 },
  'outbound stock snapshot persisted across restart');
const persistedBalance = (await api.request(`/data/forge_inventory_balance/${outboundReport.ids.balance}`)).value.record;
assert.deepEqual({ on_hand_quantity: persistedBalance.on_hand_quantity, available_quantity: persistedBalance.available_quantity,
  average_cost: persistedBalance.average_cost, inventory_value: persistedBalance.inventory_value },
  { on_hand_quantity: 2, available_quantity: 2, average_cost: 58000, inventory_value: 116000 },
  'outbound inventory deduction persisted across restart');
const persistedLedger = (await api.request(`/data/forge_inventory_ledger/${outboundReport.ids.ledger}`)).value.record;
assert.deepEqual({ source_object: persistedLedger.source_object, source_id: persistedLedger.source_id,
  direction: persistedLedger.direction, movement_type: persistedLedger.movement_type, quantity: persistedLedger.quantity,
  before_on_hand: persistedLedger.before_on_hand, after_on_hand: persistedLedger.after_on_hand },
  { source_object: 'forge_sales_outbound', source_id: outboundReport.ids.outbound, direction: 'outbound',
    movement_type: 'sales_outbound', quantity: 1, before_on_hand: 3, after_on_hand: 2 },
  'source-linked outbound inventory ledger persisted across restart');

report.restartVerification = {
  verifiedAt: new Date().toISOString(), status: 'passed', database: '.objectstack/forge.sqlite',
  recordsRead: expectations.length, assertion: 'same IDs, exact source links and four-decimal price survived a full server stop/start',
};
await writeFile(reportPath, JSON.stringify(report, null, 2));
workflowReport.restartVerification = {
  verifiedAt: new Date().toISOString(), status: 'passed', database: '.objectstack/forge.sqlite',
  recordsRead: workflowExpectations.length, assertion: 'accepted quote, active contract/order and exact contract amount/quantity rollups survived a full server stop/start',
};
await writeFile(workflowReportPath, JSON.stringify(workflowReport, null, 2));
conversionReport.restartVerification = {
  verifiedAt: new Date().toISOString(), status: 'passed', database: '.objectstack/forge.sqlite',
  recordsRead: conversionExpectations.length, assertion: 'one-click converted quote, contract, order and copied lines survived a full server stop/start with exact links, states and rollups',
};
await writeFile(conversionReportPath, JSON.stringify(conversionReport, null, 2));
shipmentReport.restartVerification = {
  verifiedAt: new Date().toISOString(), status: 'passed', database: '.objectstack/forge.sqlite',
  recordsRead: shipmentExpectations.length + 3, assertion: 'shipment plan, outbound stock snapshot, deducted balance, source-linked ledger and order rollups survived restart',
};
await writeFile(shipmentReportPath, JSON.stringify(shipmentReport, null, 2));
console.log('PASS sales foundation, workflow, conversion and shipment chains survived full server restart with exact IDs, links, states, precision and rollups');
