import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const api = await connect();
const records = (value) => value.records || value.data || [];
const todoResponse = await api.request('/data/forge_personal_todo?$top=100');
const progressResponse = await api.request('/data/forge_onboarding_progress?$top=100');

assert.equal(todoResponse.status, 200, 'todo records are readable through the API');
assert.equal(progressResponse.status, 200, 'onboarding progress is readable through the API');

const todo = records(todoResponse.value).find((item) => item.name === '工作台页面对照验收');
const progress = records(progressResponse.value).find((item) => item.step_key === 'company');
assert.ok(todo, 'browser-created todo survived restart');
assert.deepEqual(
  { status: todo.status, progress: Number(todo.progress), latest_update: todo.latest_update },
  { status: 'completed', progress: 100, latest_update: '任务已完成' },
  'todo state transition survived restart',
);
assert.ok(todo.completed_at, 'completed todo keeps its completion time');
assert.ok(progress, 'browser-created onboarding progress survived restart');
assert.equal(progress.status, 'completed', 'onboarding step keeps its completed status');

console.log('PASS browser-created workspace todo and onboarding progress survived full server restart');
