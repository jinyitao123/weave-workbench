import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stack = JSON.parse(await readFile('dist/objectstack.json', 'utf8'));
const app = stack.apps.find((item) => item.name === 'forge');
assert.ok(app, 'Forge app exists');

const leaves = [];
const visit = (items, trail) => {
  for (const item of items || []) {
    if (item.type === 'group') visit(item.children, [...trail, item.label]);
    else leaves.push({ item, trail: [...trail, item.label] });
  }
};

for (const area of app.areas || []) visit(area.navigation, [area.label]);

const ids = new Map();
const routeKeys = new Map();
const pageNames = new Set(stack.pages.map((item) => item.name));

for (const { item, trail } of leaves) {
  assert.equal(ids.has(item.id), false, `duplicate navigation id ${item.id}`);
  ids.set(item.id, trail.join(' / '));

  let routeKey;
  if (item.type === 'page') {
    assert.ok(pageNames.has(item.pageName), `${trail.join(' / ')} targets missing page ${item.pageName}`);
    // The `nav` param exists only on placeholder pages that back several menu
    // entries; when present it must equal this entry's id.
    if (item.params?.nav !== undefined) assert.equal(item.params.nav, item.id, `${trail.join(' / ')} must preserve its navigation identity`);
    routeKey = item.params?.nav
      ? `page:${item.pageName}?nav=${item.params.nav}`
      : `page:${item.pageName}`;
  } else if (item.type === 'object') {
    routeKey = `object:${item.objectName}:${item.recordId || ''}:${item.viewName || ''}:${JSON.stringify(item.filters || {})}`;
  } else if (item.type === 'dashboard') routeKey = `dashboard:${item.dashboardName}`;
  else if (item.type === 'report') routeKey = `report:${item.reportName}`;
  else if (item.type === 'component') routeKey = `component:${item.componentRef}:${JSON.stringify(item.params || {})}`;
  else if (item.type === 'url') routeKey = `url:${item.url}`;
  else continue;

  const previous = routeKeys.get(routeKey);
  assert.equal(previous, undefined, `${trail.join(' / ')} shares route ${routeKey} with ${previous}`);
  routeKeys.set(routeKey, trail.join(' / '));
}

console.log(`PASS ${leaves.length} Forge menu entries have unique ids and route identities`);
