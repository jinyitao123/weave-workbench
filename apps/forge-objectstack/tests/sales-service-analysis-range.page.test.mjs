import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceAnalysisPage } from '../src/pages/sales-service-workspace.page.ts';
import { serviceManagerPermission } from '../src/permissions/otc-role.permission.ts';
import { createServicePageHarness, serviceNodes, serviceText } from './service-page-react-harness.mjs';

function createHarness() {
  return createServicePageHarness(ServiceAnalysisPage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    users: { id: 'service-analysis-manager' },
  });
}

function dateInput(tree, label) {
  return serviceNodes(tree, node => node.type === 'ForgeDateInput' && node.props['aria-label'] === label)[0];
}

function setDate(harness, tree, label, value) {
  const control = dateInput(tree, label);
  assert.ok(control, `${label} remains available`);
  control.props.onChange({ target: { value } });
  return harness.render();
}

function aggregateNodes(tree) {
  return {
    metrics: [...new Set(serviceNodes(tree, node => node.type === 'ObjectMetric'))],
    charts: [...new Set(serviceNodes(tree, node => node.type === 'ObjectChart'))],
  };
}

function assertNoAggregates(tree, message) {
  const { metrics, charts } = aggregateNodes(tree);
  assert.equal(metrics.length, 0, message);
  assert.equal(charts.length, 0, message);
  assert.ok(serviceNodes(tree, node => node.type === 'ForgeNotice' && node.props.tone === 'error' && serviceText(node).length > 0).length > 0);
  assert.ok(dateInput(tree, '开始日期'));
  assert.ok(dateInput(tree, '结束日期'));
}

function assertJsonEqual(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

test('analysis date bounds gate every aggregate, preserve date controls, and restore after correction or clear', async () => {
  const harness = createHarness();
  let tree = await harness.flushEffects();
  let { metrics, charts } = aggregateNodes(tree);
  assert.equal(metrics.length, 4, 'two empty date fields retain the existing full-range aggregates');
  assert.equal(charts.length, 2);
  assert.ok(metrics.every(metric => metric.props.filter === undefined));
  assert.ok(charts.every(chart => chart.props.filter === undefined));

  tree = setDate(harness, tree, '开始日期', '2026-10-01');
  assert.equal(dateInput(tree, '开始日期').props.value, '2026-10-01');
  assert.equal(dateInput(tree, '结束日期').props.value, '');
  assertNoAggregates(tree, 'a one-sided range must not mount any aggregate or chart');

  tree = setDate(harness, tree, '结束日期', '2026-02-30');
  assert.equal(dateInput(tree, '结束日期').props.value, '2026-02-30');
  assertNoAggregates(tree, 'an impossible calendar date must not mount aggregates');

  tree = setDate(harness, tree, '结束日期', '2026-09-30');
  assertNoAggregates(tree, 'a reversed interval must not mount aggregates');

  tree = setDate(harness, tree, '结束日期', '2026-10-05');
  ({ metrics, charts } = aggregateNodes(tree));
  assert.equal(metrics.length, 4, 'a valid correction restores the original aggregate components');
  assert.equal(charts.length, 2);
  const createdAtBounds = [
    ['created_at', 'greater_than_or_equal'],
    ['created_at', 'less_than'],
  ];
  assertJsonEqual(metrics[0].props.filter.map(item => [item.field, item.operator]), createdAtBounds);
  const start = Date.parse(metrics[0].props.filter[0].value);
  const endExclusive = Date.parse(metrics[0].props.filter[1].value);
  assert.ok(Number.isFinite(start) && Number.isFinite(endExclusive) && start < endExclusive, 'valid ranges retain an ordered, exclusive end boundary');
  assert.ok(metrics.every(metric => JSON.stringify(metric.props.filter) === JSON.stringify(metrics[0].props.filter)), 'the valid date bounds are applied to each existing metric');
  assertJsonEqual(charts.find(chart => chart.props.objectName === 'forge_service_settlement').props.filter.map(item => [item.field, item.operator]), createdAtBounds);

  tree = setDate(harness, tree, '结束日期', '');
  assertNoAggregates(tree, 'clearing only one endpoint remains invalid instead of becoming an unbounded query');
  tree = setDate(harness, tree, '开始日期', '');
  ({ metrics, charts } = aggregateNodes(tree));
  assert.equal(metrics.length, 4, 'clearing both endpoints restores the full-range view');
  assert.equal(charts.length, 2);
  assert.ok(metrics.every(metric => metric.props.filter === undefined));
  assert.ok(charts.every(chart => chart.props.filter === undefined));
});

test('service type, region, and urgency filters remain exclusive to the service-order chart', async () => {
  const harness = createHarness();
  let tree = await harness.flushEffects();
  tree = setDate(harness, tree, '开始日期', '2026-10-01');
  tree = setDate(harness, tree, '结束日期', '2026-10-05');
  serviceNodes(tree, node => node.type === 'input' && node.props['aria-label'] === '服务类型')[0].props.onChange({ target: { value: '维修' } });
  tree = harness.render();
  serviceNodes(tree, node => node.type === 'input' && node.props['aria-label'] === '区域')[0].props.onChange({ target: { value: '苏州' } });
  tree = harness.render();
  serviceNodes(tree, node => node.type === 'ForgeSelect' && node.props.label === '紧急度')[0].props.onChange('urgent');
  tree = harness.render();

  const { metrics, charts } = aggregateNodes(tree);
  const orderChart = charts.find(chart => chart.props.objectName === 'forge_service_order');
  const settlementChart = charts.find(chart => chart.props.objectName === 'forge_service_settlement');
  assert.ok(orderChart);
  assert.ok(settlementChart);
  const orderFields = orderChart.props.filter.map(item => [item.field, item.operator, item.value instanceof Date ? 'date' : item.value]);
  assert.ok(orderFields.some(([field, operator, value]) => field === 'service_type' && operator === 'icontains' && value === '维修'));
  assert.ok(orderFields.some(([field, operator, value]) => field === 'region' && operator === 'icontains' && value === '苏州'));
  assert.ok(orderFields.some(([field, operator, value]) => field === 'urgency' && operator === 'equals' && value === 'urgent'));
  assert.ok(metrics.every(metric => !JSON.stringify(metric.props.filter).includes('service_type')));
  assert.ok(metrics.every(metric => !JSON.stringify(metric.props.filter).includes('region')));
  assert.ok(metrics.every(metric => !JSON.stringify(metric.props.filter).includes('urgency')));
  assert.ok(!JSON.stringify(settlementChart.props.filter).includes('service_type'));
  assert.ok(!JSON.stringify(settlementChart.props.filter).includes('region'));
  assert.ok(!JSON.stringify(settlementChart.props.filter).includes('urgency'));
});
