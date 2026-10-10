import { Field, ObjectSchema } from '@objectstack/spec/data';
import { master, text, owner, remarks } from '../model.js';

const money = (label: string) => Field.currency({ label, precision: 18, min: 0, readonly: true });
export const SalesDiscountRequest = ObjectSchema.create({
  ...master('forge_sales_discount_request', '销售优惠申请', 'badge-percent', {
    name: text('申请名称', true),
    code: Field.autonumber({ label: '申请单号', autonumberFormat: 'SD-{YYYYMMDD}-{0000}' }),
    request_key: Field.text({ label: '保存请求标识', maxLength: 128, hidden: true, readonly: true, unique: 'organization' }),
    request_signature: Field.textarea({ label: '保存请求摘要', hidden: true, readonly: true }),
    save_receipts: Field.textarea({ label: '保存请求回执', hidden: true, readonly: true }),
    order_id: Field.lookup('forge_sales_order', { label: '关联订单', required: true, readonly: true, relatedList: false }),
    order_code: { ...text('订单编号'), readonly: true },
    customer_id: Field.lookup('forge_customer', { label: '客户', readonly: true, relatedList: false }),
    customer_name: { ...text('客户名称'), readonly: true },
    discount_type: Field.select([{ value: 'amount', label: '减免金额' }, { value: 'percentage', label: '减免比例' }], { label: '优惠方式', required: true, readonly: true }),
    discount_value: Field.number({ label: '申请数值', min: 0, scale: 4, readonly: true }),
    original_amount: money('优惠前金额'), discount_amount: money('优惠金额'), proposed_amount: money('拟调整后金额'),
    reason: Field.textarea({ label: '申请原因', required: true, readonly: true }),
    status: Field.select([{ value: 'draft', label: '草稿' }, { value: 'pending_approval', label: '审批中' }, { value: 'approved', label: '已通过' }, { value: 'rejected', label: '已驳回' }, { value: 'withdrawn', label: '已撤回' }, { value: 'voided', label: '已作废' }], { label: '申请状态', defaultValue: 'draft', readonly: true }),
    approval_status: Field.text({ label: '原生审批状态', hidden: true, readonly: true }),
    review_owner_id: Field.user({ label: '复核人', readonly: true }),
    revision: Field.number({ label: '记录版本', scale: 0, min: 0, defaultValue: 0, hidden: true, readonly: true }),
    submitted_by: Field.user({ label: '申请人', readonly: true }), submitted_at: Field.datetime({ label: '提交时间', readonly: true }),
    responsible_id: owner(true), remarks: remarks(),
  }, ['code', 'order_code', 'customer_name', 'discount_type', 'original_amount', 'discount_amount', 'proposed_amount', 'status']),
  indexes: [{ fields: ['request_key'], unique: 'organization' }, { fields: ['order_id', 'status'] }],
  enable: { apiEnabled: true, apiMethods: ['get', 'list'], trackHistory: true, searchable: true, files: false },
});

export const SalesAdditionalFeeLine = ObjectSchema.create({
  ...master('forge_sales_additional_fee_line', '销售附加费用明细', 'list', {
    name: { ...text('费用名称', true), readonly: true },
    fee_id: Field.masterDetail('forge_sales_additional_fee', { label: '附加费用单', required: true, deleteBehavior: 'restrict', readonly: true, relatedList: 'primary' }),
    line_number: Field.number({ label: '序号', min: 1, scale: 0, readonly: true }),
    category: { ...text('费用类别'), readonly: true },
    untaxed_amount: money('不含税金额'), tax_rate: Field.number({ label: '税率 (%)', min: 0, max: 100, scale: 4, readonly: true }),
    tax_amount: money('税额'), total_amount: money('含税金额'), remarks: remarks(),
  }, ['line_number', 'category', 'name', 'untaxed_amount', 'tax_rate', 'tax_amount', 'total_amount'], 'controlled_by_parent'),
  indexes: [{ fields: ['fee_id', 'line_number'], unique: 'organization' }],
  enable: { apiEnabled: true, apiMethods: ['get', 'list'], trackHistory: true, searchable: true, files: false },
});
