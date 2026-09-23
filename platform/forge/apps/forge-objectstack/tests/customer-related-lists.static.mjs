import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const fixture = JSON.parse(await readFile(new URL('./fixtures/customer-related-list-disposition.json', import.meta.url), 'utf8'));
assert.equal(fixture.sourceObject, 'forge_customer');
assert.equal(fixture.entries.length, 41, 'all reviewed customer reverse lookups must have a disposition');
assert.equal(new Set(fixture.entries.map((entry) => entry.objectName)).size, 41, 'each reverse lookup object appears once');
assert.equal(fixture.sourceCommit, '394d060835f18d3d02a37930c94a17a254af4dc9');
const expectedVisibleGroups = new Map([
  ['forge_contact', '联系人'],
  ['forge_sales_follow_up', '跟进'],
  ['forge_sales_opportunity', '商机'],
  ['forge_quotation', '报价'],
  ['forge_sales_contract', '合同'],
  ['forge_sales_order', '订单'],
  ['forge_project', '项目'],
  ['forge_service_order', '售后工单'],
]);
const visibleEntries = fixture.entries.filter((entry) => entry.disposition === 'keep');
assert.equal(visibleEntries.length, 8, 'customer detail must show only the eight approved business groups');
assert.deepEqual(
  Object.fromEntries(visibleEntries.map((entry) => [entry.objectName, entry.relatedListTitle])),
  Object.fromEntries(expectedVisibleGroups),
  'the visible customer groups and titles must match the product decision exactly',
);
assert.equal(fixture.entries.filter((entry) => entry.disposition === 'hide').length, 33);

const objectDir = new URL('../src/objects/', import.meta.url);
const sources = new Map();
for (const name of await readdir(objectDir)) {
  if (name.endsWith('.object.ts')) sources.set(name, await readFile(new URL(name, objectDir), 'utf8'));
}

function objectChunks(source) {
  return source.split(/(?=export const \w+\s*=)/).flatMap((text) => {
    const declaration = text.match(/export const (\w+)\s*=/)?.[1];
    if (!declaration) return [];
    const name = text.match(/name:\s*'([^']+)'/)?.[1]
      ?? text.match(/=\s*(?:master|dictionary)\('([^']+)'/)?.[1];
    return name ? [{ name, text }] : [];
  });
}

const sourceEntries = [];
for (const [file, source] of sources) {
  for (const object of objectChunks(source)) {
    const links = [...object.text.matchAll(/(\w+)\s*:\s*(?:\{\s*\.\.\.reference\('forge_customer'|\{\s*\.\.\.Field\.lookup\('forge_customer')/g)];
    for (const link of links) sourceEntries.push({ objectName: object.name, referenceField: link[1], file, text: object.text });
  }
}
assert.equal(sourceEntries.length, 41, 'the object metadata must still contain all 41 source fields');
const owningApplicationByFile = {
  'administration.object.ts': 'administration',
  'bom.object.ts': 'supply_chain',
  'customer.object.ts': 'sales',
  'drawing.object.ts': 'production',
  'finance.object.ts': 'finance',
  'inventory.object.ts': 'supply_chain',
  'opening-balance.object.ts': 'finance',
  'procurement.object.ts': 'supply_chain',
  'project.object.ts': 'project',
  'sales.object.ts': 'sales',
};

for (const entry of fixture.entries) {
  const source = sourceEntries.find((candidate) => candidate.objectName === entry.objectName && candidate.referenceField === entry.referenceField);
  assert.ok(source, `${entry.objectName}.${entry.referenceField} must remain registered`);
  assert.equal(entry.owningApplication, owningApplicationByFile[source.file], `${entry.objectName} must stay discoverable in its owning application`);
  const start = source.text.indexOf(`${entry.referenceField}:`);
  const fieldText = source.text.slice(start, start + 1000);
  if (entry.disposition === 'hide') {
    assert.match(fieldText, /relatedList:\s*false/, `${entry.objectName} must suppress this non-customer list`);
    assert.ok(!fieldText.includes('relatedListTitle') && !fieldText.includes('relatedListColumns'));
    assert.match(entry.reason, /应用/);
    continue;
  }

  assert.match(fieldText, /relatedList:\s*true/);
  assert.ok(fieldText.includes(`relatedListTitle: '${entry.relatedListTitle}'`), `${entry.objectName} needs its reviewed Chinese title`);
  assert.match(entry.relatedListTitle, /[\u4e00-\u9fff]/, `${entry.objectName} related-list title must be human-readable Chinese`);
  assert.deepEqual(entry.relatedListColumns.filter((column) => /(^id$|_id$|uuid|primary_key)/i.test(column)), [], `${entry.objectName} must not expose key fields`);
  for (const column of entry.relatedListColumns) assert.ok(fieldText.includes(`"${column}"`), `${entry.objectName} is missing readable column ${column}`);
}

if (process.env.OBJECTSTACK_BUILD_ARTIFACT) {
  const artifact = JSON.parse(await readFile(process.env.OBJECTSTACK_BUILD_ARTIFACT, 'utf8'));
  const bundles = artifact.plugins.map((plugin) => plugin.bundle ?? plugin);
  const ownersByObject = new Map();
  for (const bundle of bundles) {
    for (const object of bundle.objects ?? []) {
      const owners = ownersByObject.get(object.name) ?? [];
      owners.push(bundle.manifest?.id);
      ownersByObject.set(object.name, owners);
    }
  }
  const core = bundles.find((bundle) => bundle.manifest?.id === 'forge');
  const coreObjects = new Map((core?.objects ?? []).map((object) => [object.name, object]));
  for (const entry of fixture.entries) {
    assert.deepEqual(ownersByObject.get(entry.objectName), ['forge'], `${entry.objectName} must remain uniquely registered in the shared core`);
    const object = coreObjects.get(entry.objectName);
    const field = object?.fields?.[entry.referenceField];
    assert.ok(field, `${entry.objectName}.${entry.referenceField} must survive the build`);
    if (entry.disposition === 'hide') {
      assert.equal(field.relatedList, false);
    } else {
      assert.equal(field.relatedList, true);
      assert.equal(field.relatedListTitle, entry.relatedListTitle);
      assert.deepEqual(field.relatedListColumns, entry.relatedListColumns);
      for (const column of entry.relatedListColumns) assert.ok(object.fields[column], `${entry.objectName} column ${column} must exist`);
    }
  }
}

console.log(`Customer related lists: ${fixture.entries.filter((entry) => entry.disposition === 'keep').length} retained, ${fixture.entries.filter((entry) => entry.disposition === 'hide').length} hidden; all 41 lookup fields remain.`);
