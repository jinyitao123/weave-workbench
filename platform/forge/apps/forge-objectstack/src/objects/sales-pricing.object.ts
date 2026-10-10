import { Field, ObjectSchema } from '@objectstack/spec/data';
import { master, text } from '../model.js';

const readonlyMoney = (label: string) => Field.currency({ label, precision: 18, min: 0, readonly: true });
const internalText = (label: string) => Field.textarea({ label, hidden: true, readonly: true });
const revision = () => Field.number({ label: '记录版本', scale: 0, min: 0, defaultValue: 0, hidden: true, readonly: true });
const readOnly = { apiEnabled: true, apiMethods: ['get', 'list'] as ('get' | 'list')[], trackHistory: true, searchable: true, files: false };

export const SalesPriceGroup = ObjectSchema.create({
  ...master('forge_sales_price_group', '销售价格组', 'layers', {
    name: { ...text('价格组名称', true), readonly: true },
    description: Field.textarea({ label: '描述', readonly: true }),
    status: Field.select([{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }], { label: '状态', defaultValue: 'active', readonly: true }),
    revision: revision(),
  }, ['name', 'description', 'status']),
  indexes: [{ fields: ['name'], unique: 'organization' }], enable: readOnly,
});

export const SalesPriceGroupMember = ObjectSchema.create({
  ...master('forge_sales_price_group_member', '价格组物料', 'package', {
    name: { ...text('物料名称', true), readonly: true },
    group_id: Field.masterDetail('forge_sales_price_group', { label: '价格组', required: true, readonly: true, deleteBehavior: 'restrict' }),
    sku_id: Field.lookup('forge_material_sku', { label: '物料规格', required: true, readonly: true }),
    material_code: { ...text('物料编码'), readonly: true },
  }, ['material_code', 'name', 'sku_id'], 'controlled_by_parent'),
  // One SKU can belong to one sales price group within an organization.
  indexes: [{ fields: ['sku_id'], unique: 'organization' }], enable: readOnly,
});

export const SalesPriceRequest = ObjectSchema.create({
  ...master('forge_sales_price_request', '销售价格申请', 'clipboard-list', {
    name: { ...text('申请名称', true), readonly: true },
    code: Field.autonumber({ label: '申请编号', autonumberFormat: 'PR-{YYYYMMDD}-{0000}' }),
    kind: Field.select([{ value: 'adjustment', label: '目录调价' }, { value: 'special', label: '特价申请' }, { value: 'agreement', label: '框架协议价' }], { label: '申请类型', required: true, readonly: true }),
    customer_id: Field.lookup('forge_customer', { label: '客户', readonly: true }), customer_name: { ...text('客户名称'), readonly: true },
    contact_id: Field.lookup('forge_contact', { label: '联系人', readonly: true }), contact_name: { ...text('联系人'), readonly: true },
    quotation_id: Field.lookup('forge_quotation', { label: '来源报价', readonly: true }), quotation_code: { ...text('来源报价单'), readonly: true },
    valid_from: Field.date({ label: '生效日期', readonly: true }), valid_until: Field.date({ label: '到期日期', readonly: true }),
    long_term: Field.boolean({ label: '长期有效', defaultValue: false, readonly: true }),
    priority: Field.select([{ value: 'normal', label: '普通' }, { value: 'urgent', label: '加急' }, { value: 'critical', label: '特急' }], { label: '紧急程度', defaultValue: 'normal', readonly: true }),
    reason: Field.textarea({ label: '调价原因 / 申请理由', readonly: true }),
    item_count: Field.number({ label: '物料数量', min: 1, scale: 0, readonly: true }),
    original_total: readonlyMoney('正常总价'), proposed_total: readonlyMoney('申请总价'),
    status: Field.select([{ value: 'draft', label: '草稿' }, { value: 'pending_approval', label: '审批中' }, { value: 'approved', label: '已通过' }, { value: 'rejected', label: '已驳回' }, { value: 'withdrawn', label: '已撤回' }, { value: 'terminated', label: '已终止' }], { label: '状态', defaultValue: 'draft', readonly: true }),
    effect_status: Field.select([{ value: 'pending', label: '未执行' }, { value: 'applied', label: '已生效' }, { value: 'conflict', label: '执行异常' }], { label: '价格执行结果', defaultValue: 'pending', readonly: true }),
    effect_message: Field.textarea({ label: '执行说明', readonly: true }),
    approval_status: { ...text('原生审批状态'), hidden: true, readonly: true },
    review_owner_id: Field.user({ label: '复核人', readonly: true }),
    submitted_by: Field.user({ label: '申请人', readonly: true }), submitted_at: Field.datetime({ label: '提交时间', readonly: true }),
    applied_at: Field.datetime({ label: '生效办理时间', readonly: true }), revision: revision(),
  }, ['code', 'kind', 'customer_name', 'item_count', 'original_total', 'proposed_total', 'status', 'effect_status']),
  indexes: [{ fields: ['kind', 'status'] }, { fields: ['customer_id'] }], enable: readOnly,
});

export const SalesPriceRequestLine = ObjectSchema.create({
  ...master('forge_sales_price_request_line', '销售价格申请明细', 'list', {
    name: { ...text('物料名称', true), readonly: true },
    request_id: Field.masterDetail('forge_sales_price_request', { label: '申请', required: true, readonly: true, deleteBehavior: 'restrict', relatedList: 'primary' }),
    sku_id: Field.lookup('forge_material_sku', { label: '物料规格', required: true, readonly: true }),
    material_code: { ...text('物料编码'), readonly: true }, specification: { ...text('规格型号'), readonly: true }, unit_name: { ...text('单位'), readonly: true },
    line_number: Field.number({ label: '序号', scale: 0, min: 1, readonly: true }),
    quantity: Field.number({ label: '数量 / 年度预计用量', scale: 4, min: 0, readonly: true }),
    original_price: readonlyMoney('正常售价'), proposed_price: readonlyMoney('申请单价'),
    original_minimum_price: readonlyMoney('原最低售价'), minimum_price: readonlyMoney('最低售价'),
    original_suggested_price: readonlyMoney('原建议售价'), suggested_price: readonlyMoney('建议售价'),
    original_amount: readonlyMoney('正常金额'), proposed_amount: readonlyMoney('申请金额'),
    baseline_token: internalText('冻结价格摘要'), target_key: { ...text('价格目标'), readonly: true, hidden: true },
    baseline_revision: revision(),
  }, ['line_number', 'material_code', 'name', 'quantity', 'original_price', 'proposed_price', 'proposed_amount'], 'controlled_by_parent'),
  indexes: [{ fields: ['request_id', 'sku_id'], unique: 'organization' }], enable: readOnly,
});

export const SalesPriceHistory = ObjectSchema.create({
  ...master('forge_sales_price_history', '销售价格历史', 'history', {
    name: { ...text('物料名称', true), readonly: true }, code: Field.autonumber({ label: '价格记录编号', autonumberFormat: 'PV-{YYYYMMDD}-{0000}' }),
    request_id: Field.lookup('forge_sales_price_request', { label: '来源申请', required: true, readonly: true }),
    request_line_id: Field.lookup('forge_sales_price_request_line', { label: '来源明细', required: true, readonly: true }), request_code: { ...text('申请编号'), readonly: true },
    sku_id: Field.lookup('forge_material_sku', { label: '物料规格', required: true, readonly: true }), material_code: { ...text('物料编码'), readonly: true }, specification: { ...text('规格型号'), readonly: true }, unit_name: { ...text('单位'), readonly: true },
    kind: Field.select([{ value: 'adjustment', label: '目录调价' }, { value: 'special', label: '特价' }, { value: 'agreement', label: '框架协议价' }], { label: '类型', readonly: true }),
    customer_id: Field.lookup('forge_customer', { label: '客户', readonly: true }), customer_name: { ...text('客户名称'), readonly: true },
    original_price: readonlyMoney('调前单价'), price: readonlyMoney('生效单价'),
    minimum_price: readonlyMoney('最低售价'), suggested_price: readonlyMoney('建议售价'),
    quantity: Field.number({ label: '数量', scale: 4, readonly: true }),
    valid_from: Field.date({ label: '生效日期', readonly: true }), valid_until: Field.date({ label: '到期日期', readonly: true }),
    applied_at: Field.datetime({ label: '办理时间', readonly: true }), applied_by: Field.user({ label: '申请员工', readonly: true }),
    reason: Field.textarea({ label: '调价原因', readonly: true }),
    price_revision: Field.number({ label: '价格版本', scale: 0, min: 1, readonly: true }),
  }, ['material_code', 'name', 'customer_name', 'kind', 'original_price', 'price', 'valid_from', 'valid_until', 'request_code']),
  indexes: [{ fields: ['request_line_id'], unique: 'organization' }, { fields: ['sku_id', 'customer_id', 'price_revision'] }], enable: readOnly,
});

export const SalesPriceCursor = ObjectSchema.create({
  ...master('forge_sales_price_cursor', '价格并发控制', 'lock', {
    name: { ...text('价格目标', true), hidden: true, readonly: true },
    target_key: { ...text('价格目标键', true), hidden: true, readonly: true }, revision: revision(),
  }, ['name']),
  indexes: [{ fields: ['target_key'], unique: 'organization' }],
  enable: { apiEnabled: false, searchable: false, trackHistory: false, files: false },
});

export const SalesPricingReceipt = ObjectSchema.create({
  ...master('forge_sales_pricing_receipt', '价格操作回执', 'file-check', {
    name: { ...text('操作名称', true), readonly: true },
    request_key: { ...text('操作请求标识', true), hidden: true, readonly: true },
    signature: internalText('请求摘要'), result_json: internalText('回执'),
    actor_id: Field.user({ label: '员工', readonly: true }),
  }, ['name']),
  indexes: [{ fields: ['request_key'], unique: 'organization' }],
  enable: { apiEnabled: false, searchable: false, trackHistory: false, files: false },
});
