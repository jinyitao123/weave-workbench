import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, owner, remarks, required } from '../model.js';

const count = (label: string) => Field.number({ label, min: 0, scale: 0, defaultValue: 0, readonly: true });
const select = (label: string, options: Array<[string, string]>, defaultValue?: string, readonly = false) => Field.select(
  options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
  { label, ...(defaultValue ? { defaultValue } : {}), ...(readonly ? { readonly: true } : {}) },
);

export const CommissioningRecord = master('forge_commissioning_record', '集成调试记录', 'wrench', {
  name: text('调试记录名称', true), code: code('调试单号'), project_id: reference('forge_project', '项目', true),
  assembly_id: reference('forge_assembly_order', '来源组装单', true), equipment_code: text('设备编号', true), site: text('调试地点', true),
  commissioning_on: Field.date({ label: '调试日期', ...required }), leader_id: owner(true),
  status: select('调试状态', [['pending_review', '待确认'], ['failed', '未通过'], ['passed', '已通过']], 'pending_review', true),
  line_count: count('检查项数'), passed_count: count('通过项数'), failed_count: count('未通过项数'),
  conclusion: Field.textarea({ label: '调试结论', readonly: true }), confirmed_at: Field.datetime({ label: '确认时间', readonly: true }), remarks: remarks(),
}, ['code', 'project_id', 'assembly_id', 'equipment_code', 'site', 'commissioning_on', 'line_count', 'passed_count', 'failed_count', 'status']);

export const CommissioningCheck = master('forge_commissioning_check', '调试检查项', 'list-checks', {
  name: text('检查项', true), check_key: code('检查项编号'), commissioning_id: reference('forge_commissioning_record', '调试记录', true),
  category: select('检查类别', [['power', '上电与安全'], ['io', 'I/O点检'], ['network', '通讯联调'], ['sequence', '工艺联锁'], ['performance', '性能试运行']]),
  criterion: Field.textarea({ label: '验收标准', ...required }), result: select('检查结果', [['pending', '待检查'], ['passed', '通过'], ['failed', '未通过']], 'pending'),
  observation: Field.textarea({ label: '实测结果' }), evidence_ref: text('证据编号/文件引用'), checked_by: Field.user({ label: '检查人' }),
  checked_at: Field.datetime({ label: '检查时间', readonly: true }), remarks: remarks(),
}, ['commissioning_id', 'category', 'name', 'criterion', 'result', 'evidence_ref', 'checked_by', 'checked_at']);

export const DeliveryPackage = master('forge_delivery_package', '项目交付包', 'package-check', {
  name: text('交付包名称', true), code: code('交付包编号'), project_id: reference('forge_project', '项目', true),
  commissioning_id: reference('forge_commissioning_record', '调试依据', true), revision: text('交付版本', true),
  prepared_on: Field.date({ label: '编制日期', ...required }), prepared_by: owner(true),
  status: select('交付包状态', [['draft', '资料准备中'], ['ready', '待客户验收'], ['accepted', '客户已接收']], 'draft', true),
  line_count: count('资料项数'), ready_count: count('已齐项数'), missing_count: count('缺失项数'),
  submitted_at: Field.datetime({ label: '提交时间', readonly: true }), accepted_at: Field.datetime({ label: '客户接收时间', readonly: true }), remarks: remarks(),
}, ['code', 'project_id', 'commissioning_id', 'revision', 'prepared_on', 'line_count', 'ready_count', 'missing_count', 'status']);

export const DeliveryPackageItem = master('forge_delivery_package_item', '交付资料项', 'files', {
  name: text('资料名称', true), item_key: code('资料项编号'), package_id: reference('forge_delivery_package', '交付包', true),
  item_type: select('资料类型', [['drawing', '竣工图纸'], ['test_report', '调试报告'], ['manual', '操作维护手册'], ['equipment_list', '设备清单'], ['training', '培训记录'], ['other', '其他']]),
  required: Field.boolean({ label: '必交', defaultValue: true }), version: text('文件版本'), evidence_ref: text('文件编号/证据引用'),
  status: select('资料状态', [['missing', '缺失'], ['ready', '已齐']], 'missing', true), remarks: remarks(),
}, ['package_id', 'item_type', 'name', 'required', 'version', 'evidence_ref', 'status']);

export const CustomerAcceptance = master('forge_customer_acceptance', '客户验收单', 'badge-check', {
  name: text('验收单名称', true), code: code('验收单号'), project_id: reference('forge_project', '项目', true),
  package_id: reference('forge_delivery_package', '交付包', true),
  acceptance_method: select('验收方式', [['site', '现场验收'], ['arrival', '到货验收'], ['trial_run', '试运行验收'], ['third_party', '第三方检验'], ['written', '书面确认'], ['remote', '远程验收']]),
  acceptance_on: Field.date({ label: '验收日期', ...required }), customer_representative: text('客户代表', true), internal_owner_id: owner(true),
  status: select('验收状态', [['pending_review', '待提交'], ['rectification_required', '整改中'], ['awaiting_confirmation', '待客户确认'], ['accepted', '验收通过']], 'pending_review', true),
  line_count: count('验收项数'), passed_count: count('通过项数'), failed_count: count('未通过项数'), open_rectification_count: count('未关闭整改数'),
  conclusion: Field.textarea({ label: '验收结论', readonly: true }), customer_comment: Field.textarea({ label: '客户意见' }),
  signed_evidence_ref: text('客户确认文件/签字编号'), submitted_at: Field.datetime({ label: '提交时间', readonly: true }), accepted_at: Field.datetime({ label: '通过时间', readonly: true }), remarks: remarks(),
}, ['code', 'project_id', 'package_id', 'acceptance_on', 'customer_representative', 'line_count', 'passed_count', 'failed_count', 'open_rectification_count', 'status']);

export const CustomerAcceptanceItem = master('forge_customer_acceptance_item', '客户验收项', 'clipboard-check', {
  name: text('验收项', true), item_key: code('验收项编号'), acceptance_id: reference('forge_customer_acceptance', '客户验收单', true),
  category: select('验收类别', [['function', '功能'], ['safety', '安全'], ['document', '资料'], ['training', '培训'], ['site', '现场']]),
  criterion: Field.textarea({ label: '验收标准', ...required }), result: select('验收结果', [['pending', '待验收'], ['passed', '通过'], ['failed', '未通过']], 'pending', true),
  observation: Field.textarea({ label: '验收记录' }), evidence_ref: text('证据编号/文件引用'), verified_at: Field.datetime({ label: '最近复验时间', readonly: true }), remarks: remarks(),
}, ['acceptance_id', 'category', 'name', 'criterion', 'result', 'evidence_ref', 'verified_at']);

export const AcceptanceRectification = master('forge_acceptance_rectification', '验收整改项', 'rotate-ccw', {
  name: text('整改事项', true), code: code('整改编号'), acceptance_id: reference('forge_customer_acceptance', '客户验收单', true),
  acceptance_item_id: reference('forge_customer_acceptance_item', '来源验收项', true), owner_id: owner(true), due_on: Field.date({ label: '要求完成日期', ...required }),
  issue_description: Field.textarea({ label: '问题描述', ...required }), corrective_action: Field.textarea({ label: '整改措施' }),
  closure_evidence_ref: text('关闭证据编号/文件引用'), status: select('整改状态', [['open', '待整改'], ['closed', '已关闭']], 'open', true),
  closed_at: Field.datetime({ label: '关闭时间', readonly: true }), verified_by: Field.user({ label: '复核人' }), verified_at: Field.datetime({ label: '复核时间', readonly: true }), remarks: remarks(),
}, ['code', 'acceptance_id', 'acceptance_item_id', 'owner_id', 'due_on', 'status', 'closure_evidence_ref', 'closed_at']);
