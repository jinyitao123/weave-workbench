import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile('src/pages/approval-center.page.ts', 'utf8');
const objects = await readFile('src/objects/administration.object.ts', 'utf8');
const index = await readFile('src/pages/index.ts', 'utf8');

for (const name of ['page_my_approvals', 'page_cc_to_me', 'page_initiated_by_me']) {
  assert.match(page, new RegExp(`name: '${name}'`), `${name} must be implemented by the dedicated approval page`);
}
for (const object of ['forge_approval_instance', 'forge_approval_task', 'forge_approval_cc']) {
  assert.match(objects, new RegExp(`name: '${object}'`), `${object} must have a dedicated persistence model`);
  assert.match(page, new RegExp(`/data/${object}`), `${object} must be read or written by the page`);
}
for (const action of ['办理审批任务', '转办审批任务', '全部标记已读', '发起审批']) {
  assert.match(page, new RegExp(action), `${action} must be a visible, wired interaction`);
}
assert.match(page, /ForgePageHeader/);
assert.match(page, /ForgeSelectControl/);
assert.match(page, /ForgeDateInput/);
assert.match(page, /ForgeDialog/);
assert.doesNotMatch(page, /window\.alert|window\.confirm|<select/);
assert.match(index, /approval-center\.page\.js/);

console.log(JSON.stringify({ suite: 'approval-center-static', pages: 3, objects: 3, status: 'passed' }, null, 2));
