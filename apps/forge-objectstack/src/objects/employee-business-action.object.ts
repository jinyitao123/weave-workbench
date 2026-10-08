import { ObjectSchema } from '@objectstack/spec/data';

const hidden = { apiEnabled: false, apiMethods: [] as never[], searchable: false, feeds: false, activities: false, clone: false };
const text = (maxLength = 128) => ({ type: 'text' as const, required: true, maxLength });

/** A short-lived, employee-bound read result. It never grants business access. */
export const EmployeeBusinessContext = ObjectSchema.create({
  name: 'forge_employee_business_context', label: '本人动作上下文', pluralLabel: '本人动作上下文',
  icon: 'shield-check', nameField: 'name', sharingModel: 'private', enable: hidden,
  lifecycle: { class: 'transient', ttl: { field: 'expires_at', expireAfter: '1d' } },
  fields: {
    name: { ...text(), defaultValue: '本人业务动作上下文' },
    user_id: text(), organization_id: text(), object_name: text(), record_id: { type: 'text', maxLength: 128 },
    context_version: text(64), context_json: { type: 'textarea', required: true },
    expires_at: { type: 'datetime', required: true },
  },
});

/** Permanent idempotency truth, not a queue or a task state. Expiring these
 * receipts would allow an old request key to cause another business effect. */
export const EmployeeBusinessOperation = ObjectSchema.create({
  name: 'forge_employee_business_operation', label: '本人业务办理回执', pluralLabel: '本人业务办理回执',
  icon: 'receipt-text', nameField: 'name', sharingModel: 'private', enable: hidden,
  lifecycle: { class: 'record' },
  fields: {
    name: { ...text(), defaultValue: '本人业务办理回执' },
    operation_key: text(64), user_id: text(), organization_id: text(),
    context_id: text(64), request_digest: text(64), object_name: { type: 'text', maxLength: 128 }, record_id: { type: 'text', maxLength: 128 },
    action_name: { type: 'text', maxLength: 160 }, status: { type: 'select', required: true, options: [
      { value: 'in_progress', label: '正在办理' }, { value: 'succeeded', label: '已办理' },
      { value: 'failed', label: '未办理' }, { value: 'unknown', label: '结果待核对' },
    ] },
    result_json: { type: 'textarea', required: true },
    requested_at: { type: 'datetime', required: true },
    observed_at: { type: 'datetime', required: true },
  },
  indexes: [{ fields: ['organization_id', 'user_id', 'operation_key'], unique: 'global' }],
});
