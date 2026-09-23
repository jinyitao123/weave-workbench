import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stack = JSON.parse(await readFile(new URL('../dist/objectstack.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('./page-polish.manifest.json', import.meta.url), 'utf8'));

function collectBundles(artifact) {
  const bundles = artifact.manifest ? [artifact] : [];
  for (const plugin of artifact.plugins ?? []) {
    if (plugin.bundle && typeof plugin.bundle === 'object') bundles.push(...collectBundles(plugin.bundle));
  }
  return bundles;
}

function leaves(items, trail = [], groupIds = []) {
  return (items ?? []).flatMap(item => item.type === 'group'
    ? leaves(item.children, [...trail, item.label], [...groupIds, item.id])
    : [{ item, trail: [...trail, item.label], groupIds }]);
}

const bundles = collectBundles(stack);
const expectedApps = new Map([
  ['forge_supply_chain', 'supply_chain'],
  ['forge_sales', 'sales'],
  ['forge_production', 'production'],
  ['forge_project', 'project'],
  ['forge_administration', 'administration'],
  ['forge_finance', 'finance'],
  ['forge_reports', 'reports'],
]);
const apps = bundles.flatMap(bundle => (bundle.apps ?? []).map(app => ({ app, packageId: bundle.manifest.id })));
assert.deepEqual(apps.map(({ app }) => app.name).sort(), [...expectedApps.keys()].sort(), 'compiled artifact must expose exactly seven Forge business apps');

const pageOwners = new Map();
const objectNames = new Set();
for (const bundle of bundles) {
  for (const page of bundle.pages ?? []) {
    assert.equal(pageOwners.has(page.name), false, `Page ${page.name} is registered by more than one package`);
    pageOwners.set(page.name, bundle.manifest.id);
  }
  for (const object of bundle.objects ?? []) {
    assert.equal(objectNames.has(object.name), false, `Object ${object.name} is registered more than once`);
    objectNames.add(object.name);
  }
}

for (const pageName of pageOwners.keys()) {
  assert.equal(objectNames.has(pageName), false, `Page and Object both use ${pageName}; a single-segment app route would be ambiguous`);
}

const pageTargets = entries => entries.flatMap(entry => entry.surfaceType === undefined
  ? (Array.isArray(entry.pages) ? entry.pages : [])
  : (entry.surfaceType === 'page' ? [entry.target] : []));
const polished = new Map([
  ['sales', new Set(pageTargets(manifest.sales ?? []))],
  ['finance', new Set(pageTargets(manifest.finance ?? []))],
]);
const actualPolished = new Map([...polished.keys()].map(key => [key, new Set()]));
let count = 0;

for (const { app, packageId } of apps) {
  const areaKey = expectedApps.get(app.name);
  const ids = new Map();
  const routeKeys = new Map();
  for (const area of app.areas ?? []) {
    for (const { item, trail, groupIds } of leaves(area.navigation, [area.label])) {
      count++;
      assert.equal(ids.has(item.id), false, `${app.name}: duplicate navigation id ${item.id}`);
      ids.set(item.id, trail.join(' / '));

      let routeKey;
      if (item.type === 'page') {
        assert.ok(pageOwners.has(item.pageName), `${app.name}: ${trail.join(' / ')} targets missing Page ${item.pageName}`);
        if (item.params?.nav !== undefined) {
          assert.equal(item.params.nav, item.id, `${app.name}: ${trail.join(' / ')} must preserve navigation identity`);
        }
        routeKey = `page:${item.pageName}${item.params?.nav ? `?nav=${item.params.nav}` : ''}`;
        if (actualPolished.has(areaKey) && !groupIds.includes('business_settings')) {
          actualPolished.get(areaKey).add(item.pageName);
          assert.ok(polished.get(areaKey).has(item.pageName), `${areaKey}: ${item.pageName} 未加入 page-polish 清单`);
        }
      } else if (item.type === 'object') {
        assert.ok(objectNames.has(item.objectName), `${app.name}: ${trail.join(' / ')} targets missing Object ${item.objectName}`);
        routeKey = `object:${item.objectName}:${item.recordId ?? ''}:${item.viewName ?? ''}:${JSON.stringify(item.filters ?? {})}`;
      } else if (item.type === 'dashboard') routeKey = `dashboard:${item.dashboardName}`;
      else if (item.type === 'report') routeKey = `report:${item.reportName}`;
      else if (item.type === 'component') routeKey = `component:${item.componentRef}:${JSON.stringify(item.params ?? {})}`;
      else if (item.type === 'url') routeKey = `url:${item.url}`;
      else continue;

      const previous = routeKeys.get(routeKey);
      assert.equal(previous, undefined, `${app.name}: ${trail.join(' / ')} shares route ${routeKey} with ${previous}`);
      routeKeys.set(routeKey, trail.join(' / '));
    }
  }
  assert.ok(packageId.startsWith('com.inoforge.forge.'), `${app.name} is not owned by a business package`);
}

for (const pageName of polished.get('sales')) {
  assert.ok(actualPolished.get('sales').has(pageName), `sales: ${pageName} 不在当前销售导航中`);
}
assert.equal(actualPolished.get('finance').has('page_finance_gap'), false, '财务导航仍指向空白占位页');
console.log(`PASS ${count} 个七应用菜单入口在编译产物中有唯一导航身份；销售与财务 Page 纳入交付清单。此检查不证明业务动作可用`);
