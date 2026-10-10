/** Four decimal places are preserved for unit prices, quantities and totals. */
export function normalizeSalesPriceDraft(raw: string) {
  const input = JSON.parse(raw);
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  const units = (value: unknown, label: string, positive = false) => {
    const token = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
    if (!/^\d{1,12}(\.\d{1,4})?$/.test(token)) throw new Error(label + '须为非负数，最多四位小数');
    const [whole, fraction = ''] = token.split('.');
    const result = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
    if (positive && result === 0n) throw new Error(label + '须大于零');
    return result;
  };
  const decimal = (value: bigint) => `${value / 10000n}.${String(value % 10000n).padStart(4, '0')}`;
  const date = (value: unknown, label: string, optional = false) => {
    const token = text(value);
    if (!token && optional) return '';
    const parsed = new Date(token + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(token) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== token) throw new Error(label + '无效');
    return token;
  };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('申请内容无效');
  const kind = text(input.kind);
  if (!['adjustment', 'special', 'agreement'].includes(kind)) throw new Error('申请类型无效');
  const customerId = text(input.customer_id), reason = text(input.reason), priority = text(input.priority) || 'normal';
  if (kind !== 'adjustment' && !customerId) throw new Error('请选择客户');
  if (reason.length > 2000 || !['normal', 'urgent', 'critical'].includes(priority)) throw new Error('申请原因或紧急程度无效');
  const validFrom = kind === 'adjustment' ? '' : date(input.valid_from, '生效日期');
  const validUntil = kind === 'adjustment' ? '' : date(input.valid_until, '到期日期', input.long_term === true);
  if (validUntil && validUntil < validFrom) throw new Error('到期日期不能早于生效日期');
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 200) throw new Error('请添加 1 至 200 项物料');
  const attachmentIds = input.attachment_ids === undefined ? undefined : input.attachment_ids;
  if (attachmentIds !== undefined && (!Array.isArray(attachmentIds) || attachmentIds.length > 20 || attachmentIds.some((id: unknown) => !text(id)) || new Set(attachmentIds.map(text)).size !== attachmentIds.length)) throw new Error('辅助材料选择无效');
  const seen = new Set<string>();
  let total = 0n;
  const lines = input.lines.map((line: Record<string, unknown>, index: number) => {
    const skuId = text(line.sku_id);
    if (!skuId || seen.has(skuId)) throw new Error('物料规格不能为空或重复');
    seen.add(skuId);
    const quantity = units(line.quantity ?? 1, '第' + (index + 1) + '行数量', true);
    const price = units(line.proposed_price, '第' + (index + 1) + '行单价', true);
    const amount = (quantity * price + 5000n) / 10000n;
    total += amount;
    const minimum = line.minimum_price == null || line.minimum_price === '' ? null : decimal(units(line.minimum_price, '最低售价'));
    const suggested = line.suggested_price == null || line.suggested_price === '' ? null : decimal(units(line.suggested_price, '建议售价'));
    if (kind === 'adjustment' && minimum !== null && units(minimum, '最低售价') > price) throw new Error('目录价不能低于最低售价');
    return { sku_id: skuId, quantity: decimal(quantity), proposed_price: decimal(price), proposed_amount: decimal(amount), minimum_price: minimum, suggested_price: suggested, line_number: index + 1 };
  });
  return { kind, customer_id: kind === 'adjustment' ? '' : customerId, contact_id: text(input.contact_id), quotation_id: text(input.quotation_id), review_owner_id: text(input.review_owner_id), reason, priority, valid_from: validFrom, valid_until: validUntil, long_term: input.long_term === true, attachment_ids: attachmentIds?.map(text), lines, proposed_total: decimal(total) };
}

export function salesPriceBaselineToken(sku: Record<string, unknown>) {
  // The native timestamp also detects changes made outside the pricing workspace.
  return JSON.stringify([sku.sale_price ?? null, sku.minimum_sale_price ?? null, sku.suggested_sale_price ?? null, sku.sale_price_revision ?? null, sku.updated_at ?? null]);
}
