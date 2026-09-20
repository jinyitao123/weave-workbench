import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, required } from '../model.js';

const quantity = (label: string, readonly = true) => Field.number({
  label, min: 0, scale: 4, ...(readonly ? { readonly: true } : {}),
});
const money = (label: string, scale = 4) => Field.currency({ label, precision: 18, scale, min: 0, readonly: true });
const select = (label: string, options: Array<[string, string]>) => Field.select(
  options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
  { label },
);

export const BomShortageAnalysis = master('forge_bom_shortage_analysis', 'BOM缺料分析', 'chart-no-axes-column-increasing', {
  name: text('分析名称', true), code: code('分析编号'), bom_id: reference('forge_bom', 'BOM', true),
  project_id: reference('forge_project', '适用项目'), planned_quantity: Field.number({ label: '计划生产数量', min: 0.0001, scale: 4, ...required }),
  component_count: quantity('物料种数'), shortage_count: quantity('缺口项数'), kit_rate: Field.number({ label: '齐套率', min: 0, max: 100, scale: 2, readonly: true }),
  max_producible_quantity: quantity('最大可生产数'), estimated_purchase_amount: money('预计采购金额', 2),
  analyzed_at: Field.datetime({ label: '分析时间', ...required, readonly: true }), analyzed_by: Field.user({ label: '分析人', ...required, readonly: true }),
  status: { ...select('分析状态', [['completed', '已完成']]), readonly: true },
}, ['code', 'bom_id', 'project_id', 'planned_quantity', 'kit_rate', 'component_count', 'shortage_count', 'max_producible_quantity', 'estimated_purchase_amount', 'analyzed_at']);

export const BomShortageLine = master('forge_bom_shortage_line', 'BOM缺料明细', 'list', {
  name: text('物料名称', true), analysis_id: reference('forge_bom_shortage_analysis', '缺料分析', true),
  bom_id: reference('forge_bom', 'BOM', true), bom_node_id: reference('forge_bom_node', 'BOM节点', true),
  sku_id: reference('forge_material_sku', '物料规格', true), material_id: reference('forge_material', '物料', true),
  item_code: text('物料编码'), specification: text('规格'), model: text('型号'), unit_name: text('单位'),
  source_type: select('来源类型', [['purchased', '采购'], ['manufactured', '自制'], ['subcontracted', '外协'], ['virtual', '虚拟']]),
  required_per_unit: quantity('单机用量'), total_required: quantity('总需求'), on_hand_quantity: quantity('库存'),
  reserved_quantity: quantity('锁定'), available_quantity: quantity('可用'), shortage_quantity: quantity('缺口'),
  supplier_id: reference('forge_supplier', '默认供应商'), untaxed_unit_price: money('未税单价'), subtotal: money('预计小计'),
  fulfillment_status: { ...select('齐套状态', [['shortage', '缺料'], ['sufficient', '充足']]), readonly: true },
}, ['analysis_id', 'item_code', 'name', 'model', 'unit_name', 'required_per_unit', 'total_required', 'available_quantity', 'shortage_quantity', 'supplier_id', 'untaxed_unit_price', 'subtotal', 'fulfillment_status']);
