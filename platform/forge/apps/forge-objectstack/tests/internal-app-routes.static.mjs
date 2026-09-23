#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const artifactPath = new URL('../dist/objectstack.json', import.meta.url);
const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
const productUiSource = await readFile(new URL('../src/pages/product-ui.ts', import.meta.url), 'utf8');
const bundles = (artifact.plugins ?? []).map((plugin) => plugin.bundle).filter(Boolean);
const pageOwnerByName = new Map();
const appIds = new Set();

for (const bundle of bundles) {
  const packageId = bundle.manifest?.id;
  if (bundle.manifest?.type === 'app' && packageId) appIds.add(packageId);
  for (const page of bundle.pages ?? []) {
    assert.ok(page.name, 'compiled Page is missing its name');
    assert.ok(!pageOwnerByName.has(page.name), `duplicate compiled Page ${page.name}`);
    pageOwnerByName.set(page.name, packageId);
  }
}

assert.equal(appIds.size, 7, 'expected the seven Forge business App packages');
assert.ok(pageOwnerByName.size > 0, 'compiled artifact must contain registered Pages');

function readRouteMap(name) {
  const marker = new RegExp(`const ${name}: Record<string, string> = (\\{[\\s\\S]*?\\});`);
  const match = productUiSource.match(marker);
  assert.ok(match, `product-ui.ts must declare ${name}`);
  return JSON.parse(match[1]);
}

const dynamicPageOwners = readRouteMap('forgePageRoutePackageByName');
const dynamicObjectOwners = readRouteMap('forgeObjectRoutePackageByName');
for (const [pageName, packageId] of Object.entries(dynamicPageOwners)) {
  assert.equal(pageOwnerByName.get(pageName), packageId, `${pageName} route helper must match artifact ownership`);
  assert.ok(appIds.has(packageId), `${pageName} route helper uses an unknown App package`);
}
for (const name of [
  'page_workbench',
  'page_workspace_ai',
  'page_onboarding_center',
  'page_todo_management',
  'page_workspace_recovery_status',
  'page_system_gap',
]) {
  assert.equal(dynamicPageOwners[name], undefined, `${name} is unregistered and must not get a fabricated route`);
}

const expectedObjectOwners = new Map([
  ['forge_bom', 'com.inoforge.forge.supply-chain'],
  ['forge_cash_receipt', 'com.inoforge.forge.finance'],
  ['forge_contact', 'com.inoforge.forge.sales'],
  ['forge_customer', 'com.inoforge.forge.sales'],
  ['forge_inventory_balance', 'com.inoforge.forge.supply-chain'],
  ['forge_inventory_ledger', 'com.inoforge.forge.supply-chain'],
  ['forge_material', 'com.inoforge.forge.supply-chain'],
  ['forge_opening_inbound', 'com.inoforge.forge.supply-chain'],
  ['forge_payment_condition', 'com.inoforge.forge.finance'],
  ['forge_production_inbound', 'com.inoforge.forge.supply-chain'],
  ['forge_project', 'com.inoforge.forge.project'],
  ['forge_project_attachment', 'com.inoforge.forge.project'],
  ['forge_project_cost_entry', 'com.inoforge.forge.project'],
  ['forge_project_expense', 'com.inoforge.forge.project'],
  ['forge_project_log', 'com.inoforge.forge.project'],
  ['forge_project_member', 'com.inoforge.forge.project'],
  ['forge_project_plan', 'com.inoforge.forge.project'],
  ['forge_purchase_inbound', 'com.inoforge.forge.supply-chain'],
  ['forge_purchase_invoice', 'com.inoforge.forge.finance'],
  ['forge_sales_additional_fee', 'com.inoforge.forge.sales'],
  ['forge_sales_contract', 'com.inoforge.forge.sales'],
  ['forge_sales_invoice', 'com.inoforge.forge.finance'],
  ['forge_sales_order', 'com.inoforge.forge.sales'],
  ['forge_sales_outbound', 'com.inoforge.forge.supply-chain'],
  ['forge_sales_return', 'com.inoforge.forge.sales'],
  ['forge_sales_shipment', 'com.inoforge.forge.sales'],
  ['forge_subcontract_inbound', 'com.inoforge.forge.production'],
  ['forge_supplier', 'com.inoforge.forge.supply-chain'],
  ['forge_warehouse', 'com.inoforge.forge.supply-chain'],
  ['forge_accounts_receivable', 'com.inoforge.forge.finance'],
  ['forge_accounts_payable', 'com.inoforge.forge.finance'],
]);
assert.deepEqual(dynamicObjectOwners, Object.fromEntries(expectedObjectOwners));

function stringsIn(value, result = []) {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => stringsIn(entry, result));
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => stringsIn(entry, result));
  }
  return result;
}

const coreBundle = bundles.find((bundle) => bundle.manifest?.id === 'forge');
assert.ok(coreBundle, 'compiled artifact must contain the shared Forge business core');
const coreObjectNames = new Set((coreBundle.objects ?? []).map((object) => object.name));
for (const objectName of Object.keys(dynamicObjectOwners)) {
  assert.ok(coreObjectNames.has(objectName), `${objectName} route helper refers to an unregistered business object`);
}

const coreRouteStrings = stringsIn([coreBundle.actions ?? [], coreBundle.flows ?? []]);
for (const value of coreRouteStrings) {
  assert.ok(
    !value.includes('/_console/apps/forge/'),
    `Action/Flow still points at the shared core as a visible App: ${value.slice(0, 180)}`,
  );
}

const pageRoutePattern = /\/_console\/apps\/([a-z0-9.-]+)\/(page_[a-z0-9_]+)/g;
let checkedPageRoutes = 0;
let checkedRuntimeRouteMaps = false;
let routeHelpers;
function checkPageRoutes(source) {
  if (!checkedRuntimeRouteMaps && source.includes('const forgePageHref=')) {
    const runtimeMaps = source.match(
      /const forgeRoutePackageIds=(\[[\s\S]*?\]);const forgePageRoutePackageIndexByName=(\{[\s\S]*?\});const forgePageHref=/,
    );
    const runtimeObjectMap = source.match(
      /const forgeObjectRoutePackageIndexByName=(\{[\s\S]*?\});const forgeObjectHref=/,
    );
    assert.ok(runtimeMaps, 'compiled Page runtime must include the registered Page route map');
    assert.ok(runtimeObjectMap, 'compiled Page runtime must include the business record route map');
    const [packageIds, pageIndexes, objectIndexes] = [
      JSON.parse(runtimeMaps[1]),
      JSON.parse(runtimeMaps[2]),
      JSON.parse(runtimeObjectMap[1]),
    ];
    for (const [pageName, index] of Object.entries(pageIndexes)) {
      assert.equal(packageIds[index], dynamicPageOwners[pageName], `${pageName} runtime route map drifted`);
    }
    for (const [objectName, index] of Object.entries(objectIndexes)) {
      assert.equal(packageIds[index], dynamicObjectOwners[objectName], `${objectName} runtime route map drifted`);
    }
    const helperStart = source.indexOf('const forgeRoutePackageIds=');
    const helperEnd = source.indexOf('const forgeBase=', helperStart);
    routeHelpers = runInNewContext(
      `${source.slice(helperStart, helperEnd)};({forgePageHref, forgeObjectHref})`,
    );
    checkedRuntimeRouteMaps = true;
  }
  for (const match of source.matchAll(pageRoutePattern)) {
    const [, packageId, pageName] = match;
    assert.ok(appIds.has(packageId), `Page route uses an unknown App package ${packageId}`);
    assert.equal(
      pageOwnerByName.get(pageName),
      packageId,
      `${pageName} must be routed through its owning App package`,
    );
    checkedPageRoutes += 1;
  }
}

for (const bundle of bundles.filter((candidate) => candidate.manifest?.type === 'app')) {
  for (const source of stringsIn(bundle.pages ?? [])) {
    assert.ok(
      !/\/_console\/apps\/forge\/page\/(page_[a-z0-9_]+)/.test(source),
      'compiled Page still contains an old shared-core Page route',
    );
    assert.ok(
      !/forgeBase\s*\+\s*['"]\/page\/(page_[a-z0-9_]+)/.test(source),
      'compiled Page still builds a legacy /page/page_* URL from forgeBase',
    );
    checkPageRoutes(source);
  }
}

for (const source of coreRouteStrings) checkPageRoutes(source);

const objectRouteOwnerByName = new Map([
  ...expectedObjectOwners,
  ['forge_collection_allocation', 'com.inoforge.forge.finance'],
]);
let checkedObjectRoutes = 0;
const objectRoutePattern = /\/_console\/apps\/([a-z0-9.-]+)\/([a-z][a-z0-9_]*)\/record\//g;
for (const source of coreRouteStrings) {
  for (const [, packageId, objectName] of source.matchAll(objectRoutePattern)) {
    assert.ok(appIds.has(packageId), `Record route uses an unknown App package ${packageId}`);
    assert.equal(
      objectRouteOwnerByName.get(objectName),
      packageId,
      `${objectName} record route must use its business App package`,
    );
    checkedObjectRoutes += 1;
  }
}

let checkedPageObjectRoutes = 0;
for (const bundle of bundles.filter((candidate) => candidate.manifest?.type === 'app')) {
  for (const source of stringsIn(bundle.pages ?? [])) {
    assert.ok(
      !/forgeBase\s*\+\s*['"]\/page\//.test(source),
      'compiled Page still constructs a route relative to the old /page namespace',
    );
    assert.ok(
      !source.includes('/_console/apps/forge/'),
      'compiled Page still uses the shared-core package as a visible App',
    );
    for (const [, packageId, objectName] of source.matchAll(objectRoutePattern)) {
      assert.ok(appIds.has(packageId), `Record route uses an unknown App package ${packageId}`);
      assert.equal(
        objectRouteOwnerByName.get(objectName),
        packageId,
        `${objectName} record route must use its business App package`,
      );
      checkedPageObjectRoutes += 1;
    }
  }
}

assert.ok(checkedPageRoutes > 0, 'expected to validate compiled Page-to-App routes');
assert.ok(checkedRuntimeRouteMaps, 'expected to validate compressed runtime route maps in the artifact');
assert.equal(
  routeHelpers.forgePageHref('page_sales_contract_workspace', '?id=sales-123'),
  '/_console/apps/com.inoforge.forge.sales/page_sales_contract_workspace?id=sales-123',
  'dynamic Page navigation must resolve through the owning App and preserve query values',
);
assert.equal(
  routeHelpers.forgePageHref('page_project_center', 'project=project-456'),
  '/_console/apps/com.inoforge.forge.project/page_project_center?project=project-456',
  'dynamic Page navigation must add a missing query prefix without losing parameters',
);
assert.equal(routeHelpers.forgePageHref('page_workbench'), null, 'unregistered root Pages must not get routes');
assert.equal(
  routeHelpers.forgeObjectHref('forge_sales_contract', '/record/contract-123'),
  '/_console/apps/com.inoforge.forge.sales/forge_sales_contract/record/contract-123',
  'dynamic record navigation must use the business App package',
);
assert.equal(routeHelpers.forgeObjectHref('unknown_business_object', '/record/id'), null);
assert.ok(checkedObjectRoutes > 0, 'expected to validate compiled Action record routes');
assert.ok(checkedPageObjectRoutes > 0, 'expected to validate compiled Page record routes');
console.log(
  `PASS compiled ${pageOwnerByName.size} registered Pages across ${appIds.size} Apps; ${checkedPageRoutes} Page routes, ${checkedObjectRoutes} Action record routes, and ${checkedPageObjectRoutes} Page record routes resolve to their business App`,
);
