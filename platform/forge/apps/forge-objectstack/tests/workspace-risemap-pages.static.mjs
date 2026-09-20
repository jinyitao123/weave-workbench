import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stack = JSON.parse(await readFile('dist/objectstack.json', 'utf8'));
const app = stack.apps.find((item) => item.name === 'forge');
const workspace = app.areas.find((area) => area.id === 'workspace');
const entries = workspace.navigation.find((item) => item.id === 'workspace_overview').children;

assert.deepEqual(
  entries.map(({ label, pageName }) => [label, pageName]),
  [
    ['工作台', 'page_workbench'],
    ['AI 广场', 'page_workspace_ai'],
    ['引导中心', 'page_onboarding_center'],
    ['待办管理', 'page_todo_management'],
  ],
  'workspace navigation follows the current RISEMAP entry order',
);

const pages = new Map(stack.pages.map((page) => [page.name, page]));
for (const name of entries.map((entry) => entry.pageName)) assert.ok(pages.has(name), `${name} exists`);
assert.match(pages.get('page_workspace_ai').source, /15 个场景|assistants=/, 'AI directory keeps the observed scene catalogue');
assert.match(pages.get('page_onboarding_center').source, /6 个阶段、25 个步骤/, 'onboarding keeps the current six-stage baseline');
assert.match(pages.get('page_todo_management').source, /新建待办/, 'todo management exposes a working creation entry');

const objects = new Map(stack.objects.map((object) => [object.name, object]));
assert.ok(objects.has('forge_personal_todo'), 'persistent todo object exists');
assert.ok(objects.has('forge_onboarding_progress'), 'persistent onboarding progress object exists');

console.log('PASS workbench, AI, onboarding and todo pages preserve the current RISEMAP workspace entry contract');
