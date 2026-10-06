import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { projectCostPanelRuntime } from '../src/pages/project-cost-panel.ts';

const require = createRequire(import.meta.url);
const { transformSync } = createRequire(require.resolve('@objectstack/cli'))('esbuild');

function harness(overrides = {}) {
  const slots = [];
  let cursor = 0;
  const React = {
    Fragment: Symbol('fragment'),
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity).filter(value => value !== null && value !== undefined && value !== false) };
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
  };
  const context = {
    React,
    ProjectRelatedRecordTable: function ProjectRelatedRecordTable() {},
    ForgeSelectControl: function ForgeSelectControl() {},
    module: { exports: null },
  };
  vm.runInNewContext(transformSync(projectCostPanelRuntime + '\nmodule.exports=ProjectCostPanel;', { loader: 'jsx' }).code, context);
  const props = {
    costs: [
      { id: 'cost-labor', code: 'C-1', name: '现场人工', cost_type: 'labor', source_type: 'timesheet', status: 'allocated', allocated_amount: 360, occurred_on: '2026-10-03' },
      { id: 'cost-travel', code: 'C-2', name: '现场差旅', cost_type: 'travel', source_type: 'expense', status: 'allocated', allocated_amount: 50, occurred_on: '2026-10-03' },
      { id: 'cost-pending', code: 'C-3', name: '待归集材料', cost_type: 'material', source_type: 'production_material', status: 'unallocated', allocated_amount: 900 },
      { id: 'cost-reversed', code: 'C-4', name: '已冲销人工', cost_type: 'labor', source_type: 'manual', status: 'reversed', allocated_amount: 800 },
    ],
    purchaseOrders: [
      { id: 'po-active', code: 'PO-1', supplier_id: 'supplier-1', status: 'approved', total_amount: 2000 },
      { id: 'po-cancelled', code: 'PO-2', supplier_id: 'supplier-1', status: 'cancelled', total_amount: 9000 },
    ],
    suppliers: [{ id: 'supplier-1', name: 'Rivet供应商' }],
    paymentSummary: { paidByOrder: new Map([['po-active', 300]]), unpaidByOrder: new Map([['po-active', 1700]]) },
    purchaseStatusLabels: { approved: '已审核', cancelled: '已取消' },
    money: value => Number(value || 0).toFixed(2),
    onManageCosts() {},
    ...overrides,
  };
  return { render() { cursor = 0; return context.module.exports(props); } };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (predicate(tree)) return tree;
  for (const child of tree.children || []) {
    const result = find(child, predicate);
    if (result) return result;
  }
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return (tree?.children || []).map(text).join('');
}
const table = tree => find(tree, node => node.type?.name === 'ProjectRelatedRecordTable');
const button = (tree, name) => find(tree, node => node.type === 'button' && text(node) === name);

test('cost search uses readable metadata labels and combines exact source/status filters', () => {
  const page = harness();
  let tree = page.render();
  assert.equal(table(tree).props.rows.length, 4);
  find(tree, node => node.type === 'input').props.onChange({ target: { value: '费用报销' } });
  tree = page.render();
  assert.equal(table(tree).props.rows.length, 1);
  assert.match(text(table(tree).props.rows[0]), /现场差旅.*差旅费用.*费用报销.*已归集/);
  button(tree, '筛选').props.onClick();
  tree = page.render();
  find(tree, node => node.props['aria-label'] === '筛选归集状态').props.onChange({ target: { value: 'unallocated' } });
  tree = page.render();
  assert.equal(table(tree).props.rows.length, 0);
  assert.match(text(table(tree).props.empty), /当前条件下暂无匹配记录/);
  button(tree, '清空筛选').props.onClick();
  assert.equal(table(page.render()).props.rows.length, 4);
});

test('cost overview excludes pending and reversed entries from allocated totals', () => {
  const page = harness();
  let tree = page.render();
  button(tree, '成本概览').props.onClick();
  tree = page.render();
  const rows = table(tree).props.rows;
  assert.equal(rows.length, 2);
  assert.match(text(rows[0]), /人工成本.*360\.00/);
  assert.match(text(rows[1]), /差旅费用.*50\.00/);
  assert.doesNotMatch(rows.map(text).join(' '), /900\.00|800\.00/);
});

test('commitments and payments show different authorized datasets and reset incompatible filters', () => {
  const page = harness();
  let tree = page.render();
  find(tree, node => node.type === 'input').props.onChange({ target: { value: '现场人工' } });
  tree = page.render();
  button(tree, '承诺成本').props.onClick();
  tree = page.render();
  assert.equal(find(tree, node => node.type === 'input').props.value, '');
  assert.equal(table(tree).props.rows.length, 1);
  assert.match(text(table(tree).props.rows[0]), /PO-1.*Rivet供应商.*已审核.*2000\.00/);
  button(tree, '付款情况').props.onClick();
  tree = page.render();
  assert.match(table(tree).props.headers.join(' '), /已确认采购付款.*待付款/);
  assert.match(text(table(tree).props.rows[0]), /300\.00.*1700\.00/);
  find(tree, node => node.type === 'input').props.onChange({ target: { value: 'rIvEt' } });
  assert.equal(table(page.render()).props.rows.length, 2);
});

test('read failures are kept distinct from empty costs and zero confirmed payments', () => {
  const costs = harness({ costs: [], costUnavailable: true }).render();
  assert.equal(table(costs), undefined);
  assert.match(text(costs), /当前账号无法读取此项数据/);
  assert.doesNotMatch(text(costs), /暂无成本明细/);

  const payments = harness({ paidUnavailable: true, unpaidUnavailable: true });
  button(payments.render(), '付款情况').props.onClick();
  const row = table(payments.render()).props.rows[0];
  assert.match(text(row), /不可用不可用/);
  assert.doesNotMatch(text(row), /300\.00|1700\.00/);
});

test('cost management keeps the host navigation callback', () => {
  let invoked = 0;
  const page = harness({ onManageCosts: () => { invoked++; } });
  button(page.render(), '进入成本管理').props.onClick();
  assert.equal(invoked, 1);
});

test('supplier read failure remains visible without hiding readable orders or pretending it is missing data', () => {
  const page = harness({ suppliers: [], supplierUnavailable: true });
  button(page.render(), '承诺成本').props.onClick();
  let tree = page.render();
  assert.match(text(tree), /供应商资料读取失败，按供应商搜索暂不可用/);
  assert.match(text(table(tree).props.rows[0]), /PO-1不可用/);
  find(tree, node => node.type === 'input').props.onChange({ target: { value: 'PO-1' } });
  assert.equal(table(page.render()).props.rows.length, 1);
  tree = page.render();
  find(tree, node => node.type === 'input').props.onChange({ target: { value: '不可用' } });
  assert.equal(table(page.render()).props.rows.length, 0, 'error labels must not become searchable supplier values');
});

test('arrow and endpoint keys switch cost views and move focus with the selected tab', () => {
  const page = harness();
  let focused = -1;
  let prevented = 0;
  const event = key => ({ key, preventDefault() { prevented++; }, currentTarget: { parentElement: { querySelectorAll: () => Array.from({ length: 4 }, (_, index) => ({ focus() { focused = index; } })) } } });
  button(page.render(), '成本明细').props.onKeyDown(event('ArrowRight'));
  let tree = page.render();
  assert.equal(button(tree, '承诺成本').props['aria-selected'], true);
  assert.equal(button(tree, '承诺成本').props.tabIndex, 0);
  assert.equal(focused, 2);
  button(tree, '承诺成本').props.onKeyDown(event('End'));
  tree = page.render();
  assert.equal(button(tree, '付款情况').props['aria-selected'], true);
  button(tree, '付款情况').props.onKeyDown(event('Home'));
  tree = page.render();
  assert.equal(button(tree, '成本概览').props['aria-selected'], true);
  button(tree, '成本概览').props.onKeyDown(event('ArrowLeft'));
  assert.equal(button(page.render(), '付款情况').props['aria-selected'], true);
  assert.equal(prevented, 4);
});
