import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { SalesContractCreatePage } from '../src/pages/sales-contract-create.page.ts';

function makeHarness(page, records, blockedObject = '') {
  const hooks = [], effects = [], calls = [];
  let activeBlockedObject = blockedObject;
  let cursor = 0;
  const React = {
    Fragment: 'Fragment',
    createElement(type, props, ...children) { return { type, props: { ...(props || {}), children } }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
    },
    useEffect(effect, dependencies) {
      const index = cursor++, previous = hooks[index];
      const changed = !previous || !dependencies || dependencies.some((value, item) => value !== previous[item]) || dependencies.length !== previous.length;
      if (changed) { hooks[index] = dependencies || []; effects.push(effect); }
    },
  };
  const adapter = {
    baseUrl: 'https://forge.test',
    getAuthHeaders: () => ({ Authorization: 'Bearer ordinary-caller-session' }),
    fetchImpl: async (input, options = {}) => {
      const url = new URL(input), path = url.pathname.replace('/api/v1', '');
      const authorization = options.headers?.get?.('Authorization') || options.headers?.Authorization;
      if (path.startsWith('/data/')) {
        const object = decodeURIComponent(path.slice('/data/'.length)), query = url.searchParams;
        const skip = Number(query.get('$skip') || 0), top = Number(query.get('$top') || 0);
        calls.push({ object, skip, top, count: query.get('$count'), orderBy: query.get('$orderby'), authorization });
        if (!authorization) throw new Error('the ordinary caller authentication header was not forwarded');
        if (object === activeBlockedObject && skip >= 100) return new Response(JSON.stringify({ error: { message: 'SECOND_PAGE_RLS_DENIED' } }), { status: 403 });
        const rows = records[object] || [];
        return new Response(JSON.stringify({ records: rows.slice(skip, skip + top), totalCount: rows.length }), { status: 200 });
      }
      if (path === '/auth/me/permissions') return new Response(JSON.stringify({ systemPermissions: ['sales_order_operator'] }), { status: 200 });
      if (path.startsWith('/actions/forge_customer/sales_customer_can_maintain/') || path.startsWith('/actions/forge_contact/sales_contact_can_maintain/')) {
        if (activeBlockedObject === 'maintenance') return new Response(JSON.stringify({ error: { message: 'MAINTENANCE_READ_DENIED' } }), { status: 403 });
        const object = path.split('/')[2], id = decodeURIComponent(path.split('/').at(-1));
        const source = (records[object] || []).find(item => item.id === id);
        return new Response(JSON.stringify({ success: true, data: { can_maintain: source?.testCanMaintain === true } }), { status: 200 });
      }
      if (path === '/auth/get-session') return activeBlockedObject === 'session'
        ? new Response(JSON.stringify({ error: { message: 'SESSION_READ_DENIED' } }), { status: 401 })
        : new Response(JSON.stringify({ user: { id: 'user-1' } }), { status: 200 });
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    },
  };
  const document = { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}), querySelector: () => null };
  const compiled = ts.transpileModule(page.source, {
    fileName: `${page.name}.tsx`, reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  assert.deepEqual(compiled.diagnostics, [], `${page.name} embedded React source parses`);
  const exports = {};
  new Function('exports', 'React', 'useAdapter', 'location', 'navigate', 'Headers', 'URLSearchParams', 'fetch', 'Blob', 'URL', 'setTimeout', 'clearTimeout', 'window', 'document', 'localStorage', compiled.outputText)(
    exports, React, () => adapter,
    { origin: 'https://forge.test', href: 'https://forge.test/_console/apps/com.inoforge.forge.sales/' + page.name, pathname: '/_console/apps/com.inoforge.forge.sales/' + page.name },
    () => {}, Headers, URLSearchParams, fetch, Blob, URL, setTimeout, clearTimeout,
    { location: { origin: 'https://forge.test', href: 'https://forge.test/_console/apps/com.inoforge.forge.sales/' + page.name } }, document,
    { getItem: () => null },
  );
  const App = exports.default;
  const render = () => { cursor = 0; return App(); };
  async function renderLoaded() {
    render();
    for (const effect of effects.splice(0)) effect();
    await new Promise(resolve => setTimeout(resolve, 0));
    return render();
  }
  return { calls, render, renderLoaded, setBlockedObject(object) { activeBlockedObject = object; } };
}

function walk(tree, visit) {
  if (Array.isArray(tree)) { for (const child of tree) walk(child, visit); return; }
  if (!tree || typeof tree !== 'object') return;
  visit(tree);
  walk(tree.props?.children, visit);
}

function visibleText(tree) {
  if (Array.isArray(tree)) return tree.map(visibleText).join('');
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return visibleText(tree.props?.children);
}

function pickerOptions(tree, label) {
  let result = [];
  walk(tree, node => { if (node.props?.label === label && Array.isArray(node.props.options)) result = node.props.options; });
  return result;
}

test('contract creation reads every customer page and offers only the caller\'s valid source records', async () => {
  const records = {
    forge_customer: [
      ...Array.from({ length: 101 }, (_, i) => ({ id: 'customer-' + i, name: '本人客户 ' + i, testCanMaintain: true })),
      { id: 'shared-customer', name: '共享可读的他人客户', testCanMaintain: false },
    ],
    forge_contact: [
      { id: 'contact-1', name: '本人在职联系人', customer_id: 'customer-0', testCanMaintain: true, employment_status: 'active' },
      { id: 'contact-2', name: '已离职联系人', customer_id: 'customer-0', owner_id: 'user-1', employment_status: 'inactive' },
      { id: 'contact-3', name: '他人联系人', customer_id: 'customer-0', owner_id: 'user-2', employment_status: 'active' },
    ],
    sys_user: [{ id: 'user-2', name: '另一员工' }, { id: 'user-1', name: '当前员工' }],
    forge_contract_type: [{ id: 'active-type', name: '有效类型', status: 'active' }, { id: 'inactive-type', name: '停用类型', status: 'inactive' }],
    forge_quotation: [{ id: 'own-quote', code: 'QT-OWN', responsible_id: 'user-1' }, { id: 'other-quote', code: 'QT-OTHER', responsible_id: 'user-2' }],
  };
  const harness = makeHarness(SalesContractCreatePage, records);
  const tree = await harness.renderLoaded();
  assert.deepEqual(harness.calls.filter(call => call.object === 'forge_customer').map(call => call.skip), [0, 100]);
  assert.equal(pickerOptions(tree, '客户').length, 101);
  assert.equal(pickerOptions(tree, '客户').some(item => item.value === 'shared-customer'), false);
  assert.deepEqual(pickerOptions(tree, '联系人').map(item => item.value), ['contact-1']);
  assert.deepEqual(pickerOptions(tree, '负责人').map(item => item.value), ['user-1']);
  assert.deepEqual(pickerOptions(tree, '合同类型').map(item => item.value), ['active-type']);
  assert.deepEqual(pickerOptions(tree, '来源报价单').map(item => item.value), ['own-quote']);
});

test('contract creation clears all choices on a later page denial, unknown ownership, or failed caller identity', async () => {
  const records = { forge_customer: Array.from({ length: 101 }, (_, i) => ({ id: 'customer-' + i, name: '本人客户 ' + i, testCanMaintain: true })), sys_user: [{ id: 'user-2', name: '第一条其他员工' }] };
  for (const blocked of ['forge_customer', 'session', 'maintenance']) {
    const harness = makeHarness(SalesContractCreatePage, records, blocked);
    const tree = await harness.renderLoaded();
    assert.equal(pickerOptions(tree, '客户').length, 0);
    assert.equal(pickerOptions(tree, '负责人').length, 0);
    assert.ok(visibleText(tree).includes(blocked === 'session' ? 'SESSION_READ_DENIED' : blocked === 'maintenance' ? 'MAINTENANCE_READ_DENIED' : 'SECOND_PAGE_RLS_DENIED'));
    if (blocked === 'session') assert.equal(harness.calls.length, 0, 'no source data is read using a guessed employee');
  }
});

test('readable owner fields select caller records without requiring optional CRM actions', async () => {
  const harness = makeHarness(SalesContractCreatePage, {
    forge_customer: [
      { id: 'owned-customer', name: '本人客户', owner_id: 'user-1' },
      { id: 'other-customer', name: '共享他人客户', owner_id: 'user-2' },
    ],
    forge_contact: [
      { id: 'owned-contact', name: '本人联系人', owner_id: 'user-1', employment_status: 'active' },
      { id: 'other-contact', name: '他人联系人', owner_id: 'user-2', employment_status: 'active' },
    ],
    sys_user: [{ id: 'user-2', name: '另一员工' }, { id: 'user-1', name: '当前员工' }],
  }, 'maintenance');
  const tree = await harness.renderLoaded();
  assert.deepEqual(pickerOptions(tree, '客户').map(item => item.value), ['owned-customer']);
  assert.deepEqual(pickerOptions(tree, '联系人').map(item => item.value), ['owned-contact']);
  assert.deepEqual(pickerOptions(tree, '负责人').map(item => item.value), ['user-1']);
  assert.equal(visibleText(tree).includes('MAINTENANCE_READ_DENIED'), false);
});
