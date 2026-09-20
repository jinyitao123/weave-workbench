import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, owner, remarks, required } from '../model.js';

const amount = (label: string) => Field.currency({ label, precision: 18, scale: 4, min: 0 });
const onboardingStatus = (label: string) => Field.select([
  { value: 'open', label: '待建账' }, { value: 'completed', label: '已完成' }, { value: 'skipped', label: '已跳过' },
], { label, defaultValue: 'open' });

// RM-134: activation date fixes the prior-day opening document date. Completion is onboarding progress,
// not a ledger lock: RISEMAP still exposes opening-balance management after completion.
export const AccountingOpeningSetup = master('forge_accounting_opening_setup', '期初往来建账', 'book-open-check', {
  name: text('建账名称', true), code: code('建账编号'), activation_on: Field.date({ label: '系统启用日期', ...required }),
  document_on: Field.date({ label: '期初单据日期', ...required }),
  receivable_status: { ...onboardingStatus('期初应收进度'), readonly: true }, payable_status: { ...onboardingStatus('期初应付进度'), readonly: true },
  receivable_closed_by: Field.user({ label: '应收确认人', readonly: true }), receivable_closed_at: Field.datetime({ label: '应收确认时间', readonly: true }),
  payable_closed_by: Field.user({ label: '应付确认人', readonly: true }), payable_closed_at: Field.datetime({ label: '应付确认时间', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'activation_on', 'document_on', 'receivable_status', 'payable_status', 'responsible_id']);

export const CounterpartyOffset = master('forge_counterparty_offset', '往来对冲单', 'arrow-left-right', {
  name: text('对冲名称', true), code: code('对冲编号'), receivable_id: reference('forge_accounts_receivable', '应收账款', true),
  payable_id: reference('forge_accounts_payable', '应付账款', true), customer_id: reference('forge_customer', '客户', true),
  supplier_id: reference('forge_supplier', '供应商', true), counterparty_name: text('往来单位名称', true),
  identity_basis: Field.select([{ value: 'credit_code', label: '统一社会信用代码一致' }, { value: 'normalized_name', label: '单位名称一致' }], { label: '主体判定依据', ...required, readonly: true }),
  amount: amount('对冲金额'), offset_on: Field.date({ label: '对冲日期', ...required }),
  status: { ...Field.select([
    { value: 'draft', label: '草稿' }, { value: 'pending_review', label: '待审核' }, { value: 'approved', label: '已审核' },
    { value: 'rejected', label: '已驳回' }, { value: 'reversed', label: '已撤回' },
  ], { label: '对冲状态', defaultValue: 'draft' }), readonly: true },
  applicant_id: Field.user({ label: '申请人', ...required, readonly: true }), submitted_at: Field.datetime({ label: '提交时间', readonly: true }),
  reviewer_id: Field.user({ label: '审核人', readonly: true }), reviewed_at: Field.datetime({ label: '审核时间', readonly: true }),
  review_comment: Field.textarea({ label: '审核意见', readonly: true }), reversed_by: Field.user({ label: '撤回人', readonly: true }),
  reversed_at: Field.datetime({ label: '撤回时间', readonly: true }), reversal_reason: Field.textarea({ label: '撤回原因', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'counterparty_name', 'identity_basis', 'receivable_id', 'payable_id', 'amount', 'offset_on', 'status', 'applicant_id', 'reviewer_id']);

export const AccountingOpeningLog = master('forge_accounting_opening_log', '期初建账与对冲记录', 'history', {
  name: text('记录名称', true), event_key: code('事件键'), setup_id: reference('forge_accounting_opening_setup', '期初建账'),
  offset_id: reference('forge_counterparty_offset', '往来对冲单'), action: Field.select([
    { value: 'receivable_created', label: '期初应收录入' }, { value: 'payable_created', label: '期初应付录入' },
    { value: 'onboarding_completed', label: '建账完成' }, { value: 'onboarding_skipped', label: '跳过建账' },
    { value: 'offset_created', label: '对冲单创建' }, { value: 'offset_submitted', label: '对冲单提交' },
    { value: 'offset_approved', label: '对冲审核通过' }, { value: 'offset_rejected', label: '对冲驳回' }, { value: 'offset_reversed', label: '对冲撤回' },
  ], { label: '动作', ...required }), direction: Field.select([{ value: 'receivable', label: '应收' }, { value: 'payable', label: '应付' }, { value: 'offset', label: '对冲' }], { label: '方向', ...required }),
  source_id: text('关联记录'), amount: amount('金额'), comment: Field.textarea({ label: '说明' }),
  occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['event_key', 'setup_id', 'offset_id', 'action', 'direction', 'source_id', 'amount', 'comment', 'operator_id', 'occurred_at']);
