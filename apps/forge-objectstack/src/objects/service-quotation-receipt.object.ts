import { Field, ObjectSchema } from '@objectstack/spec/data';

const required = { required: true, storage: { notNull: true } } as const;

/** Permanent idempotency and result receipt for an authorized service-quotation draft save. */
export const ServiceQuotationDraftReceipt = ObjectSchema.create({
  name: 'forge_service_quotation_draft_receipt',
  label: '服务报价草稿保存回执',
  pluralLabel: '服务报价草稿保存回执',
  icon: 'receipt-text',
  nameField: 'name',
  sharingModel: 'controlled_by_parent',
  managedBy: 'append-only',
  lifecycle: { class: 'record' },
  fields: {
    name: Field.text({ label: '保存回执', maxLength: 255, ...required }),
    quotation_id: Field.masterDetail('forge_service_quotation', {
      label: '服务报价',
      deleteBehavior: 'restrict',
      relatedList: false,
      ...required,
    }),
    actor_id: Field.user({ label: '操作人', readonly: true, hidden: true, ...required }),
    expected_revision: Field.number({ label: '请求版本', min: 1, scale: 0, readonly: true, hidden: true, ...required }),
    resulting_revision: Field.number({ label: '保存后版本', min: 1, scale: 0, readonly: true, hidden: true, ...required }),
    idempotency_key: Field.text({ label: '请求标识', maxLength: 128, readonly: true, hidden: true, ...required }),
    request_signature: Field.textarea({ label: '请求内容签名', readonly: true, hidden: true, ...required }),
    result_json: Field.textarea({ label: '保存结果', readonly: true, hidden: true, ...required }),
  },
  indexes: [
    { fields: ['quotation_id', 'expected_revision'], unique: 'organization' },
    { fields: ['quotation_id', 'idempotency_key'], unique: 'organization' },
  ],
  enable: {
    apiEnabled: true,
    apiMethods: ['get', 'list'],
    searchable: false,
    trackHistory: true,
    files: false,
    feeds: false,
    activities: false,
  },
});
