import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ProjectCenterPage } = await import('../src/pages/project-center.page.ts');
const cliRequire = createRequire(require.resolve('@objectstack/cli'));
const { transformSync } = cliRequire('esbuild');

assert.equal(ProjectCenterPage.kind, 'react');
transformSync(ProjectCenterPage.source, { loader: 'jsx', format: 'esm', sourcefile: 'page_project_center.jsx' });
process.stdout.write('PASS page_project_center embedded React source parses\n');
