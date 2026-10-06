import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceConfigCreate } from '../src/actions/service-workspace.action.ts';
import { ServiceConfigItem } from '../src/objects/sales.object.ts';
import { ServiceConfigPage } from '../src/pages/sales-service-workspace.page.ts';
import { serviceManagerPermission } from '../src/permissions/otc-role.permission.ts';
import { createServicePageHarness, serviceButton, serviceNodes, serviceText } from './service-page-react-harness.mjs';

function pageGlobals() {
  function DocumentWorkspace() {}
  return {
    DocumentWorkspace,
    location: { href: 'http://service-page.test/_console/apps/com.inoforge.forge.sales/page_service_config', pathname: '/_console/apps/com.inoforge.forge.sales/page_service_config', origin: 'http://service-page.test' },
    navigate() {},
  };
}

function assertJsonEqual(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

function categoryTabs(tree) {
  return serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '服务配置分类')[0];
}

function configForm(tree) {
  return serviceNodes(tree, node => node.type === 'ObjectForm' && node.props.objectName === 'forge_service_config_item')[0];
}

function openCreate(tree) {
  const button = serviceButton(tree, '新增配置');
  assert.ok(button, 'the service manager retains the existing configuration create action');
  button.props.onClick();
}

function cancelCreate(tree) {
  const dialog = serviceNodes(tree, node => node.type === 'CompositeDialog' && node.props.title === '新增服务配置')[0];
  assert.ok(dialog);
  dialog.props.onOpenChange(false);
  return dialog;
}

function createManagerHarness(options = {}) {
  return createServicePageHarness(ServiceConfigPage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    users: { id: 'service-config-manager' },
    records: { forge_service_config_item: [], ...(options.records || {}) },
    formValues: options.formValues,
    onAction: options.onAction,
    globals: pageGlobals(),
  });
}

test('new configuration defaults to the selected category and safely falls back for all or invalid tabs', async () => {
  const categories = ServiceConfigItem.fields.category.options;
  assert.equal(categories.length, 9);
  assert.ok(categories.some(option => option.value === 'warranty_rule'));
  assert.ok(categories.some(option => option.value === 'fee_type'));
  const harness = createManagerHarness();
  let tree = await harness.flushEffects();

  openCreate(tree);
  tree = harness.render();
  assert.equal(configForm(tree).props.values.category, 'order_type', 'the All tab keeps the original default');
  cancelCreate(tree);
  tree = harness.render();

  categoryTabs(tree).props.onValueChange('not-a-service-category');
  tree = harness.render();
  openCreate(tree);
  tree = harness.render();
  assert.equal(configForm(tree).props.values.category, 'order_type', 'an unrecognized category cannot become a new record default');
  cancelCreate(tree);
  tree = harness.render();

  for (const option of categories) {
    const tabs = categoryTabs(tree);
    assert.ok(tabs.props.items.some(item => item.value === option.value));
    tabs.props.onValueChange(option.value);
    tree = harness.render();
    const list = serviceNodes(tree, node => node.type === 'ListView' && node.props.data?.object === 'forge_service_config_item')[0];
    assertJsonEqual(list.props.filters, ['category', '=', option.value]);
    openCreate(tree);
    tree = harness.render();
    assert.equal(configForm(tree).props.values.category, option.value, `new ${option.value} records inherit the selected category`);
    cancelCreate(tree);
    tree = harness.render();
  }

  assert.equal(harness.calls.some(call => call.path === '/actions/forge_service_config_item/service_config_create'), false, 'opening and cancelling categories never creates a record');
});

test('selected warranty-rule category keeps the existing guarded create Action and draft_json contract', async () => {
  const records = { forge_service_config_item: [] };
  const harness = createManagerHarness({
    records,
    formValues: props => ({
      ...props.values,
      name: '默认质保规则',
      code: 'WARRANTY-DEFAULT',
      status: 'active',
      description: '保修规则说明',
      remarks: '',
    }),
    onAction: async ({ path, body }) => {
      assert.equal(path, '/actions/forge_service_config_item/service_config_create');
      assert.deepEqual(Object.keys(body.params), ['draft_json']);
      const draft = JSON.parse(body.params.draft_json);
      assert.equal(draft.category, 'warranty_rule');
      const record = { id: 'config-warranty-rule', ...draft, revision: 1, status: 'active' };
      records.forge_service_config_item.push(record);
      return { id: record.id, category: record.category, status: record.status };
    },
  });
  let tree = await harness.flushEffects();
  categoryTabs(tree).props.onValueChange('warranty_rule');
  tree = harness.render();
  openCreate(tree);
  tree = harness.render();
  assert.equal(configForm(tree).props.values.category, 'warranty_rule');

  const dialog = serviceNodes(tree, node => node.type === 'CompositeDialog' && node.props.title === '新增服务配置')[0];
  const submit = serviceButton(dialog, '新增配置');
  assert.ok(submit);
  await submit.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  tree = await harness.settle();

  assert.equal(harness.calls.filter(call => call.path === '/actions/forge_service_config_item/service_config_create').length, 1);
  const actionCall = harness.calls.find(call => call.path === '/actions/forge_service_config_item/service_config_create');
  assert.equal(actionCall.method, 'POST');
  assert.deepEqual(Object.keys(actionCall.body.params), ['draft_json']);
  assert.equal(records.forge_service_config_item[0].category, 'warranty_rule');
  assert.ok(harness.calls.some(call => call.method === 'GET' && call.path === '/data/forge_service_config_item/config-warranty-rule'), 'the created configuration is read back through the existing record endpoint');
  assert.equal(ServiceConfigCreate.objectName, 'forge_service_config_item');
  assert.deepEqual(ServiceConfigCreate.requiredPermissions, serviceManagerPermission.systemPermissions);
  assert.equal(serviceText(tree).includes('已保存'), true);
});
