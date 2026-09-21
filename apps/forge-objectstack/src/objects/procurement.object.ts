import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, owner, remarks, required } from '../model.js';

const select = (label: string, options: Array<[string, string]>, defaultValue?: string) => Field.select(
  options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
  { label, ...(defaultValue ? { defaultValue } : {}) },
);
const positiveQuantity = (label = '数量') => Field.number({ label, min: 0.0001, scale: 4, ...required });
const nonNegativeQuantity = (label: string, readonly = false) => Field.number({ label, min: 0, scale: 4, defaultValue: 0, ...(readonly ? { readonly: true } : {}) });
const nonNegativeMoney = (label: string, scale = 4) => Field.currency({ label, precision: 18, scale, min: 0 });
const percentage = (label: string, defaultValue = 13) => Field.number({ label, min: 0, max: 100, scale: 4, defaultValue });

// Live RISEMAP /inventory/inspection-rules exposes a reusable inspection item
// library and inspection plans. These records are configuration sources for
// later receipt inspection rather than inspection results themselves.
export const InspectionRuleItem = master('forge_inspection_rule_item', '检验项目', 'list-checks', {
  name: text('项目名称', true), code: code('项目编码'),
  category: select('项目分类', [['incoming', '来料检验(IQC)'], ['subcontract', '外协检验'], ['finished', '成品检验']], 'incoming'),
  judgment_type: select('判定类型', [['result', '结果型'], ['numeric', '数值型'], ['option', '选项型'], ['text', '文本型'], ['attachment', '附件型']], 'result'),
  inspection_types: text('适用检验类型', true), unit_name: text('单位'),
  result_options: Field.textarea({ label: '结果选项' }), default_pass_option: text('默认合格项'),
  requirement: Field.textarea({ label: '检验要求说明' }),
  required_inspection: Field.boolean({ label: '是否必检', defaultValue: true }),
  affects_batch_result: Field.boolean({ label: '影响整批结论', defaultValue: false }),
  allow_skip: Field.boolean({ label: '允许跳过', defaultValue: false }),
  attachment_required: Field.boolean({ label: '附件上传', defaultValue: false }),
  allow_exception_note: Field.boolean({ label: '允许异常备注', defaultValue: true }),
  defect_level: select('缺陷等级', [['critical', '致命'], ['major', '严重'], ['minor', '轻微']], 'major'),
  allow_concession: Field.boolean({ label: '允许让步接收', defaultValue: false }),
  trigger_ncr: Field.boolean({ label: '触发异常处理', defaultValue: false }),
  reference_standard: Field.textarea({ label: '参考标准说明' }),
  status: select('启用状态', [['active', '启用'], ['inactive', '停用']], 'active'), remarks: remarks(),
}, ['code', 'name', 'category', 'judgment_type', 'inspection_types', 'unit_name', 'required_inspection', 'affects_batch_result', 'status']);

export const InspectionPlan = master('forge_inspection_plan', '检验方案', 'clipboard-list', {
  name: text('方案名称', true), code: code('方案编码'),
  inspection_type: select('检验类型', [['incoming', '来料检验'], ['subcontract', '外协检验'], ['finished', '成品检验']], 'incoming'),
  inspection_method: select('默认检验方式', [['full', '全检'], ['sampling', '抽检'], ['exempt', '免检']], 'full'),
  scope_type: select('适用方式', [['material', '指定物料'], ['category', '物料分类'], ['supplier', '指定供应商']], 'category'),
  scope_value: text('适用范围'), item_count: Field.number({ label: '检验项目数', min: 0, scale: 0, defaultValue: 0 }),
  status: select('启用状态', [['active', '启用'], ['inactive', '停用']], 'active'), remarks: remarks(),
}, ['code', 'name', 'inspection_type', 'inspection_method', 'scope_type', 'scope_value', 'item_count', 'status']);

export const InspectionPlanItem = master('forge_inspection_plan_item', '检验方案项目', 'list-tree', {
  name: text('项目名称快照', true), plan_id: reference('forge_inspection_plan', '检验方案', true),
  item_id: reference('forge_inspection_rule_item', '检验项目', true), sequence: Field.number({ label: '顺序', min: 1, scale: 0, defaultValue: 1 }),
  requirement_override: Field.textarea({ label: '检验要求覆盖' }), required_override: Field.boolean({ label: '本方案必检', defaultValue: true }),
}, ['plan_id', 'sequence', 'item_id', 'name', 'required_override']);

// RISEMAP purchase basic data supplies the enabled payment conditions used by
// purchase and subcontract orders. Business documents keep the readable name
// as a snapshot while this record controls whether a new order may submit.
export const PaymentCondition = master('forge_payment_condition', '付款条件', 'calendar-clock', {
  name: text('付款条件名称', true), code: code('付款条件编码'),
  settlement_basis: select('起算节点', [
    ['order_approved', '订单审核通过'], ['goods_received', '到货验收'], ['inventory_inbound', '确认入库'], ['invoice_received', '收到发票'],
  ], 'inventory_inbound'),
  payment_days: Field.number({ label: '账期（天）', min: 0, scale: 0, defaultValue: 30 }),
  description: Field.textarea({ label: '条款说明' }),
  status: select('状态', [['active', '启用'], ['inactive', '停用']], 'active'),
  remarks: remarks(),
}, ['code', 'name', 'settlement_basis', 'payment_days', 'status', 'description']);

// Live RISEMAP /purchase/requests: independent request header and material-detail views.
export const PurchaseRequest = master('forge_purchase_request', '采购申请', 'file-plus-2', {
  name: text('申请标题', true), code: code('申请编号'),
  priority: select('优先级', [['high', '高'], ['medium', '中'], ['low', '低']], 'medium'),
  project_id: reference('forge_project', '关联项目'), customer_id: reference('forge_customer', '关联客户'),
  responsible_id: owner(true), suggested_supplier_id: reference('forge_supplier', '建议供应商'),
  currency: select('币种', [['cny', '人民币'], ['usd', '美元'], ['eur', '欧元']], 'cny'),
  request_on: Field.date({ label: '申请日期', ...required }), expected_arrival_on: Field.date({ label: '期望到货日期', ...required }),
  purchase_reason: Field.textarea({ label: '采购原因', ...required }),
  line_count: Field.number({ label: '物料数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  total_quantity: nonNegativeQuantity('总数量', true), estimated_taxed_amount: nonNegativeMoney('预估含税金额'),
  status: { ...select('状态', [
    ['draft', '草稿'], ['pending_approval', '审批中'], ['approved', '已通过'], ['rejected', '已驳回'],
    ['converted', '已转采购'], ['cancelled', '已取消'],
  ], 'draft'), readonly: true },
  submitted_at: Field.datetime({ label: '提交时间', readonly: true }), submitted_by: Field.user({ label: '提交人', readonly: true }),
  approved_at: Field.datetime({ label: '审批时间', readonly: true }), approved_by: Field.user({ label: '审批人', readonly: true }),
  approval_comment: Field.textarea({ label: '审批意见', readonly: true }), remarks: remarks(),
}, ['code', 'name', 'priority', 'project_id', 'customer_id', 'responsible_id', 'line_count', 'total_quantity', 'estimated_taxed_amount', 'currency', 'expected_arrival_on', 'suggested_supplier_id', 'status', 'request_on']);

export const PurchaseRequestLine = master('forge_purchase_request_line', '采购申请明细', 'list', {
  name: text('物料名称', true), request_id: reference('forge_purchase_request', '采购申请', true),
  entry_mode: select('明细来源', [['library', '物料库'], ['manual', '手动录入'], ['paste', '快速粘贴']], 'library'),
  sku_id: reference('forge_material_sku', '物料规格'), item_code: text('物料编码'), model: text('型号'),
  specification: text('规格'), category_name: text('物料分类'), unit_name: text('单位'), quantity: positiveQuantity(),
  taxed_unit_price: nonNegativeMoney('预估含税单价'), tax_rate: percentage('税率'), taxed_subtotal: nonNegativeMoney('预估含税小计'),
  expected_arrival_on: Field.date({ label: '期望到货日期' }), suggested_supplier_id: reference('forge_supplier', '建议供应商'), remarks: remarks(),
}, ['request_id', 'entry_mode', 'item_code', 'name', 'model', 'specification', 'category_name', 'unit_name', 'quantity', 'taxed_unit_price', 'tax_rate', 'taxed_subtotal', 'expected_arrival_on', 'suggested_supplier_id']);

export const PurchaseRequestApprovalLog = master('forge_purchase_request_approval_log', '采购申请审批记录', 'history', {
  name: text('记录名称', true), request_id: reference('forge_purchase_request', '采购申请', true),
  action: select('动作', [['submitted', '提交审批'], ['approved', '审批通过'], ['rejected', '审批驳回'], ['cancelled', '取消']]),
  from_status: text('原状态'), to_status: text('新状态'), comment: Field.textarea({ label: '意见' }),
  occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['request_id', 'action', 'from_status', 'to_status', 'comment', 'operator_id', 'occurred_at']);

export const PurchaseInquiry = master('forge_purchase_inquiry', '询价单', 'messages-square', {
  name: text('询价标题', true), code: code('询价单号'), source_type: select('来源', [['purchase_request', '采购申请'], ['sales_contract', '销售合同'], ['manual', '手工创建'], ['shortage', '缺料分析']], 'manual'),
  project_id: reference('forge_project', '关联项目'), purchase_request_id: reference('forge_purchase_request', '来源采购申请'),
  sales_contract_id: reference('forge_sales_contract', '来源销售合同'),
  responsible_id: owner(true), supplier_count: Field.number({ label: '供应商数', min: 0, scale: 0, defaultValue: 0 }), line_count: Field.number({ label: '物料数', min: 0, scale: 0, defaultValue: 0 }),
  due_on: Field.date({ label: '报价截止日期', ...required }), selected_quote_id: reference('forge_purchase_inquiry_quote', '中选报价'),
  converted_order_id: reference('forge_purchase_order', '转入采购单'), published_at: Field.datetime({ label: '发布时间' }),
  compared_at: Field.datetime({ label: '确认比价时间' }), converted_at: Field.datetime({ label: '转采购单时间' }),
  status: select('状态', [['draft', '待发布'], ['published', '报价中'], ['compared', '已完成比价'], ['converted', '已转采购单'], ['closed', '已关闭']], 'draft'),
  remarks: remarks(),
}, ['code', 'name', 'source_type', 'project_id', 'responsible_id', 'supplier_count', 'line_count', 'due_on', 'status', 'converted_order_id']);

export const PurchaseInquiryLine = master('forge_purchase_inquiry_line', '询价物料', 'list', {
  name: text('物料名称', true), inquiry_id: reference('forge_purchase_inquiry', '询价单', true),
  sku_id: reference('forge_material_sku', '物料规格'), item_code: text('物料编码'), model: text('型号'),
  specification: text('规格'), unit_name: text('单位'), quantity: positiveQuantity('询价数量'),
  required_on: Field.date({ label: '需求日期' }), purchase_request_line_id: reference('forge_purchase_request_line', '来源申请明细'),
  sales_contract_line_id: reference('forge_sales_contract_line', '来源合同明细'), remarks: remarks(),
}, ['inquiry_id', 'item_code', 'name', 'model', 'specification', 'quantity', 'unit_name', 'required_on']);

export const PurchaseInquiryQuote = master('forge_purchase_inquiry_quote', '供应商询价报价', 'badge-yen', {
  name: text('报价名称', true), code: code('报价编号'), inquiry_id: reference('forge_purchase_inquiry', '询价单', true),
  supplier_id: reference('forge_supplier', '供应商', true), currency: select('币种', [['cny', '人民币'], ['usd', '美元'], ['eur', '欧元']], 'cny'),
  total_amount: nonNegativeMoney('含税总额'), lead_days: Field.number({ label: '交期（天）', min: 0, scale: 0, defaultValue: 0 }),
  valid_until: Field.date({ label: '报价有效期' }), payment_term: text('付款条件'),
  status: select('报价状态', [['invited', '待报价'], ['submitted', '已报价'], ['selected', '已中选'], ['declined', '未中选']], 'invited'),
  submitted_at: Field.datetime({ label: '报价时间' }), remarks: remarks(),
}, ['code', 'inquiry_id', 'supplier_id', 'total_amount', 'lead_days', 'valid_until', 'payment_term', 'status']);

export const PurchaseInquiryQuoteLine = master('forge_purchase_inquiry_quote_line', '供应商报价明细', 'rows-3', {
  name: text('物料名称', true), quote_id: reference('forge_purchase_inquiry_quote', '供应商报价', true),
  inquiry_line_id: reference('forge_purchase_inquiry_line', '询价物料', true), sku_id: reference('forge_material_sku', '物料规格', true),
  quantity: positiveQuantity('报价数量'), taxed_unit_price: nonNegativeMoney('含税单价'), tax_rate: percentage('税率'),
  taxed_subtotal: nonNegativeMoney('含税小计'), remarks: remarks(),
}, ['quote_id', 'inquiry_line_id', 'sku_id', 'name', 'quantity', 'taxed_unit_price', 'tax_rate', 'taxed_subtotal']);

export const SupplierPriceBook = master('forge_supplier_price_book', '供应商价格本', 'book-open', {
  name: text('价格本名称', true), code: code('价格本编号'), supplier_id: reference('forge_supplier', '供应商', true),
  currency: select('币种', [['cny', '人民币'], ['usd', '美元'], ['eur', '欧元']], 'cny'), valid_from: Field.date({ label: '生效日期' }), valid_to: Field.date({ label: '失效日期' }),
  discount_level1: percentage('一级折扣（%）', 0), discount_level2: percentage('二级折扣（%）', 0),
  line_count: Field.number({ label: '价格条目数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  status: select('状态', [['draft', '草稿'], ['active', '生效中'], ['expired', '已过期'], ['voided', '已废弃']], 'draft'),
  activated_at: Field.datetime({ label: '生效时间', readonly: true }), activated_by: Field.user({ label: '生效操作人', readonly: true }),
  void_reason: Field.textarea({ label: '废弃原因', readonly: true }), remarks: remarks(),
}, ['code', 'name', 'supplier_id', 'currency', 'valid_from', 'valid_to', 'discount_level1', 'discount_level2', 'line_count', 'status']);

export const SupplierPriceBookLine = master('forge_supplier_price_book_line', '供应商价格条目', 'badge-yen', {
  name: text('物料名称', true), price_book_id: reference('forge_supplier_price_book', '价格本', true),
  sku_id: reference('forge_material_sku', '物料规格', true), item_code: text('物料编码'), model: text('型号'),
  specification: text('规格'), unit_name: text('单位'), catalog_price: nonNegativeMoney('目录价'),
  discount_level1: percentage('一级折扣（%）', 0), discount_level2: percentage('二级折扣（%）', 0),
  net_price: nonNegativeMoney('协议净价'), minimum_quantity: positiveQuantity('最小起订量'),
  valid_from: Field.date({ label: '生效日期' }), valid_to: Field.date({ label: '失效日期' }), remarks: remarks(),
}, ['price_book_id', 'item_code', 'name', 'model', 'specification', 'unit_name', 'catalog_price', 'discount_level1', 'discount_level2', 'net_price', 'minimum_quantity', 'valid_from', 'valid_to']);

export const SupplierPriceBookStatusLog = master('forge_supplier_price_book_status_log', '价格本状态记录', 'history', {
  name: text('记录名称', true), price_book_id: reference('forge_supplier_price_book', '价格本', true),
  action: select('动作', [['activated', '生效'], ['voided', '废弃']]), from_status: text('原状态'), to_status: text('新状态'),
  comment: Field.textarea({ label: '处理意见' }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
  occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }),
}, ['price_book_id', 'action', 'from_status', 'to_status', 'comment', 'operator_id', 'occurred_at']);

export const SupplierPriceBookBatchTask = master('forge_supplier_price_book_batch_task', '价格本批量任务', 'file-stack', {
  name: text('任务名称', true), price_book_id: reference('forge_supplier_price_book', '价格本'),
  direction: select('任务方向', [['import', '导入'], ['export', '导出']]), file_name: text('文件名'),
  total_rows: Field.number({ label: '总行数', min: 0, scale: 0, defaultValue: 0 }),
  success_rows: Field.number({ label: '成功行数', min: 0, scale: 0, defaultValue: 0 }),
  failed_rows: Field.number({ label: '失败行数', min: 0, scale: 0, defaultValue: 0 }),
  status: select('任务状态', [['processing', '处理中'], ['completed', '已完成'], ['failed', '失败']], 'processing'),
  message: Field.textarea({ label: '处理结果' }), operator_id: Field.user({ label: '操作人', readonly: true }),
  completed_at: Field.datetime({ label: '完成时间', readonly: true }),
}, ['direction', 'name', 'price_book_id', 'file_name', 'total_rows', 'success_rows', 'failed_rows', 'status', 'completed_at']);

// RISEMAP /purchase/pending-pool splits an approved request into material-line
// tasks. Quantities remain on this durable allocation layer while orders and
// RFQs are created in batches, so partial procurement never loses its source.
export const PurchasePendingItem = master('forge_purchase_pending_item', '采购待办', 'list-todo', {
  name: text('物料名称', true), code: code('池编号'),
  request_id: reference('forge_purchase_request', '来源申请', true),
  request_line_id: reference('forge_purchase_request_line', '来源申请明细', true),
  request_code: text('来源单号', true), line_number: Field.number({ label: '行号', min: 1, scale: 0, ...required }),
  applicant_id: Field.user({ label: '申请人' }), department_name: text('申请部门'),
  project_id: reference('forge_project', '项目/工单'), item_code: text('物料编码'), model: text('型号'),
  specification: text('规格'), unit_name: text('单位'),
  requested_quantity: positiveQuantity('申请数量'), locked_quantity: nonNegativeQuantity('已锁定'),
  ordered_quantity: nonNegativeQuantity('已下单'), remaining_quantity: nonNegativeQuantity('剩余可下单'),
  suggested_supplier_id: reference('forge_supplier', '建议供应商'), assigned_supplier_id: reference('forge_supplier', '指定供应商'),
  inquiry_id: reference('forge_purchase_inquiry', '关联询价单'),
  purchase_category: text('采购分类'), required_on: Field.date({ label: '需求日期' }),
  requested_at: Field.datetime({ label: '申请时间', readonly: true }),
  priority: select('优先级', [['high', '高'], ['medium', '中'], ['low', '低']], 'medium'),
  status: select('状态', [
    ['ready', '待处理'], ['assigned', '已指定供应商'], ['inquiring', '询价中'],
    ['partially_ordered', '部分下单'], ['ordered', '已下单'], ['on_hold', '暂缓'], ['closed', '已关闭'],
  ], 'ready'),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'request_code', 'line_number', 'applicant_id', 'department_name', 'project_id', 'item_code', 'name', 'model', 'specification', 'unit_name', 'requested_quantity', 'locked_quantity', 'ordered_quantity', 'remaining_quantity', 'suggested_supplier_id', 'assigned_supplier_id', 'inquiry_id', 'purchase_category', 'required_on', 'requested_at', 'priority', 'status', 'responsible_id']);

// RM-021 / DR-0048 to DR-0050. The order is the commercial source for later arrival, inspection and inbound work.
export const PurchaseOrder = master('forge_purchase_order', '采购订单', 'shopping-cart', {
  name: text('订单名称', true), code: code('采购订单号'), supplier_id: reference('forge_supplier', '供应商', true),
  supplier_order_number: text('供应商单号'), source_type: select('采购来源', [
    ['inventory_replenishment', '库存补充'], ['project', '项目采购'], ['sales_driven', '以销定采'],
    ['bom_shortage', 'BOM缺料'], ['purchase_request', '采购申请'],
  ], 'inventory_replenishment'),
  bom_id: reference('forge_bom', '关联BOM'), shortage_analysis_id: reference('forge_bom_shortage_analysis', '缺料分析快照'),
  purchase_request_id: reference('forge_purchase_request', '来源采购申请'),
  project_id: reference('forge_project', '关联项目'), warehouse_id: reference('forge_warehouse', '目标仓库'),
  expected_arrival_on: Field.date({ label: '期望到货日期', ...required }), order_on: Field.date({ label: '下单日期' }),
  payment_condition_id: reference('forge_payment_condition', '付款条件配置'), payment_term: text('付款条件', true), payment_method: select('付款方式', [
    ['bank_transfer', '银行转账'], ['wire_transfer', '电汇'], ['bank_acceptance', '承兑汇票'],
    ['online_payment', '在线支付'], ['cash', '现金'], ['other', '其他'],
  ], 'bank_transfer'),
  currency: select('币种', [['cny', '人民币'], ['usd', '美元'], ['eur', '欧元']], 'cny'),
  exchange_rate: Field.number({ label: '汇率', min: 0.000001, scale: 6, defaultValue: 1 }),
  payable_trigger: select('应付产生方式', [['inbound', '按入库'], ['invoice', '按发票']], 'inbound'),
  settlement_on: Field.date({ label: '结算日期' }), arrival_address: text('到货地址'),
  responsible_id: owner(true), line_count: Field.number({ label: '物料数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  total_quantity: nonNegativeQuantity('采购总数量', true), total_amount: nonNegativeMoney('含税总额'),
  arrived_quantity: nonNegativeQuantity('已到货数量', true), inbound_quantity: nonNegativeQuantity('已入库数量', true),
  returned_quantity: nonNegativeQuantity('已退货数量', true), replenished_quantity: nonNegativeQuantity('换货补回数量', true),
  status: { ...select('订单状态', [
    ['draft', '草稿'], ['pending_approval', '待审核'], ['approved', '已审核'], ['partially_arrived', '部分到货'], ['arrived', '已到货'],
    ['completed', '已完成'], ['rejected', '已驳回'], ['cancelled', '已取消'],
  ], 'draft'), readonly: true },
  submitted_at: Field.datetime({ label: '提交时间', readonly: true }), submitted_by: Field.user({ label: '提交人', readonly: true }),
  approved_at: Field.datetime({ label: '审核时间', readonly: true }), approved_by: Field.user({ label: '审核人', readonly: true }), remarks: remarks(),
}, ['code', 'name', 'supplier_id', 'bom_id', 'purchase_request_id', 'expected_arrival_on', 'warehouse_id', 'total_amount', 'arrived_quantity', 'inbound_quantity', 'status', 'responsible_id']);

export const PurchaseOrderLine = master('forge_purchase_order_line', '采购订单明细', 'list', {
  name: text('物料名称', true), order_id: reference('forge_purchase_order', '采购订单', true),
  sku_id: reference('forge_material_sku', '物料规格', true), item_code: text('物料编码'), model: text('型号'),
  specification: text('规格'), unit_name: text('单位'), quantity: positiveQuantity(),
  arrived_quantity: nonNegativeQuantity('已到货数量', true), inspected_quantity: nonNegativeQuantity('已检验数量', true),
  accepted_quantity: nonNegativeQuantity('合格数量', true), inbound_quantity: nonNegativeQuantity('已入库数量', true),
  returned_quantity: nonNegativeQuantity('已退货数量', true), replenished_quantity: nonNegativeQuantity('换货补回数量', true),
  taxed_unit_price: nonNegativeMoney('含税单价'), untaxed_unit_price: nonNegativeMoney('不含税单价'),
  tax_rate: percentage('税率'), taxed_subtotal: nonNegativeMoney('含税小计'),
  source_bom_id: reference('forge_bom', '来源BOM'), source_analysis_line_id: reference('forge_bom_shortage_line', '来源缺料明细'),
  purchase_request_line_id: reference('forge_purchase_request_line', '来源采购申请明细'),
  expected_arrival_on: Field.date({ label: '期望到货日期' }), remarks: remarks(),
}, ['order_id', 'purchase_request_line_id', 'item_code', 'name', 'model', 'quantity', 'arrived_quantity', 'inspected_quantity', 'inbound_quantity', 'taxed_unit_price', 'taxed_subtotal']);

// Live RISEMAP evidence: approval produces one order-level notice with multiple material lines; it does not record physical receipt.
export const PurchaseArrivalNotice = master('forge_purchase_arrival_notice', '采购到货通知', 'package-search', {
  name: text('到货通知名称', true), code: code('到货通知号'), order_id: reference('forge_purchase_order', '采购订单', true),
  notice_type: select('通知类型', [['purchase_order', '采购订单到货'], ['purchase_replacement', '采购换货补货']], 'purchase_order'),
  purchase_return_id: reference('forge_purchase_return', '采购换货单'),
  order_line_id: reference('forge_purchase_order_line', '兼容首条订单明细', true), sku_id: reference('forge_material_sku', '兼容首条物料规格', true), item_code: text('兼容首条物料编码'),
  supplier_id: reference('forge_supplier', '供应商', true), warehouse_id: reference('forge_warehouse', '目标仓库'),
  expected_arrival_on: Field.date({ label: '预计到货日期', ...required }), line_count: Field.number({ label: '物料种类', min: 0, scale: 0, readonly: true }),
  planned_quantity: positiveQuantity('待到货总数量'), arrived_quantity: nonNegativeQuantity('已到货总数量', true),
  status: { ...select('到货状态', [
    ['pending_arrival', '待到货'], ['partially_arrived', '部分到货'], ['arrived', '已到货'], ['cancelled', '已取消'],
  ], 'pending_arrival'), readonly: true },
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'order_id', 'supplier_id', 'warehouse_id', 'expected_arrival_on', 'line_count', 'planned_quantity', 'arrived_quantity', 'status']);

export const PurchaseArrivalNoticeLine = master('forge_purchase_arrival_notice_line', '到货通知明细', 'list', {
  name: text('物料名称', true), notice_id: reference('forge_purchase_arrival_notice', '到货通知', true),
  purchase_return_id: reference('forge_purchase_return', '采购换货单'), purchase_return_line_id: reference('forge_purchase_return_line', '采购换货明细'),
  order_id: reference('forge_purchase_order', '采购订单', true), order_line_id: reference('forge_purchase_order_line', '采购订单明细', true),
  sku_id: reference('forge_material_sku', '物料规格', true), item_code: text('物料编码'), model: text('型号'),
  specification: text('规格'), unit_name: text('单位'), planned_quantity: positiveQuantity('待到货数量'),
  arrived_quantity: nonNegativeQuantity('已到货数量', true), status: { ...select('到货状态', [
    ['pending_arrival', '待到货'], ['partially_arrived', '部分到货'], ['arrived', '已到货'], ['cancelled', '已取消'],
  ], 'pending_arrival'), readonly: true },
}, ['notice_id', 'item_code', 'name', 'model', 'unit_name', 'planned_quantity', 'arrived_quantity', 'status']);

export const PurchaseOrderApprovalLog = master('forge_purchase_order_approval_log', '采购订单审批记录', 'history', {
  name: text('记录名称', true), order_id: reference('forge_purchase_order', '采购订单', true),
  action: select('审批动作', [['submitted', '提交审核'], ['approved', '同意'], ['rejected', '驳回']]),
  from_status: text('原状态'), to_status: text('新状态'), comment: Field.textarea({ label: '审批意见' }),
  occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['order_id', 'action', 'from_status', 'to_status', 'comment', 'operator_id', 'occurred_at']);

// RM-006 to RM-008 and RM-025 expose the observable sequence arrival registration -> inspection -> purchase inbound.
// RISEMAP has not yet completed this sequence with the shared fixture, so these records preserve a reviewable Forge slice.
export const PurchaseReceipt = master('forge_purchase_receipt', '采购到货登记', 'package-check', {
  name: text('到货登记名称', true), code: code('到货单号'), notice_id: reference('forge_purchase_arrival_notice', '到货通知', true),
  order_id: reference('forge_purchase_order', '采购订单', true), supplier_id: reference('forge_supplier', '供应商', true),
  purchase_return_id: reference('forge_purchase_return', '采购换货单'),
  order_line_id: reference('forge_purchase_order_line', '兼容首条订单明细', true), sku_id: reference('forge_material_sku', '兼容首条物料规格', true),
  item_code: text('兼容首条物料编码'), quantity: positiveQuantity('兼容首条到货数量'), batch_number: text('兼容首条批次号'), taxed_unit_price: nonNegativeMoney('兼容首条含税单价'),
  customer_id: reference('forge_customer', '关联客户'), warehouse_id: reference('forge_warehouse', '默认到货仓库'),
  arrival_type: select('到货类型', [['purchase', '采购到货'], ['supplier_replacement', '供应商换货补货'], ['other', '其他到货'], ['return', '退货到货']], 'purchase'),
  arrived_on: Field.date({ label: '到货日期', ...required }), contact_name: text('送货联系人'), contact_phone: text('联系电话'),
  carrier: text('承运方'), logistics_number: text('物流单号'), line_count: Field.number({ label: '物料行数', min: 0, scale: 0, readonly: true }),
  total_quantity: nonNegativeQuantity('到货总数量', true), untaxed_amount: nonNegativeMoney('不含税金额'), taxed_amount: nonNegativeMoney('含税金额'),
  status: { ...select('到货登记状态', [
    ['draft', '草稿'], ['pending_inspection', '待检验'], ['inspection_in_progress', '检验中'], ['inspected', '已检验'],
    ['exempt_stocked', '免检入库'], ['stocked', '已入库'], ['cancelled', '已取消'],
  ], 'draft'), readonly: true }, submitted_at: Field.datetime({ label: '提交待检时间', readonly: true }), submitted_by: Field.user({ label: '提交人', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'arrived_on', 'supplier_id', 'order_id', 'warehouse_id', 'line_count', 'total_quantity', 'taxed_amount', 'status']);

export const PurchaseReceiptLine = master('forge_purchase_receipt_line', '到货登记明细', 'list', {
  name: text('物料名称', true), receipt_id: reference('forge_purchase_receipt', '到货登记', true),
  notice_id: reference('forge_purchase_arrival_notice', '到货通知', true), notice_line_id: reference('forge_purchase_arrival_notice_line', '到货通知明细', true),
  purchase_return_id: reference('forge_purchase_return', '采购换货单'), purchase_return_line_id: reference('forge_purchase_return_line', '采购换货明细'),
  order_id: reference('forge_purchase_order', '采购订单', true), order_line_id: reference('forge_purchase_order_line', '采购订单明细', true),
  sku_id: reference('forge_material_sku', '物料规格', true), item_code: text('物料编码'), model: text('型号'), specification: text('规格'), unit_name: text('单位'),
  quantity: positiveQuantity('到货数量'), warehouse_id: reference('forge_warehouse', '到货仓库', true), warehouse_location: text('库位'),
  external_sn: text('外部 SN'), batch_number: text('批次号'), taxed_unit_price: nonNegativeMoney('含税单价'),
  untaxed_unit_price: nonNegativeMoney('不含税单价'), tax_rate: percentage('税率'), untaxed_amount: nonNegativeMoney('不含税金额'), taxed_amount: nonNegativeMoney('含税金额'),
  status: { ...select('明细状态', [['draft', '草稿'], ['pending_inspection', '待检验'], ['inspection_created', '已建检验单'], ['inspected', '已检验'], ['exempt', '免检入库'], ['stocked', '已入库'], ['cancelled', '已取消']], 'draft'), readonly: true },
  remarks: remarks(),
}, ['receipt_id', 'item_code', 'name', 'model', 'unit_name', 'quantity', 'warehouse_id', 'taxed_amount', 'status']);

export const PendingInspection = master('forge_pending_inspection', '待检验库存', 'clipboard-clock', {
  name: text('待检记录名称', true), code: code('待检单号'), receipt_id: reference('forge_purchase_receipt', '到货登记', true),
  receipt_line_id: reference('forge_purchase_receipt_line', '到货登记明细', true), order_id: reference('forge_purchase_order', '采购订单', true),
  purchase_return_id: reference('forge_purchase_return', '采购换货单'), purchase_return_line_id: reference('forge_purchase_return_line', '采购换货明细'),
  order_line_id: reference('forge_purchase_order_line', '采购订单明细', true), supplier_id: reference('forge_supplier', '供应商'),
  customer_id: reference('forge_customer', '客户'), warehouse_id: reference('forge_warehouse', '到货仓库', true),
  sku_id: reference('forge_material_sku', '物料规格', true), item_code: text('物料编码'), model: text('型号'),
  specification: text('规格'), unit_name: text('单位'), arrival_quantity: positiveQuantity('到货数量'),
  batch_number: text('批次号'), external_sn: text('外部 SN'), arrived_on: Field.date({ label: '到货日期', ...required }),
  inspection_id: reference('forge_purchase_inspection', '关联检验单'),
  status: { ...select('待检状态', [['pending', '待检验'], ['inspection_created', '检验中'], ['inspected', '已检验'], ['exempt', '免检'], ['stocked', '已入库']], 'pending'), readonly: true },
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'item_code', 'name', 'model', 'arrival_quantity', 'unit_name', 'batch_number', 'supplier_id', 'order_id', 'status']);

export const PurchaseInspection = master('forge_purchase_inspection', '采购检验单', 'clipboard-check', {
  name: text('检验单名称', true), code: code('检验单号'), receipt_id: reference('forge_purchase_receipt', '到货登记', true),
  receipt_line_id: reference('forge_purchase_receipt_line', '到货登记明细'), pending_inspection_id: reference('forge_pending_inspection', '待检记录'),
  purchase_return_id: reference('forge_purchase_return', '采购换货单'), purchase_return_line_id: reference('forge_purchase_return_line', '采购换货明细'),
  order_id: reference('forge_purchase_order', '采购订单', true), order_line_id: reference('forge_purchase_order_line', '采购订单明细', true),
  supplier_id: reference('forge_supplier', '供应商', true), warehouse_id: reference('forge_warehouse', '到货仓库', true),
  sku_id: reference('forge_material_sku', '物料规格', true), item_code: text('物料编码'), model: text('型号'), specification: text('规格'), unit_name: text('单位'),
  batch_number: text('批次号'), inspection_method: select('检验方式', [['full', '全检'], ['sampling', '抽检']], 'full'),
  total_quantity: positiveQuantity('总数量'), accepted_quantity: nonNegativeQuantity('合格数量', true),
  rejected_quantity: nonNegativeQuantity('不合格数量', true), inspected_on: Field.date({ label: '检验日期' }),
  record_mode: select('记录方式', [['summary', '汇总数量录入'], ['item', '逐项录入']], 'summary'),
  result: { ...select('检验结果', [['pending', '待判定'], ['passed', '合格'], ['partial', '部分合格'], ['rejected', '不合格']], 'pending'), readonly: true },
  status: { ...select('检验状态', [['pending', '待检验'], ['completed', '已完成']], 'pending'), readonly: true },
  inspector_id: owner(true), inspection_note: Field.textarea({ label: '检验结论', readonly: true }), remarks: remarks(),
}, ['code', 'receipt_id', 'supplier_id', 'total_quantity', 'accepted_quantity', 'rejected_quantity', 'record_mode', 'result', 'status', 'inspector_id']);

// RISEMAP 检验单详情「检验结果录入」：按检验方案的项目逐项记录结果、实测值与备注。
export const PurchaseInspectionItem = master('forge_purchase_inspection_item', '检验单项目结果', 'list-checks', {
  name: text('项目名称', true), inspection_id: reference('forge_purchase_inspection', '检验单', true),
  item_id: reference('forge_inspection_rule_item', '检验项目'),
  sequence: Field.number({ label: '顺序', min: 1, scale: 0, defaultValue: 1 }),
  requirement: text('检验要求'), result: select('检验结果', [['pass', '合格'], ['fail', '不合格'], ['na', '不适用']], 'pass'),
  measured_value: text('实测值'), remarks: Field.textarea({ label: '备注' }),
}, ['inspection_id', 'sequence', 'name', 'result', 'measured_value']);

export const PurchaseInbound = master('forge_purchase_inbound', '采购入库单', 'package-plus', {
  name: text('入库单名称', true), code: code('入库单号'), inbound_type: select('入库类型', [['purchase', '采购入库']], 'purchase'),
  source_type: select('来源类型', [['purchase_order', '采购订单'], ['purchase_replacement', '采购换货补货'], ['exempt_inspection', '免检入库']], 'purchase_order'), order_id: reference('forge_purchase_order', '采购订单', true),
  purchase_return_id: reference('forge_purchase_return', '采购换货单'),
  inspection_id: reference('forge_purchase_inspection', '兼容首条检验单', true), order_line_id: reference('forge_purchase_order_line', '兼容首条订单明细', true),
  sku_id: reference('forge_material_sku', '兼容首条物料规格', true), item_code: text('兼容首条物料编码'), batch_number: text('兼容首条批次号'),
  quantity: positiveQuantity('兼容首条入库数量'), unit_cost: nonNegativeMoney('兼容首条库存单价'), inventory_amount: nonNegativeMoney('兼容首条库存金额'),
  before_on_hand: nonNegativeQuantity('兼容首条入库前库存', true), after_on_hand: nonNegativeQuantity('兼容首条入库后库存', true),
  receipt_id: reference('forge_purchase_receipt', '到货登记'), supplier_id: reference('forge_supplier', '供应商', true), warehouse_id: reference('forge_warehouse', '默认入库仓库'),
  inbound_on: Field.date({ label: '入库日期', ...required }), line_count: Field.number({ label: '物料行数', min: 0, scale: 0, readonly: true }),
  total_quantity: nonNegativeQuantity('入库总数量', true), untaxed_amount: nonNegativeMoney('不含税金额'), taxed_amount: nonNegativeMoney('含税金额'),
  status: { ...select('入库状态', [['draft', '草稿'], ['pending_approval', '待审批'], ['approved', '已审批'], ['stocked', '已入库'], ['cancelled', '已取消']], 'draft'), readonly: true },
  submitted_at: Field.datetime({ label: '提交时间', readonly: true }), submitted_by: Field.user({ label: '提交人', readonly: true }),
  approved_at: Field.datetime({ label: '审批时间', readonly: true }), approved_by: Field.user({ label: '审批人', readonly: true }),
  stocked_at: Field.datetime({ label: '入库时间', readonly: true }), stocked_by: Field.user({ label: '入库人', readonly: true }),
  approval_note: Field.textarea({ label: '审批意见', readonly: true }), responsible_id: owner(true), remarks: remarks(),
}, ['code', 'inbound_type', 'source_type', 'inbound_on', 'supplier_id', 'order_id', 'receipt_id', 'warehouse_id', 'line_count', 'total_quantity', 'taxed_amount', 'status']);

export const PurchaseInboundLine = master('forge_purchase_inbound_line', '采购入库明细', 'list', {
  name: text('物料名称', true), inbound_id: reference('forge_purchase_inbound', '采购入库单', true),
  inspection_id: reference('forge_purchase_inspection', '采购检验单', true), receipt_id: reference('forge_purchase_receipt', '到货登记', true),
  receipt_line_id: reference('forge_purchase_receipt_line', '到货登记明细', true), order_id: reference('forge_purchase_order', '采购订单', true),
  purchase_return_id: reference('forge_purchase_return', '采购换货单'), purchase_return_line_id: reference('forge_purchase_return_line', '采购换货明细'),
  order_line_id: reference('forge_purchase_order_line', '采购订单明细', true), supplier_id: reference('forge_supplier', '供应商', true),
  warehouse_id: reference('forge_warehouse', '入库仓库', true), warehouse_location: text('库位'), sku_id: reference('forge_material_sku', '物料规格', true),
  item_code: text('物料编码'), model: text('型号'), specification: text('规格'), unit_name: text('单位'), batch_number: text('批次号'), external_sn: text('外部 SN'),
  quantity: positiveQuantity('入库数量'), taxed_unit_price: nonNegativeMoney('含税单价'), untaxed_unit_price: nonNegativeMoney('不含税单价'),
  tax_rate: percentage('税率'), untaxed_amount: nonNegativeMoney('不含税金额'), taxed_amount: nonNegativeMoney('含税金额'),
  before_on_hand: { ...nonNegativeQuantity('入库前库存'), readonly: true }, after_on_hand: { ...nonNegativeQuantity('入库后库存'), readonly: true },
  status: { ...select('明细状态', [['draft', '草稿'], ['pending_approval', '待审批'], ['approved', '已审批'], ['stocked', '已入库'], ['cancelled', '已取消']], 'draft'), readonly: true },
  remarks: remarks(),
}, ['inbound_id', 'item_code', 'name', 'model', 'unit_name', 'quantity', 'taxed_unit_price', 'taxed_amount', 'warehouse_id', 'batch_number', 'status']);

export const PurchaseInboundApprovalLog = master('forge_purchase_inbound_approval_log', '采购入库审批记录', 'history', {
  name: text('记录名称', true), inbound_id: reference('forge_purchase_inbound', '采购入库单', true),
  action: select('动作', [['submitted', '提交审批'], ['approved', '审批通过'], ['stocked', '执行入库']]), from_status: text('原状态'), to_status: text('新状态'),
  comment: Field.textarea({ label: '意见' }), occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['inbound_id', 'action', 'from_status', 'to_status', 'comment', 'operator_id', 'occurred_at']);

// RM-022 / DR-0055 to DR-0058: return-refund and replacement share the source order,
// but this first slice executes the observable return-refund path only.
export const PurchaseReturn = master('forge_purchase_return', '采购退换货', 'rotate-ccw', {
  name: text('退货名称', true), code: code('退货单号'), order_id: reference('forge_purchase_order', '关联采购订单', true),
  supplier_id: reference('forge_supplier', '供应商', true), processing_type: select('处理方式', [['return_refund', '退货退款'], ['replacement', '换货补货']], 'return_refund'),
  return_on: Field.date({ label: '退货日期', ...required }), expected_replenishment_on: Field.date({ label: '预计补货日期' }),
  refund_method: select('退款方式', [['bank_transfer', '银行转账'], ['wire_transfer', '电汇'], ['cash', '现金'], ['other', '其他']], 'bank_transfer'),
  currency: select('币种', [['cny', '人民币'], ['usd', '美元'], ['eur', '欧元']], 'cny'), exchange_rate: Field.number({ label: '汇率', min: 0.000001, scale: 6, defaultValue: 1 }),
  reason: Field.textarea({ label: '退货原因', ...required }), warehouse_id: reference('forge_warehouse', '退货仓库', true),
  return_address: text('退货地址'), contact_name: text('退货联系人'), contact_phone: text('联系电话'),
  line_count: Field.number({ label: '物料数', min: 0, scale: 0, readonly: true }), total_quantity: nonNegativeQuantity('退货数量', true),
  reference_amount: { ...nonNegativeMoney('退款/参考货值'), readonly: true }, actual_refund_amount: { ...nonNegativeMoney('实退金额'), readonly: true },
  status: { ...select('退货状态', [['draft', '草稿'], ['pending_review', '待审批'], ['pending_warehouse', '待仓库确认'], ['approved', '已审批'], ['warehouse_confirmed', '仓库已确认'], ['pending_refund', '待退款'], ['pending_replenishment', '待供应商补货'], ['replenishment_arrived', '补货已到'], ['replenishment_inspected', '补货已检'], ['completed', '已完成'], ['rejected', '已驳回'], ['cancelled', '已取消']], 'draft'), readonly: true },
  finance_status: { ...select('财务审批', [['pending', '待审批'], ['approved', '已审批'], ['rejected', '已驳回'], ['not_required', '无需审批']], 'pending'), readonly: true },
  warehouse_status: { ...select('仓库确认', [['pending', '待确认'], ['confirmed', '已确认']], 'pending'), readonly: true },
  outbound_status: { ...select('退货出库', [['pending', '待出库'], ['outbounded', '已出库']], 'pending'), readonly: true },
  refund_status: { ...select('供应商退款', [['pending', '待退款'], ['received', '已收款'], ['not_required', '无需退款']], 'pending'), readonly: true },
  replacement_status: { ...select('换货进度', [['not_required', '无需补货'], ['pending_return', '待退回'], ['pending_replenishment', '待补货'], ['arrived', '补货已到'], ['inspected', '补货已检'], ['stocked', '补货已入库']], 'not_required'), readonly: true },
  replenishment_receipt_id: reference('forge_purchase_receipt', '补货到货单'), replenishment_inspection_id: reference('forge_purchase_inspection', '补货检验单'),
  replenishment_inbound_id: reference('forge_purchase_inbound', '补货入库单'), replenishment_arrived_quantity: nonNegativeQuantity('补货到货数量', true),
  replenishment_accepted_quantity: nonNegativeQuantity('补货合格数量', true), replenished_quantity: nonNegativeQuantity('换货补回数量', true),
  account_id: reference('forge_fund_account', '退款收款账户'), bank_reference: text('银行流水号'),
  submitted_by: Field.user({ label: '提交人', readonly: true }), submitted_at: Field.datetime({ label: '提交时间', readonly: true }),
  approved_by: Field.user({ label: '审批人', readonly: true }), approved_at: Field.datetime({ label: '审批时间', readonly: true }), approval_comment: Field.textarea({ label: '审批意见', readonly: true }),
  warehouse_confirmed_by: Field.user({ label: '仓库确认人', readonly: true }), warehouse_confirmed_at: Field.datetime({ label: '仓库确认时间', readonly: true }),
  warehouse_comment: Field.textarea({ label: '仓库确认意见', readonly: true }), outbounded_by: Field.user({ label: '出库人', readonly: true }),
  outbounded_at: Field.datetime({ label: '出库时间', readonly: true }), outbound_comment: Field.textarea({ label: '出库意见', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'order_id', 'supplier_id', 'processing_type', 'reason', 'line_count', 'total_quantity', 'reference_amount', 'status', 'return_on']);

export const PurchaseReturnLine = master('forge_purchase_return_line', '采购退货明细', 'list', {
  name: text('物料名称', true), return_id: reference('forge_purchase_return', '采购退货单', true), order_id: reference('forge_purchase_order', '采购订单', true),
  order_line_id: reference('forge_purchase_order_line', '采购订单明细', true), supplier_id: reference('forge_supplier', '供应商', true),
  warehouse_id: reference('forge_warehouse', '退货仓库', true), sku_id: reference('forge_material_sku', '物料规格', true), item_code: text('物料编码'),
  model: text('型号'), specification: text('规格'), unit_name: text('单位'), requested_quantity: positiveQuantity('申请退货数量'),
  confirmed_quantity: nonNegativeQuantity('仓库确认数量', true), outbounded_quantity: nonNegativeQuantity('已出库数量', true),
  replenished_quantity: nonNegativeQuantity('补回数量', true), accepted_replenishment_quantity: nonNegativeQuantity('补货合格数量', true),
  outbound_unit_cost: nonNegativeMoney('退货库存单价'), outbound_amount: nonNegativeMoney('退货库存金额'),
  taxed_unit_price: nonNegativeMoney('含税单价'), reference_amount: nonNegativeMoney('参考货值'),
  status: { ...select('明细状态', [['draft', '草稿'], ['pending_review', '待审批'], ['approved', '已审批'], ['warehouse_confirmed', '仓库已确认'], ['outbounded', '已出库'], ['replenished', '补货已入库'], ['rejected', '已驳回']], 'draft'), readonly: true },
  remarks: remarks(),
}, ['return_id', 'order_id', 'item_code', 'name', 'requested_quantity', 'confirmed_quantity', 'outbounded_quantity', 'reference_amount', 'status']);

export const PurchaseReturnApprovalLog = master('forge_purchase_return_approval_log', '采购退货审批记录', 'history', {
  name: text('记录名称', true), event_key: code('事件键'), return_id: reference('forge_purchase_return', '采购退货单', true),
  action: select('动作', [['submitted', '提交申请'], ['approved', '财务审批通过'], ['rejected', '驳回'], ['warehouse_confirmed', '仓库确认'], ['outbounded', '退货出库'], ['refund_received', '退款到账'], ['replacement_arrived', '补货到货'], ['replacement_inspected', '补货检验'], ['replacement_stocked', '补货入库']]),
  from_status: text('原状态'), to_status: text('新状态'), comment: Field.textarea({ label: '意见' }),
  occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['return_id', 'action', 'from_status', 'to_status', 'comment', 'operator_id', 'occurred_at']);

export const PurchaseReturnRefundReceipt = master('forge_purchase_return_refund_receipt', '采购退货退款流水', 'badge-dollar-sign', {
  name: text('退款流水名称', true), code: code('退款流水号'), return_id: reference('forge_purchase_return', '采购退货单', true),
  order_id: reference('forge_purchase_order', '采购订单', true), supplier_id: reference('forge_supplier', '供应商', true),
  account_id: reference('forge_fund_account', '收款账户', true), received_on: Field.date({ label: '到账日期', ...required }),
  amount: nonNegativeMoney('实退金额'), refund_method: select('退款方式', [['bank_transfer', '银行转账'], ['wire_transfer', '电汇'], ['cash', '现金'], ['other', '其他']], 'bank_transfer'),
  bank_reference: text('银行流水号'), status: { ...select('流水状态', [['received', '已收款']], 'received'), readonly: true }, responsible_id: owner(true), remarks: remarks(),
}, ['code', 'return_id', 'order_id', 'supplier_id', 'account_id', 'received_on', 'amount', 'refund_method', 'status']);
