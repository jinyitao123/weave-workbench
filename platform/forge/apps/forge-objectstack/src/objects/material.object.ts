import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, choice, owner, remarks, status, money } from '../model.js';

// Prices belong to the SKU, per DP009/2071.
export const Material = master('forge_material', '物料管理', 'package', {
  name: text('物料名称', true), code: code('物料编码'), model: text('物料型号', true), barcode: text('物料条码'),
  category_id: reference('forge_material_category', '物料分类', true), brand: text('品牌'), purchase_category: text('采购分类'),
  unit_id: reference('forge_unit', '单位', true),
  property: choice('物料属性', ['原材料', '半成品', '成品', '贸易商品', '消耗品', '服务', '备件', '包装材料'], '原材料'),
  source_type: choice('来源类型', ['采购', '自制', '外协', '虚拟'], '采购'), status: status(),
  supplier_id: reference('forge_supplier', '默认供应商'), tax_category_code: text('税收分类编码'),
  warehouse_id: reference('forge_warehouse', '默认仓库'), responsible_id: owner(),
  loss_rate: Field.number({ label: '损耗率', defaultValue: 0 }), bom_enabled: Field.boolean({ label: '启用BOM', defaultValue: false }),
  batch_enabled: Field.boolean({ label: '启用批次管理', defaultValue: false }), trace_enabled: Field.boolean({ label: '启用追溯管理', defaultValue: false }),
  tags: text('标签'), remarks: remarks(),
}, ['code', 'name', 'model', 'category_id', 'unit_id', 'property', 'source_type', 'status']);

export const MaterialSku = master('forge_material_sku', '物料规格', 'boxes', {
  name: text('规格', true), code: code('SKU编码'), barcode: text('SKU条码'),
  material_id: reference('forge_material', '物料', true), sale_price: money('含税售价', 4), cost_price: money('含税成本价', 4),
  enabled: Field.boolean({ label: '启用', defaultValue: true }),
}, ['code', 'material_id', 'name', 'sale_price', 'cost_price', 'enabled']);

export const ProductBundle = master('forge_product_bundle', '物料组合', 'package-plus', {
  name: text('组合名称', true), code: code('组合编号'), tax_included: Field.boolean({ label: '含税', defaultValue: true }),
  tax_rate: Field.number({ label: '税率', min: 0, max: 100, scale: 2, defaultValue: 13 }),
  taxed_sale_price: money('含税销售价', 4), untaxed_sale_price: money('不含税销售价', 12),
  category_id: reference('forge_material_category', '物料分类'), brand: text('品牌'), model: text('型号'), specification: text('规格名称'),
  unit_id: reference('forge_unit', '单位'), description: Field.textarea({ label: '组合描述' }),
  material_count: Field.number({ label: '物料种类', min: 0, scale: 0, defaultValue: 0 }), reference_count: Field.number({ label: '引用次数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  status: status(), responsible_id: owner(), remarks: remarks(),
}, ['code', 'name', 'material_count', 'taxed_sale_price', 'untaxed_sale_price', 'status', 'reference_count', 'responsible_id']);

export const ProductBundleLine = master('forge_product_bundle_line', '物料组合明细', 'list', {
  name: text('物料名称快照', true), bundle_id: reference('forge_product_bundle', '物料组合', true),
  material_id: reference('forge_material', '物料', true), sku_id: reference('forge_material_sku', '物料规格', true),
  model: text('型号'), specification: text('规格'), unit_name: text('单位'), quantity: Field.number({ label: '数量', min: 0.0001, scale: 4, defaultValue: 1 }),
  cost_price: money('成本价', 4), sale_price: money('售价', 4), category_name: text('分类'), sequence: Field.number({ label: '顺序', min: 1, scale: 0, defaultValue: 1 }),
}, ['bundle_id', 'sequence', 'material_id', 'sku_id', 'name', 'quantity', 'cost_price', 'sale_price']);
