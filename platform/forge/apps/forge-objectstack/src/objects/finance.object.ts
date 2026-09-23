import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, owner, remarks, required } from '../model.js';

const amount = (label: string) => Field.currency({ label, precision: 18, scale: 4, min: 0 });
const signedAmount = (label: string) => Field.currency({ label, precision: 18, scale: 4 });
const quantity = (label: string) => Field.number({ label, min: 0.0001, scale: 4, ...required });
const invoiceStatus = () => Field.select([
  { value: 'issued', label: '已开票' }, { value: 'settled', label: '已结清' }, { value: 'voided', label: '已作废' },
  { value: 'partially_red_reversed', label: '部分红冲' }, { value: 'red_reversed', label: '已红冲' }, { value: 'red_invoice', label: '红字发票' },
], { label: '发票状态', defaultValue: 'issued' });
const receivableStatus = () => Field.select([
  { value: 'unpaid', label: '未收款' }, { value: 'partially_collected', label: '部分收款' },
  { value: 'settled', label: '已结清' }, { value: 'overdue', label: '已逾期' }, { value: 'red_reversed', label: '已红冲' },
], { label: '应收状态', defaultValue: 'unpaid' });
const paymentMethod = (label = '收款方式') => Field.select([
  { value: 'bank_transfer', label: '银行转账' }, { value: 'alipay', label: '支付宝' },
  { value: 'wechat_pay', label: '微信支付' }, { value: 'cash', label: '现金' },
  { value: 'cheque', label: '支票' }, { value: 'other', label: '其他' },
], { label, defaultValue: 'bank_transfer' });

// RM-056, RM-144 and RM-145 currently establish the sales-request / finance-ledger split.
// This first executable slice represents the issued finance-side document directly.
export const SalesInvoice = master('forge_sales_invoice', '销项发票', 'receipt-text', {
  name: text('发票名称', true), code: code('发票编号'), order_id: reference('forge_sales_order', '销售订单', true),
  contract_id: reference('forge_sales_contract', '销售合同'), customer_id: { ...reference('forge_customer', '客户', true), relatedList: false },
  invoice_on: Field.date({ label: '开票日期', ...required }), due_on: Field.date({ label: '应收日期', ...required }),
  total_amount: amount('价税合计'), collected_amount: { ...amount('已收金额'), readonly: true },
  outstanding_amount: { ...amount('未收金额'), readonly: true }, red_reversed_amount: { ...amount('已红冲金额'), defaultValue: 0, readonly: true },
  invoice_type: { ...Field.select([{ value: 'normal', label: '蓝字发票' }, { value: 'red', label: '红字发票' }], { label: '发票类型', defaultValue: 'normal' }), readonly: true },
  original_invoice_id: reference('forge_sales_invoice', '被红冲发票'),
  status: { ...invoiceStatus(), readonly: true },
  revenue_status: { ...Field.select([{ value: 'pending', label: '待确认' }, { value: 'pending_approval', label: '待审批' }, { value: 'approved', label: '已确认' }, { value: 'rejected', label: '已驳回' }, { value: 'not_applicable', label: '不适用' }], { label: '收入确认', defaultValue: 'pending' }), readonly: true },
  reversed_by: Field.user({ label: '红冲人', readonly: true }), reversed_at: Field.datetime({ label: '红冲时间', readonly: true }),
  reversal_reason: Field.textarea({ label: '红冲原因', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'customer_id', 'order_id', 'invoice_on', 'due_on', 'total_amount', 'red_reversed_amount', 'outstanding_amount', 'status', 'responsible_id']);

export const SalesInvoiceLine = master('forge_sales_invoice_line', '销项发票明细', 'list', {
  name: text('物料/服务名称', true), invoice_id: reference('forge_sales_invoice', '销项发票', true),
  order_id: reference('forge_sales_order', '销售订单', true), order_line_id: reference('forge_sales_order_line', '订单明细', true),
  sku_id: reference('forge_material_sku', '物料规格', true), item_code: text('物料编码'), model: text('型号'),
  specification: text('规格'), unit_name: text('单位'), quantity: quantity('开票数量'),
  red_reversed_quantity: Field.number({ label: '已红冲数量', min: 0, scale: 4, defaultValue: 0, readonly: true }),
  taxed_unit_price: amount('含税单价'), tax_rate: Field.number({ label: '税率', min: 0, max: 100, scale: 4, defaultValue: 13 }),
  taxed_subtotal: amount('价税小计'), remarks: remarks(),
}, ['invoice_id', 'order_id', 'item_code', 'name', 'model', 'quantity', 'red_reversed_quantity', 'taxed_unit_price', 'tax_rate', 'taxed_subtotal']);

// RM-133 lists receivables independently from invoices so cash allocation can be added later without rewriting invoice history.
export const AccountsReceivable = master('forge_accounts_receivable', '应收账款', 'wallet-cards', {
  name: text('应收名称', true), code: code('应收编号'), source_type: Field.select([
    { value: 'sales_invoice', label: '销项发票' }, { value: 'service_settlement', label: '服务结算' }, { value: 'opening_balance', label: '期初应收' },
  ], { label: '应收来源', defaultValue: 'sales_invoice', ...required }), invoice_id: reference('forge_sales_invoice', '销项发票'),
  service_settlement_id: reference('forge_service_settlement', '服务结算单'),
  order_id: reference('forge_sales_order', '销售订单'), contract_id: reference('forge_sales_contract', '销售合同'),
  customer_id: { ...reference('forge_customer', '客户', true), relatedList: false }, recognized_on: Field.date({ label: '确认日期', ...required }),
  due_on: Field.date({ label: '到期日期', ...required }), original_amount: amount('应收原值'),
  collected_amount: { ...amount('已核销金额'), readonly: true }, offset_amount: { ...amount('已对冲金额'), defaultValue: 0, readonly: true }, red_reversed_amount: { ...amount('已红冲金额'), defaultValue: 0, readonly: true }, outstanding_amount: { ...amount('应收余额'), readonly: true },
  historical_contract_no: text('历史合同编号'), invoice_marker: Field.select([{ value: 'invoiced', label: '已开票' }, { value: 'not_invoiced', label: '未开票' }, { value: 'unknown', label: '不详' }], { label: '历史开票标记', defaultValue: 'unknown' }),
  status: { ...receivableStatus(), readonly: true }, responsible_id: owner(true), remarks: remarks(),
}, ['code', 'source_type', 'customer_id', 'invoice_id', 'service_settlement_id', 'order_id', 'recognized_on', 'due_on', 'original_amount', 'collected_amount', 'offset_amount', 'red_reversed_amount', 'outstanding_amount', 'status', 'responsible_id']);

// RM-139 and DR-0172 to DR-0176 separate business evidence from finance approval.
// This first executable slice closes shipment and invoice triggers; the remaining methods stay explicit metadata until their source schedules exist.
export const RevenueRecognition = master('forge_revenue_recognition', '销售收入确认', 'badge-dollar-sign', {
  name: text('确认单名称', true), code: code('确认单号'), source_key: text('来源键', true),
  source_type: Field.select([
    { value: 'sales_outbound', label: '销售出库' }, { value: 'sales_invoice', label: '销项发票' },
    { value: 'milestone', label: '收入里程碑' }, { value: 'acceptance', label: '客户验收' },
    { value: 'period', label: '收入周期' }, { value: 'manual', label: '手工确认' },
  ], { label: '业务来源', ...required }), source_id: text('来源记录', true),
  outbound_id: reference('forge_sales_outbound', '销售出库单'), invoice_id: reference('forge_sales_invoice', '销项发票'),
  order_id: reference('forge_sales_order', '来源订单', true), contract_id: reference('forge_sales_contract', '关联合同'),
  customer_id: { ...reference('forge_customer', '客户', true), relatedList: false }, project_id: reference('forge_project', '项目'),
  confirmation_method: Field.select([
    { value: 'shipment', label: '按发货' }, { value: 'invoice', label: '按开票' },
    { value: 'milestone', label: '按里程碑' }, { value: 'acceptance', label: '按验收' },
    { value: 'period', label: '按周期' }, { value: 'manual', label: '手动' },
  ], { label: '确认方式', ...required }),
  net_amount: amount('净确认金额'), order_amount: { ...amount('订单金额'), readonly: true },
  cumulative_amount: { ...amount('累计确认金额'), readonly: true }, remaining_amount: { ...amount('剩余待确认'), readonly: true },
  recognition_on: Field.date({ label: '确认日期', ...required }), financial_period: text('财务期间', true),
  invoice_status: Field.select([
    { value: 'not_invoiced', label: '未开票' }, { value: 'partially_invoiced', label: '部分开票' }, { value: 'fully_invoiced', label: '已开票' },
  ], { label: '开票状态', defaultValue: 'not_invoiced' }),
  status: { ...Field.select([
    { value: 'pending_review', label: '待审核' }, { value: 'approved', label: '已审核' },
    { value: 'rejected', label: '已驳回' }, { value: 'voided', label: '已作废' },
  ], { label: '状态', defaultValue: 'pending_review' }), readonly: true },
  maker_id: Field.user({ label: '制单人', ...required, readonly: true }), made_at: Field.datetime({ label: '制单时间', ...required, readonly: true }),
  reviewer_id: Field.user({ label: '审核人', readonly: true }), reviewed_at: Field.datetime({ label: '审核时间', readonly: true }),
  review_comment: Field.textarea({ label: '审核意见', readonly: true }), responsible_id: owner(true), remarks: remarks(),
}, ['code', 'order_id', 'customer_id', 'confirmation_method', 'net_amount', 'cumulative_amount', 'order_amount', 'remaining_amount', 'recognition_on', 'financial_period', 'invoice_status', 'status', 'maker_id', 'reviewer_id']);

export const RevenueRecognitionLog = master('forge_revenue_recognition_log', '收入确认审批记录', 'history', {
  name: text('记录名称', true), event_key: code('事件键'), recognition_id: reference('forge_revenue_recognition', '收入确认单', true),
  action: Field.select([{ value: 'created', label: '生成确认单' }, { value: 'approved', label: '审核通过' }, { value: 'rejected', label: '驳回' }, { value: 'voided', label: '作废' }], { label: '动作', ...required }),
  from_status: text('原状态'), to_status: text('新状态'), comment: Field.textarea({ label: '意见' }),
  occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['recognition_id', 'action', 'from_status', 'to_status', 'comment', 'operator_id', 'occurred_at']);

// RM-131 to RM-135 separate the physical fund account and receipt flow from receivable write-off.
// Successful same-input RISEMAP receipt allocation is still pending, so approval is explicit and auditable here.
export const FundAccount = master('forge_fund_account', '资金账户', 'landmark', {
  name: text('账户名称', true), code: code('账户编码'), account_type: Field.select([
    { value: 'bank', label: '银行账户' }, { value: 'wechat', label: '微信' },
    { value: 'alipay', label: '支付宝' }, { value: 'cash', label: '现金账户' },
    { value: 'other', label: '其他' },
  ], { label: '账户类型', ...required }),
  bank_name: text('开户银行'), branch_name: text('开户支行'), account_number: text('账户号码'),
  bank_account_type: Field.select([{ value: 'basic', label: '基本户' }, { value: 'general', label: '一般户' }, { value: 'special', label: '专用户' }], { label: '银行账户类型', defaultValue: 'general' }),
  currency: Field.select([{ value: 'cny', label: '人民币 (CNY)' }], { label: '币种', defaultValue: 'cny', ...required }),
  opening_balance: amount('期初余额'), current_balance: { ...amount('当前余额'), readonly: true },
  opening_on: Field.date({ label: '期初日期', ...required }), allow_print: Field.boolean({ label: '允许打印', defaultValue: false }),
  account_manager: text('客户经理'), manager_phone: text('联系电话'), visibility_scope: Field.select([
    { value: 'creator_admin', label: '仅创建人+管理员可见' }, { value: 'organization', label: '全组织可见' },
  ], { label: '可见范围', defaultValue: 'creator_admin' }),
  status: Field.select([{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }], { label: '账户状态', defaultValue: 'active' }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'name', 'account_type', 'bank_name', 'account_number', 'currency', 'opening_balance', 'current_balance', 'status']);

export const FinanceLoan = master('forge_finance_loan', '借款贷款', 'hand-coins', {
  name: text('借款标题', true), code: code('借款单号'), loan_type: Field.select([
    { value: 'employee', label: '员工借款' }, { value: 'bank', label: '银行贷款' },
  ], { label: '借款类型', defaultValue: 'employee', ...required }),
  purpose: Field.textarea({ label: '借款用途', ...required }), purpose_category: Field.select([
    { value: 'business', label: '业务支出' }, { value: 'travel', label: '差旅支出' },
    { value: 'project_transport', label: '项目费用 / 项目差旅费用 / 项目交通费' },
    { value: 'purchase', label: '采购支出' }, { value: 'other', label: '其他' },
  ], { label: '用途分类', defaultValue: 'business', ...required }),
  amount: amount('借款金额'), outstanding_amount: { ...amount('未还本金'), readonly: true }, repaid_amount: { ...amount('已还本金'), defaultValue: 0, readonly: true },
  project_id: reference('forge_project', '关联项目'), fund_account_id: reference('forge_fund_account', '资金账户'),
  expected_repayment_on: Field.date({ label: '预计还款日期' }), applicant_id: Field.user({ label: '申请人' }),
  bank_name: text('贷款银行'), branch_name: text('分行/支行'), contract_number: text('贷款合同号'),
  annual_interest_rate: Field.number({ label: '年化利率 (%)', min: 0, max: 100, scale: 4 }),
  interest_rate_type: Field.select([{ value: 'fixed', label: '固定利率' }, { value: 'lpr_float', label: 'LPR浮动' }], { label: '利率类型', defaultValue: 'lpr_float' }),
  interest_benchmark: text('利率基准'), bank_loan_type: Field.select([{ value: 'short_term', label: '短期流贷' }, { value: 'project', label: '项目贷款' }, { value: 'fixed_asset', label: '固定资产贷款' }, { value: 'other', label: '其他' }], { label: '贷款类型', defaultValue: 'short_term' }),
  term_months: Field.number({ label: '贷款期限（月）', min: 1, scale: 0 }), repayment_method: Field.select([{ value: 'monthly_interest_balloon', label: '按月付息到期还本' }, { value: 'equal_principal_interest', label: '等额本息' }, { value: 'equal_principal', label: '等额本金' }, { value: 'balloon', label: '到期一次还本付息' }], { label: '还款方式', defaultValue: 'monthly_interest_balloon' }),
  disbursed_on: Field.date({ label: '放款日' }), maturity_on: Field.date({ label: '到期日' }), next_payment_on: Field.date({ label: '下期应还日' }),
  guarantee_type: Field.select([{ value: 'credit', label: '信用' }, { value: 'guarantee', label: '保证' }, { value: 'mortgage', label: '抵押' }, { value: 'pledge', label: '质押' }], { label: '担保方式', defaultValue: 'credit' }), collateral_or_guarantor: text('担保物/保证人'),
  submitted_at: Field.datetime({ label: '提交时间', readonly: true }), approved_at: Field.datetime({ label: '审批时间', readonly: true }), approver_id: Field.user({ label: '审批人', readonly: true }), approval_comment: Field.textarea({ label: '审批意见', readonly: true }),
  status: Field.select([
    { value: 'draft', label: '草稿' }, { value: 'pending_review', label: '审批中' },
    { value: 'approved', label: '已通过' }, { value: 'active', label: '还款中' }, { value: 'partially_repaid', label: '部分归还' }, { value: 'repaid', label: '已还清' }, { value: 'rejected', label: '已驳回' },
  ], { label: '状态', defaultValue: 'draft' }), responsible_id: owner(true), remarks: remarks(),
}, ['code', 'name', 'loan_type', 'purpose_category', 'amount', 'outstanding_amount', 'repaid_amount', 'project_id', 'fund_account_id', 'expected_repayment_on', 'bank_name', 'contract_number', 'annual_interest_rate', 'disbursed_on', 'maturity_on', 'status']);

export const FinanceLoanTransaction = master('forge_finance_loan_transaction', '借款还款流水', 'arrow-left-right', {
  name: text('流水名称', true), code: code('流水编号'), loan_id: reference('forge_finance_loan', '借款贷款', true), account_id: reference('forge_fund_account', '资金账户', true),
  transaction_type: Field.select([{ value: 'disbursement', label: '放款' }, { value: 'repayment', label: '还款' }], { label: '流水类型', ...required }), occurred_on: Field.date({ label: '业务日期', ...required }),
  principal_amount: amount('本金金额'), interest_amount: amount('利息金额'), balance_after: { ...amount('交易后未还本金'), readonly: true }, responsible_id: owner(true), remarks: remarks(),
}, ['code', 'loan_id', 'transaction_type', 'account_id', 'occurred_on', 'principal_amount', 'interest_amount', 'balance_after']);

export const FinanceCreditRequest = master('forge_finance_credit_request', '客户授信申请', 'badge-check', {
  name: text('申请名称', true), code: code('申请编号'), customer_id: { ...reference('forge_customer', '客户', true), relatedList: false }, requested_limit: amount('申请额度'), payment_days: Field.number({ label: '申请账期天数', min: 0, scale: 0 }),
  reason: Field.textarea({ label: '申请原因', ...required }), status: { ...Field.select([{ value: 'pending_review', label: '待审批' }, { value: 'approved', label: '已通过' }, { value: 'rejected', label: '已驳回' }], { label: '审批状态', defaultValue: 'pending_review' }), readonly: true },
  applicant_id: Field.user({ label: '申请人', readonly: true }), submitted_at: Field.datetime({ label: '提交时间', readonly: true }), reviewer_id: Field.user({ label: '审批人', readonly: true }), reviewed_at: Field.datetime({ label: '审批时间', readonly: true }), review_comment: Field.textarea({ label: '审批意见', readonly: true }), responsible_id: owner(true), remarks: remarks(),
}, ['code', 'customer_id', 'requested_limit', 'payment_days', 'reason', 'status', 'applicant_id', 'submitted_at', 'reviewer_id', 'reviewed_at']);

export const SalesInvoiceRequest = master('forge_sales_invoice_request', '销项开票申请', 'file-check-2', {
  name: text('申请名称', true), code: code('申请编号'), order_id: reference('forge_sales_order', '销售订单', true), customer_id: { ...reference('forge_customer', '客户', true), relatedList: false },
  requested_quantity: quantity('申请开票数量'), requested_amount: amount('申请开票金额'), requested_on: Field.date({ label: '申请日期', ...required }), expected_invoice_on: Field.date({ label: '期望开票日期', ...required }), due_on: Field.date({ label: '应收日期', ...required }),
  invoice_code: text('发票编号'), invoice_id: reference('forge_sales_invoice', '销项发票'), status: { ...Field.select([{ value: 'pending_review', label: '待审批' }, { value: 'approved', label: '待开票' }, { value: 'issued', label: '已开票' }, { value: 'rejected', label: '已驳回' }], { label: '任务状态', defaultValue: 'pending_review' }), readonly: true },
  applicant_id: Field.user({ label: '申请人', readonly: true }), submitted_at: Field.datetime({ label: '提交时间', readonly: true }), reviewer_id: Field.user({ label: '审批人', readonly: true }), reviewed_at: Field.datetime({ label: '审批时间', readonly: true }), review_comment: Field.textarea({ label: '审批意见', readonly: true }), responsible_id: owner(true), remarks: remarks(),
}, ['code', 'order_id', 'customer_id', 'requested_quantity', 'requested_amount', 'requested_on', 'expected_invoice_on', 'due_on', 'status', 'invoice_code', 'invoice_id']);

export const CashReceipt = master('forge_cash_receipt', '收款流水', 'badge-dollar-sign', {
  name: text('收款流水名称', true), code: code('流水号'), customer_id: { ...reference('forge_customer', '客户', true), relatedList: false },
  account_id: reference('forge_fund_account', '收款账户', true), received_on: Field.date({ label: '收款日期', ...required }),
  payment_method: paymentMethod(), amount: amount('收款金额'), allocated_amount: { ...amount('已分配金额'), readonly: true },
  unallocated_amount: { ...amount('未分配金额'), readonly: true },
  status: { ...Field.select([
    { value: 'unallocated', label: '待分配' }, { value: 'partially_allocated', label: '部分分配' },
    { value: 'pending_review', label: '待审核' }, { value: 'allocated', label: '已分配' }, { value: 'reversed', label: '已撤销' },
  ], { label: '分配状态', defaultValue: 'unallocated' }), readonly: true },
  counterpart_reference: text('对方流水号'), reversed_by: Field.user({ label: '撤销人', readonly: true }),
  reversed_at: Field.datetime({ label: '撤销时间', readonly: true }), reversal_reason: Field.textarea({ label: '撤销原因', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'customer_id', 'received_on', 'payment_method', 'account_id', 'amount', 'allocated_amount', 'unallocated_amount', 'status']);

export const CollectionAllocation = master('forge_collection_allocation', '收款核销', 'badge-check', {
  name: text('核销名称', true), code: code('核销编号'), receipt_id: reference('forge_cash_receipt', '收款流水', true),
  receivable_id: reference('forge_accounts_receivable', '应收账款', true), invoice_id: reference('forge_sales_invoice', '销项发票', true),
  order_id: reference('forge_sales_order', '销售订单', true), contract_id: reference('forge_sales_contract', '销售合同'),
  customer_id: { ...reference('forge_customer', '客户', true), relatedList: false }, allocated_on: Field.date({ label: '分配日期', ...required }),
  amount: amount('核销金额'), status: { ...Field.select([
    { value: 'pending_review', label: '待审核' }, { value: 'approved', label: '已审核' },
    { value: 'cancelled', label: '已取消' }, { value: 'reversed', label: '已反核销' },
  ], { label: '核销状态', defaultValue: 'pending_review' }), readonly: true },
  approved_at: { ...Field.datetime({ label: '审核时间' }), readonly: true }, reversed_by: Field.user({ label: '反核销人', readonly: true }),
  reversed_at: Field.datetime({ label: '反核销时间', readonly: true }), reversal_reason: Field.textarea({ label: '反核销原因', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'receipt_id', 'receivable_id', 'customer_id', 'order_id', 'allocated_on', 'amount', 'status', 'responsible_id']);

export const CollectionReversalLog = master('forge_collection_reversal_log', '收款撤销记录', 'history', {
  name: text('记录名称', true), event_key: code('事件键'), receipt_id: reference('forge_cash_receipt', '收款流水', true),
  allocation_id: reference('forge_collection_allocation', '收款核销'), action: Field.select([
    { value: 'writeoff_reversed', label: '反核销' }, { value: 'receipt_reversed', label: '撤销到账' },
  ], { label: '动作', ...required }), amount: amount('金额'), reason: Field.textarea({ label: '原因', ...required }),
  occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['receipt_id', 'allocation_id', 'action', 'amount', 'reason', 'operator_id', 'occurred_at']);

export const CustomerPrepayment = master('forge_customer_prepayment', '客户预收款', 'landmark', {
  name: text('预收款名称', true), code: code('预收款编号'), customer_id: { ...reference('forge_customer', '客户', true), relatedList: false },
  order_id: reference('forge_sales_order', '销售订单', true), contract_id: reference('forge_sales_contract', '销售合同'),
  receipt_id: reference('forge_cash_receipt', '收款流水', true), original_amount: amount('预收金额'),
  offset_amount: { ...amount('已冲抵金额'), readonly: true }, refunded_amount: { ...amount('已退款金额'), readonly: true },
  balance_amount: { ...amount('预收款余额'), readonly: true }, status: { ...Field.select([
    { value: 'pending_confirmation', label: '待确认' }, { value: 'active', label: '待分配' },
    { value: 'partially_used', label: '部分使用' }, { value: 'settled', label: '已结清' },
    { value: 'refunded', label: '已退款' },
  ], { label: '预收款状态', defaultValue: 'pending_confirmation' }), readonly: true },
  confirmed_by: Field.user({ label: '确认人', readonly: true }), confirmed_at: Field.datetime({ label: '确认时间', readonly: true }),
  confirmation_comment: Field.textarea({ label: '确认意见', readonly: true }), responsible_id: owner(true), remarks: remarks(),
}, ['code', 'customer_id', 'order_id', 'receipt_id', 'original_amount', 'offset_amount', 'refunded_amount', 'balance_amount', 'status']);

export const CustomerPrepaymentOffset = master('forge_customer_prepayment_offset', '预收款冲抵', 'badge-check', {
  name: text('冲抵名称', true), code: code('冲抵编号'), prepayment_id: reference('forge_customer_prepayment', '客户预收款', true),
  receivable_id: reference('forge_accounts_receivable', '应收账款', true), invoice_id: reference('forge_sales_invoice', '销项发票', true),
  customer_id: { ...reference('forge_customer', '客户', true), relatedList: false }, order_id: reference('forge_sales_order', '销售订单', true),
  contract_id: reference('forge_sales_contract', '销售合同'), amount: amount('冲抵金额'), offset_on: Field.date({ label: '冲抵日期', ...required }),
  reviewer_id: Field.user({ label: '核销人', readonly: true }), reviewed_at: Field.datetime({ label: '核销时间', readonly: true }),
  review_comment: Field.textarea({ label: '核销意见', readonly: true }), status: { ...Field.select([
    { value: 'approved', label: '已核销' }, { value: 'reversed', label: '已撤回' },
  ], { label: '冲抵状态', defaultValue: 'approved' }), readonly: true }, responsible_id: owner(true), remarks: remarks(),
  reversed_by: Field.user({ label: '撤回人', readonly: true }), reversed_at: Field.datetime({ label: '撤回时间', readonly: true }),
  reversal_reason: Field.textarea({ label: '撤回原因', readonly: true }),
}, ['code', 'prepayment_id', 'receivable_id', 'customer_id', 'order_id', 'amount', 'offset_on', 'status', 'reversed_by', 'reversed_at', 'reversal_reason']);

export const CustomerRefund = master('forge_customer_refund', '客户退款', 'undo-2', {
  name: text('退款名称', true), code: code('申请单号'), prepayment_id: reference('forge_customer_prepayment', '客户预收款', true),
  order_id: reference('forge_sales_order', '关联销售订单', true), contract_id: reference('forge_sales_contract', '关联合同'),
  customer_id: { ...reference('forge_customer', '客户', true), relatedList: false },
  currency: Field.select([{ value: 'cny', label: '人民币' }, { value: 'usd', label: '美元' }, { value: 'eur', label: '欧元' }], { label: '币种', defaultValue: 'cny' }),
  requested_amount: amount('申请退款金额'), actual_amount: { ...amount('实退金额'), readonly: true },
  refund_method: paymentMethod('退款方式'), application_on: Field.date({ label: '申请日期', ...required }), reason: Field.textarea({ label: '退款原因', ...required }),
  document_status: { ...Field.select([
    { value: 'pending_review', label: '待审批' }, { value: 'approved', label: '已审批' }, { value: 'rejected', label: '已驳回' },
    { value: 'pending_writeoff', label: '待核销' }, { value: 'completed', label: '已完成' },
  ], { label: '单据状态', defaultValue: 'pending_review' }), readonly: true },
  finance_status: { ...Field.select([{ value: 'pending', label: '待审批' }, { value: 'approved', label: '已审批' }, { value: 'rejected', label: '已驳回' }], { label: '财务审批', defaultValue: 'pending' }), readonly: true },
  payment_status: { ...Field.select([{ value: 'pending', label: '待付款' }, { value: 'paid', label: '已付款' }], { label: '付款状态', defaultValue: 'pending' }), readonly: true },
  writeoff_status: { ...Field.select([{ value: 'pending', label: '待核销' }, { value: 'approved', label: '已核销' }], { label: '核销状态', defaultValue: 'pending' }), readonly: true },
  account_id: reference('forge_fund_account', '付款账户'), bank_reference: text('银行流水号'), applicant_id: Field.user({ label: '申请人', ...required }),
  approver_id: Field.user({ label: '审批人', readonly: true }), approved_at: Field.datetime({ label: '审批时间', readonly: true }), approval_comment: Field.textarea({ label: '审批意见', readonly: true }),
  reviewer_id: Field.user({ label: '核销人', readonly: true }), reviewed_at: Field.datetime({ label: '核销时间', readonly: true }), review_comment: Field.textarea({ label: '核销意见', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'contract_id', 'order_id', 'customer_id', 'currency', 'actual_amount', 'refund_method', 'document_status', 'finance_status', 'payment_status', 'writeoff_status', 'application_on']);

export const ProjectSettlement = master('forge_project_settlement', '项目结算', 'chart-no-axes-combined', {
  name: text('结算名称', true), code: code('结算编号'), project_id: reference('forge_project', '项目', true),
  settled_on: Field.date({ label: '结算日期', ...required }), contract_amount: { ...amount('合同金额'), readonly: true },
  invoiced_amount: { ...amount('已开票'), readonly: true }, collected_amount: { ...amount('已回款'), readonly: true },
  production_cost: { ...amount('生产材料成本'), readonly: true }, labor_cost: { ...amount('人工成本'), readonly: true },
  manufacturing_cost: { ...amount('制造费用'), readonly: true }, travel_cost: { ...amount('差旅费用'), readonly: true },
  subcontract_cost: { ...amount('委外成本'), readonly: true }, other_cost: { ...amount('其他项目成本'), readonly: true },
  total_cost: { ...amount('项目总成本'), readonly: true }, gross_margin: { ...signedAmount('项目毛利'), readonly: true },
  gross_margin_rate: Field.number({ label: '毛利率 (%)', scale: 4, readonly: true }),
  status: { ...Field.select([{ value: 'settled', label: '已结算' }], { label: '结算状态', defaultValue: 'settled' }), readonly: true },
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'project_id', 'settled_on', 'contract_amount', 'invoiced_amount', 'collected_amount', 'production_cost', 'labor_cost', 'manufacturing_cost', 'travel_cost', 'subcontract_cost', 'other_cost', 'total_cost', 'gross_margin', 'gross_margin_rate', 'status']);

// RM-142 reimbursement drafts contain a project cost owner and one or more dated expense lines.
export const ProjectExpense = master('forge_project_expense', '项目费用报销', 'hand-coins', {
  name: text('费用标题', true), code: code('报销单号'), project_id: reference('forge_project', '关联项目', true),
  customer_id: { ...reference('forge_customer', '客户', true), relatedList: false }, ownership_type: Field.select([
    { value: 'project', label: '项目成本' },
  ], { label: '成本归属', defaultValue: 'project', ...required }),
  claim_type: Field.select([
    { value: 'self', label: '本人报销' }, { value: 'on_behalf', label: '代人报销' },
  ], { label: '报销类型', defaultValue: 'self', ...required }),
  applicant_id: Field.user({ label: '申请人', ...required }), beneficiary_id: Field.user({ label: '报销人', ...required }),
  supplier_id: reference('forge_supplier', '供应商'), expected_payment_on: Field.date({ label: '期望付款日期' }),
  total_amount: { ...amount('单据金额'), readonly: true }, line_count: Field.number({ label: '费用项数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  status: { ...Field.select([
    { value: 'draft', label: '待提交' }, { value: 'pending_review', label: '待审核' },
    { value: 'approved', label: '已通过' }, { value: 'rejected', label: '已驳回' },
    { value: 'paid', label: '已打款' }, { value: 'voided', label: '已作废' },
  ], { label: '报销状态', defaultValue: 'draft' }), readonly: true },
  submitted_at: Field.datetime({ label: '提交时间', readonly: true }), reviewed_at: Field.datetime({ label: '审核时间', readonly: true }),
  reviewer_id: Field.user({ label: '审核人', readonly: true }), review_comment: Field.textarea({ label: '审核意见', readonly: true }),
  cost_entry_count: Field.number({ label: '成本记录数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'name', 'ownership_type', 'claim_type', 'applicant_id', 'beneficiary_id', 'project_id', 'supplier_id', 'total_amount', 'line_count', 'status']);

export const ProjectExpenseLine = master('forge_project_expense_line', '项目费用明细', 'list', {
  name: text('费用名称', true), line_key: code('费用明细编号'), expense_id: reference('forge_project_expense', '报销单', true),
  category: Field.select([
    { value: 'manufacturing', label: '制造费用' }, { value: 'travel', label: '差旅费用' },
    { value: 'subcontract', label: '外协与委外' }, { value: 'inspection', label: '检测认证' },
    { value: 'software', label: '软件与云服务' }, { value: 'office', label: '行政办公' }, { value: 'other', label: '其他费用' },
  ], { label: '费用类别', ...required }),
  cost_type: Field.select([
    { value: 'manufacturing', label: '制造费用' }, { value: 'travel', label: '差旅费用' },
    { value: 'subcontract', label: '委外成本' }, { value: 'other', label: '其他成本' },
  ], { label: '成本类型', ...required }),
  occurred_on: Field.date({ label: '发生日期', ...required }), amount: amount('金额'),
  description: Field.textarea({ label: '费用说明', ...required }), invoice_reference: text('票据编号'),
  attachment: Field.file({ label: '票据附件' }), remarks: remarks(),
}, ['expense_id', 'line_key', 'category', 'cost_type', 'name', 'occurred_on', 'amount', 'description', 'invoice_reference']);

const payableStatus = () => Field.select([
  { value: 'unpaid', label: '未付款' }, { value: 'partially_paid', label: '部分付款' },
  { value: 'settled', label: '已结清' }, { value: 'overdue', label: '已逾期' }, { value: 'red_reversed', label: '已红冲' },
], { label: '应付状态', defaultValue: 'unpaid' });

// RM-017, RM-133 and RM-135 expose purchase invoices, payables and payment tasks as separate ledgers.
// The successful same-input RISEMAP flow is still absent, so this slice keeps invoice registration and payable recognition explicit.
export const PurchaseInvoice = master('forge_purchase_invoice', '进项发票', 'receipt', {
  name: text('发票名称', true), code: code('登记编号'), invoice_number: text('发票号码', true),
  inbound_id: reference('forge_purchase_inbound', '采购入库单', true), order_id: reference('forge_purchase_order', '采购订单', true),
  supplier_id: reference('forge_supplier', '供应商', true), invoice_on: Field.date({ label: '开票日期', ...required }),
  due_on: Field.date({ label: '应付日期', ...required }), total_amount: amount('价税合计'),
  red_reversed_amount: { ...amount('已红冲金额'), defaultValue: 0, readonly: true },
  tax_rate: Field.number({ label: '税率', min: 0, max: 100, scale: 4, defaultValue: 13 }),
  invoice_category: Field.select([
    { value: 'vat_special', label: '增值税专用发票' }, { value: 'vat_general', label: '增值税普通发票' },
    { value: 'electronic_special', label: '电子专票' }, { value: 'electronic_general', label: '电子普票' },
  ], { label: '票种', defaultValue: 'vat_special' }),
  deduction_status: { ...Field.select([
    { value: 'pending', label: '待认证' }, { value: 'certified', label: '已认证抵扣' },
    { value: 'not_deductible', label: '不抵扣' },
  ], { label: '抵扣状态', defaultValue: 'pending' }), readonly: true },
  deducted_at: Field.datetime({ label: '认证时间', readonly: true }), deduction_operator_id: Field.user({ label: '认证人', readonly: true }),
  deduction_reason: Field.textarea({ label: '抵扣说明', readonly: true }),
  invoice_type: { ...Field.select([{ value: 'normal', label: '蓝字发票' }, { value: 'red', label: '红字发票' }], { label: '发票类型', defaultValue: 'normal' }), readonly: true },
  original_invoice_id: reference('forge_purchase_invoice', '被红冲发票'),
  status: { ...Field.select([
    { value: 'normal', label: '正常' }, { value: 'voided', label: '已作废' }, { value: 'partially_red_reversed', label: '部分红冲' }, { value: 'red_reversed', label: '已红冲' }, { value: 'red_invoice', label: '红字发票' },
  ], { label: '发票状态', defaultValue: 'normal' }), readonly: true },
  reversed_by: Field.user({ label: '红冲人', readonly: true }), reversed_at: Field.datetime({ label: '红冲时间', readonly: true }),
  reversal_reason: Field.textarea({ label: '红冲原因', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'invoice_number', 'invoice_on', 'supplier_id', 'order_id', 'total_amount', 'red_reversed_amount', 'tax_rate', 'invoice_category', 'deduction_status', 'status', 'responsible_id']);

export const PurchaseInvoiceLine = master('forge_purchase_invoice_line', '进项发票明细', 'list', {
  name: text('物料名称', true), invoice_id: reference('forge_purchase_invoice', '进项发票', true),
  inbound_id: reference('forge_purchase_inbound', '采购入库单', true), order_id: reference('forge_purchase_order', '采购订单', true),
  order_line_id: reference('forge_purchase_order_line', '采购订单明细', true), sku_id: reference('forge_material_sku', '物料规格', true),
  item_code: text('物料编码'), quantity: quantity('开票数量'), taxed_unit_price: amount('含税单价'),
  red_reversed_quantity: Field.number({ label: '已红冲数量', min: 0, scale: 4, defaultValue: 0, readonly: true }),
  tax_rate: Field.number({ label: '税率', min: 0, max: 100, scale: 4, defaultValue: 13 }), taxed_subtotal: amount('价税小计'),
  remarks: remarks(),
}, ['invoice_id', 'inbound_id', 'order_id', 'item_code', 'name', 'quantity', 'red_reversed_quantity', 'taxed_unit_price', 'tax_rate', 'taxed_subtotal']);

export const InvoiceReversalLog = master('forge_invoice_reversal_log', '发票红冲记录', 'history', {
  name: text('记录名称', true), event_key: code('事件键'), direction: Field.select([
    { value: 'sales', label: '销项' }, { value: 'purchase', label: '进项' },
  ], { label: '发票方向', ...required }),
  original_sales_invoice_id: reference('forge_sales_invoice', '原销项发票'), red_sales_invoice_id: reference('forge_sales_invoice', '红字销项发票'),
  original_purchase_invoice_id: reference('forge_purchase_invoice', '原进项发票'), red_purchase_invoice_id: reference('forge_purchase_invoice', '红字进项发票'),
  reversal_kind: Field.select([{ value: 'full', label: '全额红冲' }, { value: 'partial', label: '部分红冲' }], { label: '红冲方式', defaultValue: 'full' }),
  amount: amount('红冲金额'), remaining_amount: { ...amount('红冲后净额'), readonly: true }, reason: Field.textarea({ label: '红冲原因', ...required }),
  occurred_at: Field.datetime({ label: '红冲时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['event_key', 'direction', 'reversal_kind', 'original_sales_invoice_id', 'red_sales_invoice_id', 'original_purchase_invoice_id', 'red_purchase_invoice_id', 'amount', 'remaining_amount', 'reason', 'operator_id', 'occurred_at']);

export const AccountsPayable = master('forge_accounts_payable', '应付账款', 'hand-coins', {
  name: text('应付名称', true), code: code('应付编号'), source_type: Field.select([
  { value: 'purchase_inbound', label: '采购入库' }, { value: 'purchase_invoice', label: '进项发票' }, { value: 'subcontract_reconciliation', label: '委外对账' }, { value: 'opening_balance', label: '期初应付' },
  ], { label: '应付来源', ...required }),
  inbound_id: reference('forge_purchase_inbound', '采购入库单'), invoice_id: reference('forge_purchase_invoice', '进项发票'), reconciliation_id: reference('forge_subcontract_reconciliation', '委外对账单'),
  order_id: reference('forge_purchase_order', '采购订单'), supplier_id: reference('forge_supplier', '供应商', true),
  recognized_on: Field.date({ label: '确认日期', ...required }), due_on: Field.date({ label: '到期日期' }),
  original_amount: amount('应付原值'), paid_amount: { ...amount('已付款金额'), readonly: true },
  offset_amount: { ...amount('已冲抵金额'), readonly: true }, red_reversed_amount: { ...amount('已红冲金额'), defaultValue: 0, readonly: true }, outstanding_amount: { ...amount('应付余额'), readonly: true },
  historical_contract_no: text('历史合同编号'), invoice_marker: Field.select([{ value: 'invoiced', label: '已开票' }, { value: 'not_invoiced', label: '未开票' }, { value: 'unknown', label: '不详' }], { label: '历史开票标记', defaultValue: 'unknown' }),
  status: { ...payableStatus(), readonly: true }, responsible_id: owner(true), remarks: remarks(),
}, ['code', 'source_type', 'supplier_id', 'inbound_id', 'invoice_id', 'order_id', 'recognized_on', 'due_on', 'original_amount', 'red_reversed_amount', 'outstanding_amount', 'status', 'responsible_id']);

// RM-021 and RM-136 separate the business payment request, physical outgoing payment and finance write-off.
export const PaymentTask = master('forge_payment_task', '付款任务', 'send-horizontal', {
  name: text('付款任务名称', true), code: code('付款任务编号'), source_type: Field.select([
    { value: 'purchase_payable', label: '采购应付' }, { value: 'purchase_prepayment', label: '采购预付' }, { value: 'expense', label: '费用报销' },
    { value: 'subcontract', label: '委外应付' }, { value: 'transport', label: '运输应付' },
  ], { label: '来源', ...required }),
  payable_id: reference('forge_accounts_payable', '应付账款'), inbound_id: reference('forge_purchase_inbound', '采购入库单'),
  invoice_id: reference('forge_purchase_invoice', '进项发票'), order_id: reference('forge_purchase_order', '采购订单'),
  supplier_id: reference('forge_supplier', '供应商/往来单位', true), requested_amount: amount('申请付款金额'),
  payable_amount: { ...amount('应付款金额'), readonly: true }, paid_amount: { ...amount('已付款金额'), readonly: true },
  remaining_amount: { ...amount('待付款金额'), readonly: true }, payment_method: paymentMethod('付款方式'),
  recipient_name: text('收款户名', true), recipient_account: text('收款账号', true), recipient_bank: text('开户银行'),
  planned_on: Field.date({ label: '计划付款日', ...required }), applicant_id: Field.user({ label: '申请人', ...required }),
  approver_id: Field.user({ label: '审批人', readonly: true }), approved_at: Field.datetime({ label: '审批时间', readonly: true }),
  approval_comment: Field.textarea({ label: '审批意见', readonly: true }), status: { ...Field.select([
    { value: 'pending_review', label: '待审批' }, { value: 'approved', label: '已审批' },
    { value: 'rejected', label: '已驳回' }, { value: 'partially_paid', label: '部分付款' }, { value: 'paid', label: '已付清' },
  ], { label: '付款审批状态', defaultValue: 'pending_review' }), readonly: true },
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'source_type', 'order_id', 'supplier_id', 'requested_amount', 'payable_amount', 'paid_amount', 'remaining_amount', 'planned_on', 'status']);

export const CashPayment = master('forge_cash_payment', '付款流水', 'badge-minus', {
  name: text('付款流水名称', true), code: code('付款流水号'), task_id: reference('forge_payment_task', '付款任务', true),
  payable_id: reference('forge_accounts_payable', '应付账款'), supplier_id: reference('forge_supplier', '供应商/往来单位', true),
  account_id: reference('forge_fund_account', '付款账户', true), paid_on: Field.date({ label: '付款日期', ...required }),
  payment_method: paymentMethod('付款方式'), amount: amount('付款金额'), allocated_amount: { ...amount('已核销金额'), readonly: true },
  unallocated_amount: { ...amount('未核销金额'), readonly: true }, status: { ...Field.select([
    { value: 'pending_writeoff', label: '待核销' }, { value: 'allocated', label: '已核销' }, { value: 'reversed', label: '已撤销' },
  ], { label: '核销状态', defaultValue: 'pending_writeoff' }), readonly: true },
  bank_reference: text('银行流水号'), reversed_by: Field.user({ label: '撤销人', readonly: true }),
  reversed_at: Field.datetime({ label: '撤销时间', readonly: true }), reversal_reason: Field.textarea({ label: '撤销原因', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'task_id', 'supplier_id', 'paid_on', 'payment_method', 'account_id', 'amount', 'allocated_amount', 'unallocated_amount', 'status']);

export const PaymentWriteoff = master('forge_payment_writeoff', '付款核销', 'badge-check', {
  name: text('核销名称', true), code: code('核销编号'), payment_id: reference('forge_cash_payment', '付款流水', true),
  task_id: reference('forge_payment_task', '付款任务', true), payable_id: reference('forge_accounts_payable', '应付账款', true),
  supplier_id: reference('forge_supplier', '供应商/往来单位', true), amount: amount('核销金额'),
  status: { ...Field.select([
    { value: 'pending_review', label: '待审核' }, { value: 'approved', label: '已核销' },
    { value: 'cancelled', label: '已取消' }, { value: 'reversed', label: '已反核销' },
  ], { label: '核销状态', defaultValue: 'pending_review' }), readonly: true },
  reviewer_id: Field.user({ label: '核销人', readonly: true }), reviewed_at: Field.datetime({ label: '核销时间', readonly: true }),
  review_comment: Field.textarea({ label: '核销意见', readonly: true }), reversed_by: Field.user({ label: '撤销人', readonly: true }),
  reversed_at: Field.datetime({ label: '撤销时间', readonly: true }), reversal_reason: Field.textarea({ label: '撤销原因', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'payment_id', 'task_id', 'payable_id', 'supplier_id', 'amount', 'status']);

export const PaymentReversalLog = master('forge_payment_reversal_log', '付款撤销记录', 'history', {
  name: text('记录名称', true), event_key: code('事件键'), payment_id: reference('forge_cash_payment', '付款流水', true),
  writeoff_id: reference('forge_payment_writeoff', '付款核销'), action: Field.select([
    { value: 'writeoff_cancelled', label: '取消待核销' }, { value: 'writeoff_reversed', label: '反核销' },
    { value: 'payment_reversed', label: '撤销付款' },
  ], { label: '动作', ...required }), amount: amount('金额'), reason: Field.textarea({ label: '原因', ...required }),
  occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['payment_id', 'writeoff_id', 'action', 'amount', 'reason', 'operator_id', 'occurred_at']);

export const SupplierPrepayment = master('forge_supplier_prepayment', '供应商预付款', 'landmark', {
  name: text('预付款名称', true), code: code('预付款编号'), supplier_id: reference('forge_supplier', '供应商/往来单位', true),
  order_id: reference('forge_purchase_order', '采购订单', true), task_id: reference('forge_payment_task', '付款任务', true),
  payment_id: reference('forge_cash_payment', '付款流水', true), original_amount: amount('预付金额'),
  offset_amount: { ...amount('已冲抵金额'), readonly: true }, refunded_amount: { ...amount('已退款金额'), readonly: true },
  balance_amount: { ...amount('预付款余额'), readonly: true }, status: { ...Field.select([
    { value: 'active', label: '待分配' }, { value: 'partially_used', label: '部分冲抵' },
    { value: 'settled', label: '已结清' }, { value: 'refunded', label: '已退款' },
  ], { label: '预付款状态', defaultValue: 'active' }), readonly: true }, responsible_id: owner(true), remarks: remarks(),
}, ['code', 'supplier_id', 'order_id', 'payment_id', 'original_amount', 'offset_amount', 'refunded_amount', 'balance_amount', 'status']);

export const SupplierPrepaymentOffset = master('forge_supplier_prepayment_offset', '预付款冲抵', 'badge-check', {
  name: text('冲抵名称', true), code: code('冲抵编号'), prepayment_id: reference('forge_supplier_prepayment', '供应商预付款', true),
  payable_id: reference('forge_accounts_payable', '应付账款', true), supplier_id: reference('forge_supplier', '供应商', true),
  amount: amount('冲抵金额'), offset_on: Field.date({ label: '冲抵日期', ...required }),
  reviewer_id: Field.user({ label: '核销人', readonly: true }), reviewed_at: Field.datetime({ label: '核销时间', readonly: true }),
  review_comment: Field.textarea({ label: '核销意见', readonly: true }), status: { ...Field.select([
    { value: 'approved', label: '已核销' }, { value: 'reversed', label: '已撤回' },
  ], { label: '冲抵状态', defaultValue: 'approved' }), readonly: true }, responsible_id: owner(true), remarks: remarks(),
  reversed_by: Field.user({ label: '撤回人', readonly: true }), reversed_at: Field.datetime({ label: '撤回时间', readonly: true }),
  reversal_reason: Field.textarea({ label: '撤回原因', readonly: true }),
}, ['code', 'prepayment_id', 'payable_id', 'supplier_id', 'amount', 'offset_on', 'status', 'reversed_by', 'reversed_at', 'reversal_reason']);

export const SupplierRefund = master('forge_supplier_refund', '供应商退款', 'undo-2', {
  name: text('退款名称', true), code: code('申请单号'), prepayment_id: reference('forge_supplier_prepayment', '供应商预付款', true),
  order_id: reference('forge_purchase_order', '关联采购订单', true), supplier_id: reference('forge_supplier', '供应商', true),
  currency: Field.select([{ value: 'cny', label: '人民币' }, { value: 'usd', label: '美元' }, { value: 'eur', label: '欧元' }], { label: '币种', defaultValue: 'cny' }),
  requested_amount: amount('申请退款金额'), actual_amount: { ...amount('实退金额'), readonly: true },
  refund_method: { ...paymentMethod('退款方式') }, application_on: Field.date({ label: '申请日期', ...required }), reason: Field.textarea({ label: '退款原因', ...required }),
  document_status: { ...Field.select([
    { value: 'pending_review', label: '待审批' }, { value: 'approved', label: '已审批' }, { value: 'rejected', label: '已驳回' },
    { value: 'pending_writeoff', label: '待核销' }, { value: 'completed', label: '已完成' },
  ], { label: '单据状态', defaultValue: 'pending_review' }), readonly: true },
  finance_status: { ...Field.select([{ value: 'pending', label: '待审批' }, { value: 'approved', label: '已审批' }, { value: 'rejected', label: '已驳回' }], { label: '财务审批', defaultValue: 'pending' }), readonly: true },
  receipt_status: { ...Field.select([{ value: 'pending', label: '待收款' }, { value: 'received', label: '已收款' }], { label: '收款状态', defaultValue: 'pending' }), readonly: true },
  writeoff_status: { ...Field.select([{ value: 'pending', label: '待核销' }, { value: 'approved', label: '已核销' }], { label: '核销状态', defaultValue: 'pending' }), readonly: true },
  account_id: reference('forge_fund_account', '收款账户'), bank_reference: text('银行流水号'), applicant_id: Field.user({ label: '申请人', ...required }),
  approver_id: Field.user({ label: '审批人', readonly: true }), approved_at: Field.datetime({ label: '审批时间', readonly: true }), approval_comment: Field.textarea({ label: '审批意见', readonly: true }),
  reviewer_id: Field.user({ label: '核销人', readonly: true }), reviewed_at: Field.datetime({ label: '核销时间', readonly: true }), review_comment: Field.textarea({ label: '核销意见', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'order_id', 'supplier_id', 'currency', 'actual_amount', 'refund_method', 'document_status', 'finance_status', 'receipt_status', 'writeoff_status', 'application_on']);

// RM-143 / DR-1062 to DR-1068: counterparty statements freeze a dated receivable or payable snapshot
// and keep delivery, confirmation and discrepancy handling separate from the underlying ledgers.
export const CounterpartyStatement = master('forge_counterparty_statement', '往来对账单', 'file-check-2', {
  name: text('对账单名称', true), code: code('对账单号'), party_type: Field.select([
    { value: 'customer', label: '客户应收' }, { value: 'supplier', label: '供应商应付' },
  ], { label: '往来方向', ...required }),
  customer_id: { ...reference('forge_customer', '客户'), relatedList: false }, supplier_id: reference('forge_supplier', '供应商'),
  period_start: Field.date({ label: '期间开始', ...required }), period_end: Field.date({ label: '期间结束', ...required }),
  dimension: Field.select([
    { value: 'party', label: '按往来单位' }, { value: 'contract', label: '按合同' }, { value: 'order', label: '按订单' },
    { value: 'shipment_receipt', label: '按发货/收货' }, { value: 'invoice', label: '按发票' },
    { value: 'cash', label: '按收付款' }, { value: 'balance', label: '按余额汇总' },
  ], { label: '汇总维度', defaultValue: 'balance', ...required }),
  basis: Field.select([
    { value: 'balance', label: '余额口径' }, { value: 'invoice', label: '开票口径' },
  ], { label: '生成依据', defaultValue: 'balance', ...required }),
  audited_only: Field.boolean({ label: '仅纳入已审核业务', defaultValue: true }),
  include_prepayment: Field.boolean({ label: '包含预收/预付冲抵', defaultValue: true }),
  opening_balance: { ...amount('期初余额'), readonly: true }, period_charge: { ...amount('本期应收/应付'), readonly: true },
  period_settlement: { ...amount('本期收款/付款'), readonly: true }, closing_balance: { ...amount('期末余额'), readonly: true },
  line_count: Field.number({ label: '明细行数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  currency: Field.select([{ value: 'cny', label: '人民币 (CNY)' }], { label: '币种', defaultValue: 'cny', ...required }),
  status: { ...Field.select([
    { value: 'draft', label: '草稿' }, { value: 'sent', label: '已发送待确认' }, { value: 'confirmed', label: '已确认' },
    { value: 'disputed', label: '有差异' }, { value: 'closed', label: '已关闭' },
  ], { label: '对账状态', defaultValue: 'draft' }), readonly: true },
  recipient: text('发送对象'), sent_by: Field.user({ label: '发送人', readonly: true }), sent_at: Field.datetime({ label: '发送时间', readonly: true }),
  confirmed_balance: { ...amount('对方确认余额'), readonly: true }, discrepancy_amount: { ...amount('差异金额'), readonly: true },
  discrepancy_reason: Field.textarea({ label: '差异说明', readonly: true }), confirmed_by: Field.user({ label: '确认登记人', readonly: true }),
  confirmed_at: Field.datetime({ label: '确认时间', readonly: true }), closed_by: Field.user({ label: '关闭人', readonly: true }),
  closed_at: Field.datetime({ label: '关闭时间', readonly: true }), resolution_note: Field.textarea({ label: '差异处理说明', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'party_type', 'customer_id', 'supplier_id', 'period_start', 'period_end', 'dimension', 'basis', 'opening_balance', 'period_charge', 'period_settlement', 'closing_balance', 'status', 'responsible_id']);

export const CounterpartyStatementLine = master('forge_counterparty_statement_line', '往来对账明细', 'list', {
  name: text('明细名称', true), statement_id: reference('forge_counterparty_statement', '对账单', true),
  line_no: Field.number({ label: '行号', min: 1, scale: 0, ...required }), occurred_on: Field.date({ label: '业务日期', ...required }),
  entry_type: Field.select([
    { value: 'receivable', label: '应收发生' }, { value: 'collection', label: '收款核销' }, { value: 'customer_prepayment_offset', label: '预收冲抵' },
    { value: 'payable', label: '应付发生' }, { value: 'payment', label: '付款核销' }, { value: 'supplier_prepayment_offset', label: '预付冲抵' },
  ], { label: '明细类型', ...required }),
  direction: Field.select([{ value: 'increase', label: '增加余额' }, { value: 'decrease', label: '减少余额' }], { label: '余额方向', ...required }),
  source_key: text('来源键', true), receivable_id: reference('forge_accounts_receivable', '应收账款'), payable_id: reference('forge_accounts_payable', '应付账款'),
  collection_id: reference('forge_collection_allocation', '收款核销'), payment_writeoff_id: reference('forge_payment_writeoff', '付款核销'),
  contract_id: reference('forge_sales_contract', '合同'), order_id: reference('forge_sales_order', '订单'),
  shipment_id: reference('forge_sales_outbound', '发货单'), invoice_id: reference('forge_sales_invoice', '发票'),
  cash_receipt_id: reference('forge_cash_receipt', '收款流水'), cash_payment_id: reference('forge_cash_payment', '付款流水'),
  contract_key: text('合同维度键'), order_key: text('订单维度键'), shipment_key: text('发货/收货维度键'),
  invoice_key: text('发票维度键'), cash_key: text('收付款维度键'),
  amount: amount('发生金额'), running_balance: { ...signedAmount('结余'), readonly: true }, description: text('摘要'),
}, ['statement_id', 'line_no', 'occurred_on', 'entry_type', 'direction', 'source_key', 'contract_key', 'order_key', 'shipment_key', 'invoice_key', 'cash_key', 'amount', 'running_balance', 'description']);

export const CounterpartyStatementLog = master('forge_counterparty_statement_log', '往来对账操作记录', 'history', {
  name: text('记录名称', true), event_key: code('事件键'), statement_id: reference('forge_counterparty_statement', '对账单', true),
  action: Field.select([
    { value: 'generated', label: '生成' }, { value: 'sent', label: '发送' }, { value: 'confirmed', label: '确认一致' },
    { value: 'disputed', label: '反馈差异' }, { value: 'closed', label: '差异关闭' }, { value: 'reopened', label: '重新发起确认' },
  ], { label: '动作', ...required }), from_status: text('原状态'), to_status: text('新状态'), comment: Field.textarea({ label: '说明' }),
  occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['event_key', 'statement_id', 'action', 'from_status', 'to_status', 'comment', 'operator_id', 'occurred_at']);
