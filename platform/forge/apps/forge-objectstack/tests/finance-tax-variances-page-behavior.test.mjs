import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import test from 'node:test';

const pages = JSON.parse(readFileSync('dist/objectstack.json', 'utf8')).pages;
const page = pages.find(x => x.name === 'page_invoice_tax_variances');
const adjustments = pages.find(x => x.name === 'page_invoice_adjustments');
const compile = source => execFileSync('node_modules/.bin/esbuild', ['--loader=jsx', '--format=cjs'], {
  input: source.split('export default App;')[0] + 'export default App;', encoding: 'utf8',
});
const code = compile(page.source);

function harness(search = '', populated = false) {
  const states = [];
  let cursor = 0;
  const React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = value; }]; },
    useEffect() {},
  };
  const context = { module: { exports: {} }, exports: {}, React, useAdapter: () => ({}), URLSearchParams, location: { search },
    ...Object.fromEntries(['ForgePageHeader', 'ForgeListSettings', 'ForgeDateInput', 'ForgeSelect', 'ForgeMetric', 'ForgeEmpty', 'ForgeNotice'].map(x => [x, x])) };
  context.exports = context.module.exports;
  vm.runInNewContext(code, context);
  const render = () => { cursor = 0; return context.module.exports.default(); };
  render();
  states[0].loading = false;
  if (populated) Object.assign(states[0], {
    sales: [{ id: 'si', code: 'SI-001', customer_id: 'c', invoice_on: '2026-09-20' }],
    purchases: [{ id: 'pi', invoice_number: 'PI-001', supplier_id: 's', invoice_on: '2026-09-10' }],
    salesLines: [{ id: 'sl', invoice_id: 'si', order_line_id: 'so', tax_rate: 6, taxed_subtotal: 113 }, { id: 'same', invoice_id: 'si', order_line_id: 'so', tax_rate: 13, taxed_subtotal: 113 }],
    purchaseLines: [{ id: 'pl', invoice_id: 'pi', order_line_id: 'po', tax_rate: 9, taxed_subtotal: 109 }],
    salesOrderLines: [{ id: 'so', code: 'SO-LINE', tax_rate: 13 }],
    purchaseOrderLines: [{ id: 'po', code: 'PO-LINE', tax_rate: 6 }],
    customers: [{ id: 'c', name: '对照客户' }], suppliers: [{ id: 's', name: '对照供应商' }],
  });
  return { states, render };
}
function nodes(tree, predicate) { if (!tree || typeof tree !== 'object') return []; return [...(predicate(tree) ? [tree] : []), ...(tree.children || []).flatMap(x => nodes(x, predicate))]; }
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : (tree?.children || []).map(text).join('');
const rowCount = tree => nodes(tree, x => x.type === 'tbody').flatMap(x => nodes(x, y => y.type === 'tr')).length;

test('standard pageName route and legacy nav values render the tax-variance page', () => {
  for (const search of ['', '?nav=invoice_adjustments', '?nav=invoice_tax_variances']) {
    const tree = harness(search).render();
    assert.deepEqual(nodes(tree, x => x.type === 'h1').map(text), ['税率差异留痕']);
    assert.equal(nodes(tree, x => x.type === 'ForgeEmpty')[0].props.title, '暂无税率差异留痕');
    assert.equal(nodes(tree, x => x.type === 'ForgeSelect')[0].props.label, '方向');
    assert.equal(nodes(tree, x => x.type === 'th').length, 0);
  }
});

test('existing variance columns and calculations remain intact', () => {
  const tree = harness('', true).render();
  assert.deepEqual(nodes(tree, x => x.type === 'th').map(text), ['方向', '来源单号', '发票号码', '往来单位', '约定税率', '实际税率', '预计税额', '实际税额', '税额差异', '差异原因', '差异时间']);
  assert.equal(rowCount(tree), 2, 'equal tax rates must not produce a variance');
  const cells = nodes(nodes(tree, x => x.type === 'tbody')[0], x => x.type === 'td').map(text);
  assert.ok(cells.includes('¥13.00'));
  assert.ok(cells.includes('¥6.40'));
  assert.ok(cells.includes('¥-6.60'));
});

test('direction, source, invoice and date filters change the visible rows', () => {
  const h = harness('', true);
  nodes(h.render(), x => x.type === 'ForgeSelect')[0].props.onChange('purchase');
  assert.equal(rowCount(h.render()), 1);
  assert.ok(text(h.render()).includes('PI-001'));
  h.states[1] = 'all';
  const source = nodes(h.render(), x => x.props.placeholder === '来源单号')[0];
  source.props.onChange({ target: { value: 'SO-LINE' } });
  assert.equal(rowCount(h.render()), 1);
  h.states[3] = '';
  nodes(h.render(), x => x.props.placeholder === '发票号码')[0].props.onChange({ target: { value: 'PI-001' } });
  assert.equal(rowCount(h.render()), 1);
  h.states[4] = '';
  nodes(h.render(), x => x.props['aria-label'] === '开始日期')[0].props.onChange({ target: { value: '2026-09-11' } });
  assert.equal(rowCount(h.render()), 1);
  nodes(h.render(), x => x.props['aria-label'] === '结束日期')[0].props.onChange({ target: { value: '2026-09-19' } });
  assert.equal(rowCount(h.render()), 0);
});

test('the adjustments page source is untouched by the dedicated-page fix', () => {
  const originalFile = execFileSync('git', ['show', '47f3575f22b6dded418452acebfdbd26b9663efc:apps/forge-objectstack/src/pages/invoice-audit.page.ts'], { encoding: 'utf8' });
  const originalTemplate = originalFile.slice(originalFile.indexOf('const invoiceAuditSource ='), originalFile.indexOf('export const InvoiceAdjustmentsPage'));
  const currentFile = readFileSync('src/pages/invoice-audit.page.ts', 'utf8');
  const currentTemplate = currentFile.slice(currentFile.indexOf('const invoiceAuditSource ='), currentFile.indexOf('export const InvoiceAdjustmentsPage'));
  assert.equal(currentTemplate, originalTemplate);
  assert.ok(adjustments.source.includes("varianceMode=nav==='invoice_tax_variances'"));
});

test('active filters show a no-match message and can all be cleared', () => {
  const h = harness();
  h.states[1] = 'sales'; h.states[3] = 'source'; h.states[4] = 'invoice'; h.states[5] = '2026-09-01'; h.states[6] = '2026-09-30';
  let tree = h.render();
  assert.equal(nodes(tree, x => x.type === 'ForgeEmpty')[0].props.title, '未找到匹配的差异留痕');
  nodes(tree, x => x.type === 'button' && text(x) === '清空')[0].props.onClick();
  tree = h.render();
  assert.equal(h.states[1], 'all');
  assert.deepEqual(h.states.slice(3, 7), ['', '', '', '']);
  assert.equal(nodes(tree, x => x.type === 'ForgeEmpty')[0].props.title, '暂无税率差异留痕');
  assert.equal(nodes(tree, x => x.type === 'button' && text(x) === '清空').length, 0);
});
