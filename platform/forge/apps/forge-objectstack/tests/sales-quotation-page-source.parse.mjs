import assert from 'node:assert/strict';
import ts from 'typescript';
import { SalesQuotationsPage } from '../src/pages/sales-crm-service-pages.page.ts';

const parsed = ts.createSourceFile('sales-quotations.jsx', SalesQuotationsPage.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(parsed.parseDiagnostics.length, 0, parsed.parseDiagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'));
console.log('PASS generated sales quotation page source parses as JSX');
