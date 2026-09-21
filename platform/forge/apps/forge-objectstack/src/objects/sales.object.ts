import { Field } from '@objectstack/spec/data';
import { master, dictionary, text, code, reference, choice, owner, remarks, required, money } from '../model.js';

const positiveQuantity = (label = '数量') => Field.number({ label, min: 0.0001, scale: 4, ...required });
const percentage = (label: string, defaultValue = 0) => Field.number({ label, min: 0, max: 100, scale: 4, defaultValue });
const nonNegativeMoney = (label: string, scale = 4) => Field.currency({ label, precision: 18, scale, min: 0 });
const paymentMethod = () => choice('付款方式', ['银行转账', '支付宝', '微信支付', '现金', '支票', '其他', '电汇', '承兑汇票', '在线支付', '信用证'], '银行转账');
const revenueTrigger = () => choice('收入确认方式', ['按发货出库', '按开票', '按里程碑', '按验收', '按周期', '手动确认'], '按发货出库');

// Runtime-observed prerequisites: RM-059 / DR-0291 to DR-0294.
export const QuotationType = dictionary('forge_quotation_type', '报价类型');

export const QuotationIssuer = master('forge_quotation_issuer', '报价主体', 'landmark', {
  name: text('公司全称', true), credit_code: code('统一社会信用代码'), short_name: text('公司简称'),
  address: text('公司地址'), phone: text('联系电话'), email: Field.email({ label: '邮箱' }), remarks: remarks(),
}, ['name', 'short_name', 'credit_code', 'phone', 'email']);

export const ContractType = dictionary('forge_contract_type', '合同类型');

// RM-059 / DR-0279 to DR-0311. The header and lines stay separate so pricing snapshots remain auditable.
export const Quotation = master('forge_quotation', '销售报价', 'file-text', {
  name: text('报价名称', true), code: code('报价单号'), customer_id: reference('forge_customer', '客户', true),
  contact_id: reference('forge_contact', '联系人'), opportunity_name: text('关联商机'),
  quotation_type_id: reference('forge_quotation_type', '报价类型', true), issuer_id: reference('forge_quotation_issuer', '报价主体', true),
  quotation_date: Field.date({ label: '报价日期', ...required }), valid_until: Field.date({ label: '有效期至', ...required }),
  payment_method: paymentMethod(), payment_term: text('付款条件'), responsible_id: owner(true),
  status: { ...choice('报价状态', ['草稿', '待审批', '已审批', '已驳回', '已发送', '已接受'], '草稿'), readonly: true },
  item_count: Field.number({ label: '物料/服务数', min: 0, scale: 0, defaultValue: 0 }),
  subtotal: nonNegativeMoney('折前含税金额'), discount_amount: nonNegativeMoney('折扣金额'),
  tax_amount: nonNegativeMoney('税额'), total_amount: nonNegativeMoney('报价含税总额'), cost_total: nonNegativeMoney('总成本'),
  business_terms: Field.textarea({ label: '商务条款' }), quotation_terms: Field.textarea({ label: '报价条款' }),
  attachment_note: text('附件说明'), remarks: remarks(),
}, ['code', 'name', 'customer_id', 'responsible_id', 'item_count', 'total_amount', 'status', 'valid_until']);

export const QuotationLine = master('forge_quotation_line', '报价明细', 'list', {
  name: text('物料/服务名称', true), quotation_id: reference('forge_quotation', '报价单', true),
  line_type: choice('明细类型', ['物料', '服务项目'], '物料'), group_name: text('分组'), sku_id: reference('forge_material_sku', '物料规格'),
  item_code: text('编码'), model: text('型号'), specification: text('规格'), unit_name: text('单位'),
  quantity: positiveQuantity(), taxed_unit_price: nonNegativeMoney('含税单价'), untaxed_unit_price: nonNegativeMoney('不含税单价'),
  tax_rate: percentage('税率', 13), discount_rate: percentage('折扣率', 0), taxed_subtotal: nonNegativeMoney('折后含税小计'),
  cost_price: nonNegativeMoney('成本单价'), sort_order: Field.number({ label: '排序', min: 0, scale: 0, defaultValue: 0 }), remarks: remarks(),
}, ['quotation_id', 'group_name', 'name', 'model', 'quantity', 'taxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal']);

// RM-046 / DR-0165 to DR-0177. A contract constrains orders and never represents shipment execution itself.
export const SalesContract = master('forge_sales_contract', '框架销售合同', 'scroll-text', {
  name: text('合同名称', true), code: code('合同编号'), customer_po_number: text('客户单号'),
  contract_type_id: reference('forge_contract_type', '合同类型', true), customer_id: reference('forge_customer', '客户', true),
  contact_id: reference('forge_contact', '联系人'), quotation_id: reference('forge_quotation', '来源报价单'), project_name: text('关联项目'),
  company_account_id: reference('forge_fund_account', '公司账户'), delivery_address: text('收货地址'), delivery_contact: text('收货人'), delivery_phone: text('收货联系电话'),
  signed_on: Field.date({ label: '签订日期' }), starts_on: Field.date({ label: '生效日期' }), ends_on: Field.date({ label: '到期日期' }),
  responsible_id: owner(true), collaborator_ids: Field.lookup('sys_user', { label: '协同销售', multiple: true, relatedList: false }), follower_ids: Field.lookup('sys_user', { label: '关注人', multiple: true, relatedList: false }), total_amount: nonNegativeMoney('合同含税总额'),
  has_order_amount_limit: Field.boolean({ label: '限制累计下单金额', defaultValue: false }), order_amount_limit: nonNegativeMoney('累计下单金额上限'),
  allow_affiliate_orders: Field.boolean({ label: '允许关联公司下单', defaultValue: false }),
  affiliate_company_names: Field.textarea({ label: '受用分子公司或关联公司' }),
  outside_item_requires_approval: Field.boolean({ label: '协议外物料需审批', defaultValue: true }),
  all_orders_require_approval: Field.boolean({ label: '额度内订单仍需审批', defaultValue: false }),
  revenue_trigger: revenueTrigger(), ordered_count: Field.number({ label: '下单笔数', min: 0, scale: 0, defaultValue: 0 }),
  ordered_amount: nonNegativeMoney('已下单金额'), invoiced_amount: nonNegativeMoney('已开票金额'),
  shipped_amount: nonNegativeMoney('已发货金额'), collected_amount: nonNegativeMoney('已回款金额'),
  status: { ...choice('合同状态', ['草稿', '待审批', '执行中', '已完成', '已终止', '已驳回'], '草稿'), readonly: true },
  payment_term: text('付款条件'), delivery_cycle_days: Field.number({ label: '交货周期（天）', min: 0, scale: 0, defaultValue: 21 }),
  warranty_months: Field.number({ label: '质保期（月）', min: 0, scale: 0 }), business_terms: Field.textarea({ label: '合同条款' }),
  attachment_ids: Field.file({ label: '合同附件', multiple: true }), attachment_note: text('附件说明'), remarks: remarks(),
}, ['code', 'customer_po_number', 'name', 'contract_type_id', 'customer_id', 'total_amount', 'ordered_amount', 'status', 'signed_on', 'responsible_id']);

export const SalesContractLine = master('forge_sales_contract_line', '合同物料明细', 'list', {
  name: text('物料名称', true), contract_id: reference('forge_sales_contract', '销售合同', true),
  quotation_line_id: reference('forge_quotation_line', '来源报价明细'), sku_id: reference('forge_material_sku', '物料规格', true),
  item_code: text('物料编码'), model: text('型号'), specification: text('规格'), unit_name: text('单位'),
  quantity_limit: positiveQuantity('数量上限'), ordered_quantity: Field.number({ label: '已下单数量', min: 0, scale: 4, defaultValue: 0 }),
  taxed_unit_price: nonNegativeMoney('协议含税单价'), tax_rate: percentage('税率', 13), discount_rate: percentage('折扣率', 0),
  taxed_subtotal: nonNegativeMoney('含税小计'), remarks: remarks(),
}, ['contract_id', 'item_code', 'name', 'model', 'quantity_limit', 'ordered_quantity', 'taxed_unit_price', 'taxed_subtotal']);

// RM-047 / DR-0178 to DR-0183. Direct and contract-backed orders converge on this execution document.
export const SalesOrder = master('forge_sales_order', '销售订单', 'clipboard-list', {
  name: text('订单名称', true), code: code('订单编号'), customer_po_number: text('客户单号'),
  source_type: choice('订单来源', ['直接新建', '关联合同'], '直接新建'), customer_id: reference('forge_customer', '客户', true),
  contact_id: reference('forge_contact', '联系人'), contract_id: reference('forge_sales_contract', '关联合同'),
  quotation_id: reference('forge_quotation', '来源报价单'), project_name: text('所属项目'),
  company_account_id: reference('forge_fund_account', '公司账户'), suggested_supplier_id: reference('forge_supplier', '整单建议供应商'),
  planned_delivery_on: Field.date({ label: '计划交货日期', ...required }), responsible_id: owner(true),
  collaborator_ids: Field.lookup('sys_user', { label: '协同销售', multiple: true, relatedList: false }),
  use_credit: Field.boolean({ label: '使用授信额度', defaultValue: false }), payment_term: text('付款条件', true), payment_method: paymentMethod(),
  revenue_trigger: revenueTrigger(), total_amount: nonNegativeMoney('订单含税金额'), recognized_amount: nonNegativeMoney('已确认收入'),
  invoiced_amount: nonNegativeMoney('已开票金额'), shipped_amount: nonNegativeMoney('已发货金额'), collected_amount: nonNegativeMoney('已回款金额'),
  shipment_count: Field.number({ label: '发货单数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  planned_shipment_amount: nonNegativeMoney('已建发货单金额'),
  status: { ...choice('订单状态', ['草稿', '待审批', '已审批', '执行中', '部分发货', '已发货', '已完成', '已取消'], '草稿'), readonly: true },
  delivery_address: text('收货地址'), delivery_contact: text('收货人'), delivery_phone: text('联系电话'),
  attachment_ids: Field.file({ label: '订单附件', multiple: true }), attachment_note: text('附件说明'), remarks: remarks(),
}, ['code', 'customer_po_number', 'name', 'contract_id', 'customer_id', 'total_amount', 'status', 'planned_delivery_on', 'responsible_id']);

export const SalesOrderLine = master('forge_sales_order_line', '销售订单明细', 'list', {
  name: text('物料/服务名称', true), order_id: reference('forge_sales_order', '销售订单', true),
  contract_line_id: reference('forge_sales_contract_line', '来源合同明细'), quotation_line_id: reference('forge_quotation_line', '来源报价明细'), suggested_supplier_id: reference('forge_supplier', '建议供应商'),
  sku_id: reference('forge_material_sku', '物料规格', true), item_code: text('物料编码'), model: text('型号'), specification: text('规格'), unit_name: text('单位'),
  quantity: positiveQuantity(), shipped_quantity: Field.number({ label: '已发货数量', min: 0, scale: 4, defaultValue: 0 }),
  invoiced_quantity: Field.number({ label: '已开票数量', min: 0, scale: 4, defaultValue: 0 }),
  taxed_unit_price: nonNegativeMoney('含税单价'), untaxed_unit_price: nonNegativeMoney('不含税单价'),
  tax_rate: percentage('税率', 13), discount_rate: percentage('折扣率', 0), taxed_subtotal: nonNegativeMoney('含税小计'),
  planned_delivery_on: Field.date({ label: '计划交货日期' }), remarks: remarks(),
}, ['order_id', 'item_code', 'name', 'model', 'quantity', 'shipped_quantity', 'taxed_unit_price', 'taxed_subtotal', 'planned_delivery_on']);

// RM-060 / DR-1642 onward. A shipment is a customer delivery plan. It reserves order quantity but does not move inventory or mark it shipped.
export const SalesShipment = master('forge_sales_shipment', '销售发货单', 'package-check', {
  name: text('发货单名称', true), code: code('发货单号'), customer_id: reference('forge_customer', '客户', true),
  contact_id: reference('forge_contact', '联系人'), shipment_on: Field.date({ label: '发货日期', ...required }),
  recipient: text('收货人', true), recipient_phone: text('联系电话'), delivery_address: text('收货地址', true),
  total_amount: nonNegativeMoney('发货含税金额'), total_quantity: positiveQuantity('发货数量'),
  outbound_quantity: Field.number({ label: '已出库数量', min: 0, scale: 4, defaultValue: 0, readonly: true }),
  outbound_count: Field.number({ label: '出库单数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  status: { ...choice('发货单状态', ['待发货', '部分出库', '已出库', '已取消'], '待发货'), readonly: true },
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'name', 'customer_id', 'shipment_on', 'total_quantity', 'outbound_quantity', 'total_amount', 'status']);

export const SalesShipmentLine = master('forge_sales_shipment_line', '发货物料明细', 'list', {
  name: text('物料名称', true), shipment_id: reference('forge_sales_shipment', '销售发货单', true),
  order_id: reference('forge_sales_order', '销售订单', true), order_line_id: reference('forge_sales_order_line', '订单明细', true),
  sku_id: reference('forge_material_sku', '物料规格', true), item_code: text('物料编码'), model: text('型号'),
  specification: text('规格'), unit_name: text('单位'), quantity: positiveQuantity(),
  outbound_quantity: Field.number({ label: '已出库数量', min: 0, scale: 4, defaultValue: 0, readonly: true }),
  taxed_unit_price: nonNegativeMoney('含税单价'), taxed_subtotal: nonNegativeMoney('含税小计'), remarks: remarks(),
}, ['shipment_id', 'order_id', 'item_code', 'name', 'model', 'quantity', 'outbound_quantity', 'taxed_unit_price', 'taxed_subtotal']);

// RM-043 / DR-1645 onward. Outbound execution consumes the shipment plan and records the stock check.




export const SalesAdditionalFee = master('forge_sales_additional_fee', '销售附加费用单', 'receipt', {
  name: text('费用名称', true), code: code('费用单号'), source_type: Field.select([
    { value: 'sales_order', label: '销售订单' }, { value: 'sales_contract', label: '框架销售合同' }, { value: 'sales_shipment', label: '销售发货单' }, { value: 'manual', label: '手工登记' },
  ], { label: '来源类型', defaultValue: 'sales_order', ...required }),
  order_id: reference('forge_sales_order', '销售订单'), contract_id: reference('forge_sales_contract', '销售合同'), shipment_id: reference('forge_sales_shipment', '销售发货单'),
  customer_id: reference('forge_customer', '客户', true), project_name: text('项目'), bearing_type: Field.select([
    { value: 'customer', label: '客户承担' }, { value: 'company', label: '公司承担' },
  ], { label: '承担类型', defaultValue: 'customer', ...required }),
  fee_item: text('费用项', true), occurred_on: Field.date({ label: '发生日期', ...required }), total_amount: nonNegativeMoney('含税金额'),
  document_status: { ...Field.select([
    { value: 'draft', label: '草稿' }, { value: 'pending_approval', label: '待审批' }, { value: 'active', label: '已生效' }, { value: 'voided', label: '已作废' },
  ], { label: '单据状态', defaultValue: 'draft' }), readonly: true },
  finance_status: { ...Field.select([
    { value: 'pending', label: '待处理' }, { value: 'pending_invoice', label: '待开票' }, { value: 'pending_payment', label: '待付款' }, { value: 'completed', label: '已完成' }, { value: 'not_required', label: '无需处理' },
  ], { label: '财务状态', defaultValue: 'pending' }), readonly: true },
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'source_type', 'order_id', 'customer_id', 'bearing_type', 'fee_item', 'total_amount', 'document_status', 'finance_status', 'responsible_id']);

export const SalesReturn = master('forge_sales_return', '销售退货单', 'undo-2', {
  name: text('退货名称', true), code: code('退货单号'), order_id: reference('forge_sales_order', '关联订单', true),
  customer_id: reference('forge_customer', '客户', true), return_on: Field.date({ label: '申请日期', ...required }),
  reason: Field.textarea({ label: '退货原因', ...required }), processing_type: Field.select([
    { value: 'refund', label: '退货退款' }, { value: 'replacement', label: '换货补发' }, { value: 'repair', label: '返修' }, { value: 'credit', label: '冲抵货款' },
  ], { label: '处理方式', defaultValue: 'refund', ...required }),
  return_amount: nonNegativeMoney('退货金额'), attachment_note: text('附件说明'),
  status: { ...Field.select([
    { value: 'draft', label: '草稿' }, { value: 'pending_approval', label: '待审批' }, { value: 'approved', label: '已审批' },
    { value: 'processing', label: '处理中' }, { value: 'completed', label: '已完成' }, { value: 'rejected', label: '已驳回' }, { value: 'withdrawn', label: '已撤回' },
  ], { label: '退货状态', defaultValue: 'draft' }), readonly: true },
  applicant_id: Field.user({ label: '申请人', ...required }), responsible_id: owner(true), remarks: remarks(),
}, ['code', 'order_id', 'customer_id', 'reason', 'processing_type', 'return_amount', 'status', 'attachment_note', 'applicant_id', 'responsible_id']);

export const SalesOutbound = master('forge_sales_outbound', '销售出库单', 'truck', {
  name: text('出库单名称', true), code: code('出库单号'), shipment_id: reference('forge_sales_shipment', '发货单', true),
  order_id: reference('forge_sales_order', '销售订单', true), warehouse_id: reference('forge_warehouse', '出库仓库', true),
  sku_id: reference('forge_material_sku', '物料规格', true),
  outbound_on: Field.date({ label: '出库日期', ...required }), quantity: positiveQuantity('出库数量'),
  customer_pickup: Field.boolean({ label: '客户自取', defaultValue: false }), recipient: text('收货人'),
  recipient_phone: text('联系电话'), delivery_address: text('收货地址'), available_quantity: Field.number({ label: '校验时可用库存', min: 0, scale: 4, readonly: true }),
  before_on_hand: Field.number({ label: '出库前库存', min: 0, scale: 4, readonly: true }),
  after_on_hand: Field.number({ label: '出库后库存', min: 0, scale: 4, readonly: true }),
  unit_cost: { ...nonNegativeMoney('含税单位成本'), readonly: true },
  inventory_amount: { ...nonNegativeMoney('库存含税金额'), readonly: true },
  revenue_status: { ...choice('收入确认', ['待确认', '待审批', '已审批', '已驳回'], '待确认'), readonly: true },
  status: { ...choice('出库单状态', ['草稿', '已出库', '已取消'], '已出库'), readonly: true }, responsible_id: owner(true), remarks: remarks(),
}, ['code', 'name', 'shipment_id', 'order_id', 'warehouse_id', 'sku_id', 'outbound_on', 'quantity', 'available_quantity', 'before_on_hand', 'after_on_hand', 'inventory_amount', 'status']);

export const GoodwillOrder = master('forge_goodwill_order', 'Goodwill订单', 'gift', {
  name: text('订单名称', true), code: code('Goodwill单号'), customer_id: reference('forge_customer', '客户', true), project_id: reference('forge_project', '关联项目'),
  contact_name: text('联系人'), contact_phone: text('联系电话'),
  gift_type: Field.select([{ value: 'relationship', label: '客情维护' }, { value: 'compensation', label: '补偿赠送' }, { value: 'sample', label: '样品赠送' }, { value: 'service', label: '服务备件' }, { value: 'onsite_support', label: '现场支持物料' }], { label: '赠送类型', defaultValue: 'relationship', ...required }),
  reason: Field.textarea({ label: '申请原因', ...required }), item_summary: text('物品种类/总数'), item_name: text('物品名称'),
  quantity: Field.number({ label: '赠送数量', min: 0, scale: 4, defaultValue: 0 }), unit_name: text('单位'), total_amount: nonNegativeMoney('参考金额'),
  status: { ...Field.select([{ value: 'draft', label: '草稿' }, { value: 'pending_approval', label: '待审批' }, { value: 'approved', label: '已审批' }, { value: 'shipping', label: '发货中' }, { value: 'completed', label: '已完成' }, { value: 'rejected', label: '已驳回' }, { value: 'cancelled', label: '已取消' }], { label: '状态', defaultValue: 'draft' }), readonly: true },
  approved_by: text('审批人'), approved_at: Field.datetime({ label: '审批时间', readonly: true }),
  shipment_code: text('发货单号'), shipment_status: text('发货状态'), shipment_count: Field.number({ label: '发货记录数', min: 0, scale: 0, defaultValue: 0 }),
  shipped_quantity: Field.number({ label: '已发数量', min: 0, scale: 4, defaultValue: 0 }), logistics_company: text('物流公司'), tracking_no: text('运单号'),
  delivery_address: text('收货地址'), recipient: text('收件人'), recipient_phone: text('收件电话'), shipped_at: Field.datetime({ label: '发货时间', readonly: true }), completed_at: Field.datetime({ label: '完成时间', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'customer_id', 'project_id', 'contact_name', 'gift_type', 'reason', 'item_summary', 'quantity', 'status', 'shipment_code', 'shipment_status', 'shipped_quantity', 'responsible_id']);

export const SalesTeam = master('forge_sales_team', '销售团队', 'users', {
  name: text('团队名称', true), code: code('团队编码'), manager_id: Field.user({ label: '负责人' }), member_count: Field.number({ label: '成员数', min: 0, scale: 0, defaultValue: 0 }),
  status: Field.select([{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }], { label: '状态', defaultValue: 'active' }), remarks: remarks(),
}, ['code', 'name', 'manager_id', 'member_count', 'status']);

export const SalesTarget = master('forge_sales_target', '销售目标', 'target', {
  name: text('目标名称', true), code: code('目标编号'), target_type: Field.select([{ value: 'personal', label: '个人目标' }, { value: 'team', label: '团队目标' }], { label: '目标类型', defaultValue: 'personal', ...required }),
  year: Field.number({ label: '年度', min: 2000, max: 2100, scale: 0, defaultValue: 2026 }), owner_user_id: Field.user({ label: '目标人' }), team_id: reference('forge_sales_team', '销售团队'),
  target_amount: nonNegativeMoney('目标金额'), payment_target_amount: nonNegativeMoney('回款目标'), achieved_amount: { ...nonNegativeMoney('完成金额'), defaultValue: 0, readonly: true }, status: Field.select([{ value: 'draft', label: '草稿' }, { value: 'active', label: '执行中' }, { value: 'closed', label: '已关闭' }], { label: '状态', defaultValue: 'draft' }), remarks: remarks(),
}, ['code', 'name', 'target_type', 'year', 'owner_user_id', 'team_id', 'target_amount', 'payment_target_amount', 'achieved_amount', 'status']);

export const CustomerMaterialMap = master('forge_customer_material_map', '客户物料对照', 'tags', {
  name: text('对照名称', true), customer_id: reference('forge_customer', '客户', true), internal_item_code: text('我方物料编码', true), internal_item_name: text('我方物料名称', true),
  customer_item_code: text('客户物料编码', true), customer_item_name: text('客户物料名称', true), status: choice('状态', ['启用', '停用'], '启用'), remarks: remarks(),
}, ['customer_id', 'internal_item_code', 'internal_item_name', 'customer_item_code', 'customer_item_name', 'remarks']);

export const SalesOpportunity = master('forge_sales_opportunity', '商机管理', 'sparkles', {
  name: text('商机名称', true), customer_id: reference('forge_customer', '客户', true), contact_id: reference('forge_contact', '联系人'), contact_name: text('联系人姓名'), job_title: text('职务'), phone: text('联系电话'), email: Field.email({ label: '邮箱' }),
  stage: Field.select([{ value: 'initial_contact', label: '初步接触' }, { value: 'needs_confirmed', label: '需求确认' }, { value: 'proposal_quoted', label: '方案报价' }, { value: 'negotiation', label: '商务谈判' }, { value: 'won', label: '赢单' }, { value: 'lost', label: '输单' }], { label: '商机阶段', defaultValue: 'initial_contact' }), lead_id: reference('forge_sales_lead', '来源线索'), source: text('来源'), description: Field.textarea({ label: '商机描述' }), competitor: text('竞争对手'), traffic_light: text('红绿灯'), priority: Field.select([{ value: 'high', label: '高' }, { value: 'medium', label: '中' }, { value: 'low', label: '低' }], { label: '优先级', defaultValue: 'medium' }), amount: nonNegativeMoney('商机金额'), win_rate: percentage('成功率', 0), expected_close_on: Field.date({ label: '预计成交日期' }), responsible_id: owner(true), remarks: remarks(),
}, ['name', 'customer_id', 'lead_id', 'contact_name', 'stage', 'source', 'amount', 'win_rate', 'expected_close_on', 'responsible_id']);

export const SalesLead = master('forge_sales_lead', '线索管理', 'funnel', {
  name: text('线索名称', true), code: code('线索号'), company_name: text('公司名称', true), contact_name: text('联系人'), phone: text('联系电话'), source: text('来源'),
  status: Field.select([{ value: 'new', label: '新线索' }, { value: 'following', label: '跟进中' }, { value: 'converted', label: '已转化' }, { value: 'closed', label: '已关闭' }, { value: 'public_pool', label: '公海' }], { label: '线索状态', defaultValue: 'new' }), converted_customer_id: reference('forge_customer', '转化客户'), converted_opportunity_id: reference('forge_sales_opportunity', '转化商机'), converted_at: Field.datetime({ label: '转化时间' }), responsible_id: owner(), remarks: remarks(),
}, ['code', 'company_name', 'contact_name', 'phone', 'status', 'source', 'converted_customer_id', 'converted_opportunity_id', 'responsible_id']);

export const SalesFollowUp = master('forge_sales_follow_up', '跟进记录', 'messages-square', {
  name: text('跟进主题', true), customer_id: reference('forge_customer', '客户'), opportunity_id: reference('forge_sales_opportunity', '商机'), follow_type: Field.select([{ value: 'phone', label: '电话沟通' }, { value: 'wechat', label: '微信沟通' }, { value: 'email', label: '邮件往来' }, { value: 'onsite_visit', label: '上门拜访' }, { value: 'customer_visit', label: '客户来访' }, { value: 'online_meeting', label: '线上会议' }, { value: 'demo', label: '产品演示' }, { value: 'proposal', label: '方案讲解' }, { value: 'negotiation', label: '商务谈判' }, { value: 'other', label: '其他' }], { label: '跟进类型', defaultValue: 'phone' }),
  content: Field.textarea({ label: '跟进内容' }), followed_at: Field.date({ label: '跟进日期' }), next_follow_on: Field.date({ label: '下次计划' }), status: Field.select([{ value: 'pending', label: '待跟进' }, { value: 'completed', label: '已完成' }, { value: 'overdue', label: '已过期' }], { label: '跟进状态', defaultValue: 'completed' }), responsible_id: owner(), remarks: remarks(),
}, ['customer_id', 'opportunity_id', 'follow_type', 'followed_at', 'next_follow_on', 'status', 'responsible_id']);

export const CustomerPool = master('forge_customer_pool', '公海客户', 'users-round', {
  name: text('客户名称', true), industry: text('行业'), level: text('客户级别'), contact_name: text('联系人'), city: text('所在城市'), source: text('来源'), estimated_value: nonNegativeMoney('预估价值'), released_days: Field.number({ label: '释放天数', min: 0, scale: 0, defaultValue: 0 }), claimed_customer_id: reference('forge_customer', '领取客户'), claimed_at: Field.datetime({ label: '领取时间' }), status: Field.select([{ value: 'claimable', label: '可领取' }, { value: 'claimed', label: '已领取' }, { value: 'released', label: '已释放' }], { label: '状态', defaultValue: 'claimable' }), remarks: remarks(),
}, ['name', 'industry', 'level', 'contact_name', 'city', 'source', 'estimated_value', 'released_days', 'status', 'claimed_customer_id']);

export const ServiceOrder = master('forge_service_order', '服务工单', 'wrench', {
  name: text('工单标题', true),
  code: code('工单号'),
  customer_id: reference('forge_customer', '客户', true),
  contact_id: reference('forge_contact', '联系人'),
  contact_phone: text('联系电话'),
  sales_order_id: reference('forge_sales_order', '关联销售订单'),
  contract_id: reference('forge_sales_contract', '关联合同'),
  service_address: text('服务地址'),
  service_object: text('服务对象'),
  service_type: text('服务类型'),
  service_mode: Field.select([{ value: 'onsite', label: '上门服务' }, { value: 'remote', label: '远程服务' }, { value: 'return_repair', label: '返厂维修' }], { label: '服务方式', defaultValue: 'onsite' }),
  urgency: Field.select([{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }, { value: 'urgent', label: '紧急' }], { label: '紧急度', defaultValue: 'medium' }),
  region: text('地区'),
  warranty_starts_on: Field.date({ label: '质保起始' }),
  warranty_ends_on: Field.date({ label: '质保截止' }),
  warranty_status: text('质保判定'),
  responsibility_type: text('服务责任'),
  quotation_handling: text('报价处理'),
  fault_symptom: text('故障现象'),
  impact_scope: text('影响范围'),
  expected_visit_on: Field.date({ label: '客户期望时间' }),
  status: Field.select([{ value: 'pending_acceptance', label: '待受理' }, { value: 'pending_dispatch', label: '待分派' }, { value: 'pending_receive', label: '待接单' }, { value: 'in_progress', label: '服务中' }, { value: 'completed', label: '已完工' }, { value: 'closed', label: '已关闭' }, { value: 'rejected', label: '已驳回' }], { label: '工单状态', defaultValue: 'pending_acceptance' }),
  responsible_id: owner(),
  engineer_id: Field.user({ label: '服务工程师账号' }),
  engineer_name: text('服务工程师'),
  scheduled_at: Field.date({ label: '计划上门日期' }),
  sla_due_at: Field.date({ label: 'SLA 到期日' }),
  submitted_at: Field.datetime({ label: '提交时间' }),
  accepted_at: Field.datetime({ label: '受理时间' }),
  dispatched_at: Field.datetime({ label: '派工时间' }),
  received_at: Field.datetime({ label: '接单时间' }),
  completed_at: Field.datetime({ label: '完工时间' }),
  dispatch_note: Field.textarea({ label: '派工说明' }),
  service_hours: Field.number({ label: '服务耗时（小时）', min: 0, scale: 2 }),
  treatment_record: Field.textarea({ label: '处理记录' }),
  onsite_evidence_count: Field.number({ label: '现场处理图片数', min: 0, scale: 0, defaultValue: 0 }),
  service_result: Field.textarea({ label: '服务结果' }),
  quotation_code: text('服务报价单'), settlement_code: text('服务结算单'), warranty_code: text('质保卡'),
  next_step: text('下一步'),
  remarks: remarks(),
}, ['code', 'name', 'customer_id', 'contact_id', 'contact_phone', 'sales_order_id', 'service_type', 'service_mode', 'urgency', 'status', 'engineer_name', 'expected_visit_on', 'treatment_record', 'onsite_evidence_count', 'service_result', 'quotation_code', 'settlement_code', 'warranty_code', 'next_step']);

export const ServiceQuotation = master('forge_service_quotation', '服务报价单', 'file-text', {
  name: text('报价名称', true), code: code('报价单号'), service_order_id: reference('forge_service_order', '服务工单'), order_code: text('工单号'), customer_id: reference('forge_customer', '客户'), contact_id: reference('forge_contact', '联系人'), total_amount: nonNegativeMoney('报价金额'), status: Field.select([{ value: 'draft', label: '草稿' }, { value: 'pending_confirmation', label: '待确认' }, { value: 'confirmed', label: '已确认' }, { value: 'settlement_created', label: '已转结算' }, { value: 'cancelled', label: '已取消' }], { label: '状态', defaultValue: 'draft' }), valid_until: Field.date({ label: '有效期至' }), responsible_id: owner(), remarks: remarks(),
}, ['code', 'service_order_id', 'order_code', 'customer_id', 'contact_id', 'total_amount', 'status', 'valid_until']);

export const ServiceSettlement = master('forge_service_settlement', '服务结算单', 'receipt-text', {
  name: text('结算名称', true), code: code('结算单号'), service_order_id: reference('forge_service_order', '服务工单'), quotation_id: reference('forge_service_quotation', '服务报价单'), order_code: text('工单号'), customer_id: reference('forge_customer', '客户'), contact_id: reference('forge_contact', '联系人'), total_amount: nonNegativeMoney('结算金额'), status: Field.select([{ value: 'draft', label: '草稿' }, { value: 'pending_approval', label: '待审批' }, { value: 'customer_confirming', label: '客户确认中' }, { value: 'confirmed', label: '已确认' }, { value: 'receivable_created', label: '已生成应收' }], { label: '状态', defaultValue: 'draft' }), receivable_code: text('财务应收'), responsible_id: owner(), remarks: remarks(),
}, ['code', 'service_order_id', 'quotation_id', 'order_code', 'customer_id', 'contact_id', 'total_amount', 'status', 'receivable_code']);

export const WarrantyCard = master('forge_warranty_card', '质保卡', 'shield-check', {
  name: text('质保名称', true), code: code('质保卡号'), service_order_id: reference('forge_service_order', '服务工单'), sales_order_id: reference('forge_sales_order', '销售订单'), customer_id: reference('forge_customer', '客户'), product_sn: text('产品/SN'), scope: text('判定粒度'), starts_on: Field.date({ label: '开始日期' }), ends_on: Field.date({ label: '到期日期' }), status: Field.select([{ value: 'active', label: '生效中' }, { value: 'pending_activation', label: '待激活' }, { value: 'grace_period', label: '宽限期' }, { value: 'expired', label: '已过保' }, { value: 'terminated', label: '已终止' }], { label: '状态', defaultValue: 'pending_activation' }), responsible_party: text('责任方'), remarks: remarks(),
}, ['code', 'service_order_id', 'sales_order_id', 'customer_id', 'product_sn', 'scope', 'starts_on', 'ends_on', 'status']);

export const ServiceConfigItem = master('forge_service_config_item', '服务配置项', 'settings', {
  name: text('配置项', true), code: code('编码'), category: Field.select([{ value: 'order_type', label: '工单类型' }, { value: 'status_urgency', label: '状态与紧急度' }, { value: 'warranty_rule', label: '质保规则' }, { value: 'sla_rule', label: 'SLA 规则' }, { value: 'fee_type', label: '费用类型' }, { value: 'payment_template', label: '付款模板' }, { value: 'service_staff', label: '服务人员' }, { value: 'quotation_setting', label: '报价设置' }, { value: 'customer_portal', label: '客户门户' }], { label: '分类', defaultValue: 'order_type' }), status: choice('状态', ['启用', '停用'], '启用'), description: Field.textarea({ label: '说明' }), remarks: remarks(),
}, ['name', 'category', 'code', 'status', 'description']);
