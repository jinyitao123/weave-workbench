import { Field } from '@objectstack/spec/data';
import { master, text, code, reference, owner, remarks, required } from '../model.js';

const amount = (label: string) => Field.currency({ label, precision: 18, scale: 4 });
const count = (label: string) => Field.number({ label, min: 0, scale: 0, defaultValue: 0, readonly: true });

export const BankStatementImportBatch = master('forge_bank_statement_import_batch', '银行对账文件批次', 'file-up', {
  name: text('批次名称', true), code: code('批次编号'), account_id: reference('forge_fund_account', '资金账户', true),
  file_name: text('文件名', true), content_signature: text('内容签名', true), period_start: Field.date({ label: '账单开始日期', ...required }),
  period_end: Field.date({ label: '账单结束日期', ...required }), statement_opening_balance: amount('银行期初余额'),
  statement_closing_balance: amount('银行期末余额'), calculated_closing_balance: { ...amount('文件计算期末余额'), readonly: true },
  income_total: { ...amount('收入合计'), readonly: true }, expense_total: { ...amount('支出合计'), readonly: true },
  book_opening_balance: { ...amount('导入时账面余额'), readonly: true }, book_closing_balance: { ...amount('对账时账面余额'), readonly: true },
  balance_difference: { ...amount('银行与账面差额'), readonly: true }, row_count: count('总行数'), ready_count: count('可生成行数'),
  duplicate_count: count('重复行数'), error_count: count('错误行数'),
  status: { ...Field.select([
    { value: 'staged', label: '待生成流水' }, { value: 'needs_review', label: '需修正' }, { value: 'posted', label: '已生成流水' },
    { value: 'cancelled', label: '已取消' }, { value: 'reversed', label: '已撤回' },
  ], { label: '批次状态', defaultValue: 'staged' }), readonly: true },
  imported_by: Field.user({ label: '导入人', ...required, readonly: true }), imported_at: Field.datetime({ label: '导入时间', ...required, readonly: true }),
  posted_by: Field.user({ label: '生成人', readonly: true }), posted_at: Field.datetime({ label: '生成时间', readonly: true }),
  reversed_by: Field.user({ label: '撤回人', readonly: true }), reversed_at: Field.datetime({ label: '撤回时间', readonly: true }),
  reversal_reason: Field.textarea({ label: '取消或撤回原因', readonly: true }), responsible_id: owner(true), remarks: remarks(),
}, ['code', 'account_id', 'file_name', 'period_start', 'period_end', 'row_count', 'ready_count', 'duplicate_count', 'error_count', 'statement_closing_balance', 'balance_difference', 'status']);

export const BankStatementImportRow = master('forge_bank_statement_import_row', '银行对账文件明细', 'rows-3', {
  name: text('明细名称', true), code: code('明细编号'), batch_id: reference('forge_bank_statement_import_batch', '导入批次', true),
  line_no: Field.number({ label: '原文件行号', min: 2, scale: 0, ...required }), transacted_at: Field.datetime({ label: '交易时间' }),
  direction: Field.select([{ value: 'income', label: '收入' }, { value: 'expense', label: '支出' }], { label: '收支方向' }),
  flow_type: Field.select([
    { value: 'sales', label: '销售' }, { value: 'purchase', label: '采购' }, { value: 'refund', label: '退款' },
    { value: 'fee', label: '手续费' }, { value: 'transfer', label: '账户划转' }, { value: 'other', label: '其他' },
  ], { label: '流水类型', defaultValue: 'other' }),
  counterparty_name: text('对方单位'), amount: amount('交易金额'), bank_reference: text('银行参考号'), fingerprint: text('去重指纹', true),
  status: { ...Field.select([
    { value: 'ready', label: '可生成' }, { value: 'duplicate', label: '重复已跳过' }, { value: 'error', label: '校验错误' },
    { value: 'posted', label: '已生成流水' }, { value: 'reversed', label: '已撤回' },
  ], { label: '明细状态' }), readonly: true },
  transaction_id: reference('forge_bank_transaction', '资金流水'), validation_message: Field.textarea({ label: '校验说明', readonly: true }),
  responsible_id: owner(true), remarks: remarks(),
}, ['batch_id', 'line_no', 'transacted_at', 'direction', 'counterparty_name', 'amount', 'bank_reference', 'status', 'validation_message']);

export const BankBalanceReconciliation = master('forge_bank_balance_reconciliation', '银行余额对账', 'scale', {
  name: text('对账名称', true), code: code('对账编号'), batch_id: reference('forge_bank_statement_import_batch', '导入批次', true),
  account_id: reference('forge_fund_account', '资金账户', true), period_start: Field.date({ label: '账单开始日期', ...required }),
  period_end: Field.date({ label: '账单结束日期', ...required }), statement_opening_balance: amount('银行期初余额'),
  statement_closing_balance: amount('银行期末余额'), calculated_closing_balance: { ...amount('文件计算期末余额'), readonly: true },
  book_opening_balance: { ...amount('导入时账面余额'), readonly: true }, book_closing_balance: { ...amount('对账时账面余额'), readonly: true },
  difference_amount: { ...amount('银行与账面差额'), readonly: true },
  status: { ...Field.select([
    { value: 'balanced', label: '余额一致待确认' }, { value: 'discrepant', label: '存在差异' },
    { value: 'confirmed', label: '已确认一致' }, { value: 'difference_acknowledged', label: '差异已记录' }, { value: 'reversed', label: '批次已撤回' },
  ], { label: '对账状态' }), readonly: true },
  confirmed_by: Field.user({ label: '确认人', readonly: true }), confirmed_at: Field.datetime({ label: '确认时间', readonly: true }),
  confirmation_comment: Field.textarea({ label: '确认或差异说明', readonly: true }), responsible_id: owner(true), remarks: remarks(),
}, ['code', 'account_id', 'period_start', 'period_end', 'statement_closing_balance', 'book_closing_balance', 'difference_amount', 'status']);

export const BankStatementOperationLog = master('forge_bank_statement_operation_log', '银行对账文件操作记录', 'history', {
  name: text('记录名称', true), event_key: code('事件键'), batch_id: reference('forge_bank_statement_import_batch', '导入批次', true),
  reconciliation_id: reference('forge_bank_balance_reconciliation', '余额对账'), action: Field.select([
    { value: 'staged', label: '暂存文件' }, { value: 'posted', label: '生成银行流水' }, { value: 'cancelled', label: '取消批次' },
    { value: 'reversed', label: '撤回批次' }, { value: 'confirmed', label: '确认余额一致' }, { value: 'difference_acknowledged', label: '记录余额差异' },
  ], { label: '动作', ...required }),
  from_status: text('原状态'), to_status: text('新状态'), row_count: Field.number({ label: '涉及行数', min: 0, scale: 0, defaultValue: 0 }),
  amount: amount('金额'), comment: Field.textarea({ label: '说明' }), occurred_at: Field.datetime({ label: '操作时间', ...required, readonly: true }),
  operator_id: Field.user({ label: '操作人', ...required, readonly: true }),
}, ['event_key', 'batch_id', 'reconciliation_id', 'action', 'from_status', 'to_status', 'row_count', 'amount', 'operator_id', 'occurred_at']);
