import { ObjectSchema, Field } from '@objectstack/spec/data';
import { owner, reference, remarks, required, text } from '../model.js';

const revision = () => Field.number({ label: '修订号', min: 1, scale: 0, defaultValue: 1, readonly: true, hidden: true });
const quantity = (label: string, mandatory = false) => Field.number({ label, min: mandatory ? 0.0001 : 0, scale: 4, ...(mandatory ? required : { defaultValue: 0 }) });

/**
 * Repair-pool intake. The fields mirror only the observed list/filter facts;
 * source and impact remain text because the current capture did not expose a
 * controlled vocabulary.
 */
export const RepairRequest = ObjectSchema.create({
  name: 'forge_repair_request', label: '报修记录', pluralLabel: '报修记录', icon: 'wrench',
  sharingModel: 'private', nameField: 'name',
  fields: {
    name: Field.text({ label: '问题摘要', maxLength: 255, ...required }),
    code: Field.autonumber({ label: '报修单号', autonumberFormat: 'RP-{YYYYMMDD}-{0000}', unique: 'global' }),
    source: Field.text({ label: '来源', maxLength: 255, ...required }),
    impact: Field.text({ label: '影响', maxLength: 255 }),
    site: Field.text({ label: '现场', maxLength: 255 }),
    product_name: Field.text({ label: '产品', maxLength: 255 }),
    product_sn: Field.text({ label: '产品编号', maxLength: 255 }),
    problem: Field.textarea({ label: '问题描述' }),
    customer_id: reference('forge_customer', '客户'),
    contact_name: Field.text({ label: '联系人', maxLength: 255 }),
    contact_phone: Field.text({ label: '联系方式', maxLength: 100 }),
    report_attachments: Field.file({ label: '报修附件', multiple: true }),
    reported_at: Field.datetime({ label: '提交时间', ...required }),
    reported_by: Field.user({ label: '提交员工', readonly: true }),
    status: Field.select([
      { value: 'pending', label: '待处理' },
      { value: 'duplicate', label: '重复上报' },
      { value: 'converted', label: '已转工单' },
    ], { label: '状态', defaultValue: 'pending', readonly: true }),
    service_order_id: reference('forge_service_order', '关联服务工单'),
    responsible_id: owner(),
    request_key: Field.text({ label: '提交幂等键', maxLength: 128, readonly: true, hidden: true }),
    request_signature: Field.text({ label: '提交内容签名', maxLength: 2048, readonly: true, hidden: true }),
    revision: revision(),
    remarks: remarks(),
  },
  indexes: [
    { fields: ['request_key'], unique: 'organization' },
  ],
  listViews: { all: { label: '全部报修', type: 'grid', columns: ['code', 'source', 'site', 'product_name', 'problem', 'contact_phone', 'reported_at', 'status'] } },
  enable: { apiEnabled: true, searchable: true, trackHistory: true },
});

/** A single SKU request row; multi-SKU line editor was not observed. */
export const ServicePartRequest = ObjectSchema.create({
  name: 'forge_service_part_request', label: '备件工单', pluralLabel: '备件工单', icon: 'package-search',
  sharingModel: 'private', nameField: 'name',
  fields: {
    name: Field.text({ label: '备件工单标题', maxLength: 255, ...required }),
    code: Field.autonumber({ label: '工单号', autonumberFormat: 'SP-{YYYYMMDD}-{0000}', unique: 'global' }),
    service_order_id: reference('forge_service_order', '服务工单', true),
    sku_id: reference('forge_material_sku', '备件规格', true),
    warehouse_id: reference('forge_warehouse', '出库仓库', true),
    requested_quantity: quantity('申请数量', true),
    issued_quantity: quantity('出库数量'),
    received_quantity: quantity('收货数量'),
    used_quantity: quantity('使用数量'),
    returned_quantity: quantity('退库数量'),
    request_on: Field.date({ label: '申请日期', ...required }),
    requested_by: Field.user({ label: '申请员工', readonly: true }),
    engineer_id: Field.user({ label: '服务工程师' }),
    request_key: Field.text({ label: '提交幂等键', maxLength: 128, readonly: true, hidden: true }),
    request_signature: Field.text({ label: '提交内容签名', maxLength: 2048, readonly: true, hidden: true }),
    status: Field.select([
      { value: 'open', label: '待办理' },
      { value: 'completed', label: '已完成' },
      { value: 'cancelled', label: '已取消' },
    ], { label: '状态', defaultValue: 'open', readonly: true }),
    execution_status: Field.select([
      { value: 'pending_outbound', label: '待出库' },
      { value: 'outbounded', label: '已出库' },
      { value: 'received', label: '已收货' },
      { value: 'partially_used', label: '部分使用' },
      { value: 'used', label: '已使用' },
      { value: 'returned', label: '已退库' },
      { value: 'exception', label: '异常' },
    ], { label: '执行状态', defaultValue: 'pending_outbound', readonly: true }),
    exception_reason: Field.textarea({ label: '异常说明', readonly: true }),
    exception_previous_status: Field.text({ label: '异常前执行状态', maxLength: 64, readonly: true, hidden: true }),
    last_event_at: Field.datetime({ label: '最近执行时间', readonly: true }),
    inventory_issue_ledger_id: Field.text({ label: '出库流水标识', readonly: true, hidden: true }),
    revision: revision(),
    remarks: remarks(),
  },
  indexes: [
    { fields: ['request_key'], unique: 'organization' },
  ],
  listViews: { all: { label: '备件工单', type: 'grid', columns: ['code', 'service_order_id', 'sku_id', 'warehouse_id', 'requested_quantity', 'status', 'execution_status', 'request_on'] } },
  enable: { apiEnabled: true, searchable: true, trackHistory: true },
});

/** Immutable business audit trail for stock-affecting service-part actions. */
export const ServicePartRequestEvent = ObjectSchema.create({
  name: 'forge_service_part_request_event', label: '备件工单执行记录', pluralLabel: '备件工单执行记录', icon: 'list-checks',
  sharingModel: 'controlled_by_parent', nameField: 'name',
  fields: {
    name: Field.text({ label: '执行记录', maxLength: 255, ...required }),
    request_id: Field.masterDetail('forge_service_part_request', { label: '备件工单', deleteBehavior: 'restrict', ...required }),
    event_type: Field.select([
      { value: 'outbound', label: '出库' }, { value: 'receive', label: '收货' },
      { value: 'use', label: '使用' }, { value: 'return', label: '退库' },
      { value: 'exception', label: '异常' },
    ], { label: '执行类型', ...required }),
    event_key: Field.text({ label: '请求幂等键', maxLength: 128, ...required }),
    quantity: quantity('数量'),
    from_status: Field.text({ label: '原执行状态', maxLength: 64 }),
    to_status: Field.text({ label: '新执行状态', maxLength: 64 }),
    inventory_ledger_id: Field.text({ label: '库存流水内部标识', maxLength: 128, readonly: true, hidden: true }),
    inventory_ledger_code: Field.text({ label: '库存流水号', maxLength: 100, readonly: true }),
    comment: Field.textarea({ label: '说明' }),
    occurred_at: Field.datetime({ label: '发生时间', ...required }),
    operator_id: Field.user({ label: '操作员工', ...required }),
    revision: revision(),
  },
  indexes: [
    { fields: ['request_id', 'event_key'], unique: 'organization' },
  ],
  enable: { apiEnabled: true, searchable: false, trackHistory: true },
});

/** Warranty lifecycle events preserve the prior and resulting coverage dates. */
export const WarrantyCardEvent = ObjectSchema.create({
  name: 'forge_warranty_card_event', label: '质保变更记录', pluralLabel: '质保变更记录', icon: 'history',
  sharingModel: 'controlled_by_parent', nameField: 'name',
  fields: {
    name: Field.text({ label: '变更记录', maxLength: 255, ...required }),
    warranty_id: Field.masterDetail('forge_warranty_card', { label: '质保卡', deleteBehavior: 'restrict', ...required }),
    event_type: Field.select([{ value: 'activated', label: '激活' }, { value: 'extended', label: '延保' }], { label: '变更类型', ...required }),
    idempotency_key: Field.text({ label: '请求幂等键', maxLength: 128, ...required }),
    previous_status: Field.text({ label: '原状态', maxLength: 64 }),
    next_status: Field.text({ label: '新状态', maxLength: 64 }),
    previous_starts_on: Field.date({ label: '原开始日期' }),
    starts_on: Field.date({ label: '开始日期' }),
    previous_ends_on: Field.date({ label: '原到期日期' }),
    ends_on: Field.date({ label: '新到期日期' }),
    note: Field.textarea({ label: '变更说明' }),
    occurred_at: Field.datetime({ label: '操作时间', ...required }),
    operator_id: Field.user({ label: '操作员工', ...required }),
    revision: revision(),
  },
  indexes: [
    { fields: ['warranty_id', 'idempotency_key'], unique: 'organization' },
  ],
  enable: { apiEnabled: true, searchable: false, trackHistory: true },
});
