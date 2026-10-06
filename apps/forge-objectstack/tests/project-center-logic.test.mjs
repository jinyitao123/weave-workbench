import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { filterProjectLogsByCategory, summarizeBomFulfillment, summarizeProjectHeaderFinance, summarizeProjectPayments, summarizeProjectSalesOrders } from '../src/pages/project-center.logic.ts';
import { ProjectViews } from '../src/views/project.view.ts';

test('project grid defaults to compact rows and renders 0-100 progress as a percentage', () => {
  assert.equal(ProjectViews.list.rowHeight, 'compact');
  assert.equal(ProjectViews.list.columns.find(column => column.field === 'progress')?.type, 'percent');
});

test('project header keeps complete empty amount sums at zero but leaves zero-denominator margin and rates unknown', () => {
  const summary = summarizeProjectHeaderFinance({ salesLinks: [], costs: [] });
  assert.deepEqual({
    contract: summary.contractAmount, cost: summary.totalCost, profit: summary.grossProfit,
    margin: summary.grossMarginRate, costRate: summary.costToContractRate,
    collected: summary.collectedAmount, collectionRate: summary.collectionRate,
  }, { contract: 0, cost: 0, profit: null, margin: null, costRate: null, collected: 0, collectionRate: null });
  assert.match(summary.grossProfitNote, /暂无关联合同/);
  assert.match(summary.costNote, /比例未计算/);
  assert.match(summary.collectedNote, /回款率未计算/);
});

test('project header reports percentages only when their source and positive denominator are available', () => {
  const summary = summarizeProjectHeaderFinance({
    salesLinks: [{ order_amount: 120, collected_amount: 30 }],
    costs: [{ status: 'allocated', allocated_amount: 0 }, { status: 'reversed', allocated_amount: 25 }],
  });
  assert.deepEqual({ contract: summary.contractAmount, cost: summary.totalCost, profit: summary.grossProfit,
    margin: summary.grossMarginRate, costRate: summary.costToContractRate, collected: summary.collectedAmount,
    collectionRate: summary.collectionRate },
  { contract: 120, cost: 0, profit: 120, margin: 100, costRate: 0, collected: 30, collectionRate: 25 });
  const unknown = summarizeProjectHeaderFinance({ salesLinks: [], costs: [], salesLinkSourceUnavailable: true, costSourceUnavailable: true });
  assert.equal(unknown.contractAmount, null);
  assert.equal(unknown.totalCost, null);
  assert.equal(unknown.grossProfit, null);
  assert.match(unknown.contractNote, /不可用/);
  assert.match(unknown.costNote, /不可用/);
});

test('partially populated project links are not converted to zero financial sources', () => {
  const summary = summarizeProjectHeaderFinance({ salesLinks: [{ order_amount: null, collected_amount: 5 }], costs: [] });
  assert.equal(summary.contractAmount, null);
  assert.equal(summary.grossProfit, null);
  assert.equal(summary.costToContractRate, null);
  assert.equal(summary.collectedAmount, 5);
  assert.equal(summary.collectionRate, null);
  assert.match(summary.contractNote, /来源未核实/);
});

test('project sales-order metrics deduplicate linked orders and use live order financial snapshots', () => {
  const summary = summarizeProjectSalesOrders({
    salesLinks: [
      { contract_id: 'contract-a', order_id: 'order-1', order_amount: 9999, invoice_amount: 9999, collected_amount: 9999 },
      { contract_id: 'contract-b', order_id: 'order-1', order_amount: 9999, invoice_amount: 9999, collected_amount: 9999 },
      { contract_id: 'contract-b', order_id: 'order-2', order_amount: 9999, invoice_amount: 9999, collected_amount: 9999 },
      { contract_id: 'contract-only', order_id: null, order_amount: 700 },
    ],
    orderRows: [
      { id: 'order-1', total_amount: 100, invoiced_amount: 50, collected_amount: 20 },
      { id: 'order-2', total_amount: '300', invoiced_amount: '75', collected_amount: '150' },
    ],
  });

  assert.deepEqual({
    orderCount: summary.orderCount,
    totalAmount: summary.totalAmount,
    invoicedAmount: summary.invoicedAmount,
    collectedAmount: summary.collectedAmount,
    invoicedRate: summary.invoicedRate,
    collectedRate: summary.collectedRate,
  }, {
    orderCount: 2, totalAmount: 400, invoicedAmount: 125, collectedAmount: 170,
    invoicedRate: 31.25, collectedRate: 42.5,
  });
  assert.match(summary.amountNote, /销售订单金额汇总/);
  assert.match(summary.invoicedNote, /开票率 31\.3%/);
  assert.match(summary.collectedNote, /预收冲抵/);
});

test('complete empty and zero-total order sets do not manufacture a zero percent rate', () => {
  const empty = summarizeProjectSalesOrders({ salesLinks: [], orderRows: [] });
  assert.deepEqual({
    orderCount: empty.orderCount,
    totalAmount: empty.totalAmount,
    invoicedAmount: empty.invoicedAmount,
    collectedAmount: empty.collectedAmount,
    invoicedRate: empty.invoicedRate,
    collectedRate: empty.collectedRate,
  }, { orderCount: 0, totalAmount: 0, invoicedAmount: 0, collectedAmount: 0, invoicedRate: null, collectedRate: null });
  assert.equal(empty.orderCountNote, '');

  const zero = summarizeProjectSalesOrders({
    salesLinks: [{ order_id: 'zero-order' }],
    orderRows: [{ id: 'zero-order', total_amount: 0, invoiced_amount: 0, collected_amount: 0 }],
  });
  assert.equal(zero.orderCount, 1);
  assert.equal(zero.totalAmount, 0);
  assert.equal(zero.invoicedAmount, 0);
  assert.equal(zero.collectedAmount, 0);
  assert.equal(zero.invoicedRate, null);
  assert.equal(zero.collectedRate, null);
  assert.equal(zero.invoicedNote, '开票率未计算');
});

test('failed or incomplete link/order reads never become zero sales totals', () => {
  const linkFailure = summarizeProjectSalesOrders({ salesLinks: [], orderRows: [], salesLinkSourceUnavailable: true });
  assert.equal(linkFailure.orderCount, null);
  assert.equal(linkFailure.totalAmount, null);
  assert.equal(linkFailure.invoicedAmount, null);
  assert.equal(linkFailure.collectedAmount, null);
  assert.match(linkFailure.orderCountNote, /关联订单不可用/);

  const orderFailure = summarizeProjectSalesOrders({ salesLinks: [{ order_id: 'order-1' }], orderRows: [], orderSourceUnavailable: true });
  assert.equal(orderFailure.orderCount, 1, 'a complete project-link source still establishes the number of linked orders');
  assert.equal(orderFailure.totalAmount, null);
  assert.equal(orderFailure.invoicedAmount, null);
  assert.equal(orderFailure.collectedAmount, null);
  assert.match(orderFailure.amountNote, /不可用/);

  const missingOrder = summarizeProjectSalesOrders({ salesLinks: [{ order_id: 'order-1' }], orderRows: [] });
  assert.equal(missingOrder.orderCount, 1);
  assert.equal(missingOrder.totalAmount, null);
  assert.match(missingOrder.amountNote, /部分关联销售订单不可读取/);

  const conflictingOrder = summarizeProjectSalesOrders({
    salesLinks: [{ order_id: 'order-1' }],
    orderRows: [
      { id: 'order-1', total_amount: 100, invoiced_amount: 0, collected_amount: 0 },
      { id: 'order-1', total_amount: 120, invoiced_amount: 0, collected_amount: 0 },
    ],
  });
  assert.equal(conflictingOrder.orderCount, 1);
  assert.equal(conflictingOrder.totalAmount, null);
  assert.equal(conflictingOrder.invoicedAmount, null);
  assert.match(conflictingOrder.amountNote, /重复记录存在金额冲突/);
});

test('duplicate identical order rows are counted once; missing and invalid financial fields stay unknown per metric', () => {
  const duplicateSameOrder = summarizeProjectSalesOrders({
    salesLinks: [{ order_id: 'order-1' }, { order_id: 'order-1' }],
    orderRows: [
      { id: 'order-1', total_amount: 100, invoiced_amount: 40, collected_amount: 20 },
      { id: 'order-1', total_amount: '100', invoiced_amount: '40', collected_amount: '20' },
    ],
  });
  assert.equal(duplicateSameOrder.orderCount, 1);
  assert.equal(duplicateSameOrder.totalAmount, 100);

  const badInvoiceAndCollection = summarizeProjectSalesOrders({
    salesLinks: [{ order_id: 'order-1' }, { order_id: 'order-2' }],
    orderRows: [
      { id: 'order-1', total_amount: '100', invoiced_amount: null, collected_amount: Infinity },
      { id: 'order-2', total_amount: 100, invoiced_amount: 40, collected_amount: -1 },
    ],
  });
  assert.equal(badInvoiceAndCollection.totalAmount, 200);
  assert.equal(badInvoiceAndCollection.invoicedAmount, null);
  assert.equal(badInvoiceAndCollection.invoicedRate, null);
  assert.equal(badInvoiceAndCollection.collectedAmount, null);
  assert.equal(badInvoiceAndCollection.collectedRate, null);

  const missingSalesAmount = summarizeProjectSalesOrders({
    salesLinks: [{ order_id: 'order-1' }],
    orderRows: [{ id: 'order-1', total_amount: undefined, invoiced_amount: 40, collected_amount: 20 }],
  });
  assert.equal(missingSalesAmount.totalAmount, null);
  assert.equal(missingSalesAmount.invoicedAmount, 40);
  assert.equal(missingSalesAmount.collectedAmount, 20);
  assert.equal(missingSalesAmount.invoicedRate, null);
  assert.equal(missingSalesAmount.collectedRate, null);

  const badSalesAmount = summarizeProjectSalesOrders({
    salesLinks: [{ order_id: 'order-1' }],
    orderRows: [{ id: 'order-1', total_amount: NaN, invoiced_amount: 40, collected_amount: 20 }],
  });
  assert.equal(badSalesAmount.totalAmount, null);
  assert.equal(badSalesAmount.invoicedRate, null);
  assert.equal(badSalesAmount.collectedRate, null);
});

test('sales metrics reject coercible nonnumeric types and overflowed sums or rates', () => {
  const badTypes = summarizeProjectSalesOrders({
    salesLinks: [{ order_id: 'order-1' }],
    orderRows: [{ id: 'order-1', total_amount: '  ', invoiced_amount: true, collected_amount: [10] }],
  });
  assert.equal(badTypes.totalAmount, null);
  assert.equal(badTypes.invoicedAmount, null);
  assert.equal(badTypes.collectedAmount, null);

  const numericStrings = summarizeProjectSalesOrders({
    salesLinks: [{ order_id: 'order-1' }],
    orderRows: [{ id: 'order-1', total_amount: ' 12.50 ', invoiced_amount: '2.50', collected_amount: '0' }],
  });
  assert.equal(numericStrings.totalAmount, 12.5);
  assert.equal(numericStrings.invoicedAmount, 2.5);
  assert.equal(numericStrings.collectedAmount, 0);

  const overflowedSum = summarizeProjectSalesOrders({
    salesLinks: [{ order_id: 'order-1' }, { order_id: 'order-2' }],
    orderRows: [
      { id: 'order-1', total_amount: Number.MAX_VALUE, invoiced_amount: 0, collected_amount: 0 },
      { id: 'order-2', total_amount: Number.MAX_VALUE, invoiced_amount: 0, collected_amount: 0 },
    ],
  });
  assert.equal(overflowedSum.totalAmount, null);
  assert.equal(overflowedSum.invoicedAmount, 0);
  assert.equal(overflowedSum.invoicedRate, null);

  const overflowedRate = summarizeProjectSalesOrders({
    salesLinks: [{ order_id: 'order-1' }],
    orderRows: [{ id: 'order-1', total_amount: Number.MIN_VALUE, invoiced_amount: Number.MAX_VALUE, collected_amount: 0 }],
  });
  assert.equal(overflowedRate.totalAmount, Number.MIN_VALUE);
  assert.equal(overflowedRate.invoicedAmount, Number.MAX_VALUE);
  assert.equal(overflowedRate.invoicedRate, null);
});

test('sales-order metrics helper is self-contained when serialized into the React Page source', () => {
  const source = summarizeProjectSalesOrders.toString();
  assert.doesNotMatch(source, /__name/);
  const context = {};
  vm.runInNewContext(`this.projectSalesSummary = (${source});`, context);
  const summary = context.projectSalesSummary({
    salesLinks: [{ order_id: 'order-vm' }],
    orderRows: [{ id: 'order-vm', total_amount: 200, invoiced_amount: 50, collected_amount: 25 }],
  });
  assert.equal(summary.orderCount, 1);
  assert.equal(summary.totalAmount, 200);
  assert.equal(summary.invoicedAmount, 50);
  assert.equal(summary.collectedAmount, 25);
  assert.equal(summary.invoicedRate, 25);
  assert.equal(summary.collectedRate, 12.5);
});

test('project payments count confirmed purchase payments once and exclude pending requests', () => {
  const summary = summarizeProjectPayments(
    [{ id: 'PO-1' }, { id: 'PO-2' }],
    [
      { order_id: 'PO-1', source_type: 'purchase_payable', status: 'partially_paid', paid_amount: '20', remaining_amount: '30' },
      { order_id: 'PO-1', source_type: 'purchase_prepayment', status: 'partially_paid', paid_amount: 10, remaining_amount: 5 },
      { order_id: 'PO-1', source_type: 'purchase_prepayment', status: 'pending_review', paid_amount: 0, remaining_amount: 60 },
      { order_id: 'PO-1', source_type: 'expense', status: 'paid', paid_amount: 40, remaining_amount: 0 },
      { order_id: 'OTHER', source_type: 'purchase_payable', status: 'paid', paid_amount: 99, remaining_amount: 0 },
    ],
    [{ order_id: 'PO-1', outstanding_amount: 30 }, { order_id: 'PO-2', outstanding_amount: 0 }],
  );

  assert.equal(summary.paidByOrder.get('PO-1'), 30);
  assert.equal(summary.paidByOrder.has('PO-2'), false);
  assert.equal(summary.paidTotal, 30);
  assert.equal(summary.unpaidByOrder.get('PO-1'), 35);
  assert.equal(summary.unpaidTotal, 35);
});

test('project log categories filter by their stored business values', () => {
  const logs = [
    { category: 'progress', name: '进展' },
    { category: 'risk', name: '风险' },
    { category: 'customer', name: '客户沟通' },
  ];

  assert.deepEqual(filterProjectLogsByCategory(logs, 'risk').map(log => log.name), ['风险']);
  assert.equal(filterProjectLogsByCategory(logs, '').length, 3);
});

test('BOM fulfillment uses the selected shortage line and effective procurement orders', () => {
  const summary = summarizeBomFulfillment(
    [
      { id: 'sufficient', shortage_quantity: 0, fulfillment_status: 'sufficient' },
      { id: 'in-progress', shortage_quantity: 10, fulfillment_status: 'shortage' },
      { id: 'remainder', shortage_quantity: 5, fulfillment_status: 'shortage' },
      { id: 'unapproved', shortage_quantity: 8, fulfillment_status: 'shortage' },
      { id: 'received', shortage_quantity: 4, fulfillment_status: 'shortage' },
    ],
    [
      { id: 'ol-1', order_id: 'approved', source_analysis_line_id: 'in-progress', quantity: 10, inbound_quantity: 3 },
      { id: 'ol-2', order_id: 'approved', source_analysis_line_id: 'remainder', quantity: 2, inbound_quantity: 2 },
      { id: 'ol-3', order_id: 'pending', source_analysis_line_id: 'unapproved', quantity: 8, inbound_quantity: 0 },
      { id: 'ol-4', order_id: 'approved', source_analysis_line_id: 'received', quantity: 4, inbound_quantity: 4 },
    ],
    [
      { id: 'approved', status: 'approved' },
      { id: 'pending', status: 'pending_approval' },
    ],
  );

  assert.equal(summary.sufficient, 2);
  assert.equal(summary.purchasing, 1);
  assert.equal(summary.pendingPurchase, 2);
  assert.equal(summary.lineStatuses.get('sufficient'), 'sufficient');
  assert.equal(summary.lineStatuses.get('received'), 'arrived');
  assert.equal(summary.lineStatuses.get('in-progress'), 'purchasing');
  assert.equal(summary.lineStatuses.get('remainder'), 'pending_purchase');
  assert.equal(summary.lineStatuses.get('unapproved'), 'pending_purchase');
});
