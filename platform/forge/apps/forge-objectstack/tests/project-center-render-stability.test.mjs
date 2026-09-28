import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { ProjectCenterPage } from '../src/pages/project-center.page.ts';

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('@objectstack/cli'));
const { transformSync } = cliRequire('esbuild');
const code = transformSync(ProjectCenterPage.source, { loader: 'jsx', format: 'cjs' }).code;

function createHarness() {
  const slots = [];
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
      if (!(index in slots)) {
        let value = typeof initial === 'function' ? initial() : initial;
        if (value && typeof value === 'object' && value.loading === true && Array.isArray(value.projects)) {
          value = {
            ...value,
            loading: false,
            currentUserId: 'test-project-operator',
            permissions: { systemPermissions: ['forge_project_operator'] },
          };
        }
        slots[index] = value;
      }
      return [slots[index], next => {
        slots[index] = typeof next === 'function' ? next(slots[index]) : next;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect() { cursor++; },
    useMemo(factory) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = factory();
      return slots[index];
    },
  };
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    React,
    useAdapter: () => ({ baseUrl: 'http://forge.test', getAuthHeaders: () => ({}), fetchImpl: async () => { throw new Error('Unexpected API request'); } }),
    URLSearchParams,
    window: {
      location: { search: '', pathname: '/_console/apps/com.inoforge.forge.project/page_project_center' },
      history: { pushState() {} },
    },
    setTimeout,
    clearTimeout,
    console,
  };
  vm.runInNewContext(`${code}\nglobalThis.__ForgeDateInputProbe = ForgeDateInput;`, context);
  const App = module.exports.default;
  const render = () => {
    cursor = 0;
    return App();
  };
  const renderDateInput = () => {
    cursor = 0;
    return context.__ForgeDateInputProbe({ value: '', onChange() {} });
  };
  return { render, renderDateInput };
}

function findNodes(tree, predicate, results = []) {
  if (!tree || typeof tree !== 'object') return results;
  if (predicate(tree)) results.push(tree);
  for (const child of tree.children || []) findNodes(child, predicate, results);
  return results;
}

function renderComponents(tree) {
  if (!tree || typeof tree !== 'object') return;
  if (typeof tree.type === 'function') {
    renderComponents(tree.type(tree.props || {}));
    return;
  }
  for (const child of tree.children || []) renderComponents(child);
}

test('typing multiple characters in the new project name keeps the same field component mounted', () => {
  const { render } = createHarness();
  let tree = render();
  const createButton = findNodes(tree, node => node.type === 'button' && node.children.includes('新建项目'))[0];
  assert.ok(createButton, 'project operator sees the normal new-project action');
  createButton.props.onClick();

  tree = render();
  renderComponents(tree);
  let nameField = findNodes(tree, node => typeof node.type === 'function' && node.type.name === 'Field' && node.props.label === '项目名称')[0];
  assert.ok(nameField, 'the normal create-project dialog renders the project name field');
  const stableFieldType = nameField.type;

  for (const value of ['项', '项目', '项目名称测试']) {
    nameField.props.onChange(value);
    tree = render();
    renderComponents(tree);
    nameField = findNodes(tree, node => typeof node.type === 'function' && node.type.name === 'Field' && node.props.label === '项目名称')[0];
    assert.ok(nameField);
    assert.equal(nameField.type, stableFieldType, 'React keeps the same controlled field component type after each state update');
    assert.equal(nameField.props.value, value);
  }
});

test('project form date controls do not shadow the native Date constructor', () => {
  const { renderDateInput } = createHarness();
  assert.doesNotThrow(() => renderDateInput());
});
