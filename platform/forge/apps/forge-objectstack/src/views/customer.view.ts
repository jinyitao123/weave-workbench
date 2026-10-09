import { defineView } from '@objectstack/spec';

/** Curated presentation; field types, defaults, validation and access remain on the object. */
export const CustomerViews = defineView({
  object: 'forge_customer',
  form: {
    type: 'simple',
    data: { provider: 'object', object: 'forge_customer' },
    columns: 4,
    sections: [
      { columns: 4, fields: ['customer_type'] },
      {
        name: 'company', label: '工商信息', columns: 4, collapsible: true,
        fields: [
          { field: 'name', colSpan: 2 }, 'credit_code', 'legal_representative',
          'registered_capital', 'established_on', 'enterprise_scale', 'website',
          { field: 'business_scope', span: 'full' },
        ],
      },
      {
        name: 'profile', label: '客户资料', columns: 4, collapsible: true,
        fields: ['category_id', 'level_id', 'industry', 'responsible_id', { field: 'description', span: 'full' }],
      },
      {
        name: 'invoicing', label: '开票信息', columns: 4, collapsible: true,
        fields: ['invoice_type', 'tax_number', 'bank_name', 'bank_account', { field: 'invoice_address', colSpan: 2 }, 'invoice_phone'],
      },
      {
        name: 'commercial', label: '商务条件', columns: 4, collapsible: true,
        fields: ['payment_term', 'revenue_recognition', 'credit_limit', 'payment_days', 'credit_status'],
      },
      {
        name: 'address', label: '商务信息', columns: 4, collapsible: true,
        fields: [{ field: 'address', colSpan: 2 }, 'province', 'city', { field: 'remarks', span: 'full' }],
      },
    ],
  },
});

/** Contact storage and lifecycle stay on Contact; this view selects its compact editor. */
export const ContactViews = defineView({
  object: 'forge_contact',
  form: {
    type: 'simple',
    data: { provider: 'object', object: 'forge_contact' },
    columns: 4,
    sections: [
      { name: 'contact_context', label: '所属客户与任职', columns: 4,
        fields: ['customer_id', 'is_primary', 'employment_status', 'responsible_id'] },
      { name: 'contact_information', label: '联系人信息', columns: 4,
        fields: [
          'name', 'job_title', 'gender', 'department', 'decision_weight',
          { field: 'remarks', widget: 'input', colSpan: 3 },
        ] },
    ],
  },
});
