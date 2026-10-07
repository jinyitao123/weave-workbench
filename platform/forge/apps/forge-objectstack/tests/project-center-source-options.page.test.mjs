import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectCenterPage } from '../src/pages/project-center.page.ts';
import { createServicePageHarness, serviceText } from './service-page-react-harness.mjs';

const actor = 'sales-actor', response = (value, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => value });
function nodes(value, predicate, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value); return [...(predicate(value) ? [value] : []), ...Object.values(value).flatMap(item => Array.isArray(item)
    ? item.flatMap(child => nodes(child, predicate, seen)) : nodes(item, predicate, seen))];
}
const field = (h, label) => nodes(h.render(), node => node.props?.label === label)[0];
const button = (h, label) => nodes(h.render(), node => node.type === 'button' && serviceText(node).trim() === label)[0];
const dialog = h => nodes(h.render(), node => node.type === 'ForgeDialog' && node.props.open)[0];
const param = (name, options) => ({ name, enum: options.map(row => row[0]), enumLabels: options.map(([value, label]) => ({ value, label })) });
async function fixture({ search = '', contextReply, orderReply } = {}) {
  const records = {
    forge_project: [{ id: 'project-a', name: '原项目', code: 'PRJ-A', customer_id: 'customer-a', source_order_id: 'order-a', organization_id: 'org-a', owner_id: actor, manager_id: 'manager-a', status: 'pending' }],
    forge_customer: [{ id: 'customer-a', name: '客户甲', owner_id: actor }, { id: 'customer-b', name: '客户乙', owner_id: actor }],
    forge_project_type: [{ id: 'type-a', name: '可用类型', active: true }, { id: 'type-disabled', name: '停用类型', active: false }],
    sys_user: [{ id: 'manager-a', name: '合资格经理' }, { id: 'not-manager', name: '普通账号' }],
    forge_sales_contract: [{ id: 'contract-a', name: '合同甲', code: 'HT-A', customer_id: 'customer-a', status: 'active', signed_on: '2026-10-01', signed_evidence_attachment: 'original-a' }, { id: 'contract-b', name: '合同乙', code: 'HT-B', customer_id: 'customer-a', status: 'active', signed_on: '2026-10-01', signed_evidence_attachment: 'original-b' }],
    forge_sales_order: [{ id: 'order-a', name: '已批准订单甲', code: 'SO-A', customer_id: 'customer-a', contract_id: 'contract-a', status: 'active', approval_outcome: 'approved' }, { id: 'order-b', name: '已批准订单乙', code: 'SO-B', customer_id: 'customer-a', contract_id: 'contract-b', status: 'active', approval_outcome: 'approved' }, { id: 'order-c', name: '客户乙订单', code: 'SO-C', customer_id: 'customer-b', contract_id: 'contract-c', status: 'active', approval_outcome: 'approved' }],
  };
  const actions = [];
  const h = createServicePageHarness(ProjectCenterPage, { records, globals: { __name: value => value, Switch: function Switch() {},
    window: { location: { search, href: 'http://service-page.test/' + search }, history: { pushState() {} }, addEventListener() {}, removeEventListener() {} } },
    transport: async (url, options = {}) => {
      const u = new URL(url), route = u.pathname.replace('/api/v1', '');
      if (route === '/auth/get-session') return response({ user: { id: actor } });
      if (route === '/auth/me/permissions') return response({ systemPermissions: ['forge_project_operator', 'sales_contract_operator'], objects: {} });
      if (route === '/workbench/business-actions/context') {
        const object = u.searchParams.get('objectName'), id = u.searchParams.get('recordId');
        if (contextReply) { const custom = await contextReply({ object, id }); if (custom) return custom; }
        const orders = id === 'customer-b' ? [['order-c', '客户乙订单']] : object === 'forge_project' ? [['order-a', '已批准订单甲']] : [['order-a', '已批准订单甲'], ['order-b', '已批准订单乙']];
        return response({ version: '1', actions: [{ capabilityId: 'forge:action:' + object + '.' + (object === 'forge_customer' ? 'customer_create_project' : 'project_link_contract'), parameters: [
          param('approved_order_id', orders), param('manager_id', [['manager-a', '合资格经理']]), param('type_id', [['type-a', '可用类型']]), param('contract_id', [['contract-a', '合同甲']]),
        ] }] });
      }
      if (route === '/actions/forge_project/project_read_delivery_scope') return response({ result: { sources: [], lines: [], warnings: [] } });
      if (route.startsWith('/actions/')) { actions.push({ path: route, body: JSON.parse(options.body) }); return response({ result: {} }); }
      const object = route.split('/').at(-1), filter = JSON.parse(u.searchParams.get('$filter') || '{}');
      if (object === 'forge_sales_order' && orderReply) { const custom = await orderReply({ filter }); if (custom) return custom; }
      let rows = records[object] || [];
      rows = rows.filter(row => Object.entries(filter).every(([key, value]) => value && typeof value === 'object' ? !value.$in || value.$in.includes(row[key]) : row[key] === value));
      return response({ records: rows, total: rows.length });
    } });
  await h.flushEffects(); return { h, actions, records };
}

test('project creation selects the exact approved order and only native qualified manager/type options', async () => {
  const { h, actions } = await fixture(); button(h, '新建项目').props.onClick();
  await field(h, '关联客户').props.onChange('customer-a'); await h.settle();
  assert.ok(field(h, '已批准销售订单'), 'current domain requires an explicit original order');
  assert.deepEqual(Array.from(field(h, '项目负责人').props.options, row => Array.from(row)), [['manager-a', '合资格经理']]);
  assert.deepEqual(Array.from(field(h, '项目类型').props.options, row => Array.from(row)), [['type-a', '可用类型']]);
  for (const [label, value] of [['项目名称', '新项目'], ['项目类型', 'type-a'], ['项目负责人', 'manager-a'], ['已批准销售订单', 'order-b'], ['计划开始日期', '2026-10-07'], ['计划结束日期', '2026-10-20']]) field(h, label).props.onChange(value);
  await dialog(h).props.onConfirm(); assert.equal(dialog(h).props.secondaryLabel, '返回修改');
  assert.ok(nodes(h.render(), node => node.props?.label === '已批准销售订单' && node.props.value === '已批准订单乙').length);
  await dialog(h).props.onConfirm(); assert.equal(actions.length, 1);
  assert.equal(actions[0].path, '/actions/forge_customer/customer_create_project');
  assert.equal(actions[0].body.recordId, 'customer-a'); assert.equal(actions[0].body.params.approved_order_id, 'order-b');
});

test('linking uses native contract choices before any link exists and submits the pinned exact order', async () => {
  const { h, actions } = await fixture({ search: '?project=project-a&tab=contracts' });
  await button(h, '添加关联合同').props.onClick(); await h.settle();
  assert.deepEqual(Array.from(field(h, '销售合同').props.options, row => Array.from(row)), [['contract-a', '合同甲']]);
  assert.equal(field(h, '已批准销售订单').props.options.length, 0);
  field(h, '销售合同').props.onChange('contract-a');
  assert.deepEqual(Array.from(field(h, '已批准销售订单').props.options, row => Array.from(row)), [['order-a', '已批准订单甲']]);
  field(h, '已批准销售订单').props.onChange('order-b'); await dialog(h).props.onConfirm();
  assert.equal(actions.length, 0); assert.match(dialog(h).props.error, /已批准销售订单/);
  field(h, '已批准销售订单').props.onChange('order-a');
  await dialog(h).props.onConfirm(); await dialog(h).props.onConfirm();
  assert.equal(actions.length, 1); assert.equal(actions[0].path, '/actions/forge_project/project_link_contract');
  assert.deepEqual(actions[0].body.params, { contract_id: 'contract-a', approved_order_id: 'order-a' });
});

test('authorization, missing context and incomplete order pages stay explicit and never submit', async () => {
  const cases = [
    { status: 401, contextReply: () => response({ error: 'expired' }, 401) },
    { status: 403, contextReply: () => response({ error: 'denied' }, 403) },
    { status: 503, contextReply: () => response({ error: 'source unavailable' }, 503) },
    { contextReply: () => response({}) },
    { contextReply: () => response({ version: '1', actions: [] }) },
    { orderReply: () => response({ error: 'source read denied' }, 403) },
    { orderReply: () => response({ records: [], total: 2 }) },
    { orderReply: () => response({ records: [{ id: 'order-a', customer_id: 'customer-a', contract_id: 'contract-a', status: 'active', approval_outcome: 'approved' }], total: 2 }) },
  ];
  for (const sample of cases) {
    const { h, actions } = await fixture(sample); button(h, '新建项目').props.onClick();
    await field(h, '关联客户').props.onChange('customer-a'); await h.settle();
    if (sample.status === 401) {
      assert.equal(dialog(h), undefined); assert.ok(serviceText(h.render()).includes('登录已失效'));
    } else {
      const current = h.states.find(value => value?.kind === 'create');
      assert.equal(current.sourceLookup.ready, false); assert.ok(current.sourceLookup.error);
      assert.ok(button(h, '重新读取选项')); await dialog(h).props.onConfirm();
    }
    assert.equal(actions.length, 0);
  }
});

test('source retry only rereads options and preserves the typed project draft', async () => {
  let fail = true;
  const { h, actions } = await fixture({ contextReply: () => fail ? response({ error: 'temporary source failure' }, 503) : undefined });
  button(h, '新建项目').props.onClick(); field(h, '项目名称').props.onChange('保留中文草稿');
  field(h, '计划开始日期').props.onChange('2026-10-07');
  await field(h, '关联客户').props.onChange('customer-a'); await h.settle();
  fail = false; await button(h, '重新读取选项').props.onClick(); await h.settle();
  assert.equal(field(h, '项目名称').props.value, '保留中文草稿');
  assert.equal(field(h, '计划开始日期').props.value, '2026-10-07');
  assert.equal(field(h, '已批准销售订单').props.value, '', 'no first-order auto-selection');
  assert.equal(field(h, '项目负责人').props.value, '', 'no first-manager auto-selection');
  assert.equal(field(h, '已批准销售订单').props.options.length, 2); assert.equal(actions.length, 0);
});

test('a late customer result and a closed dialog cannot restore stale legal choices', async () => {
  let release;
  const { h, actions } = await fixture({ contextReply: ({ id }) => id === 'customer-a' ? new Promise(resolve => { release = () => resolve(null); }) : undefined });
  button(h, '新建项目').props.onClick();
  const old = field(h, '关联客户').props.onChange('customer-a');
  await field(h, '关联客户').props.onChange('customer-b');
  release(); await old; await h.settle();
  assert.equal(field(h, '关联客户').props.value, 'customer-b');
  assert.deepEqual(Array.from(field(h, '已批准销售订单').props.options, row => Array.from(row)), [['order-c', '客户乙订单']]);
  const closing = field(h, '关联客户').props.onChange('customer-a');
  dialog(h).props.onCancel(); button(h, '新建项目').props.onClick();
  release(); await closing; await h.settle();
  assert.equal(field(h, '关联客户').props.value, ''); assert.equal(field(h, '已批准销售订单').props.options.length, 0);
  assert.equal(actions.length, 0);
});

test('changing customer clears the chosen order and a forged manager cannot pass confirmation', async () => {
  const { h, actions } = await fixture(); button(h, '新建项目').props.onClick();
  await field(h, '关联客户').props.onChange('customer-a'); await h.settle();
  for (const [label, value] of [['项目名称', '受控项目'], ['项目类型', 'type-a'], ['项目负责人', 'not-manager'], ['已批准销售订单', 'order-a'], ['计划开始日期', '2026-10-07'], ['计划结束日期', '2026-10-20']]) field(h, label).props.onChange(value);
  await dialog(h).props.onConfirm(); assert.match(dialog(h).props.error, /合资格负责人/); assert.equal(actions.length, 0);
  await field(h, '关联客户').props.onChange('customer-b'); await h.settle();
  assert.equal(field(h, '已批准销售订单').props.value, ''); assert.equal(field(h, '项目负责人').props.value, '');
});
