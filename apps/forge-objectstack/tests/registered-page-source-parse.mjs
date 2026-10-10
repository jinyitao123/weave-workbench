import assert from 'node:assert/strict';
import ts from 'typescript';
import * as pages from '../src/pages/index.ts';

let count = 0;
for (const [name, page] of Object.entries(pages)) {
  if (typeof page?.source !== 'string') continue;
  const source = ts.createSourceFile(`${name}.jsx`, page.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.equal(source.parseDiagnostics.length, 0, `${name}: ${source.parseDiagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, ' ')).join('; ')}`);
  count++;
}
assert.ok(count > 0, 'Registered application page sources must be inspected.');
console.log(`PASS ${count} registered embedded React page sources parse as JSX`);
