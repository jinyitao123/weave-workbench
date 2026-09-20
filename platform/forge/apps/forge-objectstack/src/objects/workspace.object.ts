import { P } from '@objectstack/spec';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { required, text } from '../model.js';

const select = (label: string, options: Array<[string, string]>, defaultValue: string) => Field.select(
  options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
  { label, defaultValue },
);

export const PersonalTodo = ObjectSchema.create({
  name: 'forge_personal_todo',
  label: '待办任务',
  pluralLabel: '待办任务',
  icon: 'list-todo',
  sharingModel: 'private',
  nameField: 'name',
  searchableFields: ['name', 'description', 'latest_update'],
  fields: {
    name: text('待办内容', true),
    description: Field.textarea({ label: '任务说明' }),
    owner_id: Field.user({ label: '创建人', ...required }),
    assignee_id: Field.user({ label: '负责人', ...required }),
    follower_ids: Field.lookup('sys_user', { label: '关注人', multiple: true, relatedList: false }),
    due_on: Field.date({ label: '截止日期', ...required }),
    priority: select('优先级', [['high', '高'], ['medium', '中'], ['low', '低']], 'medium'),
    status: select('状态', [['pending', '待处理'], ['in_progress', '进行中'], ['completed', '已完成'], ['cancelled', '已取消']], 'pending'),
    progress: Field.number({ label: '进度', min: 0, max: 100, scale: 0, defaultValue: 0 }),
    latest_update: Field.textarea({ label: '最新进度说明' }),
    completed_at: Field.datetime({
      label: '完成时间',
      visibleWhen: P`record.status == 'completed'`,
      requiredWhen: P`record.status == 'completed'`,
    }),
  },
  validations: [{
    type: 'state_machine',
    name: 'personal_todo_lifecycle',
    field: 'status',
    initialStates: ['pending'],
    transitions: {
      pending: ['in_progress', 'completed', 'cancelled'],
      in_progress: ['pending', 'completed', 'cancelled'],
      completed: ['in_progress'],
      cancelled: ['pending'],
    },
    message: '待办状态流转不合法',
  }],
  listViews: {
    all: {
      label: '全部任务',
      type: 'grid',
      columns: ['name', 'latest_update', 'assignee_id', 'due_on', 'progress', 'priority', 'status'],
    },
  },
  indexes: [
    { fields: ['assignee_id', 'status', 'due_on'] },
    { fields: ['owner_id', 'status'] },
  ],
  enable: { apiEnabled: true, searchable: true, trackHistory: true },
});

export const OnboardingProgress = ObjectSchema.create({
  name: 'forge_onboarding_progress',
  label: '初始化步骤进度',
  pluralLabel: '初始化步骤进度',
  icon: 'list-checks',
  sharingModel: 'private',
  nameField: 'name',
  fields: {
    name: text('步骤标题', true),
    step_key: Field.text({ label: '步骤标识', ...required, maxLength: 80, unique: true }),
    owner_id: Field.user({ label: '操作人', ...required }),
    status: select('状态', [['completed', '已完成'], ['skipped', '已跳过']], 'completed'),
    completed_at: Field.datetime({ label: '处理时间', ...required }),
    note: Field.textarea({ label: '说明' }),
  },
  listViews: {
    all: { label: '全部进度', type: 'grid', columns: ['name', 'step_key', 'status', 'owner_id', 'completed_at'] },
  },
  indexes: [{ fields: ['owner_id', 'status'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true },
});
