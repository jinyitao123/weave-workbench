/** Normalize the service-order customer/engineer refs without accepting names as identifiers. */
export function servicePerformanceCustomerReferenceId(value: unknown): string {
  if (Array.isArray(value)) return value.length === 1 ? servicePerformanceCustomerReferenceId(value[0]) : '';
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const reference = value as Record<string, unknown>;
    for (const key of ['id', 'value', '_id']) {
      if (typeof reference[key] === 'string' && reference[key].trim()) return reference[key].trim();
    }
  }
  return '';
}

export function servicePerformanceCustomersUnavailable(error: string, missingCount = 0) {
  return {
    available: false,
    names: {} as Record<string, string>,
    error,
    missingCount,
  };
}

export function servicePerformanceCustomerReadFailure(status: number) {
  if (status === 401) return '登录状态已失效，客户排行暂不可用。';
  if (status === 403) return '当前账号无权读取部分关联客户，客户排行暂不可用。';
  if (status === 404) return '部分关联客户不可读取，客户排行暂不可用。';
  return '客户名称读取失败，客户排行暂不可用。';
}

/** Read only customers linked to this actor's complete, finished service orders. */
export async function readServicePerformanceCustomerNames(
  request: (path: string) => Promise<unknown>,
  rows: Record<string, unknown>[],
  userId: string,
) {
  const actor = String(userId || '').trim();
  if (!actor) return servicePerformanceCustomersUnavailable('当前账号标识不可用，无法读取客户名称。');
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    return servicePerformanceCustomersUnavailable('本人完工工单范围不可用，无法读取客户名称。');
  }

  const customerIds: string[] = [];
  const requested = new Set<string>();
  let rowsMissingCustomer = 0;
  for (const row of rows) {
    if (String(row.status || '') !== 'completed') continue;
    if (servicePerformanceCustomerReferenceId(row.engineer_id) !== actor) continue;
    const customerId = servicePerformanceCustomerReferenceId(row.customer_id);
    if (!customerId) {
      rowsMissingCustomer++;
      continue;
    }
    if (!requested.has(customerId)) {
      requested.add(customerId);
      customerIds.push(customerId);
    }
  }
  if (rowsMissingCustomer > 0) {
    return servicePerformanceCustomersUnavailable('部分本人完工工单缺少客户关联，客户排行暂不可用。', rowsMissingCustomer);
  }
  if (customerIds.length === 0) {
    return { available: true, names: {} as Record<string, string>, error: '', missingCount: 0 };
  }
  const pageSize = 50;
  const maxIds = 5000;
  const maxUrlLength = 6000;
  if (customerIds.length > maxIds) {
    return servicePerformanceCustomersUnavailable('客户范围超过可读取上限，客户排行暂不可用。', customerIds.length);
  }

  const names = new Map<string, string>();
  const incomplete = '客户名称读取不完整，客户排行暂不可用。';

  for (let offset = 0; offset < customerIds.length; offset += pageSize) {
    const batchIds = customerIds.slice(offset, offset + pageSize);
    const batchRequested = new Set(batchIds);
    const seen = new Set<string>();
    let total: number | null = null;
    let skip = 0;

    while (skip <= batchIds.length) {
      const params = new URLSearchParams({
        $top: String(pageSize),
        $skip: String(skip),
        $count: 'true',
        $orderby: 'id asc',
        $select: 'id,name',
      });
      params.set('$filter', JSON.stringify({ id: { $in: batchIds } }));
      const path = '/data/forge_customer?' + params.toString();
      if (path.length > maxUrlLength) {
        return servicePerformanceCustomersUnavailable('客户范围请求过长，客户排行暂不可用。', customerIds.length);
      }

      let payload: Record<string, unknown> | null = null;
      try {
        let response: unknown = await request(path);
        for (let depth = 0; depth < 8 && response && typeof response === 'object'; depth++) {
          const envelope = response as Record<string, unknown>;
          if (envelope.result !== undefined) {
            response = envelope.result;
            continue;
          }
          if (envelope.data !== undefined && !Array.isArray(envelope.records)) {
            response = envelope.data;
            continue;
          }
          break;
        }
        payload = response && typeof response === 'object'
          ? response as Record<string, unknown>
          : null;
      } catch (error) {
        const status = Number((error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } })?.status
          || (error as { statusCode?: unknown })?.statusCode
          || (error as { response?: { status?: unknown } })?.response?.status
          || 0);
        return servicePerformanceCustomersUnavailable(servicePerformanceCustomerReadFailure(status), customerIds.length);
      }

      const nested = payload?.data && typeof payload.data === 'object'
        ? payload.data as Record<string, unknown>
        : null;
      const batch = Array.isArray(payload?.records)
        ? payload.records as Record<string, unknown>[]
        : Array.isArray(nested?.records)
          ? nested.records as Record<string, unknown>[]
          : null;
      if (!payload || !batch) return servicePerformanceCustomersUnavailable(incomplete, customerIds.length);

      const rawTotal = payload.totalCount ?? payload.count ?? payload.total ?? payload['@odata.count']
        ?? nested?.totalCount ?? nested?.count ?? nested?.total ?? nested?.['@odata.count'];
      if (rawTotal !== undefined && rawTotal !== null && rawTotal !== '') {
        const parsedTotal = Number(rawTotal);
        if (!Number.isSafeInteger(parsedTotal) || parsedTotal < 0 || parsedTotal > batchIds.length) {
          return servicePerformanceCustomersUnavailable(incomplete, customerIds.length);
        }
        total = parsedTotal;
      }

      for (const row of batch) {
        const id = servicePerformanceCustomerReferenceId(row?.id);
        if (!id || !batchRequested.has(id) || seen.has(id)) {
          return servicePerformanceCustomersUnavailable(incomplete, customerIds.length);
        }
        seen.add(id);
        const name = typeof row.name === 'string' ? row.name.trim() : '';
        if (name) names.set(id, name);
      }
      if (seen.size > batchIds.length || total !== null && seen.size > total) {
        return servicePerformanceCustomersUnavailable(incomplete, customerIds.length);
      }
      if (total !== null && seen.size === total) break;
      if (batch.length === 0) {
        if (total !== null && seen.size < total) return servicePerformanceCustomersUnavailable(incomplete, customerIds.length);
        break;
      }
      skip += batch.length;
      if (seen.size >= batchIds.length) break;
    }

    if (batchIds.some(id => !seen.has(id) || !names.has(id))) {
      const missingCount = batchIds.filter(id => !seen.has(id) || !names.has(id)).length;
      return servicePerformanceCustomersUnavailable('部分关联客户名称缺失，客户排行暂不可用。', missingCount);
    }
  }

  return {
    available: true,
    names: Object.fromEntries(names.entries()) as Record<string, string>,
    error: '',
    missingCount: 0,
  };
}

export const servicePerformanceCustomersHelpersSource = [
  servicePerformanceCustomerReferenceId,
  servicePerformanceCustomersUnavailable,
  servicePerformanceCustomerReadFailure,
  readServicePerformanceCustomerNames,
].map(helper => helper.toString()).join('\n');
