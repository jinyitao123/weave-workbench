#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const artifact = JSON.parse(await readFile(new URL('../dist/objectstack.json', import.meta.url), 'utf8'));
const productUiSource = await readFile(new URL('../src/pages/product-ui.ts', import.meta.url), 'utf8');
const ts = createRequire(import.meta.url)('typescript');
const pageByName = new Map();
const objectNames = new Set();
const appIds = new Set();

// React Page `navigate` receives paths below the Console basename. Calls omit
// `replace`, so the host router keeps a history entry for the customer-detail back path.

for (const plugin of artifact.plugins ?? []) {
  const bundle = plugin.bundle ?? {};
  const packageId = bundle.manifest?.id;
  if (bundle.manifest?.type === 'app' && packageId) appIds.add(packageId);
  for (const page of bundle.pages ?? []) {
    assert.ok(!pageByName.has(page.name), `duplicate Page ${page.name}`);
    pageByName.set(page.name, { packageId, kind: page.kind, source: page.source ?? '' });
  }
  if (bundle.manifest?.id === 'forge') {
    for (const object of bundle.objects ?? []) objectNames.add(object.name);
  }
}

const objectOwnerMatch = productUiSource.match(
  /const forgeObjectRoutePackageByName: Record<string, string> = (\{[\s\S]*?\});/,
);
assert.ok(objectOwnerMatch, 'product-ui.ts must declare business object route ownership');
const objectOwnerByName = JSON.parse(objectOwnerMatch[1]);
assert.ok(productUiSource.includes('href={next.href} onClick={event=>'));
assert.ok(productUiSource.includes('event.preventDefault();navigate(next.to)'));

function pageSource(pageName, expectedPackageId) {
  const page = pageByName.get(pageName);
  assert.ok(page, `compiled artifact is missing ${pageName}`);
  assert.equal(page.packageId, expectedPackageId, `${pageName} must remain in its owning App`);
  assert.equal(page.kind, 'react', `${pageName} must use the Console React Page runtime that injects navigate()`);
  return page.source;
}

const customerList = pageSource('page_sales_customers', 'com.inoforge.forge.sales');
assert.ok(objectNames.has('forge_customer'), 'customer detail route must target a registered shared object');
assert.equal(
  (customerList.match(/navigate\('\/apps\/com\.inoforge\.forge\.sales\/forge_customer\/record\//g) ?? []).length,
  1,
  'customer list must open the native customer record through host navigation',
);
assert.match(customerList, /forge_customer\/record\/'\+encodeURIComponent\(r\.id\)/);
assert.doesNotMatch(customerList, /location\.href=forgeBase\+\'\/forge_customer\/record\//);

const projectCenter = pageSource('page_project_center', 'com.inoforge.forge.project');
assert.equal(
  (projectCenter.match(/navigate\('\/apps\/com\.inoforge\.forge\.sales\/page_goodwill_orders'\)/g) ?? []).length,
  1,
  'Project-to-Sales entry point must use the app-relative host path',
);
assert.equal(
  (projectCenter.match(/navigate\('\/apps\/com\.inoforge\.forge\.sales\/page_goodwill_orders\?project=/g) ?? []).length,
  1,
  'Project to Sales navigation must keep the target App package explicit',
);
assert.match(projectCenter, /page_goodwill_orders\?project=\'\+encodeURIComponent\(projectId\)/);
assert.doesNotMatch(projectCenter, /location\.href=\'\/_console\/apps\/com\.inoforge\.forge\.sales\/page_goodwill_orders/);
assert.equal(
  pageByName.get('page_goodwill_orders')?.packageId,
  'com.inoforge.forge.sales',
  'Goodwill must stay owned by the Sales App',
);

const purchaseOrders = pageSource('page_purchase_order_workspace', 'com.inoforge.forge.supply-chain');
assert.equal(
  (purchaseOrders.match(/navigate\('\/apps\/com\.inoforge\.forge\.supply-chain\/page_purchase_arrival_workspace\?notice=/g) ?? []).length,
  3,
  'the purchase-order arrival entry points must use the same host-routed supply-chain destination',
);
assert.equal(
  (purchaseOrders.match(/page_purchase_arrival_workspace\?notice=\'\+encodeURIComponent\((?:byOrder\(state\.notices,order\.id\)\[0\]\.id|notice\.id)\)/g) ?? []).length,
  3,
  'arrival notice identity must remain encoded in the query string',
);
assert.doesNotMatch(
  purchaseOrders,
  /location\.href=\'\/_console\/apps\/com\.inoforge\.forge\.supply-chain\/page_purchase_arrival_workspace\?notice=/,
);
assert.equal(
  pageByName.get('page_purchase_arrival_workspace')?.packageId,
  'com.inoforge.forge.supply-chain',
  'purchase arrival workspace must stay owned by Supply Chain',
);

assert.ok(
  projectCenter.includes("navigate('/apps/com.inoforge.forge.project/forge_project_member/record/'+encodeURIComponent(x.id))"),
  'legacy project-member detail links must use the canonical record route',
);

const receivablesPayables = pageSource('page_receivables_payables', 'com.inoforge.forge.finance');
assert.ok(
  receivablesPayables.includes("navigate('/apps/com.inoforge.forge.finance/'+(isAR?'forge_accounts_receivable':'forge_accounts_payable')+'/record/'+encodeURIComponent(row.id))"),
  'the fixed AR/AP record alternatives must use host navigation',
);
assert.equal(objectOwnerByName.forge_accounts_receivable, 'com.inoforge.forge.finance');
assert.equal(objectOwnerByName.forge_accounts_payable, 'com.inoforge.forge.finance');

const migratedSources = [customerList, projectCenter, purchaseOrders];
for (const source of migratedSources) {
  assert.doesNotMatch(source, /navigate\('\/_console\//, 'navigate paths must leave basename handling to the host router');
}

const pageRoutePattern = /navigate\(\\?['"]\/apps\/([a-z0-9.-]+)\/(page_[a-z0-9_]+)/g;
const objectRoutePattern = /navigate\(\\?['"]\/apps\/([a-z0-9.-]+)\/(forge_[a-z0-9_]+)\/(record|new)(?=\/|[?'"\\])/g;
const fixedLocationPattern = /(?:window\.)?location\.(?:href\s*=|assign\s*\()\s*\\?['"]\/_console\/apps\/[^/'"]+\/(?:page_[a-z0-9_]+|forge_[a-z0-9_]+\/(?:record(?:\/|['"\\])|new(?:['"\\])))/;
let compiledPageRoutes = 0;
let compiledObjectRoutes = 0;
let heroRoutes = 0;
let parsedReactPages = 0;
const heroTargets = new Set();

for (const plugin of artifact.plugins ?? []) {
  const bundle = plugin.bundle ?? {};
  if (bundle.manifest?.type !== 'app') continue;

  for (const page of bundle.pages ?? []) {
    const source = page.source ?? '';
    for (const [, packageId, targetPage] of source.matchAll(pageRoutePattern)) {
      assert.ok(appIds.has(packageId), `${targetPage} navigation uses an unknown App package`);
      assert.equal(pageByName.get(targetPage)?.packageId, packageId, `${targetPage} route App does not match its Page owner`);
      compiledPageRoutes += 1;
    }
    for (const [, packageId, targetObject] of source.matchAll(objectRoutePattern)) {
      assert.ok(appIds.has(packageId), `${targetObject} navigation uses an unknown App package`);
      assert.equal(objectOwnerByName[targetObject], packageId, `${targetObject} route App does not match its business owner`);
      assert.ok(objectNames.has(targetObject), `${targetObject} is not registered in the shared business core`);
      compiledObjectRoutes += 1;
    }
    assert.doesNotMatch(source, fixedLocationPattern, `${page.name} still reloads a fixed internal Page/object target`);

    for (const [, nextProps] of source.matchAll(/next=\{\{([^{}]*)\}\}/g)) {
      const hrefMatch = nextProps.match(/href\s*:\s*(['"])(\/_console\/apps\/([a-z0-9.-]+)\/(page_[a-z0-9_]+))\1/);
      if (!hrefMatch) continue;
      const [, , , packageId, targetPage] = hrefMatch;
      const toMatch = nextProps.match(/\bto\s*:\s*(['"])(\/apps\/([a-z0-9.-]+)\/(page_[a-z0-9_]+))\1/);
      assert.ok(toMatch, `${page.name} ForgeHero internal anchor needs a host route target`);
      assert.equal(toMatch[3], packageId, `${page.name} ForgeHero package identity changed`);
      assert.equal(toMatch[4], targetPage, `${page.name} ForgeHero Page target changed`);
      assert.equal(pageByName.get(targetPage)?.packageId, packageId, `${targetPage} ForgeHero target is in the wrong App`);
      heroTargets.add(`${packageId}/${targetPage}`);
      heroRoutes += 1;
    }

    if (/navigate\(\\?['"]\/apps\/|\bto\s*:\s*\\?['"]\/apps\//.test(source)) {
      const result = ts.transpileModule(source, {
        fileName: `${page.name}.tsx`,
        reportDiagnostics: true,
        compilerOptions: {
          jsx: ts.JsxEmit.React,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      });
      const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
      assert.equal(errors.length, 0, `${page.name} React source must parse after its navigation changes`);
      parsedReactPages += 1;
    }
  }
}

assert.ok(compiledPageRoutes > 0, 'compiled artifact must retain host-routed Page destinations');
assert.ok(compiledObjectRoutes > 0, 'compiled artifact must retain host-routed object destinations');
assert.equal(heroTargets.size, 9, 'all fixed internal ForgeHero next anchors must opt into host navigation');
assert.ok(heroRoutes >= heroTargets.size, 'compiled ForgeHero anchors must include each fixed route');
assert.ok(parsedReactPages > 0, 'changed trusted React Page source must pass syntax parsing');

console.log(
  `PASS sample paths and ${compiledPageRoutes} Page / ${compiledObjectRoutes} object routes resolve to their owner; ${heroTargets.size} ForgeHero targets and ${parsedReactPages} React Pages validate`,
);
