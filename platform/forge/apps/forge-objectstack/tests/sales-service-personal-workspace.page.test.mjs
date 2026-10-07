import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { PageSchema } from '@objectstack/spec/ui';
import { ServiceOrder } from '../src/objects/sales.object.ts';
import { ServicePartRequestViews } from '../src/views/service-workspace.view.ts';
import { ServiceOrdersPage, ServiceWorkspacePage } from '../src/pages/sales-service-workspace.page.ts';
import {
  servicePersonalActorRows,
  servicePersonalDateRange,
  servicePersonalListFilters,
  servicePersonalRelatedListScope,
  servicePersonalTodayProjection,
} from '../src/pages/sales-service-personal-workspace.panel.ts';
import { serviceManagerPermission, serviceOperatorPermission } from '../src/permissions/otc-role.permission.ts';
import { ServiceOrderCreateQuotation, ServiceOrderCreateSettlement, ServiceQuotationCreateSettlement } from '../src/actions/sales.action.ts';
import { createServicePageHarness, serviceButton, serviceNodes, serviceText } from './service-page-react-harness.mjs';

function response(payload, status = 200) {
  return { ok: status < 400, status, json: async () => payload, headers: new Headers() };
}

function order(id, overrides = {}) {
  return {
    id,
    code: 'WO-' + id,
    name: '工单 ' + id,
    status: 'pending_receive',
    engineer_id: 'service-page-actor',
    engineer_name: '服务工程师',
    owner_id: 'service-page-actor',
    responsible_id: 'service-page-actor',
    scheduled_at: '2026-10-05',
    urgency: 'medium',
    service_type: '维修',
    region: '苏州',
    service_object: '设备 A',
    revision: 1,
    ...overrides,
  };
}

function serviceTransport({
  actor = 'service-page-actor',
  manager = false,
  rows = [],
  ignoreEngineerFilter = false,
  missingUser = false,
  dateFailures = 0,
  orderReadFailures = 0,
  timezone = 'Asia/Shanghai',
  legacyDateOnly = false,
} = {}) {
  const calls = [];
  let remainingDateFailures = dateFailures;
  let remainingOrderFailures = orderReadFailures;
  const transport = async (url, options = {}) => {
    const parsed = new URL(url);
    const route = parsed.pathname.replace('/api/v1', '');
    const method = String(options.method || 'GET').toUpperCase();
    calls.push({ route, method, search: parsed.search });
    if (route === '/auth/get-session') return response(missingUser ? { user: {} } : { user: { id: actor } });
    if (route === '/auth/me/permissions') return response({ systemPermissions: manager ? serviceManagerPermission.systemPermissions : serviceOperatorPermission.systemPermissions });
    if (route === '/actions/forge_service_order/service_order_manager_context') return manager ? response({ canManage: true }) : response({ error: { message: 'forbidden' } }, 403);
    if (route === '/actions/global/organization_business_date_query') {
      if (remainingDateFailures > 0) {
        remainingDateFailures--;
        return response({ error: { message: 'business date unavailable' } }, 503);
      }
      return response({ business_date: '2026-10-05', ...(legacyDateOnly ? {} : { timezone }) });
    }
    if (route === '/data/forge_service_order' && parsed.search) {
      if (remainingOrderFailures > 0) {
        remainingOrderFailures--;
        return response({ error: { message: 'forbidden' } }, 403);
      }
      const where = JSON.parse(parsed.searchParams.get('$filter') || '{}');
      const filterActor = where.engineer_id;
      const matching = ignoreEngineerFilter ? rows : rows.filter(row => String(row.engineer_id && (row.engineer_id.id || row.engineer_id.value) || row.engineer_id || '') === String(filterActor || ''));
      const skip = Number(parsed.searchParams.get('$skip') || 0);
      const top = Number(parsed.searchParams.get('$top') || 200);
      return response({ result: { data: { records: matching.slice(skip, skip + top), totalCount: matching.length } } });
    }
    if (route.startsWith('/data/forge_service_order/')) {
      const id = decodeURIComponent(route.slice('/data/forge_service_order/'.length));
      const record = rows.find(row => row.id === id);
      return record ? response({ record }) : response({ error: { message: 'record missing' } }, 404);
    }
    return response({});
  };
  return { transport, calls };
}

function globals() {
  function DocumentWorkspace() {}
  function DateRangeControl() {}
  function DataEmptyState() {}
  return { DocumentWorkspace, DateRangeControl, DataEmptyState };
}

function getWorkspace(tree) {
  return serviceNodes(tree, node => node.type === 'DocumentWorkspace')[0];
}

function listView(tree, objectName = 'forge_service_order') {
  return serviceNodes(tree, node => node.type === 'ListView' && node.props.data?.object === objectName)[0];
}

function assertNoRefreshButton(tree) {
  assert.equal(serviceNodes(tree, node => node.type === 'button' && serviceText(node).trim() === '刷新').length, 0, 'related-document tabs do not add a visible refresh button');
}

function flattenFilters(filter) {
  if (!Array.isArray(filter)) return [];
  if (filter[0] === 'and') return filter.slice(1).flatMap(flattenFilters);
  return [filter];
}

function assertJsonEqual(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

test('manager Today reads only the engineer account, ignores broader returned rows, and keeps original action checks', async () => {
  const actor = 'manager-engineer-1';
  const rows = [
    order('self-today', { engineer_id: actor, owner_id: actor, responsible_id: actor, scheduled_at: '2026-10-05', status: 'pending_receive' }),
    order('self-unplanned', { engineer_id: actor, owner_id: 'other-owner', responsible_id: actor, scheduled_at: null, status: 'in_progress' }),
    order('self-completed', { engineer_id: actor, scheduled_at: '2026-10-05', status: 'completed', completed_at: '2026-10-04T16:30:00.000Z' }),
    order('other-actor', { engineer_id: 'different-engineer', owner_id: 'different-engineer', responsible_id: 'different-engineer', scheduled_at: '2026-10-05', status: 'pending_receive' }),
  ];
  const fixture = serviceTransport({ actor, manager: true, rows, ignoreEngineerFilter: true });
  const harness = createServicePageHarness(ServiceWorkspacePage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    users: { id: actor },
    transport: fixture.transport,
    globals: globals(),
  });
  const tree = await harness.flushEffects();
  const queryCalls = fixture.calls.filter(call => call.route === '/data/forge_service_order' && call.search);
  assert.equal(queryCalls.length, 1);
  assert.deepEqual(JSON.parse(new URLSearchParams(queryCalls[0].search).get('$filter')), { engineer_id: actor }, 'a manager still sends the mandatory current-engineer filter');

  const summary = serviceNodes(tree, node => node.type === 'ListSummary' && node.props['aria-label'] === '接单中心今日概览')[0];
  assert.ok(summary);
  assertJsonEqual(summary.props.items.map(item => item.value), [2, 1, 1, 1, '—'], 'the five-item overview excludes another engineer and keeps SLA unavailable');
  assertJsonEqual(summary.props.items.map(item => item.description), ['今日排程的工单数', '本人待接单', '本人服务中', '本月已完工 1 单', 'SLA判定暂不可用']);
  const main = serviceNodes(tree, node => node.type === 'main')[0];
  assert.ok(main.children.findIndex(node => node?.type === 'ListSummary') < main.children.findIndex(node => node?.type === 'WorkspaceToolbar'), 'the five metrics stay above the top tabs');

  const workspace = getWorkspace(tree);
  const todaySection = serviceNodes(workspace.props.main, node => node.type === 'DocumentSection' && String(node.props.title).startsWith('今日行程'))[0];
  const todayTable = serviceNodes(todaySection, node => node.type === 'RecordTable')[0];
  assert.equal(todayTable.props.schema.rowCount, 2);
  assertJsonEqual(todayTable.props.schema.data.map(row => row.id), ['self-today', 'self-completed']);
  serviceButton(todayTable, 'WO-self-today').props.onClick();
  const detail = await harness.settle();
  assert.equal(serviceButton(detail, '接单'), undefined, 'manager access does not bypass the existing service-operator role and triple-assignment guard');
  assert.ok(fixture.calls.some(call => call.method === 'GET' && call.route === '/data/forge_service_order/self-today'));
});

test('missing identity never queries all orders, and a forbidden read shows no zero summary before retry recovery', async () => {
  const missing = serviceTransport({ missingUser: true, manager: true });
  const missingHarness = createServicePageHarness(ServiceWorkspacePage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    transport: missing.transport,
    globals: globals(),
  });
  const missingTree = await missingHarness.flushEffects();
  assert.equal(missing.calls.some(call => call.route === '/data/forge_service_order' && call.search), false, 'no current id means no unfiltered fallback');
  assert.equal(serviceNodes(missingTree, node => node.type === 'ListSummary').length, 0);

  const fixture = serviceTransport({ manager: true, rows: [order('retry-row')], orderReadFailures: 1 });
  const harness = createServicePageHarness(ServiceWorkspacePage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    transport: fixture.transport,
    globals: globals(),
  });
  let tree = await harness.flushEffects();
  assert.equal(serviceNodes(tree, node => node.type === 'ListSummary').length, 0, '403 is unavailable data rather than five zero counts');
  assert.ok(serviceNodes(tree, node => node.type === 'ForgeNotice' && node.props.tone === 'error' && serviceText(node).includes('无权读取'))[0]);
  serviceButton(tree, '重试').props.onClick();
  tree = await harness.flushEffects();
  assert.equal(fixture.calls.filter(call => call.route === '/data/forge_service_order' && call.search).length, 2);
  const summary = serviceNodes(tree, node => node.type === 'ListSummary' && node.props['aria-label'] === '接单中心今日概览')[0];
  assertJsonEqual(summary.props.items.map(item => item.value), [1, 1, 0, 0, '—']);
  assertJsonEqual(summary.props.items.map(item => item.description), ['今日排程的工单数', '本人待接单', '本人服务中', '本月已完工 0 单', 'SLA判定暂不可用']);
});

test('My Orders keeps server-side engineer scope while status, planned-date, type, urgency, region and native search stay usable', async () => {
  const actor = 'manager-personal-2';
  const rows = [order('personal-row', { engineer_id: actor }), order('foreign-row', { engineer_id: 'another-user' })];
  const fixture = serviceTransport({ actor, manager: true, rows });
  const harness = createServicePageHarness(ServiceWorkspacePage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    users: { id: actor },
    records: { forge_service_order: [rows[0]] },
    transport: fixture.transport,
    globals: globals(),
  });
  let tree = await harness.flushEffects();
  const managerTabs = serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '接单中心工作范围')[0];
  assertJsonEqual(managerTabs.props.items.map(item => item.value), ['today', 'my-orders', 'performance', 'parts', 'my-quotations', 'my-settlements']);
  const workspace = getWorkspace(tree);
  serviceButton(workspace.props.sidebar, '我的工单').props.onClick();
  tree = harness.render();

  const statusTabs = serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '我的工单状态')[0];
  assertJsonEqual(statusTabs.props.items.map(item => item.value), ['all', ...ServiceOrder.fields.status.options.map(option => option.value)]);
  let list = listView(tree);
  assertJsonEqual(list.props.filters, ['engineer_id', '=', actor], 'all-history My Orders is still scoped by engineer account');
  assert.equal(list.props.userActions.refresh, false, 'the personal My Orders list does not expose the native refresh action');
  assertJsonEqual(list.props.searchableFields, ['code', 'name', 'service_object', 'service_type', 'contact_phone']);
  assert.equal(list.props.initialSearchTerm, '', 'native ListView search starts empty and owns its input');
  list.props.onSearchChange('WO-personal');
  assert.equal(typeof list.props.onSearchChange, 'function', 'search uses the native toolbar callback rather than a duplicate page search');
  assert.ok(harness.states.some(state => state && state.search === 'WO-personal'), 'native search callback is observed without controlling/remounting the input per keystroke');

  statusTabs.props.onValueChange('in_progress');
  tree = harness.render();
  list = listView(tree);
  assertJsonEqual(list.props.filters, ['and', ['engineer_id', '=', actor], ['status', '=', 'in_progress']]);

  const dateSelect = serviceNodes(tree, node => node.type === 'ForgeSelect' && node.props.label === '计划日期')[0];
  assert.ok(dateSelect.props.options.some(option => option.value === 'custom'));
  dateSelect.props.onChange('7');
  tree = harness.render();
  list = listView(tree);
  assert.ok(flattenFilters(list.props.filters).some(filter => filter[0] === 'scheduled_at' && filter[1] === 'between' && JSON.stringify(filter[2]) === JSON.stringify(['2026-09-29', '2026-10-05'])), 'quick ranges filter the schedule date, not created_at');

  serviceNodes(tree, node => node.type === 'ForgeSelect' && node.props.label === '计划日期')[0].props.onChange('custom');
  tree = harness.render();
  const rangeControl = serviceNodes(tree, node => node.type === 'DateRangeControl' && node.props.label === '自定义计划日期范围')[0];
  assert.ok(rangeControl);
  rangeControl.props.onValueChange({ from: '2026-10-01', to: '2026-10-31' });
  tree = harness.render();
  list = listView(tree);
  assert.ok(flattenFilters(list.props.filters).some(filter => filter[0] === 'scheduled_at' && filter[1] === 'between' && JSON.stringify(filter[2]) === JSON.stringify(['2026-10-01', '2026-10-31'])));

  serviceNodes(tree, node => node.type === 'input' && node.props['aria-label'] === '服务类型筛选')[0].props.onChange({ target: { value: '维修' } });
  serviceNodes(tree, node => node.type === 'input' && node.props['aria-label'] === '区域筛选')[0].props.onChange({ target: { value: '苏州' } });
  serviceNodes(tree, node => node.type === 'ForgeSelect' && node.props.label === '紧急度')[0].props.onChange('urgent');
  tree = harness.render();
  list = listView(tree);
  const clauses = flattenFilters(list.props.filters);
  assert.ok(clauses.some(filter => filter[0] === 'service_type' && filter[1] === 'contains' && filter[2] === '维修'));
  assert.ok(clauses.some(filter => filter[0] === 'region' && filter[1] === 'contains' && filter[2] === '苏州'));
  assert.ok(clauses.some(filter => filter[0] === 'urgency' && filter[2] === 'urgent'));

  const resetKey = list.props.key;
  serviceButton(tree, '重置筛选').props.onClick();
  tree = harness.render();
  list = listView(tree);
  assertJsonEqual(list.props.filters, ['engineer_id', '=', actor], 'reset clears optional filters but preserves the mandatory engineer scope');
  assert.notEqual(list.props.key, resetKey, 'reset remounts NativeListView so its uncontrolled search term clears without remounting per keystroke');
  assert.equal(list.props.initialSearchTerm, '');

  const topTabs = serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '接单中心工作范围')[0];
  topTabs.props.onValueChange('my-quotations');
  tree = await harness.flushEffects();
  assertJsonEqual(listView(tree, 'forge_service_quotation').props.filters, ['service_order_id', 'in', ['personal-row']]);
  serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '接单中心工作范围')[0].props.onValueChange('my-settlements');
  tree = await harness.flushEffects();
  assertJsonEqual(listView(tree, 'forge_service_settlement').props.filters, ['service_order_id', 'in', ['personal-row']]);
});

test('related-document scope fails closed until current engineer assignments are complete', () => {
  const actor = 'current-engineer';
  assert.deepEqual(servicePersonalRelatedListScope('', { complete: true, rows: [] }), {
    status: 'unavailable', filter: null, error: '当前账号标识不可用，无法读取本人单据。',
  });
  assert.deepEqual(servicePersonalRelatedListScope(actor, { loading: true, complete: false, rows: [] }), {
    status: 'loading', filter: null, error: '',
  });
  for (const state of [
    { complete: false, rows: [{ id: 'order-a', engineer_id: actor }] },
    { complete: true, unavailable: true, rows: [] },
    { complete: true, rows: [{ engineer_id: actor }] },
  ]) {
    const result = servicePersonalRelatedListScope(actor, state);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.filter, null, 'partial, denied, or malformed input cannot create a broad list');
  }
  assertJsonEqual(servicePersonalRelatedListScope(actor, { complete: true, rows: [] }).filter, ['service_order_id', 'in', []]);
  const rows = [
    { id: 'current-order', engineer_id: actor, owner_id: 'stale-owner', responsible_id: 'stale-responsible' },
    { id: 'other-order', engineer_id: 'other-engineer', owner_id: actor, responsible_id: actor },
    { id: 'current-order', engineer_id: actor, owner_id: 'stale-owner', responsible_id: 'stale-responsible' },
  ];
  assertJsonEqual(servicePersonalRelatedListScope(actor, { complete: true, rows }).filter, ['service_order_id', 'in', ['current-order']]);
  const oversized = servicePersonalRelatedListScope(actor, {
    complete: true,
    rows: Array.from({ length: 120 }, (_, index) => ({ id: 'order-' + index + '-' + 'x'.repeat(70), engineer_id: actor })),
  });
  assert.equal(oversized.status, 'unavailable');
  assert.equal(oversized.filter, null, 'an oversized GET predicate is refused, never truncated or omitted');
});

test('standalone service orders page keeps its native refresh action', async () => {
  const harness = createServicePageHarness(ServiceOrdersPage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    records: { forge_service_order: [order('standalone-order')] },
    globals: globals(),
  });
  const tree = await harness.flushEffects();
  const list = listView(tree);
  assert.ok(list, 'the standalone service-order page still renders the native list');
  assert.notEqual(list.props.userActions.refresh, false, 'the standalone list keeps its default refresh affordance');
});

test('quotation and settlement scopes refresh on re-entry, preserve native list state, and follow current engineer assignment', async () => {
  const orderId = 'work-order-transfer';
  const sourceOrder = order(orderId, { engineer_id: 'engineer-a', owner_id: 'engineer-a', responsible_id: 'engineer-a', status: 'completed' });
  const quote = { id: 'quote-transfer', code: 'SQ-TRANSFER', service_order_id: orderId, owner_id: 'manager-creator', responsible_id: 'engineer-a', status: 'draft' };
  const settlement = { id: 'settlement-transfer', code: 'SS-TRANSFER', service_order_id: orderId, quotation_id: quote.id, owner_id: 'manager-creator', responsible_id: 'engineer-a', status: 'draft' };
  const records = { forge_service_order: [sourceOrder], forge_service_quotation: [quote], forge_service_settlement: [settlement] };
  const fixtureA = serviceTransport({ actor: 'engineer-a', manager: true, rows: records.forge_service_order });
  const harnessA = createServicePageHarness(ServiceWorkspacePage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    users: { id: 'engineer-a' },
    records,
    transport: fixtureA.transport,
    globals: globals(),
  });
  let tree = await harnessA.flushEffects();
  const orderQueriesBeforeQuote = fixtureA.calls.filter(call => call.route === '/data/forge_service_order' && call.search).length;
  serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '接单中心工作范围')[0].props.onValueChange('my-quotations');
  tree = await harnessA.flushEffects();
  let quoteList = listView(tree, 'forge_service_quotation');
  assertJsonEqual(quoteList.props.filters, ['service_order_id', 'in', [orderId]]);
  assertNoRefreshButton(tree);
  assert.equal(quoteList.props.userActions.refresh, false, 'the quotation view does not expose a second refresh action');
  assert.equal(quoteList.props.mobileLayout, 'table');
  assert.equal(quoteList.props.columns.length, 8, 'all formal quotation columns reach the native list');
  const statusSelection = { status: ['draft'] };
  const userFilter = [{ field: 'name', operator: 'contains', value: '转派测试' }];
  const sort = [{ field: 'created_at', order: 'desc' }];
  quoteList.props.onSearchChange('SQ-TRANSFER');
  quoteList.props.onFilterChange(userFilter);
  quoteList.props.onUserFilterSelectionsChange(statusSelection);
  quoteList.props.onSortChange(sort);
  tree = harnessA.render();
  quoteList = listView(tree, 'forge_service_quotation');
  assert.equal(quoteList.props.initialSearchTerm, 'SQ-TRANSFER');
  assertJsonEqual(quoteList.props.initialFilters, userFilter);
  assertJsonEqual(quoteList.props.userFilterSelections, statusSelection);
  assertJsonEqual(quoteList.props.sort, sort);
  serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '接单中心工作范围')[0].props.onValueChange('my-settlements');
  tree = await harnessA.flushEffects();
  const settlementList = listView(tree, 'forge_service_settlement');
  assertJsonEqual(settlementList.props.filters, ['service_order_id', 'in', [orderId]]);
  assertNoRefreshButton(tree);
  assert.equal(settlementList.props.userActions.refresh, false, 'the settlement view does not expose a second refresh action');
  assert.equal(settlementList.props.mobileLayout, 'table');
  assert.ok(fixtureA.calls.filter(call => call.route === '/data/forge_service_order' && call.search).length > orderQueriesBeforeQuote, 'entering a related-document view rereads the engineer-scoped source orders');

  sourceOrder.engineer_id = 'engineer-b';
  sourceOrder.owner_id = 'engineer-b';
  sourceOrder.responsible_id = 'engineer-b';
  serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '接单中心工作范围')[0].props.onValueChange('my-orders');
  tree = await harnessA.flushEffects();
  const queriesBeforeQuoteReentry = fixtureA.calls.filter(call => call.route === '/data/forge_service_order' && call.search).length;
  serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '接单中心工作范围')[0].props.onValueChange('my-quotations');
  tree = await harnessA.flushEffects();
  quoteList = listView(tree, 'forge_service_quotation');
  assert.ok(fixtureA.calls.filter(call => call.route === '/data/forge_service_order' && call.search).length > queriesBeforeQuoteReentry, 're-entering quotations rereads current assignments');
  assertJsonEqual(quoteList.props.filters, ['service_order_id', 'in', []], 'engineer A loses quotations when the linked order is reassigned');
  assert.equal(quoteList.props.initialSearchTerm, 'SQ-TRANSFER');
  assertJsonEqual(quoteList.props.initialFilters, userFilter);
  assertJsonEqual(quoteList.props.userFilterSelections, statusSelection);
  assertJsonEqual(quoteList.props.sort, sort);
  assertNoRefreshButton(tree);
  const actorQueries = fixtureA.calls.filter(call => call.route === '/data/forge_service_order' && call.search);
  assert.ok(actorQueries.every(call => JSON.parse(new URLSearchParams(call.search).get('$filter')).engineer_id === 'engineer-a'));
  serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '接单中心工作范围')[0].props.onValueChange('my-settlements');
  tree = await harnessA.flushEffects();
  assertJsonEqual(listView(tree, 'forge_service_settlement').props.filters, ['service_order_id', 'in', []], 'engineer A also loses settlements when the linked order is reassigned');
  assertNoRefreshButton(tree);

  const fixtureB = serviceTransport({ actor: 'engineer-b', manager: true, rows: records.forge_service_order });
  const harnessB = createServicePageHarness(ServiceWorkspacePage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    users: { id: 'engineer-b' },
    records,
    transport: fixtureB.transport,
    globals: globals(),
  });
  tree = await harnessB.flushEffects();
  serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '接单中心工作范围')[0].props.onValueChange('my-quotations');
  tree = await harnessB.flushEffects();
  assertJsonEqual(listView(tree, 'forge_service_quotation').props.filters, ['service_order_id', 'in', [orderId]]);
  assertNoRefreshButton(tree);
  serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '接单中心工作范围')[0].props.onValueChange('my-settlements');
  tree = await harnessB.flushEffects();
  assertJsonEqual(listView(tree, 'forge_service_settlement').props.filters, ['service_order_id', 'in', [orderId]]);
  assertNoRefreshButton(tree);

  assert.equal(quote.owner_id, 'manager-creator');
  assert.equal(quote.responsible_id, 'engineer-a');
  assert.equal(settlement.owner_id, 'manager-creator');
  assert.equal(settlement.responsible_id, 'engineer-a');
  assert.equal([...fixtureA.calls, ...fixtureB.calls].some(call => call.method === 'POST' && /forge_service_(quotation|settlement)/.test(call.route)), false, 'scope changes only reread documents and never write them');
});

test('missing identity, 403, and incomplete assignment reads never mount an unscoped related list', async () => {
  const missing = serviceTransport({ missingUser: true, manager: true, rows: [order('unscoped-order')] });
  const missingHarness = createServicePageHarness(ServiceWorkspacePage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    transport: missing.transport,
    globals: globals(),
  });
  const missingTree = await missingHarness.flushEffects();
  assert.equal(serviceNodes(missingTree, node => node.type === 'ListView' && ['forge_service_quotation', 'forge_service_settlement'].includes(node.props.data?.object)).length, 0);
  assert.equal(missing.calls.some(call => call.route === '/data/forge_service_order' && call.search), false, 'missing identity performs no work-order query');
  assert.equal(missing.calls.some(call => call.route === '/data/forge_service_quotation' || call.route === '/data/forge_service_settlement'), false, 'missing identity never reaches related-document queries');

  const forbidden = serviceTransport({ manager: true, rows: [order('forbidden-order')], orderReadFailures: 2 });
  const forbiddenHarness = createServicePageHarness(ServiceWorkspacePage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    transport: forbidden.transport,
    globals: globals(),
  });
  let tree = await forbiddenHarness.flushEffects();
  serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '接单中心工作范围')[0].props.onValueChange('my-quotations');
  tree = await forbiddenHarness.flushEffects();
  assert.equal(listView(tree, 'forge_service_quotation'), undefined, '403 does not show an unfiltered quotation list');
  assert.ok(serviceNodes(tree, node => node.type === 'ForgeNotice' && node.props.tone === 'error' && serviceText(node).includes('无权读取'))[0]);
  assert.ok(serviceButton(tree, '重试'), 'failed assignment reads retain an error-state retry action');
  assertNoRefreshButton(tree);
  serviceButton(tree, '重试').props.onClick();
  tree = await forbiddenHarness.flushEffects();
  assertJsonEqual(listView(tree, 'forge_service_quotation').props.filters, ['service_order_id', 'in', ['forbidden-order']], 'successful retry restores the current engineer filter');
  assertNoRefreshButton(tree);
  const recoveredOrderQueries = forbidden.calls.filter(call => call.route === '/data/forge_service_order' && call.search);
  assert.ok(recoveredOrderQueries.length >= 3, 'retry reads the actor’s assigned orders again after the failed scope entry');
  assert.ok(recoveredOrderQueries.every(call => JSON.parse(new URLSearchParams(call.search).get('$filter')).engineer_id === 'service-page-actor'));

  const actor = 'partial-reader';
  const firstPage = Array.from({ length: 200 }, (_, index) => order('partial-' + index, { engineer_id: actor }));
  const calls = [];
  const partialTransport = async (url, options = {}) => {
    const parsed = new URL(url), route = parsed.pathname.replace('/api/v1', ''), method = String(options.method || 'GET').toUpperCase();
    calls.push({ route, method, search: parsed.search });
    if (route === '/auth/get-session') return response({ user: { id: actor } });
    if (route === '/auth/me/permissions') return response({ systemPermissions: serviceManagerPermission.systemPermissions });
    if (route === '/actions/forge_service_order/service_order_manager_context') return response({ canManage: true });
    if (route === '/actions/global/organization_business_date_query') return response({ business_date: '2026-10-05' });
    if (route === '/data/forge_service_order' && parsed.search) {
      const skip = Number(parsed.searchParams.get('$skip') || 0);
      return response({ records: skip === 0 ? firstPage : firstPage.slice(0, 10), totalCount: 250 });
    }
    return response({});
  };
  const partialHarness = createServicePageHarness(ServiceWorkspacePage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    users: { id: actor },
    transport: partialTransport,
    globals: globals(),
  });
  tree = await partialHarness.flushEffects();
  serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '接单中心工作范围')[0].props.onValueChange('my-settlements');
  tree = await partialHarness.flushEffects();
  assert.equal(listView(tree, 'forge_service_settlement'), undefined, 'short pagination with a larger total stays unavailable');
  assert.ok(serviceNodes(tree, node => node.type === 'ForgeNotice' && node.props.tone === 'error' && serviceText(node).includes('不完整'))[0]);
  const partialOrderQueries = calls.filter(call => call.route === '/data/forge_service_order' && call.search);
  assert.ok(partialOrderQueries.length >= 2 && partialOrderQueries.length % 2 === 0, 'each failed full-read attempt reads both pages before withholding the related list');
  assert.ok(partialOrderQueries.every(call => JSON.parse(new URLSearchParams(call.search).get('$filter')).engineer_id === actor), 'even repeated attempts retain the mandatory actor scope');
  assertNoRefreshButton(tree);
});

test('service engineers retain no quotation or settlement read path', async () => {
  const actor = 'service-engineer-no-quote-read';
  const fixture = serviceTransport({ actor, manager: false, rows: [order('engineer-order', { engineer_id: actor })] });
  const harness = createServicePageHarness(ServiceWorkspacePage, {
    permissions: serviceOperatorPermission.systemPermissions,
    users: { id: actor },
    transport: fixture.transport,
    globals: globals(),
  });
  let tree = await harness.flushEffects();
  const tabs = serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '接单中心工作范围')[0];
  assert.equal(tabs.props.items.some(item => ['my-quotations', 'my-settlements'].includes(item.value)), false);
  assert.equal(serviceOperatorPermission.objects.forge_service_quotation, undefined);
  assert.equal(serviceOperatorPermission.objects.forge_service_settlement, undefined);
  assertJsonEqual(ServiceOrderCreateQuotation.requiredPermissions, serviceManagerPermission.systemPermissions);
  assertJsonEqual(ServiceOrderCreateSettlement.requiredPermissions, serviceManagerPermission.systemPermissions);
  assertJsonEqual(ServiceQuotationCreateSettlement.requiredPermissions, serviceManagerPermission.systemPermissions);
  tabs.props.onValueChange('my-quotations');
  tree = await harness.flushEffects();
  assert.equal(listView(tree, 'forge_service_quotation'), undefined, 'forcing a hidden tab state cannot bypass the page permission check');
  assert.ok(serviceNodes(tree, node => node.type === 'ForgeNotice' && node.props.tone === 'error' && serviceText(node).includes('无权读取'))[0]);
  assert.equal(fixture.calls.some(call => call.route.includes('/data/forge_service_quotation')), false);
  assert.equal(fixture.calls.some(call => call.route.includes('/data/forge_service_settlement')), false);
});

test('personal date ranges and five Today metrics are derived from valid planned dates and real actor rows', () => {
  assert.deepEqual(servicePersonalDateRange('', 'all'), { from: '', to: '', valid: true, error: '' });
  assert.deepEqual(servicePersonalDateRange('', 'custom', '2026-10-01', '2026-10-03'), { from: '2026-10-01', to: '2026-10-03', valid: true, error: '' }, 'a complete custom range does not depend on browser or business date');
  assert.deepEqual(servicePersonalDateRange('2026-10-05', '7'), { from: '2026-09-29', to: '2026-10-05', valid: true, error: '' });
  assert.deepEqual(servicePersonalDateRange('2026-10-05', 'month'), { from: '2026-10-01', to: '2026-10-31', valid: true, error: '' });
  assert.deepEqual(servicePersonalDateRange('2026-01-04', 'previous_month'), { from: '2025-12-01', to: '2025-12-31', valid: true, error: '' });
  assert.deepEqual(servicePersonalDateRange('2026-10-05', 'year'), { from: '2026-01-01', to: '2026-12-31', valid: true, error: '' });
  assert.equal(servicePersonalDateRange('', '30').valid, false);
  assert.equal(servicePersonalListFilters('', { status: 'all' }, { from: '', to: '', valid: true }), null, 'missing actor id never produces a wide filter');
  assert.deepEqual(servicePersonalActorRows([{ engineer_id: 'actor' }, { engineer_id: 'other' }, { engineer_name: 'same name' }], 'actor'), [{ engineer_id: 'actor' }]);

  const projection = servicePersonalTodayProjection([
    { status: 'pending_receive', scheduled_at: '2026-10-05', urgency: 'urgent' },
    { status: 'in_progress', scheduled_at: null },
    { status: 'in_progress', scheduled_at: 'not-a-date' },
    { status: 'completed', scheduled_at: '2026-10-05' },
  ], '2026-10-05');
  assert.deepEqual(projection.summary.map(item => item.value), ['—', 1, 2, '—', '—']);
  assert.equal(projection.todayRows.length, 2, 'the schedule includes completed rows independently of completion timestamps');
  assert.equal(projection.tomorrowRows.length, 0);
  assert.equal(projection.urgentRows.length, 1);
  assert.equal(projection.unplannedRows.length, 1, 'invalid dates are not silently treated as unplanned');
  assert.equal(projection.unclearDateRows.length, 1);
  const noDate = servicePersonalTodayProjection([{ status: 'pending_receive', scheduled_at: null }], '');
  assert.deepEqual(noDate.summary.map(item => item.value), ['—', 1, 0, '—', '—']);
  assert.equal(noDate.dateAvailable, false, 'a failed business date keeps status counts real and the planned count unavailable');
  assert.doesNotMatch(ServiceWorkspacePage.source, /__name/, 'serialized page helpers must not depend on esbuild name wrappers');
  PageSchema.parse(ServiceWorkspacePage);
  const parse = ts.transpileModule(ServiceWorkspacePage.source, {
    fileName: 'page_service_workspace.tsx',
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  });
  assert.deepEqual(parse.diagnostics, []);
});


test('my parts keeps the applicant filter and opens the existing part-request form without stock writes', async () => {
  const actor = 'my-part-applicant';
  const record = { id:'part-own-1', code:'SP-PERSONAL-1', name:'现场巡检备件申请', requested_by:actor, status:'open', execution_status:'pending_outbound', requested_quantity:2 };
  const harness = createServicePageHarness(ServiceWorkspacePage, {
    manager:true, permissions:serviceManagerPermission.systemPermissions, users:{id:actor},
    records:{forge_service_order:[],forge_service_part_request:[record]}, globals:globals(),
    onAction:async ({path}) => path === '/actions/global/organization_business_date_query' ? {business_date:'2026-10-05'} : {},
  });
  let tree = await harness.flushEffects();
  const tabs = serviceNodes(tree,node=>node.type==='StatusTabs' && node.props['aria-label']==='接单中心工作范围')[0];
  tabs.props.onValueChange('parts');
  tree = await harness.flushEffects();
  const list = serviceNodes(tree,node=>node.type==='ListView')[0];
  assert.equal(list.props.data.object,'forge_service_part_request');
  assert.equal(list.props.mobileLayout,'table');
  assertJsonEqual(list.props.filters,['requested_by','=',actor]);
  assertJsonEqual(list.props.columns,ServicePartRequestViews.list.columns);
  serviceButton(tree,'SP-PERSONAL-1').props.onClick();
  tree = await harness.settle();
  const form = serviceNodes(tree,node=>node.type==='ObjectForm')[0];
  assert.equal(form.props.objectName,'forge_service_part_request');
  assert.equal(form.props.mode,'view');
  assert.ok(form.props.fields.includes('requested_quantity'));
  assert.ok(!form.props.fields.includes('category'),'part-request details never fall back to service configuration');
  assert.ok(harness.calls.some(call=>call.method==='GET' && call.path==='/data/forge_service_part_request/part-own-1'));
  assert.equal(harness.calls.some(call=>call.method==='POST' && /service_part_request_(outbound|receive|use|return|mark)/.test(call.path)),false);
});


test('Today uses the returned organization timezone and date-only legacy responses keep completion unknown', async () => {
  const rows = [order('complete-near-day-boundary', { status: 'completed', completed_at: '2026-10-04T16:30:00.000Z' })];
  const cases = [
    { timezone: 'Asia/Shanghai', expected: 1 },
    { timezone: 'UTC', expected: 0 },
    { legacyDateOnly: true, expected: '—' },
    { timezone: 'invalid/zone', expected: '—' },
  ];
  for (const scenario of cases) {
    const fixture = serviceTransport({ manager: true, rows, ...scenario });
    const harness = createServicePageHarness(ServiceWorkspacePage, { manager: true, permissions: serviceManagerPermission.systemPermissions, transport: fixture.transport, globals: globals() });
    const tree = await harness.flushEffects();
    const summary = serviceNodes(tree, node => node.type === 'ListSummary' && node.props['aria-label'] === '接单中心今日概览')[0];
    assert.ok(summary);
    assert.equal(summary.props.items.length, 5);
    assert.equal(summary.props.items.find(item => item.id === 'today-plan').value, 1, 'the valid planned date survives legacy or invalid timezone data');
    assert.equal(summary.props.items.find(item => item.id === 'today-completed').value, scenario.expected, 'completion follows organization day, never the browser timezone or UTC prefix');
    assert.equal(summary.props.items.find(item => item.id === 'overdue').value, '—');
    assert.equal(summary.props.items.some(item => item.id === 'unplanned'), false);
    assert.equal(fixture.calls.some(call => /create|receive|complete|dispatch/.test(call.route)), false, 'statistics make no business writes');
  }
});


test('Today compact sections keep zero counts, distinguish incomplete buckets, and clamp shrinking pages', async () => {
  const fixture = serviceTransport({ manager: true, rows: [] });
  const harness = createServicePageHarness(ServiceWorkspacePage, { manager: true, permissions: serviceManagerPermission.systemPermissions, transport: fixture.transport, globals: globals() });
  let tree = await harness.flushEffects();
  const workspace = getWorkspace(tree);
  const sections = [...new Set(serviceNodes(workspace.props.main, node => node.type === 'DocumentSection'))];
  assert.equal(sections.length, 4);
  assert.ok(sections.every(section => section.props.variant === 'plain'));
  assert.deepEqual(sections.map(section => section.props.count), [0, 0, 0, 0]);
  assert.deepEqual(sections.map(section => section.props.icon), ['Clock', 'CalendarClock', 'Zap', 'CalendarClock']);
  assert.equal(new Set(serviceNodes(workspace.props.main, node => node.type === 'DataEmptyState')).size, 4);
  assert.equal(serviceNodes(workspace.props.sidebar, node => node.type === 'DocumentSection' && node.props.title === '业务日期').length, 0, 'no extra normal-state date card is invented beside the observed workspace');

  const uncertain = serviceTransport({ manager: true, rows: [order('unknown-status', { status: 'not-a-declared-state' }), order('bad-completed-plan', { status: 'completed', scheduled_at: '2026-02-31', completed_at: '2026-10-05T00:00:00Z' })] });
  const uncertainHarness = createServicePageHarness(ServiceWorkspacePage, { manager: true, permissions: serviceManagerPermission.systemPermissions, transport: uncertain.transport, globals: globals() });
  tree = await uncertainHarness.flushEffects();
  const uncertainWorkspace = getWorkspace(tree);
  assert.equal(serviceNodes(uncertainWorkspace.props.main, node => node.type === 'DataEmptyState').length, 0, 'unknown states do not produce four affirmative empty buckets');
  assert.ok(serviceNodes(uncertainWorkspace.props.main, node => node.type === 'ForgeNotice' && serviceText(node).includes('状态无法识别')).length);
  assert.ok(serviceNodes(uncertainWorkspace.props.main, node => node.type === 'ForgeNotice' && serviceText(node).includes('计划工单')).length, 'bad completed schedules are included in the date warning');

  const rows = Array.from({ length: 21 }, (_, index) => order('page-' + index));
  const pagedFixture = serviceTransport({ manager: true, rows });
  const pagedHarness = createServicePageHarness(ServiceWorkspacePage, { manager: true, permissions: serviceManagerPermission.systemPermissions, transport: pagedFixture.transport, globals: globals() });
  tree = await pagedHarness.flushEffects();
  let table = serviceNodes(getWorkspace(tree).props.main, node => node.type === 'RecordTable')[0];
  table.props.schema.onPageChange(999);
  tree = await pagedHarness.settle();
  table = serviceNodes(getWorkspace(tree).props.main, node => node.type === 'RecordTable')[0];
  assert.equal(table.props.schema.page, 3, 'host clamps an out-of-range page to the actual last page');
  assert.equal(table.props.schema.data.length, 1);
  assert.equal(table.props.schema.rowCount, 21);
});
