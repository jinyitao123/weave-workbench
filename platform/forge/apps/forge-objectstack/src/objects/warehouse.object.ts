import { Field } from '@objectstack/spec/data';
import { master, text, reference, owner, remarks, required } from '../model.js';

export const Warehouse = master('forge_warehouse', '仓库管理', 'warehouse', {
  name: text('仓库名称', true), code: text('仓库编码'), type_id: reference('forge_warehouse_type', '仓库类型', true),
  responsible_id: owner(true), phone: text('联系电话', true), area: Field.number({ label: '面积（㎡）', ...required }),
  address: text('仓库地址', true), remarks: remarks(),
}, ['code', 'name', 'type_id', 'responsible_id', 'phone', 'area', 'address']);
