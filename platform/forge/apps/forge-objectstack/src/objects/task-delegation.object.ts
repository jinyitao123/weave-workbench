import { Field, ObjectSchema } from '@objectstack/spec/data';
import { text, required } from '../model.js';

// Decision 002 (weave-workbench): one Forge-issued task delegation per frozen
// Workbench input. The credential is a separate native session for the same
// employee; only its SHA-256 is kept here. Scope is enforced by the
// task-delegation plugin, never by this record's visibility.
export const TaskDelegation = ObjectSchema.create({
  name: 'forge_task_delegation',
  label: '团队任务委托',
  pluralLabel: '团队任务委托',
  icon: 'key-round',
  sharingModel: 'private',
  nameField: 'name',
  fields: {
    name: text('委托批次', true),
    delegation_id: Field.text({ label: '委托标识', ...required, maxLength: 64, hidden: true, readonly: true }),
    organization_id: Field.text({ label: '组织范围', ...required, maxLength: 128, hidden: true, readonly: true }),
    employee_id: Field.user({ label: '委托员工', ...required }),
    session_id: Field.text({ label: '任务会话', ...required, maxLength: 128, hidden: true, readonly: true }),
    token_sha256: Field.text({ label: '任务凭据摘要', ...required, maxLength: 64, hidden: true, readonly: true }),
    idempotency_key: Field.text({ label: '登记请求键', ...required, maxLength: 64, hidden: true, readonly: true }),
    input_digest: Field.text({ label: '固定输入摘要', ...required, maxLength: 64, hidden: true, readonly: true }),
    scope_json: Field.textarea({ label: '委托范围', ...required, readonly: true }),
    issued_at: Field.datetime({ label: '签发时间', ...required }),
    expires_at: Field.datetime({ label: '到期时间', ...required }),
    revoked_at: Field.datetime({ label: '撤销时间', readonly: true }),
    revocation_reason: Field.select([
      { value: 'run_terminal', label: '团队运行结束' },
      { value: 'employee_cancel', label: '员工取消工作' },
      { value: 'superseded', label: '重新登记后替换' },
    ], { label: '撤销原因', readonly: true }),
  },
  listViews: { all: { label: '全部记录', type: 'grid', columns: ['name', 'employee_id', 'issued_at', 'expires_at', 'revoked_at'] } },
  indexes: [
    { fields: ['delegation_id'], unique: 'organization' },
    { fields: ['idempotency_key'], unique: 'organization' },
    { fields: ['token_sha256'], unique: 'global' },
  ],
  enable: { apiEnabled: false, searchable: false, trackHistory: true, files: false, feeds: false, activities: false },
});
