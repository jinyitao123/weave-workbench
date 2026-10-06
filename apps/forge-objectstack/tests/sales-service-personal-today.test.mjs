import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { servicePersonalTodayProjection } from '../src/pages/sales-service-personal-workspace.panel.ts';

function metric(projection, id) {
  return projection.summary.find(item => item.id === id);
}

test('returns the five today metrics and preserves the existing planned-date partitions', () => {
  const projection = servicePersonalTodayProjection([
    { id: 'remote-today', status: 'pending_receive', scheduled_at: '2026-10-05', urgency: 'urgent', service_mode: 'remote' },
    { id: 'tomorrow', status: 'in_progress', scheduled_at: '2026-10-06T09:30:00' },
    { id: 'unplanned', status: 'in_progress', scheduled_at: null },
    { id: 'completed', status: 'completed', completed_at: '2026-10-04T16:30:00Z', scheduled_at: '2026-10-05' },
    { id: 'closed', status: 'closed', completed_at: '2026-10-04T16:30:00Z', scheduled_at: '2026-10-05' },
    { id: 'rejected', status: 'rejected', scheduled_at: '2026-10-05' },
  ], '2026-10-05', 'Asia/Shanghai');

  assert.deepEqual(projection.summary.map(item => item.id), [
    'today-plan', 'pending-receive', 'in-progress', 'today-completed', 'overdue',
  ]);
  assert.deepEqual(projection.summary.map(item => item.value), [2, 1, 2, 1, '—']);
  assert.ok(projection.summary.every(item => typeof item.description === 'string'));
  assert.equal(metric(projection, 'today-plan').description, '今日排程的工单数');
  assert.equal(metric(projection, 'today-completed').description, '本月已完工 1 单');
  assert.equal(metric(projection, 'overdue').description, 'SLA判定暂不可用');
  assert.deepEqual(projection.todayRows.map(row => row.id), ['remote-today', 'completed'], 'today schedule includes completed rows and has no new service_mode filter');
  assert.deepEqual(projection.tomorrowRows.map(row => row.id), ['tomorrow']);
  assert.deepEqual(projection.urgentRows.map(row => row.id), ['remote-today']);
  assert.deepEqual(projection.unplannedRows.map(row => row.id), ['unplanned']);
  assert.equal(projection.statusDataAvailable, true);
  assert.deepEqual(projection.unknownStatusRows, []);
  assert.deepEqual(projection.unclearDateRows, []);
  assert.deepEqual(projection.unclearScheduledRows, []);
  assert.equal(projection.urgentRows.some(row => row.id === 'completed'), false);
  assert.equal(projection.unplannedRows.some(row => row.id === 'completed'), false);
  assert.equal(projection.todayRows.some(row => ['closed', 'rejected'].includes(String(row.status))), false);
});

test('counts completed instants in the organization timezone across UTC midnight and equivalent offsets', () => {
  const projection = servicePersonalTodayProjection([
    { status: 'completed', completed_at: '2026-10-04T16:30:00Z' },
    { status: 'completed', completed_at: '2026-10-05T00:30:00+08:00' },
  ], '2026-10-05', 'Asia/Shanghai');
  assert.equal(metric(projection, 'today-completed').value, 2);
  assert.equal(metric(projection, 'today-completed').description, '本月已完工 2 单');
});

test('uses timezone-local calendar days through both New York daylight-saving transitions', () => {
  const spring = servicePersonalTodayProjection([
    { status: 'completed', completed_at: '2026-03-08T07:30:00Z' },
    { status: 'completed', completed_at: '2026-03-08T03:30:00-04:00' },
  ], '2026-03-08', 'America/New_York');
  assert.equal(metric(spring, 'today-completed').value, 2);
  assert.equal(metric(spring, 'today-completed').description, '本月已完工 2 单');

  const autumn = servicePersonalTodayProjection([
    { status: 'completed', completed_at: '2026-11-01T05:30:00Z' },
    { status: 'completed', completed_at: '2026-11-01T01:30:00-04:00' },
  ], '2026-11-01', 'America/New_York');
  assert.equal(metric(autumn, 'today-completed').value, 2);
  assert.equal(metric(autumn, 'today-completed').description, '本月已完工 2 单');
});

test('missing timezone/date or malformed completed timestamps keep completion and month counts unavailable', () => {
  const row = { status: 'completed', completed_at: '2026-10-05T04:30:00Z' };
  const missingZone = servicePersonalTodayProjection([row], '2026-10-05');
  assert.equal(metric(missingZone, 'today-completed').value, '—');
  assert.equal(metric(missingZone, 'today-completed').description, '组织时区不可用');

  const invalidZone = servicePersonalTodayProjection([row], '2026-10-05', 'Mars/Phobos');
  assert.equal(metric(invalidZone, 'today-completed').value, '—');
  assert.equal(metric(invalidZone, 'today-completed').description, '组织时区不可用');

  const invalidBusinessDate = servicePersonalTodayProjection([row], '2026-02-31', 'Asia/Shanghai');
  assert.equal(metric(invalidBusinessDate, 'today-plan').value, '—');
  assert.equal(metric(invalidBusinessDate, 'today-completed').value, '—');
  assert.equal(metric(invalidBusinessDate, 'today-completed').description, '组织业务日期不可用');

  for (const completedAt of ['2026-02-31T10:00:00Z', '2026-10-05T10:00:00', '2026-10-05', 'not-a-timestamp']) {
    const malformed = servicePersonalTodayProjection([{ status: 'completed', completed_at: completedAt }], '2026-10-05', 'Asia/Shanghai');
    assert.equal(metric(malformed, 'today-completed').value, '—', completedAt);
    assert.equal(metric(malformed, 'today-completed').description, '完工时间不完整', completedAt);
  }

  const closedWithBadTimestamp = servicePersonalTodayProjection([
    { status: 'closed', completed_at: 'not-a-timestamp' },
  ], '2026-10-05', 'Asia/Shanghai');
  assert.equal(metric(closedWithBadTimestamp, 'today-completed').value, 0, 'closed records do not count as completed');
});

test('unknown statuses and invalid plan dates do not turn top counts into false zeroes', () => {
  const unknownStatus = servicePersonalTodayProjection([
    { status: 'pending_receive', scheduled_at: '2026-10-05' },
    { id: 'unknown', status: 'new_unrecognized_status', scheduled_at: '2026-10-05' },
  ], '2026-10-05', 'Asia/Shanghai');
  assert.equal(metric(unknownStatus, 'today-plan').value, '—');
  assert.equal(metric(unknownStatus, 'pending-receive').value, '—');
  assert.equal(metric(unknownStatus, 'in-progress').value, '—');
  assert.equal(metric(unknownStatus, 'today-completed').value, '—');
  assert.equal(metric(unknownStatus, 'pending-receive').description, '工单状态不可用');
  assert.equal(unknownStatus.statusDataAvailable, false);
  assert.deepEqual(unknownStatus.unknownStatusRows.map(row => row.id), ['unknown']);

  const malformedSchedule = servicePersonalTodayProjection([
    { id: 'invalid-active', status: 'in_progress', scheduled_at: '2026-02-31' },
    { id: 'invalid-completed', status: 'completed', scheduled_at: '2026-02-31' },
  ], '2026-02-28', 'Asia/Shanghai');
  assert.equal(metric(malformedSchedule, 'today-plan').value, '—');
  assert.equal(metric(malformedSchedule, 'today-plan').description, '计划日期不完整');
  assert.equal(malformedSchedule.unplannedRows.length, 0, 'invalid dates are not reclassified as unplanned');
  assert.equal(malformedSchedule.unclearDateRows.length, 1);
  assert.deepEqual(malformedSchedule.unclearDateRows.map(row => row.id), ['invalid-active'], 'the legacy issue list remains active-only');
  assert.deepEqual(malformedSchedule.unclearScheduledRows.map(row => row.id), ['invalid-active', 'invalid-completed'], 'all scheduled statuses include malformed plan dates');

  const noBusinessDate = servicePersonalTodayProjection([
    { id: 'invalid-completed-without-date-context', status: 'completed', scheduled_at: '2026-02-31' },
  ], '', 'Asia/Shanghai');
  assert.equal(noBusinessDate.dateAvailable, false);
  assert.deepEqual(noBusinessDate.unclearScheduledRows.map(row => row.id), ['invalid-completed-without-date-context'], 'source date issues are checked even when the business date is unavailable');
});

test('a complete empty work-order set gives zero counts with a valid timezone and keeps SLA unknown', () => {
  const projection = servicePersonalTodayProjection([], '2026-10-05', 'Asia/Shanghai');
  assert.deepEqual(projection.summary.map(item => item.value), [0, 0, 0, 0, '—']);
  assert.equal(metric(projection, 'today-completed').description, '本月已完工 0 单');
});

test('the serialized projection is self-contained and has no browser-timezone dependency', () => {
  const source = servicePersonalTodayProjection.toString();
  assert.doesNotMatch(source, /__name|servicePersonalDateKey|servicePersonalAddDays/);
  const context = {};
  vm.runInNewContext(`this.projectToday = (${source});`, context);
  const result = context.projectToday([
    { status: 'completed', completed_at: '2026-10-04T16:30:00Z' },
  ], '2026-10-05', 'Asia/Shanghai');
  assert.equal(result.summary.find(item => item.id === 'today-completed').value, 1);
});
