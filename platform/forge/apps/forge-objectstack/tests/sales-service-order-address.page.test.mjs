import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceOrderCreatePage } from '../src/pages/sales-service-workspace.page.ts';
import { serviceManagerPermission } from '../src/permissions/otc-role.permission.ts';
import { createServicePageHarness, serviceText } from './service-page-react-harness.mjs';

function DocumentWorkspace() {}
const customerA = { id: 'customer-a', address: '客户甲现场' };
const customerB = { id: 'customer-b', address: '客户乙现场' };
function nodes(value, predicate, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  return [...(predicate(value) ? [value] : []), ...Object.values(value).flatMap(item =>
    Array.isArray(item) ? item.flatMap(child => nodes(child, predicate, seen)) : nodes(item, predicate, seen))];
}
function form(harness) { return harness.forms.at(-1); }
function change(harness, patch) {
  form(harness).onValuesChange({ ...form(harness).values, ...patch });
  harness.render();
}
function fixture(extra = {}) {
  return createServicePageHarness(ServiceOrderCreatePage, {
    manager: true, permissions: serviceManagerPermission.systemPermissions,
    globals: { DocumentWorkspace },
    records: {
      forge_customer: [customerA, customerB],
      forge_sales_order: [
        { id: 'order-a', customer_id: customerA.id, delivery_address: '订单甲交付现场' },
        { id: 'order-empty', customer_id: customerA.id, delivery_address: null },
        { id: 'order-b', customer_id: customerB.id, delivery_address: '订单乙交付现场' },
      ],
    }, ...extra,
  });
}
function response(value, status = 200) {
  return { ok: status < 400, status, headers: new Headers(), json: async () => value };
}
function transport(readCustomer) {
  return async url => {
    const route = new URL(url).pathname.replace('/api/v1', '');
    if (route === '/auth/get-session') return response({ user: { id: 'manager' } });
    if (route === '/auth/me/permissions') return response({ systemPermissions: serviceManagerPermission.systemPermissions });
    if (route === '/actions/forge_service_order/service_order_manager_context') return response({ canManage: true });
    if (route === '/data/forge_service_config_item') return response({ records: [], totalCount: 0 });
    if (route.startsWith('/data/forge_customer/')) return readCustomer(route.split('/').at(-1));
    return response({});
  };
}

test('selected customer and matching order provide address; clearing sources removes the generated value', { timeout: 5000 }, async () => {
  const harness = fixture(); await harness.flushEffects();
  change(harness, { customer_id: customerA.id }); await harness.flushEffects();
  assert.equal(form(harness).values.service_address, customerA.address);
  change(harness, { sales_order_id: 'order-a' }); await harness.flushEffects();
  assert.equal(form(harness).values.service_address, '订单甲交付现场');
  change(harness, { sales_order_id: 'order-empty' }); await harness.flushEffects();
  assert.equal(form(harness).values.service_address, customerA.address);
  change(harness, { customer_id: null, sales_order_id: null }); await harness.flushEffects();
  assert.equal(form(harness).values.service_address, '');
  assert.equal(harness.calls.some(call => call.path.includes('/service_order_create')), false);
});

test('incompatible order never supplies its address', { timeout: 5000 }, async () => {
  const harness = fixture(); await harness.flushEffects();
  change(harness, { customer_id: customerA.id }); await harness.flushEffects();
  change(harness, { sales_order_id: 'order-b' }); const tree = await harness.flushEffects();
  assert.equal(form(harness).values.service_address, '');
  assert.ok(nodes(tree, n => n.type === 'ForgeNotice').some(n => serviceText(n).includes('客户与来源订单不匹配')));
});

test('manual address survives a later source change', { timeout: 5000 }, async () => {
  const harness = fixture(); await harness.flushEffects();
  change(harness, { customer_id: customerA.id }); await harness.flushEffects();
  change(harness, { service_address: '用户指定现场' });
  change(harness, { customer_id: customerB.id }); const tree = await harness.flushEffects();
  assert.equal(form(harness).values.service_address, '用户指定现场');
  assert.ok(nodes(tree, n => n.type === 'ForgeNotice').some(n => serviceText(n).includes('核对手动填写的服务地址')));
});

test('late source read cannot overwrite manual editing, including an intentional blank', { timeout: 5000 }, async () => {
  for (const manual of ['读取中手动填写', '']) {
    let finish, started;
    const readStarted = new Promise(resolve => { started = resolve; });
    const harness = fixture({ transport: transport(() => {
      started(); return new Promise(resolve => { finish = resolve; });
    }) });
    await harness.flushEffects();
    change(harness, { customer_id: customerA.id }); const loading = harness.flushEffects();
    await readStarted;
    const loadingTree = harness.render();
    assert.equal(nodes(loadingTree, n => n.type === 'button' && serviceText(n) === '创建服务工单')[0].props.disabled, true);
    change(harness, { service_address: manual || '临时输入' });
    if (!manual) change(harness, { service_address: '' });
    finish(response(customerA)); await loading;
    assert.equal(form(harness).values.service_address, manual);
  }
});

test('older customer success or denial cannot replace the current customer result', { timeout: 5000 }, async () => {
  for (const oldStatus of [200, 403]) {
    let finishOld, started;
    const oldStarted = new Promise(resolve => { started = resolve; });
    const harness = fixture({ transport: transport(id => {
      if (id === customerA.id) { started(); return new Promise(resolve => { finishOld = resolve; }); }
      return response(customerB);
    }) });
    await harness.flushEffects();
    change(harness, { customer_id: customerA.id }); const oldRead = harness.flushEffects();
    await oldStarted;
    change(harness, { customer_id: customerB.id }); const newRead = harness.flushEffects();
    await new Promise(resolve => setImmediate(resolve));
    finishOld(response(oldStatus === 200 ? customerA : { error: { message: 'denied' } }, oldStatus));
    await Promise.all([oldRead, newRead]); const tree = harness.render();
    assert.equal(form(harness).values.service_address, customerB.address);
    assert.equal(nodes(tree, n => n.type === 'ForgeNotice').some(n => serviceText(n).includes('无权读取')), false);
  }
});

test('source denial exposes no derived address and allows explicit manual entry', { timeout: 5000 }, async () => {
  const harness = fixture({ transport: transport(() => response({ error: { message: 'denied' } }, 403)) });
  await harness.flushEffects(); change(harness, { customer_id: customerA.id });
  const tree = await harness.flushEffects();
  assert.ok(nodes(tree, n => n.type === 'ForgeNotice').some(n => serviceText(n).includes('无权读取')));
  assert.equal(form(harness).values.service_address || '', '');
  change(harness, { service_address: '明确手填现场' });
  assert.equal(form(harness).values.service_address, '明确手填现场');
});

test('masked and empty source addresses stay distinct from a confirmed address', { timeout: 5000 }, async () => {
  for (const customer of [{ id: customerA.id }, { id: customerA.id, address: null }]) {
    const harness = fixture({ transport: transport(() => response(customer)) });
    await harness.flushEffects(); change(harness, { customer_id: customerA.id });
    const tree = await harness.flushEffects();
    assert.equal(form(harness).values.service_address, '');
    const text = nodes(tree, n => n.type === 'ForgeNotice').map(serviceText).join(' ');
    assert.ok(text.includes('手动填写'));
    assert.ok(text.includes('address' in customer ? '未填写服务地址' : '暂不可读取'));
  }
});
