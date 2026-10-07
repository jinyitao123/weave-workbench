export type ServicePersonalWorkspaceFilters = {
  status?: string;
  serviceType?: string;
  urgency?: string;
  region?: string;
};

export function servicePersonalDateKey(value: unknown): string {
  const raw = String(value ?? '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(raw);
  if (!match) return '';
  const date = new Date(match[1] + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === match[1] ? match[1] : '';
}

export function servicePersonalAddDays(value: string, offset: number): string {
  const dateKey = servicePersonalDateKey(value);
  if (!dateKey || !Number.isInteger(offset)) return '';
  const date = new Date(dateKey + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function servicePersonalDateRange(
  businessDate: string,
  preset: string,
  customFrom = '',
  customTo = '',
) {
  if (preset === 'all') return { from: '', to: '', valid: true, error: '' };
  if (preset === 'custom') {
    const from = servicePersonalDateKey(customFrom);
    const to = servicePersonalDateKey(customTo);
    if (!from || !to) return { from, to, valid: false, error: '请选择完整的计划日期范围。' };
    if (from > to) return { from, to, valid: false, error: '开始日期不能晚于结束日期。' };
    return { from, to, valid: true, error: '' };
  }
  const today = servicePersonalDateKey(businessDate);
  if (!today) return { from: '', to: '', valid: false, error: '组织业务日期不可用，暂不能按计划日期筛选。' };
  if (preset === 'month') {
    const last = new Date(today.slice(0, 7) + '-01T00:00:00.000Z');
    last.setUTCMonth(last.getUTCMonth() + 1);
    last.setUTCDate(0);
    return { from: today.slice(0, 7) + '-01', to: last.toISOString().slice(0, 10), valid: true, error: '' };
  }
  if (preset === 'previous_month') {
    const first = new Date(today + 'T00:00:00.000Z');
    first.setUTCDate(1);
    first.setUTCMonth(first.getUTCMonth() - 1);
    const from = first.toISOString().slice(0, 10);
    const last = new Date(today + 'T00:00:00.000Z');
    last.setUTCDate(0);
    return { from, to: last.toISOString().slice(0, 10), valid: true, error: '' };
  }
  if (preset === 'year') return { from: today.slice(0, 4) + '-01-01', to: today.slice(0, 4) + '-12-31', valid: true, error: '' };
  const days = Number(preset);
  if (![7, 30, 90].includes(days)) return { from: '', to: '', valid: false, error: '计划日期范围无效，请重新选择。' };
  return { from: servicePersonalAddDays(today, 1 - days), to: today, valid: true, error: '' };
}

export function servicePersonalListFilters(
  userId: string,
  filters: ServicePersonalWorkspaceFilters,
  range: { from: string; to: string; valid: boolean },
) {
  const actor = String(userId || '').trim();
  if (!actor || !range.valid) return null;
  const clauses: unknown[] = [['engineer_id', '=', actor]];
  const status = String(filters.status || 'all');
  if (status !== 'all') clauses.push(['status', '=', status]);
  if (range.from && range.to) clauses.push(['scheduled_at', 'between', [range.from, range.to]]);
  const serviceType = String(filters.serviceType || '').trim();
  const urgency = String(filters.urgency || '').trim();
  const region = String(filters.region || '').trim();
  if (serviceType) clauses.push(['service_type', 'contains', serviceType]);
  if (urgency) clauses.push(['urgency', '=', urgency]);
  if (region) clauses.push(['region', 'contains', region]);
  return clauses.length === 1 ? clauses[0] : ['and', ...clauses];
}

export function servicePersonalReferenceId(value: unknown): string {
  if (Array.isArray(value)) return servicePersonalReferenceId(value[0]);
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return String(row.id || row.value || row._id || '').trim();
  }
  return String(value ?? '').trim();
}

export function servicePersonalActorRows(rows: Record<string, unknown>[], userId: string) {
  const actor = String(userId || '').trim();
  if (!actor) return [];
  return rows.filter(row => servicePersonalReferenceId(row.engineer_id) === actor);
}

/** Derive personal document scope from the current assignments, never owner snapshots. */
export function servicePersonalRelatedListScope(
  userId: string,
  state: {
    loading?: boolean;
    complete?: boolean;
    unavailable?: boolean;
    error?: string;
    rows?: Record<string, unknown>[];
  },
) {
  const unavailable = { status: 'unavailable', filter: null, error: '当前账号标识不可用，无法读取本人单据。' };
  const actor = String(userId || '').trim();
  if (!actor) return unavailable;
  if (state.loading) return { status: 'loading', filter: null, error: '' };
  if (!state.complete || state.unavailable || !Array.isArray(state.rows)) {
    return { ...unavailable, error: state.error || '个人工单范围读取不完整，请重试。' };
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of servicePersonalActorRows(state.rows, actor)) {
    const id = servicePersonalReferenceId(row.id);
    if (!id) return { ...unavailable, error: '个人工单范围读取不完整，请重试。' };
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  const filter = ['service_order_id', 'in', ids];
  // ListView uses a GET query. Refuse an oversized predicate rather than
  // dropping its personal scope or relying on a truncated URL.
  if (encodeURIComponent(JSON.stringify(filter)).length > 6000) {
    return { ...unavailable, error: '本人关联工单较多，暂无法载入单据列表。' };
  }
  return { status: 'ready', filter, error: '' };
}

export function servicePersonalTodayProjection(rows: Record<string, unknown>[], businessDate: string, timezone?: string) {
  const businessDateValue = typeof businessDate === 'string' ? businessDate.trim() : '';
  const businessDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDateValue);
  let today = '';
  if (businessDateMatch) {
    const year = Number(businessDateMatch[1]);
    const month = Number(businessDateMatch[2]);
    const day = Number(businessDateMatch[3]);
    const checkDate = new Date(0);
    checkDate.setUTCFullYear(year, month - 1, day);
    checkDate.setUTCHours(0, 0, 0, 0);
    if (checkDate.getUTCFullYear() === year && checkDate.getUTCMonth() === month - 1 && checkDate.getUTCDate() === day) today = businessDateValue;
  }
  let tomorrow = '';
  if (today) {
    const tomorrowDate = new Date(today + 'T00:00:00.000Z');
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
    tomorrow = tomorrowDate.toISOString().slice(0, 10);
  }
  const sourceRows = Array.isArray(rows) ? rows : [];
  const validStatuses = new Set(['pending_acceptance', 'pending_dispatch', 'pending_receive', 'in_progress', 'completed', 'closed', 'rejected']);
  const unknownStatusRows = sourceRows.filter(row => !row || typeof row !== 'object' || Array.isArray(row)
    || !validStatuses.has(String(row.status || '')));
  const statusDataAvailable = Array.isArray(rows) && unknownStatusRows.length === 0;
  const activeRows = sourceRows.filter(row => row && typeof row === 'object' && !Array.isArray(row)
    && ['pending_receive', 'in_progress'].includes(String(row.status || '')));
  const scheduledRows = sourceRows.filter(row => row && typeof row === 'object' && !Array.isArray(row)
    && ['pending_receive', 'in_progress', 'completed'].includes(String(row.status || '')));
  const scheduledDates = new Map<Record<string, unknown>, { raw: string; dateKey: string }>();
  for (const row of scheduledRows) {
    const raw = String(row.scheduled_at ?? '').trim();
    const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(raw);
    let dateKey = '';
    if (match) {
      const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(match[1]);
      if (dateParts) {
        const year = Number(dateParts[1]);
        const month = Number(dateParts[2]);
        const day = Number(dateParts[3]);
        const checkDate = new Date(0);
        checkDate.setUTCFullYear(year, month - 1, day);
        checkDate.setUTCHours(0, 0, 0, 0);
        if (checkDate.getUTCFullYear() === year && checkDate.getUTCMonth() === month - 1 && checkDate.getUTCDate() === day) dateKey = match[1];
      }
    }
    scheduledDates.set(row, { raw, dateKey });
  }
  const todayRows: Record<string, unknown>[] = [];
  const tomorrowRows: Record<string, unknown>[] = [];
  const urgentRows: Record<string, unknown>[] = [];
  const unplannedRows: Record<string, unknown>[] = [];
  const unclearDateRows: Record<string, unknown>[] = [];
  for (const row of activeRows) {
    const scheduled = scheduledDates.get(row) || { raw: '', dateKey: '' };
    const { raw, dateKey } = scheduled;
    if (tomorrow && dateKey === tomorrow) tomorrowRows.push(row);
    if (row.urgency === 'urgent') urgentRows.push(row);
    if (!raw) unplannedRows.push(row);
    if (raw && !dateKey) unclearDateRows.push(row);
  }
  const unclearScheduledRows = scheduledRows.filter(row => {
    const scheduled = scheduledDates.get(row);
    return Boolean(scheduled?.raw && !scheduled.dateKey);
  });
  const todayPlanDateIncomplete = unclearScheduledRows.length > 0;
  if (today) for (const row of scheduledRows) if (scheduledDates.get(row)?.dateKey === today) todayRows.push(row);

  const zone = typeof timezone === 'string' ? timezone.trim() : '';
  let formatter: Intl.DateTimeFormat | null = null;
  if (zone) {
    try {
      formatter = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      });
      formatter.format(new Date(0));
    } catch {
      formatter = null;
    }
  }
  let completionDataAvailable = Boolean(today && formatter && statusDataAvailable);
  let completionUnavailableReason = !today ? '组织业务日期不可用' : !formatter ? '组织时区不可用' : !statusDataAvailable ? '工单状态不可用' : '完工时间不完整';
  let todayCompleted = 0;
  let monthCompleted = 0;
  if (completionDataAvailable) {
    for (const row of sourceRows) {
      if (row.status !== 'completed') continue;
      const raw = typeof row.completed_at === 'string' ? row.completed_at.trim() : '';
      const timestampMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(raw);
      if (!timestampMatch) {
        completionDataAvailable = false;
        completionUnavailableReason = '完工时间不完整';
        break;
      }
      const year = Number(timestampMatch[1]);
      const month = Number(timestampMatch[2]);
      const day = Number(timestampMatch[3]);
      const hour = Number(timestampMatch[4]);
      const minute = Number(timestampMatch[5]);
      const second = timestampMatch[6] ? Number(timestampMatch[6]) : 0;
      const dateCheck = new Date(0);
      dateCheck.setUTCFullYear(year, month - 1, day);
      dateCheck.setUTCHours(0, 0, 0, 0);
      if (dateCheck.getUTCFullYear() !== year || dateCheck.getUTCMonth() !== month - 1 || dateCheck.getUTCDate() !== day
        || hour > 23 || minute > 59 || second > 59) {
        completionDataAvailable = false;
        completionUnavailableReason = '完工时间不完整';
        break;
      }
      const offset = timestampMatch[8];
      if (offset !== 'Z') {
        const offsetMatch = /^[+-](\d{2}):(\d{2})$/.exec(offset);
        if (!offsetMatch || Number(offsetMatch[1]) > 23 || Number(offsetMatch[2]) > 59) {
          completionDataAvailable = false;
          completionUnavailableReason = '完工时间不完整';
          break;
        }
      }
      const instant = Date.parse(raw);
      if (!Number.isFinite(instant) || !formatter) {
        completionDataAvailable = false;
        completionUnavailableReason = '完工时间不完整';
        break;
      }
      let zonedYear = '';
      let zonedMonth = '';
      let zonedDay = '';
      for (const part of formatter.formatToParts(new Date(instant))) {
        if (part.type === 'year') zonedYear = part.value;
        if (part.type === 'month') zonedMonth = part.value;
        if (part.type === 'day') zonedDay = part.value;
      }
      const localDate = zonedYear + '-' + zonedMonth + '-' + zonedDay;
      if (localDate === today) todayCompleted++;
      if (localDate.slice(0, 7) === today.slice(0, 7)) monthCompleted++;
    }
  }
  const todayPlanUnavailableReason = !today ? '组织业务日期不可用'
    : !statusDataAvailable ? '工单状态不可用'
      : todayPlanDateIncomplete ? '计划日期不完整'
        : '';

  return {
    today,
    tomorrow,
    dateAvailable: Boolean(today),
    statusDataAvailable,
    unknownStatusRows,
    summary: [
      { id: 'today-plan', label: '今日计划上门', value: todayPlanUnavailableReason ? '—' : todayRows.length, description: todayPlanUnavailableReason || '今日排程的工单数' },
      { id: 'pending-receive', label: '待接单', value: statusDataAvailable ? sourceRows.filter(row => row && typeof row === 'object' && !Array.isArray(row) && row.status === 'pending_receive').length : '—', description: statusDataAvailable ? '本人待接单' : '工单状态不可用' },
      { id: 'in-progress', label: '进行中', value: statusDataAvailable ? sourceRows.filter(row => row && typeof row === 'object' && !Array.isArray(row) && row.status === 'in_progress').length : '—', description: statusDataAvailable ? '本人服务中' : '工单状态不可用' },
      { id: 'today-completed', label: '今日已完工', value: completionDataAvailable ? todayCompleted : '—', description: completionDataAvailable ? '本月已完工 ' + monthCompleted + ' 单' : completionUnavailableReason },
      { id: 'overdue', label: '超时工单', value: '—', description: 'SLA判定暂不可用' },
    ],
    todayRows,
    tomorrowRows,
    urgentRows,
    unplannedRows,
    unclearDateRows,
    unclearScheduledRows,
  };
}

export const servicePersonalWorkspacePanelHelpersSource = [
  servicePersonalDateKey,
  servicePersonalAddDays,
  servicePersonalDateRange,
  servicePersonalListFilters,
  servicePersonalReferenceId,
  servicePersonalActorRows,
  servicePersonalRelatedListScope,
  servicePersonalTodayProjection,
].map(helper => helper.toString()).join('\n');
