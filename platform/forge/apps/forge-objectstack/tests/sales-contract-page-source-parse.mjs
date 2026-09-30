import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { SalesContractCreatePage } from '../src/pages/sales-contract-create.page.ts';
import { SalesContractWorkspacePage } from '../src/pages/sales-contract-workspace.page.ts';

const require = createRequire(import.meta.url);
const cliRequire = createRequire(require.resolve('@objectstack/cli'));
const { transformSync } = cliRequire('esbuild');

for (const page of [SalesContractCreatePage, SalesContractWorkspacePage]) {
  assert.equal(page.kind, 'react');
  transformSync(page.source, { loader: 'jsx', format: 'esm', sourcefile: `${page.name}.jsx` });
}

process.stdout.write('PASS sales contract embedded React page sources compile as JSX\n');
