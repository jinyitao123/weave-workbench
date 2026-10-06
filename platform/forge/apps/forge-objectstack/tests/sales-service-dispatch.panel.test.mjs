import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readServiceRecordPages,
  readServiceDispatchOrders,
  serviceDispatchDateColumns,
  serviceDispatchDateKey,
  serviceDispatchEngineerOptions,
  serviceDispatchFilterRows,
  serviceDispatchLoadSummary,
  serviceDispatchRange,
  serviceDispatchSlaRows,
  serviceDispatchWhere,
} from '../src/pages/sales-service-dispatch.panel.ts';

test('dispatch periods are Monday anchored and expose the requested 7, 14 and 28 dates', () => {
  assert.deepEqual(serviceDispatchRange('2026-10-05', 7), {
    start: '2026-10-05', end: '2026-10-11', dates: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'],
  });
  assert.equal(serviceDispatchRange('2026-10-05', 14).end, '2026-10-18');
  assert.equal(serviceDispatchRange('2026-10-05', 28).end, '2026-11-01');
  assert.equal(serviceDispatchRange('2027-01-01', 7).start, '2026-12-28');
  assert.equal(serviceDispatchDateKey('2026-02-30'), '');
  assert.equal(serviceDispatchDateKey('2026-10-05T00:00:00.000Z'), '2026-10-05');
  assert.deepEqual(serviceDispatchDateColumns('2026-10-05', 7, '2026-10-05')[0], {
    key: '2026-10-05', label: '10/05', description: '周一', isToday: true,
  });
});

test('dispatch queries use only the existing schedule, active-assignment and raw SLA fields', () => {
  assert.deepEqual(serviceDispatchWhere('calendar'), { status: { $in: ['pending_receive', 'in_progress'] } }, 'calendar read includes active assigned orders with blank schedule so unplanned work can be counted');
  assert.deepEqual(serviceDispatchWhere('resource-load'), { status: { $in: ['pending_receive', 'in_progress'] } });
  assert.deepEqual(serviceDispatchWhere('sla'), { sla_due_at: { $null: false } });
});

test('dispatch search and selectors only match real order fields and the stable engineer reference', () => {
  const rows = [
    { id: 'order-1', code: 'WO-1', name: '现场检修', region: '苏州', service_type: '维修', urgency: 'urgent', engineer_id: 'user-1', engineer_name: '工程师甲' },
    { id: 'order-2', code: 'WO-2', name: '现场巡检', region: '上海', service_type: '巡检', urgency: 'medium', engineer_id: 'user-2', engineer_name: '工程师乙' },
  ];
  assert.deepEqual(serviceDispatchFilterRows(rows, { search: '工程师甲' }).map(row => row.id), ['order-1']);
  assert.deepEqual(serviceDispatchFilterRows(rows, { region: '苏州', serviceType: '维修', urgency: 'urgent', engineerId: 'user-1' }).map(row => row.id), ['order-1']);
  assert.deepEqual(serviceDispatchFilterRows(rows, { engineerId: 'user-unknown' }), []);
  assert.deepEqual(serviceDispatchEngineerOptions([
    ...rows,
    { id: 'order-3', engineer_id: 'user-no-name', engineer_name: '' },
    { id: 'order-4', engineer_name: '没有账号的姓名' },
  ]).map(engineer => engineer.value).sort(), [
    'user-1',
    'user-2',
  ]);
});

test('resource load counts only identified assignments, separates unplanned and unknown dates, and never invents idle staff', () => {
  const rows = [
    { id: 'order-1', engineer_id: 'user-1', engineer_name: '工程师甲', status: 'pending_receive', scheduled_at: '2026-10-06', urgency: 'urgent', dispatched_at: '2026-10-05T02:00:00.000Z' },
    { id: 'order-2', engineer_id: 'user-1', engineer_name: '工程师甲', status: 'in_progress', scheduled_at: null, urgency: 'medium', dispatched_at: '2026-10-04T02:00:00.000Z' },
    { id: 'order-3', engineer_id: 'user-2', engineer_name: '工程师乙', status: 'in_progress', scheduled_at: 'unknown', urgency: 'high' },
    { id: 'order-4', engineer_name: '姓名不能代替账号', status: 'pending_receive', scheduled_at: '2026-10-07', urgency: 'urgent' },
    { id: 'order-5', engineer_id: 'user-3', engineer_name: '', status: 'in_progress', scheduled_at: '2026-10-08', urgency: 'urgent' },
    { id: 'order-6', status: 'in_progress', scheduled_at: null },
    { id: 'order-7', engineer_id: 'user-4', engineer_name: '已完工人员', status: 'completed', scheduled_at: '2026-10-08' },
  ];
  const summary = serviceDispatchLoadSummary(rows, '2026-10-05', '2026-10-11');
  assert.deepEqual([...summary.resources.map(resource => resource.id)].sort(), ['user-1', 'user-2', 'user-3']);
  assert.deepEqual([...summary.events.map(event => event.id)].sort(), ['order-1', 'order-5']);
  assert.equal(summary.events.find(event => event.id === 'order-1').subtitle, '待接单');
  assert.equal(summary.events.find(event => event.id === 'order-5').subtitle, '服务中');
  assert.equal(summary.scheduledCount, 2);
  assert.equal(summary.urgentScheduledCount, 2);
  assert.equal(summary.unplannedCount, 1, 'unplanned count requires a real engineer id and an active work status');
  assert.equal(summary.unknownDateCount, 1, 'non-empty but unrecognized schedule dates are surfaced separately');
  assert.equal(summary.unassignedCount, 2, 'a display name without an engineer id is not assigned to a resource row');
  assert.equal(summary.unidentifiedNameCount, 1, 'an engineer id without a readable name is not silently turned into a visible id');
  assert.match(summary.resources.find(resource => resource.id === 'user-1').description, /未排期 1/);
  assert.equal(summary.resources.find(resource => resource.id === 'user-3').label, '姓名不可用');
});

test('SLA data remains raw due dates and cannot yield an implied risk or success rate', () => {
  const result = serviceDispatchSlaRows([
    { id: 'order-1', sla_due_at: '2026-10-06', status: 'in_progress' },
    { id: 'order-2', sla_due_at: '2026-10-20', status: 'completed' },
    { id: 'order-3', sla_due_at: 'unknown', status: 'pending_receive' },
    { id: 'order-4', sla_due_at: null, status: 'pending_dispatch' },
  ], '2026-10-05', '2026-10-11');
  assert.deepEqual(result.rows.map(row => row.id), ['order-1']);
  assert.deepEqual(result.unknownRows.map(row => row.id), ['order-3'], 'invalid due dates remain visible in the ledger instead of being silently discarded');
  assert.equal(result.unknownDateCount, 1);
  assert.equal('riskCount' in result, false);
  assert.equal('successRate' in result, false);
});

test('service-order reads paginate to the reported total before counts are considered complete', async () => {
  const rows = Array.from({ length: 250 }, (_, index) => ({ id: 'order-' + String(index + 1).padStart(3, '0') }));
  const calls = [];
  const result = await readServiceDispatchOrders(async path => {
    const url = new URL(path, 'http://service-page.test');
    const skip = Number(url.searchParams.get('$skip'));
    const top = Number(url.searchParams.get('$top'));
    calls.push({ skip, top, count: url.searchParams.get('$count'), orderBy: url.searchParams.get('$orderby') });
    return { result: { data: { records: rows.slice(skip, skip + top), totalCount: rows.length } } };
  }, 'calendar', 200, 1000);
  assert.equal(result.complete, true);
  assert.equal(result.unavailable, false);
  assert.equal(result.total, 250);
  assert.equal(result.rows.length, 250);
  assert.deepEqual(calls.map(call => call.skip), [0, 200]);
  assert.ok(calls.every(call => call.count === 'true' && call.orderBy === 'id asc'));
});

test('missing totals probe through short pages, while repeated pages and caps stay explicitly incomplete', async () => {
  const rows = Array.from({ length: 250 }, (_, index) => ({ id: 'order-' + index }));
  let callCount = 0;
  const noTotal = await readServiceDispatchOrders(async path => {
    callCount++;
    const url = new URL(path, 'http://service-page.test');
    const skip = Number(url.searchParams.get('$skip'));
    const top = Number(url.searchParams.get('$top'));
    if (skip >= rows.length) return { records: [] };
    return { records: rows.slice(skip, skip + Math.min(top, skip === 0 ? 170 : 80)) };
  }, 'resource-load', 200, 1000);
  assert.equal(noTotal.complete, true);
  assert.equal(noTotal.total, 250);
  assert.equal(callCount, 3, 'a short non-empty page is not proof that all records were read');

  const repeated = await readServiceDispatchOrders(async path => {
    const top = Number(new URL(path, 'http://service-page.test').searchParams.get('$top'));
    return { records: rows.slice(0, top) };
  }, 'resource-load', 200, 1000);
  assert.equal(repeated.complete, false);
  assert.equal(repeated.reason, 'duplicate-or-missing-id');
  assert.match(repeated.error, /不完整/);

  const capRows = Array.from({ length: 9000 }, (_, index) => ({ id: 'cap-order-' + String(index).padStart(5, '0') }));
  const capped = await readServiceDispatchOrders(async path => {
    const url = new URL(path, 'http://service-page.test');
    const skip = Number(url.searchParams.get('$skip'));
    const top = Number(url.searchParams.get('$top'));
    return { records: capRows.slice(skip, skip + top), totalCount: 9000 };
  }, 'resource-load', 200, 300);
  assert.equal(capped.complete, false);
  assert.equal(capped.rows.length, 300);
  assert.equal(capped.total, 9000);
  assert.match(capped.error, /读取上限/);
});

test('generic service reader keeps the caller scope and probes after short pages without a total', async () => {
  const where = { service_order_id: { $in: ['order-current-1', 'order-current-2'] } };
  const rows = [{ id: 'quote-1' }, { id: 'quote-2' }, { id: 'quote-3' }];
  const calls = [];
  const result = await readServiceRecordPages(async (path, options) => {
    const url = new URL(path, 'http://service-page.test');
    const skip = Number(url.searchParams.get('$skip'));
    const top = Number(url.searchParams.get('$top'));
    calls.push({ path: url.pathname, skip, top, filter: JSON.parse(url.searchParams.get('$filter')), count: url.searchParams.get('$count'), orderBy: url.searchParams.get('$orderby'), options });
    if (skip === 0) return { records: rows.slice(0, 2) };
    if (skip === 2) return { records: rows.slice(2) };
    return { records: [] };
  }, 'forge_service_quotation', where, 100, 1000, '报价单');

  assert.equal(result.complete, true);
  assert.equal(result.unavailable, false);
  assert.equal(result.total, 3);
  assert.deepEqual(result.rows.map(row => row.id), ['quote-1', 'quote-2', 'quote-3']);
  assert.deepEqual(calls.map(({ skip, top }) => [skip, top]), [[0, 100], [2, 100], [3, 100]]);
  assert.ok(calls.every(call => call.path === '/data/forge_service_quotation'));
  assert.ok(calls.every(call => JSON.stringify(call.filter) === JSON.stringify(where)));
  assert.ok(calls.every(call => call.count === 'true' && call.orderBy === 'id asc' && call.options === undefined));
});

test('generic service reader reports a denied later page as unavailable and discards partial data', async () => {
  let calls = 0;
  const result = await readServiceRecordPages(async () => {
    calls++;
    if (calls === 1) return { records: [{ id: 'quote-1' }], totalCount: 2 };
    const error = new Error('forbidden');
    error.status = 403;
    throw error;
  }, 'forge_service_quotation', { service_order_id: { $in: ['order-current'] } }, 1, 100, '报价单');

  assert.equal(result.unavailable, true);
  assert.equal(result.complete, false);
  assert.equal(result.rows.length, 0);
  assert.equal(result.total, null);
  assert.equal(result.error, '当前账号无权读取报价单。');
});

test('authorization failure on a later page discards partial data instead of showing an incomplete zero state', async () => {
  const firstPage = Array.from({ length: 200 }, (_, index) => ({ id: 'order-' + index }));
  let callCount = 0;
  const result = await readServiceDispatchOrders(async () => {
    callCount++;
    if (callCount === 1) return { records: firstPage, totalCount: 250 };
    const error = new Error('forbidden');
    error.status = 403;
    throw error;
  }, 'sla', 200, 1000);
  assert.equal(result.unavailable, true);
  assert.equal(result.complete, false);
  assert.equal(result.rows.length, 0);
  assert.equal(result.total, null);
  assert.equal(result.error, '当前账号无权读取派工数据。');
});
