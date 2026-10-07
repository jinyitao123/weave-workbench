import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'forge_project' };

export const projectGridColumns = [
  { field: 'name', label: '项目名称', link: true, width: 260, pinned: 'left' as const },
  { field: 'customer_id', label: '客户名称', width: 200 },
  { field: 'manager_id', label: '项目经理', width: 150 },
  { field: 'planned_start_on', label: '开始日期', width: 120 },
  { field: 'planned_end_on', label: '结束日期', width: 120 },
  { field: 'progress', label: '项目进度', width: 120, type: 'percent' },
  { field: 'expected_revenue', label: '预计营收', width: 140 },
  { field: 'budget_amount', label: '预算金额', width: 140 },
  { field: 'status', label: '状态', width: 110 },
];
export const projectGanttColumns = ['name', 'manager_id', 'status'];
export const projectGanttConfig = {
  startDateField: 'planned_start_on',
  endDateField: 'planned_end_on',
  titleField: 'name',
  progressField: 'progress',
  viewMode: 'week' as const,
  tooltipFields: [
    { field: 'manager_id', label: '项目经理' },
    { field: 'status', label: '状态' },
  ],
};

/**
 * The project list and timeline share the same governed object. The view only
 * describes presentation; project lifecycle and permissions stay on the object
 * and its business actions.
 */
export const ProjectViews = defineView({
  object: 'forge_project',
  list: {
    label: '项目列表',
    type: 'grid',
    data,
    columns: projectGridColumns,
    searchableFields: ['name', 'code'],
    sort: [{ field: 'created_at', order: 'desc' }],
    pagination: { pageSize: 20 },
    selection: { type: 'multiple' },
    rowHeight: 'compact',
  },
  listViews: {
    timeline: {
      label: '甘特图',
      type: 'gantt',
      data,
      columns: projectGanttColumns,
      gantt: projectGanttConfig,
      searchableFields: ['name', 'code'],
      pagination: { pageSize: 20 },
    },
  },
});

const projectWorkItemData = { provider: 'object' as const, object: 'forge_project_work_item' };
const projectWorkItemStatusFilter = [{ field: 'status', type: 'select' as const }];

export const ProjectWorkItemViews = defineView({
  object: 'forge_project_work_item',
  list: {
    label: '项目任务', type: 'grid', data: projectWorkItemData,
    columns: [
      { field: 'name', label: '任务标题', width: 260, link: true, pinned: 'left' },
      { field: 'task_type', label: '任务类别', width: 130 },
      { field: 'priority', label: '优先级', width: 90 },
      { field: 'project_id', label: '项目', width: 190 },
      { field: 'owner_id', label: '负责人', width: 140 },
      { field: 'planned_end_on', label: '截止日期', width: 120 },
      { field: 'estimated_hours', label: '预估工时(小时)', width: 130, align: 'right' },
      { field: 'progress', label: '完成进度', width: 100 },
      { field: 'status', label: '状态', width: 100 },
    ],
    searchableFields: ['name', 'item_key', 'description'],
    sort: [{ field: 'planned_end_on', order: 'asc' }],
    pagination: { pageSize: 20 },
    selection: { type: 'none' },
    userFilters: { element: 'dropdown', fields: projectWorkItemStatusFilter },
    userActions: { editInline: false, group: false, hideFields: true },
  },
  form: {
    type: 'simple', data: projectWorkItemData, columns: 2,
    sections: [
      { name: 'task_details', label: '任务资料', columns: 2,
        fields: ['name', 'task_type', 'description', 'owner_id', 'priority', 'planned_end_on', 'estimated_hours'] },
      { name: 'task_execution', label: '计划执行', columns: 2,
        fields: ['project_id', 'plan_id', 'parent_id', 'planned_start_on', 'progress', 'status'] },
    ],
  },
});
