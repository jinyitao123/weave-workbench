import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile('src/pages/administration-workflow.page.ts', 'utf8');
const objects = await readFile('src/objects/administration.object.ts', 'utf8');

for (const name of ['page_administration_requests', 'page_approval_records', 'page_start_process', 'page_process_definitions', 'page_process_categories']) {
  assert.match(page, new RegExp(`name:'${name}'`), `${name} must use the dedicated implementation`);
}
for (const object of ['forge_process_category', 'forge_process_definition']) {
  assert.match(objects, new RegExp(`name: '${object}'`));
  assert.match(page, new RegExp(`/data/${object}`));
}
for (const label of ['加班申请', '请假申请', '出差申请', '用章申请', '公司用车', '资质续期']) assert.match(page, new RegExp(label));
for (const control of ['ForgePageHeader', 'ForgeSelectControl', 'ForgeDateInput', 'ForgeDialog', 'ForgeEmpty']) assert.match(page, new RegExp(control));
assert.match(page, /forge_approval_instance/);
assert.match(page, /forge_approval_task/);
assert.doesNotMatch(page, /window\.alert|window\.confirm|<select/);

console.log(JSON.stringify({ suite: 'administration-workflow-static', pages: 5, objects: 2, status: 'passed' }, null, 2));
