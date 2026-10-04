import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { SalesContractWorkspacePage } from '../src/pages/sales-contract-workspace.page.ts';
import { SalesOrderWorkspacePage } from '../src/pages/sales-order-workspace.page.ts';

const pages = [SalesContractWorkspacePage, SalesOrderWorkspacePage];

function renderedText(tree) {
  if (Array.isArray(tree)) return tree.map(renderedText).join('');
  if (tree === null || tree === undefined || typeof tree === 'boolean') return '';
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return renderedText(tree.props?.children);
}

function walk(tree, visit) {
  if (Array.isArray(tree)) { for (const item of tree) walk(item, visit); return; }
  if (!tree || typeof tree !== 'object') return;
  visit(tree);
  walk(tree.props?.children, visit);
}

function contractWorkspaceHarness(records) {
  const hooks = [], effects = [], calls = [], downloads = [], blobs = [];
  let cursor = 0;
  const React = {
    Fragment: 'Fragment',
    createElement(type, props, ...children) { return { type, props: { ...(props || {}), children } }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }];
    },
    useEffect(effect, dependencies) {
      const index = cursor++, previous = hooks[index];
      const changed = !previous || !dependencies || dependencies.some((value, item) => value !== previous[item]) || dependencies.length !== previous.length;
      if (changed) { hooks[index] = dependencies || []; effects.push(effect); }
    },
  };
  const adapter = {
    baseUrl: 'https://forge.test',
    getAuthHeaders: () => ({ Authorization: 'Bearer source-harness' }),
    fetchImpl: async input => {
      const url = new URL(input), path = url.pathname.replace('/api/v1', '');
      calls.push(path);
      if (path === '/auth/get-session') return new Response(JSON.stringify({ user: { id: 'user-1' } }), { status: 200 });
      if (path.startsWith('/data/')) {
        const objectName = decodeURIComponent(path.slice('/data/'.length)), rows = records[objectName] || [];
        return new Response(JSON.stringify({ records: rows, count: rows.length }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    },
  };
  class HarnessBlob { constructor(parts, options) { this.parts = parts; this.type = options?.type || ''; blobs.push(this); } }
  class HarnessURL extends URL {
    static createObjectURL(blob) { const index = blobs.indexOf(blob); return 'blob:contract-export-' + index; }
    static revokeObjectURL() {}
  }
  const document = {
    head: { appendChild() {} },
    getElementById() { return null; },
    querySelector() { return { focus() {} }; },
    createElement(tag) {
      if (tag !== 'a') return {};
      return { click() { const blob = blobs.find((item, index) => 'blob:contract-export-' + index === this.href); downloads.push({ name: this.download, text: blob?.parts?.join('') || '' }); } };
    },
  };
  const compiled = ts.transpileModule(SalesContractWorkspacePage.source, {
    fileName: `${SalesContractWorkspacePage.name}.tsx`, reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  assert.deepEqual(compiled.diagnostics, [], 'contract workspace source compiles for its rendered data harness');
  const exports = {};
  new Function('exports', 'React', 'useAdapter', 'location', 'navigate', 'Headers', 'URLSearchParams', 'fetch', 'Blob', 'URL', 'setTimeout', 'clearTimeout', 'window', 'document', 'localStorage', compiled.outputText)(
    exports, React, () => adapter,
    { origin: 'https://forge.test', pathname: '/_console/apps/com.inoforge.forge.sales/page_sales_contract_workspace', href: 'https://forge.test/_console/apps/com.inoforge.forge.sales/page_sales_contract_workspace' },
    () => {}, Headers, URLSearchParams, fetch, HarnessBlob, HarnessURL, setTimeout, clearTimeout,
    { location: { origin: 'https://forge.test', href: 'https://forge.test/_console/apps/com.inoforge.forge.sales/page_sales_contract_workspace' } }, document,
    { getItem() { return null; } },
  );
  const App = exports.default, render = () => { cursor = 0; return App(); };
  async function renderLoaded() {
    render();
    for (const effect of effects.splice(0)) effect();
    await new Promise(resolve => setTimeout(resolve, 0));
    return render();
  }
  return { calls, downloads, render, renderLoaded };
}

test('contract/order workspaces parse, page all fetched rows, and do not display fabricated identity or 1/1 totals', () => {
  for (const page of pages) {
    const appSource = page.source.split('const FORGE_HERO_CSS=')[0];
    const compiled = ts.transpileModule(page.source, {
      fileName: `${page.name}.tsx`, reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
    });
    assert.deepEqual(compiled.diagnostics, [], `${page.name} embedded React source is valid`);
    assert.match(page.source, /ForgeReadAllRecords\(adapter,object/ , `${page.name} uses checked, count-aware server paging`);
    assert.match(page.source, /ForgeNavigate\(/, `${page.name} routes through the Console basename adapter`);
    assert.doesNotMatch(appSource, /(?<!Forge)navigate\(/, `${page.name} does not pass Console URLs directly to the SPA router`);
    assert.match(page.source, /上一页/);
    assert.match(page.source, /下一页/);
    assert.doesNotMatch(page.source, /\$top:'500'/);
    assert.doesNotMatch(page.source, /1 \/ 1/);
    assert.doesNotMatch(page.source, /Dev Admin/);
  }
});

test('sales order reviewer action links to the native approval center and never calls the legacy direct-approval action', () => {
  assert.match(SalesOrderWorkspacePage.source, /forgeBase\+'\/system\/approvals'/);
  assert.match(SalesOrderWorkspacePage.source, /order\.status==='pending_approval'&&state\.permissions\.includes\('sales_order_operator'\).*核对审批结果/);
  assert.doesNotMatch(SalesOrderWorkspacePage.source, /\['approved','rejected'\]\.includes\(order\.approval_outcome\)/);
  assert.doesNotMatch(SalesOrderWorkspacePage.source, /sales_order_approve/);
});

test('contract orders require a registered signature and ask the employee for order-specific values', () => {
  assert.match(SalesContractWorkspacePage.source, /statusText=\{[^}]*active:'内部复核通过'/);
  assert.match(SalesContractWorkspacePage.source, /contract\.status==='active'&&contract\.signed_on&&contract\.signed_evidence_attachment/);
  assert.match(SalesContractWorkspacePage.source, /code:'',name:\(customer\(contract\.customer_id\)\|\|'客户'\).*delivery:'',term:contract\.payment_term\|\|'',method:''/);
  assert.doesNotMatch(SalesContractWorkspacePage.source, /SO-FORGE-|delivery:'2026-10-09'|method:'bank_transfer'/);
});

test('contract list preserves masked finance fields as unknown, true zero as zero, and local timestamps in rows and CSV', async () => {
  const harness = contractWorkspaceHarness({
    forge_sales_contract: [
      { id: 'contract-masked', code: 'SC-MASKED', name: '财务字段受限草稿', customer_id: 'customer-1', status: 'draft', responsible_id: 'user-1', created_by: 'user-1', created_at: '2026-10-04T07:28:00.000Z', updated_at: '2026-10-04T07:28:00.000Z' },
      { id: 'contract-zero', code: 'SC-ZERO', name: '可读金额为零草稿', customer_id: 'customer-1', status: 'draft', responsible_id: 'user-1', created_by: 'user-1', total_amount: 100, ordered_amount: 0, invoiced_amount: 0, shipped_amount: 0, collected_amount: 0, created_at: '2026-10-04T07:28:00.000Z', updated_at: '2026-10-04T07:28:00.000Z' },
      { id: 'contract-near', code: 'SC-NEAR', name: '金额接近但尚未足额', customer_id: 'customer-1', status: 'draft', responsible_id: 'user-1', created_by: 'user-1', total_amount: 100, ordered_amount: 99.6, invoiced_amount: 99.6, shipped_amount: 99.6, collected_amount: 99.6, created_at: '2026-10-04T07:28:00.000Z', updated_at: '2026-10-04T07:28:00.000Z' },
      { id: 'contract-zero-total', code: 'SC-ZERO-TOTAL', name: '可读总额为零草稿', customer_id: 'customer-1', status: 'draft', responsible_id: 'user-1', created_by: 'user-1', total_amount: 0, ordered_amount: 0, invoiced_amount: 0, shipped_amount: 0, collected_amount: 0, created_at: '2026-10-04T07:28:00.000Z', updated_at: '2026-10-04T07:28:00.000Z' },
    ],
    forge_sales_order: [], forge_quotation: [], forge_customer: [{ id: 'customer-1', name: '测试客户' }],
    forge_contact: [], sys_user: [{ id: 'user-1', name: '合同经办人' }], forge_project: [], forge_project_sales_link: [], forge_contract_type: [],
  });
  let tree = await harness.renderLoaded();
  let rows = [];
  walk(tree, node => { if (node.type === 'tr') rows.push(node); });
  const maskedText = renderedText(rows.find(row => renderedText(row).includes('SC-MASKED')));
  const zeroText = renderedText(rows.find(row => renderedText(row).includes('SC-ZERO')));
  const zeroTotalText = renderedText(rows.find(row => renderedText(row).includes('SC-ZERO-TOTAL')));
  assert.ok(maskedText.includes('—'), 'masked total and dependent progress render as unknown');
  assert.doesNotMatch(maskedText, /¥\s*0\.00|0%/, 'masked finance fields never become zero money or zero progress');
  assert.match(maskedText, /2026-10-04 15:28/, 'UTC timestamp is rendered through the shared Shanghai local-date formatter');
  assert.match(zeroText, /¥\s*0\.00/, 'an explicit zero monetary value remains zero');
  assert.match(zeroText, /0%/, 'an explicit zero amount with a readable positive total remains 0%');
  assert.match(zeroTotalText, /¥\s*0\.00/, 'an explicit zero denominator remains a known zero amount');
  assert.match(zeroTotalText, /0%/, 'an explicit zero numerator and denominator retain the previous zero-progress presentation');
  let invoiceFilter;
  walk(tree, node => { if (node.type?.name === 'ForgeSelect' && node.props?.label === '开票') invoiceFilter = node; });
  assert.ok(invoiceFilter, 'invoice filter is rendered');
  invoiceFilter.props.onChange('none');
  tree = harness.render();
  rows = [];
  walk(tree, node => { if (node.type === 'tr') rows.push(node); });
  assert.equal(rows.some(row => renderedText(row).includes('SC-MASKED')), false, 'a masked numerator is not falsely classified as no invoice');
  assert.equal(rows.some(row => renderedText(row).includes('SC-ZERO')), true, 'a readable zero invoice amount remains filterable as none');
  invoiceFilter.props.onChange('full');
  tree = harness.render();
  rows = [];
  walk(tree, node => { if (node.type === 'tr') rows.push(node); });
  assert.equal(rows.some(row => renderedText(row).includes('SC-NEAR')), false, 'rounded 100% does not classify an amount below the total as complete');
  invoiceFilter.props.onChange('');
  tree = harness.render();

  const button = label => {
    let found;
    walk(tree, node => { if (node.type === 'button' && renderedText(node).includes(label)) found ||= node; });
    assert.ok(found, `rendered export menu includes ${label}`);
    return found;
  };
  button('导入/导出').props.onClick();
  tree = harness.render();
  button('按合同执行明细导出').props.onClick();
  assert.equal(harness.downloads.length, 1);
  const csv = harness.downloads[0].text;
  const maskedCsvRow = csv.split('\n').find(line => line.includes('"SC-MASKED"'));
  const zeroCsvRow = csv.split('\n').find(line => line.includes('"SC-ZERO"'));
  assert.match(maskedCsvRow, /"—","—","—","—"/u, 'execution CSV preserves unknown amount and progress values');
  assert.doesNotMatch(maskedCsvRow, /0%|¥\s*0\.00/, 'execution CSV does not invent a zero progress or amount');
  assert.match(zeroCsvRow, /"100","0%","0%","0%"/u, 'execution CSV preserves known zero amounts and progress');
  assert.ok(harness.calls.includes('/data/forge_sales_contract'));
});
