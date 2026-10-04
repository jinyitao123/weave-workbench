import { Field, ObjectSchema } from '@objectstack/spec/data';

/**
 * Internal idempotency binding for the formal accepted-quotation conversion.
 * A contract's quotation_id also serves template imports and is intentionally
 * not unique. The contract remains the only source of its business state.
 */
export const QuotationContractConversion = ObjectSchema.create({
  name: 'forge_quotation_contract_conversion',
  label: '报价正式转换绑定',
  pluralLabel: '报价正式转换绑定',
  icon: 'file-check',
  sharingModel: 'private',
  nameField: 'name',
  fields: {
    name: Field.text({ label: '转换批次', required: true }),
    quotation_id: Field.lookup('forge_quotation', { label: '已接受报价', required: true }),
    contract_id: Field.lookup('forge_sales_contract', { label: '正式转换合同', required: true }),
    organization_id: Field.text({ label: '组织范围', maxLength: 128, readonly: true, hidden: true }),
    converted_by: Field.user({ label: '转换员工', required: true, readonly: true }),
    converted_at: Field.datetime({ label: '转换时间', required: true, readonly: true }),
    pricing_version: Field.number({ label: '接受核价版本', min: 0, scale: 0, required: true, readonly: true }),
    line_count: Field.number({ label: '转换明细条数', min: 1, scale: 0, required: true, readonly: true }),
    request_signature: Field.textarea({ label: '原始转换请求身份', required: true, readonly: true, hidden: true }),
    acceptance_file_id: Field.text({ label: '接受凭证引用', maxLength: 128, required: true, readonly: true, hidden: true }),
  },
  indexes: [
    { fields: ['quotation_id'], unique: 'organization' },
    { fields: ['contract_id'], unique: 'organization' },
  ],
  enable: { apiEnabled: false, searchable: false, trackHistory: true, files: false, feeds: false, activities: false },
});
