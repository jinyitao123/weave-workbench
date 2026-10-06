import { Field, ObjectSchema } from '@objectstack/spec/data';
import { P } from '@objectstack/spec';
import { master, text, code, reference, owner, remarks, required, choice } from '../model.js';

const select = (label: string, options: Array<[string, string]>, defaultValue?: string) => Field.select(
  options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
  { label, ...(defaultValue ? { defaultValue } : {}) },
);
const amount = (label: string, readonly = false) => Field.currency({ label, precision: 18, min: 0, defaultValue: 0, ...(readonly ? { readonly: true } : {}) });

// Live RISEMAP 2026-09-09: the account had no project type, so CABINET_OTC was created before the first project.
export const ProjectType = master('forge_project_type', '项目类型', 'tags', {
  name: text('类型名称', true), code: code('类型编码'), color: text('标识颜色'), active: Field.boolean({ label: '启用', defaultValue: true }), sort_order: Field.number({ label: '排序', min: 0, scale: 0, defaultValue: 100 }), remarks: remarks(),
}, ['code', 'name', 'color', 'active', 'sort_order']);

export const Project = ObjectSchema.create({
  name: 'forge_project', label: '项目中心', pluralLabel: '项目中心', icon: 'briefcase-business', sharingModel: 'private',
  fields: {
    name: text('项目名称', true),
    code: Field.autonumber({ label: '项目编号', autonumberFormat: 'PRJ-{YYYY}-{000}' }),
    type_id: reference('forge_project_type', '项目类型', true),
    customer_id: { ...reference('forge_customer', '客户', true), relatedList: true, relatedListTitle: '项目', relatedListColumns: ["code", "name", "planned_start_on", "planned_end_on", "progress", "status"] },
    customer_name_snapshot: { ...text('客户名称快照'), readonly: true }, manager_id: { ...owner(true), readonlyWhen: P`true` },
    manager_transfer_target_id: { ...owner(), label: '负责人交接目标', hidden: true }, manager_name_snapshot: { ...text('项目负责人快照'), readonly: true },
    priority: select('优先级', [['high', '高'], ['medium', '中'], ['low', '低']], 'medium'),
    planned_start_on: Field.date({ label: '计划开始日期', ...required }),
    planned_end_on: Field.date({ label: '计划结束日期', ...required }),
    actual_start_on: Field.date({ label: '实际开始日期', readonly: true }), actual_end_on: Field.date({ label: '实际结束日期', readonly: true }),
    expected_revenue: amount('预计营收'), budget_amount: amount('预算金额'),
    contract_amount: amount('合同金额', true), invoice_amount: amount('已开票', true),
    collected_amount: amount('已回款', true), total_cost: amount('总成本', true),
    progress: Field.number({ label: '项目进度', min: 0, max: 100, scale: 2, defaultValue: 0, readonly: true }),
    status: { ...select('项目状态', [
      ['pending', '待执行'], ['in_progress', '进行中'], ['paused', '已暂停'], ['completed', '已完工'],
      ['settled', '已结算'], ['terminated', '已终止'], ['archived', '已归档'],
    ], 'pending'), readonly: true },
    pause_reason: Field.textarea({ label: '暂停原因', readonly: true }),
    termination_reason: Field.textarea({ label: '终止原因', readonly: true }),
    description: Field.textarea({ label: '项目描述' }), remarks: remarks(),
  },
  nameField: 'name',
  validations: [
    { type: 'script', name: 'project_date_order', condition: 'record.planned_end_on < record.planned_start_on', message: '计划结束日期不得早于计划开始日期' },
    { type: 'state_machine', name: 'project_lifecycle', field: 'status', initialStates: ['pending'], transitions: {
      pending: ['in_progress', 'terminated'], in_progress: ['paused', 'completed', 'terminated'], paused: ['in_progress', 'terminated'],
      completed: ['settled'], settled: ['archived'], terminated: ['archived'], archived: [],
    }, message: '项目状态流转不合法，请使用对应业务动作' },
  ],
  enable: { apiEnabled: true, searchable: true, trackHistory: true },
});

export const ProjectMember = master('forge_project_member', '项目团队', 'users', {
  name: text('成员名称', true), membership_key: { ...code('成员关系编号'), hidden: true, readonly: true }, project_id: Field.masterDetail('forge_project', { label: '所属项目', deleteBehavior: 'cascade', ...required }),
  user_id: owner(true), member_duty: select('项目角色', [['manager', '项目经理'], ['member', '项目成员']], 'member'),
  joined_on: Field.date({ label: '加入日期', ...required }), active: Field.boolean({ label: '在项目中', defaultValue: true }),
  position_assignment_revision: { ...Field.number({ label: '项目岗位分配修订', min: 0, scale: 0, readonly: true, hidden: true }) }, remarks: remarks(),
}, ['project_id', 'user_id', 'member_duty', 'joined_on', 'active'], 'controlled_by_parent');

export const ProjectAttachment = master('forge_project_attachment', '项目附件', 'paperclip', {
  name: text('文件名称', true), attachment_key: Field.autonumber({ label: '附件编号', autonumberFormat: 'PFA-{YYYYMMDD}-{0000}', unique: 'global' }), project_id: reference('forge_project', '项目', true),
  attachment: Field.file({ label: '文件', ...required }), category: select('资料分类', [['contract', '合同资料'], ['technical', '技术资料'], ['delivery', '交付资料'], ['other', '其他']], 'other'),
  uploaded_by: Field.user({ label: '上传人', readonly: true, ...required }), uploaded_at: Field.datetime({ label: '上传时间', readonly: true, ...required }), remarks: remarks(),
}, ['project_id', 'name', 'category', 'attachment', 'uploaded_by', 'uploaded_at']);

export const ProjectLog = master('forge_project_log', '项目日志', 'notebook-pen', {
  name: text('日志标题', true), log_key: code('日志编号'), project_id: reference('forge_project', '项目', true),
  category: select('日志分类', [['change', '变更记录'], ['issue', '问题反馈'], ['progress', '日常进展'], ['decision', '决策记录'], ['stage', '阶段总结'], ['risk', '风险预警'], ['milestone', '里程碑达成'], ['internal', '内部讨论'], ['external', '外部协调'], ['customer', '客户沟通']], 'progress'),
  content: Field.textarea({ label: '日志内容', ...required }), author_id: Field.user({ label: '记录人', ...required }), logged_at: Field.datetime({ label: '记录时间', ...required }),
  reply_count: Field.number({ label: '回复数', min: 0, scale: 0, defaultValue: 0, readonly: true }), risk_resolved: Field.boolean({ label: '风险已解除', defaultValue: false }), remarks: remarks(),
}, ['project_id', 'category', 'name', 'author_id', 'logged_at', 'reply_count', 'risk_resolved']);

export const ProjectModulePreference = master('forge_project_module_preference', '项目功能模块偏好', 'sliders-horizontal', {
  name: text('偏好名称', true), preference_key: code('偏好编号'), project_id: reference('forge_project', '项目', true), user_id: Field.user({ label: '用户', ...required }),
  plan_enabled: Field.boolean({ label: '项目计划', defaultValue: true }), sales_enabled: Field.boolean({ label: '关联订单与合同', defaultValue: true }),
  cost_enabled: Field.boolean({ label: '项目成本', defaultValue: true }), bom_enabled: Field.boolean({ label: '项目BOM', defaultValue: true }), purchase_enabled: Field.boolean({ label: '支出合同', defaultValue: true }),
  task_enabled: Field.boolean({ label: '任务管理', defaultValue: true }), team_enabled: Field.boolean({ label: '团队管理', defaultValue: true }), delivery_enabled: Field.boolean({ label: '交付包', defaultValue: true }),
  goodwill_enabled: Field.boolean({ label: 'Goodwill', defaultValue: true }), attachment_enabled: Field.boolean({ label: '附件', defaultValue: true }), log_enabled: Field.boolean({ label: '项目日志', defaultValue: true }),
}, ['project_id', 'user_id', 'plan_enabled', 'sales_enabled', 'cost_enabled', 'bom_enabled', 'purchase_enabled', 'task_enabled', 'team_enabled', 'delivery_enabled', 'goodwill_enabled', 'attachment_enabled', 'log_enabled']);

// RISEMAP links a contract and automatically brings in all non-draft orders under it.
export const ProjectSalesLink = master('forge_project_sales_link', '项目订单合同关联', 'link', {
  name: text('关联名称', true), link_key: code('关联编号'), project_id: Field.masterDetail('forge_project', { label: '所属项目', deleteBehavior: 'cascade', ...required }),
  contract_id: reference('forge_sales_contract', '销售合同', true), order_id: reference('forge_sales_order', '销售订单', true),
  contract_code_snapshot: text('合同编号快照'), contract_type_snapshot: text('合同类型快照'), signed_on_snapshot: Field.date({ label: '合同签订日期快照' }),
  order_code_snapshot: text('订单编号快照'), order_status_snapshot: choice('订单状态快照', ['草稿', '待审批', '已审批', '执行中', '部分发货', '已发货', '已完成', '已取消']),
  order_amount: amount('订单金额', true), invoice_amount: amount('已开票', true), collected_amount: amount('已回款', true), remarks: remarks(),
}, ['project_id', 'contract_code_snapshot', 'order_code_snapshot', 'order_amount', 'invoice_amount', 'collected_amount'], 'controlled_by_parent');

// Live RISEMAP 2026-09-09: a project without a plan offers system/custom/copy/manual starts.
// The observed tenant had zero system and custom templates, so only the manual structure is implemented here.
export const ProjectPlan = master('forge_project_plan', '项目计划', 'calendar-range', {
  name: text('计划名称', true), plan_key: code('计划编号'), project_id: reference('forge_project', '项目', true),
  source: select('创建方式', [['manual', '手工创建'], ['system_template', '系统模板'], ['custom_template', '我的模板'], ['copied_project', '从项目复制']], 'manual'),
  revision: Field.number({ label: '修订号', min: 1, scale: 0, defaultValue: 1, readonly: true }),
  planned_start_on: Field.date({ label: '计划开始', ...required }), planned_end_on: Field.date({ label: '计划结束', ...required }),
  status: { ...select('计划状态', [['active', '执行中'], ['superseded', '已替代'], ['archived', '已归档']], 'active'), readonly: true },
  item_count: Field.number({ label: '工作项数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  progress: Field.number({ label: '计划进度', min: 0, max: 100, scale: 2, defaultValue: 0, readonly: true }), remarks: remarks(),
}, ['project_id', 'name', 'source', 'revision', 'planned_start_on', 'planned_end_on', 'item_count', 'progress', 'status']);

// RISEMAP 的项目配置中心以计划模板作为可复用的计划来源。模板结构保存为可审计快照，套用时再生成当前项目的工作项。
export const ProjectPlanTemplate = master('forge_project_plan_template', '项目计划模板', 'copy-check', {
  name: text('模板名称', true), template_key: code('模板编号'), category: select('模板分类', [['system', '系统模板'], ['custom', '自定义模板'], ['project_copy', '项目复制']], 'custom'),
  source_plan_id: reference('forge_project_plan', '来源计划'), source_project_id: reference('forge_project', '来源项目'),
  structure_json: Field.textarea({ label: '计划结构快照', ...required }), item_count: Field.number({ label: '工作项数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  status: select('模板状态', [['active', '可用'], ['archived', '已归档']], 'active'), remarks: remarks(),
}, ['name', 'category', 'source_plan_id', 'source_project_id', 'structure_json', 'item_count', 'status']);

// External observations are evidence records, not writable Forge plan state.
export const ProjectPlanEvidence = master('forge_project_plan_evidence', '项目计划外部观察证据', 'file-check-2', {
  name: text('证据名称', true), evidence_key: code('证据编号'), project_id: reference('forge_project', '项目', true),
  source_system: select('来源系统', [['risemap', 'RISEMAP']]), source_record_ref: text('来源记录标识', true),
  observed_on: Field.date({ label: '观察日期', ...required }), phase_name: text('阶段名称', true),
  owner_display_name: text('来源负责人名称', true), planned_start_on: Field.date({ label: '计划开始', ...required }),
  planned_end_on: Field.date({ label: '计划结束', ...required }), duration_days: Field.number({ label: '工期(天)', min: 0, scale: 0 }),
  weight: Field.number({ label: '权重', min: 0, max: 100, scale: 2 }), progress: Field.number({ label: '完成进度', min: 0, max: 100, scale: 2 }),
  status: select('来源状态', [['pending', '未开始'], ['in_progress', '进行中'], ['completed', '已完成']]),
  planned_deliverable: Field.textarea({ label: '计划产出物' }), task_count: Field.number({ label: '任务总数', min: 0, scale: 0 }),
  observed_items: Field.textarea({ label: '观察到的工作项(JSON)' }),
  evidence_note: Field.textarea({ label: '证据说明', ...required }), verification_status: select('核验状态', [['observed', '已观察'], ['pending_review', '待确认']], 'observed'),
}, ['project_id', 'source_system', 'source_record_ref', 'observed_on', 'phase_name', 'owner_display_name', 'planned_start_on', 'planned_end_on', 'progress', 'status', 'task_count', 'verification_status']);

// Identity mappings keep external names auditable without rewriting local users.
export const ProjectIdentityMapping = master('forge_project_identity_mapping', '项目外部身份映射', 'user-round-check', {
  name: text('映射名称', true), mapping_key: code('映射编号'), project_id: reference('forge_project', '项目', true),
  source_system: select('来源系统', [['risemap', 'RISEMAP']]), source_display_name: text('来源姓名', true),
  local_user_id: Field.user({ label: 'Forge 本地账户' }), status: select('映射状态', [['pending_review', '待确认'], ['confirmed', '已确认'], ['rejected', '已驳回']], 'pending_review'),
  evidence_ref: text('证据引用', true), reviewed_on: Field.date({ label: '复核日期' }), review_note: Field.textarea({ label: '复核说明' }),
}, ['project_id', 'source_system', 'source_display_name', 'local_user_id', 'status', 'evidence_ref', 'reviewed_on']);

export const ProjectWorkItem = master('forge_project_work_item', '项目计划工作项', 'list-checks', {
  name: text('名称', true), item_key: code('工作项编号'), project_id: reference('forge_project', '项目', true),
  plan_id: reference('forge_project_plan', '项目计划', true),
  item_type: select('类型', [['phase', '阶段'], ['milestone', '里程碑'], ['task', '任务']], 'task'),
  description: Field.textarea({ label: '详细描述' }),
  task_type: Field.lookup('forge_business_setting_option', {
    label: '任务类别', relatedList: false,
    lookupFilters: [
      { field: 'scope', operator: 'eq', value: 'project' },
      { field: 'setting_type', operator: 'eq', value: 'task_type' },
      { field: 'enabled', operator: 'eq', value: true },
    ],
  }),
  priority: select('任务优先级', [['urgent', '紧急'], ['high', '高'], ['medium', '中'], ['low', '低']]),
  estimated_hours: Field.number({ label: '预估工时(小时)', min: 0, scale: 2 }),
  parent_id: reference('forge_project_work_item', '所属阶段'), owner_id: Field.user({ label: '负责人' }),
  owner_position_assignment_id: reference('forge_project_member_position_assignment', '负责人项目岗位'),
  planned_start_on: Field.date({ label: '计划开始', ...required }), planned_end_on: Field.date({ label: '计划结束', ...required }),
  duration_days: Field.number({ label: '工期(天)', min: 0, scale: 0, readonly: true }),
  predecessor_ids: Field.lookup('forge_project_work_item', { label: '前置任务', multiple: true, relatedList: false }), weight: Field.number({ label: '权重', min: 0, max: 100, scale: 2, defaultValue: 20 }),
  critical_path: Field.boolean({ label: '关键路径', defaultValue: false }), planned_deliverable: Field.textarea({ label: '计划产出物' }),
  status: { ...select('工作项状态', [['pending', '未开始'], ['in_progress', '进行中'], ['completed', '已完成'], ['delayed', '已延期'], ['cancelled', '已取消']], 'pending'), readonly: true },
  progress: Field.number({ label: '完成度', min: 0, max: 100, scale: 2, defaultValue: 0, readonly: true }),
  actual_start_on: Field.date({ label: '实际开始', readonly: true }), actual_end_on: Field.date({ label: '实际完成', readonly: true }),
  sort_order: Field.number({ label: '排序', min: 0, scale: 0, defaultValue: 0 }), remarks: remarks(),
}, ['plan_id', 'item_type', 'task_type', 'priority', 'parent_id', 'name', 'owner_id', 'owner_position_assignment_id', 'planned_start_on', 'planned_end_on', 'duration_days', 'estimated_hours', 'predecessor_ids', 'weight', 'critical_path', 'progress', 'status', 'actual_start_on', 'actual_end_on']);

// Live RISEMAP 2026-09-09: the progress view provides one daily-report form beside the task table.
export const ProjectDailyReport = master('forge_project_daily_report', '项目日报', 'notebook-pen', {
  name: text('日报名称', true), report_key: code('日报编号'), project_id: reference('forge_project', '项目', true),
  plan_id: reference('forge_project_plan', '项目计划', true), work_item_id: reference('forge_project_work_item', '工作项', true),
  reporter_id: Field.user({ label: '填报人', ...required }), report_on: Field.date({ label: '日报日期', ...required }),
  completed_today: Field.textarea({ label: '今日完成内容', ...required }),
  completion_percent: Field.number({ label: '完成度', min: 0, max: 100, scale: 2, ...required }),
  blockage: Field.textarea({ label: '阻塞问题' }), assistance_needed: Field.textarea({ label: '需要协助' }),
  expected_finish_changed: Field.boolean({ label: '预计完成日期是否变化', defaultValue: false }),
  expected_finish_on: Field.date({ label: '调整后的预计完成日期' }),
  attachment: Field.file({ label: '附件', description: 'RISEMAP 页面提示单个附件不超过 20MB。' }), remarks: remarks(),
}, ['report_on', 'project_id', 'plan_id', 'work_item_id', 'reporter_id', 'completion_percent', 'expected_finish_changed', 'expected_finish_on']);

// RISEMAP RM-097: project time records carry worker, project, content, time type, hours, rate, cost and review status.
export const ProjectTimesheet = master('forge_project_timesheet', '项目工时', 'clock-3', {
  name: text('工时记录名称', true), code: code('工时单号'), project_id: reference('forge_project', '关联项目', true),
  work_item_id: reference('forge_project_work_item', '关联任务'), worker_id: Field.user({ label: '人员', ...required }),
  worker_position_assignment_id: { ...reference('forge_project_member_position_assignment', '工时项目岗位'), readonly: true, hidden: true },
  worker_position_name_snapshot: Field.text({ label: '项目岗位', readonly: true }),
  position_id_snapshot: { ...reference('sys_position', '岗位快照'), readonly: true, hidden: true },
  work_on: Field.date({ label: '日期', ...required }), work_content: Field.textarea({ label: '工作内容', ...required }),
  time_type: select('工时类型', [['normal', '正常'], ['overtime', '加班'], ['travel', '出差']], 'normal'),
  hours: Field.number({ label: '工时(h)', min: 0.25, max: 24, scale: 2, ...required }),
  hourly_rate: Field.currency({ label: '费率', precision: 18, min: 0, ...required }),
  fee_source_snapshot: { ...Field.text({ label: '费率来源快照', readonly: true, hidden: true }) },
  fee_member_rule_id_snapshot: { ...Field.text({ label: '员工费率规则快照', readonly: true, hidden: true }) },
  fee_role_rule_id_snapshot: { ...Field.text({ label: '岗位费率规则快照', readonly: true, hidden: true }) },
  fee_role_revision_snapshot: { ...Field.number({ label: '岗位费率修订快照', min: 1, scale: 0, readonly: true, hidden: true }) },
  fee_project_override_id_snapshot: { ...Field.text({ label: '项目费率覆盖快照', readonly: true, hidden: true }) },
  fee_settings_revision_snapshot: { ...Field.number({ label: '工时配置修订快照', min: 1, scale: 0, readonly: true, hidden: true }) },
  approval_manager_snapshot: { ...Field.user({ label: '提交时项目负责人', readonly: true, hidden: true }) },
  auto_approval_eligible_snapshot: { ...Field.boolean({ label: '原生自动审批资格快照', readonly: true, hidden: true }) },
  auto_approval_threshold_snapshot: { ...Field.number({ label: '自动审批时长阈值快照', min: 0, max: 24, scale: 2, readonly: true, hidden: true }) },
  auto_approval_settings_revision_snapshot: { ...Field.number({ label: '自动审批设置修订快照', min: 1, scale: 0, readonly: true, hidden: true }) },
  approval_source_snapshot: { ...Field.text({ label: '审批来源快照', readonly: true, hidden: true }) },
  approval_flow_name_snapshot: { ...Field.text({ label: '审批Flow快照', readonly: true, hidden: true }) },
  approval_flow_run_id_snapshot: { ...Field.text({ label: '审批运行快照', readonly: true, hidden: true }) },
  approval_flow_node_id_snapshot: { ...Field.text({ label: '审批节点快照', readonly: true, hidden: true }) },
  fee_base_rate_snapshot: { ...Field.currency({ label: '费率计算基数快照', precision: 18, min: 0, readonly: true, hidden: true }) },
  fee_multiplier_snapshot: { ...Field.number({ label: '加班系数快照', min: 0, scale: 4, readonly: true, hidden: true }) },
  fee_management_uplift_snapshot: { ...Field.number({ label: '管理加成快照', min: 0, max: 1000, scale: 4, readonly: true, hidden: true }) },
  cost_amount: { ...Field.currency({ label: '工时成本', precision: 18, min: 0, defaultValue: 0 }), readonly: true },
  status: { ...select('审核状态', [['draft', '草稿'], ['pending_review', '待审核'], ['approved', '已通过'], ['rejected', '已驳回']], 'draft'), readonly: true },
  approval_status: { ...Field.text({ label: '原生审批状态', readonly: true }), hidden: true },
  approval_manager_id: { ...Field.user({ label: '提交时项目负责人', readonly: true }), hidden: true },
  submitted_at: Field.datetime({ label: '提交时间', readonly: true }), reviewed_at: Field.datetime({ label: '审核时间', readonly: true }),
  reviewer_id: Field.user({ label: '审核人', readonly: true }), review_comment: Field.textarea({ label: '审核意见', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'work_on', 'worker_id', 'worker_position_name_snapshot', 'position_id_snapshot', 'project_id', 'work_item_id', 'work_content', 'hours', 'time_type', 'hourly_rate', 'fee_source_snapshot', 'fee_member_rule_id_snapshot', 'fee_role_rule_id_snapshot', 'fee_role_revision_snapshot', 'fee_project_override_id_snapshot', 'fee_settings_revision_snapshot', 'fee_base_rate_snapshot', 'fee_multiplier_snapshot', 'fee_management_uplift_snapshot', 'approval_manager_snapshot', 'auto_approval_eligible_snapshot', 'auto_approval_threshold_snapshot', 'auto_approval_settings_revision_snapshot', 'approval_source_snapshot', 'approval_flow_name_snapshot', 'approval_flow_run_id_snapshot', 'approval_flow_node_id_snapshot', 'cost_amount', 'status']);

// RISEMAP RM-140: approved business records feed a traceable cost pool before operating analysis consumes them.
export const ProjectCostEntry = master('forge_project_cost_entry', '项目成本池', 'circle-dollar-sign', {
  name: text('成本名称', true), code: code('成本编号'), project_id: reference('forge_project', '项目', true),
  customer_id: { ...reference('forge_customer', '客户', true), relatedList: false }, source_type: select('来源类型', [
    ['timesheet', '项目工时'], ['production_material', '生产材料'], ['expense', '费用报销'], ['subcontract', '委外'], ['manual', '手工登记'],
  ]),
  cost_type: select('成本类型', [['labor', '人工成本'], ['material', '材料成本'], ['manufacturing', '制造费用'], ['travel', '差旅费用'], ['subcontract', '委外成本'], ['other', '其他成本']]),
  source_id: text('来源记录ID', true), occurred_on: Field.date({ label: '发生日期', ...required }),
  source_hours_snapshot: Field.number({ label: '来源工时快照', min: 0, scale: 2, readonly: true, hidden: true }),
  source_hourly_rate_snapshot: Field.currency({ label: '来源费率快照', precision: 18, min: 0, readonly: true, hidden: true }),
  fee_source_snapshot: Field.text({ label: '费率来源快照', readonly: true, hidden: true }),
  fee_role_revision_snapshot: Field.number({ label: '岗位费率修订快照', min: 1, scale: 0, readonly: true, hidden: true }),
  fee_settings_revision_snapshot: Field.number({ label: '工时配置修订快照', min: 1, scale: 0, readonly: true, hidden: true }),
  approval_source_snapshot: Field.text({ label: '审批来源快照', readonly: true, hidden: true }),
  approval_flow_name_snapshot: Field.text({ label: '审批Flow快照', readonly: true, hidden: true }),
  approval_flow_run_id_snapshot: Field.text({ label: '审批运行快照', readonly: true, hidden: true }),
  approval_flow_node_id_snapshot: Field.text({ label: '审批节点快照', readonly: true, hidden: true }),
  auto_approval_threshold_snapshot: Field.number({ label: '自动审批阈值快照', min: 0, max: 24, scale: 2, readonly: true, hidden: true }),
  total_amount: { ...amount('成本总额'), readonly: true }, allocated_amount: { ...amount('已归集金额'), readonly: true },
  remaining_amount: { ...amount('剩余金额'), readonly: true },
  status: { ...select('归集状态', [['unallocated', '待归集'], ['allocated', '已归集'], ['suspended', '暂挂'], ['reversed', '已冲销']], 'unallocated'), readonly: true },
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'source_type', 'cost_type', 'name', 'customer_id', 'project_id', 'occurred_on', 'source_hours_snapshot', 'source_hourly_rate_snapshot', 'fee_source_snapshot', 'fee_role_revision_snapshot', 'fee_settings_revision_snapshot', 'approval_source_snapshot', 'approval_flow_name_snapshot', 'approval_flow_run_id_snapshot', 'approval_flow_node_id_snapshot', 'auto_approval_threshold_snapshot', 'total_amount', 'allocated_amount', 'remaining_amount', 'status']);

const feeRequired = { required: true, storage: { notNull: true } } as const;
const feeSelect = (label: string, options: Array<[string, string]>) => Field.select(options.map(([value, optionLabel]) => ({ value, label: optionLabel })), { label });
const feeCode = (label: string) => Field.text({ label, maxLength: 100, ...feeRequired });

/** Immutable organization role-rate revisions; the position remains a native ObjectStack position. */
export const ProjectRoleFee = ObjectSchema.create({
  name: 'forge_project_role_fee', label: '项目岗位费率', pluralLabel: '项目岗位费率', icon: 'badge-dollar-sign', sharingModel: 'private', nameField: 'name',
  fields: {
    name: text('费率名称', true),
    rule_key: Field.text({ label: '规则标识', unique: 'organization', readonly: true, hidden: true, ...feeRequired }),
    position_id: Field.lookup('sys_position', { label: '组织岗位', relatedList: false, deleteBehavior: 'restrict', ...feeRequired }),
    position_label_snapshot: Field.text({ label: '岗位名称快照', readonly: true, ...feeRequired }),
    grade_code: feeCode('职级代码'),
    normal_rate: Field.currency({ label: '正常费率(元/h)', precision: 18, min: 0, ...feeRequired }),
    overtime_multiplier: Field.number({ label: '加班倍率', min: 0, max: 10, scale: 4, ...feeRequired }),
    overtime_rate_snapshot: Field.currency({ label: '加班费率(元/h)', precision: 18, min: 0, readonly: true }),
    travel_rate: Field.currency({ label: '出差费率(元/h)', precision: 18, min: 0 }),
    monthly_hours_limit: Field.number({ label: '月工时上限', min: 0, scale: 2 }),
    effective_from: Field.date({ label: '生效日期', ...feeRequired }),
    effective_to: Field.date({ label: '失效日期' }),
    revision: Field.number({ label: '修订号', min: 1, scale: 0, readonly: true, ...feeRequired }),
    active: Field.boolean({ label: '启用', readonly: true }),
    description: Field.textarea({ label: '描述' }),
    responsible_id: owner(true),
    remarks: remarks(),
  },
  indexes: [{ fields: ['position_id', 'revision'], unique: 'organization' }, { fields: ['position_id', 'active', 'effective_from'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: false },
});

/** Optional member-level rate method and salary reference linked to the canonical SysMember. */
export const ProjectMemberFee = ObjectSchema.create({
  name: 'forge_project_member_fee', label: '项目成员费率', pluralLabel: '项目成员费率', icon: 'user-round-cog', sharingModel: 'private', nameField: 'name',
  fields: {
    name: text('成员费率名称', true),
    rule_key: Field.text({ label: '规则标识', unique: 'organization', readonly: true, hidden: true, ...feeRequired }),
    member_id: Field.lookup('sys_member', { label: '组织成员', relatedList: false, deleteBehavior: 'restrict', ...feeRequired }),
    position_id: Field.lookup('sys_position', { label: '组织岗位', relatedList: false, deleteBehavior: 'restrict', ...feeRequired }),
    pay_method: feeSelect('计算方式', [['role_rate', '岗位费率'], ['salary_reference', '薪资参考']]),
    monthly_salary: Field.currency({ label: '月均工资', precision: 18, min: 0 }),
    actual_hourly_rate: Field.currency({ label: '实际最终费率(元/h)', precision: 18, min: 0 }),
    effective_from: Field.date({ label: '生效日期', ...feeRequired }),
    effective_to: Field.date({ label: '失效日期' }),
    revision: Field.number({ label: '修订号', min: 1, scale: 0, readonly: true, ...feeRequired }),
    active: Field.boolean({ label: '启用', readonly: true }),
    responsible_id: owner(true),
    remarks: remarks(),
  },
  indexes: [{ fields: ['member_id', 'position_id', 'revision'], unique: 'organization' }, { fields: ['member_id', 'position_id', 'active', 'effective_from'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: false },
});

/** Project-local normal-rate override revision; base rate and revision are frozen for audit. */
export const ProjectFeeOverride = ObjectSchema.create({
  name: 'forge_project_fee_override', label: '项目费率覆盖', pluralLabel: '项目费率覆盖', icon: 'badge-percent', sharingModel: 'private', nameField: 'name',
  fields: {
    name: text('覆盖名称', true),
    rule_key: Field.text({ label: '规则标识', unique: 'organization', readonly: true, hidden: true, ...feeRequired }),
    project_id: reference('forge_project', '项目', true),
    position_id: Field.lookup('sys_position', { label: '组织岗位', relatedList: false, deleteBehavior: 'restrict', ...feeRequired }),
    role_fee_id: Field.lookup('forge_project_role_fee', { label: '岗位费率规则', relatedList: false, deleteBehavior: 'restrict', ...feeRequired }),
    role_fee_revision: Field.number({ label: '岗位费率修订快照', min: 1, scale: 0, readonly: true, ...feeRequired }),
    base_normal_rate_snapshot: Field.currency({ label: '默认费率', precision: 18, min: 0, readonly: true, ...feeRequired }),
    override_normal_rate: Field.currency({ label: '覆盖费率(元/h)', precision: 18, min: 0, ...feeRequired }),
    difference_snapshot: Field.currency({ label: '差额', precision: 18, readonly: true }),
    effective_from: Field.date({ label: '生效日期', ...feeRequired }),
    effective_to: Field.date({ label: '失效日期' }),
    reason: Field.textarea({ label: '覆盖原因', ...feeRequired }),
    revision: Field.number({ label: '修订号', min: 1, scale: 0, readonly: true, ...feeRequired }),
    active: Field.boolean({ label: '启用', readonly: true }),
    responsible_id: owner(true),
    remarks: remarks(),
  },
  indexes: [{ fields: ['project_id', 'position_id', 'revision'], unique: 'organization' }, { fields: ['project_id', 'position_id', 'active', 'effective_from'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: false },
});

/** Organization-level work-time configuration; nullable values remain unconfigured until saved. */
export const ProjectTimeCostSettings = ObjectSchema.create({
  name: 'forge_project_time_cost_settings', label: '项目工时成本设置', pluralLabel: '项目工时成本设置', icon: 'sliders-horizontal', sharingModel: 'private', nameField: 'name',
  fields: {
    name: Field.text({ label: '配置名称', ...feeRequired }),
    standard_hours_per_day: Field.number({ label: '标准工作时长(h/日)', min: 0, max: 24, scale: 2 }),
    overtime_start_after_hours: Field.number({ label: '加班起算时长(h/日)', min: 0, max: 24, scale: 2 }),
    max_hours_per_day: Field.number({ label: '每日最高工时(h)', min: 0, max: 24, scale: 2 }),
    auto_approval_threshold_hours: Field.number({ label: '自动审批时长阈值(h)', min: 0, max: 24, scale: 2 }),
    workday_overtime_multiplier: Field.number({ label: '工作日加班倍率', min: 0, max: 10, scale: 4 }),
    weekend_overtime_multiplier: Field.number({ label: '周末加班倍率', min: 0, max: 10, scale: 4 }),
    management_uplift_percent: Field.number({ label: '管理加成(%)', min: 0, max: 1000, scale: 4 }),
    budget_warning_percent: Field.number({ label: '预算预警阈值(%)', min: 0, max: 1000, scale: 2 }),
    revision: Field.number({ label: '配置修订号', min: 1, scale: 0, readonly: true }),
    active: Field.boolean({ label: '当前生效', readonly: true }),
    responsible_id: owner(true),
    remarks: remarks(),
  },
  indexes: [{ fields: ['name'], unique: 'organization' }],
  enable: { apiEnabled: true, searchable: false, trackHistory: true, feeds: false, activities: false },
});
