import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { numericColumnFor } from '@objectstack/spec/data';
import * as objects from '../src/objects/index.ts';

const path = new URL('./schema/numeric-value-columns.sql', import.meta.url);
const previous = await readFile(path, 'utf8');
const columns = new Set();
for (const object of Object.values(objects)) {
  if (!object?.name?.startsWith('forge_') || !object.fields) continue;
  for (const [name, field] of Object.entries(object.fields)) {
    if (numericColumnFor(field.type)?.kind === 'exact') columns.add(`${object.name}\0${name}`);
  }
}
const values = [...columns].sort().map(value => {
  const [object, field] = value.split('\0');
  assert.match(object, /^[a-z][a-z0-9_]*$/);
  assert.match(field, /^[a-z][a-z0-9_]*$/);
  return `    ('${object}', '${field}')`;
}).join(',\n');
const next = previous.replace(/(FROM \(VALUES\n)[\s\S]*?(\n    \) AS target\(table_name, column_name\))/, `$1${values}$2`);
assert.notEqual(next.indexOf(values), -1, 'Numeric migration template must contain its field plan.');
if (process.argv.includes('--check')) {
  assert.equal(previous, next, 'Numeric migration field plan differs from the registered Forge schema.');
  console.log(`Numeric migration plan covers ${columns.size} exact-value fields in the current Forge schema.`);
} else {
  await writeFile(path, next);
  console.log(`Refreshed numeric migration plan from ${columns.size} current Forge fields.`);
}
