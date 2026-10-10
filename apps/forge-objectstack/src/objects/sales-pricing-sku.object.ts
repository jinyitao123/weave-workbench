import { ObjectSchema, Field } from '@objectstack/spec/data';
import { MaterialSku as baseSku } from './material.object.js';

/** The canonical catalog price remains on the supply-chain SKU. */
export const MaterialSku = ObjectSchema.create({
  ...baseSku,
  fields: {
    ...baseSku.fields,
    minimum_sale_price: Field.currency({ label: '最低含税售价', precision: 18, min: 0, readonly: true }),
    suggested_sale_price: Field.currency({ label: '建议含税售价', precision: 18, min: 0, readonly: true }),
    sale_price_revision: Field.number({ label: '销售价格版本', scale: 0, min: 0, hidden: true, readonly: true }),
  },
});
