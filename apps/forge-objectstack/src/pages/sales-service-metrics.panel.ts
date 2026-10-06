/** Host-owned counts. The shared summary renders these values without queries. */
export function servicePersonalMetricProjection(
  kind: string,
  rows: Record<string, unknown>[],
  actor: string,
  orderRows: Record<string, unknown>[],
) {
  if (!actor || !Array.isArray(rows)) return { available: false, items: [], error: '个人统计暂不可用。' };
  const ownRows: Record<string, unknown>[] = [];
  if (kind === 'quotations') {
    const ids = new Set<string>();
    for (const order of orderRows) {
      if (servicePersonalMetricReferenceId(order.engineer_id) === actor) ids.add(servicePersonalMetricReferenceId(order.id));
    }
    for (const row of rows) {
      const reference = servicePersonalMetricReferenceId(row.service_order_id);
      if (!reference) return { available: false, items: [], error: '统计关联数据不完整，请刷新重试。' };
      if (ids.has(reference)) ownRows.push(row);
    }
  } else if (kind === 'parts') {
    for (const row of rows) {
      const reference = servicePersonalMetricReferenceId(row.requested_by);
      if (!reference) return { available: false, items: [], error: '统计申请人数据不完整，请刷新重试。' };
      if (reference === actor) ownRows.push(row);
    }
  } else return { available: false, items: [], error: '个人统计暂不可用。' };

  const counts: Record<string, number> = {};
  const allowed = kind === 'quotations'
    ? ['draft', 'pending_confirmation', 'confirmed', 'settlement_created', 'cancelled']
    : ['open', 'completed', 'cancelled'];
  for (const row of ownRows) {
    const status = String(row.status ?? '');
    if (!allowed.includes(status)) return { available: false, items: [], error: '统计状态数据不完整，请刷新重试。' };
    counts[status] = (counts[status] || 0) + 1;
  }
  const items = kind === 'quotations' ? [
    { id: 'all', label: '累计报价单', value: ownRows.length, disabled: false },
    { id: 'draft', label: '草稿', value: counts.draft || 0, disabled: false },
    { id: 'pending_confirmation', label: '待客户确认', value: counts.pending_confirmation || 0, disabled: false },
    { id: 'confirmed', label: '客户已接受', value: counts.confirmed || 0, disabled: false },
    // A converted quotation is not an executing quotation. No source state
    // presently supplies this metric; never rename a different state as it.
    { id: 'executing', label: '执行中', value: null, disabled: true },
    // An empty authorized set sums to zero under every eligibility rule. For
    // populated sets the reference's eligibility rule remains unverified.
    { id: 'valid_amount', label: '有效报价金额', value: ownRows.length ? null : 0, disabled: true },
  ] : [
    { id: 'all', label: '累计申请', value: ownRows.length, disabled: false },
    { id: 'open', label: '待办理', value: counts.open || 0, disabled: false },
    { id: 'completed', label: '已完成', value: counts.completed || 0, disabled: false },
    { id: 'cancelled', label: '已取消', value: counts.cancelled || 0, disabled: false },
  ];
  return { available: true, items, error: '' };
}

export function servicePersonalMetricReferenceId(value: unknown): string {
  if (Array.isArray(value)) return servicePersonalMetricReferenceId(value[0]);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return String(record.id || record.value || record._id || '').trim();
  }
  return String(value ?? '').trim();
}

/** Counts for navigation cards, using the same complete personal scope as the lists. */
export function servicePersonalSidebarMetric(
  kind: string,
  rows: Record<string, unknown>[],
  actor: string,
  orderRows: Record<string, unknown>[],
) {
  const projected = servicePersonalMetricProjection(kind, rows, actor, orderRows);
  if (!projected.available) return { available: false, value: null, description: '统计暂不可用', error: projected.error };
  if (kind === 'parts') {
    const count = projected.items.find(item => item.id === 'open')?.value;
    if (typeof count !== 'number') return { available: false, value: null, description: '统计暂不可用', error: '个人备件统计不完整。' };
    return { available: true, value: count, description: count ? '待办理申请' : '无进行中的备件申请', error: '' };
  }
  // The reference's pending-quotation eligibility rule has not been observed
  // with records. An authorized empty set proves zero for every such rule;
  // populated data must not be relabeled as an invented draft/status union.
  const total = projected.items.find(item => item.id === 'all')?.value;
  return total === 0
    ? { available: true, value: 0, description: '无待处理报价', error: '' }
    : { available: false, value: null, description: '待处理统计口径暂不可用', error: '' };
}

export const servicePersonalMetricsHelpersSource = [
  servicePersonalMetricReferenceId,
  servicePersonalMetricProjection,
  servicePersonalSidebarMetric,
].map(helper => helper.toString()).join('\n');
