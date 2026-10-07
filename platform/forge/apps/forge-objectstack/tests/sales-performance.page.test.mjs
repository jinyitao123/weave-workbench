import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { SalesPerformanceBankPage } from '../src/pages/sales-performance-bank.page.ts';

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('@objectstack/cli'));
const { transformSync } = cliRequire('esbuild');

function createHarness({ search = '', fetchImpl } = {}) {
  const slots = [], effects = [], requests = [], navigation = [];
  let cursor = 0;
  const React = {
    Fragment: Symbol.for('react.fragment'),
    Children: { toArray(children) { return children == null ? [] : Array.isArray(children) ? children.flat(Infinity) : [children]; } },
    createElement(type, props, ...children) {
      const flat = children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false);
      const normalized = { ...(props || {}) };
      if (flat.length) normalized.children = flat.length === 1 ? flat[0] : flat;
      return { type, props: normalized, children: flat };
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useEffect(effect) { effects.push(effect); },
    useMemo(factory) { return factory(); },
    useRef(initial) { return { current: initial }; },
  };
  const module = { exports: {} };
  const fakeComponent = name => Object.defineProperty(function Component(props) { return React.createElement('div', props, props.children); }, 'name', { value: name });
  const context = {
    module, exports: module.exports, React,
    __name: (target, name) => Object.defineProperty(target, 'name', { value: name, configurable: true }),
    WorkspaceHeader: fakeComponent('WorkspaceHeader'),
    ListSummary: fakeComponent('ListSummary'),
    StatusTabs: fakeComponent('StatusTabs'),
    RecordTable: fakeComponent('RecordTable'),
    CompositeDialog: fakeComponent('CompositeDialog'),
    useAdapter: () => ({ baseUrl: 'http://forge.test', getAuthHeaders: () => ({}), fetchImpl: async (rawUrl, options = {}) => {
      const parsed = new URL(rawUrl), route = parsed.pathname.replace('/api/v1', '');
      requests.push({ route, method: options.method || 'GET', body: options.body || null });
      return fetchImpl ? fetchImpl(rawUrl, options) : { ok: true, status: 200, json: async () => ({}) };
    } }),
    URL, URLSearchParams, Headers, Blob, setTimeout, clearTimeout, crypto: { randomUUID: () => 'request-key-test' },
    console, document: { getElementById: () => ({}), createElement: () => ({ click() {} }) },
    location: { origin: 'http://forge.test', pathname: '/_console/apps/com.inoforge.forge.sales/page_sales_performance_bank', href: 'http://forge.test/_console/apps/com.inoforge.forge.sales/page_sales_performance_bank'+search },
    navigate: path => navigation.push(path),
    window: { location: { search, href: 'http://forge.test/_console/apps/com.inoforge.forge.sales/page_sales_performance_bank'+search }, history: { replaceState() {} } },
  };
  vm.runInNewContext(transformSync(SalesPerformanceBankPage.source, { loader: 'jsx', format: 'cjs' }).code, context);
  return {
    requests, navigation,
    render() { cursor = 0; effects.length = 0; return module.exports.default(); },
    async runEffects() { const pending = effects.slice(); for (const effect of pending) await effect(); await new Promise(resolve => setTimeout(resolve, 0)); },
  };
}

function findNodes(tree, predicate, results = []) {
  if (!tree || typeof tree !== 'object') return results;
  if (predicate(tree)) results.push(tree);
  for (const child of tree.children || []) findNodes(child, predicate, results);
  return results;
}

function textContent(node) {
  if (node === null || node === undefined || node === false) return '';
  if (node.type === 'style') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return (node.children || []).map(textContent).join('');
}

const pageRow = (overrides = {}) => ({
  id: 'performance-entry-internal-id-do-not-render', order_id: 'order-internal-id-do-not-render', order_code: 'SO-2026-008', order_code_snapshot: 'SO-2026-008',
  customer_id: 'customer-id-hidden', customer_name_snapshot: 'Example Customer', completed_on: '2025-12-31', sales_person_id: 'seller-a', sales_person_name_snapshot: 'Seller A', sales_person_name: 'Seller A',
  order_amount: 1000, performance_amount: 100, performance_ratio: 100, gross_profit: null, status: 'pending', entry_type: 'original_confirm', approval_status: null,
  unresolved: [], ...overrides,
});

function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value, headers: new Headers() };
}

function performanceApi({ businessDate = '2025-12-31', permissions = ['sales_performance_read', 'sales_performance_confirm', 'sales_performance_rebook', 'forge_sales_gross_profit_read'], queryRows = [pageRow()], analytics = { trend: [], ranking: [], teams: [] }, failWorkspace = false } = {}) {
  const queries = [], actionBodies = [], requests = [];
  const fetchImpl = async (rawUrl, options = {}) => {
    const parsed = new URL(rawUrl), route = parsed.pathname.replace('/api/v1', ''), method = options.method || 'GET';
    requests.push({ route, method });
    if (route === '/auth/get-session') return response({ user: { id: 'actor-session-id' } });
    if (route === '/auth/me/permissions') return response({ systemPermissions: permissions });
    if (route === '/actions/global/organization_business_date_query') return response({ result: { business_date: businessDate } });
    if (route === '/actions/forge_sales_performance_entry/sales_performance_workspace_query') {
      const params = JSON.parse(options.body || '{}').params || {};
      queries.push(params);
      if (failWorkspace) return response({ message: 'Record 01234567-89ab-cdef-0123-456789abcdef not found in forge_sales_performance_entry' }, 403);
      return response({ result: { rows: queryRows, page: Number(params.page || 1), page_size: Number(params.page_size || 10), total: queryRows.length, people: [{ id: 'seller-a', name: 'Seller A' }, { id: 'seller-b', name: 'Seller B' }], customer_options: [{ id: 'customer-id-hidden', name: 'Example Customer' }], summary: { net_performance: 100, original_confirmed: 100, rebook_in: 0, rebook_out: 0, gross_profit: null, gross_profit_available: false, performance_count: 1, pending_approval: 0 }, analytics, export_jobs: [] } });
    }
    if (route === '/actions/forge_revenue_recognition/sales_gross_profit_report_query') {
      actionBodies.push({ route, params: JSON.parse(options.body || '{}').params });
      return response({ result: { single_order_scope: true, financial_source_signature: 'snapshot-signature', metrics: { sales_revenue: 100, sales_cost: 60, gross_profit: 40, gross_margin_rate: 40, revenue_unmatched_count: 0, cost_unmatched_count: 0 }, rows: [] } });
    }
    if (route === '/actions/forge_sales_order/sales_performance_confirmation_submit' || route === '/actions/forge_sales_performance_entry/sales_performance_rebook_submit') {
      actionBodies.push({ route, params: JSON.parse(options.body || '{}').params });
      return response({ result: { id: 'action-result-id-hidden', status: 'pending_approval' } });
    }
    if (route === '/actions/forge_sales_performance_entry/sales_performance_rebook_options_query') {
      actionBodies.push({ route, params: JSON.parse(options.body || '{}').params });
      return response({ result: { targets: [{ id: 'target-user-id-hidden', name: 'Seller B' }], reasons: [{ id: 'reason-id-hidden', name: '客户协作' }] } });
    }
    throw new Error('Unexpected API route ' + method + ' ' + route);
  };
  return { fetchImpl, queries, actionBodies, requests };
}

test('sales performance workspace parses and uses only scoped actions for reads and writes', () => {
  assert.equal(SalesPerformanceBankPage.name, 'page_sales_performance_bank');
  assert.equal(SalesPerformanceBankPage.kind, 'react');
  transformSync(SalesPerformanceBankPage.source, { loader: 'jsx', format: 'esm', sourcefile: 'page_sales_performance_bank.jsx' });
  assert.match(SalesPerformanceBankPage.source, /sales_performance_workspace_query/);
  assert.match(SalesPerformanceBankPage.source, /sales_performance_confirmation_submit/);
  assert.match(SalesPerformanceBankPage.source, /sales_performance_rebook_options_query/);
  assert.match(SalesPerformanceBankPage.source, /sales_performance_rebook_submit/);
  assert.match(SalesPerformanceBankPage.source, /sales_performance_rebook_export_create/);
  assert.match(SalesPerformanceBankPage.source, /sales_performance_export_job_download/);
  assert.match(SalesPerformanceBankPage.source, /ForgeOrganizationBusinessDate\(adapter\)/);
  assert.match(SalesPerformanceBankPage.source, /RecordTable/);
  assert.match(SalesPerformanceBankPage.source, /CompositeDialog/);
  assert.match(SalesPerformanceBankPage.source, /ForgeApiRequest/);
  assert.match(SalesPerformanceBankPage.source, /statusLabels/);
  assert.match(SalesPerformanceBankPage.source, /target_configuration/);
  assert.doesNotMatch(SalesPerformanceBankPage.source, /exportVisible/);
  assert.doesNotMatch(SalesPerformanceBankPage.source, /fetch\(['"]\/api\/v1/);
  assert.doesNotMatch(SalesPerformanceBankPage.source, /permission_set_id|organization_id/);
  assert.doesNotMatch(SalesPerformanceBankPage.source, /<CompositeDialog[^>]*subtitle=/, 'all public CompositeDialog headings use the supported description prop');
});

test('sales performance uses authenticated server identity and the organization business year, not the browser year', async () => {
  const api = performanceApi({ businessDate: '2025-12-31' });
  const harness = createHarness({ fetchImpl: api.fetchImpl, search: '?tab=bank' });
  harness.render();
  await harness.runEffects();
  const tree = harness.render();
  assert.equal(api.queries.length, 1);
  assert.equal(api.queries[0].business_date, '2025-12-31');
  assert.equal(api.queries[0].year, 2025, 'the first query uses the business-date year');
  assert.equal(Object.hasOwn(api.queries[0], 'user_id'), false, 'the client never chooses the authenticated actor');
  assert.equal(Object.hasOwn(api.queries[0], 'organization_id'), false, 'the client never chooses an organization');
  const yearControl = findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '业绩年度')[0];
  assert.ok(yearControl);
  assert.equal(yearControl.props.value, '2025');
  assert.deepEqual(findNodes(yearControl, node => node.type === 'option').map(node => node.props.value), ['2025', '2024']);
  assert.ok(harness.requests.some(row => row.route === '/auth/get-session'));
  assert.ok(harness.requests.some(row => row.route === '/actions/global/organization_business_date_query'));
});

test('bank renders its four source-backed monthly series and reference ledger columns without manufacturing missing margin', async () => {
  const trend = Array.from({ length: 12 }, (_, index) => ({
    period: '2025-' + String(index + 1).padStart(2, '0'), performance: index * 10, order_amount: index * 100,
    payment_amount: index * 40, gross_profit: index === 4 ? null : index * 20,
  }));
  const row = pageRow({ amount_direction: 'decrease', gross_profit_rate: null, performance_ratio: 25 });
  const api = performanceApi({ queryRows: [row], analytics: { trend, ranking: [], teams: [] } });
  const harness = createHarness({ fetchImpl: api.fetchImpl, search: '?tab=bank' });
  harness.render();
  await harness.runEffects();
  const tree = harness.render();
  assert.ok(findNodes(tree, node => node.type === 'svg' && node.props?.['aria-label'] === '业绩、订单、回款和毛利月度趋势').length === 1);
  assert.equal(findNodes(tree, node => node.type === 'path' && String(node.props?.className || '').startsWith('sp-bank-line-')).length, 4);
  assert.equal(findNodes(tree, node => node.type === 'span' && textContent(node) === '05月').length, 1);
  assert.match(textContent(tree), /毛利仅显示已完整核对的月份/);
  const table = findNodes(tree, node => node.type?.name === 'RecordTable' && node.props?.schema?.data?.length)[0];
  const columns = table.props.schema.columns.map(column => column.header);
  for (const expected of ['方向', '毛利率', '计收比例']) assert.ok(columns.includes(expected), `bank table includes ${expected}`);
  const margin = table.props.schema.columns.find(column => column.accessorKey === 'gross_profit_rate').cell(null, row);
  assert.equal(textContent(margin), '—', 'an unknown gross-profit rate stays unknown');
});

test('source query failure is not rendered as an empty performance bank and hides backend record identifiers', async () => {
  const api = performanceApi();
  let failWorkspace = false;
  const fetchImpl = async (rawUrl, options) => {
    const route = new URL(rawUrl).pathname.replace('/api/v1', '');
    if (route === '/actions/forge_sales_performance_entry/sales_performance_workspace_query' && failWorkspace) {
      return response({ message: 'Record 01234567-89ab-cdef-0123-456789abcdef not found in forge_sales_performance_entry' }, 403);
    }
    return api.fetchImpl(rawUrl, options);
  };
  const harness = createHarness({ fetchImpl });
  harness.render();
  await harness.runEffects();
  let tree = harness.render();
  let table = findNodes(tree, node => node.type?.name === 'RecordTable' && node.props?.schema?.data?.length)[0];
  assert.equal(table.props.schema.data[0].order_code_snapshot, 'SO-2026-008', 'the first request loads an authorized record');
  const mineScope = findNodes(tree, node => node.type === 'button' && textContent(node) === '我负责的')[0];
  assert.ok(mineScope);
  mineScope.props.onClick();
  tree = harness.render();
  failWorkspace = true;
  await harness.runEffects();
  tree = harness.render();
  assert.match(textContent(tree), /当前账号无权读取所选范围的销售业绩/);
  assert.equal(findNodes(tree, node => node.type?.name === 'RecordTable' && node.props?.schema?.data?.length).length, 0, 'a failed filter reload does not retain stale rows from the previous scope');
  assert.equal(findNodes(tree, node => node.type?.name === 'ForgeEmpty' && node.props?.title === '暂无业绩记录').length, 0,
    'a denied read cannot masquerade as a normal no-results state');
  assert.equal(findNodes(tree, node => node.type?.name === 'ForgeEmpty' && node.props?.title === '业绩数据读取失败，无法确认记录').length, 1);
  assert.doesNotMatch(textContent(tree), /01234567-89ab-cdef-0123-456789abcdef/);
});

function getTableRowAction(tree, actionText) {
  const table = findNodes(tree, node => node.type?.name === 'RecordTable' && node.props?.schema?.columns?.some(column => column.accessorKey === 'actions'))[0];
  assert.ok(table, 'the page rendered its controlled business table');
  const actionColumn = table.props.schema.columns.find(column => column.accessorKey === 'actions');
  const actionCell = actionColumn.cell(undefined, table.props.schema.data[0]);
  return findNodes(actionCell, node => node.type === 'button' && textContent(node) === actionText)[0];
}

test('confirmation and Rebook clicks call their bound native business Actions without rendering record IDs', async () => {
  const confirmationRow = pageRow({ id: 'performance-entry-internal-id-do-not-render', order_id: 'order-internal-id-do-not-render', order_code: 'SO-CONF-01', status: 'pending', entry_type: 'original_confirm', unresolved: [] });
  const confirmApi = performanceApi({ queryRows: [confirmationRow] });
  const confirmation = createHarness({ fetchImpl: confirmApi.fetchImpl, search: '?tab=confirm' });
  confirmation.render();
  await confirmation.runEffects();
  let tree = confirmation.render();
  const periodGroup = findNodes(tree, node => node.props?.['aria-label'] === '统计期间')[0];
  assert.ok(periodGroup, 'confirmation retains the selected server-side year/period filters alongside customer/date filters');
  findNodes(periodGroup, node => node.type === 'button' && textContent(node) === 'Q4')[0].props.onClick();
  await confirmation.runEffects();
  tree = confirmation.render();
  findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '确认客户')[0].props.onChange({ target: { value: 'customer-id-hidden' } });
  tree = confirmation.render();
  findNodes(tree, node => node.type?.name === 'ForgeDateInput' && node.props['aria-label'] === '确认开始日期')[0].props.onChange({ target: { value: '2025-12-31' } });
  tree = confirmation.render();
  findNodes(tree, node => node.type?.name === 'ForgeDateInput' && node.props['aria-label'] === '确认结束日期')[0].props.onChange({ target: { value: '2025-12-31' } });
  tree = confirmation.render();
  await confirmation.runEffects();
  tree = confirmation.render();
  assert.deepEqual({ period: confirmApi.queries.at(-1).period, customer: confirmApi.queries.at(-1).confirmation_customer_id, start: confirmApi.queries.at(-1).confirmation_start_on, end: confirmApi.queries.at(-1).confirmation_end_on }, { period: 'q4', customer: 'customer-id-hidden', start: '2025-12-31', end: '2025-12-31' });
  getTableRowAction(tree, '确认业绩').props.onClick();
  await new Promise(resolve => setTimeout(resolve, 0));
  tree = confirmation.render();
  const confirmationDialog = findNodes(tree, node => node.type?.name === 'CompositeDialog' && node.props?.title === '确认销售业绩')[0];
  assert.ok(confirmationDialog);
  assert.equal(confirmationDialog.props.description, 'SO-CONF-01');
  assert.equal(Object.hasOwn(confirmationDialog.props, 'subtitle'), false);
  const confirmationFooter = confirmationDialog.props.footer({ requestClose() {} });
  await findNodes(confirmationFooter, node => node.type === 'button' && textContent(node) === '提交原生审批')[0].props.onClick();
  await new Promise(resolve => setTimeout(resolve, 0));
  const confirmationRequest = confirmApi.actionBodies.find(row => row.route === '/actions/forge_sales_order/sales_performance_confirmation_submit');
  assert.equal(confirmationRequest.params.order_id, confirmationRow.order_id);
  assert.equal(confirmationRequest.params.business_date, '2025-12-31');
  assert.doesNotMatch(textContent(confirmation.render()), /performance-entry-internal-id-do-not-render|order-internal-id-do-not-render/);

  const rebookRow = pageRow({ id: 'performance-entry-internal-id-do-not-render', status: 'pending', entry_type: 'original_confirm', performance_amount: 100 });
  const rebookApi = performanceApi({ queryRows: [rebookRow] });
  const rebook = createHarness({ fetchImpl: rebookApi.fetchImpl, search: '?tab=bank' });
  rebook.render();
  await rebook.runEffects();
  tree = rebook.render();
  getTableRowAction(tree, 'Rebook').props.onClick();
  await new Promise(resolve => setTimeout(resolve, 0));
  tree = rebook.render();
  const rebookDialog = findNodes(tree, node => node.type?.name === 'CompositeDialog' && node.props?.title === '申请 Rebook')[0];
  assert.ok(rebookDialog);
  assert.equal(rebookDialog.props.description, 'SO-2026-008');
  assert.equal(Object.hasOwn(rebookDialog.props, 'subtitle'), false);
  findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '转入员工')[0].props.onChange({ target: { value: 'target-user-id-hidden' } });
  tree = rebook.render();
  findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '分配原因')[0].props.onChange({ target: { value: 'reason-id-hidden' } });
  tree = rebook.render();
  findNodes(tree, node => node.type === 'input' && node.props['aria-label'] === '分配比例')[0].props.onChange({ target: { value: '37.5' } });
  tree = rebook.render();
  const readyRebookDialog = findNodes(tree, node => node.type?.name === 'CompositeDialog' && node.props?.title === '申请 Rebook')[0];
  const rebookFooter = readyRebookDialog.props.footer({ requestClose() {} });
  await findNodes(rebookFooter, node => node.type === 'button' && textContent(node) === '提交原生审批')[0].props.onClick();
  await new Promise(resolve => setTimeout(resolve, 0));
  const optionsRequest = rebookApi.actionBodies.find(row => row.route === '/actions/forge_sales_performance_entry/sales_performance_rebook_options_query');
  const submitRequest = rebookApi.actionBodies.find(row => row.route === '/actions/forge_sales_performance_entry/sales_performance_rebook_submit');
  assert.equal(optionsRequest.params.source_entry_id, rebookRow.id);
  assert.equal(submitRequest.params.source_entry_id, rebookRow.id);
  assert.equal(submitRequest.params.target_person_id, 'target-user-id-hidden');
  assert.equal(submitRequest.params.reason_id, 'reason-id-hidden');
  assert.equal(submitRequest.params.ratio, 37.5);
  assert.doesNotMatch(textContent(rebook.render()), /performance-entry-internal-id-do-not-render|target-user-id-hidden|reason-id-hidden/);
  assert.ok(rebookApi.requests.every(row => !row.route.startsWith('/data/')), 'the page uses domain Actions instead of raw CRUD for performance work');
});

test('pending native confirmation and Rebook rows route to the native approvals inbox from list and detail', async () => {
  const pendingEntry = pageRow({ entry_confirmation_status: 'pending_approval', approval_status: 'pending' });
  const bank = createHarness({ fetchImpl: performanceApi({ queryRows: [pendingEntry] }).fetchImpl, search: '?tab=bank' });
  bank.render();
  await bank.runEffects();
  let tree = bank.render();
  const bankAction = getTableRowAction(tree, '进入审批中心');
  assert.ok(bankAction);
  bankAction.props.onClick();
  assert.equal(bank.navigation.at(-1), '/apps/com.inoforge.forge.sales/system/approvals');
  getTableRowAction(tree, '查看').props.onClick();
  tree = bank.render();
  const detailDialog = findNodes(tree, node => node.type?.name === 'CompositeDialog' && node.props?.title === '业绩流水')[0];
  assert.ok(detailDialog);
  const detailFooter = detailDialog.props.footer({ requestClose() {} });
  findNodes(detailFooter, node => node.type === 'button' && textContent(node) === '进入审批中心')[0].props.onClick();
  assert.equal(bank.navigation.at(-1), '/apps/com.inoforge.forge.sales/system/approvals', 'read-only detail uses the canonical native inbox route');

  const pendingRebook = pageRow({ status: 'pending_approval', entry_type: 'rebook_out', source_order_code: 'SO-RB-01' });
  const rebook = createHarness({ fetchImpl: performanceApi({ queryRows: [pendingRebook] }).fetchImpl, search: '?tab=rebook' });
  rebook.render();
  await rebook.runEffects();
  tree = rebook.render();
  getTableRowAction(tree, '进入审批中心').props.onClick();
  assert.equal(rebook.navigation.at(-1), '/apps/com.inoforge.forge.sales/system/approvals');
  assert.doesNotMatch(textContent(tree), /performance-entry-internal-id-do-not-render|order-internal-id-do-not-render/);
});

test('performance dates display the controlled organization-day DTO and never the UTC prefix', async () => {
  const row = pageRow({ status: 'confirmed', confirmed_at: '2025-12-31T16:30:00.000Z', business_date: '2026-01-01' });
  const api = performanceApi({ businessDate: '2026-01-01', queryRows: [row] });
  const harness = createHarness({ fetchImpl: api.fetchImpl });
  harness.render();
  await harness.runEffects();
  const tree = harness.render();
  const tables = findNodes(tree, node => node.type?.name === 'RecordTable');
  const table = tables.find(node => node.props.schema.columns.some(column => column.accessorKey === 'confirmed_at'));
  assert.ok(table);
  const date = table.props.schema.columns.find(column => column.accessorKey === 'confirmed_at');
  assert.equal(date.cell(row.confirmed_at, row), '2026-01-01');
  assert.equal(date.cell(row.confirmed_at, { ...row, business_date: undefined }), '—', 'absent organization-date projection does not silently display the UTC day');
});
