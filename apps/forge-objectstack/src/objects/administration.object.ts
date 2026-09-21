import { Field, ObjectSchema } from '@objectstack/spec/data';
import { required } from '../model.js';

const option = (value: string, label: string) => ({ value, label });

/**
 * Administrative pages currently share one deliberately small persistence
 * envelope.  `page_key` keeps records on their owning business surface while
 * the page contract remains under review against RISEMAP.  It is not a claim
 * that the different administrative documents have one final domain model.
 */
export const AdministrationRecord = ObjectSchema.create({
  name: 'forge_administration_record',
  label: '行政业务记录',
  pluralLabel: '行政业务记录',
  icon: 'building',
  sharingModel: 'private',
  nameField: 'title',
  fields: {
    title: Field.text({ label: '标题', maxLength: 255, ...required }),
    code: Field.text({ label: '编号', maxLength: 100 }),
    page_key: Field.text({ label: '业务页面', maxLength: 100, ...required }),
    category: Field.text({ label: '分类', maxLength: 100 }),
    status: Field.select([
      option('draft', '草稿'), option('pending', '待处理'), option('in_progress', '进行中'),
      option('approved', '已通过'), option('completed', '已完成'), option('rejected', '已驳回'),
      option('inactive', '已停用'),
    ], { label: '状态', defaultValue: 'draft', ...required }),
    priority: Field.select([
      option('normal', '普通'), option('important', '重要'), option('urgent', '紧急'),
    ], { label: '优先级', defaultValue: 'normal' }),
    owner_name: Field.text({ label: '负责人', maxLength: 100 }),
    department: Field.text({ label: '部门', maxLength: 100 }),
    start_on: Field.date({ label: '开始日期' }),
    end_on: Field.date({ label: '结束日期' }),
    amount: Field.currency({ label: '金额', precision: 18, scale: 2, min: 0 }),
    quantity: Field.number({ label: '数量', min: 0, scale: 2 }),
    details: Field.textarea({ label: '业务说明' }),
    source_ref: Field.text({ label: '来源关联', maxLength: 255 }),
    remarks: Field.textarea({ label: '备注' }),
  },
  searchableFields: ['title', 'code', 'category', 'owner_name', 'department', 'source_ref'],
  listViews: {
    all: {
      label: '全部', type: 'grid',
      columns: ['code', 'title', 'page_key', 'category', 'owner_name', 'department', 'start_on', 'end_on', 'status'],
    },
  },
  indexes: [
    { fields: ['page_key', 'status'] },
    { fields: ['page_key', 'start_on'] },
  ],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const OvertimeRequest = ObjectSchema.create({
  name: 'forge_overtime_request', label: '加班申请', pluralLabel: '加班申请', icon: 'clock-3',
  sharingModel: 'private', nameField: 'code',
  fields: {
    code: Field.text({ label: '单号', maxLength: 80, ...required }),
    applicant_name: Field.text({ label: '申请人', maxLength: 100, ...required }),
    department: Field.text({ label: '部门', maxLength: 120 }),
    starts_at: Field.datetime({ label: '开始时间', ...required }),
    ends_at: Field.datetime({ label: '结束时间', ...required }),
    duration_hours: Field.number({ label: '加班时长', min: 0.5, scale: 2, ...required }),
    compensation_method: Field.select([option('time_off', '调休'), option('overtime_pay', '加班费')], { label: '补偿方式', defaultValue: 'time_off', ...required }),
    reason: Field.textarea({ label: '加班事由', ...required }),
    customer_id: Field.lookup('forge_customer', { label: '关联客户' }),
    project_id: Field.lookup('forge_project', { label: '关联项目' }),
    contract_id: Field.lookup('forge_sales_contract', { label: '关联合同' }),
    status: Field.select([option('draft', '草稿'), option('submitted', '待审批'), option('approved', '已通过'), option('rejected', '已驳回'), option('cancelled', '已取消')], { label: '状态', defaultValue: 'draft', ...required }),
    submitted_at: Field.datetime({ label: '提交时间' }),
    decision_comment: Field.textarea({ label: '审批意见' }),
  },
  searchableFields: ['code', 'applicant_name', 'department', 'reason'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['code', 'applicant_name', 'department', 'starts_at', 'ends_at', 'duration_hours', 'compensation_method', 'status'] } },
  indexes: [{ fields: ['status', 'starts_at'] }, { fields: ['applicant_name', 'status'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const LeaveType = ObjectSchema.create({
  name: 'forge_leave_type', label: '假期类型', pluralLabel: '假期类型', icon: 'calendar-range',
  sharingModel: 'private', nameField: 'name',
  fields: {
    name: Field.text({ label: '假期名称', maxLength: 100, ...required }),
    code: Field.text({ label: '假期编码', maxLength: 60, ...required }),
    unit: Field.select([option('hours', '小时'), option('days', '天')], { label: '核算单位', defaultValue: 'hours', ...required }),
    entitlement_hours: Field.number({ label: '额度（小时）', min: 0, scale: 2, defaultValue: 0, ...required }),
    used_hours: Field.number({ label: '已使用（小时）', min: 0, scale: 2, defaultValue: 0, ...required }),
    pending_hours: Field.number({ label: '审批占用（小时）', min: 0, scale: 2, defaultValue: 0, ...required }),
    requires_attachment: Field.boolean({ label: '要求附件', defaultValue: false }),
    status: Field.select([option('active', '启用'), option('inactive', '停用')], { label: '状态', defaultValue: 'active', ...required }),
    description: Field.textarea({ label: '使用说明' }),
  },
  searchableFields: ['name', 'code', 'description'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['code', 'name', 'unit', 'entitlement_hours', 'used_hours', 'pending_hours', 'status'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['status', 'name'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const LeaveRequest = ObjectSchema.create({
  name: 'forge_leave_request', label: '请假申请', pluralLabel: '请假申请', icon: 'calendar-off',
  sharingModel: 'private', nameField: 'code',
  fields: {
    code: Field.text({ label: '单号', maxLength: 80, ...required }),
    applicant_name: Field.text({ label: '申请人', maxLength: 100, ...required }),
    department: Field.text({ label: '部门', maxLength: 120 }),
    leave_type_id: Field.lookup('forge_leave_type', { label: '假别', ...required }),
    starts_at: Field.datetime({ label: '开始时间', ...required }),
    ends_at: Field.datetime({ label: '结束时间', ...required }),
    duration_hours: Field.number({ label: '请假时长', min: 0.5, scale: 2, ...required }),
    reason: Field.textarea({ label: '请假事由', ...required }),
    status: Field.select([option('draft', '草稿'), option('submitted', '待审批'), option('approved', '已通过'), option('rejected', '已驳回'), option('cancelled', '已取消')], { label: '状态', defaultValue: 'draft', ...required }),
    submitted_at: Field.datetime({ label: '提交时间' }),
    decision_comment: Field.textarea({ label: '审批意见' }),
  },
  searchableFields: ['code', 'applicant_name', 'department', 'reason'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['code', 'applicant_name', 'department', 'leave_type_id', 'starts_at', 'ends_at', 'duration_hours', 'status'] } },
  indexes: [{ fields: ['status', 'starts_at'] }, { fields: ['leave_type_id', 'status'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const BusinessTripRequest = ObjectSchema.create({
  name: 'forge_business_trip_request', label: '出差申请', pluralLabel: '出差申请', icon: 'plane',
  sharingModel: 'private', nameField: 'code',
  fields: {
    code: Field.text({ label: '单号', maxLength: 80, ...required }),
    applicant_name: Field.text({ label: '申请人', maxLength: 100, ...required }),
    department: Field.text({ label: '部门', maxLength: 120 }),
    reason: Field.textarea({ label: '出差事由', ...required }),
    destination: Field.text({ label: '目的地', maxLength: 200, ...required }),
    departure_on: Field.date({ label: '出发日期', ...required }),
    return_on: Field.date({ label: '返回日期', ...required }),
    duration_days: Field.number({ label: '出差天数', min: 1, scale: 1, ...required }),
    transport_method: Field.select([option('airplane', '飞机'), option('high_speed_rail', '高铁'), option('train', '火车'), option('self_drive', '自驾'), option('coach', '大巴'), option('other', '其他')], { label: '交通方式', defaultValue: 'high_speed_rail', ...required }),
    customer_names: Field.text({ label: '关联客户', maxLength: 500 }),
    companion_names: Field.text({ label: '同行人员', maxLength: 500 }),
    estimated_amount: Field.currency({ label: '预计费用', precision: 18, scale: 2, min: 0, defaultValue: 0, ...required }),
    remarks: Field.textarea({ label: '备注' }),
    status: Field.select([option('draft', '草稿'), option('submitted', '待审批'), option('approved', '已通过'), option('rejected', '已驳回'), option('cancelled', '已取消')], { label: '状态', defaultValue: 'draft', ...required }),
    submitted_at: Field.datetime({ label: '提交时间' }),
    decision_comment: Field.textarea({ label: '审批意见' }),
  },
  searchableFields: ['code', 'applicant_name', 'department', 'reason', 'destination', 'customer_names', 'companion_names'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['code', 'applicant_name', 'department', 'destination', 'transport_method', 'departure_on', 'return_on', 'duration_days', 'estimated_amount', 'status'] } },
  indexes: [{ fields: ['status', 'departure_on'] }, { fields: ['applicant_name', 'status'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const BusinessTripExpense = ObjectSchema.create({
  name: 'forge_business_trip_expense', label: '出差费用明细', pluralLabel: '出差费用明细', icon: 'receipt',
  sharingModel: 'controlled_by_parent', nameField: 'category',
  fields: {
    trip_id: Field.masterDetail('forge_business_trip_request', { label: '出差申请', deleteBehavior: 'cascade', inlineEdit: 'grid', ...required }),
    category: Field.select([option('transport', '交通费'), option('lodging', '住宿费'), option('meal', '餐饮费'), option('local_transport', '市内交通'), option('other', '其他费用')], { label: '费用类别', ...required }),
    description: Field.text({ label: '说明', maxLength: 255 }),
    amount: Field.currency({ label: '金额', precision: 18, scale: 2, min: 0, ...required }),
  },
  listViews: { all: { label: '全部', type: 'grid', columns: ['trip_id', 'category', 'description', 'amount'] } },
  indexes: [{ fields: ['trip_id', 'category'] }],
  enable: { apiEnabled: true, searchable: false, trackHistory: true, feeds: false, activities: false },
});

export const BusinessTripItinerary = ObjectSchema.create({
  name: 'forge_business_trip_itinerary', label: '出差行程', pluralLabel: '出差行程', icon: 'route',
  sharingModel: 'controlled_by_parent', nameField: 'origin',
  fields: {
    trip_id: Field.masterDetail('forge_business_trip_request', { label: '出差申请', deleteBehavior: 'cascade', inlineEdit: 'grid', ...required }),
    sequence: Field.number({ label: '顺序', min: 1, scale: 0, ...required }),
    departure_at: Field.datetime({ label: '出发时间', ...required }),
    arrival_at: Field.datetime({ label: '到达时间', ...required }),
    origin: Field.text({ label: '起点', maxLength: 120, ...required }),
    destination: Field.text({ label: '终点', maxLength: 120, ...required }),
    transport_method: Field.select([option('airplane', '飞机'), option('high_speed_rail', '高铁'), option('train', '火车'), option('self_drive', '自驾'), option('coach', '大巴'), option('other', '其他')], { label: '交通方式', ...required }),
  },
  listViews: { all: { label: '全部', type: 'grid', columns: ['trip_id', 'sequence', 'departure_at', 'arrival_at', 'origin', 'destination', 'transport_method'] } },
  indexes: [{ fields: ['trip_id', 'sequence'] }],
  enable: { apiEnabled: true, searchable: false, trackHistory: true, feeds: false, activities: false },
});

export const ApprovalInstance = ObjectSchema.create({
  name: 'forge_approval_instance',
  label: '审批实例',
  pluralLabel: '审批实例',
  icon: 'file-check',
  sharingModel: 'private',
  nameField: 'title',
  fields: {
    title: Field.text({ label: '审批标题', maxLength: 255, ...required }),
    code: Field.text({ label: '审批编号', maxLength: 100, ...required }),
    process_name: Field.text({ label: '审批类型', maxLength: 120, ...required }),
    priority: Field.select([
      option('normal', '普通'), option('important', '重要'), option('urgent', '紧急'),
    ], { label: '优先级', defaultValue: 'normal', ...required }),
    status: Field.select([
      option('draft', '草稿'), option('in_progress', '进行中'), option('approved', '已通过'),
      option('rejected', '已驳回'), option('reversed', '已反审核'), option('cancelled', '已取消'),
      option('paused', '已暂停'),
    ], { label: '状态', defaultValue: 'draft', ...required }),
    current_node: Field.text({ label: '当前节点', maxLength: 120 }),
    source_object: Field.text({ label: '来源对象', maxLength: 120 }),
    source_id: Field.text({ label: '来源记录ID', maxLength: 120 }),
    source_code: Field.text({ label: '来源单号', maxLength: 120 }),
    source_page: Field.text({ label: '来源页面', maxLength: 255 }),
    initiator_name: Field.text({ label: '发起人', maxLength: 100, ...required }),
    initiated_at: Field.datetime({ label: '发起时间' }),
    ended_at: Field.datetime({ label: '结束时间' }),
    due_at: Field.datetime({ label: '到期时间' }),
    remarks: Field.textarea({ label: '申请说明' }),
  },
  searchableFields: ['title', 'code', 'process_name', 'initiator_name', 'current_node'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['code', 'title', 'process_name', 'priority', 'status', 'current_node', 'initiated_at', 'ended_at'] } },
  indexes: [{ fields: ['status', 'initiated_at'] }, { fields: ['initiator_name', 'status'] }, { fields: ['source_object', 'source_id'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const ApprovalTask = ObjectSchema.create({
  name: 'forge_approval_task',
  label: '审批任务',
  pluralLabel: '审批任务',
  icon: 'clipboard-check',
  sharingModel: 'private',
  nameField: 'title',
  fields: {
    title: Field.text({ label: '任务名称', maxLength: 255, ...required }),
    code: Field.text({ label: '任务编号', maxLength: 100, ...required }),
    instance_id: Field.lookup('forge_approval_instance', { label: '审批实例', ...required }),
    process_name: Field.text({ label: '流程名称', maxLength: 120, ...required }),
    process_title: Field.text({ label: '流程标题', maxLength: 255, ...required }),
    initiator_name: Field.text({ label: '发起人', maxLength: 100, ...required }),
    assignee_name: Field.text({ label: '审批人', maxLength: 100, ...required }),
    created_at_business: Field.datetime({ label: '创建时间', ...required }),
    due_at: Field.datetime({ label: '到期时间' }),
    urged_count: Field.number({ label: '催办次数', min: 0, scale: 0, defaultValue: 0 }),
    status: Field.select([
      option('pending', '待处理'), option('approved', '已通过'), option('rejected', '已驳回'),
    ], { label: '状态', defaultValue: 'pending', ...required }),
    decision_comment: Field.textarea({ label: '审批意见' }),
    transferred_to: Field.text({ label: '转办给', maxLength: 100 }),
    completed_at: Field.datetime({ label: '完成时间' }),
  },
  searchableFields: ['title', 'code', 'process_name', 'process_title', 'initiator_name', 'assignee_name'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['code', 'title', 'process_name', 'process_title', 'initiator_name', 'assignee_name', 'due_at', 'status'] } },
  indexes: [{ fields: ['assignee_name', 'status'] }, { fields: ['instance_id', 'status'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const ApprovalCc = ObjectSchema.create({
  name: 'forge_approval_cc',
  label: '审批抄送',
  pluralLabel: '审批抄送',
  icon: 'send',
  sharingModel: 'private',
  nameField: 'title',
  fields: {
    title: Field.text({ label: '流程标题', maxLength: 255, ...required }),
    code: Field.text({ label: '抄送编号', maxLength: 100, ...required }),
    instance_id: Field.lookup('forge_approval_instance', { label: '审批实例', ...required }),
    process_name: Field.text({ label: '流程名称', maxLength: 120, ...required }),
    initiator_name: Field.text({ label: '发起人', maxLength: 100, ...required }),
    copied_at: Field.datetime({ label: '抄送时间', ...required }),
    progress: Field.text({ label: '当前进度', maxLength: 120 }),
    read_status: Field.select([option('unread', '未读'), option('read', '已读')], { label: '阅读状态', defaultValue: 'unread', ...required }),
    read_at: Field.datetime({ label: '阅读时间' }),
  },
  searchableFields: ['title', 'code', 'process_name', 'initiator_name', 'progress'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['read_status', 'code', 'process_name', 'title', 'initiator_name', 'copied_at', 'progress'] } },
  indexes: [{ fields: ['read_status', 'copied_at'] }, { fields: ['instance_id'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const ProcessCategory = ObjectSchema.create({
  name: 'forge_process_category', label: '流程分类', pluralLabel: '流程分类', icon: 'tags',
  sharingModel: 'private', nameField: 'title',
  fields: {
    title: Field.text({ label: '分类名称', maxLength: 120, ...required }),
    code: Field.text({ label: '分类编码', maxLength: 80, ...required }),
    status: Field.select([option('active', '已启用'), option('inactive', '已停用')], { label: '状态', defaultValue: 'active', ...required }),
    sort_order: Field.number({ label: '显示顺序', min: 0, scale: 0, defaultValue: 100 }),
    description: Field.textarea({ label: '分类说明' }),
  },
  searchableFields: ['title', 'code', 'description'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['code', 'title', 'status', 'sort_order'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['status', 'sort_order'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const ProcessDefinition = ObjectSchema.create({
  name: 'forge_process_definition', label: '流程定义', pluralLabel: '流程定义', icon: 'git-branch',
  sharingModel: 'private', nameField: 'title',
  fields: {
    title: Field.text({ label: '流程名称', maxLength: 160, ...required }),
    code: Field.text({ label: '流程编码', maxLength: 80, ...required }),
    category_id: Field.lookup('forge_process_category', { label: '流程分类', ...required }),
    status: Field.select([option('active', '已启用'), option('inactive', '已停用')], { label: '状态', defaultValue: 'active', ...required }),
    process_type: Field.select([option('approval', '审批流程'), option('business', '业务流程')], { label: '流程类型', defaultValue: 'approval', ...required }),
    version: Field.text({ label: '版本号', maxLength: 30, defaultValue: 'V1.0', ...required }),
    default_approver: Field.text({ label: '默认审批人', maxLength: 100, ...required }),
    description: Field.textarea({ label: '流程说明' }),
  },
  searchableFields: ['title', 'code', 'default_approver', 'description'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['code', 'title', 'category_id', 'status', 'process_type', 'version', 'default_approver'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['category_id', 'status'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const CompanyNotice = ObjectSchema.create({
  name: 'forge_company_notice', label: '公司通知', pluralLabel: '公司通知', icon: 'megaphone',
  sharingModel: 'private', nameField: 'title',
  fields: {
    title: Field.text({ label: '通知主题', maxLength: 200, ...required }),
    code: Field.text({ label: '通知编号', maxLength: 80, ...required }),
    category: Field.select([option('activity', '活动通知'), option('administration', '行政通知'), option('personnel', '人事通知'), option('system', '系统通知')], { label: '通知类别', defaultValue: 'administration', ...required }),
    priority: Field.select([option('normal', '普通'), option('important', '重要'), option('urgent', '紧急')], { label: '优先级', defaultValue: 'normal', ...required }),
    status: Field.select([option('draft', '草稿'), option('published', '已发布'), option('withdrawn', '已撤回'), option('expired', '已失效')], { label: '状态', defaultValue: 'draft', ...required }),
    department: Field.text({ label: '发布部门', maxLength: 120, ...required }),
    publisher_name: Field.text({ label: '发布人', maxLength: 100, ...required }),
    summary: Field.textarea({ label: '摘要', ...required }),
    content: Field.textarea({ label: '正文', ...required }),
    audience_type: Field.select([option('company', '全公司'), option('departments', '指定部门'), option('people', '指定人员')], { label: '接收范围', defaultValue: 'company', ...required }),
    audience_detail: Field.text({ label: '范围说明', maxLength: 500 }),
    expires_on: Field.date({ label: '失效日期' }),
    pinned: Field.boolean({ label: '置顶显示', defaultValue: false }),
    published_at: Field.datetime({ label: '发布时间' }),
    withdrawn_at: Field.datetime({ label: '撤回时间' }),
    read_count: Field.number({ label: '已读人数', min: 0, scale: 0, defaultValue: 0 }),
    recipient_count: Field.number({ label: '接收人数', min: 0, scale: 0, defaultValue: 0 }),
  },
  searchableFields: ['title', 'code', 'department', 'publisher_name', 'summary', 'content'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['code', 'title', 'status', 'category', 'priority', 'audience_type', 'department', 'publisher_name', 'published_at', 'read_count'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['status', 'published_at'] }, { fields: ['category', 'audience_type'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const WorkReport = ObjectSchema.create({
  name: 'forge_work_report', label: '工作汇报', pluralLabel: '工作汇报', icon: 'clipboard-list', sharingModel: 'private', nameField: 'title',
  fields: {
    title: Field.text({ label: '汇报标题', maxLength: 200, ...required }),
    code: Field.text({ label: '汇报编号', maxLength: 80, ...required }),
    report_type: Field.select([option('weekly','周报'), option('monthly','月报'), option('daily','日报'), option('free','自由汇报')], { label: '汇报类型', defaultValue: 'weekly', ...required }),
    status: Field.select([option('draft','草稿'), option('submitted','待审阅'), option('approved','已确认'), option('rejected','已退回')], { label: '状态', defaultValue: 'draft', ...required }),
    owner_name: Field.text({ label: '提交人', maxLength: 100, ...required }),
    period_start: Field.date({ label: '汇报周期起始', ...required }), period_end: Field.date({ label: '汇报周期结束', ...required }),
    work_content: Field.textarea({ label: '工作内容', ...required }), completion: Field.number({ label: '完成度', min: 0, max: 100, scale: 0, defaultValue: 0 }),
    summary: Field.textarea({ label: '工作总结', ...required }), next_plan: Field.textarea({ label: '下期计划' }), risks: Field.textarea({ label: '问题与风险' }),
    work_items_json: Field.textarea({ label: '结构化工作内容' }), related_rule: Field.text({ label: '关联规则', maxLength: 200 }),
    project_progress: Field.textarea({ label: '项目进度说明' }), kpi_completion: Field.textarea({ label: 'KPI 完成情况' }),
    opportunity_followup: Field.textarea({ label: '商机跟进' }), customer_visits: Field.textarea({ label: '客户拜访' }),
    technical_issues: Field.textarea({ label: '技术问题' }), personnel_updates: Field.textarea({ label: '人员动态' }), tomorrow_plan: Field.textarea({ label: '次日计划' }),
    attachment_ids: Field.file({ label: '附件', multiple: true }),
    self_score: Field.number({ label: '自评得分', min: 0, max: 100, scale: 0 }), submitted_at: Field.datetime({ label: '提交时间' }), reviewer_name: Field.text({ label: '审阅人', maxLength: 100 }), review_note: Field.textarea({ label: '审阅意见' }),
  },
  searchableFields: ['title','code','owner_name','work_content','summary','next_plan','risks'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['code','title','owner_name','report_type','period_start','period_end','status','submitted_at','self_score'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['status','period_end'] }, { fields: ['owner_name','period_start'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, files: true, feeds: false, activities: true },
});

export const DocumentEntry = ObjectSchema.create({
  name: 'forge_document_entry', label: '文档条目', pluralLabel: '文档条目', icon: 'folder', sharingModel: 'private', nameField: 'title',
  fields: {
    title: Field.text({ label: '名称', maxLength: 200, ...required }), code: Field.text({ label: '文档编号', maxLength: 80, ...required }),
    entry_type: Field.select([option('folder','文件夹'), option('document','文档')], { label: '条目类型', defaultValue: 'folder', ...required }),
    parent_id: Field.lookup('forge_document_entry', { label: '上级目录' }), description: Field.textarea({ label: '描述' }),
    access: Field.select([option('company','全员可见'), option('restricted','限制访问')], { label: '访问权限', defaultValue: 'company', ...required }),
    owner_name: Field.text({ label: '负责人', maxLength: 100, ...required }), favorite: Field.boolean({ label: '收藏', defaultValue: false }),
    last_accessed_at: Field.datetime({ label: '最近使用时间' }),
    file_id: Field.file({ label: '文件' }), file_name: Field.text({ label: '文件名', maxLength: 255 }),
    file_size: Field.number({ label: '文件大小', min: 0, scale: 0 }), mime_type: Field.text({ label: '文件类型', maxLength: 160 }),
  }, searchableFields: ['title','code','description','file_name','owner_name'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['entry_type','code','title','access','owner_name','updated_at','favorite'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['entry_type','parent_id'] }, { fields: ['favorite','updated_at'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, files: true, feeds: false, activities: true },
});

export const RulePolicy = ObjectSchema.create({
  name: 'forge_rule_policy', label: '规章制度', pluralLabel: '规章制度', icon: 'book-open', sharingModel: 'private', nameField: 'title',
  fields: {
    title: Field.text({ label: '制度名称', maxLength: 200, ...required }),
    code: Field.text({ label: '制度编号', maxLength: 80, ...required }),
    category: Field.text({ label: '分类', maxLength: 100, ...required }),
    status: Field.select([option('draft','草稿'), option('published','已发布'), option('inactive','已停用')], { label: '状态', defaultValue: 'draft', ...required }),
    scope: Field.text({ label: '适用范围', maxLength: 200 }),
    effective_on: Field.date({ label: '生效日期' }),
    version: Field.text({ label: '版本', maxLength: 30, defaultValue: 'V1.0', ...required }),
    owner_name: Field.text({ label: '创建人', maxLength: 100, ...required }),
    summary: Field.textarea({ label: '制度摘要' }),
  },
  searchableFields: ['title','code','category','scope','owner_name','summary'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['code','title','category','status','scope','effective_on','version','owner_name'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['status','effective_on'] }, { fields: ['category','status'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const EmployeeRecord = ObjectSchema.create({
  name: 'forge_employee_record', label: '员工档案', pluralLabel: '员工档案', icon: 'users', sharingModel: 'private', nameField: 'name',
  fields: {
    name: Field.text({ label: '姓名', maxLength: 100, ...required }),
    employee_code: Field.text({ label: '工号', maxLength: 60, ...required }),
    department: Field.text({ label: '部门', maxLength: 120 }),
    position: Field.text({ label: '岗位', maxLength: 120 }),
    grade: Field.text({ label: '职级', maxLength: 80 }),
    employment_type: Field.select([option('full_time','正式'), option('probation','试用'), option('part_time','兼职'), option('contract','合同')], { label: '用工类型', defaultValue: 'full_time', ...required }),
    status: Field.select([option('active','在职'), option('probation','试用期'), option('leave','休假'), option('resigned','离职')], { label: '员工状态', defaultValue: 'active', ...required }),
    joined_on: Field.date({ label: '入职日期' }),
    contract_end_on: Field.date({ label: '合同到期日' }),
    passport_no: Field.text({ label: '护照号码', maxLength: 80 }),
    system_user: Field.text({ label: '系统用户', maxLength: 120 }),
    mobile: Field.text({ label: '手机', maxLength: 40 }),
    remarks: Field.textarea({ label: '备注' }),
  },
  searchableFields: ['name','employee_code','department','position','grade','passport_no','system_user','mobile'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['employee_code','name','department','position','grade','employment_type','status','joined_on','contract_end_on','passport_no','system_user','mobile'] } },
  indexes: [{ fields: ['employee_code'], unique: 'organization' }, { fields: ['department','status'] }, { fields: ['contract_end_on','status'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const MeetingMinute = ObjectSchema.create({
  name: 'forge_meeting_minute', label: '会议纪要', pluralLabel: '会议纪要', icon: 'calendar', sharingModel: 'private', nameField: 'title',
  fields: {
    title: Field.text({ label: '会议主题', maxLength: 200, ...required }),
    code: Field.text({ label: '会议编号', maxLength: 80, ...required }),
    meeting_type: Field.text({ label: '会议类型', maxLength: 100 }),
    meeting_at: Field.datetime({ label: '日期/时间', ...required }),
    meeting_on: Field.date({ label: '会议日期', required: true }),
    start_time: Field.text({ label: '开始时间', maxLength: 5, required: true }),
    end_time: Field.text({ label: '结束时间', maxLength: 5, required: true }),
    location: Field.text({ label: '会议地点', maxLength: 200 }),
    host_name: Field.text({ label: '主持人', maxLength: 100 }),
    attendee_names: Field.textarea({ label: '参会人员' }),
    external_attendees: Field.textarea({ label: '外部参会人员' }),
    attendee_count: Field.number({ label: '参会人数', min: 0, scale: 0, defaultValue: 0 }),
    todo_count: Field.number({ label: '待办', min: 0, scale: 0, defaultValue: 0 }),
    status: Field.select([option('draft','草稿'), option('confirmed','已确认'), option('archived','已归档')], { label: '状态', defaultValue: 'draft', ...required }),
    summary: Field.textarea({ label: '会议摘要', required: true }),
    content: Field.textarea({ label: '详细内容' }),
    decisions: Field.textarea({ label: '会议决议' }),
    todos: Field.textarea({ label: '待办事项' }),
    todo_items_json: Field.textarea({ label: '结构化待办' }),
    sync_todos: Field.boolean({ label: '同步创建到待办管理', defaultValue: true }),
    ai_template: Field.text({ label: '会议纪要模板', maxLength: 160 }),
    recording_file_id: Field.text({ label: '录音文件标识', maxLength: 255 }),
    recording_file_name: Field.text({ label: '录音文件名', maxLength: 255 }),
    transcription_status: Field.select([option('none','无录音'), option('ready','待转写'), option('processing','转写中'), option('completed','已转写'), option('failed','转写失败')], { label: '转写状态', defaultValue: 'none' }),
    recipient_names: Field.textarea({ label: '发送给' }),
    cc_names: Field.textarea({ label: '抄送' }),
    delivery_status: Field.select([option('not_sent','未发送'), option('pending','待投递'), option('sent','已发送'), option('failed','发送失败')], { label: '发送状态', defaultValue: 'not_sent' }),
    attachment_ids: Field.file({ label: '会议附件', multiple: true }),
    remarks: Field.textarea({ label: '备注' }),
  },
  searchableFields: ['title','code','meeting_type','host_name','location','summary','content','decisions','todos','attendee_names'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['code','title','meeting_type','meeting_at','host_name','attendee_count','todo_count','status'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['meeting_at','status'] }, { fields: ['host_name','meeting_at'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, files: true, feeds: false, activities: true },
});

export const SealApplication = ObjectSchema.create({
  name: 'forge_seal_application', label: '用章申请', pluralLabel: '用章申请', icon: 'stamp', sharingModel: 'private', nameField: 'title',
  fields: {
    title: Field.text({ label: '文件名称', maxLength: 200, ...required }),
    code: Field.text({ label: '申请编号', maxLength: 80, ...required }),
    company_name: Field.text({ label: '公司抬头', maxLength: 200 }),
    applicant_name: Field.text({ label: '申请人', maxLength: 100, ...required }),
    seal_type: Field.text({ label: '印章类型', maxLength: 100, ...required }),
    urgency: Field.select([option('normal','普通'), option('urgent','紧急'), option('critical','特急')], { label: '紧急程度', defaultValue: 'normal', required: true }),
    contract_type: Field.select([option('none','不关联合同'), option('sales','销售合同'), option('purchase','采购合同'), option('other','其他合同')], { label: '合同类型', defaultValue: 'none', required: true }),
    contract_reference: Field.text({ label: '关联合同', maxLength: 200 }),
    file_type: Field.select([option('contract','合同'), option('agreement','协议'), option('certificate','证明'), option('authorization','授权书'), option('other','其他')], { label: '文件类型', required: true }),
    copy_count: Field.number({ label: '盖章份数', min: 1, scale: 0, defaultValue: 1, required: true }),
    reason: Field.textarea({ label: '用章事由', ...required }),
    status: Field.select([option('draft','草稿'), option('pending','待审批'), option('approved','已通过'), option('rejected','已驳回'), option('completed','已盖章')], { label: '状态', defaultValue: 'draft', ...required }),
    applied_on: Field.date({ label: '申请日期', ...required }),
    external_use: Field.boolean({ label: '是否外带', defaultValue: false }),
    return_on: Field.date({ label: '预计归还日期' }),
    attachment_ids: Field.file({ label: '用章文件', multiple: true }),
    remarks: Field.textarea({ label: '备注' }),
  },
  searchableFields: ['title','code','company_name','applicant_name','seal_type','contract_reference','reason'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['code','company_name','applicant_name','seal_type','title','reason','status','applied_on'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['status','applied_on'] }, { fields: ['applicant_name','applied_on'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, files: true, feeds: false, activities: true },
});

export const FixedAsset = ObjectSchema.create({
  name: 'forge_fixed_asset', label: '固定资产', pluralLabel: '固定资产', icon: 'box', sharingModel: 'private', nameField: 'title',
  fields: {
    title: Field.text({ label: '资产名称', maxLength: 200, ...required }), code: Field.text({ label: '资产编号', maxLength: 80, ...required }),
    category: Field.text({ label: '资产分类', maxLength: 100, ...required }),
    brand: Field.text({ label: '品牌', maxLength: 120 }), model: Field.text({ label: '规格型号', maxLength: 160 }),
    owner_name: Field.text({ label: '责任人', maxLength: 100, ...required }), department: Field.text({ label: '使用部门', maxLength: 120, ...required }),
    purchase_on: Field.date({ label: '购入日期', ...required }), original_value: Field.currency({ label: '资产原值', precision: 18, scale: 2, min: 0, ...required }), accumulated_depreciation: Field.currency({ label: '已折旧金额', precision: 18, scale: 2, min: 0, defaultValue: 0, ...required }),
    depreciation_method: Field.select([option('straight_line','直线法')], { label: '折旧方法', defaultValue: 'straight_line', ...required }),
    useful_life_years: Field.number({ label: '使用年限（年）', min: 1, scale: 0, defaultValue: 5, ...required }),
    residual_rate: Field.number({ label: '残值率（%）', min: 0, max: 100, scale: 2, defaultValue: 5, ...required }),
    residual_value: Field.currency({ label: '预计残值', precision: 18, scale: 2, min: 0 }), net_value: Field.currency({ label: '资产净值', precision: 18, scale: 2, min: 0 }), monthly_depreciation: Field.currency({ label: '月折旧额', precision: 18, scale: 2, min: 0 }),
    supplier_name: Field.text({ label: '供应商', maxLength: 200 }), location: Field.text({ label: '存放地点', maxLength: 200 }), invoice_number: Field.text({ label: '发票号', maxLength: 120 }),
    asset_image_ids: Field.file({ label: '资产图片', multiple: true }),
    last_depreciated_month: Field.text({ label: '最近计提月份', maxLength: 7 }),
    status: Field.select([option('in_use','在用'), option('idle','闲置'), option('repair','维修中'), option('scrapped','已报废')], { label: '状态', defaultValue: 'in_use', ...required }), remarks: Field.textarea({ label: '备注' }),
  },
  searchableFields: ['title','code','category','brand','model','owner_name','department','supplier_name','location','invoice_number'], listViews: { all: { label: '全部', type: 'grid', columns: ['code','title','category','original_value','accumulated_depreciation','residual_value','net_value','monthly_depreciation','owner_name','department','status','purchase_on'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['status','department'] }, { fields: ['category','purchase_on'] }], enable: { apiEnabled: true, searchable: true, trackHistory: true, files: true, feeds: false, activities: true },
});

export const QualificationRecord = ObjectSchema.create({
  name: 'forge_qualification_record', label: '资质与申报', pluralLabel: '资质与申报', icon: 'award', sharingModel: 'private', nameField: 'title',
  fields: {
    title: Field.text({ label: '资质名称', maxLength: 200, ...required }), code: Field.text({ label: '证书编号', maxLength: 100, ...required }),
    category: Field.text({ label: '资质类别', maxLength: 120, ...required }), issuing_authority: Field.text({ label: '发证机构', maxLength: 160, ...required }),
    owner_name: Field.text({ label: '责任人', maxLength: 100 }), valid_from: Field.date({ label: '有效期起', ...required }), valid_to: Field.date({ label: '有效期止', ...required }),
    annual_review_on: Field.date({ label: '年审日期' }), recheck_on: Field.date({ label: '复审日期' }),
    declaration_id: Field.lookup('forge_qualification_declaration', { label: '关联申报' }), related_materials: Field.textarea({ label: '关联材料' }), attachment_ids: Field.file({ label: '附件', multiple: true }), attachment_note: Field.textarea({ label: '附件说明' }),
    status: Field.select([option('valid','有效'), option('expiring','即将到期'), option('expired','已到期'), option('draft','草稿')], { label: '状态', defaultValue: 'valid', ...required }),
    declaration_status: Field.select([option('none','未申报'), option('preparing','准备中'), option('submitted','已申报'), option('approved','已通过'), option('rejected','已驳回')], { label: '政策申报状态', defaultValue: 'none', ...required }),
    material_note: Field.textarea({ label: '材料说明' }), remarks: Field.textarea({ label: '备注' }),
  },
  searchableFields: ['title','code','category','issuing_authority','owner_name','material_note'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['title','category','code','issuing_authority','valid_to','owner_name','status','declaration_status'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['status','valid_to'] }, { fields: ['category','declaration_status'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, files: true, feeds: false, activities: true },
});

export const QualificationDeclaration = ObjectSchema.create({
  name: 'forge_qualification_declaration', label: '政策申报', pluralLabel: '政策申报', icon: 'file-check', sharingModel: 'private', nameField: 'title',
  fields: {
    title: Field.text({ label: '申报名称', maxLength: 220, ...required }), code: Field.text({ label: '申报编号', maxLength: 80, ...required }),
    category: Field.text({ label: '申报类别', maxLength: 120, ...required }), authority: Field.text({ label: '主管部门', maxLength: 180, ...required }),
    deadline_on: Field.date({ label: '截止日期', ...required }), start_on: Field.date({ label: '启动日期' }), owner_name: Field.text({ label: '责任人', maxLength: 100 }),
    expected_amount: Field.currency({ label: '预期补贴金额', precision: 18, scale: 2, min: 0 }), material_count: Field.number({ label: '关联材料数', min: 0, scale: 0, defaultValue: 0 }),
    stage: Field.select([option('pending_evaluation','待评估'), option('preparing','准备中'), option('materials','材料准备'), option('submitted','已提交'), option('review','审核中'), option('approved','已通过'), option('rejected','已驳回')], { label: '当前阶段', defaultValue: 'pending_evaluation', ...required }),
    remarks: Field.textarea({ label: '备注' }),
  },
  searchableFields: ['title','code','category','authority','owner_name'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['title','category','authority','deadline_on','owner_name','expected_amount','material_count','stage'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['stage','deadline_on'] }, { fields: ['category','deadline_on'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const QualificationMaterial = ObjectSchema.create({
  name: 'forge_qualification_material', label: '资质材料', pluralLabel: '资质材料', icon: 'folder', sharingModel: 'private', nameField: 'title',
  fields: {
    title: Field.text({ label: '名称', maxLength: 220, ...required }), code: Field.text({ label: '材料编号', maxLength: 80, ...required }),
    entry_type: Field.select([option('folder','文件夹'), option('file','文件')], { label: '类型', defaultValue: 'folder', ...required }),
    parent_code: Field.text({ label: '上级文件夹编号', maxLength: 80 }), category: Field.text({ label: '材料分类', maxLength: 120 }),
    file_name: Field.text({ label: '文件名', maxLength: 255 }), file_url: Field.url({ label: '文件地址' }), owner_name: Field.text({ label: '负责人', maxLength: 100 }),
    updated_on: Field.date({ label: '更新日期' }), remarks: Field.textarea({ label: '备注' }),
  },
  searchableFields: ['title','code','category','file_name','owner_name'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['title','entry_type','category','file_name','owner_name','updated_on'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['entry_type','parent_code'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const MaterialPickupRequest = ObjectSchema.create({
  name: 'forge_material_pickup_request', label: '物料领取', pluralLabel: '物料领取', icon: 'package', sharingModel: 'private', nameField: 'title',
  fields: {
    title: Field.text({ label: '物品名称', maxLength: 200, ...required }), code: Field.text({ label: '申请单号', maxLength: 100, ...required }),
    category: Field.text({ label: '物品分类', maxLength: 120 }), owner_name: Field.text({ label: '申请人', maxLength: 100, ...required }),
    department: Field.text({ label: '申请部门', maxLength: 120 }), request_on: Field.date({ label: '申请日期', ...required }),
    quantity: Field.number({ label: '数量', min: 0, scale: 2, ...required }), status: Field.select([option('draft','草稿'), option('pending','待审批'), option('approved','待领取'), option('picked','已领取'), option('rejected','已驳回')], { label: '状态', defaultValue: 'draft', ...required }),
    purpose: Field.textarea({ label: '领用事由', ...required }), remarks: Field.textarea({ label: '备注' }),
  }, searchableFields: ['title','code','category','owner_name','department','purpose'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['code','title','category','owner_name','department','request_on','quantity','status'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['status','request_on'] }, { fields: ['owner_name','request_on'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const AdministrationSupply = ObjectSchema.create({
  name: 'forge_administration_supply', label: '行政物品', pluralLabel: '行政物品', icon: 'package-open', sharingModel: 'public_read', nameField: 'title',
  fields: {
    title: Field.text({ label: '物品名称', maxLength: 200, ...required }), code: Field.text({ label: '物品编号', maxLength: 80, ...required }),
    category: Field.text({ label: '类别', maxLength: 120 }), specification: Field.text({ label: '规格型号', maxLength: 160 }), unit: Field.text({ label: '单位', maxLength: 40, defaultValue: '个', ...required }),
    current_stock: Field.number({ label: '当前库存', min: 0, scale: 2, defaultValue: 0, ...required }), safety_stock: Field.number({ label: '安全库存', min: 0, scale: 2, defaultValue: 5, ...required }),
    reference_price: Field.currency({ label: '参考单价', precision: 18, scale: 2, min: 0, defaultValue: 0 }), supplier_name: Field.text({ label: '供应商', maxLength: 180 }),
    purchase_channel: Field.text({ label: '购买渠道', maxLength: 120 }), bin_code: Field.text({ label: '库位编号', maxLength: 80 }), last_inbound_on: Field.date({ label: '最近入库' }),
    status: Field.select([option('active','启用'), option('inactive','停用')], { label: '状态', defaultValue: 'active', ...required }), remarks: Field.textarea({ label: '备注' }),
  },
  searchableFields: ['title','code','category','specification','supplier_name','purchase_channel','bin_code'],
  listViews: { all: { label: '全部', type: 'grid', columns: ['title','category','specification','unit','current_stock','safety_stock','reference_price','supplier_name','purchase_channel','bin_code','last_inbound_on'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['category','status'] }, { fields: ['current_stock','safety_stock'] }],
  enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const MaterialPickupLine = ObjectSchema.create({
  name: 'forge_material_pickup_line', label: '物料领取明细', pluralLabel: '物料领取明细', icon: 'list', sharingModel: 'private', nameField: 'title',
  fields: {
    title: Field.text({ label: '物品名称', maxLength: 200, ...required }), request_id: Field.lookup('forge_material_pickup_request', { label: '领取申请', ...required }),
    supply_id: Field.lookup('forge_administration_supply', { label: '物品', ...required }), quantity: Field.number({ label: '数量', min: 0.01, scale: 2, ...required }), unit: Field.text({ label: '单位', maxLength: 40, ...required }),
  },
  searchableFields: ['title','unit'], listViews: { all: { label: '全部', type: 'grid', columns: ['request_id','title','quantity','unit'] } },
  indexes: [{ fields: ['request_id'] }, { fields: ['supply_id'] }], enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});

export const AdministrationSupplyInbound = ObjectSchema.create({
  name: 'forge_administration_supply_inbound', label: '行政物品入库', pluralLabel: '行政物品入库', icon: 'package-plus', sharingModel: 'private', nameField: 'code',
  fields: {
    code: Field.text({ label: '入库编号', maxLength: 80, ...required }), supply_id: Field.lookup('forge_administration_supply', { label: '物品', ...required }),
    quantity: Field.number({ label: '数量', min: 0.01, scale: 2, ...required }), unit_price: Field.currency({ label: '单价', precision: 18, scale: 2, min: 0 }),
    supplier_name: Field.text({ label: '供应商', maxLength: 180 }), purchase_channel: Field.text({ label: '购买渠道', maxLength: 120 }), inbound_on: Field.date({ label: '入库日期', ...required }),
    owner_name: Field.text({ label: '经办人', maxLength: 100 }), remarks: Field.textarea({ label: '备注' }),
  },
  searchableFields: ['code','supplier_name','purchase_channel','owner_name'], listViews: { all: { label: '全部', type: 'grid', columns: ['code','supply_id','quantity','unit_price','supplier_name','purchase_channel','inbound_on','owner_name'] } },
  indexes: [{ fields: ['code'], unique: 'organization' }, { fields: ['supply_id','inbound_on'] }], enable: { apiEnabled: true, searchable: true, trackHistory: true, feeds: false, activities: true },
});
