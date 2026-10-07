import assert from 'node:assert/strict';
import test from 'node:test';
import { serviceWarrantyOverviewProjection, serviceWarrantyOverviewProjectionSource } from '../src/pages/sales-service-warranty-overview.panel.ts';

const dueDate = '2026-10-05';

function card(id, overrides = {}) {
  return {
    id,
    code: 'WC-' + id,
    status: 'active',
    service_order_id: null,
    sales_order_id: null,
    scope: '整机服务',
    responsible_party: '供应商',
    ends_on: dueDate,
    ...overrides,
  };
}

function summaryValue(result, id) {
  return result.summary.find(item => item.id === id)?.value;
}

function distributionValue(result, distribution, id) {
  return result.distributions[distribution].find(item => item.id === id)?.value;
}

test('projects the five formal statuses and source relationships without replacing scope or responsibility values', () => {
  const result = serviceWarrantyOverviewProjection([
    card('service', { status: 'active', service_order_id: 'work-1', scope: '单台设备', responsible_party: '供应商' }),
    card('sales', { status: 'pending_activation', sales_order_id: 'order-1', scope: '整单', responsible_party: '我方' }),
    card('both', { status: 'grace_period', service_order_id: { id: 'work-2' }, sales_order_id: { id: 'order-2' }, scope: '部件', responsible_party: '客户' }),
    card('expired', { status: 'expired', service_order_id: null, sales_order_id: '' }),
    card('terminated', { status: 'terminated', scope: '', responsible_party: null }),
  ], dueDate);

  assert.equal(result.available, true);
  assert.deepEqual(result.summary.map(item => item.value), [1, 1, 1, 1, 1]);
  assert.deepEqual(result.distributions.source.map(item => item.value), [2, 1, 1, 1]);
  assert.deepEqual(result.distributions.scope.map(item => item.label).sort(), ['单台设备', '整单', '整机服务', '未填写', '部件'].sort());
  assert.deepEqual(result.distributions.responsible.map(item => item.label).sort(), ['供应商', '客户', '我方', '未填写'].sort());
  assert.equal(result.distributions.responsible[0].label, '供应商', 'group order follows descending count');
  assert.equal(result.distributions.responsible.find(item => item.label === '我方').value, 1);
});

test('unknown statuses make all five counts unavailable without leaking the unknown value', () => {
  const result = serviceWarrantyOverviewProjection([
    card('known', { status: 'active' }),
    card('unknown', { status: 'unpublished_internal_state' }),
  ], dueDate);

  assert.equal(result.available, false);
  assert.match(result.error, /未识别/);
  assert.equal(result.unknownStatusCount, 1);
  assert.deepEqual(result.summary.map(item => item.value), [null, null, null, null, null]);
  assert.equal(JSON.stringify(result.summary).includes('unpublished_internal_state'), false);
  assert.equal(result.distributions.scope[0].value, 2);
  assert.equal(result.expiry.rowsAvailable, true, 'status uncertainty does not block the independently dated ledger');
});

test('invalid organization business date disables expiry interpretation but preserves known status counts and dated rows', () => {
  const result = serviceWarrantyOverviewProjection([
    card('first', { status: 'active', ends_on: '2026-11-01' }),
    card('second', { status: 'expired', ends_on: '2026-10-01' }),
  ], '2026-02-30');

  assert.equal(result.available, true);
  assert.deepEqual(result.summary.map(item => item.value), [1, 0, 0, 1, 0]);
  assert.equal(result.expiry.available, false);
  assert.equal(result.expiry.businessDateAvailable, false);
  assert.equal(result.expiry.businessDateError, '到期预警暂不可用。');
  assert.equal(result.expiry.rowsAvailable, true, 'sorting recorded YYYY-MM-DD values does not depend on today');
  assert.equal(result.expiry.total, 2);
  assert.deepEqual(result.expiry.rows.map(row => row.id), ['second', 'first']);
  assert.ok(result.expiry.windows.every(window => window.value === null && window.available === false));
});

test('invalid card end dates disable only the expiry ledger, not the status distribution', () => {
  const result = serviceWarrantyOverviewProjection([
    card('valid', { status: 'active' }),
    card('bad-date', { status: 'terminated', ends_on: '2026-02-30' }),
  ], dueDate);

  assert.equal(result.available, true);
  assert.deepEqual(result.summary.map(item => item.value), [1, 0, 0, 0, 1]);
  assert.equal(result.expiry.rowsAvailable, false);
  assert.match(result.expiry.rowsError, /缺失或无效/);
  assert.deepEqual(result.expiry.rows, []);
  assert.equal(result.expiry.total, null);
});

test('missing end dates remain an explicit separate group and do not invalidate dated records', () => {
  const result = serviceWarrantyOverviewProjection([
    card('dated', { ends_on: '2026-10-12' }),
    card('not-activated', { status: 'pending_activation', ends_on: null }),
    card('legacy-undated', { ends_on: '' }),
  ], dueDate);

  assert.equal(result.expiry.rowsAvailable, true);
  assert.equal(result.expiry.total, 1);
  assert.equal(result.expiry.undatedCount, 2);
  assert.deepEqual(result.expiry.rows.map(row => row.id), ['dated']);
});

test('the dated ledger sorts the complete valid set by ends_on, returns ten rows, and retains total', () => {
  const rows = Array.from({ length: 12 }, (_, index) => card('card-' + index, {
    ends_on: `2026-10-${String(18 - index).padStart(2, '0')}`,
  }));
  const originalOrder = rows.map(row => row.id);
  const result = serviceWarrantyOverviewProjection(rows, dueDate);

  assert.equal(result.expiry.rowsAvailable, true);
  assert.equal(result.expiry.total, 12);
  assert.equal(result.expiry.rows.length, 10);
  assert.deepEqual(result.expiry.rows.map(row => row.ends_on), [
    '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
    '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16',
  ]);
  assert.deepEqual(rows.map(row => row.id), originalOrder, 'projection does not mutate the caller-owned rows');
});

test('a complete empty read proves zero rows but leaves the unverified 30/60/90 windows unavailable', () => {
  const result = serviceWarrantyOverviewProjection([], dueDate);

  assert.equal(result.available, true);
  assert.deepEqual(result.summary.map(item => item.value), [0, 0, 0, 0, 0]);
  assert.equal(result.expiry.rowsAvailable, true);
  assert.equal(result.expiry.total, 0);
  assert.deepEqual(result.expiry.rows, []);
  assert.equal(result.expiry.available, false);
  assert.ok(result.expiry.windows.every(window => window.value === null));
  assert.deepEqual(result.distributions.source, []);
});

test('the page-embedded source is a self-contained executable function', () => {
  assert.equal(serviceWarrantyOverviewProjectionSource.includes('__name'), false);
  const embedded = new Function(`return (${serviceWarrantyOverviewProjectionSource});`)();
  assert.deepEqual(embedded([], dueDate).summary.map(item => item.value), [0, 0, 0, 0, 0]);
});
