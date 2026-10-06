import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
  projectTaskGanttHelpersSource,
  projectTaskGanttProjection,
} from '../src/pages/project-task-gantt.panel.ts';

function calendarParts(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

test('projects valid date-only rows in input order and pads the visible range by local calendar days', () => {
  const first = {
    id: 'task-2', name: '同日任务', item_key: 'TASK-2', planned_start_on: '2026-12-31', planned_end_on: '2026-12-31', progress: 0,
  };
  const second = {
    id: 'task-1', name: '', item_key: 'TASK-1', planned_start_on: '2027-01-02', planned_end_on: '2027-01-04', progress: 45,
  };
  const result = projectTaskGanttProjection([first, second]);

  assert.deepEqual(result.tasks.map(task => task.id), ['task-2', 'task-1']);
  assert.deepEqual(result.tasks.map(task => task.title), ['同日任务', 'TASK-1']);
  assert.deepEqual(calendarParts(result.tasks[0].start), [2026, 12, 31]);
  assert.deepEqual(calendarParts(result.tasks[0].end), [2026, 12, 31], 'same-day end dates remain unchanged');
  assert.equal(result.tasks[0].progress, 0, 'zero progress is a real value, not replaced by a minimum');
  assert.equal(result.tasks[1].progress, 45);
  assert.equal(result.tasks[0].data, first, 'the original filtered row is preserved for the click-through');
  assert.equal(result.tasks[0].locked, true);
  assert.deepEqual(calendarParts(result.startDate), [2026, 12, 28]);
  assert.deepEqual(calendarParts(result.endDate), [2027, 1, 11]);
  assert.deepEqual(result.unavailableRows, []);
  assert.equal(JSON.stringify(result).includes('task-2'), true, 'IDs stay in the internal projection for callbacks');
  assert.equal(result.tasks[0].title.includes(first.id), false, 'display title does not fall back to an internal ID');
});

test('keeps invalid or unclickable rows unavailable and never invents dates or progress', () => {
  const valid = { id: 'valid', item_key: 'WORK-1', planned_start_on: '2024-02-29', planned_end_on: '2024-03-01', progress: 100 };
  const invalidRows = [
    null,
    { name: '无标识', planned_start_on: '2026-01-01', planned_end_on: '2026-01-02', progress: 0 },
    { id: 'no-title', planned_start_on: '2026-01-01', planned_end_on: '2026-01-02', progress: 0 },
    { id: 'bad-start', name: '坏开始', planned_start_on: '2026-02-30', planned_end_on: '2026-03-01', progress: 0 },
    { id: 'bad-end', name: '坏结束', planned_start_on: '2026-03-01', planned_end_on: '2026-03-01T00:00:00Z', progress: 0 },
    { id: 'reverse', name: '倒序', planned_start_on: '2026-03-02', planned_end_on: '2026-03-01', progress: 0 },
    { id: 'missing-progress', name: '缺进度', planned_start_on: '2026-03-01', planned_end_on: '2026-03-02', progress: null },
    { id: 'string-progress', name: '字符串进度', planned_start_on: '2026-03-01', planned_end_on: '2026-03-02', progress: '10' },
    { id: 'invalid-progress', name: '越界进度', planned_start_on: '2026-03-01', planned_end_on: '2026-03-02', progress: 101 },
  ];
  const result = projectTaskGanttProjection([...invalidRows, valid]);

  assert.deepEqual(result.tasks.map(task => task.id), ['valid']);
  assert.deepEqual(result.unavailableRows.map(item => item.reason), [
    'invalid_row', 'missing_id', 'missing_title', 'invalid_start_date', 'invalid_end_date',
    'reversed_dates', 'invalid_progress', 'invalid_progress', 'invalid_progress',
  ]);
  assert.deepEqual(calendarParts(result.tasks[0].start), [2024, 2, 29], 'leap day remains a local calendar date');
  assert.deepEqual(calendarParts(result.startDate), [2024, 2, 26]);
  assert.deepEqual(calendarParts(result.endDate), [2024, 3, 8]);

  const empty = projectTaskGanttProjection([
    { id: 'invalid', name: '无有效日期', planned_start_on: '', planned_end_on: '', progress: 0 },
  ]);
  assert.equal(empty.startDate, null);
  assert.equal(empty.endDate, null);
  assert.deepEqual(empty.tasks, []);
  assert.equal(projectTaskGanttProjection(null).unavailableRows[0].reason, 'invalid_rows');
});

test('serialized helpers are self-contained and preserve date-only values when executed independently', () => {
  const context = {};
  vm.runInNewContext(`${projectTaskGanttHelpersSource}\nthis.projectTaskGanttProjection = projectTaskGanttProjection;`, context);
  assert.doesNotMatch(projectTaskGanttHelpersSource, /__name/);

  const result = context.projectTaskGanttProjection([{
    id: 'vm-task', name: 'VM任务', planned_start_on: '2026-10-05', planned_end_on: '2026-10-05', progress: 0,
  }]);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].title, 'VM任务');
  assert.deepEqual(calendarParts(result.tasks[0].start), [2026, 10, 5]);
  assert.deepEqual(calendarParts(result.tasks[0].end), [2026, 10, 5]);
  assert.deepEqual(calendarParts(result.startDate), [2026, 10, 2]);
  assert.deepEqual(calendarParts(result.endDate), [2026, 10, 12]);
});
