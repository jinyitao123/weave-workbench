import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { auditPageArtifacts, checkPayloadBudget } from '../scripts/page-payload-audit.mjs';

const artifact = (pages, id = 'forge') => ({ manifest: { id }, pages });

test('counts UTF-8 bytes and compressed metadata without printing source code', () => {
  const pages = [{ name: 'contracts', kind: 'react', source: 'export default () => "合同";' }];
  const report = auditPageArtifacts([artifact(pages)]);
  assert.equal(report.sourceBytes, Buffer.byteLength(pages[0].source));
  assert.equal(report.fullListGzipBytes, gzipSync(JSON.stringify(pages), { level: 5 }).length);
  assert.equal(report.measurement, 'artifact-estimate');
  assert.ok(!JSON.stringify(report).includes('export default'));
});

test('native structured pages need no React source while missing source pages fail', () => {
  assert.equal(auditPageArtifacts([artifact([{ name: 'native', regions: [] }])]).sourcePageCount, 0);
  assert.throws(() => auditPageArtifacts([artifact([{ name: 'broken', kind: 'react' }])]), /no source/);
  assert.throws(() => auditPageArtifacts([artifact([{ name: 'broken', source: {} }])]), /must be a string/);
});

test('same names across packages stay distinct and repeated sources are visible', () => {
  const page = { name: 'home', kind: 'react', source: 'function Home() { return null; }' };
  const report = auditPageArtifacts([artifact([page], 'sales'), artifact([page], 'supply')]);
  assert.equal(report.pageCount, 2);
  assert.deepEqual(report.duplicateSources, [['sales/home', 'supply/home']]);
  assert.throws(() => auditPageArtifacts([artifact([page, page])]), /Duplicate page identity/);
  assert.throws(() => auditPageArtifacts([artifact([]), artifact([])]), /Duplicate artifact package/);
});

test('counts embedded app bundles alongside a root package', () => {
  const root = artifact([{ name: 'contracts', source: 'legacy body' }], 'forge');
  root.plugins = [{ name: 'runtime-service' }, {
    name: 'sales-app',
    bundle: artifact([{ name: 'contracts', source: 'sales body' }], 'forge.sales'),
  }];
  const report = auditPageArtifacts([root]);
  assert.deepEqual(report.packages, ['forge', 'forge.sales']);
  assert.equal(report.pageCount, 2);
  assert.equal(report.sourceBytes, Buffer.byteLength('legacy body') + Buffer.byteLength('sales body'));
  assert.equal(report.fullListGzipBytes, gzipSync(JSON.stringify([
    root.pages[0], root.plugins[1].bundle.pages[0],
  ]), { level: 5 }).length);
  assert.throws(() => auditPageArtifacts([root, root.plugins[1].bundle]), /Duplicate artifact package/);
});

test('counts independent app bundles under a manifest-free host container', () => {
  const sales = artifact([{ name: 'contracts', source: 'sales body' }], 'forge.sales');
  const sharedCore = artifact([], 'forge');
  const host = { apps: [], pages: [], objects: [], plugins: [{ bundle: sharedCore }, { bundle: sales }, { name: 'runtime-service' }] };
  const report = auditPageArtifacts([host]);
  assert.deepEqual(report.packages, ['forge', 'forge.sales']);
  assert.equal(report.pageCount, 1);
  assert.throws(() => auditPageArtifacts([{ plugins: [] }]), /manifest.id/);
  assert.throws(() => auditPageArtifacts([{ pages: [{ name: 'unowned' }], plugins: [{ bundle: sales }] }]), /manifest.id/);
  assert.throws(() => auditPageArtifacts([{ plugins: [{ bundle: { pages: [] } }] }]), /manifest.id/);
  assert.throws(() => auditPageArtifacts([{ plugins: [{ bundle: sales }, { bundle: sales }] }]), /Duplicate artifact package/);
});

test('malformed or missing artifacts are errors rather than a zero-page success', () => {
  assert.throws(() => auditPageArtifacts([]), /At least one/);
  assert.throws(() => auditPageArtifacts([{}]), /manifest.id/);
  assert.throws(() => auditPageArtifacts([{ manifest: { id: 'forge' } }]), /pages must be an array/);
  assert.throws(() => auditPageArtifacts([artifact([{}])]), /Page name/);
  assert.equal(auditPageArtifacts([artifact([])]).pageCount, 0);
});

test('budgets fail on emitted bytes and reject invalid or misspelled limits', () => {
  const report = auditPageArtifacts([artifact([{ name: 'home', source: 'some source' }])]);
  assert.deepEqual(checkPayloadBudget(report), []);
  const violations = checkPayloadBudget(report, { maxPageGzipBytes: 1, maxFullListGzipBytes: 1 });
  assert.equal(violations.length, 2);
  assert.equal(violations[1].scope, 'forge/home');
  assert.throws(() => checkPayloadBudget(report, { maxPageGzipBytes: NaN }), /Invalid/);
  assert.throws(() => checkPayloadBudget(report, { maxPageGzip: 100 }), /Invalid/);
  assert.deepEqual(checkPayloadBudget(report, { maxPageGzipBytes: report.pages[0].gzipBytes }), []);
});
