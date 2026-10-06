import assert from 'node:assert/strict';
import test from 'node:test';
import {
  servicePersonalPerformanceHelpersSource,
  servicePersonalPerformanceProjection,
} from '../src/pages/sales-service-personal-performance.panel.ts';

const actor = 'service-engineer-1';

function order(id, overrides = {}) {
  return {
    id,
    code: 'WO-' + id,
    engineer_id: actor,
    owner_id: actor,
    responsible_id: actor,
    customer_id: 'customer-1',
    status: 'completed',
    completed_at: '2026-10-05T09:00:00.000Z',
    ...overrides,
  };
}

test('uses current engineer assignment, counts only completed as complete, and ignores foreign unknown states', () => {
  const rows = [
    order('own-old', { engineer_id: { id: actor }, completed_at: '2026-10-04T09:00:00.000Z' }),
    order('own-new', { engineer_id: actor, customer_id: { id: 'customer-1' }, completed_at: '2026-10-05T09:00:00.000Z' }),
    order('own-closed', { status: 'closed', customer_id: 'customer-2' }),
    order('own-active', { status: 'in_progress', customer_id: 'customer-3' }),
    order('reassigned-away', { engineer_id: 'another-engineer', owner_id: actor, responsible_id: actor }),
    order('peer-unknown', { engineer_id: 'another-engineer', status: 'future_state' }),
  ];
  const result = servicePersonalPerformanceProjection(rows, actor, new Map([
    ['customer-1', '同名客户'],
    ['customer-2', '已关闭客户'],
  ]), true);

  assert.equal(result.available, true);
  assert.deepEqual(result.summary, [
    { id: 'all', label: '本人服务工单', value: 4 },
    { id: 'completed', label: '本人已完工', value: 2 },
  ]);
  assert.deepEqual(result.rows.map(row => row.id), ['own-new', 'own-old']);
  assert.equal(result.rows[0], rows[1], 'completed detail rows keep the original records');
  assert.equal(result.unknownStatusCount, 0, 'an unrelated engineer status does not poison self-scoped metrics');
  assert.deepEqual(result.customerRanking.items, [
    { id: 'customer-1', label: '同名客户', value: 2 },
  ]);
});

test('groups customer history by customer id, supports string and expanded refs, and does not merge equal names', () => {
  const result = servicePersonalPerformanceProjection([
    order('a-1', { customer_id: 'customer-a', completed_at: '2026-10-05T08:00:00Z' }),
    order('a-2', { customer_id: { id: 'customer-a', name: '重复名' }, completed_at: '2026-10-05T08:00:00Z' }),
    order('b-1', { customer_id: { value: 'customer-b' }, completed_at: '2026-10-05T08:00:00Z' }),
  ], actor, { 'customer-a': '重复名', 'customer-b': { name: '重复名' } }, true);

  assert.equal(result.customerRanking.available, true);
  assert.equal(result.customerRanking.total, 2);
  assert.deepEqual(result.customerRanking.items, [
    { id: 'customer-a', label: '重复名', value: 2 },
    { id: 'customer-b', label: '重复名', value: 1 },
  ]);
});

test('retains every completed row and orders valid completion instants newest first with invalid dates last', () => {
  const rows = [
    order('undated', { code: 'Z-UNDATED', completed_at: null }),
    order('same-b', { code: 'B-2', completed_at: '2026-10-05T09:00:00.000Z' }),
    order('bad-date', { code: 'C-1', completed_at: 'not-an-instant' }),
    order('same-a', { code: 'A-1', completed_at: '2026-10-05T09:00:00.000Z' }),
    ...Array.from({ length: 21 }, (_, index) => order('extra-' + index, {
      code: 'EXTRA-' + String(index).padStart(2, '0'),
      completed_at: `2026-10-04T${String(index % 24).padStart(2, '0')}:00:00.000Z`,
    })),
  ];
  const result = servicePersonalPerformanceProjection(rows, actor, {}, false);

  assert.equal(result.available, true);
  assert.equal(result.rows.length, 25, 'the projection does not cap rows to the page size');
  assert.deepEqual(result.rows.slice(0, 2).map(row => row.id), ['same-a', 'same-b']);
  assert.equal(result.rows.at(-2).id, 'bad-date');
  assert.equal(result.rows.at(-1).id, 'undated');
});

test('missing customer names make the whole ranking unavailable without losing completed counts or rows', () => {
  const result = servicePersonalPerformanceProjection([
    order('visible', { customer_id: 'customer-visible' }),
    order('unreadable-name', { customer_id: 'customer-private-id' }),
    order('missing-reference', { customer_id: null }),
  ], actor, { 'customer-visible': '可读客户' }, true);

  assert.equal(result.available, true);
  assert.deepEqual(result.summary.map(item => item.value), [3, 3]);
  assert.equal(result.rows.length, 3);
  assert.equal(result.customerRanking.available, false);
  assert.deepEqual(result.customerRanking.items, []);
  assert.equal(result.customerRanking.missingNameCount, 2);
  assert.match(result.customerRanking.error, /客户名称暂不可用/);
  assert.equal(result.customerRanking.error.includes('customer-private-id'), false);
  assert.equal(result.customerRanking.error.includes('customer-visible'), false);
});

test('an incomplete customer-name read keeps all completed rows but withholds the partial ranking', () => {
  const result = servicePersonalPerformanceProjection([
    order('visible-name', { customer_id: 'customer-visible' }),
    order('possibly-hidden-name', { customer_id: 'customer-hidden' }),
  ], actor, { 'customer-visible': '可读客户' }, false);

  assert.equal(result.available, true);
  assert.equal(result.summary[1].value, 2);
  assert.equal(result.rows.length, 2);
  assert.equal(result.customerRanking.available, false);
  assert.deepEqual(result.customerRanking.items, []);
  assert.equal(result.customerRanking.missingNameCount, null);
});

test('an unknown status on an owned row makes both counts unavailable rather than zero', () => {
  const result = servicePersonalPerformanceProjection([
    order('known-completed'),
    order('unknown-owned', { status: 'new_unrecognized_status' }),
    order('unknown-peer', { engineer_id: 'another-engineer', status: 'peer_unrecognized_status' }),
  ], actor, {}, true);

  assert.equal(result.available, false);
  assert.match(result.error, /未识别状态/);
  assert.equal(result.unknownStatusCount, 1);
  assert.deepEqual(result.summary.map(item => item.value), [null, null]);
  assert.deepEqual(result.rows, []);
  assert.equal(result.error.includes('new_unrecognized_status'), false);
  assert.equal(result.error.includes('peer_unrecognized_status'), false);
});

test('missing identity never returns other engineers and a complete empty set can show zero', () => {
  const rows = [order('peer-1', { engineer_id: 'another-engineer' })];
  const missingActor = servicePersonalPerformanceProjection(rows, '', {}, true);
  assert.equal(missingActor.available, false);
  assert.deepEqual(missingActor.summary.map(item => item.value), [null, null]);
  assert.deepEqual(missingActor.rows, []);
  assert.equal(missingActor.error.includes('another-engineer'), false);

  const empty = servicePersonalPerformanceProjection([], actor, {}, false);
  assert.equal(empty.available, true);
  assert.deepEqual(empty.summary.map(item => item.value), [0, 0]);
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(empty.customerRanking, {
    available: true,
    error: '',
    items: [],
    total: 0,
    missingNameCount: 0,
  });
});

test('the embedded projection is self-contained and has no transpiler helper dependency', () => {
  assert.equal(servicePersonalPerformanceHelpersSource.includes('__name'), false);
  const embedded = new Function(`return (${servicePersonalPerformanceHelpersSource});`)();
  assert.deepEqual(embedded([], actor, {}, true).summary.map(item => item.value), [0, 0]);
});
