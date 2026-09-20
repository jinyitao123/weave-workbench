import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, owner, remarks, required } from '../model.js';

const select = (label: string, options: Array<[string, string]>, defaultValue?: string) => Field.select(
  options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
  { label, ...(defaultValue ? { defaultValue } : {}) },
);
const quantity = (label: string, readonly = false) => Field.number({ label, min: 0, scale: 4, defaultValue: 0, ...(readonly ? { readonly: true } : {}) });
const money = (label: string, readonly = false) => Field.currency({ label, precision: 18, scale: 4, min: 0, defaultValue: 0, ...(readonly ? { readonly: true } : {}) });

// Live RISEMAP /subcontract/suppliers: the profile extends an approved supplier master; delivery and yield rates are derived.
export const SubcontractSupplierProfile = master('forge_subcontract_supplier_profile', '委外供应商档案', 'factory', {
  name: text('档案名称', true), supplier_id: reference('forge_supplier', '供应商', true),
  process_capabilities: Field.textarea({ label: '工艺能力', ...required }),
  credit_rating: select('信用等级', [['one','1 星'],['two','2 星'],['three','3 星'],['four','4 星'],['five','5 星']], 'three'),
  default_issue_warehouse_id: reference('forge_warehouse', '默认发料来源仓'),
  default_receipt_warehouse_id: reference('forge_warehouse', '默认回厂入库仓'),
  loss_rate_limit: Field.number({ label: '损耗率上限（%）', min: 0, max: 100, scale: 4, defaultValue: 0 }),
  warranty_terms: Field.textarea({ label: '质保条款' }),
  on_time_rate: Field.number({ label: '交期准时率（%）', min: 0, max: 100, scale: 4, readonly: true }),
  yield_rate: Field.number({ label: '历史良率（%）', min: 0, max: 100, scale: 4, readonly: true }),
  status: { ...select('委外状态', [['active','已开通'],['inactive','已停用']], 'active'), readonly: true },
  activated_by: Field.user({ label: '开通人', readonly: true }), activated_at: Field.datetime({ label: '开通时间', readonly: true }),
  responsible_id: owner(), remarks: remarks(),
}, ['supplier_id','process_capabilities','credit_rating','default_issue_warehouse_id','default_receipt_warehouse_id','on_time_rate','yield_rate','status']);

// RM-083 live page and /subcontract/orders/new. Physical issue, receipt and reconciliation are later documents.
export const SubcontractOrder = master('forge_subcontract_order', '委外订单', 'factory', {
  name: text('订单名称', true), code: code('委外订单号'), supplier_profile_id: reference('forge_subcontract_supplier_profile', '委外供应商档案', true),
  supplier_id: reference('forge_supplier', '委外供应商', true), supply_mode: select('料权方式', [['customer_supplied','甲供料'],['turnkey','包工包料']], 'customer_supplied'),
  expected_delivery_on: Field.date({ label: '期望交期', ...required }), project_id: reference('forge_project', '项目'),
  source_type: select('业务来源', [['manual','手工新建'],['sales_order','关联销售订单'],['production_order','关联生产工单'],['mrp','MRP推送'],['bom','历史BOM展开'],['project','历史项目委外']], 'manual'),
  source_sales_order_id: reference('forge_sales_order', '来源销售订单'), source_production_order_id: reference('forge_assembly_order', '来源生产工单'), source_mrp_analysis_id: reference('forge_bom_shortage_analysis', '来源MRP分析'),
  inspection_method: select('验收方式', [['full','全检'],['sampling','抽检-按比例'],['supplier_self','供应商自检'],['exempt','历史免检']], 'full'),
  sampling_ratio: Field.number({ label: '抽检比例（%）', min: 0.01, max: 100, scale: 2 }),
  payment_condition_id: reference('forge_payment_condition', '付款条件配置'), payment_term: text('付款条件', true), line_count: Field.number({ label: '加工件行数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  total_quantity: quantity('加工件总数量', true), processing_amount: money('加工费总额', true),
  issue_planned_quantity: quantity('计划发料数量', true), issued_quantity: quantity('已发料数量', true),
  received_quantity: quantity('已回厂数量', true), backflushed_quantity: quantity('已倒冲耗用', true), overconsumption_quantity: quantity('累计超耗', true), reconciled_amount: money('已对账金额', true),
  ncr_concession_quantity: quantity('NCR 特采数量', true), ncr_return_quantity: quantity('NCR 退货数量', true), ncr_scrap_quantity: quantity('NCR 报废数量', true), ncr_rework_quantity: quantity('NCR 返工数量', true),
  status: { ...select('订单状态', [['draft','草稿'],['pending_approval','待审核'],['approved','已审核'],['rejected','已驳回'],['in_progress','进行中'],['completed','已完工'],['reconciled','已对账'],['cancelled','已取消']], 'draft'), readonly: true },
  submitted_at: Field.datetime({ label: '提交时间', readonly: true }), submitted_by: Field.user({ label: '提交人', readonly: true }),
  approved_at: Field.datetime({ label: '审核时间', readonly: true }), approved_by: Field.user({ label: '审核人', readonly: true }),
  approval_note: Field.textarea({ label: '审核意见', readonly: true }), responsible_id: owner(true), remarks: remarks(),
}, ['code','supplier_id','supply_mode','project_id','source_type','payment_condition_id','payment_term','processing_amount','issued_quantity','received_quantity','reconciled_amount','expected_delivery_on','status']);

export const SubcontractOrderLine = master('forge_subcontract_order_line', '委外订单加工件', 'list', {
  name: text('物料名称', true), order_id: reference('forge_subcontract_order', '委外订单', true), sku_id: reference('forge_material_sku', '物料规格', true),
  item_code: text('物料编号', true), specification: text('规格'), process_type_id: reference('forge_subcontract_business_setting', '加工类型'), process_type: text('加工类型', true),
  quantity: Field.number({ label: '数量', min: 0.0001, scale: 4, ...required }), unit_name: text('单位', true),
  unit_price: money('加工单价'), subtotal: money('加工小计', true), expected_delivery_on: Field.date({ label: '期望交期' }),
  drawing_number: text('图纸号'), received_good_quantity: quantity('已回良品', true), received_bad_quantity: quantity('已回不良品', true),
  ncr_concession_quantity: quantity('NCR 特采数量', true), ncr_return_quantity: quantity('NCR 退货数量', true), ncr_scrap_quantity: quantity('NCR 报废数量', true), ncr_rework_quantity: quantity('NCR 返工数量', true), remarks: remarks(),
}, ['order_id','item_code','name','specification','process_type_id','process_type','quantity','unit_name','unit_price','subtotal','expected_delivery_on','drawing_number']);

export const SubcontractMaterialPlan = master('forge_subcontract_material_plan', '委外发料计划', 'boxes', {
  name: text('物料名称', true), order_id: reference('forge_subcontract_order', '委外订单', true),
  order_line_id: reference('forge_subcontract_order_line', '用于加工件', true), sku_id: reference('forge_material_sku', '物料规格', true),
  item_code: text('物料编号', true), specification: text('规格'), planned_quantity: Field.number({ label: '计划发料', min: 0.0001, scale: 4, ...required }),
  standard_quantity: Field.number({ label: '标准应耗', min: 0.0001, scale: 4, ...required }), unit_name: text('单位', true),
  issued_quantity: quantity('已发料', true), backflushed_quantity: quantity('已倒冲耗用', true), overconsumption_quantity: quantity('累计超耗', true), returned_quantity: quantity('已退料', true), remarks: remarks(),
}, ['order_id','order_line_id','item_code','name','specification','planned_quantity','standard_quantity','unit_name','issued_quantity','returned_quantity']);

export const SubcontractOrderApprovalLog = master('forge_subcontract_order_approval_log', '委外订单审核记录', 'history', {
  name: text('记录名称', true), order_id: reference('forge_subcontract_order', '委外订单', true),
  action: select('审核动作', [['submitted','提交审核'],['approved','同意'],['rejected','驳回']]),
  from_status: text('原状态'), to_status: text('新状态'), comment: Field.textarea({ label: '审核意见' }),
  occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['order_id','action','from_status','to_status','comment','operator_id','occurred_at']);

// RISEMAP /subcontract/issues and the warehouse-role guide. Approval reserves
// source stock; physical dispatch converts that reservation into two auditable
// movements: source-warehouse outbound and supplier-side subcontract stock inbound.
export const SubcontractIssue = master('forge_subcontract_issue', '委外发料单', 'package-minus', {
  name: text('发料单名称', true), code: code('发料单号'), order_id: reference('forge_subcontract_order', '关联委外订单', true),
  supplier_id: reference('forge_supplier', '发往供应商', true), issue_type: select('发料类型', [['normal','正常发料'],['overconsumption','超耗补料']], 'normal'),
  issue_on: Field.date({ label: '发料日期', ...required }), handler_id: Field.user({ label: '经办人', ...required }),
  warehouse_id: reference('forge_warehouse', '来源仓库', true), line_count: Field.number({ label: '物料种数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  total_quantity: quantity('发料数量', true), status: select('发料状态', [['draft','草稿'],['pending_approval','待审核'],['ready_to_issue','待发料'],['rejected','已驳回'],['issued','已发出'],['signed','已签收'],['cancelled','已取消']], 'draft'),
  outbound_id: reference('forge_subcontract_outbound', '关联委外出库单'),
  submitted_by: Field.user({ label: '提交人', readonly: true }), submitted_at: Field.datetime({ label: '提交时间', readonly: true }),
  reviewed_by: Field.user({ label: '审核人', readonly: true }), reviewed_at: Field.datetime({ label: '审核时间', readonly: true }), review_note: Field.textarea({ label: '审核意见', readonly: true }),
  issued_by: Field.user({ label: '出库人', readonly: true }), issued_at: Field.datetime({ label: '实际发出时间', readonly: true }),
  signed_by: Field.user({ label: '签收登记人', readonly: true }), signed_at: Field.datetime({ label: '供应商签收时间', readonly: true }), sign_note: Field.textarea({ label: '签收说明', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code','supplier_id','order_id','issue_type','warehouse_id','issue_on','handler_id','line_count','total_quantity','status','outbound_id']);

export const SubcontractIssueLine = master('forge_subcontract_issue_line', '委外发料明细', 'list', {
  name: text('物料名称', true), issue_id: reference('forge_subcontract_issue', '委外发料单', true), order_id: reference('forge_subcontract_order', '委外订单', true),
  plan_id: reference('forge_subcontract_material_plan', '发料计划', true), order_line_id: reference('forge_subcontract_order_line', '用于加工件', true),
  sku_id: reference('forge_material_sku', '物料规格', true), warehouse_id: reference('forge_warehouse', '来源仓库', true),
  item_code: text('物料编号', true), specification: text('规格'), unit_name: text('单位', true),
  planned_quantity: quantity('订单计划数量', true), remaining_snapshot: quantity('创建时待发数量', true), issue_quantity: Field.number({ label: '本次发料', min: 0.0001, scale: 4, ...required }),
  batch_number: text('追溯批次'), reserved_quantity: quantity('已锁定数量', true), outbounded_quantity: quantity('已出库数量', true),
  unit_cost: money('出库单位成本', true), inventory_amount: money('出库金额', true),
  status: select('明细状态', [['draft','草稿'],['reserved','已锁定'],['outbounded','已出库'],['signed','已签收'],['cancelled','已取消']], 'draft'), remarks: remarks(),
}, ['issue_id','order_id','item_code','name','specification','warehouse_id','planned_quantity','remaining_snapshot','issue_quantity','batch_number','reserved_quantity','outbounded_quantity','status']);

export const SubcontractOutbound = master('forge_subcontract_outbound', '委外出库单', 'truck', {
  name: text('出库单名称', true), code: code('出库单号'), issue_id: reference('forge_subcontract_issue', '委外发料单', true),
  order_id: reference('forge_subcontract_order', '委外订单', true), supplier_id: reference('forge_supplier', '委外供应商', true),
  warehouse_id: reference('forge_warehouse', '出库仓库', true), total_quantity: quantity('出库数量', true),
  status: select('出库状态', [['pending','待出库'],['outbounded','已出库']], 'pending'),
  outbounded_by: Field.user({ label: '出库人', readonly: true }), outbounded_at: Field.datetime({ label: '出库时间', readonly: true }), remarks: remarks(),
}, ['code','issue_id','order_id','supplier_id','warehouse_id','total_quantity','status','outbounded_at']);

export const SubcontractStockBalance = master('forge_subcontract_stock_balance', '委外厂库存', 'warehouse', {
  name: text('委外库存名称', true), balance_key: code('委外库存键'), supplier_id: reference('forge_supplier', '委外供应商', true),
  order_id: reference('forge_subcontract_order', '委外订单', true), sku_id: reference('forge_material_sku', '物料规格', true),
  cumulative_issued_quantity: quantity('累计已发', true), backflushed_quantity: quantity('倒冲耗用', true), returned_quantity: quantity('累计退料', true),
  on_hand_quantity: quantity('在外余量', true), unit_cost: money('最近发料成本', true), inventory_value: money('在外库存金额', true),
  last_movement_at: Field.datetime({ label: '最近变动时间', readonly: true }),
}, ['supplier_id','order_id','sku_id','cumulative_issued_quantity','backflushed_quantity','returned_quantity','on_hand_quantity','unit_cost','inventory_value','last_movement_at']);

export const SubcontractStockLedger = master('forge_subcontract_stock_ledger', '委外库存流水', 'book-open', {
  name: text('流水名称', true), code: code('流水号'), supplier_id: reference('forge_supplier', '委外供应商', true),
  order_id: reference('forge_subcontract_order', '委外订单', true), sku_id: reference('forge_material_sku', '物料规格', true),
  direction: select('变动方向', [['inbound','入委外仓'],['outbound','出委外仓']]),
  movement_type: select('流水类型', [['issue_inbound','委外发料入仓'],['backflush','回厂倒冲'],['material_return','余料退回']]),
  quantity: Field.number({ label: '变动数量', min: 0.0001, scale: 4, ...required }), before_on_hand: quantity('变动前在外'), after_on_hand: quantity('变动后在外'),
  unit_cost: money('单位成本'), amount: money('金额'), occurred_at: Field.datetime({ label: '发生时间', ...required }),
  source_object: text('来源对象', true), source_id: text('来源记录 ID', true), source_line_id: text('来源明细 ID'), responsible_id: owner(true), remarks: remarks(),
}, ['code','occurred_at','supplier_id','order_id','sku_id','direction','movement_type','quantity','before_on_hand','after_on_hand','source_object','source_id']);

// RM-086: supplier-side material returns stay in a pending inbound document
// until the source warehouse confirms the physical receipt.
export const SubcontractReturn = master('forge_subcontract_return', '委外退料单', 'undo-2', {
  name: text('退料单名称', true), code: code('退料单号'), order_id: reference('forge_subcontract_order', '关联委外订单', true),
  supplier_id: reference('forge_supplier', '委外供应商', true), return_on: Field.date({ label: '退料日期', ...required }),
  handler_id: Field.user({ label: '经办人', ...required }), warehouse_id: reference('forge_warehouse', '入库仓库', true),
  reason_setting_id: reference('forge_subcontract_business_setting', '退料原因配置'),
  reason: select('退料原因', [['excess_material','余料退回'],['engineering_change','工程变更'],['usable_scrap','可用废料回收'],['wrong_material','错发退回'],['other','其他']], 'excess_material'),
  line_count: Field.number({ label: '物料种数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  total_quantity: quantity('退料数量', true), total_amount: money('退料金额', true),
  status: select('退料状态', [['draft','草稿'],['pending_inbound','待入库'],['stocked','已入库'],['cancelled','已作废']], 'draft'),
  inbound_id: reference('forge_subcontract_return_inbound', '关联入库单'), confirmed_by: Field.user({ label: '确认人', readonly: true }),
  confirmed_at: Field.datetime({ label: '确认时间', readonly: true }), stocked_by: Field.user({ label: '入库人', readonly: true }),
  stocked_at: Field.datetime({ label: '入库时间', readonly: true }), responsible_id: owner(true), remarks: remarks(),
}, ['code','supplier_id','order_id','return_on','reason_setting_id','reason','line_count','total_quantity','total_amount','status','inbound_id']);

export const SubcontractReturnLine = master('forge_subcontract_return_line', '委外退料明细', 'list', {
  name: text('物料名称', true), return_id: reference('forge_subcontract_return', '退料单', true), order_id: reference('forge_subcontract_order', '委外订单', true),
  plan_id: reference('forge_subcontract_material_plan', '发料计划', true), sku_id: reference('forge_material_sku', '物料规格', true), warehouse_id: reference('forge_warehouse', '入库仓库', true),
  item_code: text('物料编号', true), specification: text('规格'), unit_name: text('单位', true), available_quantity: quantity('可退余量', true),
  requested_quantity: Field.number({ label: '退料数量', min: 0.0001, scale: 4, ...required }), confirmed_quantity: quantity('已确认退料', true),
  batch_number: text('退料批次'), unit_cost: money('单位成本', true), amount: money('退料金额', true),
  status: select('明细状态', [['draft','草稿'],['pending_inbound','待入库'],['stocked','已入库'],['cancelled','已取消']], 'draft'), remarks: remarks(),
}, ['return_id','order_id','item_code','name','specification','available_quantity','requested_quantity','confirmed_quantity','unit_cost','amount','status']);

export const SubcontractReturnInbound = master('forge_subcontract_return_inbound', '委外退料待入库单', 'package-plus', {
  name: text('入库单名称', true), code: code('退料入库单号'), return_id: reference('forge_subcontract_return', '委外退料单', true),
  order_id: reference('forge_subcontract_order', '委外订单', true), supplier_id: reference('forge_supplier', '委外供应商', true), warehouse_id: reference('forge_warehouse', '入库仓库', true),
  total_quantity: quantity('待入库数量', true), total_amount: money('退料金额', true), status: select('入库状态', [['pending','待入库'],['stocked','已入库'],['cancelled','已取消']], 'pending'),
  created_by: Field.user({ label: '生成人', readonly: true }), created_at_business: Field.datetime({ label: '生成时间', readonly: true }),
  stocked_by: Field.user({ label: '入库人', readonly: true }), stocked_at: Field.datetime({ label: '入库时间', readonly: true }), remarks: remarks(),
}, ['code','return_id','supplier_id','warehouse_id','total_quantity','total_amount','status']);

export const SubcontractReturnInboundLine = master('forge_subcontract_return_inbound_line', '委外退料入库明细', 'list', {
  name: text('物料名称', true), inbound_id: reference('forge_subcontract_return_inbound', '退料入库单', true), return_line_id: reference('forge_subcontract_return_line', '退料明细', true),
  order_id: reference('forge_subcontract_order', '委外订单', true), plan_id: reference('forge_subcontract_material_plan', '发料计划', true), sku_id: reference('forge_material_sku', '物料规格', true), warehouse_id: reference('forge_warehouse', '入库仓库', true),
  item_code: text('物料编号', true), specification: text('规格'), unit_name: text('单位', true), quantity: quantity('入库数量', true), batch_number: text('批次号'),
  unit_cost: money('单位成本', true), amount: money('入库金额', true), status: select('明细状态', [['pending','待入库'],['stocked','已入库'],['cancelled','已取消']], 'pending'),
}, ['inbound_id','return_line_id','item_code','name','quantity','unit_cost','amount','warehouse_id','status']);

export const SubcontractReturnLog = master('forge_subcontract_return_log', '委外退料操作记录', 'history', {
  name: text('记录名称', true), return_id: reference('forge_subcontract_return', '退料单', true),
  action: select('操作', [['created','保存草稿'],['confirmed','确认退料'],['stocked','完成入库']]), from_status: text('原状态'), to_status: text('新状态'),
  comment: Field.textarea({ label: '说明' }), occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['return_id','action','from_status','to_status','comment','operator_id','occurred_at']);

export const SubcontractIssueLog = master('forge_subcontract_issue_log', '委外发料操作记录', 'history', {
  name: text('记录名称', true), issue_id: reference('forge_subcontract_issue', '委外发料单', true),
  action: select('操作', [['warning_released','超量提醒放行'],['submitted','提交审核'],['approved','审核通过'],['rejected','审核驳回'],['issued','确认出库'],['signed','供应商签收']]),
  from_status: text('原状态'), to_status: text('新状态'), comment: Field.textarea({ label: '说明' }),
  occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['issue_id','action','from_status','to_status','comment','operator_id','occurred_at']);

// Live RISEMAP /subcontract/receives and /subcontract/receives/new, plus the
// V1.2.3 community release notes. Submission records inspection quantities,
// consumes supplier-side material by BOM (including overconsumption), updates
// order progress and creates a pending warehouse inbound for qualified output.
export const SubcontractReceipt = master('forge_subcontract_receipt', '委外回厂单', 'package-check', {
  name: text('回厂单名称', true), code: code('回厂记录号'), order_id: reference('forge_subcontract_order', '关联委外订单', true),
  supplier_id: reference('forge_supplier', '外协厂商', true), receipt_on: Field.date({ label: '回厂日期', ...required }),
  inspector_id: Field.user({ label: '质检员', ...required }), warehouse_id: reference('forge_warehouse', '待入库仓库', true),
  line_count: Field.number({ label: '加工件种数', min: 0, scale: 0, defaultValue: 0, readonly: true }), total_received_quantity: quantity('本次回厂', true),
  qualified_quantity: quantity('合格数量', true), defective_quantity: quantity('不良数量', true), yield_rate: Field.number({ label: '本次良率（%）', min: 0, max: 100, scale: 4, readonly: true }),
  ncr_count: Field.number({ label: '关联 NCR 数量', min: 0, scale: 0, defaultValue: 0, readonly: true }), ncr_resolved_count: Field.number({ label: '已处置 NCR 数量', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  standard_material_quantity: quantity('BOM 标准耗用', true), actual_material_quantity: quantity('材料实际耗用', true), overconsumption_quantity: quantity('本次超耗', true),
  settlement_amount: money('本次可结算加工费', true), status: select('回厂状态', [['draft','草稿'],['pending_inbound','待入库'],['inspection_exception','不良待处理'],['stocked','已入库'],['ncr_resolved','不良已处置'],['cancelled','已作废']], 'draft'),
  inbound_id: reference('forge_subcontract_inbound', '关联入库单'), submitted_by: Field.user({ label: '提交人', readonly: true }), submitted_at: Field.datetime({ label: '提交时间', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code','supplier_id','order_id','receipt_on','inspector_id','total_received_quantity','qualified_quantity','defective_quantity','yield_rate','settlement_amount','status','inbound_id']);

export const SubcontractReceiptLine = master('forge_subcontract_receipt_line', '委外回厂加工件', 'list', {
  name: text('物料名称', true), receipt_id: reference('forge_subcontract_receipt', '委外回厂单', true), order_id: reference('forge_subcontract_order', '委外订单', true),
  order_line_id: reference('forge_subcontract_order_line', '委外加工件', true), sku_id: reference('forge_material_sku', '物料规格', true),
  warehouse_id: reference('forge_warehouse', '待入库仓库', true), item_code: text('物料编号', true), specification: text('规格'), unit_name: text('单位', true),
  ordered_quantity: quantity('订单数量', true), remaining_snapshot: quantity('创建时未回数量', true), received_quantity: Field.number({ label: '本次回厂', min: 0.0001, scale: 4, ...required }),
  qualified_quantity: quantity('合格数量', true), defective_quantity: quantity('不良数量', true), batch_number: text('批次号'),
  ncr_id: reference('forge_subcontract_ncr', '关联 NCR'),
  processing_unit_price: money('加工单价', true), settlement_amount: money('可结算加工费', true),
  status: select('明细状态', [['draft','草稿'],['pending_inbound','待入库'],['inspection_exception','不良待处理'],['stocked','已入库'],['cancelled','已作废']], 'draft'), remarks: remarks(),
}, ['receipt_id','order_id','item_code','name','specification','ordered_quantity','remaining_snapshot','received_quantity','qualified_quantity','defective_quantity','processing_unit_price','settlement_amount','warehouse_id','batch_number','status']);

export const SubcontractReceiptConsumption = master('forge_subcontract_receipt_consumption', '委外回厂材料耗用', 'boxes', {
  name: text('材料名称', true), receipt_id: reference('forge_subcontract_receipt', '委外回厂单', true), order_id: reference('forge_subcontract_order', '委外订单', true),
  receipt_line_id: reference('forge_subcontract_receipt_line', '回厂加工件', true), plan_id: reference('forge_subcontract_material_plan', '委外发料计划', true),
  sku_id: reference('forge_material_sku', '材料规格', true), item_code: text('材料编号', true), specification: text('规格'), unit_name: text('单位', true),
  standard_quantity: quantity('本批 BOM 标准耗用', true), actual_quantity: Field.number({ label: '本批实际耗用', min: 0, scale: 4, ...required }),
  overconsumption_quantity: quantity('本批超耗', true), unit_cost: money('材料单位成本', true), amount: money('材料耗用金额', true),
  status: select('耗用状态', [['draft','草稿'],['pending_backflush','待倒冲'],['backflushed','已倒冲'],['cancelled','已取消']], 'draft'), remarks: remarks(),
}, ['receipt_id','order_id','receipt_line_id','item_code','name','specification','standard_quantity','actual_quantity','overconsumption_quantity','unit_cost','amount','status']);

export const SubcontractInbound = master('forge_subcontract_inbound', '委外待入库单', 'package-plus', {
  name: text('入库单名称', true), code: code('委外入库单号'), receipt_id: reference('forge_subcontract_receipt', '委外回厂单', true),
  order_id: reference('forge_subcontract_order', '委外订单', true), supplier_id: reference('forge_supplier', '委外供应商', true),
  warehouse_id: reference('forge_warehouse', '入库仓库', true), total_quantity: quantity('待入库良品', true),
  processing_amount: money('良品加工费', true), material_amount: money('实际材料成本', true), inventory_amount: money('成品入库金额', true),
  valuation_status: select('计价状态', [['processing_only','仅核定加工费'],['fully_costed','完整成本已核定']], 'processing_only'),
  status: select('入库状态', [['pending','待入库'],['stocked','已入库'],['cancelled','已取消']], 'pending'),
  created_by: Field.user({ label: '生成人', readonly: true }), created_at_business: Field.datetime({ label: '生成时间', readonly: true }),
  stocked_by: Field.user({ label: '入库人', readonly: true }), stocked_at: Field.datetime({ label: '入库时间', readonly: true }), remarks: remarks(),
}, ['code','receipt_id','order_id','supplier_id','warehouse_id','total_quantity','processing_amount','material_amount','inventory_amount','valuation_status','status']);

export const SubcontractInboundLine = master('forge_subcontract_inbound_line', '委外待入库明细', 'list', {
  name: text('物料名称', true), inbound_id: reference('forge_subcontract_inbound', '委外入库单', true), receipt_line_id: reference('forge_subcontract_receipt_line', '回厂加工件', true),
  order_line_id: reference('forge_subcontract_order_line', '委外加工件', true), sku_id: reference('forge_material_sku', '物料规格', true), warehouse_id: reference('forge_warehouse', '入库仓库', true),
  item_code: text('物料编号', true), specification: text('规格'), unit_name: text('单位', true), qualified_quantity: quantity('待入库良品', true),
  batch_number: text('批次号'), processing_unit_price: money('加工单价', true), processing_amount: money('良品加工费', true),
  material_amount: money('实际材料成本', true), unit_cost: money('成品单位成本', true), inventory_amount: money('成品入库金额', true),
  before_on_hand: quantity('入库前库存'), after_on_hand: quantity('入库后库存'), status: select('明细状态', [['pending','待入库'],['stocked','已入库'],['cancelled','已取消']], 'pending'),
}, ['inbound_id','item_code','name','specification','qualified_quantity','processing_unit_price','processing_amount','material_amount','unit_cost','inventory_amount','warehouse_id','batch_number','status']);

export const SubcontractReceiptLog = master('forge_subcontract_receipt_log', '委外回厂操作记录', 'history', {
  name: text('记录名称', true), receipt_id: reference('forge_subcontract_receipt', '委外回厂单', true),
  action: select('操作', [['warning_released','超量提醒放行'],['submitted','提交回厂'],['inbound_created','生成待入库'],['exception_recorded','登记不良'],['stocked','完成入库'],['cancelled','作废']]),
  from_status: text('原状态'), to_status: text('新状态'), comment: Field.textarea({ label: '说明' }),
  occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['receipt_id','action','from_status','to_status','comment','operator_id','occurred_at']);

// RM-087/RM-093: production-side settlement freezes eligible receipt batches
// before handing an approved payable to the finance payment flow.
export const SubcontractReconciliation = master('forge_subcontract_reconciliation', '委外对账单', 'file-check-2', {
  name: text('对账单名称', true), code: code('委外对账单号'), supplier_id: reference('forge_supplier', '供应商', true),
  period_start: Field.date({ label: '账期开始', ...required }), period_end: Field.date({ label: '账期结束', ...required }),
  generation_dimension: select('生成维度', [['receipt_batch','按回厂批次'],['order','按委外订单'],['supplier','按供应商']], 'receipt_batch'),
  processing_amount: money('加工费'), replenishment_amount: money('补料费用'), deduction_amount: money('扣款'), refund_amount: money('退款'),
  payable_amount: money('应付金额'), line_count: Field.number({ label: '费用行数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  status: select('对账状态', [['pending_confirmation','待确认'],['confirmed','已确认'],['payable_generated','已生成应付'],['voided','已作废']], 'pending_confirmation'),
  payable_id: reference('forge_accounts_payable', '关联应付'), confirmed_by: Field.user({ label: '确认人', readonly: true }),
  confirmed_at: Field.datetime({ label: '确认时间', readonly: true }), confirmation_note: Field.textarea({ label: '确认说明', readonly: true }),
  payable_generated_by: Field.user({ label: '应付生成人', readonly: true }), payable_generated_at: Field.datetime({ label: '应付生成时间', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code','supplier_id','period_start','period_end','generation_dimension','processing_amount','replenishment_amount','deduction_amount','refund_amount','payable_amount','status','payable_id','responsible_id']);

export const SubcontractReconciliationLine = master('forge_subcontract_reconciliation_line', '委外对账费用明细', 'list', {
  name: text('费用明细名称', true), reconciliation_id: reference('forge_subcontract_reconciliation', '委外对账单', true),
  supplier_id: reference('forge_supplier', '供应商', true), order_id: reference('forge_subcontract_order', '委外订单', true),
  receipt_id: reference('forge_subcontract_receipt', '回厂单', true), receipt_line_id: reference('forge_subcontract_receipt_line', '回厂明细', true),
  fee_type: select('费用类型', [['processing','加工费'],['replenishment','补料费用'],['deduction','损耗赔偿'],['refund','退款']], 'processing'),
  occurred_on: Field.date({ label: '业务日期', ...required }), quantity: quantity('数量'), unit_price: money('单价'), amount: money('金额'),
  source_status_snapshot: text('来源状态快照'), source_key: code('来源唯一键'), description: text('费用说明'), responsible_id: owner(true), remarks: remarks(),
}, ['reconciliation_id','supplier_id','order_id','receipt_id','receipt_line_id','fee_type','occurred_on','quantity','unit_price','amount','source_status_snapshot','source_key','description']);

export const SubcontractReconciliationLog = master('forge_subcontract_reconciliation_log', '委外对账操作记录', 'history', {
  name: text('记录名称', true), reconciliation_id: reference('forge_subcontract_reconciliation', '委外对账单', true),
  action: select('操作', [['generated','生成'],['confirmed','确认锁定'],['payable_generated','生成应付'],['voided','作废']], 'generated'),
  from_status: text('原状态'), to_status: text('新状态'), comment: Field.textarea({ label: '说明' }),
  occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['reconciliation_id','action','from_status','to_status','comment','operator_id','occurred_at']);
