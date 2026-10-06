import { Field, ObjectSchema } from '@objectstack/spec/data';

const required = { required: true, storage: { notNull: true } } as const;
const text = (label: string, mandatory = false) => Field.text({ label, maxLength: 255, ...(mandatory ? required : {}) });
const money = (label: string, mandatory = false) => Field.currency({ label, precision: 18, min: 0, ...(mandatory ? required : {}) });

/** Immutable, source-line tax snapshot for one income-recognition record. */
export const RevenueRecognitionLine = ObjectSchema.create({
  name: 'forge_revenue_recognition_line',
  label: '收入确认明细',
  pluralLabel: '收入确认明细',
  icon: 'list',
  sharingModel: 'controlled_by_parent',
  nameField: 'name',
  fields: {
    name: { ...text('确认物料或服务', true), readonly: true },
    recognition_id: { ...Field.masterDetail('forge_revenue_recognition', { label: '收入确认单', deleteBehavior: 'restrict', ...required }), relatedList: 'primary', readonly: true },
    source_object: { ...Field.select([
      { value: 'forge_sales_shipment_line', label: '销售发货明细' },
      { value: 'forge_sales_invoice_line', label: '销项发票明细' },
    ], { label: '源单明细类型', ...required }), readonly: true },
    source_id: { ...text('源单明细标识', true), readonly: true },
    order_id: { ...Field.lookup('forge_sales_order', { label: '销售订单', ...required, relatedList: false }), readonly: true },
    order_line_id: { ...Field.lookup('forge_sales_order_line', { label: '订单明细', relatedList: false }), readonly: true },
    sku_id: { ...Field.lookup('forge_material_sku', { label: '物料规格', relatedList: false }), readonly: true },
    item_code: { ...Field.text({ label: '物料编码', maxLength: 100 }), readonly: true },
    material_name: { ...text('物料或服务名称', true), readonly: true },
    category_id: { ...Field.lookup('forge_material_category', { label: '品类', relatedList: false }), readonly: true },
    category_name: { ...Field.text({ label: '品类名称快照', maxLength: 255 }), readonly: true },
    unit_name: { ...Field.text({ label: '单位', maxLength: 100 }), readonly: true },
    quantity: { ...Field.number({ label: '确认数量', min: 0, scale: 4, ...required }), readonly: true },
    taxed_source_amount: { ...money('源单含税金额', true), readonly: true },
    untaxed_amount: { ...money('不含税确认金额', true), readonly: true },
    tax_amount: { ...money('确认税额', true), readonly: true },
    tax_rate: { ...Field.number({ label: '源单税率 (%)', min: 0, max: 100, scale: 4, ...required }), readonly: true },
    tax_basis: { ...Field.select([
      { value: 'source_lines_reconciled', label: '源单明细已核对' },
    ], { label: '税基校验', ...required }), readonly: true },
  },
  listViews: {
    all: {
      label: '确认明细', type: 'grid',
      columns: ['name', 'item_code', 'category_name', 'quantity', 'untaxed_amount', 'tax_amount', 'source_object'],
      sort: [{ field: 'created_at', order: 'asc' }],
      pagination: { pageSize: 20 },
      selection: { type: 'none' },
      userActions: { editInline: false, group: false, hideFields: true },
    },
  },
  indexes: [
    { fields: ['recognition_id', 'source_id'], unique: 'organization' },
    { fields: ['order_line_id', 'recognition_id'] },
  ],
  enable: { apiEnabled: true, apiMethods: ['get', 'list'], searchable: false, trackHistory: true, files: false, feeds: false, activities: false },
});

/**
 * CAS budget anchor for the source amount shared by concurrent cost allocations.
 * One row per organization/source; status transitions move reserved cost to
 * approved or release it in the same ObjectQL transaction as the allocation.
 */
export const SalesGrossProfitCostBudget = ObjectSchema.create({
  name: 'forge_sales_gross_profit_cost_budget',
  label: '销售成本来源预算',
  pluralLabel: '销售成本来源预算',
  icon: 'lock-keyhole',
  sharingModel: 'private',
  nameField: 'name',
  fields: {
    name: { ...text('成本来源', true), readonly: true },
    owner_id: { ...Field.user({ label: '所有者', ...required }), readonly: true },
    budget_key: { ...Field.text({ label: '来源预算键', ...required, maxLength: 768, unique: 'organization', hidden: true }), readonly: true },
    source_type: { ...Field.select([
      { value: 'inventory_ledger', label: '库存结转流水' },
      { value: 'sales_additional_fee', label: '销售附加费用' },
      { value: 'project_cost_entry', label: '已归集项目成本' },
      { value: 'manual_adjustment', label: '成本调整' },
    ], { label: '成本来源类型', ...required }), readonly: true },
    source_id: { ...text('来源记录标识', true), readonly: true },
    source_line_id: { ...text('来源明细标识'), readonly: true },
    source_total_amount: { ...money('来源可配比总额', true), readonly: true },
    reserved_amount: { ...money('待审批预留金额'), readonly: true },
    allocated_amount: { ...money('已批准配比金额'), readonly: true },
    revision: { ...Field.number({ label: '预算版本', min: 0, scale: 0, ...required }), readonly: true },
    status: { ...Field.select([{ value: 'active', label: '启用' }, { value: 'closed', label: '已关闭' }], { label: '状态', defaultValue: 'active' }), readonly: true },
  },
  indexes: [
    { fields: ['budget_key'], unique: 'organization' },
    { fields: ['source_type', 'source_id', 'source_line_id'] },
  ],
  enable: { apiEnabled: true, apiMethods: ['get', 'list'], searchable: false, trackHistory: true, files: false, feeds: false, activities: false },
});

/**
 * Audited cost allocation against one approved recognition and one authoritative
 * source. The amount is assigned to the recognition period, never the source date.
 */
export const SalesGrossProfitCostAllocation = ObjectSchema.create({
  name: 'forge_sales_gross_profit_cost_allocation',
  label: '销售成本配比',
  pluralLabel: '销售成本配比',
  icon: 'scale',
  sharingModel: 'private',
  nameField: 'name',
  fields: {
    name: { ...text('成本配比名称', true), readonly: true },
    code: Field.autonumber({ label: '配比单号', autonumberFormat: 'SGA-{YYYYMMDD}-{0000}' }),
    owner_id: { ...Field.user({ label: '所有者', ...required }), readonly: true },
    request_key: { ...Field.text({ label: '提交请求标识', ...required, maxLength: 128, unique: 'organization', hidden: true }), readonly: true },
    allocation_key: { ...Field.text({ label: '源成本与收入行唯一键', ...required, maxLength: 512, unique: 'organization', hidden: true }), readonly: true },
    budget_id: { ...Field.lookup('forge_sales_gross_profit_cost_budget', { label: '来源预算', ...required, relatedList: false }), readonly: true },
    budget_revision: { ...Field.number({ label: '预留预算版本', min: 1, scale: 0, ...required }), readonly: true },
    order_id: { ...Field.lookup('forge_sales_order', { label: '销售订单', ...required, relatedList: false }), readonly: true },
    recognition_id: { ...Field.lookup('forge_revenue_recognition', { label: '收入确认单', ...required, relatedList: false }), readonly: true },
    recognition_line_id: { ...Field.lookup('forge_revenue_recognition_line', { label: '收入确认明细', relatedList: false }), readonly: true },
    recognition_source_line_id: { ...text('收入源单行标识'), readonly: true },
    recognition_on: { ...Field.date({ label: '收入确认期间日期', ...required }), readonly: true },
    financial_period: { ...Field.text({ label: '归属财务期间', ...required, maxLength: 7 }), readonly: true },
    source_type: { ...Field.select([
      { value: 'inventory_ledger', label: '库存结转流水' },
      { value: 'sales_additional_fee', label: '销售附加费用' },
      { value: 'project_cost_entry', label: '已归集项目成本' },
      { value: 'manual_adjustment', label: '成本调整' },
    ], { label: '成本来源', ...required }), readonly: true },
    source_id: { ...text('来源记录标识', true), readonly: true },
    source_line_id: { ...text('来源明细标识'), readonly: true },
    cost_type: { ...Field.select([
      { value: 'material', label: '物料成本' },
      { value: 'direct_fee', label: '订单直接费用' },
      { value: 'company_surcharge', label: '公司承担附加费' },
      { value: 'cost_adjustment', label: '成本调整' },
    ], { label: '成本类型', ...required }), readonly: true },
    source_amount: { ...money('源金额分配份额', true), readonly: true },
    source_tax_amount: { ...money('源金额税额'), readonly: true },
    allocated_amount: { ...money('配比金额', true), readonly: true },
    tax_basis: { ...Field.select([
      { value: 'carrying_cost', label: '库存结转成本' },
      { value: 'tax_exclusive_verified', label: '已核对不含税金额' },
      { value: 'not_subject_to_tax', label: '不含税业务' },
      { value: 'unknown', label: '税基不明' },
    ], { label: '成本税基', ...required }), readonly: true },
    reason: { ...Field.textarea({ label: '配比依据', ...required }), readonly: true },
    status: { ...Field.select([
      { value: 'draft', label: '草稿' }, { value: 'pending_approval', label: '待审批' },
      { value: 'approved', label: '已批准' }, { value: 'rejected', label: '已驳回' }, { value: 'voided', label: '已作废' },
    ], { label: '状态', defaultValue: 'draft' }), readonly: true },
    approval_status: { ...Field.text({ label: '原生审批状态', maxLength: 32, readonly: true }), hidden: true },
    submitted_by: { ...Field.user({ label: '提交人', readonly: true }), readonly: true },
    submitted_at: Field.datetime({ label: '提交时间', readonly: true }),
    reviewed_by: { ...Field.user({ label: '审核人', readonly: true }), readonly: true },
    reviewed_at: Field.datetime({ label: '审核时间', readonly: true }),
    review_comment: { ...Field.textarea({ label: '审核意见', readonly: true }), readonly: true },
    void_reason: { ...Field.textarea({ label: '冲销原因', readonly: true }), readonly: true },
    voided_by: { ...Field.user({ label: '冲销人', readonly: true }), readonly: true },
    voided_at: Field.datetime({ label: '冲销时间', readonly: true }),
    responsible_id: Field.user({ label: '负责人', readonly: true }),
  },
  listViews: {
    all: {
      label: '全部成本配比', type: 'grid',
      columns: ['code', 'order_id', 'recognition_id', 'financial_period', 'source_type', 'cost_type', 'allocated_amount', 'status'],
      sort: [{ field: 'created_at', order: 'desc' }],
      pagination: { pageSize: 20 },
      selection: { type: 'none' },
      userActions: { editInline: false, group: false, hideFields: true },
    },
  },
  indexes: [
    { fields: ['allocation_key'], unique: 'organization' },
    { fields: ['recognition_id', 'status', 'financial_period'] },
    { fields: ['source_type', 'source_id', 'source_line_id'] },
  ],
  enable: { apiEnabled: true, apiMethods: ['get', 'list'], searchable: true, trackHistory: true, files: false, feeds: false, activities: false },
});
