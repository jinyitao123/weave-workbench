export type ServiceDispatchMode = 'calendar' | 'resource-load' | 'sla';
export type ServiceDispatchFilters = {
  search?: string;
  region?: string;
  serviceType?: string;
  urgency?: string;
  engineerId?: string;
};

export function serviceDispatchDateKey(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    value = `${year}-${month}-${day}`;
  }
  const raw = String(value ?? '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(raw);
  if (!match) return '';
  const date = new Date(match[1] + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === match[1] ? match[1] : '';
}

export function serviceDispatchAddDays(value: string, offset: number): string {
  const dateKey = serviceDispatchDateKey(value);
  if (!dateKey || !Number.isInteger(offset)) return '';
  const date = new Date(dateKey + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function serviceDispatchRange(anchor: string, period: number) {
  const dateKey = serviceDispatchDateKey(anchor);
  const length = [7, 14, 28].includes(period) ? period : 7;
  if (!dateKey) return { start: '', end: '', dates: [] as string[] };
  const day = new Date(dateKey + 'T00:00:00.000Z').getUTCDay();
  const start = serviceDispatchAddDays(dateKey, -((day + 6) % 7));
  const dates = Array.from({ length }, (_, index) => serviceDispatchAddDays(start, index));
  return { start, end: dates[dates.length - 1] || start, dates };
}

export function serviceDispatchWhere(mode: ServiceDispatchMode) {
  if (mode === 'calendar' || mode === 'resource-load') return { status: { $in: ['pending_receive', 'in_progress'] } };
  return { sla_due_at: { $null: false } };
}

export function serviceDispatchReferenceId(value: unknown): string {
  if (Array.isArray(value)) return serviceDispatchReferenceId(value[0]);
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return String(row.id || row.value || row._id || '').trim();
  }
  return String(value ?? '').trim();
}

export function serviceDispatchFilterRows<T extends Record<string, unknown>>(rows: T[], filters: ServiceDispatchFilters): T[] {
  const search = String(filters.search || '').trim().toLocaleLowerCase();
  const region = String(filters.region || '');
  const serviceType = String(filters.serviceType || '');
  const urgency = String(filters.urgency || '');
  const engineerId = String(filters.engineerId || '');
  return rows.filter(row => {
    if (region && String(row.region || '') !== region) return false;
    if (serviceType && String(row.service_type || '') !== serviceType) return false;
    if (urgency && String(row.urgency || '') !== urgency) return false;
    if (engineerId && serviceDispatchReferenceId(row.engineer_id) !== engineerId) return false;
    if (search) {
      const haystack = [row.code, row.name, row.service_object, row.service_type, row.contact_phone, row.region, row.engineer_name]
        .map(value => String(value ?? '').toLocaleLowerCase())
        .join(' ');
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

export function serviceDispatchEngineerOptions(rows: Record<string, unknown>[]) {
  const engineers = new Map<string, { value: string; label: string }>();
  for (const row of rows) {
    const value = serviceDispatchReferenceId(row.engineer_id);
    const label = String(row.engineer_name ?? '').trim();
    if (!value || !label) continue;
    if (!engineers.has(value)) engineers.set(value, { value, label });
  }
  return [...engineers.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function serviceDispatchDateColumns(start: string, period: number, today: string) {
  return serviceDispatchRange(start, period).dates.map(date => {
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(date + 'T00:00:00.000Z').getUTCDay()];
    return {
      key: date,
      label: date.slice(5).replace('-', '/'),
      description: weekday,
      isToday: date === today,
    };
  });
}

export function unwrapServiceDispatchResponse(input: unknown): any {
  let value = input as any;
  for (let depth = 0; depth < 8 && value && typeof value === 'object'; depth++) {
    if (value.result !== undefined) { value = value.result; continue; }
    if (value.data !== undefined && !Array.isArray(value.records)) { value = value.data; continue; }
    break;
  }
  return value;
}

export function serviceDispatchReadIncomplete(rows: Record<string, unknown>[], total: number | null, message: string, reason: string) {
  return { rows, total, complete: false, unavailable: false, error: message, reason };
}

export function serviceDispatchReadUnavailable(message: string, reason: string) {
  return { rows: [] as Record<string, unknown>[], total: null as number | null, complete: false, unavailable: true, error: message, reason };
}

/** Read authorized service records; bounded and complete before any summary uses them. */
export async function readServiceRecordPages(
  request: (path: string, options?: Record<string, unknown>) => Promise<unknown>,
  objectName: string,
  where: Record<string, unknown>,
  pageSize = 200,
  maxRows = 5000,
  label = '服务工单',
) {
  if (!['forge_service_order', 'forge_service_quotation', 'forge_service_part_request', 'forge_service_config_item', 'forge_warranty_card', 'forge_material_sku'].includes(objectName)) return serviceDispatchReadUnavailable('当前服务列表不可读取。', 'invalid-object');
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let skip = 0;


  while (skip < maxRows) {
    const top = Math.min(pageSize, maxRows - skip);
    const params = new URLSearchParams({
      $top: String(top),
      $skip: String(skip),
      $count: 'true',
      $orderby: 'id asc',
      $filter: JSON.stringify(where),
    });
    if (objectName === 'forge_material_sku') params.set('$select', 'id,name,code,material_id,enabled');
    let response: unknown;
    try {
      response = unwrapServiceDispatchResponse(await request('/data/' + objectName + '?' + params.toString()));
    } catch (error) {
      const status = Number((error as { status?: unknown })?.status || 0);
      if (status === 401 || status === 403) return serviceDispatchReadUnavailable('当前账号无权读取' + label + '。', 'forbidden');
      if (!rows.length) return serviceDispatchReadUnavailable(label + '读取失败，请重试。', 'request-failed');
      return serviceDispatchReadIncomplete(rows, total, '数据读取中断，当前结果不完整，请重试。', 'request-failed');
    }

    const payload = unwrapServiceDispatchResponse(response) as Record<string, unknown> | null;
    const batch = Array.isArray(payload?.records)
      ? payload.records as Record<string, unknown>[]
      : Array.isArray((payload?.data as Record<string, unknown> | undefined)?.records)
        ? (payload?.data as Record<string, unknown>).records as Record<string, unknown>[]
        : null;
    if (!payload || !batch) {
      if (!rows.length) return serviceDispatchReadUnavailable(label + '读取失败，请重试。', 'invalid-response');
      return serviceDispatchReadIncomplete(rows, total, '数据读取中断，当前结果不完整，请重试。', 'invalid-response');
    }
    const rawTotal = payload.totalCount ?? payload.count ?? payload.total ?? payload['@odata.count']
      ?? (payload.data as Record<string, unknown> | undefined)?.totalCount
      ?? (payload.data as Record<string, unknown> | undefined)?.count
      ?? (payload.data as Record<string, unknown> | undefined)?.total
      ?? (payload.data as Record<string, unknown> | undefined)?.['@odata.count'];
    if (rawTotal !== undefined && rawTotal !== null && rawTotal !== '') {
      const parsedTotal = Number(rawTotal);
      if (!Number.isSafeInteger(parsedTotal) || parsedTotal < 0) {
        if (!rows.length) return serviceDispatchReadUnavailable(label + '读取失败，请重试。', 'invalid-total');
        return serviceDispatchReadIncomplete(rows, total, '数据读取中断，当前结果不完整，请重试。', 'invalid-total');
      }
      total = parsedTotal;
    }

    for (const row of batch) {
      const id = serviceDispatchReferenceId(row?.id);
      if (!id || seen.has(id)) return serviceDispatchReadIncomplete(rows, total, '工单分页发生变化，当前结果不完整，请刷新重试。', 'duplicate-or-missing-id');
      seen.add(id);
      rows.push(row);
    }
    if (total !== null) {
      if (rows.length === total) return { rows, total, complete: true, unavailable: false, error: '', reason: '' };
      if (rows.length > total) return serviceDispatchReadIncomplete(rows, total, '工单分页发生变化，当前结果不完整，请刷新重试。', 'total-mismatch');
    }
    if (batch.length === 0) {
      if (total === null) return { rows, total: rows.length, complete: true, unavailable: false, error: '', reason: '' };
      return serviceDispatchReadIncomplete(rows, total, '数据读取中断，当前结果不完整，请重试。', 'short-page');
    }
    skip += batch.length;
  }
  return serviceDispatchReadIncomplete(rows, total, '读取上限已达，当前结果不完整；可缩小筛选范围后重试。', 'row-cap');
}

/** Compatibility entry for dispatch and personal service orders. */
export async function readServiceOrderPages(
  request: (path: string, options?: Record<string, unknown>) => Promise<unknown>,
  where: Record<string, unknown>,
  pageSize = 200,
  maxRows = 5000,
  label = '服务工单',
) {
  return readServiceRecordPages(request, 'forge_service_order', where, pageSize, maxRows, label);
}

export async function readServiceDispatchOrders(
  request: (path: string, options?: Record<string, unknown>) => Promise<unknown>,
  mode: ServiceDispatchMode,
  pageSize = 200,
  maxRows = 5000,
) {
  return readServiceOrderPages(request, serviceDispatchWhere(mode), pageSize, maxRows, '派工数据');
}

export function serviceDispatchLoadSummary(rows: Record<string, unknown>[], start: string, end: string) {
  const active = rows.filter(row => ['pending_receive', 'in_progress'].includes(String(row.status || '')));
  const resources = new Map<string, { id: string; label: string; description?: string; rows: Record<string, unknown>[]; latestDispatch: number }>();
  let unassignedCount = 0;
  let unidentifiedNameCount = 0;
  let unplannedCount = 0;
  let unknownDateCount = 0;
  let scheduledCount = 0;
  let urgentScheduledCount = 0;
  const unplannedRows: Record<string, unknown>[] = [];
  const unknownDateRows: Record<string, unknown>[] = [];
  const unassignedRows: Record<string, unknown>[] = [];
  const unidentifiedNameRows: Record<string, unknown>[] = [];
  const events: Array<Record<string, unknown>> = [];

  for (const row of active) {
    const engineerId = serviceDispatchReferenceId(row.engineer_id);
    const rawSchedule = String(row.scheduled_at ?? '').trim();
    const dateKey = serviceDispatchDateKey(rawSchedule);
    if (!engineerId) {
      unassignedCount++;
      unassignedRows.push(row);
      continue;
    }
    if (!rawSchedule) {
      unplannedCount++;
      unplannedRows.push(row);
    } else if (!dateKey) {
      unknownDateCount++;
      unknownDateRows.push(row);
    }

    const label = String(row.engineer_name ?? '').trim();
    if (!label) {
      unidentifiedNameCount++;
      unidentifiedNameRows.push(row);
    }
    const resourceLabel = label || '姓名不可用';
    const dispatchedAt = Date.parse(String(row.dispatched_at || ''));
    const current = resources.get(engineerId);
    if (!current) resources.set(engineerId, { id: engineerId, label: resourceLabel, rows: [row], latestDispatch: Number.isFinite(dispatchedAt) ? dispatchedAt : Number.NEGATIVE_INFINITY });
    else {
      current.rows.push(row);
      if (label && Number.isFinite(dispatchedAt) && dispatchedAt > current.latestDispatch) {
        current.label = resourceLabel;
        current.latestDispatch = dispatchedAt;
      }
    }
    if (dateKey && dateKey >= start && dateKey <= end) {
      scheduledCount++;
      if (row.urgency === 'urgent') urgentScheduledCount++;
      events.push({
        id: serviceDispatchReferenceId(row.id),
        resourceId: engineerId,
        dateKey,
        title: String(row.code || row.name || '服务工单'),
        subtitle: [String(row.name || ''), row.status === 'pending_receive' ? '待接单' : row.status === 'in_progress' ? '服务中' : '状态不可用'].filter(Boolean).join(' · '),
      });
    }
  }

  const loads = [...resources.values()].map(resource => {
    const planned = resource.rows.filter(row => {
      const dateKey = serviceDispatchDateKey(row.scheduled_at);
      return dateKey && dateKey >= start && dateKey <= end;
    });
    const urgent = planned.filter(row => row.urgency === 'urgent').length;
    const unplanned = resource.rows.filter(row => !String(row.scheduled_at ?? '').trim()).length;
    return {
      id: resource.id,
      label: resource.label,
      activeCount: resource.rows.length,
      scheduledCount: planned.length,
      urgentCount: urgent,
      unplannedCount: unplanned,
      description: [planned.length + ' 项排程', urgent ? '紧急 ' + urgent : '', unplanned ? '未排期 ' + unplanned : ''].filter(Boolean).join(' · '),
    };
  }).sort((left, right) => left.label.localeCompare(right.label));
  const resourceRows = loads.map(resource => ({ id: resource.id, label: resource.label, description: resource.description }));

  return { resources: resourceRows, loads, events, scheduledCount, urgentScheduledCount, unplannedCount, unknownDateCount, unassignedCount, unidentifiedNameCount, unplannedRows, unknownDateRows, unassignedRows, unidentifiedNameRows };
}

export function serviceDispatchSlaRows(rows: Record<string, unknown>[], start: string, end: string) {
  const rowsWithDueDate: Record<string, unknown>[] = [];
  const unknownRows: Record<string, unknown>[] = [];
  let unknownDateCount = 0;
  for (const row of rows) {
    const rawDue = String(row.sla_due_at ?? '').trim();
    if (!rawDue) continue;
    const dateKey = serviceDispatchDateKey(rawDue);
    if (!dateKey) {
      unknownDateCount++;
      unknownRows.push(row);
      continue;
    }
    if (dateKey >= start && dateKey <= end) rowsWithDueDate.push(row);
  }
  return { rows: rowsWithDueDate, unknownRows, unknownDateCount };
}

export const serviceDispatchPanelHelpersSource = [
  serviceDispatchDateKey,
  serviceDispatchAddDays,
  serviceDispatchRange,
  serviceDispatchWhere,
  serviceDispatchReferenceId,
  serviceDispatchFilterRows,
  serviceDispatchEngineerOptions,
  serviceDispatchDateColumns,
  unwrapServiceDispatchResponse,
  serviceDispatchReadIncomplete,
  serviceDispatchReadUnavailable,
  readServiceRecordPages,
  readServiceOrderPages,
  readServiceDispatchOrders,
  serviceDispatchLoadSummary,
  serviceDispatchSlaRows,
].map(helper => helper.toString()).join('\n');
