import assert from 'node:assert/strict';
import test from 'node:test';
import { SalesOrderCreatePage } from '../src/pages/sales-order-create.page.ts';
import { createServicePageHarness, serviceText } from './service-page-react-harness.mjs';

const contract = { id: 'contract-a', name: '已签署设备合同', code: 'SC-READ-A', customer_id: 'customer-a', status: 'active', signed_on: '2026-10-01', signed_evidence_attachment: ['synthetic-evidence'], delivery_address: '客户交付现场' };
function nodes(value, predicate, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  return [...(predicate(value) ? [value] : []), ...Object.values(value).flatMap(item => Array.isArray(item) ? item.flatMap(child => nodes(child, predicate, seen)) : nodes(item, predicate, seen))];
}
function fixture(extra = {}) {
  const location = { href: '' };
  const harness = createServicePageHarness(SalesOrderCreatePage, {
    permissions: ['sales_order_operator'],
    records: { forge_sales_contract: [contract], forge_customer: [{ id: 'customer-a', name: '设备客户' }], forge_sales_contract_line: [{ id: 'line-a', contract_id: contract.id, name: '设备', line_type: 'service', quantity_limit: 1, ordered_quantity: 0, taxed_unit_price: 1, taxed_subtotal: 1, tax_rate: 0, discount_rate: 0 }] },
    globals: { window: { location } }, ...extra,
  });
  return { harness, location };
}
function button(tree, label) { return nodes(tree, node => node.type === 'button' && serviceText(node).trim() === label)[0]; }
function input(tree, label) { return nodes(tree, node => node.props?.['aria-label'] === label)[0]; }
function discard(tree) { return nodes(tree, node => typeof node.type === 'string' && node.props?.title === '放弃更改？' && node.props.open === true)[0]; }
function choose(harness, value = contract.id) { input(harness.render(), '选择有效销售合同').props.onChange({ target: { value } }); return harness.render(); }

test('an untouched contract order returns to its registered list without writing', async () => {
  const { harness, location } = fixture();
  const tree = await harness.flushEffects();
  button(tree, '返回订单列表').props.onClick();
  assert.equal(location.href, '/_console/apps/com.inoforge.forge.sales/page_sales_order_workspace');
  assert.equal(discard(harness.render()), undefined);
  assert.equal(harness.calls.some(call => call.path.includes('/contract_convert_to_sales_order')), false);
});

test('both return and cancel preserve a changed contract order until explicit discard', async () => {
  const { harness, location } = fixture(); await harness.flushEffects();
  let tree = choose(harness);
  input(tree, '订单名称').props.onChange({ target: { value: '中文订单内容保留' } });
  tree = harness.render();
  button(tree, '返回订单列表').props.onClick();
  assert.equal(location.href, '', 'navigation cannot silently discard the employee form');
  let guard = discard(harness.render()); assert.ok(guard);
  guard.props.onSecondary();
  assert.equal(input(harness.render(), '订单名称').props.value, '中文订单内容保留');
  button(harness.render(), '取消').props.onClick();
  guard = discard(harness.render()); assert.ok(guard);
  guard.props.onCancel();
  assert.equal(location.href, '');
  assert.equal(input(harness.render(), '订单名称').props.value, '中文订单内容保留');
  button(harness.render(), '取消').props.onClick();
  discard(harness.render()).props.onConfirm();
  assert.equal(location.href, '/_console/apps/com.inoforge.forge.sales/page_sales_order_workspace');
  assert.equal(harness.calls.some(call => call.path.includes('/contract_convert_to_sales_order')), false);
});

test('clearing the selected contract restores an empty form without a false dirty prompt', async () => {
  const { harness, location } = fixture(); await harness.flushEffects();
  choose(harness);
  const tree = choose(harness, '');
  button(tree, '返回订单列表').props.onClick();
  assert.equal(location.href, '/_console/apps/com.inoforge.forge.sales/page_sales_order_workspace');
  assert.equal(discard(harness.render()), undefined);
  assert.equal(harness.calls.some(call => call.path.includes('/contract_convert_to_sales_order')), false);
});

test('saving keeps both exit controls disabled and rejects cancellation until the request settles', { timeout: 5000 }, async () => {
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const { harness, location } = fixture({ onAction: () => { started(); return new Promise(resolve => { release = resolve; }); } });
  await harness.flushEffects(); choose(harness); await harness.flushEffects();
  for (const [label, value] of [['计划交货日期', '2026-10-20'], ['付款条件', '已确认付款条件'], ['付款方式', 'bank_transfer']]) {
    input(harness.render(), label).props.onChange({ target: { value } });
  }
  const saving = button(harness.render(), '创建订单草稿').props.onClick();
  await waiting;
  const tree = harness.render();
  assert.equal(nodes(tree, node => node.type === 'fieldset')[0].props.disabled, true);
  input(tree, '订单名称').props.onChange({ target: { value: '保存中不应改掉的内容' } });
  assert.notEqual(input(harness.render(), '订单名称').props.value, '保存中不应改掉的内容');
  assert.equal(input(tree, '付款方式').props.disabled, true);
  assert.equal(input(tree, '计划交货日期').props.disabled, true);
  for (const label of ['返回订单列表', '取消']) {
    const exit = button(tree, label); assert.equal(exit.props.disabled, true);
    exit.props.onClick();
  }
  assert.equal(location.href, ''); assert.equal(discard(harness.render()), undefined);
  release({}); await saving;
  assert.equal(location.href, '');
  assert.equal(button(harness.render(), '返回订单列表').props.disabled, false);
  assert.equal(input(harness.render(), '计划交货日期').props.value, '2026-10-20');
});
