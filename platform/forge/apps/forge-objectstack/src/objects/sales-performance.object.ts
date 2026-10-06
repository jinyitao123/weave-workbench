import { Field, ObjectSchema } from '@objectstack/spec/data';
import { master, owner, required, text, remarks } from '../model.js';

const money = (label: string, positive = false) => Field.currency({ label, precision: 18, ...(positive ? { min: 0 } : {}) });
const percentage = (label: string, min: number, max: number) => Field.number({ label, min, max, scale: 4 });

/**
 * A source-backed personal performance entry. Original confirmations are
 * materialized from completed orders with approved revenue-recognition
 * sources. Rebook rows are append-only credit/debit postings.
 */
export const SalesPerformanceEntry = ObjectSchema.create({
  ...master('forge_sales_performance_entry', '销售业绩流水', 'chart-no-axes-combined', {
    name: text('业绩流水名称', true), code: Field.autonumber({ label: '业绩流水编号', autonumberFormat: 'PE-{YYYYMMDD}-{0000}' }),
    entry_key: { ...Field.text({ label: '来源幂等键', maxLength: 255, unique: 'organization', hidden: true, ...required }), readonly: true },
    entry_type: Field.select([
      { value: 'original_confirm', label: '原始确认' }, { value: 'rebook_out', label: '业绩分出' },
      { value: 'rebook_in', label: '业绩分入' }, { value: 'return_adjustment', label: '退货冲减' },
      { value: 'return_restore', label: '退货恢复' },
    ], { label: '流水方向', ...required, readonly: true }),
    amount_direction: Field.select([{ value: 'increase', label: '增加' }, { value: 'decrease', label: '减少' }], { label: '金额方向', ...required, readonly: true }),
    source_entry_id: Field.lookup('forge_sales_performance_entry', { label: '来源业绩流水', relatedList: false }),
    confirmation_id: Field.lookup('forge_sales_performance_confirmation', { label: '业绩确认单', relatedList: false }),
    rebook_id: Field.lookup('forge_sales_performance_rebook', { label: 'Rebook申请', relatedList: false }),
    order_id: { ...Field.lookup('forge_sales_order', { label: '销售订单', required: true, relatedList: false }), readonly: true },
    order_code_snapshot: { ...Field.text({ label: '销售订单号快照', maxLength: 100 }), readonly: true },
    customer_id: { ...Field.lookup('forge_customer', { label: '客户', relatedList: false }), readonly: true },
    customer_name_snapshot: { ...Field.text({ label: '客户名称快照', maxLength: 255 }), readonly: true },
    source_recognition_amount: { ...money('批准收入确认来源金额', true), readonly: true },
    recognition_on: { ...Field.date({ label: '收入确认日期', readonly: true }), readonly: true },
    order_amount: { ...money('销售订单额', true), readonly: true },
    performance_amount: { ...money('业绩金额', true), readonly: true },
    performance_ratio: { ...percentage('计收比例 (%)', 0, 100), readonly: true },
    rebooked_amount: { ...money('已分配业绩金额', true), readonly: true },
    rebook_reserved_amount: { ...money('待审批预留金额', true), readonly: true },
    revision: { ...Field.number({ label: '流水版本', min: 0, scale: 0 }), readonly: true },
    gross_profit: { ...money('毛利'), readonly: true },
    gross_profit_rate: { ...percentage('毛利率 (%)', -100000, 100000), readonly: true },
    tax_basis: { ...Field.select([
      { value: 'source_lines_reconciled', label: '源单税基已核对' },
      { value: 'unverified', label: '税基未核对' },
      { value: 'incomplete', label: '来源不完整' },
    ], { label: '收入税基', readonly: true }), readonly: true },
    cost_complete: { ...Field.boolean({ label: '成本已完整核对', readonly: true }), readonly: true },
    sales_person_id: { ...Field.user({ label: '业绩人', ...required, readonly: true }), readonly: true },
    sales_person_name_snapshot: { ...Field.text({ label: '业绩人名称快照', maxLength: 255 }), readonly: true },
    business_unit_id: { ...Field.lookup('sys_business_unit', { label: '原生业务单元', relatedList: false }), readonly: true },
    team_name_snapshot: { ...Field.text({ label: '销售团队名称快照', maxLength: 255 }), readonly: true },
    status: Field.select([
      { value: 'pending', label: '待确认' }, { value: 'pending_approval', label: '待审批' },
      { value: 'confirmed', label: '已确认' }, { value: 'rebooked', label: '已分配' }, { value: 'rejected', label: '已驳回' },
    ], { label: '业绩状态', ...required, readonly: true }),
    approval_status: { ...Field.text({ label: '原生审批状态', maxLength: 32, readonly: true }), readonly: true, hidden: true },
    flow_instance_code: { ...Field.text({ label: '审批流程实例', maxLength: 100, hidden: true }), readonly: true },
    source_signature: { ...Field.textarea({ label: '来源快照签名', hidden: true }), readonly: true },
    confirmed_by: { ...Field.user({ label: '确认人', readonly: true }), readonly: true },
    confirmed_at: Field.datetime({ label: '确认时间', readonly: true }),
    submitted_by: { ...Field.user({ label: '提交人', readonly: true }), readonly: true },
    submitted_at: Field.datetime({ label: '提交时间', readonly: true }),
    reviewed_by: { ...Field.user({ label: '审核人', readonly: true }), readonly: true },
    reviewed_at: Field.datetime({ label: '审核时间', readonly: true }),
    review_comment: { ...Field.textarea({ label: '审核意见', readonly: true }), readonly: true },
    responsible_id: owner(true), remarks: remarks(),
  }, ['entry_type', 'order_id', 'order_code_snapshot', 'customer_name_snapshot', 'sales_person_name_snapshot', 'order_amount', 'performance_amount', 'performance_ratio', 'rebooked_amount', 'status', 'confirmed_at']),
  indexes: [
    { fields: ['entry_key'], unique: 'organization' },
    { fields: ['order_id', 'entry_type', 'status', 'confirmed_at'] },
    { fields: ['sales_person_id', 'status', 'confirmed_at'] },
    { fields: ['business_unit_id', 'status', 'confirmed_at'] },
    { fields: ['source_entry_id', 'entry_type'] },
  ],
  enable: { apiEnabled: true, apiMethods: ['get', 'list'], searchable: false, trackHistory: true, files: false, feeds: false, activities: false },
});

/** Per-source immutable tax snapshots used to audit an original confirmation. */
export const SalesPerformanceEntrySource = ObjectSchema.create({
  ...master('forge_sales_performance_entry_source', '业绩确认来源明细', 'list', {
    name: { ...text('来源明细名称', true), readonly: true },
    entry_id: { ...Field.masterDetail('forge_sales_performance_entry', { label: '业绩流水', deleteBehavior: 'restrict', required: true }), relatedList: 'primary', readonly: true },
    recognition_id: { ...Field.lookup('forge_revenue_recognition', { label: '收入确认单', required: true, relatedList: false }), readonly: true },
    recognition_line_id: { ...Field.lookup('forge_revenue_recognition_line', { label: '收入确认明细', relatedList: false }), readonly: true },
    source_id: { ...Field.text({ label: '来源明细标识', maxLength: 255, ...required }), readonly: true },
    source_amount: { ...money('含税来源金额', true), readonly: true },
    untaxed_amount: { ...money('不含税确认金额', true), readonly: true },
    tax_amount: { ...money('确认税额', true), readonly: true },
    tax_rate: { ...percentage('税率 (%)', 0, 100), readonly: true },
    tax_basis: { ...Field.text({ label: '税基核对', maxLength: 40, readonly: true }), readonly: true },
  }, ['entry_id', 'recognition_id', 'source_id', 'source_amount', 'untaxed_amount', 'tax_amount', 'tax_rate', 'tax_basis']),
  indexes: [{ fields: ['recognition_id', 'source_id'], unique: 'organization' }, { fields: ['entry_id', 'recognition_id'] }],
  enable: { apiEnabled: true, apiMethods: ['get', 'list'], searchable: false, trackHistory: true, files: false, feeds: false, activities: false },
});

/** A native-approval request to turn one eligible pending entry into a confirmed record. */
export const SalesPerformanceConfirmation = ObjectSchema.create({
  ...master('forge_sales_performance_confirmation', '销售业绩确认', 'badge-check', {
    name: text('业绩确认名称', true), code: Field.autonumber({ label: '业绩确认单号', autonumberFormat: 'PC-{YYYYMMDD}-{0000}' }),
    request_key: { ...Field.text({ label: '提交请求标识', maxLength: 128, unique: 'organization', hidden: true, ...required }), readonly: true },
    request_signature: { ...Field.textarea({ label: '提交请求签名', hidden: true }), readonly: true },
    entry_id: { ...Field.masterDetail('forge_sales_performance_entry', { label: '待确认业绩', deleteBehavior: 'restrict', required: true }), readonly: true },
    order_id: { ...Field.lookup('forge_sales_order', { label: '销售订单', required: true, relatedList: false }), readonly: true },
    order_code_snapshot: { ...Field.text({ label: '销售订单号快照', maxLength: 100 }), readonly: true },
    sales_person_id: { ...Field.user({ label: '业绩人', ...required }), readonly: true },
    business_unit_id: { ...Field.lookup('sys_business_unit', { label: '原生业务单元', relatedList: false }), readonly: true },
    order_amount: { ...money('销售订单额', true), readonly: true },
    source_recognized_amount: { ...money('批准收入确认金额', true), readonly: true },
    recognition_on: { ...Field.date({ label: '收入确认日期', readonly: true }), readonly: true },
    performance_ratio: { ...percentage('计收比例 (%)', 1, 100), readonly: true },
    performance_amount: { ...money('不含税业绩金额', true), readonly: true },
    cost_amount: { ...money('已核对成本金额', true), readonly: true },
    gross_profit: { ...money('财务已确认毛利'), readonly: true },
    gross_profit_rate: { ...percentage('毛利率 (%)', -100000, 100000), readonly: true },
    tax_basis: { ...Field.select([
      { value: 'source_lines_reconciled', label: '源单税基已核对' }, { value: 'unverified', label: '税基未核对' },
      { value: 'incomplete', label: '来源不完整' },
    ], { label: '收入税基', readonly: true }), readonly: true },
    cost_complete: { ...Field.boolean({ label: '成本已完整核对', readonly: true }), readonly: true },
    cost_signature: { ...Field.textarea({ label: '批准成本来源快照签名', hidden: true, readonly: true }), readonly: true },
    status: Field.select([
      { value: 'pending_approval', label: '待审批' }, { value: 'confirmed', label: '已确认' },
      { value: 'rejected', label: '已驳回' },
    ], { label: '确认状态', ...required, readonly: true }),
    approval_status: { ...Field.text({ label: '原生审批状态', maxLength: 32, readonly: true }), readonly: true, hidden: true },
    submitted_by: { ...Field.user({ label: '提交人', ...required, readonly: true }), readonly: true },
    submitted_at: Field.datetime({ label: '提交时间', readonly: true }),
    reviewed_by: { ...Field.user({ label: '审核人', readonly: true }), readonly: true },
    reviewed_at: Field.datetime({ label: '审核时间', readonly: true }),
    review_comment: { ...Field.textarea({ label: '审批意见', readonly: true }), readonly: true },
    flow_instance_code: { ...Field.text({ label: '审批流程实例', maxLength: 100, hidden: true }), readonly: true },
    remarks: remarks(), responsible_id: owner(true),
  }, ['order_code_snapshot', 'sales_person_id', 'order_amount', 'performance_amount', 'gross_profit', 'gross_profit_rate', 'status', 'submitted_at']),
  indexes: [
    { fields: ['request_key'], unique: 'organization' },
    { fields: ['entry_id', 'status', 'submitted_at'] },
    { fields: ['order_id', 'status'] },
  ],
  enable: { apiEnabled: true, apiMethods: ['get', 'list'], searchable: false, trackHistory: true, files: false, feeds: false, activities: false },
});

/** A Rebook approval request; posted entries are written by its approved native Flow. */
export const SalesPerformanceRebook = ObjectSchema.create({
  ...master('forge_sales_performance_rebook', 'Rebook申请', 'arrow-left-right', {
    name: text('Rebook申请名称', true), code: Field.autonumber({ label: 'Rebook单号', autonumberFormat: 'RB-{YYYYMMDD}-{0000}' }),
    request_key: { ...Field.text({ label: '提交请求标识', maxLength: 128, unique: 'organization', hidden: true, ...required }), readonly: true },
    request_signature: { ...Field.textarea({ label: '提交请求签名', hidden: true }), readonly: true },
    source_entry_id: { ...Field.lookup('forge_sales_performance_entry', { label: '来源业绩', required: true, relatedList: false }), readonly: true },
    source_order_id: { ...Field.lookup('forge_sales_order', { label: '来源订单', required: true, relatedList: false }), readonly: true },
    source_order_code: { ...Field.text({ label: '来源订单号快照', maxLength: 100 }), readonly: true },
    customer_id: { ...Field.lookup('forge_customer', { label: '客户', relatedList: false }), readonly: true },
    source_person_id: { ...Field.user({ label: '转出人', ...required }), readonly: true },
    target_person_id: { ...Field.user({ label: '转入人', ...required }), readonly: true },
    business_unit_id: { ...Field.lookup('sys_business_unit', { label: '原生业务单元', relatedList: false }), readonly: true },
    ratio: { ...percentage('Rebook比例 (%)', 1, 100), readonly: true },
    source_performance_amount: { ...money('来源业绩金额', true), readonly: true },
    source_rebooked_amount: { ...money('来源已分配金额', true), readonly: true },
    source_reserved_amount: { ...money('来源预留金额', true), readonly: true },
    amount: { ...money('Rebook金额', true), readonly: true },
    reason_id: { ...Field.lookup('forge_business_setting_option', { label: 'Rebook原因', required: true, relatedList: false }), readonly: true },
    reason_name_snapshot: { ...Field.text({ label: 'Rebook原因快照', maxLength: 120 }), readonly: true },
    status: Field.select([
      { value: 'pending_approval', label: '待审批' }, { value: 'approved_waiting_source', label: '审批通过待原业绩确认' },
      { value: 'approved', label: '已分配' }, { value: 'rejected', label: '已驳回' }, { value: 'cancelled', label: '已取消' },
    ], { label: '状态', ...required, readonly: true }),
    approval_status: { ...Field.text({ label: '原生审批状态', maxLength: 32, readonly: true }), readonly: true, hidden: true },
    submitted_by: { ...Field.user({ label: '申请人', ...required, readonly: true }), readonly: true },
    submitted_at: Field.datetime({ label: '提交时间', readonly: true }),
    reviewed_by: { ...Field.user({ label: '审批人', readonly: true }), readonly: true },
    reviewed_at: Field.datetime({ label: '审批时间', readonly: true }),
    review_comment: { ...Field.textarea({ label: '审批意见', readonly: true }), readonly: true },
    posted_at: Field.datetime({ label: '转记时间', readonly: true }),
    remarks: remarks(), responsible_id: owner(true),
  }, ['source_order_code', 'source_person_id', 'target_person_id', 'ratio', 'amount', 'reason_name_snapshot', 'status', 'submitted_at']),
  indexes: [
    { fields: ['request_key'], unique: 'organization' },
    { fields: ['source_entry_id', 'status', 'submitted_at'] },
    { fields: ['target_person_id', 'status', 'submitted_at'] },
  ],
  enable: { apiEnabled: true, apiMethods: ['get', 'list'], searchable: false, trackHistory: true, files: false, feeds: false, activities: false },
});

/** A per-user snapshot of completed Rebook exports, not an employee task queue. */
export const SalesPerformanceExportJob = ObjectSchema.create({
  ...master('forge_sales_performance_export_job', '销售业绩导出任务', 'file-down', {
    name: text('导出任务名称', true), code: Field.autonumber({ label: '导出任务编号', autonumberFormat: 'SPE-{YYYYMMDD}-{0000}' }),
    request_key: { ...Field.text({ label: '导出请求标识', maxLength: 128, unique: 'organization', hidden: true, ...required }), readonly: true },
    request_signature: { ...Field.textarea({ label: '导出筛选签名', hidden: true }), readonly: true },
    source_view: { ...Field.select([{ value: 'rebook', label: 'Rebook记录' }], { label: '导出来源', ...required, readonly: true }), readonly: true },
    filter_snapshot: { ...Field.json({ label: '筛选条件快照', hidden: true, readonly: true }), readonly: true },
    status: Field.select([{ value: 'completed', label: '已完成' }, { value: 'failed', label: '失败' }], { label: '状态', ...required, readonly: true }),
    progress: { ...Field.number({ label: '进度 (%)', min: 0, max: 100, scale: 0, readonly: true }), readonly: true },
    row_count: { ...Field.number({ label: '导出行数', min: 0, scale: 0, readonly: true }), readonly: true },
    result_name: { ...Field.text({ label: '结果文件名', maxLength: 255, readonly: true }), readonly: true },
    result_content: { ...Field.textarea({ label: '结果文件内容', hidden: true, readonly: true, maxLength: 1000000 }), readonly: true, hidden: true },
    submitted_by: { ...Field.user({ label: '提交人', ...required, readonly: true }), readonly: true },
    submitted_at: { ...Field.datetime({ label: '提交时间', readonly: true }), readonly: true },
    completed_at: { ...Field.datetime({ label: '完成时间', readonly: true }), readonly: true },
    failure_reason: { ...Field.textarea({ label: '失败原因', readonly: true }), readonly: true },
    responsible_id: owner(true), remarks: remarks(),
  }, ['name', 'code', 'source_view', 'status', 'progress', 'row_count', 'result_name', 'submitted_at', 'completed_at']),
  indexes: [{ fields: ['request_key'], unique: 'organization' }, { fields: ['submitted_by', 'submitted_at'] }],
  enable: { apiEnabled: true, apiMethods: ['get', 'list'], searchable: false, trackHistory: false, files: false, feeds: false, activities: false },
});
