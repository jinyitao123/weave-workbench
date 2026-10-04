import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, choice, remarks, required } from '../model.js';

const select = (label: string, options: Array<[string, string]>, defaultValue?: string) => Field.select(
  options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
  { label, ...(defaultValue ? { defaultValue } : {}) },
);
const lockedOutsideDraft = `record.bom_status != 'draft'`;

// DP014/2085 rejected an unnamed root; 2089-2092 establish persisted draft structure.
export const Bom = master('forge_bom', 'BOM管理', 'git-branch', {
  name: text('BOM名称', true), code: code('BOM编号'), product_name: text('产品/设备'),
  material_id: reference('forge_material', '成品物料'), bom_type: choice('BOM类型', ['标准', '项目', '试制'], '标准'),
  version: { ...text('当前版本'), defaultValue: 'V1.0', readonly: true }, family_key: { ...text('版本族编号'), readonly: true },
  source_bom_id: reference('forge_bom', '来源标准BOM'), project_id: reference('forge_project', '适用项目'), customer_id: { ...reference('forge_customer', '客户'), relatedList: false },
  status: { ...select('状态', [['draft', '草稿'], ['pending_review', '待评审'], ['active', '已生效'], ['inactive', '已失效'], ['archived', '已归档']], 'draft'), readonly: true },
  tax_rate: Field.number({ label: '成本税率', min: 0, max: 100, scale: 4, defaultValue: 13 }),
  node_count: Field.number({ label: '物料数', min: 0, scale: 0, defaultValue: 0, readonly: true }),
  total_cost: Field.currency({ label: '未税成本', precision: 18, scale: 2, min: 0, defaultValue: 0, readonly: true }),
  submitted_at: Field.datetime({ label: '提交评审时间', readonly: true }), submitted_by: Field.user({ label: '提交人', readonly: true }),
  effective_at: Field.datetime({ label: '生效时间', readonly: true }), approved_by: Field.user({ label: '评审人', readonly: true }),
  invalidated_at: Field.datetime({ label: '失效时间', readonly: true }), change_note: Field.textarea({ label: '版本变更说明' }), remarks: remarks(),
}, ['code', 'name', 'product_name', 'bom_type', 'version', 'status', 'project_id', 'node_count', 'total_cost', 'effective_at']);

export const BomNode = master('forge_bom_node', 'BOM结构', 'network', {
  name: { ...text('节点名称', true), readonlyWhen: lockedOutsideDraft }, bom_id: { ...reference('forge_bom', 'BOM', true), readonlyWhen: `record.id != null` },
  parent_id: { ...reference('forge_bom_node', '父节点'), readonlyWhen: lockedOutsideDraft },
  sku_id: { ...reference('forge_material_sku', '物料规格'), readonlyWhen: lockedOutsideDraft },
  node_type: { ...choice('节点类型', ['根节点', '物料', '分组', '子BOM'], '物料'), readonlyWhen: lockedOutsideDraft },
  quantity: Field.number({ label: '单机用量', defaultValue: 1, ...required, readonlyWhen: lockedOutsideDraft }),
  position: { ...text('位号'), readonlyWhen: lockedOutsideDraft },
  loss_rate: Field.number({ label: '损耗率', defaultValue: 0, readonlyWhen: lockedOutsideDraft }),
  is_key_part: Field.boolean({ label: '是否关键件', defaultValue: false, readonlyWhen: lockedOutsideDraft }),
  is_leaf: Field.boolean({ label: '是否末级件', defaultValue: true, readonlyWhen: lockedOutsideDraft }),
  sort_order: Field.number({ label: '排序', defaultValue: 0, readonlyWhen: lockedOutsideDraft }),
  bom_status: { ...select('BOM状态快照', [['draft', '草稿'], ['pending_review', '待评审'], ['active', '已生效'], ['inactive', '已失效']], 'draft'), readonly: true },
  remarks: { ...remarks(), readonlyWhen: lockedOutsideDraft },
}, ['name', 'bom_id', 'parent_id', 'sku_id', 'node_type', 'quantity', 'position', 'is_key_part', 'bom_status']);

export const BomApprovalLog = master('forge_bom_approval_log', 'BOM审批日志', 'history', {
  name: text('日志名称', true), event_key: code('日志编号'), bom_id: reference('forge_bom', 'BOM', true),
  action: select('动作', [['created', '创建'], ['submitted', '提交评审'], ['approved', '评审通过'], ['rejected', '评审退回'], ['copied', '复制新版本'], ['invalidated', '失效']]),
  actor_id: Field.user({ label: '操作人', ...required }), occurred_at: Field.datetime({ label: '操作时间', ...required }),
  from_status: text('原状态'), to_status: text('新状态'), comment: Field.textarea({ label: '说明' }),
}, ['occurred_at', 'bom_id', 'action', 'actor_id', 'from_status', 'to_status', 'comment']);
