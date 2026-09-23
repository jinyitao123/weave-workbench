import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const directRelativeApiFetch = /\bfetch\s*\(\s*(['"`])\s*\/api\/v1(?=['"`/?$])/g;
const copiedSessionToken = /\blocalStorage\s*\.\s*getItem\s*\(\s*(['"])auth-session-token\1\s*\)/;

function findUnsafePageRequests(artifact) {
  const issues = [];
  for (const plugin of artifact.plugins ?? []) {
    const bundle = plugin.bundle;
    if (plugin.type !== 'app' || bundle?.manifest?.type !== 'app') continue;
    for (const page of bundle.pages ?? []) {
      const source = typeof page.source === 'string' ? page.source : '';
      for (const match of source.matchAll(directRelativeApiFetch)) {
        issues.push({
          kind: 'direct-relative-api-fetch',
          packageId: bundle.manifest.id,
          page: page.name,
          snippet: source.slice(match.index, match.index + 100).replace(/\s+/g, ' '),
        });
      }
      if (copiedSessionToken.test(source)) {
        issues.push({
          kind: 'copied-session-token',
          packageId: bundle.manifest.id,
          page: page.name,
        });
      }
    }
  }
  return issues;
}

// Keep both sides of the rule covered: global fetch to the app API is rejected,
// while the adapter-backed transport used by ForgeApiResponse remains allowed.
const fixture = source => ({
  plugins: [{
    type: 'app',
    bundle: {
      manifest: { id: 'com.inoforge.forge.fixture', type: 'app' },
      pages: [{ name: 'fixture_page', kind: 'react', source }],
    },
  }],
});
assert.equal(
  findUnsafePageRequests(fixture("async function load(){return fetch('/api/v1/data/example')}"))[0]?.kind,
  'direct-relative-api-fetch',
);
assert.equal(
  findUnsafePageRequests(fixture('async function load(path){return fetch(`/api/v1${path}`)}'))[0]?.kind,
  'direct-relative-api-fetch',
);
assert.equal(
  findUnsafePageRequests(fixture("async function load(){return fetch('/api/v1?$top=1')}"))[0]?.kind,
  'direct-relative-api-fetch',
);
assert.equal(
  findUnsafePageRequests(fixture("async function load(){return ForgeApiResponse(adapter,'/data/example')}")).length,
  0,
);
assert.equal(
  findUnsafePageRequests(fixture("const token=localStorage.getItem('auth-session-token')"))[0]?.kind,
  'copied-session-token',
);

const artifact = JSON.parse(await readFile(new URL('../dist/objectstack.json', import.meta.url), 'utf8'));
const issues = findUnsafePageRequests(artifact);
assert.deepEqual(issues, [], issues.map(issue => `${issue.packageId}/${issue.page}: ${issue.kind}${issue.snippet ? ` (${issue.snippet})` : ''}`).join('\n'));

console.log('PASS compiled Forge App Pages use the ObjectStack auth adapter for relative API calls and do not copy session tokens');
