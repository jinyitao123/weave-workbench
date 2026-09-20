import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, owner, remarks, required } from '../model.js';

const select = (label: string, options: Array<[string, string]>, defaultValue?: string) => Field.select(
  options.map(([value, optionLabel]) => ({ value, label: optionLabel })),
  { label, ...(defaultValue ? { defaultValue } : {}) },
);
const quantity = (label: string, readonly = false) => Field.number({ label, min: 0, scale: 4, defaultValue: 0, ...(readonly ? { readonly: true } : {}) });
const money = (label: string, readonly = false) => Field.currency({ label, precision: 18, scale: 4, min: 0, defaultValue: 0, ...(readonly ? { readonly: true } : {}) });

// RISEMAP /inventory/ncr exposes seven list-filter values. This bounded
// subcontract slice implements the four physical dispositions selected for the
// replication sequence; supplier compensation remains a separate finance slice.
export const SubcontractNcr = master('forge_subcontract_ncr', '委外不合格处理单', 'triangle-alert', {
  name: text('不合格单名称', true), code: code('NCR 单号'), source_type: select('来源类型', [['subcontract_receipt','委外回厂']]),
  receipt_id: reference('forge_subcontract_receipt', '来源回厂单', true), receipt_line_id: reference('forge_subcontract_receipt_line', '来源回厂明细', true),
  order_id: reference('forge_subcontract_order', '委外订单', true), supplier_id: reference('forge_supplier', '供应商', true),
  sku_id: reference('forge_material_sku', '物料规格', true), warehouse_id: reference('forge_warehouse', '处置仓库', true),
  source_no: text('来源单据号', true), item_code: text('物料编码', true), specification: text('规格'), unit_name: text('单位', true),
  defective_quantity: quantity('不合格数量', true), defect_level: select('缺陷等级', [['critical','致命'],['major','严重'],['minor','轻微']], 'major'),
  defect_type: text('缺陷类型', true), defect_description: Field.textarea({ label: '不合格描述', ...required }),
  disposition: select('处置方式', [['return','退货'],['concession','特采'],['scrap','报废'],['rework','返工']]),
  disposition_quantity: quantity('处置数量'), responsible_party: select('责任方', [['supplier','供应商'],['internal','内部']]),
  disposition_reason: Field.textarea({ label: '处置说明' }), concession_scope: text('特采适用范围'),
  concession_valid_until: Field.date({ label: '特采有效期' }), commercial_terms: Field.textarea({ label: '商务条款' }), loss_amount: money('最终损失'),
  accepted_quantity: quantity('特采入库数量', true), returned_quantity: quantity('退货数量', true), scrapped_quantity: quantity('报废数量', true), rework_quantity: quantity('返工数量', true),
  inbound_id: reference('forge_subcontract_ncr_inbound', '关联特采入库单'), execution_result: Field.textarea({ label: '执行结果', readonly: true }),
  status: { ...select('NCR 状态', [['draft','待提交'],['pending_approval','审批中'],['approved','已通过'],['rejected','已驳回'],['executed','已执行'],['cancelled','已作废']], 'draft'), readonly: true },
  submitted_by: Field.user({ label: '提交人', readonly: true }), submitted_at: Field.datetime({ label: '提交时间', readonly: true }),
  reviewed_by: Field.user({ label: '审核人', readonly: true }), reviewed_at: Field.datetime({ label: '审核时间', readonly: true }), review_note: Field.textarea({ label: '审核意见', readonly: true }),
  executed_by: Field.user({ label: '执行人', readonly: true }), executed_at: Field.datetime({ label: '执行时间', readonly: true }), responsible_id: owner(true), remarks: remarks(),
}, ['code','source_no','item_code','supplier_id','defective_quantity','defect_level','disposition','status','inbound_id']);

export const SubcontractNcrInbound = master('forge_subcontract_ncr_inbound', '委外特采入库单', 'package-plus', {
  name: text('入库单名称', true), code: code('特采入库单号'), ncr_id: reference('forge_subcontract_ncr', '委外 NCR', true),
  receipt_id: reference('forge_subcontract_receipt', '来源回厂单', true), receipt_line_id: reference('forge_subcontract_receipt_line', '来源回厂明细', true),
  order_id: reference('forge_subcontract_order', '委外订单', true), supplier_id: reference('forge_supplier', '委外供应商', true),
  warehouse_id: reference('forge_warehouse', '入库仓库', true), sku_id: reference('forge_material_sku', '物料规格', true), source_no: text('来源单据号', true), item_code: text('物料编码', true),
  quantity: quantity('特采入库数量', true), unit_cost: money('入库单位成本', true), inventory_amount: money('入库金额', true),
  valuation_status: select('计价状态', [['zero_value_concession','零值特采']]), status: select('入库状态', [['stocked','已入库']]),
  stocked_by: Field.user({ label: '入库人', readonly: true }), stocked_at: Field.datetime({ label: '入库时间', readonly: true }), remarks: remarks(),
}, ['code','ncr_id','source_no','item_code','supplier_id','warehouse_id','quantity','unit_cost','inventory_amount','valuation_status','status']);

export const SubcontractNcrLog = master('forge_subcontract_ncr_log', '委外 NCR 操作记录', 'history', {
  name: text('记录名称', true), ncr_id: reference('forge_subcontract_ncr', '委外 NCR', true),
  action: select('操作', [['created','自动生成'],['configured','设置处置'],['submitted','提交审批'],['approved','审核通过'],['rejected','审核驳回'],['executed','执行处置']]),
  from_status: text('原状态'), to_status: text('新状态'), comment: Field.textarea({ label: '说明' }),
  occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['ncr_id','action','from_status','to_status','comment','operator_id','occurred_at']);
