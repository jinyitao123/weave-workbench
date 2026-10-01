import { ObjectSchema } from '@objectstack/spec/data';

/** Business authority for one frozen task, never an employee login session. */
export const TaskDelegation = ObjectSchema.create({
  name: 'forge_task_delegation',
  label: '任务授权',
  pluralLabel: '任务授权',
  icon: 'key-round',
  nameField: 'name',
  sharingModel: 'private',
  enable: { apiEnabled: false, apiMethods: [], searchable: false, feeds: false, activities: false, clone: false },
  fields: {
    name: { type: 'text', required: true, defaultValue: '任务授权' },
    request_hash: { type: 'text', required: true, maxLength: 64 },
    grant_key: { type: 'text', required: true, maxLength: 64 },
    scope_sha256: { type: 'text', required: true, maxLength: 64 },
    scope_json: { type: 'textarea', required: true },
    user_id: { type: 'text', required: true, maxLength: 128 },
    organization_id: { type: 'text', required: true, maxLength: 128 },
    // Plain references deliberately have no FK: revoking/deleting the native
    // parent session must never be prevented by an authorization audit record.
    source_session_id: { type: 'text', required: true, maxLength: 128 },
    input_revision_id: { type: 'text', required: true, maxLength: 128 },
    generation: { type: 'number', required: true },
    // Existing rows are confirmed. New issuances explicitly start pending.
    issuance_pending: { type: 'boolean', defaultValue: false },
    issued_at: { type: 'datetime', required: true },
    expires_at: { type: 'datetime', required: true },
    revoked_at: { type: 'datetime' },
    revocation_reason: { type: 'text', maxLength: 32 },
  },
  indexes: [
    { fields: ['request_hash'], unique: 'global' },
    { fields: ['grant_key', 'generation'], unique: 'global' },
  ],
});
