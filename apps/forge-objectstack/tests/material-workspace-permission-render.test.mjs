import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { MaterialWorkspacePage } from '../src/pages/material-workspace.page.ts';

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('@objectstack/cli'));
const { transformSync } = cliRequire('esbuild');
const code = transformSync(MaterialWorkspacePage.source, { loader: 'jsx', format: 'cjs' }).code;

const materials = [
  { id: 'material-active', code: 'TEST-ACTIVE', name: 'Active fixture', model: 'MODEL-A', category_id: 'category-1', unit_id: 'unit-1', property: 'raw_material', source_type: 'purchased', status: 'active' },
  { id: 'material-inactive', code: 'TEST-INACTIVE', name: 'Inactive fixture', model: 'MODEL-I', category_id: 'category-1', unit_id: 'unit-1', property: 'raw_material', source_type: 'purchased', status: 'inactive' },
];

function createHarness({ objectPermissions, envelope = 'objects', permissionFailure } = {}) {
  const slots = [];
  const effects = [];
  const effectSlots = new Set();
  const requests = [];
  let cursor = 0;

  const React = {
    Fragment: Symbol.for('react.fragment'),
    createElement(type, props, ...children) {
      return {
        type,
        props: props || {},
        children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false),
      };
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => {
        slots[index] = typeof next === 'function' ? next(slots[index]) : next;
      }];
    },
    useEffect(effect) {
      const index = cursor++;
      if (!effectSlots.has(index)) {
        effectSlots.add(index);
        effects.push(effect);
      }
    },
  };

  const permissionPayload = envelope === 'data'
    ? { data: { objects: { forge_material: objectPermissions || {} } } }
    : { objects: { forge_material: objectPermissions || {} } };
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const route = url.pathname.replace('/api/v1', '');
    requests.push({ route, method: options.method || 'GET' });
    if (route === '/auth/me/permissions') {
      if (permissionFailure) throw permissionFailure;
      return { ok: true, json: async () => permissionPayload };
    }
    if (route === '/data/forge_material') return { ok: true, json: async () => ({ records: materials }) };
    if (route === '/data/forge_material_category') return { ok: true, json: async () => ({ records: [{ id: 'category-1', name: 'Fixture category' }] }) };
    if (route === '/data/forge_unit') return { ok: true, json: async () => ({ records: [{ id: 'unit-1', name: 'Fixture unit' }] }) };
    if (route === '/data/forge_material_sku') return { ok: true, json: async () => ({ records: [] }) };
    throw new Error(`Unexpected Forge request: ${route}`);
  };

  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    React,
    useAdapter: () => ({ baseUrl: 'http://forge.test', getAuthHeaders: () => ({}), fetchImpl }),
    Headers,
    URL,
    URLSearchParams,
    Blob,
    window: {
      location: { search: '', pathname: '/_console/apps/com.inoforge.forge.supply-chain/page_material_workspace' },
      history: { pushState() {} },
    },
    document: {
      getElementById: () => null,
      head: { appendChild() {} },
      createElement: () => ({ click() {} }),
    },
    setTimeout,
    clearTimeout,
    console,
  };
  vm.runInNewContext(code, context);
  const App = module.exports.default;
  const render = () => {
    cursor = 0;
    return App();
  };
  const mount = async () => {
    render();
    await Promise.all(effects.map(effect => effect()));
    await new Promise(resolve => setImmediate(resolve));
    return render();
  };

  return { render, mount, requests };
}

function findNodes(tree, predicate, results = []) {
  if (!tree || typeof tree !== 'object') return results;
  if (predicate(tree)) results.push(tree);
  for (const child of tree.children || []) findNodes(child, predicate, results);
  return results;
}

function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return (tree?.children || []).map(text).join('');
}

function buttons(tree) {
  return findNodes(tree, node => node.type === 'button');
}

function buttonLabels(tree, label) {
  return buttons(tree).map(text).map(value => value.trim()).filter(value => value === label);
}

function hasBatchManagement(tree) {
  return findNodes(tree, node => node.props?.['aria-label'] === '批量操作').length > 0;
}

test('native create/edit permissions expose those actions without requiring delete permission', async () => {
  const harness = createHarness({
    objectPermissions: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
  });
  const tree = await harness.mount();

  assert.equal(harness.requests.filter(request => request.route === '/auth/me/permissions').length, 1);
  assert.equal(buttonLabels(tree, '新建物料').length, 1);
  assert.equal(buttonLabels(tree, '编辑').length, 2);
  assert.equal(buttonLabels(tree, '启用').length, 1);
  assert.equal(buttonLabels(tree, '停用').length, 1);
  assert.equal(buttonLabels(tree, '删除').length, 0);
  assert.equal(hasBatchManagement(tree), true);
  assert.match(text(tree), /TEST-ACTIVE/);
  assert.match(text(tree), /TEST-INACTIVE/);
});

test('read-only native permissions hide all material write actions from the rendered page', async () => {
  const harness = createHarness({
    envelope: 'data',
    objectPermissions: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
  });
  const tree = await harness.mount();

  for (const label of ['新建物料', '编辑', '启用', '停用', '删除']) assert.equal(buttonLabels(tree, label).length, 0, `${label} must not render`);
  assert.equal(hasBatchManagement(tree), false);
  assert.match(text(tree), /TEST-ACTIVE/);
});

test('delete-only native permissions show delete while hiding create, edit, and status changes', async () => {
  const harness = createHarness({
    objectPermissions: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: true },
  });
  const tree = await harness.mount();

  assert.equal(buttonLabels(tree, '新建物料').length, 0);
  assert.equal(buttonLabels(tree, '编辑').length, 0);
  assert.equal(buttonLabels(tree, '启用').length, 0);
  assert.equal(buttonLabels(tree, '停用').length, 0);
  assert.equal(buttonLabels(tree, '删除').length, materials.length);
  assert.equal(hasBatchManagement(tree), false);
});

test('permission fetch failure renders a clear error and fails closed for management actions', async () => {
  const harness = createHarness({ permissionFailure: new Error('权限服务暂不可用') });
  const tree = await harness.mount();

  assert.match(text(tree), /权限/);
  assert.match(text(tree), /权限服务暂不可用/);
  for (const label of ['新建物料', '编辑', '启用', '停用', '删除']) assert.equal(buttonLabels(tree, label).length, 0, `${label} must not render after permission failure`);
  assert.equal(hasBatchManagement(tree), false);
});
