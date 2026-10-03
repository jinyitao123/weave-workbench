import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { canonicalJSON, digest, TaskConnectionFailure } from './native-task-auth.js';

export type OrderRow = Record<string, unknown>;
export const roundedMoney = (value: number): number => Math.round((value + Number.EPSILON) * 10000) / 10000;
export function moneyValue(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1e12 || roundedMoney(number) !== number) throw new Error(`${label}必须是有效的非负金额，最多四位小数`);
  return number;
}
export function calendarDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw new Error(`${label}必须是有效的日历日期`);
  return value;
}

export function requiredPrepayment(contract: OrderRow): number {
  if (contract.order_payment_requirement === 'none') return 0;
  if (contract.order_payment_requirement !== 'prepayment') throw new Error('请由合同负责人先确认下单付款条件');
  const amount = moneyValue(contract.order_prepayment_amount, '下单预付款');
  if (amount <= 0 || amount > moneyValue(contract.total_amount, '合同金额')) throw new Error('下单预付款必须大于零且不超过合同金额');
  return amount;
}

export async function confirmedContractPrepayments(engine: IObjectQLEngine, contract: OrderRow, context: ExecutionContext, orderId?: string) {
  const rows = await engine.find('forge_customer_prepayment', { where: { contract_id: contract.id, organization_id: contract.organization_id }, limit: 1001 }, { context });
  if (rows.length > 1000) throw new TaskConnectionFailure(503, 'CONTRACT_PREPAYMENT_INCOMPLETE', '预付款清单暂不可完整核对');
  const usable = rows.filter(row => row.customer_id === contract.customer_id && row.confirmed_by && row.confirmed_at
    && ['active', 'partially_used'].includes(String(row.status)) && (!row.order_id || row.order_id === orderId));
  let total = 0;
  for (const row of usable) {
    const original = moneyValue(row.original_amount, '预收金额'), offset = moneyValue(row.offset_amount || 0, '已冲抵金额'), refunded = moneyValue(row.refunded_amount || 0, '已退款金额');
    const balance = moneyValue(row.balance_amount, '预收款余额');
    if (roundedMoney(original - offset - refunded) !== balance) throw new Error('预收款余额与原额、冲抵和退款记录不一致');
    const receipt = await engine.findOne('forge_cash_receipt', { where: { id: row.receipt_id, organization_id: contract.organization_id } }, { context });
    if (!receipt || receipt.customer_id !== contract.customer_id || receipt.status !== 'allocated' || moneyValue(receipt.amount, '到账金额') !== original) throw new Error('预收款确认没有匹配的到账流水');
    const refunds = await engine.find('forge_customer_refund', { where: { prepayment_id: row.id, organization_id: contract.organization_id }, limit: 1001 }, { context });
    if (refunds.length > 1000) throw new Error('退款占用不可完整核对');
    const reserved = roundedMoney(refunds.filter(r => ['pending_review', 'approved', 'pending_writeoff'].includes(String(r.document_status))).reduce((sum, r) => sum + moneyValue(r.requested_amount, '退款占用'), 0));
    if (reserved > balance) throw new Error('退款占用超过可用预收余额');
    total = roundedMoney(total + balance - reserved);
  }
  return { rows: usable, total };
}

export async function assertContractOrderReady(engine: IObjectQLEngine, contract: OrderRow, context: ExecutionContext, orderId?: string) {
  if (contract.status !== 'active' || !contract.signed_on || !contract.signed_evidence_attachment) throw new Error('合同必须完成内部复核并归档签署凭证');
  const required = requiredPrepayment(contract), confirmed = await confirmedContractPrepayments(engine, contract, context, orderId);
  if (confirmed.total < required) throw new Error('合同下单预付款尚未足额独立确认');
  return { required, ...confirmed };
}

export async function salesOrderDigest(engine: IObjectQLEngine, order: OrderRow, context: ExecutionContext): Promise<string> {
  const lines = await engine.find('forge_sales_order_line', { where: { order_id: order.id, organization_id: order.organization_id }, orderBy: [{ field: 'id', order: 'asc' }], limit: 1001 }, { context });
  if (!lines.length || lines.length > 1000) throw new Error('订单明细不可完整核对');
  const fields = ['id', 'customer_id', 'contract_id', 'quotation_id', 'source_type', 'planned_delivery_on', 'payment_term', 'payment_method', 'total_amount', 'responsible_id'];
  return digest(canonicalJSON({ record: Object.fromEntries(fields.map(key => [key, order[key] ?? null])),
    lines: lines.map(line => Object.fromEntries(['id', 'contract_line_id', 'quotation_line_id', 'line_type', 'sku_id', 'quantity', 'taxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal'].map(key => [key, line[key] ?? null]))) }));
}
