import { canonicalJSON, digest } from './native-task-auth.js';
type Row = Record<string, unknown>;
const HEAD = ['id', 'organization_id', 'owner_id', 'responsible_id', 'name', 'code', 'customer_id', 'contact_id', 'opportunity_id',
  'opportunity_name', 'quotation_type_id', 'issuer_id', 'quotation_date', 'valid_until', 'payment_method', 'payment_term',
  'pricing_version', 'item_count', 'subtotal', 'discount_amount', 'tax_amount', 'total_amount', 'business_terms', 'quotation_terms', 'attachment_note', 'remarks'];
const LINE = ['id', 'organization_id', 'quotation_id', 'name', 'line_type', 'group_name', 'sku_id', 'item_code', 'model',
  'specification', 'unit_name', 'quantity', 'taxed_unit_price', 'untaxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal', 'sort_order', 'remarks'];
function selected(row: Row, fields: string[]): Row { return Object.fromEntries(fields.map(key => [key, row[key] ?? null])); }

/** Business content only: stage timestamps and evidence do not change the
 * version the native approval actually reviewed. */
export async function quotationContentDigest(quote: Row, lines: Row[]): Promise<string> {
  return digest(canonicalJSON(JSON.parse(JSON.stringify({ quotation: selected(quote, HEAD),
    lines: [...lines].sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0).map(row => selected(row, LINE)) }))));
}
export function quotationFollowUpAction(row: Row, actor?: string): string | undefined {
  if (!actor || row.responsible_id !== actor || row.owner_id !== actor) return undefined;
  const version = Number(row.pricing_version ?? 0);
  if (!Number.isSafeInteger(version) || version < 0) return undefined;
  if (row.status === 'draft') return 'quotation_submit';
  if (row.submitted_pricing_version == null || row.approved_pricing_version == null
    || Number(row.submitted_pricing_version) !== version || Number(row.approved_pricing_version) !== version
    || !/^[0-9a-f]{64}$/.test(String(row.submitted_content_sha256))) return undefined;
  if (row.status === 'approved') return 'quotation_send';
  if (row.sent_pricing_version == null || Number(row.sent_pricing_version) !== version) return undefined;
  if (row.status === 'sent') return 'quotation_accept';
  if (row.status === 'accepted' && row.accepted_pricing_version != null && Number(row.accepted_pricing_version) === version) return 'quotation_convert_to_contract';
  return undefined;
}
