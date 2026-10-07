import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertSalesPageCoverage } from './navigation-linkage.static.mjs';

const artifact = JSON.parse(await readFile(new URL('../dist/objectstack.json', import.meta.url), 'utf8'));
const sales = artifact.plugins.find(plugin => plugin.bundle?.manifest?.id === 'com.inoforge.forge.sales').bundle;
const owners = new Map(sales.pages.map(page => [page.name, sales.manifest.id]));
const sources = new Map(sales.pages.map(page => [page.name, page.source ?? '']));
const menuPages = new Set();
function collect(items) {
  for (const item of items ?? []) {
    if (item.type === 'group') collect(item.children);
    else if (item.type === 'page') menuPages.add(item.pageName);
  }
}
for (const app of sales.apps) for (const area of app.areas) collect(area.navigation);

for (const [target, parent] of [
  ['page_sales_order_create', 'page_sales_order_workspace'],
  ['page_service_order_create', 'page_service_orders'],
]) {
  test(`${target} is registered and reachable without becoming a menu item`, () => {
    assert.equal(menuPages.has(target), false);
    assert.doesNotThrow(() => assertSalesPageCoverage(target, menuPages, owners, sources));
  });

  test(`${target} cannot pass with missing registration, wrong ownership or a missing parent menu`, () => {
    const missing = new Map(owners);
    missing.delete(target);
    assert.throws(() => assertSalesPageCoverage(target, menuPages, missing, sources), /must be registered in Sales/);
    missing.set(target, 'com.inoforge.forge.project');
    assert.throws(() => assertSalesPageCoverage(target, menuPages, missing, sources), /must be registered in Sales/);
    const wrongParent = new Map(owners);
    wrongParent.set(parent, 'com.inoforge.forge.project');
    assert.throws(() => assertSalesPageCoverage(target, menuPages, wrongParent, sources), /entry Page .* must be owned by Sales/);
    const noParentMenu = new Set(menuPages);
    noParentMenu.delete(parent);
    assert.throws(() => assertSalesPageCoverage(target, noParentMenu, owners, sources), /must remain reachable from menu Page/);
  });

  test(`${target} route catalogue membership cannot replace its actual create entry`, () => {
    const broken = new Map(sources);
    // Preserve the shared catalogue's target name while removing all calls from this page to it.
    const source = sources.get(parent)
      .replaceAll(`forgePageHref('${target}')`, "forgePageHref('page_missing_create')")
      .replaceAll(`ForgeNavigate('/apps/com.inoforge.forge.sales/${target}')`, "ForgeNavigate('/apps/com.inoforge.forge.sales/page_missing_create')");
    assert.ok(source.includes(`"${target}":1`), 'the compiled shared route catalogue remains present');
    broken.set(parent, source);
    assert.throws(() => assertSalesPageCoverage(target, menuPages, owners, broken), /is missing its create entry/);
  });
}

test('an arbitrary registered sales page is not silently admitted as an internal flow', () => {
  assert.throws(() => assertSalesPageCoverage('page_unlinked_example', menuPages,
    new Map([...owners, ['page_unlinked_example', sales.manifest.id]]), sources), /已知内部流程入口/);
});
