import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { servicePersonalMetricProjection, servicePersonalSidebarMetric, servicePersonalMetricsHelpersSource } from '../src/pages/sales-service-metrics.panel.ts';

function itemById(projection, id) {
  return projection.items.find(item => item.id === id);
}

test('quotation metrics include only quotations for the actor’s currently assigned orders', () => {
  const result = servicePersonalMetricProjection('quotations', [
    { id: 'quote-draft', service_order_id: 'order-current', status: 'draft', amount: 1200 },
    { id: 'quote-pending', service_order_id: { id: 'order-current' }, status: 'pending_confirmation', amount: 2200 },
    { id: 'quote-confirmed', service_order_id: 'order-current', status: 'confirmed', amount: 3200 },
    { id: 'quote-settlement', service_order_id: 'order-current', status: 'settlement_created', amount: 4200 },
    { id: 'quote-peer', service_order_id: 'order-peer', status: 'unknown-peer-status', owner_id: 'actor-1', responsible_id: 'actor-1' },
  ], 'actor-1', [
    { id: 'order-current', engineer_id: { id: 'actor-1' } },
    { id: 'order-peer', engineer_id: 'actor-2' },
  ]);

  assert.equal(result.available, true);
  assert.equal(itemById(result, 'all').value, 4);
  assert.equal(itemById(result, 'draft').value, 1);
  assert.equal(itemById(result, 'pending_confirmation').value, 1);
  assert.equal(itemById(result, 'confirmed').value, 1);
  assert.deepEqual(itemById(result, 'executing'), { id: 'executing', label: '执行中', value: null, disabled: true }, 'a quotation already converted to settlement is not relabeled as executing');
  assert.deepEqual(itemById(result, 'valid_amount'), { id: 'valid_amount', label: '有效报价金额', value: null, disabled: true }, 'populated records do not imply an unverified amount eligibility rule');
});

test('empty quotation scope can show zero while unknown in-scope states make metrics unavailable', () => {
  const empty = servicePersonalMetricProjection('quotations', [], 'actor-1', [
    { id: 'order-current', engineer_id: 'actor-1' },
  ]);
  assert.equal(empty.available, true);
  assert.equal(itemById(empty, 'all').value, 0);
  assert.equal(itemById(empty, 'valid_amount').value, 0);
  assert.equal(itemById(empty, 'executing').value, null);

  const unknown = servicePersonalMetricProjection('quotations', [
    { id: 'quote-unknown', service_order_id: 'order-current', status: 'approved' },
  ], 'actor-1', [{ id: 'order-current', engineer_id: 'actor-1' }]);
  assert.equal(unknown.available, false);
  assert.deepEqual(unknown.items, []);
  assert.match(unknown.error, /状态数据不完整/);
});

test('parts metrics use requested_by and keep the three source states distinct', () => {
  const result = servicePersonalMetricProjection('parts', [
    { id: 'part-open', requested_by: 'actor-1', owner_id: 'actor-2', status: 'open' },
    { id: 'part-completed', requested_by: { id: 'actor-1' }, status: 'completed' },
    { id: 'part-cancelled', requested_by: 'actor-1', status: 'cancelled' },
    { id: 'part-peer', requested_by: 'actor-2', owner_id: 'actor-1', status: 'approved' },
  ], 'actor-1', []);

  assert.equal(result.available, true);
  assert.equal(itemById(result, 'all').value, 3);
  assert.equal(itemById(result, 'open').value, 1);
  assert.equal(itemById(result, 'completed').value, 1);
  assert.equal(itemById(result, 'cancelled').value, 1);
});

test('unknown in-scope parts status is unavailable rather than counted as zero', () => {
  const result = servicePersonalMetricProjection('parts', [
    { id: 'part-awaiting-approval', requested_by: 'actor-1', status: 'pending_approval' },
  ], 'actor-1', []);

  assert.equal(result.available, false);
  assert.deepEqual(result.items, []);
  assert.match(result.error, /状态数据不完整/);
});

test('missing actor and unsupported metric kinds do not return an apparent empty result', () => {
  const missingActor = servicePersonalMetricProjection('parts', [], '', []);
  const unsupported = servicePersonalMetricProjection('settlements', [], 'actor-1', []);

  assert.equal(missingActor.available, false);
  assert.deepEqual(missingActor.items, []);
  assert.equal(unsupported.available, false);
  assert.deepEqual(unsupported.items, []);
});

test('sidebar counts in-progress source parts without counting peers or terminal requests', () => {
  const result = servicePersonalSidebarMetric('parts', [
    { requested_by: 'actor', status: 'open', execution_status: 'exception' },
    { requested_by: 'actor', status: 'open', execution_status: 'partially_used' },
    { requested_by: 'actor', status: 'completed' },
    { requested_by: 'actor', status: 'cancelled' },
    { requested_by: 'peer', status: 'open' },
  ], 'actor', []);
  assert.equal(result.value, 2);
  assert.equal(result.description, '待办理申请');
  assert.equal(servicePersonalSidebarMetric('parts', [], 'actor', []).value, 0);
  assert.equal(servicePersonalSidebarMetric('parts', [{ requested_by: 'actor', status: 'unknown' }], 'actor', []).value, null);
  assert.equal(servicePersonalSidebarMetric('parts', [], '', []).available, false);
});

test('pending quotation sidebar does not invent eligibility for populated assigned quotes', () => {
  const orders = [{ id: 'assigned', engineer_id: 'actor' }];
  assert.equal(servicePersonalSidebarMetric('quotations', [], 'actor', orders).value, 0);
  assert.equal(servicePersonalSidebarMetric('quotations', [{ service_order_id: 'peer-order', status: 'draft' }], 'actor', orders).value, 0);
  for (const status of ['draft', 'pending_confirmation', 'confirmed', 'settlement_created', 'cancelled']) {
    const result = servicePersonalSidebarMetric('quotations', [{ service_order_id: 'assigned', status }], 'actor', orders);
    assert.equal(result.value, null, status);
    assert.match(result.description, /口径暂不可用/);
  }
  const context = vm.createContext({});
  vm.runInContext(servicePersonalMetricsHelpersSource, context);
  assert.equal(context.servicePersonalSidebarMetric('parts', [], 'actor', []).value, 0, 'serialized React Page helper is self-contained');
});
