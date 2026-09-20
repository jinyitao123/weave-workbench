import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, owner, remarks, required } from '../model.js';

const quantity = (label: string, defaultValue = 0) => Field.number({ label, min: 0, scale: 4, defaultValue });
const amount = (label: string) => Field.currency({ label, precision: 18, scale: 4, min: 0, defaultValue: 0 });
const select = (label: string, options: Array<[string, string]>, defaultValue?: string, readonly = false) => Field.select(
  options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
  { label, ...(defaultValue ? { defaultValue } : {}), ...(readonly ? { readonly: true } : {}) },
);

// RM-065: an assembly order expands one active BOM into auditable material
// requirements. Quantity, cost and stock progress are maintained by actions.
export const AssemblyOrder = master('forge_assembly_order', '组装单', 'factory', {
  name: text('组装单名称', true), code: code('组装单号'), product_id: reference('forge_material', '成品', true),
  product_sku_id: reference('forge_material_sku', '成品规格', true), bom_id: reference('forge_bom', 'BOM', true),
  bom_version: text('BOM版本', true), warehouse_id: reference('forge_warehouse', '出入库仓库'),
  sales_order_id: reference('forge_sales_order', '来源销售订单'), planned_quantity: { ...quantity('计划数量', 1), ...required },
  qualified_quantity: { ...quantity('合格数量'), readonly: true }, rejected_quantity: { ...quantity('不合格数量'), readonly: true },
  inbound_quantity: { ...quantity('已入库数量'), readonly: true }, material_line_count: { ...quantity('物料种数'), readonly: true },
  readiness_rate: { ...Field.number({ label: '齐套率', min: 0, max: 100, scale: 2, defaultValue: 0 }), readonly: true },
  shortage_line_count: { ...quantity('缺料项数'), readonly: true }, issued_quantity: { ...quantity('累计领用数量'), readonly: true },
  returned_quantity: { ...quantity('累计退回数量'), readonly: true }, material_cost: { ...amount('物料投入成本'), readonly: true },
  status: select('组装状态', [
    ['draft', '草稿'], ['waiting_pick', '待领料'], ['assembling', '组装中'], ['completed', '已完工'],
    ['rejected', '已驳回'], ['cancelled', '已取消'],
  ], 'draft', true),
  planned_completion_on: Field.date({ label: '计划完工日期' }), released_at: Field.datetime({ label: '下达时间', readonly: true }),
  picked_at: Field.datetime({ label: '开始组装时间', readonly: true }), completed_at: Field.datetime({ label: '完工时间', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'product_id', 'bom_id', 'planned_quantity', 'qualified_quantity', 'rejected_quantity', 'material_line_count', 'material_cost', 'status', 'planned_completion_on']);

export const AssemblyMaterialLine = master('forge_assembly_material_line', '组装物料需求', 'list', {
  name: text('物料名称', true), assembly_id: reference('forge_assembly_order', '组装单', true),
  bom_node_id: reference('forge_bom_node', 'BOM节点', true), sku_id: reference('forge_material_sku', '物料规格', true),
  material_id: reference('forge_material', '物料', true), item_code: text('物料编码', true), model: text('型号'), specification: text('规格'),
  unit_name: text('单位'), unit_quantity: quantity('单台用量'), loss_rate: quantity('损耗率'), required_quantity: quantity('需求数量'),
  available_snapshot: quantity('可用库存快照'), allocated_quantity: quantity('分配数量'), shortage_quantity: quantity('缺料数量'),
  issued_quantity: { ...quantity('BOM领用数量'), readonly: true }, supplied_quantity: { ...quantity('补料数量'), readonly: true },
  returned_quantity: { ...quantity('退料数量'), readonly: true }, net_issued_quantity: { ...quantity('净领用数量'), readonly: true },
  unit_cost: { ...amount('成本单价'), readonly: true }, material_amount: { ...amount('净投入金额'), readonly: true },
  status: select('物料状态', [['shortage', '缺料'], ['ready', '可领料'], ['issued', '已领料'], ['completed', '已结清']], 'shortage', true),
}, ['assembly_id', 'item_code', 'name', 'required_quantity', 'available_snapshot', 'shortage_quantity', 'net_issued_quantity', 'material_amount', 'status']);

// RM-067 to RM-069 share the same approval and stock-posting document model.
export const ProductionMaterialDocument = master('forge_production_material_document', '生产领退补料单', 'clipboard-list', {
  name: text('单据名称', true), code: code('单据编号'), document_type: select('单据类型', [
    ['issue', '领料单'], ['supply', '补料单'], ['return', '退料单'],
  ]), assembly_id: reference('forge_assembly_order', '来源组装单', true), product_sku_id: reference('forge_material_sku', '成品规格', true),
  warehouse_id: reference('forge_warehouse', '仓库', true), line_count: { ...quantity('物料种数'), readonly: true },
  total_quantity: { ...quantity('物料数量'), readonly: true }, total_amount: { ...amount('物料金额'), readonly: true },
  status: select('单据状态', [['pending_approval', '审批中'], ['confirmed', '已确认'], ['rejected', '已驳回'], ['voided', '已作废']], 'pending_approval', true),
  handled_on: Field.date({ label: '业务日期', ...required }), handler_id: owner(true), approval_note: Field.textarea({ label: '审批意见', readonly: true }),
  confirmed_at: Field.datetime({ label: '确认时间', readonly: true }), confirmed_by: Field.user({ label: '确认人', readonly: true }), remarks: remarks(),
}, ['code', 'document_type', 'assembly_id', 'line_count', 'total_quantity', 'total_amount', 'handler_id', 'handled_on', 'status']);

export const ProductionMaterialDocumentLine = master('forge_production_material_document_line', '生产领退补料明细', 'list', {
  name: text('物料名称', true), document_id: reference('forge_production_material_document', '领退补料单', true),
  assembly_id: reference('forge_assembly_order', '组装单', true), assembly_line_id: reference('forge_assembly_material_line', '组装物料需求', true),
  sku_id: reference('forge_material_sku', '物料规格', true), item_code: text('物料编码', true), model: text('型号'), specification: text('规格'), unit_name: text('单位'),
  quantity: quantity('数量'), unit_cost: { ...amount('含税单位成本'), readonly: true }, amount: { ...amount('含税金额'), readonly: true },
  before_on_hand: { ...quantity('变动前库存'), readonly: true }, after_on_hand: { ...quantity('变动后库存'), readonly: true },
  direction: select('变动方向', [['outbound', '出库'], ['inbound', '入库']], undefined, true),
  status: select('明细状态', [['pending_approval', '审批中'], ['confirmed', '已确认'], ['rejected', '已驳回'], ['voided', '已作废']], 'pending_approval', true),
  remarks: remarks(),
}, ['document_id', 'item_code', 'name', 'quantity', 'unit_cost', 'amount', 'direction', 'status']);

// RM-065 explicitly separates batch inbound quantity from order completion.
export const ProductionInbound = master('forge_production_inbound', '生产入库单', 'package-plus', {
  name: text('入库单名称', true), code: code('入库单号'), assembly_id: reference('forge_assembly_order', '来源组装单', true),
  product_sku_id: reference('forge_material_sku', '成品规格', true), warehouse_id: reference('forge_warehouse', '入库仓库', true),
  qualified_quantity: quantity('合格入库数量'), rejected_quantity: quantity('不合格数量'), unit_cost: amount('成品单位成本'),
  inventory_amount: amount('入库金额'), before_on_hand: quantity('入库前库存'), after_on_hand: quantity('入库后库存'),
  batch_number: text('批次'), inbound_on: Field.date({ label: '入库日期', ...required }),
  status: select('入库状态', [['stocked', '已入库']], 'stocked', true), responsible_id: owner(true), remarks: remarks(),
}, ['code', 'assembly_id', 'product_sku_id', 'warehouse_id', 'qualified_quantity', 'rejected_quantity', 'unit_cost', 'inventory_amount', 'inbound_on', 'status']);

export const ProductionApprovalLog = master('forge_production_approval_log', '生产审批与执行记录', 'history', {
  name: text('记录名称', true), event_key: code('事件编号'), source_object: text('来源对象', true), source_id: text('来源记录ID', true),
  action: select('动作', [['released', '下达'], ['submitted', '提交审批'], ['updated', '保存修改'], ['cancelled', '取消'], ['voided', '作废'], ['confirmed', '确认'], ['stocked', '入库'], ['completed', '完工']]),
  from_status: text('原状态'), to_status: text('新状态'), comment: Field.textarea({ label: '说明' }),
  occurred_at: Field.datetime({ label: '发生时间', ...required }), operator_id: Field.user({ label: '操作人', ...required }),
}, ['occurred_at', 'source_object', 'source_id', 'action', 'from_status', 'to_status', 'operator_id']);

// Live RISEMAP 2026-09-14 exposes one shared production import/export task
// centre. Forge records synchronous CSV exports here so results remain
// visible and downloadable after the originating list page is closed.
export const ProductionDataTask = master('forge_production_data_task', '生产导入导出任务', 'file-up-down', {
  name: text('任务名称', true), code: code('任务编号'),
  task_type: select('任务类型', [['export', '导出'], ['import', '导入']], 'export'),
  source_key: text('来源标识', true), source_label: text('来源', true), source_page: text('来源页面'),
  status: select('任务状态', [['queued', '等待中'], ['running', '处理中'], ['completed', '已完成'], ['failed', '失败']], 'queued'),
  progress: Field.number({ label: '进度', min: 0, max: 100, scale: 0, defaultValue: 0 }),
  row_count: quantity('结果条数'), result_name: text('结果文件名'),
  result_content: Field.textarea({ label: '结果内容' }), failure_reason: Field.textarea({ label: '失败原因' }),
  submitted_at: Field.datetime({ label: '提交时间', ...required }), completed_at: Field.datetime({ label: '完成时间' }),
}, ['name', 'task_type', 'source_label', 'status', 'progress', 'row_count', 'result_name', 'failure_reason', 'submitted_at']);

// Live RISEMAP 2026-09-14: disassembly and replacement use two independently
// configurable reason dictionaries. Disabled values remain readable on saved
// documents but are excluded from new-document selectors.
export const ProductionDisassemblyReason = master('forge_production_disassembly_reason', '拆解原因', 'tags', {
  name: text('原因名称', true), code: code('原因编码'), description: Field.textarea({ label: '描述' }),
  color: text('标识颜色'), enabled: Field.boolean({ label: '启用', defaultValue: true }),
  sort_order: Field.number({ label: '排序', min: 0, scale: 0, defaultValue: 0 }),
}, ['name', 'description', 'color', 'enabled', 'sort_order']);

export const ProductionReplacementReason = master('forge_production_replacement_reason', '改制原因', 'tags', {
  name: text('原因名称', true), code: code('原因编码'), description: Field.textarea({ label: '描述' }),
  color: text('标识颜色'), enabled: Field.boolean({ label: '启用', defaultValue: true }),
  sort_order: Field.number({ label: '排序', min: 0, scale: 0, defaultValue: 0 }),
}, ['name', 'description', 'color', 'enabled', 'sort_order']);

// RM-070: a disassembly consumes finished inventory and explicitly splits every
// theoretical BOM quantity between recovered stock and scrap.
export const DisassemblyOrder = master('forge_disassembly_order', '拆解单', 'unplug', {
  name: text('拆解单名称', true), code: code('拆解单号'), product_id: reference('forge_material', '成品', true),
  product_sku_id: reference('forge_material_sku', '成品规格', true), bom_id: reference('forge_bom', 'BOM', true),
  bom_version: text('BOM版本', true), warehouse_id: reference('forge_warehouse', '出入库仓库'),
  quantity: { ...quantity('拆解数量', 1), ...required }, reason_id: reference('forge_production_disassembly_reason', '拆解原因配置'), reason: text('拆解原因', true), line_count: { ...quantity('物料种数'), readonly: true },
  released_cost: { ...amount('释放成品成本'), readonly: true }, recovered_value: { ...amount('回收价值'), readonly: true },
  scrap_loss: { ...amount('报废损失'), readonly: true }, status: select('拆解状态', [
    ['draft', '草稿'], ['pending_approval', '审批中'], ['stocked', '已入库'], ['rejected', '已驳回'],
  ], 'draft', true), handled_on: Field.date({ label: '拆解日期', ...required }),
  confirmed_at: Field.datetime({ label: '确认时间', readonly: true }), responsible_id: owner(true), remarks: remarks(),
}, ['code', 'product_id', 'bom_version', 'quantity', 'line_count', 'released_cost', 'recovered_value', 'scrap_loss', 'handled_on', 'status']);

export const DisassemblyLine = master('forge_disassembly_line', '拆解明细', 'list', {
  name: text('物料名称', true), disassembly_id: reference('forge_disassembly_order', '拆解单', true),
  bom_node_id: reference('forge_bom_node', 'BOM节点', true), sku_id: reference('forge_material_sku', '物料规格', true),
  material_id: reference('forge_material', '物料', true), item_code: text('物料编码', true), specification: text('规格'),
  theoretical_quantity: quantity('理论拆出数量'), recovered_quantity: quantity('回收数量'), scrapped_quantity: quantity('报废数量'),
  unit_cost: { ...amount('回收单位成本'), readonly: true }, recovered_amount: { ...amount('回收金额'), readonly: true },
  status: select('明细状态', [['draft', '草稿'], ['pending_approval', '审批中'], ['stocked', '已入库']], 'draft', true), remarks: remarks(),
}, ['disassembly_id', 'item_code', 'name', 'theoretical_quantity', 'recovered_quantity', 'scrapped_quantity', 'unit_cost', 'recovered_amount', 'status']);

// RM-071: rework keeps the finished unit in inventory while issuing a new part
// and either recovering or scrapping the replaced BOM component.
export const ReplacementOrder = master('forge_replacement_order', '换件单', 'replace', {
  name: text('换件单名称', true), code: code('换件单号'), product_id: reference('forge_material', '成品', true),
  product_sku_id: reference('forge_material_sku', '成品规格', true), bom_id: reference('forge_bom', '改制成品BOM', true),
  bom_version: text('BOM版本', true), warehouse_id: reference('forge_warehouse', '出入库仓库'),
  quantity: { ...quantity('改制数量', 1), ...required }, reason_id: reference('forge_production_replacement_reason', '改制原因配置'), reason: text('改制原因', true), line_count: { ...quantity('换件处数'), readonly: true },
  product_before_on_hand: { ...quantity('整机变动前库存'), readonly: true }, product_after_on_hand: { ...quantity('整机变动后库存'), readonly: true },
  new_part_cost: { ...amount('新件成本'), readonly: true }, old_part_value: { ...amount('旧件回收价值'), readonly: true },
  cost_change: Field.currency({ label: '成本变化', precision: 18, scale: 4, defaultValue: 0, readonly: true }),
  status: select('换件状态', [['draft', '草稿'], ['pending_approval', '审批中'], ['stocked', '已入库'], ['rejected', '已驳回']], 'draft', true),
  handled_on: Field.date({ label: '换件日期', ...required }), confirmed_at: Field.datetime({ label: '确认时间', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'product_id', 'bom_version', 'quantity', 'line_count', 'new_part_cost', 'old_part_value', 'cost_change', 'handled_on', 'status']);

export const ReplacementLine = master('forge_replacement_line', '换件明细', 'list', {
  name: text('换件说明', true), replacement_id: reference('forge_replacement_order', '换件单', true),
  old_bom_node_id: reference('forge_bom_node', '原BOM节点', true), old_sku_id: reference('forge_material_sku', '旧件规格', true),
  old_item_code: text('旧件编码', true), old_quantity: quantity('旧件数量'), old_destination: select('旧件去向', [['recover', '回收入库'], ['scrap', '报废']]),
  old_unit_cost: { ...amount('旧件单位成本'), readonly: true }, old_recovered_amount: { ...amount('旧件回收金额'), readonly: true },
  new_sku_id: reference('forge_material_sku', '新件规格', true), new_item_code: text('新件编码', true), new_quantity: quantity('新件数量'),
  new_unit_cost: { ...amount('新件单位成本'), readonly: true }, new_amount: { ...amount('新件金额'), readonly: true },
  cost_change: Field.currency({ label: '成本变化', precision: 18, scale: 4, defaultValue: 0, readonly: true }),
  status: select('明细状态', [['draft', '草稿'], ['pending_approval', '审批中'], ['stocked', '已入库']], 'draft', true), remarks: remarks(),
}, ['replacement_id', 'old_item_code', 'old_quantity', 'old_destination', 'new_item_code', 'new_quantity', 'new_amount', 'old_recovered_amount', 'cost_change', 'status']);
