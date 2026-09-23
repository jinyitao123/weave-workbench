#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const bytes = value => Buffer.byteLength(value, 'utf8');
const encode = value => JSON.stringify(value);

function expandArtifacts(roots) {
  const result = [];
  for (const artifact of roots) {
    if (artifact?.manifest) result.push(artifact);
    else if (!Array.isArray(artifact?.plugins) ||
      (artifact?.pages !== undefined && (!Array.isArray(artifact.pages) || artifact.pages.length !== 0))) {
      throw new Error('Artifact manifest.id is required');
    }
    let nestedBundles = 0;
    for (const plugin of artifact?.plugins ?? []) {
      const bundle = plugin?.bundle;
      if (bundle && typeof bundle === 'object') {
        nestedBundles++;
        result.push(...expandArtifacts([bundle]));
      }
    }
    if (!artifact?.manifest && nestedBundles === 0) throw new Error('Artifact manifest.id is required');
  }
  return result;
}

// Artifact estimates describe emitted metadata, not live HTTP timings or business acceptance.
export function auditPageArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) throw new Error('At least one artifact is required');
  const packages = expandArtifacts(artifacts);
  const pages = [];
  const seen = new Set();
  const packageIds = new Set();
  for (const artifact of packages) {
    const packageId = artifact?.manifest?.id;
    if (typeof packageId !== 'string' || !packageId.trim()) throw new Error('Artifact manifest.id is required');
    if (packageIds.has(packageId)) throw new Error(`Duplicate artifact package: ${packageId}`);
    packageIds.add(packageId);
    if (!Array.isArray(artifact.pages)) throw new Error(`Artifact pages must be an array: ${packageId}`);
    for (const page of artifact.pages) {
      if (!page || typeof page.name !== 'string' || !page.name.trim()) throw new Error(`Page name is required: ${packageId}`);
      const key = `${packageId}/${page.name}`;
      if (seen.has(key)) throw new Error(`Duplicate page identity: ${key}`);
      seen.add(key);
      if (page.source !== undefined && typeof page.source !== 'string') throw new Error(`Page source must be a string: ${key}`);
      if (['react', 'html', 'jsx'].includes(page.kind) && !page.source?.trim()) throw new Error(`Source page has no source: ${key}`);
      const source = page.source ?? '';
      const serialized = encode(page);
      pages.push({
        packageId, name: page.name, kind: page.kind ?? 'full',
        jsonBytes: bytes(serialized), gzipBytes: gzipSync(serialized, { level: 5 }).length,
        sourceBytes: bytes(source),
        sourceHash: source ? createHash('sha256').update(source).digest('hex') : null,
      });
    }
  }
  const sources = new Map();
  for (const page of pages) {
    if (!page.sourceHash) continue;
    const entries = sources.get(page.sourceHash) ?? [];
    entries.push(`${page.packageId}/${page.name}`);
    sources.set(page.sourceHash, entries);
  }
  const list = encode(packages.flatMap(artifact => artifact.pages));
  return {
    schemaVersion: 1,
    measurement: 'artifact-estimate',
    compression: 'gzip-level-5',
    packages: [...packageIds],
    pageCount: pages.length,
    sourcePageCount: pages.filter(page => page.sourceBytes > 0).length,
    sourceBytes: pages.reduce((sum, page) => sum + page.sourceBytes, 0),
    fullListJsonBytes: bytes(list),
    fullListGzipBytes: gzipSync(list, { level: 5 }).length,
    duplicateSources: [...sources.values()].filter(entries => entries.length > 1),
    pages: pages.map(({ sourceHash, ...page }) => page).sort((a, b) => b.jsonBytes - a.jsonBytes || a.name.localeCompare(b.name)),
  };
}

export function checkPayloadBudget(report, budget = {}) {
  const violations = [];
  for (const [key, value] of Object.entries(budget)) {
    if (!['maxPageGzipBytes', 'maxFullListGzipBytes'].includes(key) || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Invalid payload budget: ${key}`);
    }
  }
  if (budget.maxFullListGzipBytes && report.fullListGzipBytes > budget.maxFullListGzipBytes) {
    violations.push({ scope: 'full-list', actualBytes: report.fullListGzipBytes, limitBytes: budget.maxFullListGzipBytes });
  }
  for (const page of report.pages) {
    if (budget.maxPageGzipBytes && page.gzipBytes > budget.maxPageGzipBytes) {
      violations.push({ scope: `${page.packageId}/${page.name}`, actualBytes: page.gzipBytes, limitBytes: budget.maxPageGzipBytes });
    }
  }
  return violations;
}

async function main(args) {
  const files = [];
  const budget = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') {
      console.log('Usage: node scripts/page-payload-audit.mjs [--artifact FILE]... [--max-page-gzip BYTES] [--max-list-gzip BYTES]');
      return;
    }
    const value = args[++i];
    if (!value) throw new Error(`Missing argument: ${flag}`);
    if (flag === '--artifact') files.push(value);
    else if (flag === '--max-page-gzip') budget.maxPageGzipBytes = Number(value);
    else if (flag === '--max-list-gzip') budget.maxFullListGzipBytes = Number(value);
    else throw new Error(`Unknown option: ${flag}`);
  }
  const artifacts = [];
  for (const file of files.length ? files : ['dist/objectstack.json']) {
    let artifact;
    try { artifact = JSON.parse(await readFile(file, 'utf8')); }
    catch { throw new Error(`Cannot read JSON artifact: ${file}`); }
    artifacts.push(artifact);
  }
  const report = auditPageArtifacts(artifacts);
  const violations = checkPayloadBudget(report, budget);
  console.log(JSON.stringify({ ...report, budget, violations }, null, 2));
  if (violations.length) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
