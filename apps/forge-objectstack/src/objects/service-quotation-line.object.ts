import { Field, ObjectSchema } from '@objectstack/spec/data';

const required = { required: true, storage: { notNull: true } } as const;
const money = (label: string) => Field.currency({ label, min: 0, readonly: true, currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'CNY' } });

/** Line snapshots owned by the existing service quotation; all mutations use its business Action. */
export const ServiceQuotationLine = ObjectSchema.create({
  name: 'forge_service_quotation_line', label: '服务报价项目', pluralLabel: '服务报价项目', icon: 'list', nameField: 'name',
  sharingModel: 'controlled_by_parent', lifecycle: { class: 'record' },
  fields: {
    name: Field.text({ label: '项目名称', maxLength: 255, readonly: true, ...required }),
    quotation_id: Field.masterDetail('forge_service_quotation', { label: '服务报价', deleteBehavior: 'restrict', relatedList: false, readonly: true, ...required }),
    line_type: Field.select([{ value: 'service', label: '服务费' }, { value: 'part', label: '备件' }], { label: '类别', readonly: true, ...required }),
    service_item_id: Field.lookup('forge_service_config_item', { label: '收费项目', relatedList: false, readonly: true }),
    sku_id: Field.lookup('forge_material_sku', { label: '备件规格', relatedList: false, readonly: true }),
    item_code: Field.text({ label: '项目编码', maxLength: 100, readonly: true }),
    description: Field.textarea({ label: '规格 / 说明', readonly: true }),
    unit_name: Field.text({ label: '单位', maxLength: 50, readonly: true, ...required }),
    quantity: Field.number({ label: '数量', min: 0.01, scale: 2, readonly: true, ...required }),
    taxed_unit_price: { ...money('含税单价'), ...required },
    line_amount: { ...money('金额'), ...required },
    sort_order: Field.number({ label: '顺序', min: 0, scale: 0, readonly: true, ...required }),
  },
  highlightFields: ['line_type', 'name', 'description', 'unit_name', 'quantity', 'taxed_unit_price', 'line_amount'],
  indexes: [{ fields: ['quotation_id', 'sort_order'], unique: 'organization' }],
  enable: { apiEnabled: true, apiMethods: ['get', 'list'], searchable: false, trackHistory: true, files: false, feeds: false, activities: false },
});
