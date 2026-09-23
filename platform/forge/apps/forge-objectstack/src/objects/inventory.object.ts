import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, owner, remarks, required } from '../model.js';

const quantity = (label: string, mandatory = false, defaultValue?: number) => Field.number({
  label, min: 0, scale: 4, ...(mandatory ? required : {}), ...(defaultValue === undefined ? {} : { defaultValue }),
});
const nonNegativeMoney = (label: string) => Field.currency({ label, precision: 18, scale: 4, min: 0 });
const inboundStatus = () => Field.select([
  { value: 'draft', label: '草稿' },
  { value: 'pending_approval', label: '待审批' },
  { value: 'stocked', label: '已入库' },
  { value: 'rejected', label: '已驳回' },
], { label: '入库状态', defaultValue: 'draft', readonly: true });

export const OtherInboundType = master('forge_other_inbound_type', '其他入库类型', 'tags', {
  name: text('类型名称', true), code: code('类型编码'),
  color: text('标识颜色'), status: Field.select([
    { value: 'active', label: '启用' }, { value: 'inactive', label: '停用' },
  ], { label: '状态', defaultValue: 'active' }),
  description: Field.textarea({ label: '用途说明' }), remarks: remarks(),
}, ['name', 'code', 'status', 'description']);

export const OtherInbound = master('forge_other_inbound', '其他入库单', 'package-plus', {
  name: text('入库单名称', true), code: code('入库单号'),
  inbound_type_id: reference('forge_other_inbound_type', '入库类型', true),
  warehouse_id: reference('forge_warehouse', '入库仓库', true),
  inbound_on: Field.date({ label: '入库日期', ...required }),
  counterparty_type: Field.select([
    { value: 'customer', label: '客户' }, { value: 'supplier', label: '供应商' },
  ], { label: '往来单位类型', defaultValue: 'customer' }),
  customer_id: { ...reference('forge_customer', '客户'), relatedList: false }, supplier_id: reference('forge_supplier', '供应商'),
  arrival_reason: Field.textarea({ label: '到货原因' }), source_code: text('来源单号'), handler_id: owner(true),
  line_count: quantity('物料行数', false, 0), total_quantity: quantity('入库数量', false, 0),
  total_amount: nonNegativeMoney('含税金额'), status: Field.select([
    { value: 'draft', label: '草稿' }, { value: 'pending_approval', label: '待审批' },
    { value: 'approved', label: '已审批' }, { value: 'stocked', label: '已入库' },
    { value: 'rejected', label: '已驳回' }, { value: 'cancelled', label: '已取消' },
  ], { label: '入库状态', defaultValue: 'draft', readonly: true }),
  approval_note: Field.textarea({ label: '审批意见', readonly: true }),
  approved_by: owner(), approved_at: Field.datetime({ label: '审批时间', readonly: true }),
  stocked_by: owner(), stocked_at: Field.datetime({ label: '入库时间', readonly: true }),
  cancel_reason: Field.textarea({ label: '取消原因', readonly: true }),
  cancelled_by: owner(), cancelled_at: Field.datetime({ label: '取消时间', readonly: true }),
  remarks: remarks(),
}, ['code', 'inbound_type_id', 'warehouse_id', 'inbound_on', 'counterparty_type', 'customer_id', 'supplier_id', 'arrival_reason', 'line_count', 'total_quantity', 'total_amount', 'status', 'handler_id']);

export const OtherInboundLine = master('forge_other_inbound_line', '其他入库明细', 'list', {
  name: text('物料名称', true), inbound_id: reference('forge_other_inbound', '其他入库单', true),
  sku_id: reference('forge_material_sku', '物料规格', true), item_code: text('物料编码', true),
  model: text('型号'), specification: text('规格'), unit_name: text('单位'),
  quantity: quantity('入库数量', true), taxed_unit_price: nonNegativeMoney('含税单价'),
  taxed_amount: nonNegativeMoney('含税金额'), batch_number: text('批次号'), warehouse_location: text('库位'),
  status: Field.select([
    { value: 'draft', label: '草稿' }, { value: 'pending_approval', label: '待审批' },
    { value: 'approved', label: '已审批' }, { value: 'stocked', label: '已入库' },
    { value: 'cancelled', label: '已取消' },
  ], { label: '明细状态', defaultValue: 'draft', readonly: true }), remarks: remarks(),
}, ['inbound_id', 'item_code', 'name', 'specification', 'quantity', 'taxed_unit_price', 'taxed_amount', 'batch_number', 'status']);

export const OtherOutboundType = master('forge_other_outbound_type', '其他出库类型', 'tags', {
  name: text('类型名称', true), code: code('类型编码'), color: text('标识颜色'),
  status: Field.select([{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }], { label: '状态', defaultValue: 'active' }),
  description: Field.textarea({ label: '用途说明' }), remarks: remarks(),
}, ['name', 'code', 'status', 'description']);

export const OtherOutbound = master('forge_other_outbound', '其他出库单', 'package-minus', {
  name: text('出库单名称', true), code: code('出库单号'), outbound_type_id: reference('forge_other_outbound_type', '出库类型', true),
  outbound_on: Field.date({ label: '出库日期', ...required }), customer_id: { ...reference('forge_customer', '客户'), relatedList: false },
  project_id: reference('forge_project', '关联项目'), reason: Field.textarea({ label: '出库原因' }), handler_id: owner(true),
  shipping_method: Field.select([{ value: 'express', label: '快递' }, { value: 'freight', label: '物流' }, { value: 'pickup', label: '客户自取' }, { value: 'delivery', label: '送货' }, { value: 'other', label: '其他' }], { label: '发货方式', defaultValue: 'express' }),
  logistics_company: text('物流公司'), tracking_number: text('快递/物流单号'), recipient: text('收件人'), phone: text('联系电话'), address: Field.textarea({ label: '收货地址' }),
  line_count: quantity('物料种类', false, 0), total_quantity: quantity('出库总数量', false, 0), total_amount: nonNegativeMoney('出库总金额'),
  status: Field.select([{ value: 'draft', label: '草稿' }, { value: 'pending_approval', label: '待审批' }, { value: 'approved', label: '已审批' }, { value: 'outbounded', label: '已出库' }, { value: 'rejected', label: '已驳回' }, { value: 'cancelled', label: '已取消' }], { label: '出库状态', defaultValue: 'draft', readonly: true }),
  approval_note: Field.textarea({ label: '审批意见', readonly: true }), approved_by: owner(), approved_at: Field.datetime({ label: '审批时间', readonly: true }),
  outbounded_by: owner(), outbounded_at: Field.datetime({ label: '出库时间', readonly: true }), cancel_reason: Field.textarea({ label: '取消原因', readonly: true }),
  cancelled_by: owner(), cancelled_at: Field.datetime({ label: '取消时间', readonly: true }), remarks: remarks(),
}, ['code', 'outbound_type_id', 'outbound_on', 'customer_id', 'project_id', 'line_count', 'total_quantity', 'total_amount', 'status', 'handler_id']);

export const OtherOutboundLine = master('forge_other_outbound_line', '其他出库明细', 'list', {
  name: text('物料名称', true), outbound_id: reference('forge_other_outbound', '其他出库单', true), warehouse_id: reference('forge_warehouse', '出库仓库', true),
  sku_id: reference('forge_material_sku', '物料规格', true), item_code: text('物料编码', true), specification: text('规格'), unit_name: text('单位'),
  quantity: quantity('出库数量', true), unit_cost: nonNegativeMoney('含税单位成本'), amount: nonNegativeMoney('出库金额'), batch_number: text('批次号'), warehouse_location: text('库位'),
  status: Field.select([{ value: 'draft', label: '草稿' }, { value: 'pending_approval', label: '待审批' }, { value: 'approved', label: '已审批' }, { value: 'outbounded', label: '已出库' }, { value: 'rejected', label: '已驳回' }, { value: 'cancelled', label: '已取消' }], { label: '明细状态', defaultValue: 'draft', readonly: true }), remarks: remarks(),
}, ['outbound_id', 'warehouse_id', 'item_code', 'name', 'specification', 'quantity', 'unit_cost', 'amount', 'status']);

// RM-028 runtime evidence. Header and lines remain separate so approval can audit
// the exact quantity and value that produced each balance movement.
export const OpeningInbound = master('forge_opening_inbound', '期初入库单', 'package-plus', {
  name: text('入库单名称', true), code: code('入库单号'), inbound_on: Field.date({ label: '入库日期', ...required }),
  warehouse_id: reference('forge_warehouse', '入库仓库', true), line_count: quantity('物料行数', false, 0),
  total_quantity: quantity('入库数量', false, 0), total_amount: nonNegativeMoney('含税金额'),
  status: inboundStatus(), responsible_id: owner(true), approval_note: Field.textarea({ label: '审批意见', readonly: true }),
  approved_at: Field.datetime({ label: '审批时间', readonly: true }), remarks: remarks(),
}, ['code', 'name', 'warehouse_id', 'inbound_on', 'line_count', 'total_quantity', 'total_amount', 'status', 'responsible_id']);

export const OpeningInboundLine = master('forge_opening_inbound_line', '期初入库明细', 'list', {
  name: text('物料名称', true), inbound_id: reference('forge_opening_inbound', '期初入库单', true),
  sku_id: reference('forge_material_sku', '物料规格', true), item_code: text('物料编码'), model: text('型号'),
  specification: text('规格'), unit_name: text('单位'), quantity: quantity('入库数量', true),
  taxed_unit_price: nonNegativeMoney('含税单价'), untaxed_unit_price: nonNegativeMoney('不含税单价'),
  tax_rate: Field.number({ label: '税率', min: 0, max: 100, scale: 4, defaultValue: 13 }),
  tax_amount: nonNegativeMoney('税额'), taxed_amount: nonNegativeMoney('含税金额'), remarks: remarks(),
}, ['inbound_id', 'item_code', 'name', 'model', 'quantity', 'taxed_unit_price', 'taxed_amount']);

// One current balance per warehouse and SKU. balance_key is generated by the
// approval action and enforces that invariant at storage level.
export const InventoryBalance = master('forge_inventory_balance', '库存余额', 'boxes', {
  name: text('库存名称', true), balance_key: code('余额键'), warehouse_id: reference('forge_warehouse', '仓库', true),
  sku_id: reference('forge_material_sku', '物料规格', true), on_hand_quantity: { ...quantity('当前库存', false, 0), readonly: true },
  reserved_quantity: { ...quantity('占用数量', false, 0), readonly: true },
  available_quantity: { ...quantity('可用库存', false, 0), readonly: true },
  average_cost: { ...nonNegativeMoney('移动平均含税成本'), readonly: true },
  inventory_value: { ...nonNegativeMoney('库存含税金额'), readonly: true },
  minimum_quantity: quantity('最低库存', false, 0), maximum_quantity: quantity('最高库存', false, 0),
  slow_days: Field.number({ label: '呆滞天数', min: 1, scale: 0, defaultValue: 90 }),
  last_movement_at: Field.datetime({ label: '最近变动时间', readonly: true }), remarks: remarks(),
}, ['warehouse_id', 'sku_id', 'on_hand_quantity', 'reserved_quantity', 'available_quantity', 'average_cost', 'inventory_value', 'last_movement_at']);

// Global alert policy. Material-level thresholds on InventoryBalance take
// precedence; zero values fall back to these defaults so the settings page
// changes the actual alert calculation instead of merely storing preferences.
export const InventoryAlertPolicy = master('forge_inventory_alert_policy', '库存预警设置', 'bell-ring', {
  name: text('设置名称', true), code: code('设置编码'),
  low_stock_enabled: Field.boolean({ label: '启用低库存预警', defaultValue: true }),
  low_stock_lead_days: Field.number({ label: '低库存预警提前天数', min: 0, scale: 0, defaultValue: 7 }),
  overstock_enabled: Field.boolean({ label: '启用超储预警', defaultValue: true }),
  overstock_threshold_percent: Field.number({ label: '超储阈值百分比', min: 100, scale: 2, defaultValue: 120 }),
  slow_stock_enabled: Field.boolean({ label: '启用呆滞库存预警', defaultValue: true }),
  slow_stock_days: Field.number({ label: '呆滞天数', min: 1, scale: 0, defaultValue: 180 }),
  delivery_alert_enabled: Field.boolean({ label: '启用交期预警', defaultValue: true }),
  delivery_warning_days: Field.number({ label: '临近预警天数', min: 0, scale: 0, defaultValue: 7 }),
  delivery_urgent_days: Field.number({ label: '紧急预警天数', min: 0, scale: 0, defaultValue: 2 }),
  notification_positions: Field.textarea({ label: '通知角色' }),
  updated_by: Field.user({ label: '最近设置人', readonly: true }),
  updated_at: Field.datetime({ label: '最近设置时间', readonly: true }),
  remarks: remarks(),
}, ['code', 'low_stock_enabled', 'low_stock_lead_days', 'overstock_enabled', 'overstock_threshold_percent', 'slow_stock_enabled', 'slow_stock_days', 'delivery_alert_enabled', 'delivery_warning_days', 'delivery_urgent_days', 'notification_positions', 'updated_by', 'updated_at']);

export const InventoryLedger = master('forge_inventory_ledger', '库存流水', 'book-open', {
  name: text('流水名称', true), code: code('流水号'), warehouse_id: reference('forge_warehouse', '仓库', true),
  sku_id: reference('forge_material_sku', '物料规格', true), direction: Field.select([
    { value: 'inbound', label: '入库' }, { value: 'outbound', label: '出库' },
  ], { label: '变动方向', ...required }),
  movement_type: Field.select([
    { value: 'opening_inbound', label: '期初入库' }, { value: 'purchase_inbound', label: '采购入库' },
    { value: 'purchase_in_transit', label: '采购在途' },
    { value: 'other_inbound', label: '其他入库' },
    { value: 'production_issue', label: '生产领料' }, { value: 'production_supply', label: '生产补料' },
    { value: 'production_return', label: '生产退料' }, { value: 'production_inbound', label: '生产入库' },
    { value: 'disassembly_outbound', label: '拆解成品出库' }, { value: 'disassembly_recovery', label: '拆解物料回收' },
    { value: 'replacement_issue', label: '换件新件领用' }, { value: 'replacement_recovery', label: '换件旧件回收' },
    { value: 'sales_outbound', label: '销售出库' }, { value: 'purchase_return_outbound', label: '采购退货出库' },
    { value: 'purchase_replacement_inbound', label: '采购换货补货入库' },
    { value: 'subcontract_issue_outbound', label: '委外发料出库' },
    { value: 'subcontract_receipt_inbound', label: '委外回厂入库' },
    { value: 'subcontract_ncr_concession', label: '委外特采入库' },
    { value: 'adjustment', label: '库存调整' },
    { value: 'inventory_lock', label: '库存锁定' }, { value: 'inventory_release', label: '库存释放' },
    { value: 'count_gain', label: '盘盈入库' }, { value: 'count_loss', label: '盘亏出库' },
    { value: 'transfer_out', label: '调拨出库' }, { value: 'transfer_in', label: '调拨入库' },
    { value: 'loan_out', label: '借出出库' }, { value: 'loan_return', label: '借出归还' },
    { value: 'damage_out', label: '报损出库' }, { value: 'other_outbound', label: '其他出库' },
  ], { label: '流水类型', ...required }),
  quantity: quantity('变动数量', true), before_on_hand: quantity('变动前库存'), after_on_hand: quantity('变动后库存'),
  before_available: quantity('变动前可用库存'), after_available: quantity('变动后可用库存'),
  unit_cost: nonNegativeMoney('含税单位成本'), amount: nonNegativeMoney('含税金额'), occurred_at: Field.datetime({ label: '发生时间', ...required }),
  source_object: text('来源单据类型', true), source_id: text('来源单据编号', true), source_line_id: text('来源明细编号'),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'occurred_at', 'warehouse_id', 'sku_id', 'direction', 'movement_type', 'quantity', 'before_on_hand', 'after_on_hand', 'source_object', 'source_id']);

const inventoryOperationStatus = () => Field.select([
  { value: 'draft', label: '草稿' },
  { value: 'pending_approval', label: '待审批' },
  { value: 'active', label: '生效中' },
  { value: 'completed', label: '已完成' },
  { value: 'released', label: '已释放' },
  { value: 'returned', label: '已归还' },
  { value: 'rejected', label: '已驳回' },
  { value: 'voided', label: '已作废' },
], { label: '状态', defaultValue: 'draft', readonly: true });

// RM-033 to RM-037. A shared operational document keeps inventory mutations in
// one audited state machine while the six business pages expose distinct tasks.
export const InventoryOperation = master('forge_inventory_operation', '库存作业单', 'clipboard-list', {
  name: text('作业名称', true), code: code('作业单号'),
  operation_type: Field.select([
    { value: 'lock', label: '库存锁定' }, { value: 'count', label: '库存盘点' },
    { value: 'transfer', label: '仓库调拨' }, { value: 'loan', label: '物料借出' },
    { value: 'damage', label: '库存报损' },
  ], { label: '业务类型', ...required }),
  source_warehouse_id: reference('forge_warehouse', '发出/所在仓库', true),
  target_warehouse_id: reference('forge_warehouse', '接收仓库'),
  sku_id: reference('forge_material_sku', '物料规格', true), batch_number: text('批次号'),
  quantity: quantity('作业数量', true), released_quantity: quantity('已释放/已归还数量', false, 0),
  system_quantity: quantity('账面数量', false, 0), actual_quantity: quantity('实盘数量', false, 0),
  variance_quantity: Field.number({ label: '盘点差异', scale: 4, readonly: true }),
  unit_cost: nonNegativeMoney('含税单位成本'), amount: nonNegativeMoney('含税金额'),
  source_type: text('业务来源'), source_code: text('来源单号'), counterpart: text('接收方/借用方'),
  reason: Field.textarea({ label: '原因', ...required }), planned_on: Field.date({ label: '计划/业务日期', ...required }),
  due_at: Field.datetime({ label: '到期释放/归还时间' }), lock_accounting: Field.boolean({ label: '盘点期间锁账', defaultValue: false }),
  status: inventoryOperationStatus(), responsible_id: owner(true), approved_by: owner(),
  completed_at: Field.datetime({ label: '完成时间', readonly: true }), remarks: remarks(),
}, ['code', 'operation_type', 'source_warehouse_id', 'target_warehouse_id', 'sku_id', 'quantity', 'amount', 'status', 'planned_on', 'responsible_id']);

export const InventorySerialNumber = master('forge_inventory_serial_number', 'SN码记录', 'scan-line', {
  name: text('SN码', true), code: code('供应商序列号'), sku_id: reference('forge_material_sku', '产品规格', true),
  inbound_code: text('入库单号', true), batch_number: text('批次号'), supplier_id: reference('forge_supplier', '供应商'),
  status: Field.select([
    { value: 'in_stock', label: '在库' }, { value: 'outbound', label: '已出库' },
    { value: 'returned', label: '已退回' }, { value: 'voided', label: '已作废' },
  ], { label: '出库状态', defaultValue: 'in_stock', readonly: true }),
  outbound_code: text('出库单号'), verified_at: Field.datetime({ label: '最近验证时间', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'sku_id', 'inbound_code', 'batch_number', 'supplier_id', 'status', 'outbound_code']);

// RM-037: report loss is a header plus multiple inventory lines. Inventory is
// changed only by the approval action so the exact quantity and value of every
// loss remains auditable after restart.
export const InventoryDamageType = master('forge_inventory_damage_type', '报损类型', 'tags', {
  name: text('类型名称', true), code: code('类型编码'), description: Field.textarea({ label: '类型描述' }),
  color: text('标识颜色'), status: Field.select([
    { value: 'active', label: '启用' }, { value: 'inactive', label: '停用' },
  ], { label: '状态', defaultValue: 'active' }), remarks: remarks(),
}, ['name', 'code', 'description', 'color', 'status']);

export const InventoryDamage = master('forge_inventory_damage', '报损单', 'file-warning', {
  name: text('报损单名称', true), code: code('报损单号'),
  warehouse_id: reference('forge_warehouse', '所在仓库', true),
  damage_type_id: reference('forge_inventory_damage_type', '报损类型', true),
  damage_on: Field.date({ label: '报损日期', ...required }),
  line_count: quantity('物料种类', false, 0), total_quantity: quantity('报损总量', false, 0),
  total_amount: nonNegativeMoney('报损金额'), status: Field.select([
    { value: 'draft', label: '草稿' }, { value: 'pending_approval', label: '待审批' },
    { value: 'completed', label: '已完成' }, { value: 'rejected', label: '已驳回' },
    { value: 'voided', label: '已作废' },
  ], { label: '状态', defaultValue: 'draft', readonly: true }),
  handler_id: owner(true), submitted_at: Field.datetime({ label: '提交时间', readonly: true }),
  approved_by: owner(), approved_at: Field.datetime({ label: '审批时间', readonly: true }),
  approval_note: Field.textarea({ label: '审批意见', readonly: true }),
  void_reason: Field.textarea({ label: '作废原因', readonly: true }),
  voided_by: owner(), voided_at: Field.datetime({ label: '作废时间', readonly: true }), remarks: remarks(),
}, ['code', 'warehouse_id', 'damage_type_id', 'damage_on', 'line_count', 'total_quantity', 'total_amount', 'status', 'handler_id']);

export const InventoryDamageLine = master('forge_inventory_damage_line', '报损物料明细', 'list', {
  name: text('物料名称', true), damage_id: reference('forge_inventory_damage', '报损单', true),
  warehouse_id: reference('forge_warehouse', '所在仓库', true),
  sku_id: reference('forge_material_sku', '物料规格', true), item_code: text('物料编码'),
  specification: text('规格'), unit_name: text('单位'), quantity: quantity('报损数量', true),
  unit_cost: nonNegativeMoney('含税单位成本'), amount: nonNegativeMoney('报损金额'),
  status: Field.select([
    { value: 'draft', label: '草稿' }, { value: 'pending_approval', label: '待审批' },
    { value: 'completed', label: '已完成' }, { value: 'rejected', label: '已驳回' },
    { value: 'voided', label: '已作废' },
  ], { label: '明细状态', defaultValue: 'draft', readonly: true }), remarks: remarks(),
}, ['damage_id', 'item_code', 'name', 'specification', 'quantity', 'unit_cost', 'amount', 'status']);

export const InventorySerialVerification = master('forge_inventory_serial_verification', 'SN码验证记录', 'scan-search', {
  name: text('验证记录', true), query_code: text('验证序列号', true),
  serial_id: reference('forge_inventory_serial_number', '匹配SN记录'),
  result: Field.select([
    { value: 'found', label: '验证通过' }, { value: 'not_found', label: '未找到匹配记录' },
  ], { label: '验证结果', ...required }),
  verified_at: Field.datetime({ label: '验证时间', ...required }), responsible_id: owner(true), remarks: remarks(),
}, ['query_code', 'result', 'serial_id', 'verified_at', 'responsible_id']);
