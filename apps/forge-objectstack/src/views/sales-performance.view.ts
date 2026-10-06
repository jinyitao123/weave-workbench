import { defineView } from '@objectstack/spec';

export const SalesPerformanceEntryViews = defineView({
  object: 'forge_sales_performance_entry',
  list: {
    label: '销售业绩流水', type: 'grid', data: { provider: 'object', object: 'forge_sales_performance_entry' },
    columns: [
      { field: 'confirmed_at', label: '确认时间', width: 170 },
      { field: 'order_code_snapshot', label: '销售订单号', width: 170, pinned: 'left' },
      { field: 'customer_name_snapshot', label: '客户', width: 190 },
      { field: 'sales_person_name_snapshot', label: '业绩人', width: 140 },
      { field: 'entry_type', label: '流水类型', width: 120 },
      { field: 'performance_amount', label: '业绩金额', width: 135, align: 'right' },
      { field: 'status', label: '状态', width: 110 },
    ],
    searchableFields: ['order_code_snapshot', 'customer_name_snapshot', 'sales_person_name_snapshot'],
    sort: [{ field: 'confirmed_at', order: 'desc' }], pagination: { pageSize: 10 }, selection: { type: 'none' },
    userActions: { editInline: false, group: false, hideFields: true },
  },
  form: { type: 'tabbed', data: { provider: 'object', object: 'forge_sales_performance_entry' }, columns: 2, sections: [
    { name: 'entry_source', label: '业绩来源', columns: 2, fields: ['entry_type', 'order_id', 'order_code_snapshot', 'customer_id', 'customer_name_snapshot', 'recognition_on', 'source_recognition_amount', 'tax_basis'] },
    { name: 'entry_amount', label: '业绩与毛利', columns: 2, fields: ['sales_person_id', 'sales_person_name_snapshot', 'business_unit_id', 'team_name_snapshot', 'order_amount', 'performance_amount', 'performance_ratio', 'gross_profit', 'gross_profit_rate', 'cost_complete'] },
    { name: 'entry_audit', label: '审核记录', columns: 2, fields: ['status', 'approval_status', 'confirmed_by', 'confirmed_at', 'submitted_by', 'submitted_at', 'reviewed_by', 'reviewed_at', 'review_comment'] },
  ] },
});

export const SalesPerformanceConfirmationViews = defineView({
  object: 'forge_sales_performance_confirmation',
  list: {
    label: '销售业绩确认', type: 'grid', data: { provider: 'object', object: 'forge_sales_performance_confirmation' },
    columns: [
      { field: 'order_code_snapshot', label: '销售订单号', width: 170, pinned: 'left' },
      { field: 'sales_person_id', label: '业绩人', width: 145 },
      { field: 'order_amount', label: '销售订单额', width: 135, align: 'right' },
      { field: 'performance_amount', label: '不含税业绩金额', width: 155, align: 'right' },
      { field: 'gross_profit', label: '已核对毛利', width: 135, align: 'right' },
      { field: 'status', label: '确认状态', width: 115 },
      { field: 'submitted_at', label: '提交时间', width: 170 },
    ],
    searchableFields: ['order_code_snapshot'], sort: [{ field: 'submitted_at', order: 'desc' }],
    pagination: { pageSize: 10 }, selection: { type: 'none' }, userActions: { editInline: false, group: false, hideFields: true },
  },
  form: { type: 'tabbed', data: { provider: 'object', object: 'forge_sales_performance_confirmation' }, columns: 2, sections: [
    { name: 'confirmation_source', label: '订单与收入来源', columns: 2, fields: ['order_id', 'order_code_snapshot', 'sales_person_id', 'business_unit_id', 'recognition_on', 'source_recognized_amount', 'order_amount'] },
    { name: 'confirmation_calculation', label: '业绩与成本', columns: 2, fields: ['performance_ratio', 'performance_amount', 'tax_basis', 'cost_amount', 'cost_complete', 'gross_profit', 'gross_profit_rate'] },
    { name: 'confirmation_approval', label: '原生审批', columns: 2, fields: ['status', 'approval_status', 'submitted_by', 'submitted_at', 'reviewed_by', 'reviewed_at', 'review_comment'] },
  ] },
});

export const SalesPerformanceRebookViews = defineView({
  object: 'forge_sales_performance_rebook',
  list: {
    label: 'Rebook记录', type: 'grid', data: { provider: 'object', object: 'forge_sales_performance_rebook' },
    columns: [
      { field: 'source_order_code', label: '来源业绩', width: 170, pinned: 'left' },
      { field: 'source_person_id', label: '转出人', width: 140 },
      { field: 'target_person_id', label: '转入人', width: 140 },
      { field: 'ratio', label: '比例 (%)', width: 105, align: 'right' },
      { field: 'amount', label: '转记金额', width: 135, align: 'right' },
      { field: 'reason_name_snapshot', label: '原因', width: 180 },
      { field: 'submitted_at', label: '提交时间', width: 170 },
      { field: 'status', label: '状态', width: 120 },
    ],
    searchableFields: ['source_order_code', 'reason_name_snapshot'], sort: [{ field: 'submitted_at', order: 'desc' }],
    pagination: { pageSize: 20 }, selection: { type: 'none' }, userActions: { editInline: false, group: false, hideFields: true },
  },
  form: { type: 'tabbed', data: { provider: 'object', object: 'forge_sales_performance_rebook' }, columns: 2, sections: [
    { name: 'rebook_source', label: '来源与人员', columns: 2, fields: ['source_order_id', 'source_order_code', 'customer_id', 'source_person_id', 'target_person_id', 'business_unit_id'] },
    { name: 'rebook_amount', label: '分配金额', columns: 2, fields: ['source_performance_amount', 'source_rebooked_amount', 'source_reserved_amount', 'ratio', 'amount', 'reason_id', 'reason_name_snapshot'] },
    { name: 'rebook_approval', label: '原生审批与转记', columns: 2, fields: ['status', 'approval_status', 'submitted_by', 'submitted_at', 'reviewed_by', 'reviewed_at', 'review_comment', 'posted_at'] },
  ] },
});

export const SalesPerformanceExportJobViews = defineView({
  object: 'forge_sales_performance_export_job',
  list: {
    label: '销售业绩导出任务', type: 'grid', data: { provider: 'object', object: 'forge_sales_performance_export_job' },
    columns: [
      { field: 'code', label: '任务编号', width: 165 },
      { field: 'name', label: '任务', width: 240 },
      { field: 'status', label: '状态', width: 100 },
      { field: 'progress', label: '进度 (%)', width: 90, align: 'right' },
      { field: 'row_count', label: '导出行数', width: 95, align: 'right' },
      { field: 'result_name', label: '结果文件', width: 245 },
      { field: 'submitted_at', label: '提交时间', width: 165 },
      { field: 'completed_at', label: '完成时间', width: 165 },
    ],
    searchableFields: ['code', 'name', 'result_name'], sort: [{ field: 'submitted_at', order: 'desc' }],
    pagination: { pageSize: 20 }, selection: { type: 'none' }, userActions: { editInline: false, group: false, hideFields: true },
  },
  form: { type: 'simple', data: { provider: 'object', object: 'forge_sales_performance_export_job' }, columns: 2, sections: [
    { name: 'export_job', label: '导出结果', columns: 2, fields: ['code', 'name', 'source_view', 'status', 'progress', 'row_count', 'result_name', 'submitted_by', 'submitted_at', 'completed_at', 'failure_reason'] },
  ] },
});
