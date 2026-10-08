/** Shared exact decimal arithmetic for draft validation and line previews. */
function serviceQuotationArithmetic() {
  function reject(message: string): never { throw new Error(message); }
  function parseScaledInteger(value: unknown, scale: number, label: string, minimum: bigint): bigint {
    if (typeof value !== 'number' && typeof value !== 'string') reject(label + '格式无效');
    if (typeof value === 'number' && !Number.isFinite(value)) reject(label + '必须是有限数字');
    const text = typeof value === 'number' ? String(value) : (value as string).trim();
    if (!text) reject(label + '不能为空');
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) reject(label + '必须是有限数字');
    if (numeric < 0) reject(label + '不能为负数');
    if (!/^\d+(?:\.\d+)?$/.test(text)) reject(label + '格式无效');
    const parts = text.split('.');
    if ((parts[1] || '').length > scale) reject(label + '精度超出允许范围');
    const scaled = BigInt(parts[0] + (parts[1] || '').padEnd(scale, '0'));
    const scaledNumber = Number(scaled);
    if (!Number.isSafeInteger(scaledNumber) || scaled < minimum) reject(label + '超出可保存范围');
    const normalized = scaledNumber / Math.pow(10, scale);
    const normalizedText = String(normalized);
    if (!/^\d+(?:\.\d+)?$/.test(normalizedText)) reject(label + '超出可保存范围');
    const normalizedParts = normalizedText.split('.');
    if ((normalizedParts[1] || '').length > scale) reject(label + '超出可保存范围');
    const roundTrip = BigInt(normalizedParts[0] + (normalizedParts[1] || '').padEnd(scale, '0'));
    if (roundTrip !== scaled) reject(label + '超出可保存范围');
    return scaled;
  }
  function scaledIntegerToNumber(scaled: bigint, scale: number, label: string): number {
    if (scaled < 0n || !Number.isSafeInteger(Number(scaled))) reject(label + '超出可保存范围');
    const number = Number(scaled) / Math.pow(10, scale);
    const text = String(number);
    if (!/^\d+(?:\.\d+)?$/.test(text)) reject(label + '超出可保存范围');
    const parts = text.split('.');
    if ((parts[1] || '').length > scale) reject(label + '超出可保存范围');
    const roundTrip = BigInt(parts[0] + (parts[1] || '').padEnd(scale, '0'));
    if (roundTrip !== scaled) reject(label + '超出可保存范围');
    return number;
  }
  function roundHalfUp(numerator: bigint, denominator: bigint): bigint { return (numerator + denominator / 2n) / denominator; }

  return { parseScaledInteger, scaledIntegerToNumber, roundHalfUp };
}

/** Price a row before its catalogue and descriptive fields are complete. */
export function normalizeServiceQuotationLinePricing(quantity: unknown, taxedUnitPrice: unknown, label = '报价明细') {
  const { parseScaledInteger, scaledIntegerToNumber, roundHalfUp } = serviceQuotationArithmetic();
  const quantityUnits = parseScaledInteger(quantity, 2, label + '数量', 1n);
  const priceCents = parseScaledInteger(taxedUnitPrice, 2, label + '含税单价', 0n);
  const lineCents = roundHalfUp(quantityUnits * priceCents, 100n);
  return {
    quantity: scaledIntegerToNumber(quantityUnits, 2, label + '数量'),
    taxed_unit_price: scaledIntegerToNumber(priceCents, 2, label + '含税单价'),
    line_amount: scaledIntegerToNumber(lineCents, 2, label + '金额'),
  };
}

/**
 * Pure normalization for the editable portion of a service
 * quotation draft. Its shared pricing helpers are embedded with this function
 * in the guarded Action and Page code, so both use the same cent rounding.
 */
export function normalizeServiceQuotationDraft(draftJson: unknown): Record<string, unknown> {
  function reject(message: string): never { throw new Error(message); }
  if (typeof draftJson !== 'string') return reject('报价草稿必须是JSON文本');

  let draft: unknown;
  try { draft = JSON.parse(draftJson); } catch { return reject('报价草稿格式无效'); }
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return reject('报价草稿格式无效');
  const input = draft as Record<string, unknown>;
  function own(object: Record<string, unknown>, key: string) { return Object.prototype.hasOwnProperty.call(object, key); }
  function onlyKeys(object: Record<string, unknown>, allowed: string[], message: string) {
    if (Object.keys(object).some(key => !allowed.includes(key))) reject(message);
  }
  function requireKeys(object: Record<string, unknown>, required: string[], message: string) {
    if (required.some(key => !own(object, key))) reject(message);
  }
  const topFields = ['valid_until', 'remarks', 'pricing_mode', 'payment_mode', 'discount_rate', 'lines'];
  onlyKeys(input, topFields, '报价草稿包含不允许的字段');
  requireKeys(input, topFields, '报价草稿缺少必填字段');

  const validUntilRaw = input.valid_until;
  if (typeof validUntilRaw !== 'string' || !validUntilRaw.trim()) reject('报价有效期不能为空');
  const validUntil = validUntilRaw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) reject('报价有效期必须是有效日期');
  const validUntilDate = new Date(validUntil + 'T00:00:00.000Z');
  if (!Number.isFinite(validUntilDate.getTime()) || validUntilDate.toISOString().slice(0, 10) !== validUntil) {
    reject('报价有效期必须是有效日期');
  }

  if (input.remarks !== null && typeof input.remarks !== 'string') reject('报价备注格式无效');
  const remarks = typeof input.remarks === 'string' ? input.remarks.trim() : '';
  if (input.pricing_mode !== 'estimated' && input.pricing_mode !== 'fixed') reject('报价计价方式无效');
  if (input.payment_mode !== 'full_prepayment' && input.payment_mode !== 'staged') reject('报价付款方式无效');

  const { parseScaledInteger, scaledIntegerToNumber, roundHalfUp } = serviceQuotationArithmetic();

  const discountRateUnits = parseScaledInteger(input.discount_rate, 1, '整体折扣率', 0n);
  if (discountRateUnits > 1000n) reject('整体折扣率必须在0到100之间');
  const discountRate = scaledIntegerToNumber(discountRateUnits, 1, '整体折扣率');
  if (!Array.isArray(input.lines) || input.lines.length < 1) reject('报价至少需要一条明细');
  if (input.lines.length > 500) reject('报价明细不能超过500条');

  const seenIds = new Set<string>();
  let subtotalCents = 0n;
  const lines = input.lines.map((rawLine: unknown, index: number) => {
    const label = '第' + String(index + 1) + '条报价明细';
    if (!rawLine || typeof rawLine !== 'object' || Array.isArray(rawLine)) reject(label + '格式无效');
    const line = rawLine as Record<string, unknown>;
    const lineFields = ['id', 'line_type', 'item_id', 'description', 'unit_name', 'quantity', 'taxed_unit_price'];
    onlyKeys(line, lineFields, label + '包含不允许的字段');
    requireKeys(line, ['line_type', 'item_id', 'description', 'unit_name', 'quantity', 'taxed_unit_price'], label + '缺少必填字段');

    let id: string | undefined;
    if (own(line, 'id')) {
      if (typeof line.id !== 'string') reject(label + '明细标识格式无效');
      id = line.id.trim();
      if (!id || id.length > 128) reject(label + '明细标识无效');
      if (seenIds.has(id)) reject('报价明细包含重复的现有明细标识');
      seenIds.add(id);
    }
    if (line.line_type !== 'service' && line.line_type !== 'part') reject(label + '类型无效');
    if (typeof line.item_id !== 'string') reject(label + '物料或服务标识格式无效');
    const itemId = line.item_id.trim();
    if (!itemId || itemId.length > 128) reject(label + '物料或服务标识无效');
    if (typeof line.description !== 'string') reject(label + '描述格式无效');
    const description = line.description.trim();
    if (typeof line.unit_name !== 'string') reject(label + '单位格式无效');
    const unitName = line.unit_name.trim();
    if (!unitName || unitName.length > 50) reject(label + '单位不能为空且不能超过50个字符');

    const pricing = normalizeServiceQuotationLinePricing(line.quantity, line.taxed_unit_price, label);
    subtotalCents += parseScaledInteger(pricing.line_amount, 2, label + '金额', 0n);
    return {
      ...(id ? { id } : {}),
      line_type: line.line_type,
      item_id: itemId,
      description,
      unit_name: unitName,
      quantity: pricing.quantity,
      taxed_unit_price: pricing.taxed_unit_price,
      line_amount: pricing.line_amount,
    };
  });

  const discountCents = roundHalfUp(subtotalCents * discountRateUnits, 1000n);
  const totalCents = subtotalCents - discountCents;
  return {
    valid_until: validUntil,
    remarks,
    pricing_mode: input.pricing_mode,
    payment_mode: input.payment_mode,
    discount_rate: discountRate,
    lines,
    subtotal: scaledIntegerToNumber(subtotalCents, 2, '报价小计'),
    discount_amount: scaledIntegerToNumber(discountCents, 2, '折扣金额'),
    total_amount: scaledIntegerToNumber(totalCents, 2, '报价总额'),
    item_count: lines.length,
  };
}

/**
 * Source string is self-contained and safe to concatenate into a QuickJS body.
 * esbuild adds `__name(fn, name)` calls for debugging when the TypeScript module
 * is loaded; those calls are not part of the helper and do not exist in QuickJS.
 */
export const serviceQuotationLinesHelpersSource = [
  serviceQuotationArithmetic,
  normalizeServiceQuotationLinePricing,
  normalizeServiceQuotationDraft,
].map(helper => helper.toString()).join('\n')
  .replace(/\b__name\([A-Za-z_$][A-Za-z0-9_$]*,"[^"]+"\);/g, '');
