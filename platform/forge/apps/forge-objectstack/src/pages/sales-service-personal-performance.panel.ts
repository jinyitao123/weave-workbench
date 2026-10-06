/** Pure projection for the signed-in engineer's service performance view. */
export function servicePersonalPerformanceProjection(rows: unknown, userId: unknown, customerNames: unknown, namesComplete: unknown) {
  const actor = typeof userId === 'string' ? userId.trim() : '';
  const unavailableSummary = [
    { id: 'all', label: '本人服务工单', value: null },
    { id: 'completed', label: '本人已完工', value: null },
  ];
  const unavailableRanking = {
    available: false,
    error: '客户名称暂不可用，客户排行未完整显示。',
    items: [],
    total: null,
    missingNameCount: null,
  };
  if (!actor) {
    return {
      available: false,
      error: '当前账号标识不可用，个人业绩暂不可用。',
      summary: unavailableSummary,
      rows: [],
      unknownStatusCount: null,
      customerRanking: unavailableRanking,
    };
  }
  if (!Array.isArray(rows)) {
    return {
      available: false,
      error: '本人服务工单读取不完整，个人业绩暂不可用。',
      summary: unavailableSummary,
      rows: [],
      unknownStatusCount: null,
      customerRanking: unavailableRanking,
    };
  }

  const ownRows: Record<string, unknown>[] = [];
  let invalidRowCount = 0;
  let invalidAssignmentCount = 0;
  for (const candidate of rows as unknown[]) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      invalidRowCount++;
      continue;
    }
    const row = candidate as Record<string, unknown>;
    const assignment = Array.isArray(row.engineer_id) ? row.engineer_id[0] : row.engineer_id;
    let engineerId = '';
    if (typeof assignment === 'string') engineerId = assignment.trim();
    else if (assignment && typeof assignment === 'object') {
      const expandedEngineer = assignment as Record<string, unknown>;
      const value = expandedEngineer.id ?? expandedEngineer.value ?? expandedEngineer._id;
      if (typeof value === 'string' && value.trim()) engineerId = value.trim();
      else invalidAssignmentCount++;
    } else if (assignment != null && assignment !== '') invalidAssignmentCount++;
    if (engineerId === actor) ownRows.push(row);
  }

  const knownStatuses = new Set([
    'pending_acceptance',
    'pending_dispatch',
    'pending_receive',
    'in_progress',
    'completed',
    'closed',
    'rejected',
  ]);
  let unknownStatusCount = 0;
  const completedRows: Record<string, unknown>[] = [];
  for (const row of ownRows) {
    const status = typeof row.status === 'string' ? row.status.trim() : '';
    if (!knownStatuses.has(status)) unknownStatusCount++;
    if (status === 'completed') completedRows.push(row);
  }

  const statusAvailable = invalidRowCount === 0 && invalidAssignmentCount === 0 && unknownStatusCount === 0;
  if (!statusAvailable) {
    return {
      available: false,
      error: unknownStatusCount
        ? '本人服务工单包含未识别状态，个人业绩暂不可用。'
        : '本人服务工单归属信息不完整，个人业绩暂不可用。',
      summary: unavailableSummary,
      rows: [],
      unknownStatusCount,
      customerRanking: unavailableRanking,
    };
  }

  const summary = [
    { id: 'all', label: '本人服务工单', value: ownRows.length },
    { id: 'completed', label: '本人已完工', value: completedRows.length },
  ];
  const completedRowsNewestFirst = completedRows.slice().sort((left, right) => {
    const leftValue = typeof left.completed_at === 'string' ? left.completed_at.trim() : '';
    const rightValue = typeof right.completed_at === 'string' ? right.completed_at.trim() : '';
    const leftTime = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(leftValue) && !Number.isNaN(Date.parse(leftValue)) ? Date.parse(leftValue) : null;
    const rightTime = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(rightValue) && !Number.isNaN(Date.parse(rightValue)) ? Date.parse(rightValue) : null;
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return rightTime - leftTime;
    if (leftTime !== null && rightTime === null) return -1;
    if (leftTime === null && rightTime !== null) return 1;
    const leftCode = typeof left.code === 'string' ? left.code : '';
    const rightCode = typeof right.code === 'string' ? right.code : '';
    if (leftCode !== rightCode) return leftCode < rightCode ? -1 : 1;
    const leftId = typeof left.id === 'string' ? left.id : '';
    const rightId = typeof right.id === 'string' ? right.id : '';
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  if (completedRows.length === 0) {
    return {
      available: true,
      error: '',
      summary,
      rows: completedRowsNewestFirst,
      unknownStatusCount: 0,
      customerRanking: { available: true, error: '', items: [], total: 0, missingNameCount: 0 },
    };
  }
  if (namesComplete !== true) {
    return {
      available: true,
      error: '',
      summary,
      rows: completedRowsNewestFirst,
      unknownStatusCount: 0,
      customerRanking: unavailableRanking,
    };
  }

  const customerCounts = new Map<string, { label: string; value: number }>();
  const missingCustomerIds = new Set<string>();
  let missingCustomerReferenceCount = 0;
  for (const row of completedRows) {
    const customerReference = Array.isArray(row.customer_id) ? row.customer_id[0] : row.customer_id;
    let customerId = '';
    if (typeof customerReference === 'string') customerId = customerReference.trim();
    else if (customerReference && typeof customerReference === 'object') {
      const expandedCustomer = customerReference as Record<string, unknown>;
      const value = expandedCustomer.id ?? expandedCustomer.value ?? expandedCustomer._id;
      if (typeof value === 'string') customerId = value.trim();
    }
    if (!customerId) {
      missingCustomerReferenceCount++;
      continue;
    }

    const customerNamesObject = customerNames && typeof customerNames === 'object' && !Array.isArray(customerNames)
      ? customerNames as Record<string, unknown>
      : null;
    const customerNameValue = customerNames instanceof Map
      ? customerNames.get(customerId)
      : customerNamesObject && Object.prototype.hasOwnProperty.call(customerNamesObject, customerId)
        ? customerNamesObject[customerId]
        : undefined;
    const customerName = typeof customerNameValue === 'string'
      ? customerNameValue.trim()
      : customerNameValue && typeof customerNameValue === 'object' && typeof customerNameValue.name === 'string'
        ? customerNameValue.name.trim()
        : '';
    if (!customerName) {
      missingCustomerIds.add(customerId);
      continue;
    }

    const existing = customerCounts.get(customerId);
    customerCounts.set(customerId, { label: customerName, value: (existing?.value || 0) + 1 });
  }

  const missingNameCount = missingCustomerIds.size + missingCustomerReferenceCount;
  const customerRankingAvailable = missingNameCount === 0;
  const customerItems = customerRankingAvailable
    ? [...customerCounts.entries()]
      .map(([id, item]) => ({ id, label: item.label, value: item.value }))
      .sort((left, right) => right.value - left.value || (left.label < right.label ? -1 : left.label > right.label ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    : [];

  return {
    available: true,
    error: '',
    summary,
    rows: completedRowsNewestFirst,
    unknownStatusCount: 0,
    customerRanking: {
      available: customerRankingAvailable,
      error: customerRankingAvailable ? '' : '客户名称暂不可用，客户排行未完整显示。',
      items: customerItems,
      total: customerRankingAvailable ? customerItems.length : null,
      missingNameCount,
    },
  };
}

/** Runtime source for the self-contained function embedded in the React Page. */
export const servicePersonalPerformanceHelpersSource = servicePersonalPerformanceProjection.toString();
