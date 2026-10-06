import assert from 'node:assert/strict';
import test from 'node:test';
import { WarrantyManagementPage } from '../src/pages/sales-service-workspace.page.ts';
import { serviceOperatorPermission } from '../src/permissions/otc-role.permission.ts';
import { createServicePageHarness, serviceNodes, serviceText } from './service-page-react-harness.mjs';

function pageGlobals() {
  function CategoryDistribution() {}
  function DocumentWorkspace() {}
  return {
    CategoryDistribution,
    DocumentWorkspace,
    location: {
      href: 'http://service-page.test/_console/apps/com.inoforge.forge.sales/page_warranty_management',
      pathname: '/_console/apps/com.inoforge.forge.sales/page_warranty_management',
      origin: 'http://service-page.test',
    },
    navigate() {},
  };
}

function response(payload, status = 200) {
  return { ok: status < 400, status, json: async () => payload, headers: new Headers() };
}

function warrantyCard(index, overrides = {}) {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const endsOn = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
  return {
    id,
    code: `WC-${String(index).padStart(3, '0')}`,
    name: `质保卡 ${String(index).padStart(3, '0')}`,
    status: ['active', 'pending_activation', 'grace_period', 'expired', 'terminated'][index % 5],
    ends_on: endsOn,
    service_order_id: index % 2 ? `service-order-${index}` : null,
    sales_order_id: index % 3 ? null : `sales-order-${index}`,
    scope: index % 2 ? '整机服务' : '单台设备',
    responsible_party: index % 2 ? '供应商' : '我方',
    ...overrides,
  };
}

function makeCards(count) {
  return Array.from({ length: count }, (_, index) => warrantyCard(index));
}

function createTransport({ actor = 'warranty-actor', state = { rows: [], businessDate: '2026-10-05' }, dateFailures = 0, readFailure = false, partialRead = false, missingActor = false } = {}) {
  const calls = [];
  let remainingDateFailures = dateFailures;
  const transport = async (url, options = {}) => {
    const parsed = new URL(url);
    const route = parsed.pathname.replace('/api/v1', '');
    const method = String(options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ route, method, search: parsed.search, credentials: options.credentials, headers: new Headers(options.headers), body });

    if (route === '/auth/get-session') return response(missingActor ? { user: {} } : { user: { id: actor } });
    if (route === '/auth/me/permissions') return response({ systemPermissions: serviceOperatorPermission.systemPermissions });
    if (route === '/actions/forge_service_order/service_order_manager_context') return response({ canManage: false });
    if (route === '/actions/global/organization_business_date_query') {
      if (remainingDateFailures > 0) {
        remainingDateFailures--;
        return response({ error: { message: 'business date unavailable' } }, 503);
      }
      return response({ business_date: state.businessDate });
    }
    if (route === '/data/forge_warranty_card' && method === 'GET') {
      if (readFailure) return response({ error: { message: 'warranty read unavailable' } }, 503);
      const skip = Number(parsed.searchParams.get('$skip') || 0);
      const top = Number(parsed.searchParams.get('$top') || 200);
      if (partialRead && skip > 0) return response({ records: [], totalCount: state.rows.length });
      const rows = partialRead ? state.rows.slice(0, 1) : state.rows.slice(skip, skip + top);
      return response({ records: rows, totalCount: state.rows.length });
    }
    if (route.startsWith('/data/forge_warranty_card/') && method === 'GET') {
      const id = decodeURIComponent(route.slice('/data/forge_warranty_card/'.length));
      const row = state.rows.find(item => item.id === id);
      return row ? response({ record: row }) : response({ error: { message: 'record missing' } }, 404);
    }
    return response({});
  };
  return { calls, transport };
}

function makeHarness(options = {}) {
  const fixture = createTransport(options);
  const harness = createServicePageHarness(WarrantyManagementPage, {
    manager: false,
    permissions: serviceOperatorPermission.systemPermissions,
    users: { id: options.actor || 'warranty-actor' },
    transport: fixture.transport,
    globals: pageGlobals(),
  });
  return { fixture, harness };
}

function statusSummary(tree) {
  return serviceNodes(tree, node => node.type === 'ListSummary' && node.props['aria-label'] === '质保状态统计')[0];
}

function uniqueNodes(tree, predicate) {
  return [...new Set(serviceNodes(tree, predicate))];
}

function statusTabs(tree) {
  return serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '质保管理视图')[0];
}

function listView(tree) {
  return serviceNodes(tree, node => node.type === 'ListView' && node.props.data?.object === 'forge_warranty_card')[0];
}

function itemText(summary, id) {
  const item = summary?.props.items.find(entry => entry.id === id);
  return item ? serviceText(item.value) : undefined;
}

function queryFor(call) {
  return new URLSearchParams(call.search);
}

test('authenticated overview reads every warranty page, routes status selection to the native list, and refreshes without stale rows or writes', async () => {
  const state = { rows: makeCards(201), businessDate: '2026-10-05' };
  const { fixture, harness } = makeHarness({ actor: 'service-user-17', state });
  let tree = await harness.flushEffects();

  assert.equal(itemText(statusSummary(tree), 'active').startsWith('41'), true);
  assert.equal(itemText(statusSummary(tree), 'pending_activation').startsWith('40'), true);
  const pageReads = fixture.calls.filter(call => call.route === '/data/forge_warranty_card' && call.method === 'GET');
  assert.equal(pageReads.length, 2, '201 cards require the 200-row first page and a second page');
  assert.deepEqual(pageReads.map(call => queryFor(call).get('$skip')), ['0', '200']);
  assert.deepEqual(pageReads.map(call => queryFor(call).get('$top')), ['200', '200']);
  assert.deepEqual(pageReads.map(call => JSON.parse(queryFor(call).get('$filter'))), [{}, {}]);
  assert.ok(fixture.calls.some(call => call.route === '/auth/get-session' && call.method === 'GET'));
  assert.ok(fixture.calls.some(call => call.route === '/auth/me/permissions' && call.method === 'GET'));
  assert.ok(fixture.calls.some(call => call.route === '/actions/forge_service_order/service_order_manager_context' && call.method === 'POST'));
  assert.ok(fixture.calls.some(call => call.route === '/actions/global/organization_business_date_query' && call.method === 'POST'));
  assert.ok(fixture.calls.every(call => call.credentials === 'include'), 'all requests stay on the authenticated host adapter');
  assert.equal(serviceText(tree).includes('00000000-0000-4000-8000-000000000000'), false, 'internal record IDs are not visible');
  assert.equal(serviceNodes(tree, node => node.type === 'button' && /刷新/.test(serviceText(node))).length, 0, 'the overview has no added refresh control');

  const dateRows = uniqueNodes(tree, node => node.type === 'button' && node.props.className === 'ss-warranty-date-row');
  assert.equal(dateRows.length, 10, 'the recorded-date ledger displays at most ten sorted records');
  assert.match(serviceText(dateRows[0]), /WC-000/);
  assert.equal(serviceText(dateRows[0]).includes('00000000-0000-4000-8000-000000000000'), false);
  dateRows[0].props.onClick();
  tree = await harness.settle();
  const detail = serviceNodes(tree, node => node.type === 'CompositeDialog' && node.props.title === '质保卡 000')[0];
  assert.ok(detail, 'the expiry row opens the existing card detail');
  assert.ok(fixture.calls.some(call => call.route === '/data/forge_warranty_card/00000000-0000-4000-8000-000000000000' && call.method === 'GET'));
  assert.equal(serviceText(tree).includes('00000000-0000-4000-8000-000000000000'), false, 'detail data keeps the internal ID out of visible text');
  detail.props.onOpenChange(false);
  tree = harness.render();

  statusSummary(tree).props.onItemSelect('active');
  tree = harness.render();
  let list = listView(tree);
  assert.ok(list);
  assert.deepEqual(JSON.parse(JSON.stringify(list.props.userFilterSelections)), { status: ['active'] });
  list.props.onUserFilterSelectionsChange({ status: ['expired'] });
  tree = harness.render();
  list = listView(tree);
  assert.deepEqual(JSON.parse(JSON.stringify(list.props.userFilterSelections)), { status: ['expired'] }, 'the native list remains editable after the summary applies its initial status');

  state.rows = [warrantyCard(900, { code: 'WC-NEW', name: '重新读取的质保卡', status: 'active', ends_on: '2027-01-01' })];
  statusTabs(tree).props.onValueChange('overview');
  tree = harness.render();
  assert.equal(statusSummary(tree), undefined, 're-entry withholds the previous summary even before the read effect settles');
  assert.equal(serviceText(tree).includes('WC-000'), false, 'previous dated rows are cleared before a new read starts');
  tree = await harness.flushEffects();
  assert.equal(itemText(statusSummary(tree), 'active').startsWith('1'), true);
  assert.equal(serviceText(tree).includes('WC-NEW'), true);
  assert.equal(serviceText(tree).includes('WC-000'), false, 'returning to overview does not show the previous page result');
  assert.equal(fixture.calls.filter(call => call.route === '/data/forge_warranty_card' && call.method === 'GET').length, 3, 're-entering overview performs a new complete read');
  assert.equal(fixture.calls.some(call => call.method !== 'GET' && call.route.startsWith('/actions/forge_warranty_card/')), false, 'overview navigation and detail reads never invoke business-write Actions');
});

test('a failed organization business date leaves known status counts and dated rows available while expiry windows and repair frequency stay unavailable', async () => {
  const state = { rows: [warrantyCard(1, { status: 'active' }), warrantyCard(2, { status: 'expired' })], businessDate: '2026-10-05' };
  const { harness } = makeHarness({ state, dateFailures: 1 });
  const tree = await harness.flushEffects();

  assert.equal(itemText(statusSummary(tree), 'active').startsWith('1'), true);
  assert.equal(itemText(statusSummary(tree), 'expired').startsWith('1'), true);
  const windows = serviceNodes(tree, node => node.type === 'ListSummary' && node.props['aria-label'] === '质保到期预警')[0];
  assert.ok(windows);
  assert.equal(windows.props.items.every(item => serviceText(item.value) === '—'), true);
  const repairs = serviceNodes(tree, node => node.type === 'DocumentSection' && node.props.title === '高频返修产品')[0];
  assert.match(serviceText(repairs), /返修统计暂不可用/);
  assert.equal(serviceText(tree).includes('返修统计0'), false);
  assert.equal(uniqueNodes(tree, node => node.type === 'button' && node.props.className === 'ss-warranty-date-row').length, 2, 'sorting already-recorded dates does not depend on the business date');
});

test('a failed or incomplete card read does not render zero-valued warranty summaries', async t => {
  for (const scenario of [
    { name: 'failed read', readFailure: true },
    { name: 'short second page', partialRead: true, rows: makeCards(201) },
  ]) {
    await t.test(scenario.name, async () => {
      const state = { rows: scenario.rows || [warrantyCard(1), warrantyCard(2)], businessDate: '2026-10-05' };
      const { harness } = makeHarness({ state, readFailure: scenario.readFailure, partialRead: scenario.partialRead });
      const tree = await harness.flushEffects();

      assert.equal(statusSummary(tree), undefined, 'partial or failed data is never presented as a proven zero');
      assert.ok(serviceNodes(tree, node => node.type === 'ForgeNotice' && node.props.tone === 'error').length > 0);
    });
  }
});

test('a session without a user identity does not read warranty data', async () => {
  const { fixture, harness } = makeHarness({ missingActor: true });
  const tree = await harness.flushEffects();

  assert.ok(serviceNodes(tree, node => node.type === 'ForgeNotice' && node.props.tone === 'error').length > 0);
  assert.equal(fixture.calls.some(call => call.route === '/data/forge_warranty_card'), false, 'the page stops before querying cards when session identity resolution fails');
});

test('unknown statuses remain unavailable instead of leaking a made-up zero or raw state', async () => {
  const state = {
    rows: [warrantyCard(1, { status: 'active' }), warrantyCard(2, { status: 'future_private_state' })],
    businessDate: '2026-10-05',
  };
  const { harness } = makeHarness({ state });
  const tree = await harness.flushEffects();

  const summary = statusSummary(tree);
  assert.ok(summary);
  assert.equal(summary.props.items.every(item => serviceText(item.value).startsWith('—')), true);
  assert.match(serviceText(tree), /状态统计暂不可用/);
  assert.equal(serviceText(tree).includes('future_private_state'), false);
  assert.equal(serviceNodes(tree, node => node.type === 'ListSummary' && node.props['aria-label'] === '质保到期预警')[0].props.items.every(item => serviceText(item.value) === '—'), true);
});
