import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import test from 'node:test';

// Execute the built React page with a small hook harness. This verifies page
// handlers and rendered records; it is supplementary to real browser review.
const artifact = JSON.parse(readFileSync('dist/objectstack.json', 'utf8'));
const page = artifact.pages.find(x => x.name === 'page_revenue_recognition');
assert.ok(page);
const code = execFileSync('node_modules/.bin/esbuild', ['--loader=jsx', '--format=cjs'], {
  input: page.source.split('export default App;')[0] + 'export default App;', encoding: 'utf8',
});

function harness(count = 21) {
  const states = [], effects = [], requests = [];
  let cursor = 0;
  const React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect(fn, deps) { effects.push({ fn, deps }); },
  };
  const records = Array.from({ length: count }, (_, i) => ({ id: 'r' + i, code: 'REV-' + i, status: 'pending_review', customer_id: 'c', recognition_on: '2026-09-20', confirmation_method: 'shipment', net_amount: i + 1 }));
  const data = { loading: false, orders: [], outbounds: [], invoices: [], recognitions: records, customers: [{ id: 'c', name: '对照客户' }], projects: [], links: [], error: '' };
  const adapter = { find: async object => ({ records: object === 'forge_revenue_recognition' ? records : [] }), fetchImpl: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({}) }; } };
  const components = Object.fromEntries(['ForgePageHeader', 'ForgeListSettings', 'ForgeDateInput', 'ForgeSelectControl', 'ForgeEmpty', 'ForgeDialog', 'ForgeNotice'].map(x => [x, x]));
  const context = { module: { exports: {} }, exports: {}, React, useAdapter: () => adapter, ...components };
  context.exports = context.module.exports;
  vm.runInNewContext(code, context);
  const render = () => { cursor = 0; effects.length = 0; return context.module.exports.default(); };
  render();
  states[0] = data;
  return { states, requests, effects, render, records };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flatMap(x => nodes(x, predicate))];
}
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : (tree?.children || []).map(text).join('');
const button = (tree, name) => nodes(tree, x => x.type === 'button' && text(x) === name)[0];
const rowChecks = tree => nodes(tree, x => x.type === 'input' && String(x.props['aria-label']).startsWith('选择确认单 '));

test('10-row pagination changes the visible records and clamps the last page', () => {
  const h = harness();
  let tree = h.render();
  assert.equal(rowChecks(tree).length, 10);
  assert.equal(button(tree, '上一页').props.disabled, true);
  button(tree, '下一页').props.onClick();
  tree = h.render();
  assert.equal(rowChecks(tree)[0].props['aria-label'], '选择确认单 REV-10');
  button(tree, '下一页').props.onClick();
  tree = h.render();
  assert.equal(rowChecks(tree).length, 1);
  assert.equal(button(tree, '下一页').props.disabled, true);
  h.states[3] = 'REV-0';
  tree = h.render();
  assert.equal(rowChecks(tree).length, 1);
  assert.ok(text(tree).includes('第 1 / 1 页'));
});

test('empty review comment blocks submission and renders an in-dialog error', async () => {
  const h = harness(1);
  button(h.render(), '审核').props.onClick();
  let dialog = nodes(h.render(), x => x.type === 'ForgeDialog')[0];
  await dialog.props.onConfirm();
  dialog = nodes(h.render(), x => x.type === 'ForgeDialog')[0];
  assert.equal(h.requests.length, 0);
  assert.equal(dialog.props.open, true);
  assert.ok(text(dialog).includes('请填写审核意见后再提交。'));
  assert.equal(nodes(dialog, x => x.props.role === 'alert').length, 1);
});

test('batch review excludes records outside the current filter', async () => {
  const h = harness(3);
  h.states[11] = ['r0', 'r1'];
  h.states[3] = 'REV-0';
  button(h.render(), '批量审核').props.onClick();
  h.states[2] = { ...h.states[2], review_comment: '已核对' };
  const dialog = nodes(h.render(), x => x.type === 'ForgeDialog')[0];
  assert.equal(dialog.props.subtitle, '已选择 1 条');
  await dialog.props.onConfirm();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].body.recordId, 'r0');
});

test('changing the filter resets page and stale selections', () => {
  const h = harness();
  h.states[13] = 3;
  h.states[11] = ['r0'];
  h.render();
  const reset = h.effects.find(x => x.deps.length > 0);
  assert.ok(reset);
  reset.fn();
  assert.equal(h.states[13], 1);
  assert.equal(h.states[11].length, 0);
});
