import { defineView } from '@objectstack/spec';

const objectData = (object: string) => ({ provider: 'object' as const, object });
const newestFirst = [
  { field: 'created_at', order: 'desc' as const },
  { field: 'code', order: 'desc' as const },
];
const objectListActions = { editInline: false, group: false, hideFields: true };

/** Declarative list/form contracts used by the service React Pages and ready for the views registry. */
export const ServiceOrderViews = defineView({
  object: 'forge_service_order',
  list: {
    label: '服务工单', type: 'grid', data: objectData('forge_service_order'),
    columns: [
      { field: 'code', label: '工单号', width: 160 },
      { field: 'name', label: '工单标题', width: 220 },
      { field: 'customer_id', label: '客户', width: 180 },
      { field: 'service_object', label: '服务对象', width: 150 },
      { field: 'service_type', label: '服务类型', width: 120 },
      { field: 'service_mode', label: '服务方式', width: 105 },
      { field: 'urgency', label: '紧急度', width: 90 },
      { field: 'status', label: '状态', width: 105 },
      { field: 'engineer_name', label: '服务工程师', width: 140 },
      { field: 'scheduled_at', label: '计划日期', width: 120 },
      { field: 'sla_due_at', label: 'SLA 到期', width: 145 },
      { field: 'next_step', label: '下一步', width: 180 },
    ],
    searchableFields: ['code', 'name', 'service_object', 'service_type', 'contact_phone'],
    sort: newestFirst, pagination: { pageSize: 20 }, selection: { type: 'none' },
    userFilters: {
      element: 'dropdown',
      fields: [
        { field: 'status', type: 'select' },
        { field: 'service_mode', type: 'select' },
        { field: 'urgency', type: 'select' },
        { field: 'service_type', type: 'text' },
        { field: 'customer_id' },
      ],
    },
    userActions: objectListActions,
  },
  form: {
    type: 'simple', data: objectData('forge_service_order'), columns: 2,
    sections: [
      { name: 'request', label: '服务需求', columns: 2, fields: ['code', 'name', 'service_type', 'service_mode', 'urgency', 'expected_visit_on'] },
      { name: 'customer', label: '客户与来源', columns: 2, fields: ['customer_id', 'contact_id', 'contact_phone', 'sales_order_id', 'contract_id'] },
      { name: 'service', label: '服务信息', columns: 2, fields: ['service_object', 'service_address', 'region', 'fault_symptom', 'impact_scope', 'onsite_evidence_attachments', 'remarks'] },
      { name: 'warranty', label: '质保信息', columns: 2, fields: ['warranty_starts_on', 'warranty_ends_on', 'warranty_status', 'responsibility_type', 'quotation_handling'] },
    ],
  },
});

export const ServiceQuotationViews = defineView({
  object: 'forge_service_quotation',
  list: {
    label: '服务报价单', type: 'grid', data: objectData('forge_service_quotation'),
    columns: [
      { field: 'code', label: '报价单号', width: 160 },
      { field: 'order_code', label: '工单号', width: 150 },
      { field: 'customer_id', label: '客户', width: 180 },
      { field: 'contact_id', label: '联系人', width: 130 },
      { field: 'total_amount', label: '报价金额', width: 130, align: 'right' },
      { field: 'status', label: '状态', width: 115 },
      { field: 'valid_until', label: '有效期至', width: 120 },
      { field: 'responsible_id', label: '负责人', width: 140 },
    ],
    searchableFields: ['code', 'name', 'order_code'],
    sort: newestFirst, pagination: { pageSize: 20 }, selection: { type: 'none' },
    userFilters: { element: 'dropdown', fields: [{ field: 'status', type: 'select' }, { field: 'valid_until', type: 'date-range' }, { field: 'customer_id' }, { field: 'responsible_id' }] },
    userActions: objectListActions,
  },
  form: {
    type: 'simple', data: objectData('forge_service_quotation'), columns: 2,
    sections: [
      { name: 'source', label: '来源单据', columns: 2, fields: ['service_order_id', 'order_code', 'customer_id', 'contact_id'] },
      { name: 'quotation', label: '报价信息', columns: 2, fields: ['name', 'code', 'total_amount', 'valid_until', 'responsible_id', 'remarks'] },
    ],
  },
});

export const ServiceSettlementViews = defineView({
  object: 'forge_service_settlement',
  list: {
    label: '服务结算单', type: 'grid', data: objectData('forge_service_settlement'),
    columns: [
      { field: 'code', label: '结算单号', width: 160 },
      { field: 'order_code', label: '工单号', width: 150 },
      { field: 'customer_id', label: '客户', width: 180 },
      { field: 'contact_id', label: '联系人', width: 130 },
      { field: 'total_amount', label: '结算金额', width: 130, align: 'right' },
      { field: 'status', label: '状态', width: 115 },
      { field: 'receivable_code', label: '财务应收', width: 160 },
      { field: 'responsible_id', label: '负责人', width: 140 },
    ],
    searchableFields: ['code', 'name', 'order_code', 'receivable_code'],
    sort: newestFirst, pagination: { pageSize: 20 }, selection: { type: 'none' },
    userFilters: { element: 'dropdown', fields: [{ field: 'status', type: 'select' }, { field: 'customer_id' }, { field: 'responsible_id' }] },
    userActions: objectListActions,
  },
  form: {
    type: 'simple', data: objectData('forge_service_settlement'), columns: 2,
    sections: [
      { name: 'source', label: '来源单据', columns: 2, fields: ['service_order_id', 'quotation_id', 'order_code', 'customer_id', 'contact_id'] },
      { name: 'settlement', label: '结算信息', columns: 2, fields: ['name', 'code', 'total_amount', 'status', 'receivable_code', 'responsible_id', 'remarks'] },
    ],
  },
});

export const WarrantyCardViews = defineView({
  object: 'forge_warranty_card',
  list: {
    label: '质保卡', type: 'grid', data: objectData('forge_warranty_card'),
    columns: [
      { field: 'code', label: '质保卡号', width: 160 },
      { field: 'customer_id', label: '客户', width: 180 },
      { field: 'product_sn', label: '产品 / SN', width: 175 },
      { field: 'scope', label: '判定粒度', width: 130 },
      { field: 'starts_on', label: '开始日期', width: 120 },
      { field: 'ends_on', label: '到期日期', width: 120 },
      { field: 'status', label: '状态', width: 110 },
      { field: 'responsible_party', label: '责任方', width: 120 },
    ],
    searchableFields: ['code', 'name', 'product_sn', 'scope', 'responsible_party'],
    sort: [{ field: 'ends_on', order: 'asc' }, { field: 'code', order: 'asc' }], pagination: { pageSize: 20 }, selection: { type: 'none' },
    userFilters: { element: 'dropdown', fields: [{ field: 'status', type: 'select' }, { field: 'ends_on', type: 'date-range' }, { field: 'customer_id' }] },
    userActions: objectListActions,
  },
  form: {
    type: 'simple', data: objectData('forge_warranty_card'), columns: 2,
    sections: [
      { name: 'source', label: '来源单据', columns: 2, fields: ['service_order_id', 'sales_order_id', 'customer_id'] },
      { name: 'warranty', label: '质保信息', columns: 2, fields: ['name', 'code', 'product_sn', 'scope', 'starts_on', 'ends_on', 'status', 'activated_at', 'activated_by', 'responsible_party', 'remarks'] },
    ],
  },
});

export const ServiceConfigViews = defineView({
  object: 'forge_service_config_item',
  list: {
    label: '服务配置项', type: 'grid', data: objectData('forge_service_config_item'),
    columns: [
      { field: 'name', label: '配置项', width: 240 },
      { field: 'code', label: '编码', width: 170 },
      { field: 'category', label: '分类', width: 160 },
      { field: 'status', label: '状态', width: 105 },
      { field: 'description', label: '说明', width: 360 },
    ],
    searchableFields: ['name', 'code', 'description'],
    sort: [{ field: 'category', order: 'asc' }, { field: 'name', order: 'asc' }, { field: 'code', order: 'asc' }],
    pagination: { pageSize: 20 }, selection: { type: 'none' },
    userFilters: { element: 'dropdown', fields: [{ field: 'category', type: 'select' }, { field: 'status', type: 'select' }] },
    userActions: objectListActions,
  },
  form: {
    type: 'simple', data: objectData('forge_service_config_item'), columns: 2,
    sections: [{ name: 'configuration', label: '配置项信息', columns: 2, fields: ['name', 'code', 'category', 'status', 'description', 'remarks'] }],
  },
});

export const WarrantyCardEventViews = defineView({
  object: 'forge_warranty_card_event',
  list: {
    label: '质保变更记录', type: 'grid', data: objectData('forge_warranty_card_event'),
    columns: [
      { field: 'event_type', label: '变更类型', width: 120 },
      { field: 'previous_ends_on', label: '原到期日', width: 120 },
      { field: 'ends_on', label: '新到期日', width: 120 },
      { field: 'note', label: '变更说明', width: 260 },
      { field: 'occurred_at', label: '操作时间', width: 170 },
      { field: 'operator_id', label: '操作员工', width: 150 },
    ],
    searchableFields: [], sort: [{ field: 'occurred_at', order: 'desc' }], pagination: { pageSize: 10 }, selection: { type: 'none' },
    userActions: objectListActions,
  },
  form: { type: 'simple', data: objectData('forge_warranty_card_event'), columns: 2, sections: [{ name: 'event', label: '质保变更', columns: 2, fields: ['event_type', 'previous_starts_on', 'starts_on', 'previous_ends_on', 'ends_on', 'note', 'occurred_at', 'operator_id'] }] },
});

export const RepairRequestViews = defineView({
  object: 'forge_repair_request',
  list: {
    label: '报修池', type: 'grid', data: objectData('forge_repair_request'),
    columns: [
      { field: 'code', label: '报修单号', width: 160 },
      { field: 'source', label: '来源', width: 140 },
      { field: 'site', label: '现场', width: 170 },
      { field: 'product_name', label: '产品', width: 170 },
      { field: 'problem', label: '问题', width: 260 },
      { field: 'contact_phone', label: '联系方式', width: 150 },
      { field: 'reported_at', label: '提交时间', width: 170 },
      { field: 'status', label: '状态', width: 120 },
    ],
    searchableFields: ['code', 'source', 'site', 'product_name', 'product_sn', 'problem', 'contact_name', 'contact_phone'],
    sort: [{ field: 'reported_at', order: 'desc' }, { field: 'code', order: 'desc' }],
    pagination: { pageSize: 20 }, selection: { type: 'none' },
    userFilters: { element: 'dropdown', fields: [{ field: 'status', type: 'select' }, { field: 'source', type: 'text' }, { field: 'impact', type: 'text' }] },
    userActions: objectListActions,
  },
  form: {
    type: 'simple', data: objectData('forge_repair_request'), columns: 2,
    sections: [
      { name: 'report', label: '报修信息', columns: 2, fields: ['name', 'code', 'source', 'impact', 'reported_at'] },
      { name: 'site', label: '现场与产品', columns: 2, fields: ['site', 'product_name', 'product_sn', 'customer_id'] },
      { name: 'contact', label: '问题与联系方式', columns: 2, fields: ['problem', 'contact_name', 'contact_phone', 'report_attachments'] },
      { name: 'handling', label: '处理状态', columns: 2, fields: ['status', 'service_order_id', 'responsible_id', 'remarks'] },
    ],
  },
});

export const ServicePartRequestViews = defineView({
  object: 'forge_service_part_request',
  list: {
    label: '备件工单', type: 'grid', data: objectData('forge_service_part_request'),
    columns: [
      { field: 'code', label: '工单号', width: 160 },
      { field: 'service_order_id', label: '服务工单', width: 180 },
      { field: 'sku_id', label: '备件规格', width: 190 },
      { field: 'warehouse_id', label: '出库仓库', width: 160 },
      { field: 'requested_quantity', label: '申请数量', width: 110, align: 'right' },
      { field: 'status', label: '状态', width: 110 },
      { field: 'execution_status', label: '执行状态', width: 120 },
      { field: 'request_on', label: '申请日期', width: 130 },
    ],
    searchableFields: ['code', 'name'],
    sort: [{ field: 'request_on', order: 'desc' }, { field: 'code', order: 'desc' }],
    pagination: { pageSize: 20 }, selection: { type: 'none' },
    userFilters: { element: 'dropdown', fields: [{ field: 'code', type: 'text' }, { field: 'status', type: 'select' }, { field: 'execution_status', type: 'select' }] },
    userActions: objectListActions,
  },
  form: {
    type: 'simple', data: objectData('forge_service_part_request'), columns: 2,
    sections: [
      { name: 'request', label: '备件申请', columns: 2, fields: ['name', 'code', 'service_order_id', 'sku_id', 'warehouse_id', 'requested_quantity', 'request_on', 'engineer_id', 'remarks'] },
      { name: 'execution', label: '执行结果', columns: 2, fields: ['status', 'execution_status', 'issued_quantity', 'received_quantity', 'used_quantity', 'returned_quantity', 'exception_reason'] },
    ],
  },
});

export const ServicePartRequestEventViews = defineView({
  object: 'forge_service_part_request_event',
  list: {
    label: '备件执行记录', type: 'grid', data: objectData('forge_service_part_request_event'),
    columns: [
      { field: 'event_type', label: '执行类型', width: 110 },
      { field: 'inventory_ledger_code', label: '库存流水号', width: 180 },
      { field: 'from_status', label: '原执行状态', width: 120 },
      { field: 'to_status', label: '新执行状态', width: 120 },
      { field: 'quantity', label: '数量', width: 100, align: 'right' },
      { field: 'comment', label: '说明', width: 260 },
      { field: 'occurred_at', label: '发生时间', width: 170 },
      { field: 'operator_id', label: '操作员工', width: 150 },
    ],
    searchableFields: [], sort: [{ field: 'occurred_at', order: 'desc' }], pagination: { pageSize: 10 }, selection: { type: 'none' },
    userActions: objectListActions,
  },
  form: { type: 'simple', data: objectData('forge_service_part_request_event'), columns: 2, sections: [{ name: 'event', label: '备件执行记录', columns: 2, fields: ['event_type', 'from_status', 'to_status', 'quantity', 'inventory_ledger_code', 'comment', 'occurred_at', 'operator_id'] }] },
});
