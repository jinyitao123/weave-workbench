import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, owner, remarks, required } from '../model.js';

const amount = (label: string) => Field.currency({ label, precision: 18, scale: 4, min: 0 });
const signedAmount = (label: string) => Field.currency({ label, precision: 18, scale: 4 });

export const FinancialPeriod = master('forge_financial_period', '财务期间', 'calendar-lock', {
  name: text('期间名称', true), code: code('期间编号'), account_id: reference('forge_fund_account', '资金账户', true),
  period_start: Field.date({ label: '开始日期', ...required }), period_end: Field.date({ label: '结束日期', ...required }),
  status: { ...Field.select([
    { value: 'open', label: '开放' }, { value: 'locked', label: '已锁定' }, { value: 'closed', label: '已关闭' },
  ], { label: '期间状态', defaultValue: 'open' }), readonly: true },
  transaction_count: { ...Field.number({ label: '银行流水数', min: 0, scale: 0, defaultValue: 0 }), readonly: true },
  incomplete_count: { ...Field.number({ label: '未完成勾兑数', min: 0, scale: 0, defaultValue: 0 }), readonly: true },
  locked_by: Field.user({ label: '锁定人', readonly: true }), locked_at: Field.datetime({ label: '锁定时间', readonly: true }),
  closed_by: Field.user({ label: '关闭人', readonly: true }), closed_at: Field.datetime({ label: '关闭时间', readonly: true }),
  reopened_by: Field.user({ label: '重新开放人', readonly: true }), reopened_at: Field.datetime({ label: '重新开放时间', readonly: true }),
  reopen_reason: Field.textarea({ label: '重新开放原因', readonly: true }), responsible_id: owner(true), remarks: remarks(),
}, ['code', 'account_id', 'period_start', 'period_end', 'status', 'transaction_count', 'incomplete_count', 'locked_at', 'closed_at']);

export const FinancialPeriodLog = master('forge_financial_period_log', '财务期间操作记录', 'history', {
  name: text('记录名称', true), event_key: code('事件键'), period_id: reference('forge_financial_period', '财务期间', true),
  action: Field.select([
    { value: 'created', label: '创建' }, { value: 'locked', label: '锁定' },
    { value: 'closed', label: '关闭' }, { value: 'reopened', label: '重新开放' },
  ], { label: '动作', ...required }), from_status: text('原状态'), to_status: text('新状态'),
  comment: Field.textarea({ label: '说明' }), occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }),
  operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['event_key', 'period_id', 'action', 'from_status', 'to_status', 'comment', 'operator_id', 'occurred_at']);

export const BankTransaction = master('forge_bank_transaction', '银行流水', 'landmark', {
  name: text('流水名称', true), code: code('流水号'), account_id: reference('forge_fund_account', '资金账户', true),
  transacted_at: Field.datetime({ label: '交易时间', ...required }), direction: Field.select([
    { value: 'income', label: '收入' }, { value: 'expense', label: '支出' },
  ], { label: '收支方向', ...required }),
  flow_type: Field.select([
    { value: 'sales', label: '销售' }, { value: 'purchase', label: '采购' }, { value: 'refund', label: '退款' },
    { value: 'fee', label: '手续费' }, { value: 'transfer', label: '账户划转' }, { value: 'other', label: '其他' },
  ], { label: '流水类型', defaultValue: 'other', ...required }),
  counterparty_name: text('对方单位'), amount: amount('银行金额'), matched_amount: { ...amount('已勾兑金额'), readonly: true },
  difference_amount: { ...signedAmount('差额'), readonly: true },
  status: { ...Field.select([
    { value: 'unmatched', label: '未勾兑' }, { value: 'pending_review', label: '待审核' },
    { value: 'matched', label: '已勾兑' }, { value: 'discrepancy', label: '有差异' }, { value: 'voided', label: '已作废' },
  ], { label: '勾兑状态', defaultValue: 'unmatched' }), readonly: true },
  source: { ...Field.select([{ value: 'manual', label: '手工录入' }, { value: 'import', label: '文件导入' }], { label: '流水来源', defaultValue: 'manual' }), readonly: true },
  source_batch_key: text('来源批次'), source_row_key: text('来源行键'), bank_reference: text('银行参考号'),
  created_by: Field.user({ label: '登记人', ...required, readonly: true }), voided_by: Field.user({ label: '作废人', readonly: true }),
  voided_at: Field.datetime({ label: '作废时间', readonly: true }), void_reason: Field.textarea({ label: '作废原因', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['code', 'transacted_at', 'account_id', 'counterparty_name', 'direction', 'flow_type', 'amount', 'matched_amount', 'difference_amount', 'status', 'source', 'bank_reference']);

export const BankTransactionMatch = master('forge_bank_transaction_match', '银行勾兑记录', 'badge-check', {
  name: text('勾兑名称', true), code: code('勾兑编号'), transaction_id: reference('forge_bank_transaction', '银行流水', true),
  direction: Field.select([{ value: 'income', label: '收入' }, { value: 'expense', label: '支出' }], { label: '收支方向', ...required }),
  receipt_id: reference('forge_cash_receipt', '账面收款'), payment_id: reference('forge_cash_payment', '账面付款'),
  bank_amount: amount('银行金额'), book_amount: amount('账面金额'), difference_amount: signedAmount('差额'),
  matched_on: Field.date({ label: '勾兑日期', ...required }),
  status: { ...Field.select([
    { value: 'pending_review', label: '待审核' }, { value: 'discrepancy', label: '有差异' },
    { value: 'approved', label: '已勾兑' }, { value: 'cancelled', label: '已取消' }, { value: 'reversed', label: '已反审核' },
  ], { label: '勾兑状态', defaultValue: 'pending_review' }), readonly: true },
  matched_by: Field.user({ label: '勾兑人', ...required, readonly: true }), reviewed_by: Field.user({ label: '审核人', readonly: true }),
  reviewed_at: Field.datetime({ label: '审核时间', readonly: true }), review_comment: Field.textarea({ label: '审核意见', readonly: true }),
  reversed_by: Field.user({ label: '取消或反审核人', readonly: true }), reversed_at: Field.datetime({ label: '取消或反审核时间', readonly: true }),
  reversal_reason: Field.textarea({ label: '取消或反审核原因', readonly: true }), responsible_id: owner(true), remarks: remarks(),
}, ['code', 'transaction_id', 'direction', 'receipt_id', 'payment_id', 'bank_amount', 'book_amount', 'difference_amount', 'matched_on', 'status', 'matched_by', 'reviewed_by']);

export const BankTransactionLog = master('forge_bank_transaction_log', '银行流水操作记录', 'history', {
  name: text('记录名称', true), event_key: code('事件键'), transaction_id: reference('forge_bank_transaction', '银行流水', true),
  match_id: reference('forge_bank_transaction_match', '勾兑记录'), action: Field.select([
    { value: 'registered', label: '登记流水' }, { value: 'matched', label: '发起勾兑' }, { value: 'approved', label: '审核通过' },
    { value: 'cancelled', label: '取消勾兑' }, { value: 'match_reversed', label: '勾兑反审核' }, { value: 'voided', label: '作废流水' },
  ], { label: '动作', ...required }),
  amount: amount('金额'), from_status: text('原状态'), to_status: text('新状态'), comment: Field.textarea({ label: '说明' }),
  occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }), operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['event_key', 'transaction_id', 'match_id', 'action', 'amount', 'from_status', 'to_status', 'comment', 'operator_id', 'occurred_at']);
