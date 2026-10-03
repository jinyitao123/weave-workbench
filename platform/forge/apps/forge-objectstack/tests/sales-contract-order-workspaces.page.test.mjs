import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { SalesContractWorkspacePage } from '../src/pages/sales-contract-workspace.page.ts';
import { SalesOrderWorkspacePage } from '../src/pages/sales-order-workspace.page.ts';

const pages = [SalesContractWorkspacePage, SalesOrderWorkspacePage];

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
