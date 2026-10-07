import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeProjectTaskImportCsv, PROJECT_TASK_IMPORT_MAPPING } from '../src/pages/project-task-import.logic.ts';

const context = {
  projectId: 'project-a', planId: 'plan-a', organizationId: 'org-a',
  taskTypes: [
    { id: 'type-a', name: '测试验证', code: 'test', organization_id: 'org-a', enabled: true },
    { id: 'type-foreign', name: '外部类别', code: 'foreign', organization_id: 'org-b', enabled: true },
    { id: 'type-disabled', name: '停用类别', code: 'disabled', organization_id: 'org-a', enabled: false },
  ],
  members: [
    { id: 'member-a', name: '项目成员甲', user_id: 'user-a', project_id: 'project-a', active: true, member_duty: 'member' },
    { id: 'member-inactive', name: '停用成员', user_id: 'user-inactive', project_id: 'project-a', active: false, member_duty: 'member' },
    { id: 'member-other', name: '其他项目成员', user_id: 'user-other', project_id: 'project-b', active: true, member_duty: 'member' },
  ],
  phases: [{ id: 'phase-a', name: '接口阶段', plan_id: 'plan-a', project_id: 'project-a', item_type: 'phase' }],
};
const header = ['任务标题','详细描述','任务类别','负责人','优先级','计划开始','计划结束','预估工时','所属阶段'];
const row = ['现场接口检查','完成前核对协议','测试验证','项目成员甲','高','2026-10-04','2026-10-06','6.5','接口阶段'];
const csv = (headers, values) => [headers, ...values].map(values => values.map(value => '"' + String(value ?? '').replaceAll('"','""') + '"').join(',')).join('\r\n');

test('task import resolves visible project references and pins the selected project and plan', () => {
  const result = normalizeProjectTaskImportCsv({ ...context, csv: csv(header, [row]) });
  assert.equal(result.rowCount, 1);
  const [headerRow, taskRow] = result.csv.split('\r\n').map(line => line.match(/"(?:[^"]|"")*"/g).map(cell => cell.slice(1,-1).replaceAll('""','"')));
  assert.deepEqual(headerRow, Object.keys(PROJECT_TASK_IMPORT_MAPPING));
  assert.deepEqual(taskRow, ['project-a','plan-a','现场接口检查','完成前核对协议','type-a','user-a','high','2026-10-04','2026-10-06','6.5','phase-a']);
});

test('task import rejects protected lifecycle columns and unsupported input columns', () => {
  assert.throws(() => normalizeProjectTaskImportCsv({ ...context, csv: csv([...header, '状态'], [[...row, 'completed']]) }), /不支持的列/);
  assert.throws(() => normalizeProjectTaskImportCsv({ ...context, csv: csv([...header, '完成度'], [[...row, '100']]) }), /不支持的列/);
  assert.throws(() => normalizeProjectTaskImportCsv({ ...context, csv: csv([...header, '实际开始'], [[...row, '2026-10-04']]) }), /不支持的列/);
});

test('task import rejects categories or owners outside the active organization and project', () => {
  assert.throws(() => normalizeProjectTaskImportCsv({ ...context, csv: csv(header, [[...row.slice(0,2),'外部类别',...row.slice(3)]]) }), /找不到当前项目中唯一匹配的任务类别/);
  assert.throws(() => normalizeProjectTaskImportCsv({ ...context, csv: csv(header, [[...row.slice(0,3),'停用成员',...row.slice(4)]]) }), /找不到当前项目中唯一匹配的负责人/);
  assert.throws(() => normalizeProjectTaskImportCsv({ ...context, csv: csv(header, [[...row.slice(0,3),'其他项目成员',...row.slice(4)]]) }), /找不到当前项目中唯一匹配的负责人/);
  assert.throws(() => normalizeProjectTaskImportCsv({ ...context, csv: csv(header, [row]), members: [{ ...context.members[0], user_id: null }] }), /缺少当前项目成员账号关联/);
});

test('task import rejects duplicate rows, invalid dates, invalid hours, duplicate headers and unmatched phases', () => {
  assert.throws(() => normalizeProjectTaskImportCsv({ ...context, csv: csv(header, [row, row]) }), /CSV中存在同名任务/);
  assert.throws(() => normalizeProjectTaskImportCsv({ ...context, csv: csv(header, [[...row.slice(0,5), '2026/10/04', ...row.slice(6)]]) }), /计划日期无效/);
  assert.throws(() => normalizeProjectTaskImportCsv({ ...context, csv: csv(header, [[...row.slice(0,7), '-1', row[8]]]) }), /预估工时必须大于或等于零/);
  assert.throws(() => normalizeProjectTaskImportCsv({ ...context, csv: csv([...header, '任务标题'], [[...row, '重复']]) }), /不能重复/);
  assert.throws(() => normalizeProjectTaskImportCsv({ ...context, csv: csv(header, [[...row.slice(0,8), '不存在阶段']]) }), /找不到当前项目中唯一匹配的所属阶段/);
});
