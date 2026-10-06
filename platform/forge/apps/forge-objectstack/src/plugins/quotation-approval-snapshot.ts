import type { IObjectQLEngine, ISecurityService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { roundedMoney } from './sales-order-readiness.js';

export const QUOTATION_LINE_SNAPSHOT = 'submitted_line_snapshot';
type Row = Record<string, unknown>;
export interface QuotationSnapshotRow {
  position: number; name: string; lineType: 'material' | 'service'; quantity: number; taxedUnitPrice: number;
  taxRate: number; discountRate: number; taxedSubtotal: number; unitName?: string;
}
export interface QuotationLines {
  version: '1'; pricingVersion: number; itemCount: number; totalAmount: number; rows: QuotationSnapshotRow[];
}
interface StoredRow extends QuotationSnapshotRow { lineId: string; quotationId: string; organizationId: string }
interface StoredSnapshot extends Omit<QuotationLines, 'rows'> {
  submissionId: string; quotationId: string; organizationId: string; submittedBy: string; contentSha256: string; rows: StoredRow[];
}
export class QuotationSnapshotFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
function invalid(): never { throw new QuotationSnapshotFailure(409, 'APPROVAL_QUOTATION_LINES_INVALID', '报价审批冻结明细无法可靠核对，请保留原请求'); }
function row(value: unknown): Row | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined; }
function text(value: unknown, max = 128): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
}
function number(value: unknown, positive = false, maximum = Infinity): value is number {
  return typeof value === 'number' && Number.isFinite(value) && (positive ? value > 0 : value >= 0) && value <= maximum;
}
function exactKeys(value: Row, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) invalid(); }
export function approvalPayload(value: Row): Row | undefined {
  if (row(value.payload)) return row(value.payload);
  if (typeof value.payload_json !== 'string') return undefined;
  try { return row(JSON.parse(value.payload_json)); } catch { return undefined; }
}

/** Called only in quotation_submit's locked transaction. No cost field or
 * live query is part of an approval-context projection. */
export function freezeQuotationLines(quote: Row, lines: Row[], actorId: string, contentSha256: string): string {
  const ordered = [...lines].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)
    || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const snapshot: StoredSnapshot = { version: '1', submissionId: crypto.randomUUID(), quotationId: String(quote.id),
    organizationId: String(quote.organization_id), submittedBy: actorId, pricingVersion: Number(quote.pricing_version ?? 0),
    itemCount: Number(quote.item_count), totalAmount: Number(quote.total_amount), contentSha256,
    rows: ordered.map((line, index) => ({ lineId: String(line.id), quotationId: String(line.quotation_id), organizationId: String(line.organization_id),
      position: index + 1, name: String(line.name), lineType: line.line_type as StoredRow['lineType'], quantity: Number(line.quantity),
      taxedUnitPrice: Number(line.taxed_unit_price), taxRate: Number(line.tax_rate), discountRate: Number(line.discount_rate), taxedSubtotal: Number(line.taxed_subtotal),
      ...(line.unit_name ? { unitName: String(line.unit_name) } : {}) })) };
  const serialized = JSON.stringify(snapshot);
  parseQuotationLines({ object_name: 'forge_quotation', record_id: quote.id, organization_id: quote.organization_id, submitter_id: actorId,
    payload: { ...quote, submitted_by: actorId, submitted_pricing_version: snapshot.pricingVersion, submitted_content_sha256: contentSha256, [QUOTATION_LINE_SNAPSHOT]: serialized } });
  return serialized;
}

/** A missing field identifies the pre-snapshot requests. Any present but
 * malformed/inconsistent field is refused, never treated as an old request. */
export function parseQuotationLines(request: Row): QuotationLines | undefined {
  const payload = approvalPayload(request);
  if (!payload) invalid();
  const raw = payload[QUOTATION_LINE_SNAPSHOT];
  if (raw == null || raw === '') return undefined;
  if (request.object_name !== 'forge_quotation' || typeof raw !== 'string' || raw.length > 200_000) invalid();
  let snapshot: Row | undefined;
  try { snapshot = row(JSON.parse(raw)); } catch { invalid(); }
  if (!snapshot) invalid();
  exactKeys(snapshot, ['version', 'submissionId', 'quotationId', 'organizationId', 'submittedBy', 'pricingVersion', 'itemCount', 'totalAmount', 'contentSha256', 'rows']);
  if (snapshot.version !== '1' || !text(snapshot.submissionId) || !text(snapshot.quotationId) || !text(snapshot.organizationId) || !text(snapshot.submittedBy)
    || snapshot.quotationId !== request.record_id || snapshot.organizationId !== request.organization_id || snapshot.submittedBy !== request.submitter_id
    || payload.id !== snapshot.quotationId || payload.organization_id !== snapshot.organizationId || payload.submitted_by !== snapshot.submittedBy
    || !Number.isSafeInteger(snapshot.pricingVersion) || Number(snapshot.pricingVersion) < 0
    || Number(payload.pricing_version ?? 0) !== snapshot.pricingVersion || payload.submitted_pricing_version == null || Number(payload.submitted_pricing_version) !== snapshot.pricingVersion
    || typeof snapshot.contentSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(snapshot.contentSha256) || payload.submitted_content_sha256 !== snapshot.contentSha256
    || !Number.isInteger(snapshot.itemCount) || Number(snapshot.itemCount) < 1 || Number(snapshot.itemCount) > 100 || Number(payload.item_count) !== snapshot.itemCount
    || !number(snapshot.totalAmount) || !Number.isFinite(Number(payload.total_amount)) || Number(payload.total_amount) !== snapshot.totalAmount
    || !Array.isArray(snapshot.rows) || snapshot.rows.length !== snapshot.itemCount) invalid();
  const ids = new Set<string>(), projected: QuotationSnapshotRow[] = [];
  for (let index = 0; index < snapshot.rows.length; index++) {
    const line = row(snapshot.rows[index]); if (!line) invalid();
    exactKeys(line, ['lineId', 'quotationId', 'organizationId', 'position', 'name', 'lineType', 'quantity', 'taxedUnitPrice', 'taxRate', 'discountRate', 'taxedSubtotal', 'unitName']);
    if (!text(line.lineId) || ids.has(line.lineId) || line.quotationId !== snapshot.quotationId || line.organizationId !== snapshot.organizationId
      || line.position !== index + 1 || !text(line.name, 255) || !['material', 'service'].includes(String(line.lineType))
      || !number(line.quantity, true) || !number(line.taxedUnitPrice) || !number(line.taxRate, false, 100) || !number(line.discountRate, false, 100)
      || !number(line.taxedSubtotal) || roundedMoney(line.quantity * line.taxedUnitPrice * (1 - line.discountRate / 100)) !== line.taxedSubtotal
      || line.unitName !== undefined && !text(line.unitName, 128)) invalid();
    ids.add(line.lineId);
    projected.push({ position: line.position as number, name: line.name, lineType: line.lineType as QuotationSnapshotRow['lineType'], quantity: line.quantity,
      taxedUnitPrice: line.taxedUnitPrice, taxRate: line.taxRate, discountRate: line.discountRate, taxedSubtotal: line.taxedSubtotal,
      ...(line.unitName !== undefined ? { unitName: line.unitName as string } : {}) });
  }
  if (roundedMoney(projected.reduce((sum, line) => sum + line.taxedSubtotal, 0)) !== snapshot.totalAmount) invalid();
  return { version: '1', pricingVersion: snapshot.pricingVersion as number, itemCount: snapshot.itemCount as number, totalAmount: snapshot.totalAmount, rows: projected };
}

export async function projectQuotationLines(request: Row, security: ISecurityService | undefined, context: ExecutionContext): Promise<QuotationLines | undefined> {
  if (!security?.canReadObject || !security.getReadableFields) throw new QuotationSnapshotFailure(503, 'APPROVAL_QUOTATION_PERMISSION_UNAVAILABLE', '报价审批字段权限暂不可可靠核对');
  const [headerAllowed, lineAllowed, headerFields, lineFields] = await Promise.all([
    security.canReadObject('forge_quotation', context), security.canReadObject('forge_quotation_line', context),
    security.getReadableFields('forge_quotation', context), security.getReadableFields('forge_quotation_line', context),
  ]);
  if (!headerAllowed || !lineAllowed) throw new QuotationSnapshotFailure(403, 'APPROVAL_QUOTATION_FIELDS_FORBIDDEN', '当前员工无权读取报价审批所需明细');
  if (!Array.isArray(headerFields) || !Array.isArray(lineFields)) throw new QuotationSnapshotFailure(503, 'APPROVAL_QUOTATION_PERMISSION_UNAVAILABLE', '报价审批字段权限暂不可可靠核对');
  if (![QUOTATION_LINE_SNAPSHOT, 'pricing_version', 'submitted_pricing_version', 'item_count', 'total_amount'].every(field => headerFields.includes(field))
    || !['name', 'line_type', 'quantity', 'taxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal'].every(field => lineFields.includes(field))) throw new QuotationSnapshotFailure(403, 'APPROVAL_QUOTATION_FIELDS_FORBIDDEN', '当前员工无权读取完整报价审批字段');
  const projected = parseQuotationLines(request);
  if (projected && !lineFields.includes('unit_name')) projected.rows.forEach(line => { delete line.unitName; });
  return projected;
}

/** The native rejected request remains authoritative. This only admits a new
 * submission of the same quotation; it never edits the old request/payload. */
export async function requireRejectedQuotation(engine: IObjectQLEngine, quote: Row, context: ExecutionContext): Promise<void> {
  const requests = await engine.find('sys_approval_request', { where: { object_name: 'forge_quotation', record_id: quote.id, organization_id: quote.organization_id },
    orderBy: [{ field: 'created_at', order: 'desc' }, { field: 'id', order: 'desc' }], limit: 101 }, { context });
  if (!requests.length || requests.length > 100 || requests.some(request => !['approved', 'rejected'].includes(String(request.status)))) throw new Error('报价原审批结果未确定，不能开始新的提交轮次');
  const latest = requests[0], payload = approvalPayload(latest);
  const matching = requests.filter(request => {
    const frozen = approvalPayload(request);
    return frozen && Number.isFinite(Date.parse(String(frozen.submitted_at))) && Date.parse(String(frozen.submitted_at)) === Date.parse(String(quote.submitted_at))
      && frozen.submitted_content_sha256 === quote.submitted_content_sha256 && Number(frozen.submitted_pricing_version) === Number(quote.submitted_pricing_version)
      && (quote[QUOTATION_LINE_SNAPSHOT] == null || frozen[QUOTATION_LINE_SNAPSHOT] === quote[QUOTATION_LINE_SNAPSHOT]);
  });
  if (matching.length !== 1 || matching[0].id !== latest.id || latest.status !== 'rejected' || latest.process_name !== 'flow:sales_quotation_approval'
    || latest.submitter_id !== context.userId || quote.submitted_by !== context.userId || !payload || payload.submitted_by !== context.userId
    || payload.organization_id !== context.tenantId || payload.id !== quote.id) throw new Error('报价缺少唯一对应的最后已驳回原生请求，请先核对原结果');
  const rejected = await engine.find('sys_approval_action', { where: { request_id: latest.id, organization_id: quote.organization_id, action: 'reject' }, limit: 2 }, { context });
  if (rejected.length !== 1 || !rejected[0].actor_id || rejected[0].actor_id === context.userId) throw new Error('报价缺少独立员工的确定原生驳回意见');
}
