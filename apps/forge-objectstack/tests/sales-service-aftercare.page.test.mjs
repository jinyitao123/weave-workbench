import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createServicePageHarness,
  serviceButton,
  serviceNodes,
} from './service-page-react-harness.mjs';
import { RepairPoolPage, ServicePartRequestsPage } from '../src/pages/sales-service-aftercare.page.ts';
import { RepairRequestViews, ServicePartRequestViews } from '../src/views/service-workspace.view.ts';
import { serviceOperatorPermission, warehouseOperatorPermission } from '../src/permissions/otc-role.permission.ts';

const serviceOperator = serviceOperatorPermission.systemPermissions;

test('aftercare routes use the workspace header and keep their declared ListView and aggregate wiring', async () => {
  const pages = [
    [RepairPoolPage, '报修池', 'wrench', 'forge_repair_request', RepairRequestViews],
    [ServicePartRequestsPage, '备件工单', 'package-search', 'forge_service_part_request', ServicePartRequestViews],
  ];

  for (const [page, title, icon, objectName, view] of pages) {
    const harness = createServicePageHarness(page, {
      permissions: serviceOperator,
      records: { [objectName]: [] },
    });
    const tree = await harness.flushEffects();
    const header = serviceNodes(tree, node => node.type === 'WorkspaceHeader')[0];
    assert.ok(header, `${page.name} uses the public workspace header`);
    assert.equal(header.props.variant, 'workspace');
    assert.equal(header.props.title, title);
    assert.equal(header.props.icon, icon);
    assert.equal(typeof header.props.subtitle, 'string');
    assert.equal(header.props.subtitleClassName, 'sa-subtitle');
    assert.equal(JSON.stringify(header.props.breadcrumbItems.map(item => item.label)), JSON.stringify(['服务管理', title]));

    const list = serviceNodes(tree, node => node.type === 'ListView')[0];
    assert.ok(list, `${page.name} keeps the server-backed ListView`);
    assert.equal(list.props.data.object, objectName);
    assert.equal(JSON.stringify(list.props.columns), JSON.stringify(view.list.columns));
    assert.equal(JSON.stringify(list.props.searchableFields), JSON.stringify(view.list.searchableFields));
    assert.equal(JSON.stringify(list.props.userFilters), JSON.stringify(view.list.userFilters));

    if (page === RepairPoolPage) {
      const metrics = serviceNodes(tree, node => node.type === 'ObjectMetric');
      assert.deepEqual(metrics.slice(0, 4).map(metric => metric.props.label), ['待处理', '重复上报', '今日新报修', '已转工单']);
      assert.equal(JSON.stringify(metrics[3].props.filter), JSON.stringify([{ field: 'status', operator: 'equals', value: 'converted' }]));
      assert.ok(serviceNodes(header, node => node.type === 'WorkspaceToolbar').length > 0);
      assert.ok(serviceButton(tree, '新增报修'), 'only the real create action is labeled as a create action');
      assert.equal(serviceButton(tree, '分享一般报修'), undefined, 'the unsupported QR-sharing path is not presented as a working action');
    } else {
      const toolbar = serviceNodes(tree, node => node.type === 'WorkspaceToolbar').find(node => node.props.primaryAction);
      assert.ok(toolbar, 'the part-request list places its existing create action in the public toolbar');
      assert.ok(serviceButton(tree, '新建备件工单'));
    }
  }
});

test('repair create opens the existing form and cancellation preserves filters without posting', async () => {
  const harness = createServicePageHarness(RepairPoolPage, {
    permissions: serviceOperator,
    records: { forge_repair_request: [] },
  });
  let tree = await harness.flushEffects();

  const status = serviceNodes(tree, node => node.type === 'ForgeSelect' && node.props.label === '状态')[0];
  status.props.onChange('duplicate');
  tree = harness.render();
  const listBefore = serviceNodes(tree, node => node.type === 'ListView')[0];
  assert.equal(JSON.stringify(listBefore.props.filters), JSON.stringify(['status', '=', 'duplicate']));

  serviceButton(tree, '新增报修').props.onClick();
  tree = harness.render();
  const dialog = serviceNodes(tree, node => node.type === 'CompositeDialog')[0];
  assert.equal(dialog.props.title, '新建报修');
  assert.equal(serviceNodes(tree, node => node.type === 'ObjectForm')[0].props.objectName, 'forge_repair_request');
  dialog.props.onOpenChange(false);
  tree = harness.render();

  assert.equal(JSON.stringify(serviceNodes(tree, node => node.type === 'ListView')[0].props.filters), JSON.stringify(['status', '=', 'duplicate']));
  assert.ok(serviceButton(tree, '新增报修'), 'the service-operator affordance remains visible after cancel');
  assert.equal(harness.calls.filter(call => call.method === 'POST' && call.path === '/actions/forge_repair_request/service_repair_request_create').length, 0);
});

test('part-request create opens the existing single-request form and cancellation preserves filters without posting', async () => {
  const harness = createServicePageHarness(ServicePartRequestsPage, {
    permissions: serviceOperator,
    records: { forge_service_part_request: [] },
  });
  let tree = await harness.flushEffects();

  serviceNodes(tree, node => node.type === 'ForgeSelect' && node.props.label === '状态')[0].props.onChange('open');
  tree = harness.render();
  serviceNodes(tree, node => node.type === 'ForgeSelect' && node.props.label === '执行状态')[0].props.onChange('pending_outbound');
  tree = harness.render();
  const expectedFilters = ['and', ['status', '=', 'open'], ['execution_status', '=', 'pending_outbound']];
  assert.equal(JSON.stringify(serviceNodes(tree, node => node.type === 'ListView')[0].props.filters), JSON.stringify(expectedFilters));

  serviceButton(tree, '新建备件工单').props.onClick();
  tree = harness.render();
  const dialog = serviceNodes(tree, node => node.type === 'CompositeDialog')[0];
  assert.equal(dialog.props.title, '新建备件工单');
  assert.equal(serviceNodes(tree, node => node.type === 'ObjectForm')[0].props.objectName, 'forge_service_part_request');
  dialog.props.onOpenChange(false);
  tree = harness.render();

  assert.equal(JSON.stringify(serviceNodes(tree, node => node.type === 'ListView')[0].props.filters), JSON.stringify(expectedFilters));
  assert.ok(serviceButton(tree, '新建备件工单'), 'the service-operator affordance remains visible after cancel');
  assert.equal(harness.calls.filter(call => call.method === 'POST' && call.path === '/actions/forge_service_part_request/service_part_request_create').length, 0);
});

test('warehouse-only access does not expose the service-operator part-request creation action', async () => {
  const harness = createServicePageHarness(ServicePartRequestsPage, {
    permissions: warehouseOperatorPermission.systemPermissions,
    records: { forge_service_part_request: [] },
  });
  const tree = await harness.flushEffects();
  assert.ok(serviceNodes(tree, node => node.type === 'WorkspaceHeader').length > 0);
  assert.ok(serviceNodes(tree, node => node.type === 'ListView').length > 0);
  assert.equal(serviceButton(tree, '新建备件工单'), undefined);
  assert.equal(harness.calls.filter(call => call.method === 'POST' && call.path === '/actions/forge_service_part_request/service_part_request_create').length, 0);
});
