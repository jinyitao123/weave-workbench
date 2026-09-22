import { Field, ObjectSchema } from '@objectstack/spec/data';
import { required } from '../model.js';

const option = (value: string, label: string) => ({ value, label });

/**
 * Generic employee continuation created by any business flow or Weave run.
 * Business objects keep their own state; this record only owns assignment,
 * revision context and the employee-facing continuation lifecycle.
 */
export const EmployeeWorkItem = ObjectSchema.create({
  name: 'forge_employee_work_item',
  label: '员工工作事项',
  pluralLabel: '员工工作事项',
  icon: 'list-checks',
  sharingModel: 'private',
  nameField: 'title',
  fields: {
    title: Field.text({ label: '事项标题', maxLength: 300, ...required }),
    kind: Field.select([
      option('result', '处理结果'), option('failure', '处理失败'),
      option('revision_required', '退回修改'), option('human_review', '人工复核'),
    ], { label: '事项类型', ...required }),
    status: Field.select([
      option('unread', '未读'), option('pending', '待处理'), option('in_progress', '处理中'),
      option('completed', '已完成'), option('cancelled', '已取消'),
    ], { label: '事项状态', defaultValue: 'pending', ...required }),
    assignee_id: Field.user({ label: '处理员工', ...required }),
    initiator_id: Field.user({ label: '发起员工' }),
    summary: Field.textarea({ label: '工作摘要' }),
    instructions: Field.textarea({ label: '处理要求' }),
    source_system: Field.select([option('weave', 'Weave'), option('forge', 'Forge')], { label: '来源系统', ...required }),
    source_work_ref: Field.text({ label: '原工作引用', maxLength: 512, ...required }),
    source_run_ref: Field.text({ label: '原运行引用', maxLength: 512 }),
    source_session_ref: Field.text({ label: '原会话引用', maxLength: 512 }),
    idempotency_key: Field.text({ label: '幂等键', maxLength: 256, ...required }),
    material_version: Field.text({ label: '材料版本', maxLength: 128 }),
    material_ref: Field.text({ label: '材料引用', maxLength: 512 }),
    material_sha256: Field.text({ label: '材料摘要', maxLength: 64 }),
    material_label: Field.text({ label: '材料名称', maxLength: 300 }),
    parent_item_ref: Field.text({ label: '上一个事项引用', maxLength: 512 }),
    return_reason: Field.textarea({ label: '退回原因' }),
    return_target: Field.select([
      option('origin_review', '原复核位置'), option('team', '原团队'),
      option('member', '指定成员'), option('human_step', '指定人工步骤'),
    ], { label: '返回位置' }),
    target_ref: Field.text({ label: '返回目标引用', maxLength: 512 }),
    review_scope: Field.select([
      option('whole_team', '整团队复核'), option('affected_members', '受影响成员复核'), option('human_step', '人工步骤复核'),
    ], { label: '复核范围' }),
    due_at: Field.datetime({ label: '处理期限' }),
  },
  searchableFields: ['title', 'summary', 'instructions', 'material_label'],
  listViews: {
    pending: { label: '待处理', type: 'grid', columns: ['title', 'kind', 'assignee_id', 'status', 'material_label', 'due_at'] },
    all: { label: '全部', type: 'grid', columns: ['title', 'kind', 'assignee_id', 'status', 'source_system', 'material_label'] },
  },
  indexes: [
    { fields: ['idempotency_key'], unique: 'organization' },
    { fields: ['assignee_id', 'status'] },
    { fields: ['source_system', 'source_work_ref'] },
  ],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});
