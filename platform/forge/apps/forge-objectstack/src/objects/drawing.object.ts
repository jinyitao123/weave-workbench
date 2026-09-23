import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, remarks, required } from '../model.js';

const select = (label: string, options: Array<[string, string]>, defaultValue?: string) => Field.select(
  options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
  { label, ...(defaultValue ? { defaultValue } : {}) },
);

const drawingTypes: Array<[string, string]> = [
  ['assembly','装配图'],['part','零件图'],['electrical','电气图'],['schematic','原理图'],['layout','布置图'],['installation','安装图'],
  ['construction','施工图'],['pid','P&ID图'],['control','控制图'],['network_topology','网络拓扑图'],['flowchart','流程图'],['manual','说明书'],
  // Preserve values used by historical Forge records while new entry follows the current RISEMAP list.
  ['process','工艺图'],['foundation','基础图'],['piping','管路图'],['software','软件图'],['inspection','检验图'],['packaging','包装图'],['other','其他'],
];
const drawingCategories: Array<[string, string]> = [
  ['mechanical','机械图'],['electrical','电气图'],['hydraulic','液压图'],['pneumatic','气动图'],['pid','P&ID图'],['civil','土建图'],['control','控制图'],['purchased','外购件图'],['subcontract','外协件图'],['reference','参考图'],
  // Legacy Forge categories remain readable for existing records.
  ['product','产品图纸'],['project','项目图纸'],['process','工艺图纸'],['equipment','设备图纸'],['tooling','工装图纸'],['quality','质量图纸'],['supplier','供应商图纸'],['customer','客户图纸'],['standard','标准图纸'],['other','其他'],
];

// RM-073: the drawing number archive is the aggregate root for version, review, release, change and distribution.
export const Drawing = master('forge_drawing', '图号档案', 'ruler', {
  name: text('图纸名称', true), short_name: text('图纸简称'), code: code('图号'), drawing_type: select('图纸类型', drawingTypes), category: select('图纸分类', drawingCategories),
  folder: text('所属文件夹'), department: text('所属部门'), controlled: Field.boolean({ label: '受控图纸', defaultValue: false }),
  controlled_number: text('受控编号'), controlled_copies: Field.number({ label: '受控份数', min: 1, scale: 0 }),
  confidentiality: select('保密等级', [['normal','普通'],['secret','秘密'],['confidential','机密']], 'normal'),
  material_id: reference('forge_material', '关联物料'), project_id: reference('forge_project', '关联项目'), supplier_id: reference('forge_supplier', '关联供应商'),
  key_part: Field.boolean({ label: '关键件', defaultValue: false }), purchase_by_drawing: Field.boolean({ label: '按图采购', defaultValue: false }),
  allow_old_version_substitution: Field.boolean({ label: '允许旧版本替代', defaultValue: false }), substitution_condition: Field.textarea({ label: '替代条件说明' }),
  incoming_inspection: Field.boolean({ label: '来料质检', defaultValue: false }), first_article_confirmation: Field.boolean({ label: '首件确认', defaultValue: false }),
  subcontractable: Field.boolean({ label: '可外协', defaultValue: false }), batch_traceable: Field.boolean({ label: '批次追溯', defaultValue: false }),
  current_version_id: reference('forge_drawing_version', '当前版本'), current_version: { ...text('当前版本号'), readonly: true },
  status: { ...select('状态', [['draft','草稿'],['reviewing','评审中'],['released','已发布'],['obsolete','已作废'],['archived','已归档']], 'draft'), readonly: true },
  allow_print: Field.boolean({ label: '允许打印', defaultValue: true }), allow_download: Field.boolean({ label: '允许下载', defaultValue: true }), watermark_required: Field.boolean({ label: '强制水印', defaultValue: false }),
  version_required: Field.boolean({ label: '强制版本控制', defaultValue: true }), release_required: Field.boolean({ label: '发布后使用', defaultValue: true }), receipt_required: Field.boolean({ label: '发放需回执', defaultValue: false }),
  external_share_allowed: Field.boolean({ label: '允许外发', defaultValue: false }), change_required: Field.boolean({ label: '变更需申请', defaultValue: true }), remarks: remarks(),
}, ['code','name','drawing_type','category','current_version','status','controlled','confidentiality','project_id']);

export const DrawingVersion = master('forge_drawing_version', '图纸版本', 'files', {
  name: text('版本名称', true), drawing_id: reference('forge_drawing', '图号档案', true), version: text('版本号', true), file_name: text('主文件名', true), file_uri: text('文件地址'), file_hash: text('文件摘要'),
  status: { ...select('状态', [['draft','草稿'],['pending_review','待评审'],['reviewed','评审通过'],['pending_release','待发布'],['released','已发布'],['superseded','已替代'],['rejected','已退回']], 'draft'), readonly: true },
  change_summary: Field.textarea({ label: '版本说明' }), created_by: Field.user({ label: '创建人' }), reviewed_at: Field.datetime({ label: '评审通过时间', readonly: true }), released_at: Field.datetime({ label: '发布时间', readonly: true }), remarks: remarks(),
}, ['drawing_id','version','file_name','status','reviewed_at','released_at']);

export const DrawingReview = master('forge_drawing_review', '图纸评审', 'clipboard-check', {
  name: text('评审主题', true), code: code('评审单号'), drawing_id: reference('forge_drawing', '图号档案', true), version_id: reference('forge_drawing_version', '评审版本', true),
  discipline: select('专业', [['mechanical','机械'],['electrical','电气'],['process','工艺'],['quality','质量'],['project','项目'],['other','其他']]), due_on: Field.date({ label: '截止日期' }), participant_ids: text('参与人'),
  status: { ...select('状态', [['draft','草稿'],['pending','待评审'],['approved','已通过'],['rejected','已退回'],['cancelled','已取消']], 'draft'), readonly: true },
  decision_note: Field.textarea({ label: '评审意见' }), submitted_at: Field.datetime({ label: '提交时间', readonly: true }), completed_at: Field.datetime({ label: '完成时间', readonly: true }), remarks: remarks(),
}, ['code','name','drawing_id','version_id','discipline','due_on','status']);

export const DrawingRelease = master('forge_drawing_release', '图纸发布', 'send', {
  name: text('发布主题', true), code: code('发布单号'), drawing_id: reference('forge_drawing', '图号档案', true), version_id: reference('forge_drawing_version', '发布版本', true),
  release_scope: select('发布范围', [['internal','内部'],['project','项目'],['procurement','采购'],['production','生产'],['supplier','供应商'],['customer','客户']]), major_change: Field.boolean({ label: '重大变更', defaultValue: false }), suggested_effective_on: Field.date({ label: '建议生效日期' }), impact_summary: Field.textarea({ label: '影响说明' }),
  status: { ...select('状态', [['draft','草稿'],['pending','待审核'],['approved','已审核'],['released','已发布'],['cancelled','已取消']], 'draft'), readonly: true },
  submitted_at: Field.datetime({ label: '提交时间', readonly: true }), approved_at: Field.datetime({ label: '审核时间', readonly: true }), released_at: Field.datetime({ label: '发布时间', readonly: true }), cancelled_at: Field.datetime({ label: '取消时间', readonly: true }), cancelled_by: Field.user({ label: '取消人', readonly: true }), cancel_reason: Field.textarea({ label: '取消原因', readonly: true }), remarks: remarks(),
}, ['code','drawing_id','version_id','release_scope','major_change','suggested_effective_on','status','released_at']);

export const DrawingChange = master('forge_drawing_change', '图纸变更', 'git-pull-request-arrow', {
  name: text('变更主题', true), code: code('变更单号'), drawing_id: reference('forge_drawing', '图号档案', true), source_version_id: reference('forge_drawing_version', '原生效版本', true), target_version_id: reference('forge_drawing_version', '变更后版本'),
  change_type: select('变更类型', [['design','设计'],['process','工艺'],['material','材料'],['specification','规格'],['customer','客户'],['procurement_substitution','采购替代'],['urgent','紧急'],['temporary','临时']]),
  change_level: select('变更等级', [['minor','一般变更'],['major','重大变更']], 'minor'), urgent: Field.boolean({ label: '紧急变更', defaultValue: false }),
  reason: Field.textarea({ label: '变更原因', ...required }), affects_bom: Field.boolean({ label: '影响BOM', defaultValue: false }), affects_procurement: Field.boolean({ label: '影响采购', defaultValue: false }), affects_production: Field.boolean({ label: '影响生产', defaultValue: false }), affects_inventory: Field.boolean({ label: '影响库存', defaultValue: false }), affects_quality: Field.boolean({ label: '影响质量', defaultValue: false }), affects_project: Field.boolean({ label: '影响项目', defaultValue: false }), impact_advice: Field.textarea({ label: '影响处理建议' }),
  status: { ...select('状态', [['draft','草稿'],['pending','待审批'],['approved','已批准'],['implementing','实施中'],['completed','已完成'],['rejected','已驳回'],['cancelled','已取消']], 'draft'), readonly: true },
  submitted_at: Field.datetime({ label: '提交时间', readonly: true }), approved_at: Field.datetime({ label: '批准时间', readonly: true }), completed_at: Field.datetime({ label: '完成时间', readonly: true }), remarks: remarks(),
}, ['code','name','drawing_id','change_type','change_level','urgent','source_version_id','target_version_id','status']);

export const DrawingDistribution = master('forge_drawing_distribution', '图纸发放记录', 'share-2', {
  name: text('发放主题', true), code: code('发放单号'), drawing_id: reference('forge_drawing', '图号档案', true), version_id: reference('forge_drawing_version', '发放版本'),
  purpose: select('用途', [['procurement','采购下发'],['subcontracting','外协加工'],['production','内部生产'],['quality','质检确认'],['service','售后支持'],['project','项目同步'],['other','其他']]),
  recipient_type: select('接收类型', [['department','内部部门'],['person','内部人员'],['supplier','供应商'],['customer','客户']]), recipient_name: text('接收对象', true),
  multi_recipient: Field.boolean({ label: '多对象接收', defaultValue: false }), require_all_confirmation: Field.boolean({ label: '需要全部确认', defaultValue: true }), cc_names: text('抄送对象'),
  method: select('发放方式', [['system','系统发送'],['email','邮件发送'],['print','导出打印'],['manual','手工传递'],['purchase_order','采购单附带']]),
  require_confirmation: Field.boolean({ label: '要求确认', defaultValue: true }), require_receipt: Field.boolean({ label: '要求回执', defaultValue: false }), receipt_due_on: Field.date({ label: '回执截止日期' }), receipt_requirement: Field.textarea({ label: '回执要求说明' }), restrict_download: Field.boolean({ label: '限制下载', defaultValue: false }), add_watermark: Field.boolean({ label: '加水印', defaultValue: false }), watermark_text: text('水印文字'),
  status: { ...select('发放状态', [['draft','草稿'],['pending','待发放'],['sent','已发放'],['cancelled','已取消']], 'draft'), readonly: true }, confirmation_status: { ...select('确认状态', [['pending','待确认'],['partial','部分已确认'],['confirmed','全部已确认']], 'pending'), readonly: true }, receipt_status: { ...select('回执状态', [['not_required','无需回执'],['pending','待回执'],['received','已回执']], 'not_required'), readonly: true },
  recipient_count: Field.number({ label: '接收对象数', min: 0, scale: 0, defaultValue: 0, readonly: true }), confirmed_count: Field.number({ label: '已确认数', min: 0, scale: 0, defaultValue: 0, readonly: true }), confirmation_required_count: Field.number({ label: '确认达标数', min: 0, scale: 0, defaultValue: 0, readonly: true }), confirmation_satisfied: Field.boolean({ label: '确认要求已满足', defaultValue: false, readonly: true }), receipt_count: Field.number({ label: '已回执数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  sent_at: Field.datetime({ label: '发放时间', readonly: true }), confirmed_at: Field.datetime({ label: '确认时间', readonly: true }), remarks: remarks(),
}, ['code','drawing_id','version_id','recipient_name','recipient_type','method','status','confirmation_status','receipt_status','sent_at']);

// RM-078 exposes multi-recipient delivery and an optional all-recipient confirmation threshold.
export const DrawingDistributionRecipient = master('forge_drawing_distribution_recipient', '图纸发放接收对象', 'users', {
  name: text('接收对象', true), code: code('接收编号'), distribution_id: reference('forge_drawing_distribution', '发放单', true),
  recipient_type: select('接收类型', [['department','内部部门'],['person','内部人员'],['supplier','供应商'],['customer','客户']]), organization: text('所属单位或部门'), contact: text('联系方式'),
  confirmation_status: { ...select('确认状态', [['pending','待确认'],['confirmed','已确认'],['not_required','无需确认']], 'pending'), readonly: true }, receipt_status: { ...select('回执状态', [['pending','待回执'],['received','已回执'],['not_required','无需回执']], 'not_required'), readonly: true },
  confirmed_at: Field.datetime({ label: '确认时间', readonly: true }), confirmed_by: Field.user({ label: '确认人', readonly: true }), receipt_note: Field.textarea({ label: '回执说明', readonly: true }), remarks: remarks(),
}, ['distribution_id','name','recipient_type','organization','confirmation_status','receipt_status','confirmed_at']);

export const CustomerDrawing = master('forge_customer_drawing', '客户图纸', 'file-input', {
  name: text('图纸名称', true), code: code('客户图号'), customer_id: { ...reference('forge_customer', '客户名称', true), relatedList: false }, version: { ...text('版本'), defaultValue: 'V1' },
  contact: text('联系人'), contract_number: text('合同号'), order_number: text('订单号'), received_on: Field.date({ label: '接收日期' }), valid_until: Field.date({ label: '有效期' }),
  confidentiality: select('保密等级', [['general','一般'],['confidential','机密'],['top_secret','绝密']], 'general'), usage_scope: select('使用范围', [['project_only','仅限本项目'],['cross_project','可跨项目使用'],['named_people','仅限指定人员']], 'project_only'),
  customer_original_files: Field.file({ label: '客户原图', multiple: true, description: 'RISEMAP RM-080：不限格式，可直接上传压缩包。' }),
  pdf_file: Field.file({ label: 'PDF 文件', accept: ['application/pdf', '.pdf'], description: 'RISEMAP RM-080：仅支持一个 PDF 文件。' }),
  technical_requirement_file: Field.file({ label: '技术要求', accept: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pdf', '.doc', '.docx'], description: 'RISEMAP RM-080：支持一个 PDF、DOC 或 DOCX 文件。' }),
  other_attachment_file: Field.file({ label: '其他附件', accept: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/*', 'application/zip', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.zip', '.rar', '.7z'], description: 'RISEMAP RM-080：支持一个 PDF、Word、Excel、图片或压缩包。' }),
  internal_drawing_id: reference('forge_drawing', '关联内部图号'), status: select('状态', [['draft','草稿'],['valid','有效'],['invalid','作废'],['expired','已过期']], 'draft'), remarks: remarks(),
}, ['code','name','customer_id','confidentiality','usage_scope','version','status','received_on']);

export const DrawingOperationLog = master('forge_drawing_operation_log', '图纸操作日志', 'history', {
  name: text('日志名称', true), event_key: code('事件编号'), drawing_id: reference('forge_drawing', '图号档案', true), related_object: text('关联对象'), related_id: text('关联记录'), action: text('动作'), actor_id: Field.user({ label: '操作人', ...required }), occurred_at: Field.datetime({ label: '操作时间', ...required }), from_status: text('原状态'), to_status: text('新状态'), comment: Field.textarea({ label: '说明' }),
}, ['occurred_at','drawing_id','related_object','action','actor_id','from_status','to_status','comment']);

// RM-079 supports forward inspection from a drawing into its business references.
// The version snapshot is immutable: downstream documents keep the version they actually used.
export const DrawingBusinessLink = master('forge_drawing_business_link', '图纸业务关联', 'link', {
  name: text('关联名称', true), code: code('关联编号'), drawing_id: reference('forge_drawing', '图号档案', true), version_id: reference('forge_drawing_version', '冻结版本', true),
  frozen_version: { ...text('冻结版本号', true), readonly: true }, link_type: select('关联类型', [['material','物料'],['bom','BOM'],['project','项目'],['purchase_order','采购订单'],['assembly_order','组装单']]),
  material_id: reference('forge_material', '关联物料'), bom_id: reference('forge_bom', '关联BOM'), project_id: reference('forge_project', '关联项目'), purchase_order_id: reference('forge_purchase_order', '关联采购订单'), assembly_order_id: reference('forge_assembly_order', '关联组装单'),
  target_code: { ...text('对象编号'), readonly: true }, target_name: { ...text('对象名称'), readonly: true }, purpose: Field.textarea({ label: '使用目的' }),
  status: { ...select('关联状态', [['active','使用中'],['needs_review','待版本复核'],['replaced','已替代'],['obsolete','已解除']], 'active'), readonly: true },
  frozen_at: Field.datetime({ label: '冻结时间', readonly: true }), frozen_by: Field.user({ label: '冻结人', readonly: true }), replaced_by_link_id: reference('forge_drawing_business_link', '替代关联'), obsolete_reason: Field.textarea({ label: '解除原因', readonly: true }), remarks: remarks(),
}, ['drawing_id','frozen_version','link_type','target_code','target_name','status','frozen_at']);

export const DrawingChangeImpact = master('forge_drawing_change_impact', '图纸变更影响', 'scan-search', {
  name: text('影响项名称', true), change_id: reference('forge_drawing_change', '图纸变更', true), link_id: reference('forge_drawing_business_link', '来源关联', true), drawing_id: reference('forge_drawing', '图号档案', true),
  link_type: text('影响对象类型', true), target_code: text('对象编号'), target_name: text('对象名称'), frozen_version: text('原冻结版本', true),
  status: { ...select('处置状态', [['pending','待评估'],['adopt_new','采纳新版本'],['keep_old','保留旧版本'],['not_affected','确认不受影响'],['mitigated','已采取措施']], 'pending'), readonly: true },
  assessment: Field.textarea({ label: '影响评估', readonly: true }), resolved_at: Field.datetime({ label: '处置时间', readonly: true }), resolved_by: Field.user({ label: '处置人', readonly: true }),
}, ['change_id','link_type','target_code','target_name','frozen_version','status','resolved_at']);
