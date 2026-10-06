import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceWorkspacePage } from '../src/pages/sales-service-workspace.page.ts';
import { serviceOperatorPermission } from '../src/permissions/otc-role.permission.ts';
import { createServicePageHarness } from './service-page-react-harness.mjs';

const actor = 'performance-engineer-current';

function response(payload, status = 200) {
  return { ok: status < 400, status, json: async () => payload, headers: new Headers() };
}

function order(id, engineerId, status, customerId, overrides = {}) {
  return {
    id,
    code: 'WO-' + id,
    name: '服务工单 ' + id,
    engineer_id: engineerId,
    customer_id: customerId,
    status,
    service_type: '维修',
    ...overrides,
  };
}

function performanceRows(currentActor = actor) {
  const completed = Array.from({ length: 52 }, (_, index) => {
    const suffix = String(index).padStart(3, '0');
    const dateValues = {
      0: '2026-10-06T00:15:00.000Z',
      1: '2026-10-06T08:15:00+08:00',
      2: '2026-10-06',
      3: 'not-an-instant',
      51: null,
    };
    const completedAt = index in dateValues ? dateValues[index] : '2026-10-05T12:00:00.000Z';
    return order(
      'service-order-own-completed-' + suffix,
      index % 2 ? { id: currentActor } : currentActor,
      'completed',
      'customer-private-' + suffix,
      {
        code: 'WO-OWN-' + suffix,
        name: '本人完工工单 ' + suffix,
        completed_at: completedAt,
        ...(index === 0 ? { service_hours: 2.5 } : {}),
      },
    );
  });
  const ongoing = [
    order('service-order-own-pending', currentActor, 'pending_receive', 'customer-open', { code: 'WO-OWN-PENDING' }),
    order('service-order-own-active', currentActor, 'in_progress', 'customer-active', { code: 'WO-OWN-ACTIVE' }),
    order('service-order-own-closed', currentActor, 'closed', 'customer-closed', { code: 'WO-OWN-CLOSED' }),
  ];
  const peers = [
    order('service-order-peer-completed', 'another-engineer', 'completed', 'customer-peer', { code: 'WO-PEER-COMPLETED' }),
    order('service-order-peer-unknown', 'another-engineer', 'private_future_state', 'customer-peer-unknown', { code: 'WO-PEER-UNKNOWN' }),
  ];
  return [...completed, ...ongoing, ...peers].sort((left, right) => left.id.localeCompare(right.id));
}

function customerNames(rows) {
  return Object.fromEntries(rows
    .filter(row => row.status === 'completed' && (row.engineer_id?.id || row.engineer_id) === actor)
    .map(row => [row.customer_id, '客户 ' + row.customer_id.slice(-3)]));
}

function makeFixture(state) {
  const calls = [];
  const transport = async (url, options = {}) => {
    const parsed = new URL(url);
    const route = parsed.pathname.replace('/api/v1', '');
    const method = String(options.method || 'GET').toUpperCase();
    calls.push({ route, method, search: parsed.search, credentials: options.credentials, body: options.body });

    if (route === '/auth/get-session') return response({ user: { id: state.actor || actor } });
    if (route === '/auth/me/permissions') return response({ systemPermissions: serviceOperatorPermission.systemPermissions });
    if (route === '/actions/forge_service_order/service_order_manager_context') {
      return response({ error: { message: 'forbidden' } }, 403);
    }
    if (route === '/actions/global/organization_business_date_query') return response({ business_date: '2026-10-06' });

    if (route === '/data/forge_service_order' && method === 'GET') {
      if (state.orderMode === 'forbidden') return response({ error: { message: 'forbidden' } }, 403);
      const skip = Number(parsed.searchParams.get('$skip') || 0);
      const top = Number(parsed.searchParams.get('$top') || 200);
      if (state.orderMode === 'short') {
        return response({ records: skip === 0 ? state.rows.slice(0, 1) : [], totalCount: state.rows.length });
      }
      // Deliberately return the full authorized-set fixture even though the
      // server-side engineer predicate is present, to verify the page's local
      // identity filter as well as its authenticated query.
      return response({ records: state.rows.slice(skip, skip + top), totalCount: state.rows.length });
    }
    if (route === '/data/forge_customer' && method === 'GET') {
      if (state.customerMode === 'forbidden') return response({ error: { message: 'customer access denied' } }, 403);
      const filter = JSON.parse(parsed.searchParams.get('$filter') || '{}');
      const ids = Array.isArray(filter.id?.$in) ? filter.id.$in : [];
      const rows = ids.filter(id => Object.prototype.hasOwnProperty.call(state.names, id)).map(id => ({ id, name: state.names[id] }));
      const skip = Number(parsed.searchParams.get('$skip') || 0);
      const top = Number(parsed.searchParams.get('$top') || 50);
      return response({ records: rows.slice(skip, skip + top), totalCount: rows.length });
    }
    if (route.startsWith('/data/forge_service_order/') && method === 'GET') {
      const id = decodeURIComponent(route.slice('/data/forge_service_order/'.length));
      const record = state.rows.find(row => row.id === id);
      return record ? response({ record }) : response({ error: { message: 'record missing' } }, 404);
    }
    return response({});
  };
  return { calls, transport };
}

function pageGlobals() {
  function DocumentWorkspace() {}
  function DateRangeControl() {}
  return { DocumentWorkspace, DateRangeControl };
}

function makeHarness(state) {
  const fixture = makeFixture(state);
  const harness = createServicePageHarness(ServiceWorkspacePage, {
    manager: false,
    permissions: serviceOperatorPermission.systemPermissions,
    users: { id: state.actor || actor },
    transport: fixture.transport,
    globals: pageGlobals(),
  });
  return { fixture, harness };
}

function nodes(root, predicate, seen = new WeakSet()) {
  if (!root || typeof root !== 'object' || seen.has(root)) return [];
  seen.add(root);
  const props = root.props || {};
  const nested = [
    ...(Array.isArray(root.children) ? root.children : [root.children]),
    ...(Array.isArray(props.actions) ? props.actions : [props.actions]),
    ...(Array.isArray(props.children) ? props.children : [props.children]),
  ];
  return [
    ...(predicate(root) ? [root] : []),
    ...nested.flatMap(child => nodes(child, predicate, seen)),
  ];
}

function visibleText(root, seen = new WeakSet()) {
  if (typeof root === 'string' || typeof root === 'number') return String(root);
  if (!root || typeof root !== 'object' || seen.has(root)) return '';
  seen.add(root);
  return (Array.isArray(root.children) ? root.children : [root.children]).map(child => visibleText(child, seen)).join('');
}

function scopeTabs(tree) {
  return nodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '接单中心工作范围')[0];
}

function performanceSummary(tree) {
  return nodes(tree, node => node.type === 'ListSummary' && node.props['aria-label'] === '本人累计业绩')[0];
}

function performanceRanking(tree) {
  return nodes(tree, node => node.type === 'CategoryDistribution' && node.props['aria-label'] === '客户服务次数排行')[0];
}

function performanceTable(tree) {
  return nodes(tree, node => node.type === 'RecordTable' && node.props.schema?.className === 'ss-performance-table')[0];
}

function displayedTableRows(table) {
  return (table?.children || []).filter(node => node?.type === 'div');
}

function summaryValue(summary, id) {
  return summary?.props.items.find(item => item.id === id)?.value;
}

function parsedFilter(call) {
  return JSON.parse(new URLSearchParams(call.search).get('$filter') || '{}');
}

async function enterPerformance(harness, tree) {
  const tabs = scopeTabs(tree);
  assert.ok(tabs, 'the authenticated employee can reach the performance view');
  tabs.props.onValueChange('performance');
  return harness.flushEffects();
}

test('performance re-reads the complete authenticated engineer set, ranks resolved customers, paginates all completions, and opens original order detail', async () => {
  const rows = performanceRows();
  const state = { actor, rows, names: customerNames(rows), customerMode: 'ok' };
  const { fixture, harness } = makeHarness(state);

  let tree = await harness.flushEffects();
  assert.equal(fixture.calls.filter(call => call.route === '/data/forge_service_order' && call.method === 'GET').length, 1, 'the initial workspace reads the current engineer order set once');
  tree = await enterPerformance(harness, tree);

  const orderReads = fixture.calls.filter(call => call.route === '/data/forge_service_order' && call.method === 'GET');
  assert.equal(orderReads.length, 2, 'entering performance re-reads orders instead of reusing the previous workspace result');
  assert.ok(orderReads.every(call => call.credentials === 'include'));
  assert.ok(orderReads.every(call => JSON.stringify(parsedFilter(call)) === JSON.stringify({ engineer_id: actor })), 'the full-history query has only the current engineer scope, with no date/status cut-off');
  assert.equal(orderReads.every(call => Number(new URLSearchParams(call.search).get('$top')) === 200), true);
  assert.ok(fixture.calls.some(call => call.route === '/auth/get-session' && call.credentials === 'include'));
  assert.ok(fixture.calls.some(call => call.route === '/auth/me/permissions' && call.credentials === 'include'));

  const summary = performanceSummary(tree);
  assert.ok(summary);
  assert.equal(summaryValue(summary, 'all'), 55);
  assert.equal(summaryValue(summary, 'completed'), 52);

  const customerReads = fixture.calls.filter(call => call.route === '/data/forge_customer' && call.method === 'GET');
  assert.equal(customerReads.length, 2, '52 unique completed-customer ids are read in bounded batches');
  assert.ok(customerReads.every(call => call.credentials === 'include'));
  assert.ok(customerReads.every(call => new URLSearchParams(call.search).get('$select') === 'id,name'));
  assert.ok(customerReads.every(call => new URLSearchParams(call.search).get('$count') === 'true'));
  const requestedBatches = customerReads.map(call => parsedFilter(call).id.$in);
  assert.deepEqual(requestedBatches.map(batch => batch.length), [50, 2]);
  assert.deepEqual(requestedBatches.flat().sort(), rows
    .filter(row => row.status === 'completed' && (row.engineer_id?.id || row.engineer_id) === actor)
    .map(row => row.customer_id)
    .sort());
  assert.equal(requestedBatches.flat().includes('customer-peer'), false, 'the peer employee customer is excluded even when the order endpoint ignores its predicate');

  const ranking = performanceRanking(tree);
  assert.ok(ranking);
  assert.equal(ranking.props.showRank, true);
  assert.equal(ranking.props.truncateLabels, true);
  assert.equal(typeof ranking.props.valueFormatter, 'function');
  assert.equal(ranking.props.items.length, 52);
  assert.equal(ranking.props.items.every(item => item.value === 1), true);
  assert.equal(ranking.props.items.some(item => item.label === '客户 customer-peer'), false);
  assert.equal(visibleText(tree).includes('customer-private-000'), false, 'resolved customer ids never appear in visible text');
  assert.equal(visibleText(tree).includes('service-order-own-completed-000'), false, 'order ids never appear in visible text');

  const table = performanceTable(tree);
  assert.ok(table);
  assert.equal(table.props.schema.rowCount, 52, 'every completed order remains in the manual-paginated table');
  assert.equal(table.props.schema.pageSize, 20);
  assert.equal(table.props.schema.page, 1);
  assert.equal(table.props.schema.data.length, 20);
  const accessors = table.props.schema.columns.map(column => column.accessorKey);
  assert.deepEqual(JSON.parse(JSON.stringify(accessors)), ['code', 'name', 'customer_id', 'service_type', 'completed_at', 'service_hours']);
  assert.equal(accessors.some(field => /sla|rating|score/i.test(field)), false, 'unknown SLA and rating fields are not invented');
  assert.equal(table.props.emptyStateContent.props.role, 'status');
  assert.equal(visibleText(table.props.emptyStateContent), '暂无本人已完工工单');
  assert.equal(/筛选|filter/i.test(visibleText(table.props.emptyStateContent)), false, 'an empty personal table does not suggest filtering records out');
  assert.equal(visibleText(tree).match(/刷新/g)?.length || 0, 0, 'the performance view has no additional refresh action');

  const completedAt = table.props.schema.columns.find(column => column.accessorKey === 'completed_at');
  assert.equal(completedAt.header, '完工时间（UTC）');
  assert.equal(completedAt.cell('2026-10-06T00:15:00.000Z', {}), '2026-10-06 00:15:00');
  assert.equal(completedAt.cell('2026-10-06T08:15:00+08:00', {}), '2026-10-06 00:15:00', 'an explicit offset is rendered as a UTC instant');
  assert.equal(completedAt.cell('2026-10-06', {}), '时间不可用', 'a date-only value is not promoted to a completion instant');
  assert.equal(completedAt.cell('not-an-instant', {}), '时间不可用');
  assert.equal(completedAt.cell(null, {}), '未填写');
  const serviceHours = table.props.schema.columns.find(column => column.accessorKey === 'service_hours');
  assert.equal(serviceHours.cell(undefined, {}), '未填写', 'missing time-report data is not fabricated as zero');

  table.props.schema.onPageChange(2);
  tree = harness.render();
  const secondPage = performanceTable(tree);
  assert.equal(secondPage.props.schema.page, 2);
  assert.equal(secondPage.props.schema.rowCount, 52);
  assert.equal(secondPage.props.schema.data.length, 20);
  const secondPageRows = displayedTableRows(secondPage);
  assert.equal(secondPageRows.length, 20);
  const selectedRow = secondPageRows[0];
  const detailButton = selectedRow.children[0];
  assert.equal(detailButton.type, 'button');
  const targetId = selectedRow.props.key;
  const targetRecord = state.rows.find(row => row.id === targetId);
  assert.ok(targetRecord);
  assert.equal(visibleText(detailButton), targetRecord.code);
  detailButton.props.onClick();
  tree = await harness.settle();

  assert.ok(nodes(tree, node => node.type === 'CompositeDialog' && node.props.title === targetRecord.name)[0], 'the table action opens the existing service-order detail');
  assert.ok(fixture.calls.some(call => call.route === '/data/forge_service_order/' + targetId && call.method === 'GET'));
  assert.equal(visibleText(tree).includes(targetId), false, 'detail keeps the order UUID out of visible copy');
  assert.equal(fixture.calls.some(call => call.method === 'POST' && call.route.startsWith('/actions/forge_service_order/') && call.route !== '/actions/forge_service_order/service_order_manager_context'), false, 'viewing performance and opening detail invoke no business-write Action');

  const detail = nodes(tree, node => node.type === 'CompositeDialog' && node.props.title === targetRecord.name)[0];
  detail.props.onOpenChange(false);
  tree = harness.render();
  scopeTabs(tree).props.onValueChange('my-orders');
  tree = await harness.flushEffects();

  state.rows = [order('service-order-own-reloaded', actor, 'completed', 'customer-reloaded', {
    code: 'WO-RELOADED', name: '重新读取的完工工单', completed_at: '2026-10-06T03:00:00.000Z',
  })];
  state.names = { 'customer-reloaded': '重新读取的客户' };
  scopeTabs(tree).props.onValueChange('performance');
  tree = await harness.flushEffects();

  assert.equal(fixture.calls.filter(call => call.route === '/data/forge_service_order' && call.method === 'GET').length, 3, 're-entering performance performs a fresh full-history read');
  assert.equal(summaryValue(performanceSummary(tree), 'all'), 1);
  assert.equal(summaryValue(performanceSummary(tree), 'completed'), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(performanceRanking(tree).props.items.map(item => item.label))), ['重新读取的客户']);
  assert.equal(visibleText(tree).includes('客户 customer-private-000'), false, 'returning to performance does not reuse the prior result');
  assert.equal(performanceTable(tree).props.schema.page, 1, 're-entry resets manual pagination');
  assert.equal(performanceTable(tree).props.schema.data[0].code, 'WO-RELOADED');
});

test('denied customer-name reads withhold the entire ranking without leaking ids or dropping completed rows', async () => {
  const privateCustomerId = 'customer-secret-private-id';
  const rows = [order('service-order-own-private', actor, 'completed', privateCustomerId, {
    code: 'WO-PRIVATE', name: '本人完工工单', completed_at: '2026-10-05T09:00:00.000Z',
  })];
  const state = { actor, rows, names: {}, customerMode: 'forbidden' };
  const { fixture, harness } = makeHarness(state);
  let tree = await harness.flushEffects();
  tree = await enterPerformance(harness, tree);

  assert.equal(summaryValue(performanceSummary(tree), 'all'), 1);
  assert.equal(summaryValue(performanceSummary(tree), 'completed'), 1);
  assert.equal(performanceRanking(tree), undefined, 'a forbidden customer lookup does not silently omit the row from a partial ranking');
  assert.ok(nodes(tree, node => node.type === 'ForgeNotice' && node.props.tone === 'error').length > 0);
  assert.equal(visibleText(tree).includes(privateCustomerId), false, 'neither the customer name failure nor detail table exposes its id');

  const table = performanceTable(tree);
  assert.equal(table.props.schema.rowCount, 1, 'the completed service row remains available despite the separate name failure');
  const customerColumn = table.props.schema.columns.find(column => column.accessorKey === 'customer_id');
  assert.equal(customerColumn.cell(privateCustomerId, rows[0]), '客户名称不可用');
  const request = fixture.calls.find(call => call.route === '/data/forge_customer');
  assert.ok(request);
  assert.equal(request.method, 'GET');
  assert.equal(request.credentials, 'include');
  assert.deepEqual(parsedFilter(request), { id: { $in: [privateCustomerId] } });
});

test('a forbidden or incomplete personal-order read never renders fake zero performance', async t => {
  for (const mode of ['forbidden', 'short']) {
    await t.test(mode, async () => {
      const rows = [
        order('service-order-own-one', actor, 'completed', 'customer-one'),
        order('service-order-own-two', actor, 'completed', 'customer-two'),
      ];
      const state = { actor, rows, names: { 'customer-one': '客户一', 'customer-two': '客户二' }, orderMode: mode };
      const { fixture, harness } = makeHarness(state);
      let tree = await harness.flushEffects();
      tree = await enterPerformance(harness, tree);

      assert.equal(performanceSummary(tree), undefined, 'incomplete or forbidden reads do not publish 0 counts');
      assert.equal(performanceTable(tree), undefined);
      assert.ok(nodes(tree, node => node.type === 'ForgeNotice' && node.props.tone === 'error').length > 0);
      assert.equal(fixture.calls.some(call => call.route === '/data/forge_customer'), false, 'customer names are not queried from incomplete order scope');
    });
  }
});
