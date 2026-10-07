import assert from 'node:assert/strict';
import test from 'node:test';
import { WarrantyManagementPage } from '../src/pages/sales-service-workspace.page.ts';
import { serviceManagerPermission, serviceOperatorPermission } from '../src/permissions/otc-role.permission.ts';
import { createServicePageHarness, serviceButton, serviceNodes, serviceText } from './service-page-react-harness.mjs';

function pageGlobals() {
  function DocumentWorkspace() {}
  return {
    DocumentWorkspace,
    location: { href: 'http://service-page.test/_console/apps/com.inoforge.forge.sales/page_warranty_management', pathname: '/_console/apps/com.inoforge.forge.sales/page_warranty_management', origin: 'http://service-page.test' },
    navigate() {},
  };
}

function card(status, id = 'warranty-card-1') {
  return {
    id,
    code: 'WC-' + id,
    name: '质保卡 ' + id,
    status,
    revision: 7,
    starts_on: '2026-09-01',
    ends_on: '2027-09-01',
    owner_id: 'warranty-manager',
    customer_id: 'customer-1',
    service_order_id: 'service-order-1',
    product_sn: '设备-1',
    scope: '整机/整单服务',
    responsible_party: '供应商',
  };
}

function makeHarness(warranty, { manager = true, onAction = async () => ({}) } = {}) {
  const records = { forge_warranty_card: [warranty], forge_warranty_card_event: [] };
  const harness = createServicePageHarness(WarrantyManagementPage, {
    manager,
    permissions: manager ? serviceManagerPermission.systemPermissions : serviceOperatorPermission.systemPermissions,
    users: { id: manager ? 'warranty-manager' : 'warranty-operator' },
    records,
    onAction,
    globals: pageGlobals(),
  });
  return { harness, records };
}

async function openCard(harness, warranty) {
  let tree = await harness.flushEffects();
  const tabs = serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '质保管理视图')[0];
  assert.ok(tabs);
  tabs.props.onValueChange('cards');
  tree = harness.render();
  const row = serviceButton(tree, warranty.code);
  assert.ok(row, 'the warranty-card list contains the selected fixture row');
  row.props.onClick();
  return harness.settle();
}

function cardDetail(tree, warranty) {
  return serviceNodes(tree, node => node.type === 'CompositeDialog' && node.props.title === warranty.name)[0];
}

function actionDialog(tree, title) {
  return serviceNodes(tree, node => node.type === 'CompositeDialog' && node.props.title === title)[0];
}

function actionCalls(harness) {
  return harness.calls.filter(call => call.method === 'POST' && call.path.startsWith('/actions/forge_warranty_card/'));
}

test('pending-activation card uses the existing activation dialog and Action envelope; cancelling does not call the Action', async () => {
  const warranty = card('pending_activation');
  const { harness } = makeHarness(warranty, {
    onAction: async ({ path, body }) => {
      assert.equal(path, '/actions/forge_warranty_card/warranty_card_activate/warranty-card-1');
      Object.assign(warranty, {
        status: 'active',
        starts_on: body.params.starts_on,
        ends_on: body.params.ends_on,
        revision: warranty.revision + 1,
        activated_by: 'warranty-manager',
      });
      return { id: warranty.id, status: warranty.status };
    },
  });
  let tree = await openCard(harness, warranty);
  const detail = cardDetail(tree, warranty);
  assert.ok(detail);
  serviceButton(detail, '激活质保卡').props.onClick();
  tree = harness.render();
  let modal = actionDialog(tree, '激活质保卡');
  assert.ok(modal, 'the existing pending-activation action opens its date form');
  const startInput = serviceNodes(modal, node => node.type === 'ForgeDateInput' && node.props['aria-label'] === '开始日期')[0];
  const endInput = serviceNodes(modal, node => node.type === 'ForgeDateInput' && node.props['aria-label'] === '到期日期')[0];
  assert.equal(startInput.props.value, '2026-09-01');
  assert.equal(endInput.props.value, '2027-09-01');
  modal.props.onOpenChange(false);
  tree = harness.render();
  assert.equal(actionCalls(harness).length, 0, 'closing the dialog does not run the activation Action');

  serviceButton(cardDetail(tree, warranty), '激活质保卡').props.onClick();
  tree = harness.render();
  modal = actionDialog(tree, '激活质保卡');
  serviceNodes(modal, node => node.type === 'ForgeDateInput' && node.props['aria-label'] === '开始日期')[0].props.onChange({ target: { value: '2026-10-05' } });
  tree = harness.render();
  modal = actionDialog(tree, '激活质保卡');
  serviceNodes(modal, node => node.type === 'ForgeDateInput' && node.props['aria-label'] === '到期日期')[0].props.onChange({ target: { value: '2027-10-05' } });
  tree = harness.render();
  modal = actionDialog(tree, '激活质保卡');
  serviceButton(modal, '激活质保卡').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  tree = await harness.settle();

  const calls = actionCalls(harness);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/actions/forge_warranty_card/warranty_card_activate/warranty-card-1');
  assert.deepEqual(calls[0].body.params, {
    starts_on: '2026-10-05',
    ends_on: '2027-10-05',
    expected_revision: 7,
    idempotency_key: calls[0].body.params.idempotency_key,
  });
  assert.ok(calls[0].body.params.idempotency_key);
  assert.ok(harness.calls.some(call => call.method === 'GET' && call.path === '/data/forge_warranty_card/warranty-card-1'), 'the page reads the activated card back');
  assert.equal(warranty.status, 'active');
  assert.equal(serviceNodes(tree, node => node.type === 'CompositeDialog' && node.props.title === warranty.name).length, 0);
});

test('active, grace-period, and expired cards open the existing extension form and cancel without writes', async () => {
  for (const status of ['active', 'grace_period', 'expired']) {
    const warranty = card(status, 'warranty-' + status);
    const { harness } = makeHarness(warranty);
    const tree = await openCard(harness, warranty);
    const detail = cardDetail(tree, warranty);
    assert.ok(detail);
    const extend = serviceButton(detail, '延长质保');
    assert.ok(extend, `${status} cards expose the existing extension action`);
    extend.props.onClick();
    const current = harness.render();
    const modal = actionDialog(current, '延长质保');
    assert.ok(modal);
    assert.ok(serviceNodes(modal, node => node.type === 'ForgeDateInput' && node.props['aria-label'] === '延长至')[0]);
    assert.ok(serviceNodes(modal, node => node.type === 'textarea' && node.props['aria-label'] === '延保说明')[0]);
    assert.ok(serviceButton(modal, '保存延保'));
    modal.props.onOpenChange(false);
    harness.render();
    assert.equal(actionCalls(harness).length, 0, `${status} extension cancellation does not send an Action`);
  }
});

test('extension failure preserves the entered form and sends only the existing revision/idempotency parameters', async () => {
  const warranty = card('grace_period', 'warranty-extension-failure');
  const { harness } = makeHarness(warranty, {
    onAction: async () => { throw new Error('质保卡已被其他操作修改，请刷新后重试'); },
  });
  let tree = await openCard(harness, warranty);
  serviceButton(cardDetail(tree, warranty), '延长质保').props.onClick();
  tree = harness.render();
  let modal = actionDialog(tree, '延长质保');
  serviceNodes(modal, node => node.type === 'ForgeDateInput' && node.props['aria-label'] === '延长至')[0].props.onChange({ target: { value: '2027-10-01' } });
  tree = harness.render();
  modal = actionDialog(tree, '延长质保');
  serviceNodes(modal, node => node.type === 'textarea' && node.props['aria-label'] === '延保说明')[0].props.onChange({ target: { value: '按服务承诺延保' } });
  tree = harness.render();
  modal = actionDialog(tree, '延长质保');
  serviceButton(modal, '保存延保').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  tree = await harness.settle();

  const calls = actionCalls(harness);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/actions/forge_warranty_card/warranty_card_extend/warranty-extension-failure');
  assert.equal(calls[0].body.params.ends_on, '2027-10-01');
  assert.equal(calls[0].body.params.note, '按服务承诺延保');
  assert.equal(calls[0].body.params.expected_revision, 7);
  assert.ok(calls[0].body.params.idempotency_key);
  modal = actionDialog(tree, '延长质保');
  assert.ok(modal, 'a failed Action leaves the dialog open');
  assert.ok(serviceNodes(modal, node => node.type === 'ForgeDateInput' && node.props['aria-label'] === '延长至' && node.props.value === '2027-10-01').length > 0);
  assert.ok(serviceNodes(modal, node => node.type === 'textarea' && node.props['aria-label'] === '延保说明' && node.props.value === '按服务承诺延保').length > 0);
  assert.ok(serviceNodes(modal, node => node.type === 'ForgeNotice' && node.props.tone === 'error' && serviceText(node).includes('已被其他操作修改')).length > 0);
  assert.equal(warranty.status, 'grace_period', 'a rejected Action did not mutate the fixture record');
});

test('unsupported statuses and non-manager identities do not expose warranty management actions', async () => {
  const unsupported = card('terminated', 'warranty-unsupported');
  const unsupportedHarness = makeHarness(unsupported).harness;
  let tree = await openCard(unsupportedHarness, unsupported);
  const unsupportedDetail = cardDetail(tree, unsupported);
  assert.equal(serviceButton(unsupportedDetail, '激活质保卡'), undefined);
  assert.equal(serviceButton(unsupportedDetail, '延长质保'), undefined);

  const pending = card('pending_activation', 'warranty-operator');
  pending.owner_id = 'warranty-operator';
  const operatorHarness = makeHarness(pending, { manager: false }).harness;
  tree = await openCard(operatorHarness, pending);
  const operatorDetail = cardDetail(tree, pending);
  assert.ok(operatorDetail);
  assert.equal(serviceButton(operatorDetail, '激活质保卡'), undefined, 'service operators have no authority to activate cards');
  assert.equal(serviceButton(operatorDetail, '延长质保'), undefined, 'service operators have no authority to extend cards');
  assert.equal(actionCalls(operatorHarness).length, 0);
});
