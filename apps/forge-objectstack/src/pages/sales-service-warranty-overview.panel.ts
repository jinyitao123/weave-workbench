/** Pure projection over a completely authorized warranty-card read. */
export function serviceWarrantyOverviewProjection(rows: unknown, businessDate: unknown) {
  const states = [
    { id: 'active', label: '生效中' },
    { id: 'pending_activation', label: '待激活' },
    { id: 'grace_period', label: '宽限期' },
    { id: 'expired', label: '已过保' },
    { id: 'terminated', label: '已终止' },
  ] as const;
  const counts = { active: 0, pending_activation: 0, grace_period: 0, expired: 0, terminated: 0 };
  const sourceCounts = { service_order: 0, sales_order: 0, both: 0, unavailable: 0 };
  const scopes = new Map<string, number>();
  const responsibleParties = new Map<string, number>();
  const records = Array.isArray(rows) ? rows : [];
  let unknownStates = 0;
  let invalidRecordCount = 0;
  let invalidEndDateCount = 0;

  const datedRows: Array<{ row: Record<string, unknown>; date: string; index: number }> = [];
  let undatedCount = 0;
  for (const row of records) {
    const card = row && typeof row === 'object' && !Array.isArray(row) ? row as Record<string, unknown> : {};
    if (card !== row) invalidRecordCount++;
    const status = typeof card.status === 'string' ? card.status.trim() : '';
    if (status === 'active') counts.active++;
    else if (status === 'pending_activation') counts.pending_activation++;
    else if (status === 'grace_period') counts.grace_period++;
    else if (status === 'expired') counts.expired++;
    else if (status === 'terminated') counts.terminated++;
    else unknownStates++;

    const serviceOrderReference = card.service_order_id;
    const salesOrderReference = card.sales_order_id;
    const serviceOrderRecord = serviceOrderReference && typeof serviceOrderReference === 'object' && !Array.isArray(serviceOrderReference)
      ? serviceOrderReference as Record<string, unknown>
      : {};
    const salesOrderRecord = salesOrderReference && typeof salesOrderReference === 'object' && !Array.isArray(salesOrderReference)
      ? salesOrderReference as Record<string, unknown>
      : {};
    const fromServiceOrder = (typeof serviceOrderReference === 'string' && serviceOrderReference.trim() !== '')
      || (Array.isArray(serviceOrderReference) && serviceOrderReference.some(value => typeof value === 'string' && value.trim() !== '' || value && typeof value === 'object' && ['id', 'value', '_id'].some(key => typeof (value as Record<string, unknown>)[key] === 'string' && ((value as Record<string, unknown>)[key] as string).trim() !== '')))
      || ['id', 'value', '_id'].some(key => typeof serviceOrderRecord[key] === 'string' && (serviceOrderRecord[key] as string).trim() !== '');
    const fromSalesOrder = (typeof salesOrderReference === 'string' && salesOrderReference.trim() !== '')
      || (Array.isArray(salesOrderReference) && salesOrderReference.some(value => typeof value === 'string' && value.trim() !== '' || value && typeof value === 'object' && ['id', 'value', '_id'].some(key => typeof (value as Record<string, unknown>)[key] === 'string' && ((value as Record<string, unknown>)[key] as string).trim() !== '')))
      || ['id', 'value', '_id'].some(key => typeof salesOrderRecord[key] === 'string' && (salesOrderRecord[key] as string).trim() !== '');
    const relation = fromServiceOrder && fromSalesOrder
      ? 'both'
      : fromServiceOrder
        ? 'service_order'
        : fromSalesOrder
          ? 'sales_order'
          : 'unavailable';
    sourceCounts[relation]++;
    const scopeLabel = typeof card.scope === 'string' && card.scope.trim() ? card.scope : (card.scope == null || card.scope === '' ? '未填写' : '值不可用');
    const responsibleLabel = typeof card.responsible_party === 'string' && card.responsible_party.trim() ? card.responsible_party : (card.responsible_party == null || card.responsible_party === '' ? '未填写' : '值不可用');
    scopes.set(scopeLabel, (scopes.get(scopeLabel) || 0) + 1);
    responsibleParties.set(responsibleLabel, (responsibleParties.get(responsibleLabel) || 0) + 1);

    const endDate = card.ends_on;
    if (endDate == null || typeof endDate === 'string' && endDate.trim() === '') {
      undatedCount++;
      continue;
    }
    const parsedEndDate = typeof endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? new Date(endDate + 'T00:00:00.000Z') : null;
    if (parsedEndDate && !Number.isNaN(parsedEndDate.getTime()) && parsedEndDate.toISOString().slice(0, 10) === endDate) datedRows.push({ row: card, date: endDate, index: datedRows.length });
    else invalidEndDateCount++;
  }

  const statusesAvailable = Array.isArray(rows) && unknownStates === 0 && invalidRecordCount === 0;
  const parsedBusinessDate = typeof businessDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(businessDate) ? new Date(businessDate + 'T00:00:00.000Z') : null;
  const businessDateAvailable = Boolean(parsedBusinessDate && !Number.isNaN(parsedBusinessDate.getTime()) && parsedBusinessDate.toISOString().slice(0, 10) === businessDate);
  const rowsAvailable = Array.isArray(rows) && invalidRecordCount === 0 && invalidEndDateCount === 0;
  const sortedDatedRows = rowsAvailable
    ? datedRows.sort((left, right) => left.date < right.date ? -1 : left.date > right.date ? 1 : left.index - right.index)
    : [];
  const nearestTotal = rowsAvailable ? sortedDatedRows.length : null;
  const scopeGroups = [...scopes.entries()]
    .sort(([leftLabel, leftCount], [rightLabel, rightCount]) => rightCount - leftCount || (leftLabel < rightLabel ? -1 : leftLabel > rightLabel ? 1 : 0))
    .map(([label, value], index) => ({ id: `scope-${index}`, label, value }));
  const responsibleGroups = [...responsibleParties.entries()]
    .sort(([leftLabel, leftCount], [rightLabel, rightCount]) => rightCount - leftCount || (leftLabel < rightLabel ? -1 : leftLabel > rightLabel ? 1 : 0))
    .map(([label, value], index) => ({ id: `responsible-${index}`, label, value }));
  const sourceGroups = [
    { id: 'service_order', label: '服务工单', value: sourceCounts.service_order },
    { id: 'sales_order', label: '销售订单', value: sourceCounts.sales_order },
    { id: 'both', label: '服务工单与销售订单', value: sourceCounts.both },
    { id: 'unavailable', label: '无来源（不可用）', value: sourceCounts.unavailable },
  ]
    .filter(item => item.value > 0)
    .sort((left, right) => right.value - left.value || (left.label < right.label ? -1 : left.label > right.label ? 1 : 0));

  return {
    available: statusesAvailable,
    error: !Array.isArray(rows)
      ? '质保卡读取结果不可用，暂不能统计。'
      : unknownStates || invalidRecordCount
        ? '存在未识别或不完整的质保卡状态，五项状态统计暂不可用。'
        : '',
    summary: states.map(state => ({
      id: state.id,
      label: state.label,
      value: statusesAvailable ? counts[state.id] : null,
    })),
    unknownStatusCount: unknownStates,
    distributions: {
      source: sourceGroups,
      scope: scopeGroups,
      responsible: responsibleGroups,
    },
    expiry: {
      available: false,
      error: '到期预警暂不可用。',
      windows: [30, 60, 90].map(days => ({
        id: String(days),
        label: `${days} 天内到期`,
        value: null,
        available: false,
      })),
      businessDateAvailable,
      businessDateError: businessDateAvailable ? '' : '到期预警暂不可用。',
      rowsAvailable,
      rowsError: !Array.isArray(rows)
        ? '质保卡读取结果不可用，暂不能展示到期日期台账。'
        : invalidRecordCount || invalidEndDateCount
          ? '存在缺失或无效的质保到期日期，暂不能确认完整的到期日期台账。'
          : '',
      rows: rowsAvailable ? sortedDatedRows.slice(0, 10).map(item => item.row) : [],
      total: nearestTotal,
      undatedCount,
    },
  };
}

/** Runtime source for the self-contained function embedded in the React Page. */
export const serviceWarrantyOverviewHelpersSource = serviceWarrantyOverviewProjection.toString();
export const serviceWarrantyOverviewProjectionSource = serviceWarrantyOverviewHelpersSource;
