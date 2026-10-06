type ProjectPurchaseOrderRow = { id: string; status?: string };
type ProjectPaymentTaskRow = {
  order_id?: string;
  source_type?: string;
  status?: string;
  paid_amount?: number | string;
  remaining_amount?: number | string;
};
type ProjectPayableRow = { order_id?: string; outstanding_amount?: number | string };
type ProjectBomShortageLineRow = {
  id: string;
  fulfillment_status?: string;
  shortage_quantity?: number | string;
};
type ProjectPurchaseOrderLineRow = {
  order_id?: string;
  source_analysis_line_id?: string;
  quantity?: number | string;
  inbound_quantity?: number | string;
};
type ProjectLogRow = { category?: string };
type ProjectHeaderCostRow = { status?: string; allocated_amount?: number | string | null };
type ProjectHeaderSalesLinkRow = {
  order_amount?: number | string | null;
  invoice_amount?: number | string | null;
  collected_amount?: number | string | null;
};

export function summarizeProjectHeaderFinance(input: {
  salesLinks: ProjectHeaderSalesLinkRow[];
  costs: ProjectHeaderCostRow[];
  salesLinkSourceUnavailable?: boolean;
  costSourceUnavailable?: boolean;
}) {
  const amount = (value: number | string | null | undefined): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const sumSalesLinks = (field: 'order_amount' | 'invoice_amount' | 'collected_amount') => {
    if (input.salesLinkSourceUnavailable) return null;
    if (!input.salesLinks.length) return 0;
    const values = input.salesLinks.map(link => amount(link[field]));
    return values.some(value => value === null) ? null : values.reduce<number>((sum, value) => sum + (value as number), 0);
  };
  const contractAmount = sumSalesLinks('order_amount');
  const invoiceAmount = sumSalesLinks('invoice_amount');
  const collectedAmount = sumSalesLinks('collected_amount');
  const allocated = input.costs.filter(row => row.status === 'allocated');
  const allocatedAmounts = allocated.map(row => amount(row.allocated_amount));
  const totalCost = input.costSourceUnavailable || allocatedAmounts.some(value => value === null)
    ? null
    : allocatedAmounts.reduce<number>((sum, value) => sum + (value as number), 0);
  const hasContractDenominator = contractAmount !== null && contractAmount > 0;
  const grossProfit = hasContractDenominator && totalCost !== null ? contractAmount - totalCost : null;
  const grossMarginRate = hasContractDenominator && grossProfit !== null ? grossProfit / contractAmount * 100 : null;
  const costToContractRate = hasContractDenominator && totalCost !== null ? totalCost / contractAmount * 100 : null;
  const collectionRate = hasContractDenominator && collectedAmount !== null ? collectedAmount / contractAmount * 100 : null;
  const contractNote = contractAmount === null
    ? input.salesLinkSourceUnavailable ? '关联合同或订单来源不可用' : '合同或订单金额来源未核实'
    : contractAmount === 0 ? '暂无关联合同或订单' : '关联合同与销售订单汇总';
  const invoiceNote = invoiceAmount === null
    ? input.salesLinkSourceUnavailable ? '开票来源不可用' : '开票金额来源未核实'
    : '关联合同与销售订单汇总';
  const costNote = totalCost === null
    ? '项目成本来源不可用'
    : costToContractRate === null ? '暂无合同金额，比例未计算（成本占比）' : '占合同金额 ' + costToContractRate.toFixed(1) + '%';
  const grossProfitNote = input.salesLinkSourceUnavailable
    ? '关联合同或订单来源不可用，无法计算毛利'
    : contractAmount === null ? '合同或订单金额来源未核实，无法计算毛利'
    : totalCost === null ? '项目成本来源不可用，无法计算毛利'
      : !hasContractDenominator ? '暂无关联合同或订单，暂不能计算毛利'
        : '毛利率 ' + (grossMarginRate as number).toFixed(1) + '%';
  const collectedNote = collectedAmount === null
    ? input.salesLinkSourceUnavailable ? '关联合同或订单来源不可用' : '回款金额来源未核实'
    : collectionRate === null ? '暂无合同金额，回款率未计算' : collectionRate.toFixed(1) + '%';

  return {
    contractAmount, invoiceAmount, totalCost, grossProfit, grossMarginRate, costToContractRate,
    collectedAmount, collectionRate, contractNote, invoiceNote, costNote, grossProfitNote, collectedNote,
  };
}

export type ProjectSalesOrderMetrics = {
  orderCount: number | null;
  totalAmount: number | null;
  invoicedAmount: number | null;
  collectedAmount: number | null;
  invoicedRate: number | null;
  collectedRate: number | null;
  orderCountNote: string;
  amountNote: string;
  invoicedNote: string;
  collectedNote: string;
};

/** Summarize distinct project-linked orders. Order collected_amount also includes approved prepayment offsets, so it is not cash-only. */
export function summarizeProjectSalesOrders(input: {
  salesLinks: unknown;
  orderRows: unknown;
  salesLinkSourceUnavailable?: boolean;
  orderSourceUnavailable?: boolean;
}): ProjectSalesOrderMetrics {
  if (input.salesLinkSourceUnavailable === true || !Array.isArray(input.salesLinks)) {
    return {
      orderCount: null,
      totalAmount: null,
      invoicedAmount: null,
      collectedAmount: null,
      invoicedRate: null,
      collectedRate: null,
      orderCountNote: '关联订单不可用',
      amountNote: '关联订单不可用',
      invoicedNote: '开票金额不可用',
      collectedNote: '回款金额不可用',
    };
  }

  const orderIds: string[] = [];
  const linkedIds = new Set<string>();
  let invalidLinkRows = false;
  for (const row of input.salesLinks) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      invalidLinkRows = true;
      continue;
    }
    const link = row as Record<string, unknown>;
    const reference = link.order_id;
    if (reference === null || reference === undefined || reference === '') continue;
    let orderId = '';
    if (typeof reference === 'string') orderId = reference.trim();
    else if (reference && typeof reference === 'object' && !Array.isArray(reference)) {
      const expanded = reference as Record<string, unknown>;
      for (const key of ['id', 'value', '_id']) {
        if (typeof expanded[key] === 'string' && expanded[key].trim()) {
          orderId = expanded[key].trim();
          break;
        }
      }
    }
    if (!orderId) {
      invalidLinkRows = true;
      continue;
    }
    if (!linkedIds.has(orderId)) {
      linkedIds.add(orderId);
      orderIds.push(orderId);
    }
  }

  const orderCount = invalidLinkRows ? null : orderIds.length;
  const incompleteNote = '关联销售订单读取不完整，金额暂不可用';
  if (invalidLinkRows) {
    return {
      orderCount: null,
      totalAmount: null,
      invoicedAmount: null,
      collectedAmount: null,
      invoicedRate: null,
      collectedRate: null,
      orderCountNote: '关联订单数据不完整',
      amountNote: incompleteNote,
      invoicedNote: '开票金额不可用',
      collectedNote: '回款金额不可用',
    };
  }

  const base = {
    orderCount,
    totalAmount: null as number | null,
    invoicedAmount: null as number | null,
    collectedAmount: null as number | null,
    invoicedRate: null as number | null,
    collectedRate: null as number | null,
  };
  const orderCountNote = '';
  if (input.orderSourceUnavailable === true || !Array.isArray(input.orderRows)) {
    return {
      ...base,
      orderCountNote,
      amountNote: '销售订单不可用',
      invoicedNote: '开票金额不可用',
      collectedNote: '回款金额不可用',
    };
  }

  const ordersById = new Map<string, Record<string, unknown>>();
  let invalidOrderRows = false;
  let conflictingDuplicate = false;
  for (const row of input.orderRows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      invalidOrderRows = true;
      continue;
    }
    const order = row as Record<string, unknown>;
    const orderId = typeof order.id === 'string' ? order.id.trim() : '';
    if (!orderId) {
      invalidOrderRows = true;
      continue;
    }
    if (!linkedIds.has(orderId)) continue;
    const existing = ordersById.get(orderId);
    if (!existing) {
      ordersById.set(orderId, order);
      continue;
    }
    for (const field of ['total_amount', 'invoiced_amount', 'collected_amount']) {
      const left = existing[field];
      const right = order[field];
      const leftMissing = left === null || left === undefined || left === '';
      const rightMissing = right === null || right === undefined || right === '';
      if (leftMissing !== rightMissing) {
        conflictingDuplicate = true;
        continue;
      }
      if (leftMissing) continue;
      const leftNumeric = typeof left === 'number' && Number.isFinite(left)
        || typeof left === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(left.trim());
      const rightNumeric = typeof right === 'number' && Number.isFinite(right)
        || typeof right === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(right.trim());
      const leftNumber = leftNumeric ? Number(left) : Number.NaN;
      const rightNumber = rightNumeric ? Number(right) : Number.NaN;
      const leftValid = leftNumeric && Number.isFinite(leftNumber) && leftNumber >= 0;
      const rightValid = rightNumeric && Number.isFinite(rightNumber) && rightNumber >= 0;
      if (leftValid || rightValid) {
        if (!leftValid || !rightValid || leftNumber !== rightNumber) conflictingDuplicate = true;
      } else if (typeof left !== typeof right || typeof left === 'object' || String(left) !== String(right)) {
        conflictingDuplicate = true;
      }
    }
  }

  const missingLinkedOrder = orderIds.some(id => !ordersById.has(id));
  if (invalidOrderRows || conflictingDuplicate || missingLinkedOrder) {
    const issue = invalidOrderRows ? '销售订单读取数据不完整' : conflictingDuplicate ? '销售订单重复记录存在金额冲突' : '部分关联销售订单不可读取';
    return {
      ...base,
      orderCountNote,
      amountNote: issue,
      invoicedNote: '开票金额不可用',
      collectedNote: '回款金额不可用',
    };
  }

  let totalAmount = 0;
  let invoicedAmount = 0;
  let collectedAmount = 0;
  let totalAmountComplete = true;
  let invoicedAmountComplete = true;
  let collectedAmountComplete = true;
  for (const orderId of orderIds) {
    const order = ordersById.get(orderId)!;
    const totalRaw = order.total_amount;
    const invoiceRaw = order.invoiced_amount;
    const collectedRaw = order.collected_amount;
    const totalNumeric = typeof totalRaw === 'number' && Number.isFinite(totalRaw)
      || typeof totalRaw === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(totalRaw.trim());
    if (!totalNumeric) totalAmountComplete = false;
    else {
      const amount = Number(totalRaw);
      const nextAmount = totalAmount + amount;
      if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(nextAmount)) totalAmountComplete = false;
      else totalAmount = nextAmount;
    }
    const invoiceNumeric = typeof invoiceRaw === 'number' && Number.isFinite(invoiceRaw)
      || typeof invoiceRaw === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(invoiceRaw.trim());
    if (!invoiceNumeric) invoicedAmountComplete = false;
    else {
      const amount = Number(invoiceRaw);
      const nextAmount = invoicedAmount + amount;
      if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(nextAmount)) invoicedAmountComplete = false;
      else invoicedAmount = nextAmount;
    }
    const collectedNumeric = typeof collectedRaw === 'number' && Number.isFinite(collectedRaw)
      || typeof collectedRaw === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(collectedRaw.trim());
    if (!collectedNumeric) collectedAmountComplete = false;
    else {
      const amount = Number(collectedRaw);
      const nextAmount = collectedAmount + amount;
      if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(nextAmount)) collectedAmountComplete = false;
      else collectedAmount = nextAmount;
    }
  }

  const completeTotal = totalAmountComplete ? totalAmount : null;
  const completeInvoice = invoicedAmountComplete ? invoicedAmount : null;
  const completeCollected = collectedAmountComplete ? collectedAmount : null;
  const rawInvoicedRate = completeTotal !== null && completeTotal > 0 && completeInvoice !== null
    ? completeInvoice / completeTotal * 100
    : null;
  const rawCollectedRate = completeTotal !== null && completeTotal > 0 && completeCollected !== null
    ? completeCollected / completeTotal * 100
    : null;
  const invoicedRate = rawInvoicedRate !== null && Number.isFinite(rawInvoicedRate) ? rawInvoicedRate : null;
  const collectedRate = rawCollectedRate !== null && Number.isFinite(rawCollectedRate) ? rawCollectedRate : null;
  const emptyOrderSet = orderIds.length === 0;
  return {
    orderCount,
    totalAmount: completeTotal,
    invoicedAmount: completeInvoice,
    collectedAmount: completeCollected,
    invoicedRate,
    collectedRate,
    orderCountNote: emptyOrderSet ? '' : orderCountNote,
    amountNote: completeTotal === null ? '订单金额缺失或无效' : '销售订单金额汇总',
    invoicedNote: completeInvoice === null
      ? '开票金额缺失或无效'
      : invoicedRate === null ? '开票率未计算'
        : '开票率 ' + invoicedRate.toFixed(1) + '%',
    collectedNote: completeCollected === null
      ? '回款金额缺失或无效'
      : collectedRate === null ? '回款率未计算'
        : '回款率 ' + collectedRate.toFixed(1) + '% · 含预收冲抵',
  };
}

export function filterProjectLogsByCategory(logs: ProjectLogRow[], category: string) {
  return category ? logs.filter(log => log.category === category) : logs;
}

export function summarizeProjectPayments(
  purchaseOrders: ProjectPurchaseOrderRow[],
  paymentTasks: ProjectPaymentTaskRow[],
  payables: ProjectPayableRow[],
) {
  const purchasePaymentTaskSources = new Set<string>(['purchase_payable', 'purchase_prepayment']);
  const paidPaymentTaskStatuses = new Set<string>(['partially_paid', 'paid']);
  const approvedPrepaymentStatuses = new Set<string>(['approved', 'partially_paid']);
  const orderIds = new Set(purchaseOrders.map(order => order.id));
  const paidByOrder = new Map<string, number>();
  const unpaidByOrder = new Map<string, number>();
  const add = (values: Map<string, number>, orderId: string, amount: number | string | undefined) => values.set(orderId, (values.get(orderId) || 0) + Number(amount || 0));

  for (const task of paymentTasks) {
    if (!task.order_id || !orderIds.has(task.order_id)) continue;

    if (task.source_type && purchasePaymentTaskSources.has(task.source_type) && task.status && paidPaymentTaskStatuses.has(task.status)) {
      add(paidByOrder, task.order_id, task.paid_amount);
    }

    if (task.source_type === 'purchase_prepayment' && task.status && approvedPrepaymentStatuses.has(task.status)) {
      add(unpaidByOrder, task.order_id, task.remaining_amount);
    }
  }

  for (const payable of payables) {
    if (payable.order_id && orderIds.has(payable.order_id) && Number(payable.outstanding_amount || 0) > 0) {
      add(unpaidByOrder, payable.order_id, payable.outstanding_amount);
    }
  }

  return {
    paidByOrder,
    unpaidByOrder,
    paidTotal: [...paidByOrder.values()].reduce((total, amount) => total + amount, 0),
    unpaidTotal: [...unpaidByOrder.values()].reduce((total, amount) => total + amount, 0),
  };
}

export function summarizeBomFulfillment(
  shortageLines: ProjectBomShortageLineRow[],
  purchaseOrderLines: ProjectPurchaseOrderLineRow[],
  purchaseOrders: ProjectPurchaseOrderRow[],
) {
  const activePurchaseOrderStatuses = new Set<string>(['approved', 'partially_arrived', 'arrived', 'completed']);
  const ordersById = new Map(purchaseOrders.map(order => [order.id, order]));
  const lineStatuses = new Map<string, string>();
  let sufficient = 0;
  let purchasing = 0;
  let pendingPurchase = 0;

  for (const shortageLine of shortageLines) {
    const shortage = Math.max(0, Number(shortageLine.shortage_quantity || 0));
    if (shortageLine.fulfillment_status === 'sufficient' || shortage === 0) {
      sufficient++;
      lineStatuses.set(shortageLine.id, 'sufficient');
      continue;
    }

    let ordered = 0;
    let inbound = 0;
    for (const orderLine of purchaseOrderLines) {
      if (!orderLine.order_id || orderLine.source_analysis_line_id !== shortageLine.id) continue;
      const order = ordersById.get(orderLine.order_id);
      if (!order?.status || !activePurchaseOrderStatuses.has(order.status)) continue;

      const quantity = Math.max(0, Number(orderLine.quantity || 0));
      ordered += quantity;
      inbound += Math.min(quantity, Math.max(0, Number(orderLine.inbound_quantity || 0)));
    }

    if (inbound >= shortage) {
      sufficient++;
      lineStatuses.set(shortageLine.id, 'arrived');
      continue;
    }
    if (ordered > inbound) {
      purchasing++;
      lineStatuses.set(shortageLine.id, 'purchasing');
    } else {
      lineStatuses.set(shortageLine.id, 'pending_purchase');
    }
    if (ordered < shortage) pendingPurchase++;
  }

  return { sufficient, purchasing, pendingPurchase, lineStatuses };
}
