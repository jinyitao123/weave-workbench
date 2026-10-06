import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { PageSchema } from '@objectstack/spec/ui';
import { createServicePageHarness, serviceButton, serviceNodes, serviceText } from './service-page-react-harness.mjs';
import { ServiceDispatchPage } from '../src/pages/sales-service-workspace.page.ts';
import { serviceManagerPermission, serviceOperatorPermission } from '../src/permissions/otc-role.permission.ts';
import { serviceDispatchRange } from '../src/pages/sales-service-dispatch.panel.ts';

function ResourceScheduleGrid() {}

function response(payload, status = 200) {
  return { ok: status < 400, status, json: async () => payload, headers: new Headers(), blob: async () => new Blob() };
}

function nestedNodes(value, predicate, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  const matches = predicate(value) ? [value] : [];
  return [...matches, ...Object.values(value).flatMap(child => Array.isArray(child)
    ? child.flatMap(item => nestedNodes(item, predicate, seen))
    : nestedNodes(child, predicate, seen))];
}

function serviceOrder(index, date, overrides = {}) {
  const number = String(index).padStart(3, '0');
  const owner = 'dispatch-engineer-' + (index % 5 + 1);
  return {
    id: 'service-order-' + number,
    code: 'WO-' + number,
    name: '服务工单 ' + number,
    service_object: '现场设备',
    service_type: index % 2 ? '维修' : '巡检',
    region: index % 2 ? '苏州' : '上海',
    urgency: index % 10 === 0 ? 'urgent' : 'medium',
    status: index % 2 ? 'pending_receive' : 'in_progress',
    engineer_id: owner,
    engineer_name: '服务工程师 ' + (index % 5 + 1),
    scheduled_at: date,
    sla_due_at: null,
    next_step: '服务办理',
    ...overrides,
  };
}

function serviceTransport({ activeRows = [], slaRows = [], denyRead = false, manager = true } = {}) {
  const calls = [];
  const transport = async (url, options = {}) => {
    const parsed = new URL(url);
    const route = parsed.pathname.replace('/api/v1', '');
    const method = String(options.method || 'GET').toUpperCase();
    calls.push({ route, method, search: parsed.search });
    if (route === '/auth/get-session') return response({ user: { id: 'dispatch-manager' } });
    if (route === '/auth/me/permissions') return response({ systemPermissions: manager ? serviceManagerPermission.systemPermissions : serviceOperatorPermission.systemPermissions });
    if (route === '/actions/forge_service_order/service_order_manager_context') return manager ? response({ canManage: true }) : response({ error: { message: 'forbidden' } }, 403);
    if (route === '/data/forge_service_order' && parsed.search) {
      if (denyRead) return response({ error: { message: 'forbidden' } }, 403);
      const rawFilter = parsed.searchParams.get('$filter') || '{}';
      const filter = JSON.parse(rawFilter);
      const rows = filter.sla_due_at ? slaRows : activeRows;
      const skip = Number(parsed.searchParams.get('$skip') || 0);
      const top = Number(parsed.searchParams.get('$top') || 200);
      return response({ result: { data: { records: rows.slice(skip, skip + top), totalCount: rows.length } } });
    }
    if (route.startsWith('/data/forge_service_order/')) {
      const id = decodeURIComponent(route.slice('/data/forge_service_order/'.length));
      const row = [...activeRows, ...slaRows].find(item => item.id === id);
      return row ? response({ record: row }) : response({ error: { message: 'record missing' } }, 404);
    }
    return response({});
  };
  return { transport, calls };
}

const globals = { ResourceScheduleGrid };

test('dispatch page exposes four shared tabs and keeps the original pending-dispatch ListView query', async () => {
  PageSchema.parse(ServiceDispatchPage);
  const parse = ts.transpileModule(ServiceDispatchPage.source, {
    fileName: 'page_service_dispatch.tsx',
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  });
  assert.deepEqual(parse.diagnostics, []);

  const pending = serviceOrder(1, null, { status: 'pending_dispatch', engineer_id: null, engineer_name: '' });
  const harness = createServicePageHarness(ServiceDispatchPage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    records: { forge_service_order: [pending] },
    globals,
  });
  const tree = await harness.flushEffects();
  const tabs = serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '派工中心视图')[0];
  assert.ok(tabs);
  assert.equal(JSON.stringify(tabs.props.items.map(item => item.value)), JSON.stringify(['pending_dispatch', 'calendar', 'resource', 'sla']));
  assert.equal(tabs.props.value, 'pending_dispatch');
  const list = serviceNodes(tree, node => node.type === 'ListView')[0];
  assert.equal(JSON.stringify(list.props.filters), JSON.stringify(['status', '=', 'pending_dispatch']));
  assert.equal(serviceNodes(tree, node => node.type === 'ResourceScheduleGrid').length, 0);
});

test('calendar reads every service-order page, filters actual fields and opens the source record from an event', async () => {
  const range = serviceDispatchRange('2026-10-05', 7);
  const orders = Array.from({ length: 250 }, (_, index) => serviceOrder(index + 1, range.dates[index % range.dates.length]));
  const fixture = serviceTransport({ activeRows: orders });
  const harness = createServicePageHarness(ServiceDispatchPage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    transport: fixture.transport,
    globals,
  });
  let tree = await harness.flushEffects();
  serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '派工中心视图')[0].props.onValueChange('calendar');
  tree = await harness.flushEffects();

  const dataCalls = harness.calls.filter(call => call.url.startsWith('/data/forge_service_order?'));
  assert.equal(dataCalls.length, 2, 'the calendar reads the 200-row first page and the remaining 50 rows');
  assert.deepEqual(dataCalls.map(call => Number(new URLSearchParams(call.url.split('?')[1]).get('$skip'))), [0, 200]);
  const grid = serviceNodes(tree, node => node.type === 'ResourceScheduleGrid')[0];
  assert.ok(grid);
  assert.equal(grid.props.resources.length, 5, 'resources come from the engineer identities on authorized orders');
  assert.equal(grid.props.dateColumns.length, 7);
  assert.equal(grid.props.dateColumns[0].key, range.start);
  assert.equal(grid.props.dateColumns[6].key, range.end);
  assert.equal(grid.props.events.length, 250);
  assert.equal(grid.props.events[0].id, orders[0].id, 'the event retains its full source-order id for detail readback');
  assert.equal(grid.props.events[0].dateKey, range.dates[0]);
  assert.equal(grid.props.events[0].subtitle.includes('pending_receive'), false, 'visible event text does not expose status codes');

  const search = serviceNodes(tree, node => node.type === 'input' && node.props['aria-label'] === '搜索派工工单')[0];
  search.props.onChange({ target: { value: 'WO-250' } });
  tree = harness.render();
  assert.equal(serviceNodes(tree, node => node.type === 'ResourceScheduleGrid')[0].props.events.length, 1, 'search scans the actual work-order business fields');

  serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '派工周期')[0].props.onValueChange('28');
  tree = harness.render();
  const monthGrid = serviceNodes(tree, node => node.type === 'ResourceScheduleGrid')[0];
  assert.equal(monthGrid.props.dateColumns.length, 28);
  assert.equal(monthGrid.props.dateColumns[27].key, '2026-11-01');

  serviceButton(tree, '重置筛选')?.props.onClick();
  tree = harness.render();
  const resetGrid = serviceNodes(tree, node => node.type === 'ResourceScheduleGrid')[0];
  assert.equal(resetGrid.props.events.length, 250);
  resetGrid.props.onEventClick(resetGrid.props.events[0]);
  await harness.settle();
  assert.ok(harness.calls.some(call => call.method === 'GET' && call.path === '/data/forge_service_order/' + orders[0].id), 'event clicks open the normal source order read');
});

test('resource load uses an engineer table, separate table paging keys, and a real engineer click-through', async () => {
  const activeRows = Array.from({ length: 21 }, (_, index) => serviceOrder(index + 1, null, {
    engineer_id: 'dispatch-engineer-' + String(index + 1).padStart(2, '0'),
    engineer_name: '服务工程师 ' + String(index + 1).padStart(2, '0'),
    status: 'in_progress',
    urgency: index === 0 ? 'urgent' : 'medium',
  }));
  const unassigned = serviceOrder(22, null, { engineer_id: null, engineer_name: '未关联账号的姓名', status: 'pending_receive' });
  const fixture = serviceTransport({ activeRows: [...activeRows, unassigned] });
  const harness = createServicePageHarness(ServiceDispatchPage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    transport: fixture.transport,
    globals,
  });
  let tree = await harness.flushEffects();
  serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '派工中心视图')[0].props.onValueChange('resource');
  tree = await harness.flushEffects();
  assert.equal(serviceNodes(tree, node => node.type === 'ResourceScheduleGrid').length, 0, 'resource load is a per-engineer table rather than a second calendar');
  let tables = nestedNodes(tree, node => node.type === 'RecordTable');
  assert.equal(tables.length, 2, 'one paged engineer summary and one combined issue ledger are shown');
  const resourcesTable = tables.find(node => node.props.schema.columns.some(column => column.accessorKey === 'activeCount'));
  const issueTable = tables.find(node => node.props.schema.columns.some(column => column.accessorKey === 'issueLabels'));
  assert.ok(resourcesTable && issueTable);
  assert.equal(resourcesTable.props.schema.rowCount, 21);
  assert.equal(issueTable.props.schema.rowCount, 22);
  assert.equal(JSON.stringify(resourcesTable.props.schema.columns.map(column => column.accessorKey)), JSON.stringify(['label', 'activeCount', 'scheduledCount', 'urgentCount', 'unplannedCount']));

  resourcesTable.props.schema.onPageChange(2);
  tree = harness.render();
  tables = nestedNodes(tree, node => node.type === 'RecordTable');
  assert.equal(tables.find(node => node.props.schema.columns.some(column => column.accessorKey === 'activeCount')).props.schema.page, 2);
  assert.equal(tables.find(node => node.props.schema.columns.some(column => column.accessorKey === 'issueLabels')).props.schema.page, 1, 'each RecordTable keeps an independent page index');

  const firstEngineer = tables.find(node => node.props.schema.columns.some(column => column.accessorKey === 'activeCount')).props.schema.data[0];
  const engineerButton = nestedNodes(tree, node => node.type === 'button' && serviceText(node).trim() === firstEngineer.label)[0];
  assert.ok(engineerButton, 'the resource row exposes its readable engineer label');
  engineerButton.props.onClick();
  tree = harness.render();
  const tablesAfterFilter = nestedNodes(tree, node => node.type === 'RecordTable');
  const orderTable = tablesAfterFilter.find(node => node.props.schema.columns.some(column => column.accessorKey === 'code'));
  assert.equal(orderTable.props.schema.rowCount, 1, 'selecting a name filters the engineer work-order ledger');
  assert.equal(orderTable.props.schema.data[0].engineer_id, firstEngineer.id);
  const visibleButtonText = nestedNodes(tree, node => node.type === 'button').map(serviceText).join(' ');
  assert.equal(visibleButtonText.includes('dispatch-engineer-'), false, 'internal engineer IDs do not appear in visible controls');
});

test('SLA tab is a raw due-date ledger, while nonmanagers and failed reads never receive a fake zero state', async () => {
  const dueRows = [
    serviceOrder(1, null, { status: 'in_progress', sla_due_at: '2026-10-06' }),
    serviceOrder(2, null, { status: 'pending_receive', sla_due_at: 'unknown-date' }),
  ];
  const fixture = serviceTransport({ slaRows: dueRows });
  const manager = createServicePageHarness(ServiceDispatchPage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    transport: fixture.transport,
    globals,
  });
  let tree = await manager.flushEffects();
  serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '派工中心视图')[0].props.onValueChange('sla');
  tree = await manager.flushEffects();
  const notice = serviceNodes(tree, node => node.type === 'ForgeNotice' && serviceText(node).includes('不作风险判定'))[0];
  assert.ok(notice);
  const slaTable = serviceNodes(tree, node => node.type === 'RecordTable')[0];
  assert.equal(slaTable.props.schema.rowCount, 2, 'valid due dates and malformed due dates remain in the raw ledger');
  assert.ok(slaTable.props.schema.columns.some(column => column.accessorKey === 'sla_due_at' && column.header === 'SLA 到期日'));
  assert.equal(serviceNodes(tree, node => node.type === 'ObjectMetric' && /风险|达标/.test(node.props.label || '')).length, 0);

  const denied = createServicePageHarness(ServiceDispatchPage, {
    permissions: serviceOperatorPermission.systemPermissions,
    records: { forge_service_order: [] },
    globals,
  });
  const deniedTree = await denied.flushEffects();
  assert.equal(serviceNodes(deniedTree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '派工中心视图').length, 0);
  assert.equal(denied.calls.some(call => call.url.startsWith('/data/forge_service_order?')), false, 'direct page access does not start manager data reads');

  const forbiddenTransport = serviceTransport({ denyRead: true });
  const unreadable = createServicePageHarness(ServiceDispatchPage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    transport: forbiddenTransport.transport,
    globals,
  });
  tree = await unreadable.flushEffects();
  serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '派工中心视图')[0].props.onValueChange('resource');
  tree = await unreadable.flushEffects();
  assert.ok(serviceNodes(tree, node => node.type === 'ForgeNotice' && node.props.tone === 'error' && serviceText(node).includes('无权读取派工数据')).length > 0);
  assert.equal(serviceNodes(tree, node => node.type === 'ListSummary').length, 0, '403 is unavailable data, not an all-zero load summary');
});
