#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const artifact = JSON.parse(await readFile(new URL('../dist/objectstack.json', import.meta.url), 'utf8'));
const pageByName = new Map();
const objectNames = new Set();

// React Page `navigate` receives paths below the Console basename. Calls omit
// `replace`, so the host router keeps a history entry for the customer-detail back path.

for (const plugin of artifact.plugins ?? []) {
  const bundle = plugin.bundle ?? {};
  const packageId = bundle.manifest?.id;
  for (const page of bundle.pages ?? []) {
    assert.ok(!pageByName.has(page.name), `duplicate Page ${page.name}`);
    pageByName.set(page.name, { packageId, kind: page.kind, source: page.source ?? '' });
  }
  if (bundle.manifest?.id === 'forge') {
    for (const object of bundle.objects ?? []) objectNames.add(object.name);
  }
}

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

const migratedSources = [customerList, projectCenter, purchaseOrders];
for (const source of migratedSources) {
  assert.doesNotMatch(source, /navigate\('\/_console\//, 'navigate paths must leave basename handling to the host router');
}

console.log(
  'PASS compiled customer detail, Project-to-Sales, and purchase-arrival paths use host navigation with package identity and query values preserved',
);
