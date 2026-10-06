import assert from 'node:assert/strict';
import test from 'node:test';
import { PageSchema } from '@objectstack/spec/ui';
import { FieldSchema } from '@objectstack/spec/data';
import { createServicePageHarness, serviceText } from './service-page-react-harness.mjs';
import { ServiceOrderCreatePage } from '../src/pages/sales-service-workspace.page.ts';
import { ServiceOrder } from '../src/objects/sales.object.ts';
import { ServiceOrderCreate } from '../src/actions/sales.action.ts';
import { serviceManagerPermission, serviceOperatorPermission } from '../src/permissions/otc-role.permission.ts';

function DocumentWorkspace() {}

function nestedNodes(value, predicate, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  const matches = predicate(value) ? [value] : [];
  const nested = Object.values(value).flatMap(child => Array.isArray(child)
    ? child.flatMap(item => nestedNodes(item, predicate, seen))
    : nestedNodes(child, predicate, seen));
  return [...matches, ...nested];
}

function pageGlobals(path = '/_console/apps/com.inoforge.forge.sales/page_service_order_create', navigate = () => {}) {
  return {
    DocumentWorkspace,
    location: { href: 'http://service-page.test' + path, pathname: path, origin: 'http://service-page.test' },
    navigate,
  };
}

function apiResponse(payload, status = 200) {
  return { ok: status < 400, status, json: async () => payload, headers: new Headers() };
}

function createCatalogTransport({ rows = [], manager = true, configHandler } = {}) {
  const calls = [];
  const transport = async (url, options = {}) => {
    const parsed = new URL(url);
    const route = parsed.pathname.replace('/api/v1', '');
    const method = String(options.method || 'GET').toUpperCase();
    calls.push({ route, method, search: parsed.search });
    if (route === '/auth/get-session') return apiResponse({ user: { id: 'service-order-create-manager' } });
    if (route === '/auth/me/permissions') return apiResponse({ systemPermissions: manager ? serviceManagerPermission.systemPermissions : serviceOperatorPermission.systemPermissions });
    if (route === '/actions/forge_service_order/service_order_manager_context') return manager ? apiResponse({ canManage: true }) : apiResponse({ error: { message: 'forbidden' } }, 403);
    if (route === '/data/forge_service_config_item') {
      if (configHandler) return configHandler({ parsed, method });
      const skip = Number(parsed.searchParams.get('$skip') || 0);
      const top = Number(parsed.searchParams.get('$top') || 100);
      return apiResponse({ records: rows.slice(skip, skip + top), totalCount: rows.length });
    }
    return apiResponse({});
  };
  return { calls, transport };
}

function serviceTypeField(form) {
  return form.props.customFields?.find(field => field.name === 'service_type');
}

function assertValidServiceTypeOptions(options, labels) {
  assertJsonEqual(options.map(option => option.label), labels, 'the user sees the configured business names');
  assert.equal(new Set(options.map(option => option.value)).size, options.length, 'each option has a unique hidden key');
  assert.ok(options.every(option => /^[a-z][a-z0-9_.]*$/.test(option.value)), 'hidden keys use legal SystemIdentifier syntax');
  assert.ok(options.every(option => option.value !== option.label), 'display labels are separate from stored option keys');
  assert.equal(FieldSchema.safeParse({ name: 'service_type', type: 'select', label: '服务场景', options }).success, true, 'the generated options pass the actual ObjectStack field schema');
}

function assertJsonEqual(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

function assertCatalogQuery(calls) {
  const queries = calls.map(call => {
    const path = call.route ? call.route + (call.search || '') : call.url || call.path;
    const parsed = new URL(path, 'http://service-page.test');
    return { ...call, route: parsed.pathname, search: parsed.search };
  }).filter(call => call.route === '/data/forge_service_config_item');
  assert.ok(queries.length > 0, 'the manager reads the service-type catalog');
  for (const call of queries) {
    const params = new URLSearchParams(call.search);
    assert.equal(call.method, 'GET');
    assert.deepEqual(JSON.parse(params.get('$filter')), { category: 'order_type', status: 'active' });
    assert.equal(params.get('$count'), 'true');
    assert.equal(params.get('$orderby'), 'id asc');
  }
  return queries;
}

const validDraft = {
  name: '服务现场检查',
  code: 'WO-TEST-001',
  customer_id: 'customer-source-1',
  contact_id: 'contact-source-1',
  contact_phone: '13800001000',
  sales_order_id: 'sales-order-source-1',
  service_mode: 'onsite',
  urgency: 'medium',
  service_address: '测试服务地点',
  service_object: '测试设备',
  service_type: '设备巡检',
};

test('standalone service-order page uses the current order form, public document layout and registered cancel route', async () => {
  PageSchema.parse(ServiceOrderCreatePage);
  const navigations = [];
  const harness = createServicePageHarness(ServiceOrderCreatePage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    users: { id: 'service-order-create-manager' },
    records: { forge_service_order: [] },
    globals: pageGlobals(undefined, path => navigations.push(path)),
  });
  const tree = await harness.flushEffects();
  const header = nestedNodes(tree, node => node.type === 'WorkspaceHeader')[0];
  assert.equal(header.props.title, '新建服务工单');
  assert.equal(typeof header.props.subtitle, 'string');
  const workspace = nestedNodes(tree, node => node.type === 'DocumentWorkspace')[0];
  assert.equal(workspace.props.sidebarLabel, '工单操作');
  const form = nestedNodes(tree, node => node.type === 'ObjectForm' && node.props.objectName === 'forge_service_order')[0];
  assert.ok(form, 'the standalone page keeps the existing native service-order ObjectForm');
  assert.ok(form.props.fields.includes('customer_id') && form.props.fields.includes('sales_order_id'));
  assert.equal(form.props.customFields?.find(field => field.name === 'sales_order_id')?.required, true);
  const serviceType = serviceTypeField(form);
  assert.equal(serviceType.name, 'service_type');
  assert.equal(serviceType.label, '服务场景');
  assert.equal(serviceType.widget, 'declared-label-combobox');
  assertJsonEqual(serviceType.options, [], 'an empty catalog does not invent service types');
  assertValidServiceTypeOptions(serviceType.options, []);
  assert.equal(form.props.values.service_type, undefined, 'the first option is never auto-selected');
  assert.ok(nestedNodes(tree, node => node.type === 'ForgeNotice' && serviceText(node).includes('暂无启用的服务场景')).length > 0);
  assertCatalogQuery(harness.calls);
  assert.equal(form.props.sections.length, 4, 'the page uses the four current source form groups without inventing reference-only sections');
  assert.notEqual(ServiceOrder.fields.sales_order_id.required, true, 'the UI-only required lookup does not alter the stored field contract');
  assert.equal(ServiceOrder.fields.service_type.type, 'text', 'service_type retains its existing text storage contract');
  assert.notEqual(ServiceOrder.fields.service_type.required, true, 'the lookup does not make the source field required');
  assert.doesNotMatch(ServiceOrderCreate.body.source, /!draft\.service_type/, 'the native Action does not gain a new requirement for service_type');
  assert.deepEqual(ServiceOrderCreate.requiredPermissions, serviceManagerPermission.systemPermissions);

  const cancel = nestedNodes(tree, node => node.type === 'button' && serviceText(node).trim() === '取消')[0];
  assert.ok(cancel, 'the header exposes a normal cancel control');
  cancel.props.onClick();
  assert.deepEqual(navigations, ['/apps/com.inoforge.forge.sales/page_service_orders']);
  assert.equal(harness.calls.some(call => call.path === '/actions/forge_service_order/service_order_create'), false, 'cancel returns without creating a business record');
});

test('manager reads the complete enabled service-type catalog and maps names into the existing text field', async () => {
  const rows = [
    { id: 'config-001', name: '设备巡检', category: 'order_type', status: 'active' },
    ...Array.from({ length: 99 }, (_, index) => {
      const sequence = String(index + 2).padStart(3, '0');
      return {
        id: 'config-' + sequence,
        name: '其他设置 ' + sequence,
        category: index === 20 ? 'order_type' : 'payment_template',
        status: index === 20 ? 'inactive' : 'active',
      };
    }),
    { id: 'config-101', name: '现场维修', category: 'order_type', status: 'active' },
  ];
  const fixture = createCatalogTransport({ rows });
  const harness = createServicePageHarness(ServiceOrderCreatePage, {
    globals: pageGlobals(),
    transport: fixture.transport,
  });
  const tree = await harness.flushEffects();
  const queries = assertCatalogQuery(fixture.calls);
  assert.deepEqual(queries.map(call => [Number(new URLSearchParams(call.search).get('$skip')), Number(new URLSearchParams(call.search).get('$top'))]), [[0, 100], [100, 100]], 'the page reads through the second page instead of stopping at the first 100 records');

  const form = nestedNodes(tree, node => node.type === 'ObjectForm' && node.props.objectName === 'forge_service_order')[0];
  const field = serviceTypeField(form);
  assert.ok(form.props.fields.includes('service_type'));
  assertValidServiceTypeOptions(field.options, ['设备巡检', '现场维修']);
  assert.equal(field.widget, 'declared-label-combobox');
  assert.equal(field.reference, undefined, 'the lookup does not introduce a reference field');
  assert.equal(field.idField, undefined, 'configuration record ids are not stored in service_type');
  assert.equal(field.quickCreate, undefined, 'the lookup cannot create configuration records');
  assert.notEqual(field.required, true, 'the service-type UI does not create a new required business rule');
  assert.equal(form.props.values.service_type, undefined, 'loading options does not choose a value for the user');
});

test('catalog failures and incomplete pages leave the service-type lookup empty and read-only', async () => {
  const deniedFixture = createCatalogTransport({
    configHandler: async () => apiResponse({ error: { message: 'forbidden' } }, 403),
  });
  const deniedHarness = createServicePageHarness(ServiceOrderCreatePage, {
    globals: pageGlobals(),
    transport: deniedFixture.transport,
  });
  const deniedTree = await deniedHarness.flushEffects();
  const deniedForm = nestedNodes(deniedTree, node => node.type === 'ObjectForm' && node.props.objectName === 'forge_service_order')[0];
  assertJsonEqual(serviceTypeField(deniedForm).options, []);
  assert.equal(serviceTypeField(deniedForm).readonly, true);
  assert.ok(nestedNodes(deniedTree, node => node.type === 'ForgeNotice' && node.props.tone === 'error' && serviceText(node).includes('无权读取服务场景配置')).length > 0);

  const incompleteFixture = createCatalogTransport({
    configHandler: async ({ parsed }) => Number(parsed.searchParams.get('$skip') || 0) === 0
      ? apiResponse({ records: [{ id: 'config-partial', name: '部分读取类型', category: 'order_type', status: 'active' }], totalCount: 2 })
      : apiResponse({ records: [], totalCount: 2 }),
  });
  const incompleteHarness = createServicePageHarness(ServiceOrderCreatePage, {
    globals: pageGlobals(),
    transport: incompleteFixture.transport,
  });
  const incompleteTree = await incompleteHarness.flushEffects();
  const incompleteForm = nestedNodes(incompleteTree, node => node.type === 'ObjectForm' && node.props.objectName === 'forge_service_order')[0];
  assertJsonEqual(serviceTypeField(incompleteForm).options, [], 'partial options are withheld until the full read succeeds');
  assert.equal(serviceTypeField(incompleteForm).readonly, true);
  assert.ok(nestedNodes(incompleteTree, node => node.type === 'ForgeNotice' && node.props.tone === 'error' && serviceText(node).includes('不完整')).length > 0);
  assert.equal(assertCatalogQuery(incompleteFixture.calls).length, 2);
});

test('catalog options arriving asynchronously preserve the current form value', async () => {
  let finishCatalog;
  let signalCatalogStarted;
  const catalogStarted = new Promise(resolve => { signalCatalogStarted = resolve; });
  const fixture = createCatalogTransport({
    configHandler: () => {
      signalCatalogStarted();
      return new Promise(resolve => { finishCatalog = resolve; });
    },
  });
  const harness = createServicePageHarness(ServiceOrderCreatePage, {
    globals: pageGlobals(),
    transport: fixture.transport,
  });
  const loading = harness.flushEffects();
  await catalogStarted;

  let tree = harness.render();
  let form = nestedNodes(tree, node => node.type === 'ObjectForm' && node.props.objectName === 'forge_service_order')[0];
  assert.equal(serviceTypeField(form).readonly, true);
  assertJsonEqual(serviceTypeField(form).options, []);
  form.props.onValuesChange({ ...form.props.values, service_type: '用户已填写场景' });
  tree = harness.render();
  form = nestedNodes(tree, node => node.type === 'ObjectForm' && node.props.objectName === 'forge_service_order')[0];
  assert.equal(form.props.values.service_type, '用户已填写场景');

  finishCatalog(apiResponse({ records: [{ id: 'config-active', name: '设备巡检', category: 'order_type', status: 'active' }], totalCount: 1 }));
  await loading;
  tree = harness.render();
  form = nestedNodes(tree, node => node.type === 'ObjectForm' && node.props.objectName === 'forge_service_order')[0];
  assertValidServiceTypeOptions(serviceTypeField(form).options, ['设备巡检']);
  assert.equal(form.props.values.service_type, '用户已填写场景', 'options are asynchronous; they do not replace the saved field value');
});

test('manager can create through the existing Action, read the new order back, then return to the order list', async () => {
  const actor = 'service-order-create-manager';
  const createdId = 'service-order-created-from-page';
  let selectedTypeKey = '';
  const records = {
    forge_service_order: [],
    forge_service_config_item: [{ id: 'config-service-type', name: validDraft.service_type, category: 'order_type', status: 'active' }],
  };
  const navigations = [];
  const harness = createServicePageHarness(ServiceOrderCreatePage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    users: { id: actor },
    records,
    formValues: props => {
      const option = props.customFields.find(field => field.name === 'service_type').options.find(item => item.label === validDraft.service_type);
      assert.ok(option, 'the submitted service type comes from the loaded catalog');
      selectedTypeKey = option.value;
      return { ...validDraft, service_type: option.label };
    },
    globals: pageGlobals(undefined, path => navigations.push(path)),
    onAction: async ({ path, body }) => {
      assert.equal(path, '/actions/forge_service_order/service_order_create');
      const draft = JSON.parse(body.params.draft_json);
      assert.equal(draft.customer_id, validDraft.customer_id);
      assert.equal(draft.sales_order_id, validDraft.sales_order_id);
      assert.equal(draft.service_type, validDraft.service_type, 'the selected service type is stored as its business name');
      assert.notEqual(draft.service_type, selectedTypeKey, 'the machine option key is not written into the text field');
      records.forge_service_order.push({ id: createdId, ...draft, owner_id: actor, responsible_id: actor, status: 'pending_acceptance' });
      return { id: createdId, status: 'pending_acceptance' };
    },
  });
  let tree = await harness.flushEffects();
  const create = nestedNodes(tree, node => node.type === 'button' && serviceText(node).trim() === '创建服务工单')[0];
  assert.ok(create, 'the manager sees the single supported create operation; no draft action is added');
  create.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  await harness.settle();
  tree = harness.render();

  const createCalls = harness.calls.filter(call => call.path === '/actions/forge_service_order/service_order_create');
  assert.equal(createCalls.length, 1, 'the form submits once through the existing service_order_create Action');
  assert.equal(createCalls[0].method, 'POST');
  assert.ok(harness.calls.some(call => call.method === 'GET' && call.path === '/data/forge_service_order/' + createdId), 'the page reads the newly created order back before navigating');
  assert.equal(records.forge_service_order[0].status, 'pending_acceptance');
  assert.deepEqual(navigations, ['/apps/com.inoforge.forge.sales/page_service_orders']);
  assert.equal(nestedNodes(tree, node => node.type === 'ForgeNotice' && node.props.tone === 'error').length, 0);
  assert.deepEqual(ServiceOrderCreate.requiredPermissions, serviceManagerPermission.systemPermissions);
});

test('service manager permission protects direct page access and create failures keep the form open', async () => {
  const denied = createServicePageHarness(ServiceOrderCreatePage, {
    permissions: serviceOperatorPermission.systemPermissions,
    globals: pageGlobals(),
  });
  const deniedTree = await denied.flushEffects();
  assert.equal(nestedNodes(deniedTree, node => node.type === 'ObjectForm' && node.props.objectName === 'forge_service_order').length, 0);
  assert.equal(nestedNodes(deniedTree, node => node.type === 'button' && serviceText(node).trim() === '创建服务工单').length, 0);
  assert.ok(nestedNodes(deniedTree, node => node.type === 'ForgeNotice' && node.props.tone === 'error').length > 0);
  assert.equal(denied.calls.some(call => call.path.startsWith('/data/forge_service_config_item')), false, 'a non-manager never reads the service-type catalog');

  const navigations = [];
  const failed = createServicePageHarness(ServiceOrderCreatePage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    users: { id: 'service-order-create-manager' },
    records: { forge_service_order: [] },
    formValues: validDraft,
    globals: pageGlobals(undefined, path => navigations.push(path)),
    onAction: async () => { throw new Error('客户与来源订单不匹配或不可访问'); },
  });
  let failedTree = await failed.flushEffects();
  nestedNodes(failedTree, node => node.type === 'button' && serviceText(node).trim() === '创建服务工单')[0].props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  await failed.settle();
  failedTree = failed.render();
  assert.ok(nestedNodes(failedTree, node => node.type === 'ObjectForm' && node.props.objectName === 'forge_service_order').length > 0, 'a failed Action does not discard the current form');
  assert.ok(nestedNodes(failedTree, node => node.type === 'ForgeNotice' && node.props.tone === 'error' && serviceText(node).includes('客户与来源订单不匹配或不可访问')).length > 0);
  assert.deepEqual(navigations, [], 'failure leaves the user on the form for correction');
});

test('cancel keeps a changed standalone order until the manager explicitly discards it', async () => {
  const navigations = [];
  const harness = createServicePageHarness(ServiceOrderCreatePage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    globals: pageGlobals(undefined, path => navigations.push(path)),
  });
  let tree = await harness.flushEffects();
  const changed = { name: '现场中文标题', service_mode: 'onsite', urgency: 'medium' };
  nestedNodes(tree, node => node.type === 'ObjectForm')[0].props.onValuesChange(changed);
  tree = harness.render();
  nestedNodes(tree, node => node.type === 'button' && serviceText(node).trim() === '取消')[0].props.onClick();
  tree = harness.render();
  assert.deepEqual(navigations, [], 'cancel cannot silently discard the current draft');
  let guard = nestedNodes(tree, node => node.type === 'ForgeDialog' && node.props.open)[0];
  assert.ok(guard, 'changed values use the existing shared confirmation dialog');
  guard.props.onCancel();
  tree = harness.render();
  assertJsonEqual(nestedNodes(tree, node => node.type === 'ObjectForm')[0].props.values, changed);
  assert.deepEqual(navigations, []);
  nestedNodes(tree, node => node.type === 'button' && serviceText(node).trim() === '取消')[0].props.onClick();
  tree = harness.render();
  guard = nestedNodes(tree, node => node.type === 'ForgeDialog' && node.props.open)[0];
  guard.props.onConfirm();
  assert.deepEqual(navigations, ['/apps/com.inoforge.forge.sales/page_service_orders']);
  assert.equal(harness.calls.some(call => call.path === '/actions/forge_service_order/service_order_create'), false);
});

test('native defaults and cleared empty values do not create an unsaved order', async () => {
  const navigations = [];
  const harness = createServicePageHarness(ServiceOrderCreatePage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    globals: pageGlobals(undefined, path => navigations.push(path)),
  });
  let tree = await harness.flushEffects();
  nestedNodes(tree, node => node.type === 'ObjectForm')[0].props.onValuesChange({
    name: '', code: '', customer_id: null, service_mode: 'onsite', urgency: 'medium', onsite_evidence_attachments: [],
    revision: 1, status: 'pending_acceptance', onsite_evidence_count: 0,
  });
  tree = harness.render();
  nestedNodes(tree, node => node.type === 'button' && serviceText(node).trim() === '取消')[0].props.onClick();
  assert.deepEqual(navigations, ['/apps/com.inoforge.forge.sales/page_service_orders']);
});
