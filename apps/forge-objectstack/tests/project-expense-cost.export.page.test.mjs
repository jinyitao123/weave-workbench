import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { ProjectExpenseCostPage } from '../src/pages/project-expense-cost.page.ts';

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('@objectstack/cli'));
const { transformSync } = cliRequire('esbuild');

function createHarness({ seed = {}, fetchImpl, search = '' } = {}) {
  const slots = [];
  const downloads = [];
  const requests = [];
  const effects = [];
  let cursor = 0;
  let effectCursor = 0;
  const React = {
    Fragment: Symbol.for('react.fragment'),
    createElement(type, props, ...children) {
      return { type, props: { ...(props || {}) }, children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false) };
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) {
        const value = typeof initial === 'function' ? initial() : initial;
        slots[index] = value?.loading === true ? { ...value, ...seed, loading: false } : value;
      }
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useEffect(effect) { const index = effectCursor++; if (!effects[index]) effects[index] = effect; },
    useRef(initial) { return { current: initial }; },
    useMemo(factory) { return factory(); },
  };
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    React,
    __name: (target, value) => Object.defineProperty(target, 'name', { value, configurable: true }),
    useAdapter: () => ({ baseUrl: 'http://forge.test', getAuthHeaders: () => ({}), find: async () => ({ data: [{ id: 'user-1', name: 'Employee' }] }), fetchImpl: async (...args) => { requests.push({ url: String(args[0]), options: args[1] || {} }); return fetchImpl ? fetchImpl(...args) : { ok: true, status: 200, json: async () => ({}) }; } }),
    URL,
    URLSearchParams,
    Headers,
    Blob,
    setTimeout,
    clearTimeout,
    console,
    document: {
      getElementById: () => null,
      head: { appendChild() {} },
      createElement: () => ({ click() { downloads.push({ href: this.href, download: this.download }); } }),
    },
    window: { location: { search, pathname: '/_console/apps/com.inoforge.forge.project/page_project_expense_cost', href: 'http://forge.test/_console/apps/com.inoforge.forge.project/page_project_expense_cost' + search }, addEventListener() {}, removeEventListener() {} },
    location: { origin: 'http://forge.test', pathname: '/_console/apps/com.inoforge.forge.project/page_project_expense_cost', href: 'http://forge.test/_console/apps/com.inoforge.forge.project/page_project_expense_cost' + search },
  };
  const code = transformSync(ProjectExpenseCostPage.source, { loader: 'jsx', format: 'cjs' }).code;
  vm.runInNewContext(code, context);
  const App = module.exports.default;
  return { downloads, requests, render() { cursor = 0; effectCursor = 0; return App(); }, async runEffects() { await Promise.all(effects.filter(Boolean).map(effect => effect())); await new Promise(resolve => setTimeout(resolve, 0)); } };
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

function expenseContextApi({ systemPermissions = ['forge_project_manager'], supplierDenied = false } = {}) {
  const projects = [
    { id: 'project-1', code: 'PRJ-1', name: '项目一', status: 'in_progress', manager_id: 'user-1' },
    { id: 'project-2', code: 'PRJ-2', name: '项目二', status: 'paused', manager_id: 'user-1' },
    { id: 'project-closed', code: 'PRJ-C', name: '已归档项目', status: 'archived', manager_id: 'user-1' },
  ];
  const records = {
    forge_project: projects,
    forge_project_expense: [
      { id: 'expense-1', project_id: 'project-1', code: 'EXP-1', name: '项目一费用', status: 'approved', applicant_id: 'user-1', total_amount: 100, line_count: 1 },
      { id: 'expense-2', project_id: 'project-2', code: 'EXP-2', name: '项目二费用', status: 'approved', applicant_id: 'user-1', total_amount: 200, line_count: 1 },
      { id: 'expense-2-draft', project_id: 'project-2', code: 'EXP-2-D', name: '项目二草稿', status: 'draft', applicant_id: 'user-1', total_amount: 50, line_count: 1 },
      { id: 'expense-closed', project_id: 'project-closed', code: 'EXP-C', name: '归档项目费用', status: 'approved', applicant_id: 'user-1', total_amount: 300, line_count: 1 },
    ],
    forge_project_expense_line: [
      { id: 'line-1', expense_id: 'expense-1', category: 'travel', name: '项目一明细', occurred_on: '2026-10-03', amount: 100 },
      { id: 'line-2', expense_id: 'expense-2', category: 'travel', name: '项目二明细', occurred_on: '2026-10-03', amount: 200 },
      { id: 'line-2-draft', expense_id: 'expense-2-draft', category: 'travel', name: '项目二草稿明细', occurred_on: '2026-10-03', amount: 50 },
      { id: 'line-closed', expense_id: 'expense-closed', category: 'travel', name: '归档项目明细', occurred_on: '2026-10-03', amount: 300 },
    ],
    forge_project_member: [{ id: 'member-1', project_id: 'project-1', user_id: 'user-1', name: '员工甲', member_duty: 'manager', active: true }],
    forge_project_cost_entry: [
      { id: 'cost-1', project_id: 'project-1', source_type: 'expense', source_id: 'line-1', status: 'allocated', code: 'COST-1', name: '项目一成本', allocated_amount: 100 },
      { id: 'cost-2', project_id: 'project-2', source_type: 'expense', source_id: 'line-2', status: 'allocated', code: 'COST-2', name: '项目二成本', allocated_amount: 200 },
      { id: 'cost-closed', project_id: 'project-closed', source_type: 'expense', source_id: 'line-closed', status: 'allocated', code: 'COST-C', name: '归档项目成本', allocated_amount: 300 },
    ],
    forge_supplier: [{ id: 'supplier-1', name: '供应商甲' }],
  };
  const created = [];
  const fetchImpl = async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    const path = url.pathname.replace('/api/v1', '');
    const json = (status, value) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => value });
    if (path === '/auth/me/permissions') return json(200, { systemPermissions });
    if (path === '/auth/get-session') return json(200, { user: { id: 'user-1', name: '员工甲' } });
    if (path === '/actions/global/organization_business_date_query') return json(200, { result: { business_date: '2026-10-04' } });
    if (path.startsWith('/actions/forge_project/project_create_expense/')) {
      const projectId = path.split('/').at(-1), body = JSON.parse(options.body || '{}'), params = body.params || {};
      const expense = { id: 'expense-created-' + created.length, project_id: projectId, code: params.code, name: params.name, status: 'draft', applicant_id: 'user-1', total_amount: params.amount, line_count: 1 };
      const line = { id: 'line-created-' + created.length, expense_id: expense.id, category: params.category, name: params.description, occurred_on: params.occurred_on, amount: params.amount };
      created.push({ projectId, params, expense, line });
      records.forge_project_expense.push(expense);
      records.forge_project_expense_line.push(line);
      return json(200, { result: { id: expense.id, line_id: line.id } });
    }
    if (path.startsWith('/data/')) {
      const objectName = path.slice('/data/'.length);
      if (objectName === 'forge_supplier' && supplierDenied) return json(403, { message: 'Forbidden' });
      return json(200, { records: records[objectName] || [], totalCount: (records[objectName] || []).length });
    }
    throw new Error('Unexpected expense context request ' + path);
  };
  return { fetchImpl, records, created };
}

function tables(tree) { return findNodes(tree, node => node.type === 'table'); }

test('expense page loads current identity when optional supplier reads are unavailable', async () => {
  const cases = [
    { permissions: ['forge_project_manager'], supplierDenied: false, canReadCosts: true },
    { permissions: ['forge_procurement_operator'], supplierDenied: true, canReadCosts: false },
  ];
  for (const scenario of cases) {
    const api = expenseContextApi({ systemPermissions: scenario.permissions, supplierDenied: scenario.supplierDenied });
    const harness = createHarness({ search: '?project=project-1', fetchImpl: api.fetchImpl });
    harness.render();
    await harness.runEffects();
    const tree = harness.render();
    assert.doesNotMatch(textContent(tree), /suppliers is not defined|ReferenceError/);
    assert.match(textContent(tree), /员工甲/, 'the authenticated current user is still available to the self-expense form');
    assert.equal(findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '费用项目')[0].props.value, 'project-1');
    assert.equal(harness.requests.some(request => new URL(request.url).pathname.endsWith('/data/forge_supplier')), scenario.permissions.includes('forge_procurement_operator'));
    assert.equal(harness.requests.some(request => new URL(request.url).pathname.endsWith('/data/forge_project_cost_entry')), scenario.canReadCosts);
    if (scenario.canReadCosts) assert.match(textContent(tables(tree)[2]), /项目一明细/);
    else assert.match(textContent(tree), /当前账号无法读取项目成本/);
  }
});

test('a readable route project preselects and scopes expenses, lines, and costs, including closed projects as read-only', async () => {
  const api = expenseContextApi();
  const harness = createHarness({ search: '?project=project-1', fetchImpl: api.fetchImpl });
  harness.render();
  await harness.runEffects();
  let tree = harness.render();
  const projectSelect = findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '费用项目')[0];
  assert.equal(projectSelect.props.value, 'project-1');
  assert.doesNotMatch(textContent(tree), /链接中的项目不可用/);
  assert.match(textContent(tables(tree)[0]), /EXP-1/);
  assert.doesNotMatch(textContent(tables(tree)[0]), /EXP-2|EXP-C/);
  assert.match(textContent(tables(tree)[1]), /项目一明细/);
  assert.doesNotMatch(textContent(tables(tree)[1]), /项目二明细|归档项目明细/);
  assert.match(textContent(tables(tree)[2]), /项目一明细/);
  assert.doesNotMatch(textContent(tables(tree)[2]), /项目二成本|归档项目成本/);
  assert.equal(harness.requests.some(request => new URL(request.url).pathname === '/api/v1/data/forge_project/project-1'), false,
    'the URL id is validated against the complete authorized project list, not fetched directly');

  const closedApi = expenseContextApi();
  const closedHarness = createHarness({ search: '?project=project-closed', fetchImpl: closedApi.fetchImpl });
  closedHarness.render();
  await closedHarness.runEffects();
  tree = closedHarness.render();
  assert.equal(findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '费用项目')[0].props.value, 'project-closed');
  assert.match(textContent(tables(tree)[0]), /EXP-C/);
  assert.match(textContent(tables(tree)[2]), /归档项目明细/);
  assert.match(textContent(tree), /该项目仅可查看/);
  assert.equal(findNodes(tree, node => node.type === 'button' && textContent(node) === '保存草稿')[0].props.disabled, true,
    'closed projects remain readable but cannot create a new expense draft');
});

test('invalid route project fails closed until a readable project is explicitly selected; absent route keeps global entry', async () => {
  const api = expenseContextApi();
  const invalidHarness = createHarness({ search: '?project=not-readable', fetchImpl: api.fetchImpl });
  invalidHarness.render();
  await invalidHarness.runEffects();
  let tree = invalidHarness.render();
  assert.match(textContent(tree), /链接中的项目不可用/);
  assert.equal(findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '费用项目')[0].props.value, '');
  assert.ok(tables(tree).every(table => !/EXP-1|EXP-2|EXP-C|项目一明细|项目二明细|归档项目明细|COST-1|COST-2|COST-C/.test(textContent(table))), 'invalid context renders no cross-project records');
  const save = findNodes(tree, node => node.type === 'button' && textContent(node) === '保存草稿')[0];
  assert.equal(save.props.disabled, true);
  await save.props.onClick();
  assert.equal(invalidHarness.requests.some(request => new URL(request.url).pathname.includes('/actions/forge_project/project_create_expense/')), false);

  findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '费用项目')[0].props.onChange({ target: { value: 'project-2' } });
  tree = invalidHarness.render();
  assert.doesNotMatch(textContent(tree), /链接中的项目不可用/);
  assert.match(textContent(tables(tree)[0]), /EXP-2/);
  assert.doesNotMatch(textContent(tables(tree)[0]), /EXP-1|EXP-C/);

  const globalHarness = createHarness({ fetchImpl: expenseContextApi().fetchImpl });
  globalHarness.render();
  await globalHarness.runEffects();
  tree = globalHarness.render();
  assert.equal(findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '费用项目')[0].props.value, '');
  assert.doesNotMatch(textContent(tree), /链接中的项目不可用/);
  assert.ok(tables(tree).every(table => !/EXP-1|EXP-2|EXP-C|项目一明细|项目二明细|归档项目明细|COST-1|COST-2|COST-C/.test(textContent(table))), 'the global entry waits for an explicit project choice');
});

test('switching from route project one to project two preserves project two through save and readback; cancelled submit writes nothing', async () => {
  const api = expenseContextApi();
  const harness = createHarness({ search: '?project=project-1', fetchImpl: api.fetchImpl });
  harness.render();
  await harness.runEffects();
  let tree = harness.render();
  findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '费用项目')[0].props.onChange({ target: { value: 'project-2' } });
  tree = harness.render();
  assert.match(textContent(tables(tree)[0]), /EXP-2/);
  assert.doesNotMatch(textContent(tables(tree)[0]), /EXP-1|EXP-C/);

  const setValue = (predicate, value) => {
    const current = harness.render(), control = findNodes(current, predicate)[0];
    assert.ok(control);
    control.props.onChange({ target: { value } });
    return harness.render();
  };
  setValue(node => node.type === 'input' && node.props['aria-label'] === '报销单号', 'EXP-2-NEW');
  setValue(node => node.type === 'input' && node.props['aria-label'] === '费用标题', '项目二新费用');
  setValue(node => node.type?.name === 'ForgeDateInput' && node.props['aria-label'] === '费用发生日期', '2026-10-04');
  setValue(node => node.type === 'input' && node.props['aria-label'] === '费用金额', '75');
  tree = setValue(node => node.type === 'textarea' && node.props['aria-label'] === '费用说明', '项目二现场费用');
  const save = findNodes(tree, node => node.type === 'button' && textContent(node) === '保存草稿')[0];
  assert.ok(!save.props.disabled);
  await save.props.onClick();
  tree = harness.render();

  assert.equal(api.created.length, 1);
  assert.equal(api.created[0].projectId, 'project-2');
  assert.deepEqual(api.created[0].params, {
    code: 'EXP-2-NEW', name: '项目二新费用', claim_type: 'self', beneficiary_id: 'user-1', supplier_id: null,
    expected_payment_on: null, category: 'manufacturing', occurred_on: '2026-10-04', amount: 75,
    description: '项目二现场费用', invoice_reference: '', remarks: '项目费用登记',
  });
  assert.equal(findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '费用项目')[0].props.value, 'project-2',
    "server reread preserves the user's selected readable project rather than restoring route project one");
  assert.match(textContent(tables(tree)[0]), /项目二新费用/);
  assert.doesNotMatch(textContent(tables(tree)[0]), /项目一费用|归档项目费用/);

  const submit = findNodes(tree, node => node.type === 'button' && textContent(node) === '提交审批')[0];
  assert.ok(submit);
  submit.props.onClick();
  tree = harness.render();
  const confirm = findNodes(tree, node => node.type?.name === 'ForgeDialog' && node.props.title === '确认提交费用申请')[0];
  assert.ok(confirm);
  confirm.props.onCancel();
  tree = harness.render();
  assert.equal(harness.requests.some(request => new URL(request.url).pathname.includes('/actions/forge_project_expense/project_expense_submit/')), false,
    'cancelling the approval confirmation sends no action');
});

test('expense CSV exports use the native stream with the selected project and parent-scoped expense lines', async () => {
  const filters = new Map();
  const paramsByObject = new Map();
  const harness = createHarness({
    seed: {
      projects: [{ id: 'project-1', code: 'PRJ-1', name: 'Project One', status: 'in_progress', manager_id: 'user-1' }],
      expenses: [{ id: 'expense-1', project_id: 'project-1', code: 'EXP-1', name: 'Travel', status: 'approved', claim_type: 'self', beneficiary_id: 'user-1', applicant_id: 'user-1', total_amount: 100, line_count: 1 }],
      lines: [{ id: 'line-1', expense_id: 'expense-1', category: 'travel', cost_type: 'travel', name: 'Taxi', occurred_on: '2026-10-03', amount: 100 }],
      costs: [{ id: 'cost-1', project_id: 'project-1', source_type: 'expense', source_id: 'line-1', status: 'allocated', code: 'COST-1', name: 'Taxi', cost_type: 'travel', occurred_on: '2026-10-03', allocated_amount: 100 }],
      members: [], suppliers: [], currentUser: { id: 'user-1', name: 'Employee' }, permissions: { systemPermissions: ['forge_project_manager'] }, canReadProjectCosts: true, canReadSuppliers: true,
    },
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl), match = /\/data\/([^/]+)(\/export)?$/.exec(url.pathname);
      assert.ok(match, 'export must use the native data endpoint');
      const object = decodeURIComponent(match[1]);
      if (!match[2]) {
        filters.set(object, JSON.parse(url.searchParams.get('$filter')));
        return { ok: true, status: 200, json: async () => ({ records: [], totalCount: 1 }) };
      }
      paramsByObject.set(object, url.searchParams);
      return { ok: true, status: 200, headers: new Headers({ 'X-Export-Limit': '1', 'Content-Type': 'text/csv; charset=utf-8' }), blob: async () => new Blob(['record\r\n'], { type: 'text/csv' }) };
    },
  });

  let tree = harness.render();
  findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '费用项目')[0].props.onChange({ target: { value: 'project-1' } });
  tree = harness.render();
  for (const label of ['导出费用申请', '导出费用明细', '导出已归集成本']) {
    tree = harness.render();
    await findNodes(tree, node => node.type === 'button' && textContent(node) === label)[0].props.onClick();
  }

  assert.deepEqual(filters.get('forge_project_expense'), { project_id: 'project-1' });
  assert.deepEqual(filters.get('forge_project_expense_line'), { expense_id: { $in: ['expense-1'] } });
  assert.deepEqual(filters.get('forge_project_cost_entry'), { project_id: 'project-1', source_type: 'expense', status: 'allocated', source_id: { $in: ['line-1'] } });
  assert.equal(paramsByObject.get('forge_project_expense').get('format'), 'csv');
  assert.equal(paramsByObject.get('forge_project_expense_line').get('limit'), '1');
  assert.deepEqual(paramsByObject.get('forge_project_cost_entry').get('fields').split(','), ['name', 'code', 'project_id', 'source_type', 'cost_type', 'occurred_on', 'allocated_amount', 'status']);
  assert.equal(harness.downloads.length, 3);
  assert.deepEqual(harness.downloads.map(download => download.download), ['项目费用申请.csv', '项目费用明细.csv', '已归集项目成本.csv']);
});

test('expense export displays native permission errors instead of downloading a partial report', async () => {
  const harness = createHarness({
    seed: {
      projects: [{ id: 'project-1', code: 'PRJ-1', name: 'Project One', status: 'in_progress', manager_id: 'user-1' }],
      expenses: [], lines: [], costs: [], members: [], suppliers: [], currentUser: { id: 'user-1', name: 'Employee' }, permissions: { systemPermissions: ['forge_project_manager'] }, canReadProjectCosts: true, canReadSuppliers: true,
    },
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith('/forge_project_expense')) return { ok: true, status: 200, json: async () => ({ records: [], totalCount: 0 }) };
      return { ok: false, status: 403, headers: new Headers(), json: async () => ({ error: { message: '当前账号无权导出费用申请' } }) };
    },
  });
  let tree = harness.render();
  findNodes(tree, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '费用项目')[0].props.onChange({ target: { value: 'project-1' } });
  tree = harness.render();
  await findNodes(tree, node => node.type === 'button' && textContent(node) === '导出费用申请')[0].props.onClick();
  assert.equal(harness.downloads.length, 0);
  assert.match(textContent(harness.render()), /当前账号无权导出费用申请/);
});

test('work-member expense save uses the project-bound Action, hides unauthorized cost data and retains a failed draft', async () => {
  const project = { id: 'project-1', code: 'PRJ-1', name: 'Project One', status: 'in_progress', manager_id: 'manager-1' };
  const responseFor = (failCreate = false) => async rawUrl => {
    const url = new URL(rawUrl);
    if (url.pathname === '/api/v1/auth/me/permissions') return { ok: true, status: 200, json: async () => ({ systemPermissions: ['forge_project_work_member'] }) };
    if (url.pathname === '/api/v1/actions/global/organization_business_date_query') return { ok: true, status: 200, json: async () => ({ result: { business_date: '2026-10-04' } }) };
    if (url.pathname === '/api/v1/actions/forge_project/project_create_expense/project-1') return { ok: !failCreate, status: failCreate ? 400 : 200, json: async () => failCreate ? { message: '费用校验失败' } : { result: { id: 'expense-1' } } };
    if (url.pathname.startsWith('/api/v1/data/')) {
      const object = url.pathname.slice('/api/v1/data/'.length);
      const records = object === 'forge_project' ? [project] : [];
      return { ok: true, status: 200, json: async () => ({ records, totalCount: records.length }) };
    }
    throw new Error('Unexpected request ' + url.pathname);
  };
  const change = (harness, predicate, value) => {
    const current = harness.render(), control = findNodes(current, predicate)[0];
    assert.ok(control, 'expense form control is present');
    control.props.onChange({ target: { value } });
    return harness.render();
  };
  async function runSave(failCreate) {
    const harness = createHarness({
      seed: { projects: [project], eligibleProjectIds: [project.id], expenses: [], lines: [], costs: [], members: [], suppliers: [], currentUser: { id: 'user-1', name: 'Employee' }, permissions: { systemPermissions: ['forge_project_work_member'] }, canReadProjectCosts: false, canReadSuppliers: false },
      fetchImpl: responseFor(failCreate),
    });
    let tree = harness.render();
    tree = change(harness, node => node.type?.name === 'ForgeSelectControl' && node.props['aria-label'] === '费用项目', 'project-1');
    tree = change(harness, node => node.type === 'input' && node.props['aria-label'] === '报销单号', 'EXP-B-001');
    tree = change(harness, node => node.type === 'input' && node.props['aria-label'] === '费用标题', '接口现场差旅');
    tree = change(harness, node => node.type?.name === 'ForgeDateInput' && node.props['aria-label'] === '费用发生日期', '2026-10-04');
    tree = change(harness, node => node.type === 'input' && node.props['aria-label'] === '费用金额', '180');
    tree = change(harness, node => node.type === 'textarea' && node.props['aria-label'] === '费用说明', '现场接口检查');
    const button = findNodes(tree, node => node.type === 'button' && textContent(node) === '保存草稿')[0];
    assert.ok(button && !button.props.disabled);
    await button.props.onClick();
    await new Promise(resolve => setTimeout(resolve, 0));
    return { harness, tree: harness.render() };
  }

  const saved = await runSave(false);
  assert.ok(saved.harness.requests.some(request => request.url.includes('/actions/forge_project/project_create_expense/project-1')),
    'project_create_expense is bound to forge_project, not forge_project_expense');
  assert.ok(!saved.harness.requests.some(request => request.url.includes('/data/forge_project_cost_entry')));
  assert.ok(!saved.harness.requests.some(request => request.url.includes('/data/forge_supplier')));
  assert.doesNotMatch(textContent(saved.tree), /供应商|导出已归集成本/);
  assert.match(textContent(saved.tree), /当前账号无法读取项目成本/);
  assert.equal(findNodes(saved.tree, node => node.type === 'input' && node.props['aria-label'] === '报销单号')[0].props.value, '', 'a saved draft form resets only after success');

  const failed = await runSave(true);
  assert.match(textContent(failed.tree), /费用校验失败/);
  assert.equal(findNodes(failed.tree, node => node.type === 'input' && node.props['aria-label'] === '报销单号')[0].props.value, 'EXP-B-001', 'a failed save retains the draft for correction');
});
