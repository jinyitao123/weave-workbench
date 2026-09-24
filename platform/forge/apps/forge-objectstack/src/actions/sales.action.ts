import { defineAction } from '@objectstack/spec';

const locations = ['record_header', 'record_more'] as const;

const statusBody = (objectName: string, from: string, to: string) => ({
  language: 'js' as const,
  capabilities: ['api.write' as const],
  source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
if (ctx.recordLoadDenied === true || !id) throw new Error('当前记录不存在或不可访问');
if (!ctx.record || ctx.record.status !== '${from}') throw new Error('记录状态已变化，请刷新后重试');
await ctx.api.object('${objectName}').update({ id, status: '${to}' });
return { id, status: '${to}' };
`,
});

export const QuotationRecalculate = defineAction({
  name: 'quotation_recalculate', label: '重新计算金额', objectName: 'forge_quotation', icon: 'calculator',
  locations: ['record_more'], visible: `record.status == 'draft'`, refreshAfter: true,
  requiredPermissions: ['sales_quotation_adjust'],
  successMessage: '报价金额已按明细重新计算',
  body: {
    language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
if (ctx.recordLoadDenied === true || !id) throw new Error('当前报价不存在或不可访问');
const actor = String(ctx.session && ctx.session.userId || '').trim();
const quotationObject = ctx.api.object('forge_quotation');
const lineObject = ctx.api.object('forge_quotation_line');
const receiptObject = ctx.api.object('forge_quotation_price_adjustment_receipt');
let attemptedVersion = null;
try {
  return await ctx.api.transaction(async () => {
    const quote = await quotationObject.findOne({ where: { id }, fields: ['id', 'responsible_id', 'item_count', 'subtotal', 'discount_amount', 'tax_amount', 'total_amount', 'status', 'pricing_version'] });
    if (!quote) throw new Error('当前报价不存在或不可访问');
    const lines = await lineObject.find({ where: { quotation_id: id }, fields: ['quantity', 'taxed_unit_price', 'taxed_subtotal', 'tax_rate'] });
    if (!lines.length) throw new Error('报价至少需要一条明细');
    if (quote.responsible_id !== actor) throw new Error('只有当前报价负责人可以重新计算金额');
    let subtotal = 0, total = 0, tax = 0;
    for (const line of lines) {
      const quantity = Number(line.quantity || 0);
      const unitPrice = Number(line.taxed_unit_price || 0);
      const lineTotal = Number(line.taxed_subtotal || 0);
      const rate = Number(line.tax_rate || 0) / 100;
      subtotal += quantity * unitPrice;
      total += lineTotal;
      tax += rate > 0 ? lineTotal - lineTotal / (1 + rate) : 0;
    }
    const round4 = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
    const totals = {
      item_count: lines.length,
      subtotal: round4(subtotal),
      discount_amount: round4(subtotal - total),
      tax_amount: round4(tax),
      total_amount: round4(total),
    };
    const matches = (current, next) => next === null
      ? current === null || current === undefined || current === ''
      : current !== null && current !== undefined && current !== '' && Number.isFinite(Number(current)) && Math.abs(Number(current) - next) <= 0.0001;
    const unchanged = Number(quote.item_count || 0) === totals.item_count
      && matches(quote.subtotal, totals.subtotal)
      && matches(quote.discount_amount, totals.discount_amount)
      && matches(quote.tax_amount, totals.tax_amount)
      && matches(quote.total_amount, totals.total_amount);
    const currentVersion = quote.pricing_version === null || quote.pricing_version === undefined ? 0 : Number(quote.pricing_version);
    if (!Number.isInteger(currentVersion) || currentVersion < 0) throw new Error('报价版本无效，请先核对报价记录');
    if (unchanged) return { id, ...totals, pricing_version: currentVersion };
    if (!actor) throw new Error('无法识别当前重新计算员工');
    attemptedVersion = currentVersion;
    const nextVersion = currentVersion + 1;
    const idempotencyKey = 'recalculate:' + currentVersion;
    const signature = JSON.stringify({ operation: 'recalculation', quotation_id: id, expected_version: currentVersion, ...totals });
    const existing = await receiptObject.findOne({ where: { quotation_id: id, expected_version: currentVersion }, fields: ['id'] });
    if (existing) throw new Error('报价版本已变化，请刷新报价后重新计算');
    await receiptObject.insert({
      name: '重新计算报价金额', quotation_id: id, operation: 'recalculation', quotation_line_id: 'recalculate',
      expected_version: currentVersion, resulting_version: nextVersion, idempotency_key: idempotencyKey,
      request_signature: signature, requested_unit_price: null, line_subtotal: null,
      quotation_total: totals.total_amount, cost_total: null,
      cost_analysis_available: false, requested_by: actor, recorded_at: new Date().toISOString(),
    });
    await quotationObject.update({ id, ...totals, pricing_version: nextVersion });
    return { id, ...totals, pricing_version: nextVersion };
  });
} catch (error) {
  const current = await quotationObject.findOne({ where: { id }, fields: ['pricing_version'] });
  if (current && attemptedVersion !== null) {
    const currentVersion = current.pricing_version === null || current.pricing_version === undefined ? 0 : Number(current.pricing_version);
    if (currentVersion !== attemptedVersion) throw new Error('报价版本已变化，请刷新报价后重新核对');
  }
  throw error;
}
`,
  },
});

export const SalesQuotationDraftCreate = defineAction({
  name: 'sales_quotation_draft_create', label: '新建销售报价草稿', objectName: 'forge_quotation', icon: 'file-plus-2',
  locations: [...locations], visible: false, refreshAfter: true,
  requiredPermissions: ['sales_quotation_draft_create'],
  successMessage: '报价草稿已保存',
  params: [
    { name: 'code', label: '报价单号', type: 'text', required: true },
    { name: 'name', label: '报价名称', type: 'text', required: true },
    { name: 'customer_id', label: '客户', type: 'text', required: true },
    { name: 'contact_id', label: '联系人', type: 'text' },
    { name: 'quotation_type_id', label: '报价类型', type: 'text', required: true },
    { name: 'issuer_id', label: '报价主体', type: 'text', required: true },
    { name: 'quotation_date', label: '报价日期', type: 'text', required: true },
    { name: 'valid_until', label: '有效期至', type: 'text', required: true },
    { name: 'payment_term', label: '付款条件', type: 'text' },
    { name: 'business_terms', label: '商务条款', type: 'text' },
    { name: 'quotation_terms', label: '报价条款', type: 'text' },
    { name: 'remarks', label: '备注', type: 'text' },
    { name: 'lines_json', label: '报价明细', type: 'text', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const actor = String(ctx.session && ctx.session.userId || '').trim();
const organizationId = String(ctx.session && ctx.session.organizationId || '').trim();
if (!actor) throw new Error('无法识别当前销售员工');
if (!organizationId) throw new Error('无法确认当前销售组织，请重新登录后再试');
const payload = ctx.input || {};
const getText = (key, label, required = false, max = 255) => {
  const value = String(payload[key] == null ? '' : payload[key]).trim();
  if (required && !value) throw new Error(label + '不能为空');
  if (value.length > max) throw new Error(label + '长度不能超过' + max + '个字符');
  return value || null;
};
const code = getText('code', '报价单号', true, 100);
const name = getText('name', '报价名称', true, 255);
const customerId = getText('customer_id', '客户', true, 128);
const contactId = getText('contact_id', '联系人', false, 128);
const quotationTypeId = getText('quotation_type_id', '报价类型', true, 128);
const issuerId = getText('issuer_id', '报价主体', true, 128);
const quotationDate = getText('quotation_date', '报价日期', true, 10);
const validUntil = getText('valid_until', '有效期至', true, 10);
const isDate = value => /^\\d{4}-\\d{2}-\\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'));
if (!isDate(quotationDate)) throw new Error('报价日期格式无效');
if (!isDate(validUntil)) throw new Error('有效期至格式无效');
if (validUntil < quotationDate) throw new Error('有效期至不得早于报价日期');
let requestedLines;
try { requestedLines = JSON.parse(String(payload.lines_json || '')); } catch { throw new Error('报价明细格式无效，请检查后重试'); }
if (!Array.isArray(requestedLines) || requestedLines.length < 1 || requestedLines.length > 100) throw new Error('报价至少需要一条明细，且最多支持100条');
const round4 = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
const validNumber = (value, label, min, max) => {
  if (value === null || value === undefined || value === '') throw new Error(label + '不能为空');
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || round4(number) !== number) throw new Error(label + '无效，最多支持四位小数');
  return number;
};
const orgRecord = row => row && String(row.organization_id || '') === organizationId;
const ownedByActor = row => row && String(row.owner_id || '') === actor;
const quotationObject = ctx.api.object('forge_quotation');
const lineObject = ctx.api.object('forge_quotation_line');
const customerObject = ctx.api.object('forge_customer');
const contactObject = ctx.api.object('forge_contact');
const typeObject = ctx.api.object('forge_quotation_type');
const issuerObject = ctx.api.object('forge_quotation_issuer');
const skuObject = ctx.api.object('forge_material_sku');
const materialObject = ctx.api.object('forge_material');
const unitObject = ctx.api.object('forge_unit');
return await ctx.api.transaction(async () => {
  const duplicate = await quotationObject.findOne({ where: { code } });
  if (duplicate) throw new Error('报价单号已存在，请刷新报价列表后重试');
  const customer = await customerObject.findOne({ where: { id: customerId } });
  if (!orgRecord(customer) || !ownedByActor(customer)) throw new Error('只能为本人拥有的客户创建报价');
  const quotationType = await typeObject.findOne({ where: { id: quotationTypeId } });
  if (!orgRecord(quotationType) || quotationType.status === 'inactive') throw new Error('所选报价类型不存在、已停用或不属于当前组织');
  const issuer = await issuerObject.findOne({ where: { id: issuerId } });
  if (!orgRecord(issuer)) throw new Error('所选报价主体不存在或不属于当前组织');
  if (contactId) {
    const contact = await contactObject.findOne({ where: { id: contactId } });
    if (!orgRecord(contact) || contact.customer_id !== customerId || !ownedByActor(contact) || contact.employment_status !== 'active') throw new Error('所选联系人不属于当前销售或已不可用');
  }
  let subtotal = 0, total = 0, tax = 0;
  const lines = [];
  for (let index = 0; index < requestedLines.length; index += 1) {
    const requested = requestedLines[index];
    if (!requested || typeof requested !== 'object' || Array.isArray(requested)) throw new Error('第' + (index + 1) + '条报价明细格式无效');
    const allowedLineKeys = ['line_type', 'name', 'sku_id', 'quantity', 'taxed_unit_price', 'tax_rate', 'discount_rate', 'remarks'];
    if (Object.keys(requested).some(key => !allowedLineKeys.includes(key))) throw new Error('报价明细包含未授权字段');
    const lineType = String(requested.line_type || '');
    if (!['material', 'service'].includes(lineType)) throw new Error('第' + (index + 1) + '条明细类型无效');
    const quantity = validNumber(requested.quantity, '第' + (index + 1) + '条明细数量', 0.0001, 1000000000);
    const taxedUnitPrice = validNumber(requested.taxed_unit_price, '第' + (index + 1) + '条含税单价', 0, 1000000000000);
    const taxRate = validNumber(requested.tax_rate, '第' + (index + 1) + '条税率', 0, 100);
    const discountRate = validNumber(requested.discount_rate, '第' + (index + 1) + '条折扣率', 0, 100);
    const remarks = requested.remarks == null ? null : String(requested.remarks).trim().slice(0, 4000) || null;
    let lineName = null, skuId = null, itemCode = null, model = null, specification = null, unitName = null, costPrice = null;
    if (lineType === 'material') {
      skuId = String(requested.sku_id || '').trim();
      if (!skuId) throw new Error('第' + (index + 1) + '条物料明细必须选择已启用规格');
      const sku = await skuObject.findOne({ where: { id: skuId }, fields: ['id', 'organization_id', 'enabled', 'material_id', 'code', 'name', 'sale_price'] });
      if (!orgRecord(sku) || sku.enabled === false) throw new Error('第' + (index + 1) + '条所选物料规格不存在、已停用或不属于当前组织');
      const material = await materialObject.findOne({ where: { id: sku.material_id } });
      if (!orgRecord(material) || material.status === 'inactive') throw new Error('第' + (index + 1) + '条所选物料不存在、已停用或不属于当前组织');
      const unit = material.unit_id ? await unitObject.findOne({ where: { id: material.unit_id } }) : null;
      if (!orgRecord(unit) || unit.status === 'inactive') throw new Error('第' + (index + 1) + '条物料的计量单位不可用');
      lineName = String(material.name || '').trim();
      if (!lineName) throw new Error('第' + (index + 1) + '条物料缺少名称');
      itemCode = sku.code || material.code || null;
      model = material.model || null;
      specification = sku.name || null;
      unitName = unit.name || null;
    } else {
      lineName = String(requested.name || '').trim();
      if (!lineName) throw new Error('第' + (index + 1) + '条服务明细必须填写服务名称');
      if (lineName.length > 255) throw new Error('第' + (index + 1) + '条服务名称不能超过255个字符');
    }
    const lineTotal = round4(quantity * taxedUnitPrice * (1 - discountRate / 100));
    const untaxedUnitPrice = round4(taxedUnitPrice / (1 + taxRate / 100));
    lines.push({
      name: lineName, line_type: lineType, quotation_id: null, sku_id: skuId,
      item_code: itemCode, model, specification, unit_name: unitName,
      quantity, taxed_unit_price: taxedUnitPrice, untaxed_unit_price: untaxedUnitPrice,
      tax_rate: taxRate, discount_rate: discountRate, taxed_subtotal: lineTotal,
      cost_price: costPrice, sort_order: index, remarks,
    });
    subtotal += quantity * taxedUnitPrice;
    total += lineTotal;
    const rate = taxRate / 100;
    tax += rate > 0 ? lineTotal - lineTotal / (1 + rate) : 0;
  }
  const totals = {
    item_count: lines.length,
    subtotal: round4(subtotal),
    discount_amount: round4(subtotal - total),
    tax_amount: round4(tax),
    total_amount: round4(total),
    cost_total: null,
  };
  const created = await quotationObject.insert({
    code, name, customer_id: customerId, contact_id: contactId,
    quotation_type_id: quotationTypeId, issuer_id: issuerId,
    quotation_date: quotationDate, valid_until: validUntil,
    payment_method: 'bank_transfer', payment_term: getText('payment_term', '付款条件', false, 255),
    business_terms: getText('business_terms', '商务条款', false, 4000),
    quotation_terms: getText('quotation_terms', '报价条款', false, 4000),
    remarks: getText('remarks', '备注', false, 4000),
    owner_id: actor, responsible_id: actor, status: 'draft', pricing_version: 0,
    ...totals,
  });
  const quotationId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
  if (!quotationId) throw new Error('报价草稿保存后未返回记录');
  for (const line of lines) {
    const row = { ...line, quotation_id: quotationId, owner_id: actor };
    const inserted = await lineObject.insert(row);
    const lineId = typeof inserted === 'string' ? inserted : inserted && (inserted.id || (inserted.record && inserted.record.id));
    if (!lineId) throw new Error('报价明细保存后未返回记录');
  }
  return { id: quotationId, code, status: 'draft', item_count: totals.item_count, subtotal: totals.subtotal, discount_amount: totals.discount_amount, tax_amount: totals.tax_amount, total_amount: totals.total_amount };
});
` },
});

export const QuotationAdjustLinePrice = defineAction({
  name: 'quotation_adjust_line_price', label: '调整报价明细单价', objectName: 'forge_quotation', icon: 'calculator',
  locations: ['record_more'], visible: false, refreshAfter: true,
  requiredPermissions: ['sales_quotation_adjust'],
  successMessage: '报价明细与报价金额已保存',
  ai: {
    exposed: true,
    description: '只调整当前员工负责的草稿报价中指定一行的含税单价，并在同一事务中重算报价金额。必须带报价版本、明细标识和稳定请求标识；相同请求返回原回执，异参或旧版本会冲突。',
    category: 'action',
    requiresConfirmation: false,
  },
  params: [
    { name: 'line_id', label: '报价明细标识', type: 'text', required: true },
    { name: 'expected_version', label: '报价版本', type: 'number', required: true },
    { name: 'taxed_unit_price', label: '新的含税单价', type: 'number', required: true },
    { name: 'idempotency_key', label: '请求标识', type: 'text', required: true },
  ],
  body: {
    language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = String(ctx.recordId || (ctx.record && ctx.record.id) || '').trim();
const actor = String(ctx.session && ctx.session.userId || '').trim();
if (ctx.recordLoadDenied === true) throw new Error('当前员工无权读取这份报价');
if (!id || !ctx.record) throw new Error('本次报价调整缺少可校验的目标记录');
if (!actor) throw new Error('无法识别当前操作员工');
const adjustment = ctx.input || {};
const allowed = ['expected_version', 'idempotency_key', 'line_id', 'taxed_unit_price'];
const routeKeys = ['objectName', 'recordId'];
for (const key of Object.keys(adjustment)) if (!allowed.includes(key) && !routeKeys.includes(key)) throw new Error('报价调整只接受本次授权的单行标量参数');
if (adjustment.objectName && adjustment.objectName !== 'forge_quotation') throw new Error('报价调整对象与本次授权不一致');
if (adjustment.recordId && String(adjustment.recordId) !== id) throw new Error('报价调整记录与本次授权不一致');
for (const key of allowed) if (!Object.prototype.hasOwnProperty.call(adjustment, key)) throw new Error('报价调整缺少必填参数');
const lineId = String(adjustment.line_id || '').trim();
const idempotencyKey = String(adjustment.idempotency_key || '').trim();
const expectedVersion = Number(adjustment.expected_version);
const requestedPrice = Number(adjustment.taxed_unit_price);
const round4 = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
if (!lineId || lineId.length > 128) throw new Error('报价明细标识无效');
if (!idempotencyKey || idempotencyKey.length > 128) throw new Error('报价调整请求标识无效');
if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error('报价版本无效');
if (!Number.isFinite(requestedPrice) || requestedPrice < 0 || round4(requestedPrice) !== requestedPrice) throw new Error('含税单价必须是大于或等于零且最多四位小数的数字');
const signature = JSON.stringify({ quotation_id: id, line_id: lineId, expected_version: expectedVersion, taxed_unit_price: requestedPrice });
const quotationObject = ctx.api.object('forge_quotation');
const lineObject = ctx.api.object('forge_quotation_line');
const receiptObject = ctx.api.object('forge_quotation_price_adjustment_receipt');
  const replayReceipt = async receipt => {
    if (receipt.operation !== 'price_adjustment' || receipt.requested_by !== actor || receipt.request_signature !== signature) throw new Error('同一请求标识已用于不同输入');
    return {
      id,
      line_total: Number(receipt.line_subtotal),
      total_amount: Number(receipt.quotation_total),
      pricing_version: Number(receipt.resulting_version),
      repeated: true,
  };
};
try {
  return await ctx.api.transaction(async () => {
    const quote = await quotationObject.findOne({ where: { id }, fields: ['id', 'responsible_id', 'status', 'pricing_version'] });
    if (!quote) throw new Error('事务内无法读取当前报价记录');
    if (quote.responsible_id !== actor) throw new Error('只有当前报价负责人可以调整这份报价');
    const prior = await receiptObject.findOne({ where: { quotation_id: id, idempotency_key: idempotencyKey }, fields: ['operation', 'requested_by', 'request_signature', 'line_subtotal', 'quotation_total', 'resulting_version'] });
    if (prior) return replayReceipt(prior);
    if (quote.status !== 'draft') throw new Error('仅草稿报价可以调整');
    const currentVersion = quote.pricing_version === null || quote.pricing_version === undefined ? 0 : Number(quote.pricing_version);
    if (currentVersion !== expectedVersion) throw new Error('报价版本已变化，请刷新报价后重新核对');
    const line = await lineObject.findOne({ where: { id: lineId, quotation_id: id }, fields: ['id', 'quantity', 'discount_rate', 'tax_rate', 'taxed_unit_price', 'taxed_subtotal'] });
    if (!line) throw new Error('指定报价明细不属于当前报价或已不存在');
    const quantity = Number(line.quantity);
    const discountRate = Number(line.discount_rate);
    const taxRate = Number(line.tax_rate);
    if (line.quantity === null || line.quantity === undefined || line.quantity === '' || !Number.isFinite(quantity) || quantity <= 0) throw new Error('指定报价明细的数量无效');
    if (line.discount_rate === null || line.discount_rate === undefined || line.discount_rate === '' || !Number.isFinite(discountRate) || discountRate < 0 || discountRate > 100) throw new Error('指定报价明细的折扣率无效');
    if (line.tax_rate === null || line.tax_rate === undefined || line.tax_rate === '' || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new Error('指定报价明细的税率无效');
    const nextLineSubtotal = round4(quantity * requestedPrice * (1 - discountRate / 100));
    const untaxedUnitPrice = round4(requestedPrice / (1 + taxRate / 100));
    const lines = await lineObject.find({ where: { quotation_id: id }, fields: ['id', 'quantity', 'discount_rate', 'tax_rate', 'taxed_unit_price', 'taxed_subtotal'] });
    if (!lines.length) throw new Error('报价至少需要一条明细');
    let subtotal = 0, total = 0, tax = 0;
    let targetFound = false;
    for (const currentLine of lines) {
      const isTarget = currentLine.id === lineId;
      if (isTarget) targetFound = true;
      const currentQuantity = Number(currentLine.quantity);
      const currentDiscount = Number(currentLine.discount_rate);
      const currentTaxRate = Number(currentLine.tax_rate);
      const currentUnitPrice = isTarget ? requestedPrice : Number(currentLine.taxed_unit_price);
      if (currentLine.quantity === null || currentLine.quantity === undefined || currentLine.quantity === '' || !Number.isFinite(currentQuantity) || currentQuantity <= 0) throw new Error('报价明细数量缺失或无效，不能重算总额');
      if (currentLine.discount_rate === null || currentLine.discount_rate === undefined || currentLine.discount_rate === '' || !Number.isFinite(currentDiscount) || currentDiscount < 0 || currentDiscount > 100) throw new Error('报价明细折扣率缺失或无效，不能重算总额');
      if (currentLine.tax_rate === null || currentLine.tax_rate === undefined || currentLine.tax_rate === '' || !Number.isFinite(currentTaxRate) || currentTaxRate < 0 || currentTaxRate > 100) throw new Error('报价明细税率缺失或无效，不能重算税额');
      if ((!isTarget && (currentLine.taxed_unit_price === null || currentLine.taxed_unit_price === undefined || currentLine.taxed_unit_price === '')) || !Number.isFinite(currentUnitPrice) || currentUnitPrice < 0) throw new Error('报价明细含税单价缺失或无效，不能重算总额');
      const calculatedLineTotal = round4(currentQuantity * currentUnitPrice * (1 - currentDiscount / 100));
      if (!isTarget) {
        const storedLineTotal = Number(currentLine.taxed_subtotal);
        if (currentLine.taxed_subtotal === null || currentLine.taxed_subtotal === undefined || currentLine.taxed_subtotal === '' || !Number.isFinite(storedLineTotal) || Math.abs(storedLineTotal - calculatedLineTotal) > 0.0001) throw new Error('其他报价明细金额与数量、单价或折扣不一致，请先核对原报价');
      }
      subtotal += currentQuantity * currentUnitPrice;
      total += calculatedLineTotal;
      const rate = currentTaxRate / 100;
      tax += rate > 0 ? calculatedLineTotal - calculatedLineTotal / (1 + rate) : 0;
    }
    if (!targetFound) throw new Error('指定报价明细不属于当前报价或已不存在');
    const nextVersion = currentVersion + 1;
    const now = new Date().toISOString();
    const totals = {
      item_count: lines.length,
      subtotal: round4(subtotal),
      discount_amount: round4(subtotal - total),
      tax_amount: round4(tax),
      total_amount: round4(total),
      pricing_version: nextVersion,
    };
    await receiptObject.insert({
      name: '报价单行价格调整', quotation_id: id, operation: 'price_adjustment', quotation_line_id: lineId,
      expected_version: currentVersion, resulting_version: nextVersion,
      idempotency_key: idempotencyKey, request_signature: signature,
      requested_unit_price: requestedPrice, line_subtotal: nextLineSubtotal,
      quotation_total: totals.total_amount, cost_total: null,
      cost_analysis_available: false, requested_by: actor, recorded_at: now,
    });
    await lineObject.update({
      id: lineId, taxed_unit_price: requestedPrice, untaxed_unit_price: untaxedUnitPrice,
      taxed_subtotal: nextLineSubtotal,
    });
    await quotationObject.update({ id, ...totals });
    return {
      id,
      line_total: nextLineSubtotal,
      total_amount: totals.total_amount,
      pricing_version: nextVersion,
      repeated: false,
    };
  });
} catch (error) {
  const quote = await quotationObject.findOne({ where: { id }, fields: ['responsible_id', 'pricing_version'] });
  if (quote && quote.responsible_id === actor) {
    const prior = await receiptObject.findOne({ where: { quotation_id: id, idempotency_key: idempotencyKey }, fields: ['operation', 'requested_by', 'request_signature', 'line_subtotal', 'quotation_total', 'resulting_version'] });
    if (prior) return replayReceipt(prior);
    const currentVersion = quote.pricing_version === null || quote.pricing_version === undefined ? 0 : Number(quote.pricing_version);
    if (currentVersion !== expectedVersion) throw new Error('报价版本已变化，请刷新报价后重新核对');
  }
  throw error;
}
`,
  },
});

export const QuotationSubmit = defineAction({
  name: 'quotation_submit', label: '提交审批', objectName: 'forge_quotation', icon: 'send', locations: [...locations], order: 10,
  visible: `record.status == 'draft'`, confirmText: '提交后报价将进入审批，是否继续？', refreshAfter: true,
  successMessage: '报价已提交审批', body: statusBody('forge_quotation', 'draft', 'pending_approval'),
});

export const QuotationApprove = defineAction({
  name: 'quotation_approve', label: '同意', objectName: 'forge_quotation', icon: 'circle-check', locations: [...locations], order: 10,
  visible: `record.status == 'pending_approval'`, confirmText: '确认同意这份报价？', refreshAfter: true,
  successMessage: '报价审批通过', body: statusBody('forge_quotation', 'pending_approval', 'approved'),
});

export const QuotationSend = defineAction({
  name: 'quotation_send', label: '发送给客户', objectName: 'forge_quotation', icon: 'mail', locations: [...locations], order: 10,
  visible: `record.status == 'approved'`, confirmText: '确认报价已发送给客户？', refreshAfter: true,
  successMessage: '报价已标记为已发送', body: statusBody('forge_quotation', 'approved', 'sent'),
});

export const QuotationAccept = defineAction({
  name: 'quotation_accept', label: '标记客户接受', objectName: 'forge_quotation', icon: 'handshake', locations: [...locations], order: 10,
  visible: `record.status == 'sent'`, confirmText: '确认客户已经接受这份报价？', refreshAfter: true,
  successMessage: '报价已成交', body: statusBody('forge_quotation', 'sent', 'accepted'),
});

export const QuotationConvertToContract = defineAction({
  name: 'quotation_convert_to_contract', label: '转为合同', objectName: 'forge_quotation', icon: 'scroll-text',
  locations: [...locations], order: 20, visible: `record.status == 'accepted'`, refreshAfter: true,
  description: '用已接受报价建立一份同客户、同价格和同数量的框架合同。', successMessage: '合同与合同明细已创建',
  params: [
    { field: 'contract_type_id', objectOverride: 'forge_sales_contract', required: true },
    { field: 'code', objectOverride: 'forge_sales_contract', required: true },
    { field: 'name', objectOverride: 'forge_sales_contract', required: true },
    { field: 'starts_on', objectOverride: 'forge_sales_contract', required: true },
    { field: 'ends_on', objectOverride: 'forge_sales_contract', required: true },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.sales/forge_sales_contract/record/${result.id}' },
  body: {
    language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
const quote = ctx.record;
if (ctx.recordLoadDenied === true || !id || !quote) throw new Error('当前报价不存在或不可访问');
if (quote.status !== 'accepted') throw new Error('仅已接受报价可以转为合同');
const existing = await ctx.api.object('forge_sales_contract').find({ where: { quotation_id: id } });
if (existing.length) throw new Error('该报价已转换为合同');
const lines = await ctx.api.object('forge_quotation_line').find({ where: { quotation_id: id } });
if (!lines.length) throw new Error('报价至少需要一条明细');
let contractId = null;
{
  const created = await ctx.api.object('forge_sales_contract').insert({
    name: ctx.input.name, code: ctx.input.code, contract_type_id: ctx.input.contract_type_id,
    customer_id: quote.customer_id, contact_id: quote.contact_id || null, quotation_id: id,
    signed_on: ctx.input.starts_on, starts_on: ctx.input.starts_on, ends_on: ctx.input.ends_on,
    responsible_id: quote.responsible_id, total_amount: Number(quote.total_amount || 0),
    has_order_amount_limit: true, order_amount_limit: Number(quote.total_amount || 0),
    outside_item_requires_approval: true, revenue_trigger: 'shipment',
    business_terms: quote.business_terms || null, remarks: '由报价 ' + quote.code + ' 转换生成',
  });
  contractId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
  if (!contractId) throw new Error('合同创建后未返回记录ID');
  for (const line of lines) {
    await ctx.api.object('forge_sales_contract_line').insert({
      name: line.name, contract_id: contractId, quotation_line_id: line.id, sku_id: line.sku_id,
      item_code: line.item_code || null, model: line.model || null, specification: line.specification || null,
      unit_name: line.unit_name || null, quantity_limit: Number(line.quantity || 0), ordered_quantity: 0,
      taxed_unit_price: Number(line.taxed_unit_price || 0), tax_rate: Number(line.tax_rate || 0),
      discount_rate: Number(line.discount_rate || 0), taxed_subtotal: Number(line.taxed_subtotal || 0),
      remarks: line.remarks || null,
    });
  }
}
return { id: contractId, quotation_id: id, line_count: lines.length };
`,
  },
});

export const ContractSubmit = defineAction({
  name: 'contract_submit', label: '提交审批', objectName: 'forge_sales_contract', icon: 'send', locations: [...locations], order: 10,
  requiredPermissions: ['sales_contract_operator'],
  visible: `record.status == 'draft'`, confirmText: '提交前将校验来源报价和合同金额，是否继续？', refreshAfter: true,
  successMessage: '合同已提交审批',
  body: {
    language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
if (ctx.recordLoadDenied === true || !id) throw new Error('当前合同不存在或不可访问');
const record = ctx.record;
if (!record || record.status !== 'draft') throw new Error('合同状态已变化，请刷新后重试');
if (record.quotation_id) {
  const quote = await ctx.api.object('forge_quotation').findOne({ where: { id: record.quotation_id } });
  if (!quote || quote.status !== 'accepted') throw new Error('来源报价需为已接受状态');
}
const lines = await ctx.api.object('forge_sales_contract_line').find({ where: { contract_id: id } });
if (!lines.length) throw new Error('合同至少需要一条物料明细');
const now = Date.now();
const reviewerPositions = [
  ['contract_delivery_reviewer', '合同交付复核岗'],
  ['contract_commercial_reviewer', '合同商务复核岗'],
];
const reviewerUsers = [];
for (const [position, label] of reviewerPositions) {
  const assignments = await ctx.api.object('sys_user_position').find({ where: { position } });
  const active = assignments.filter(item => {
    const from = item.valid_from ? Date.parse(item.valid_from) : Number.NEGATIVE_INFINITY;
    const until = item.valid_until ? Date.parse(item.valid_until) : Number.POSITIVE_INFINITY;
    return from <= now && now < until;
  });
  if (!active.length) throw new Error('未配置' + label + '，请先在系统设置中为员工分配该岗位');
  if (active.length > 1) throw new Error(label + '当前有多名员工，请先明确本次合同的复核负责人');
  reviewerUsers.push(active[0].user_id);
}
if (reviewerUsers[0] === reviewerUsers[1]) throw new Error('交付复核与商务复核必须由不同员工承担');
const total = Math.round(lines.reduce((sum, line) => sum + Number(line.taxed_subtotal || 0), 0) * 10000) / 10000;
await ctx.api.object('forge_sales_contract').update({ id, total_amount: total, status: 'pending_approval' });
return { id, total_amount: total, status: 'pending_approval', routed: true };
`,
  },
});

export const ContractSubmitFrozenMaterial = defineAction({
  name: 'contract_submit_frozen_material', label: '提交指定合同版本', objectName: 'forge_sales_contract', icon: 'file-check',
  locations: ['record_more'], visible: false,
  requiredPermissions: ['sales_contract_operator'],
  ai: {
    exposed: true,
    description: '把员工本次明确授权的已冻结合同文件绑定到草稿合同并提交正式审批。必须使用本次工作材料中的 Forge 文件标识、文件名和 SHA-256；相同文件重复调用只返回原提交结果，不会重复发起审批。',
    category: 'action',
    requiresConfirmation: false,
  },
  params: [
    { name: 'material_file_id', label: '合同文件', type: 'text', required: true },
    { name: 'material_name', label: '文件名称', type: 'text', required: true },
    { name: 'material_sha256', label: '文件 SHA-256', type: 'text', required: true },
  ],
  body: {
    language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
if (ctx.recordLoadDenied === true || !id || !ctx.record) throw new Error('当前合同不存在或不可访问');
const record = ctx.record;
const fileId = String(ctx.input.material_file_id || '').trim();
const materialName = String(ctx.input.material_name || '').trim();
const sha256 = String(ctx.input.material_sha256 || '').trim().toLowerCase();
const storedFileId = value => {
  if (typeof value !== 'string') return value && typeof value === 'object' ? String(value.id || '') : '';
  const text = value.trim();
  if (!text.startsWith('"')) return text;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'string' ? parsed : '';
  } catch { return ''; }
};
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fileId)) throw new Error('合同文件标识无效');
if (!materialName || materialName.length > 255) throw new Error('合同文件名称无效');
if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('合同文件摘要无效');
if (record.submitted_material_id || record.submitted_material_sha256) {
  if (storedFileId(record.submitted_material_id) === fileId && record.submitted_material_sha256 === sha256 && record.submitted_material_name === materialName) {
    return { id, status: record.status, material_file_id: fileId, material_name: materialName, material_sha256: sha256, repeated: true };
  }
  throw new Error('当前合同已经绑定另一份提交版本，请刷新合同后处理');
}
if (record.status !== 'draft') throw new Error('仅草稿合同可以提交正式审批');
const actor = ctx.session && ctx.session.userId;
if (!actor) throw new Error('无法识别当前提交人');
const file = await ctx.api.object('sys_file').findOne({ where: { id: fileId } });
if (!file || file.status !== 'committed') throw new Error('本次合同文件不存在或尚未上传完成');
if (file.owner_id && file.owner_id !== actor) throw new Error('本次合同文件不属于当前员工');
if (file.name !== materialName) throw new Error('合同文件名称与冻结材料不一致');
if (record.quotation_id) {
  const quote = await ctx.api.object('forge_quotation').findOne({ where: { id: record.quotation_id } });
  if (!quote || quote.status !== 'accepted') throw new Error('来源报价需为已接受状态');
}
const lines = await ctx.api.object('forge_sales_contract_line').find({ where: { contract_id: id } });
if (!lines.length) throw new Error('合同至少需要一条物料明细');
const nowMs = Date.now();
const reviewerPositions = [
  ['contract_delivery_reviewer', '合同交付复核岗'],
  ['contract_commercial_reviewer', '合同商务复核岗'],
];
const reviewerUsers = [];
for (const [position, label] of reviewerPositions) {
  const assignments = await ctx.api.object('sys_user_position').find({ where: { position } });
  const active = assignments.filter(item => {
    const from = item.valid_from ? Date.parse(item.valid_from) : Number.NEGATIVE_INFINITY;
    const until = item.valid_until ? Date.parse(item.valid_until) : Number.POSITIVE_INFINITY;
    return from <= nowMs && nowMs < until;
  });
  if (!active.length) throw new Error('未配置' + label + '，请先在系统设置中为员工分配该岗位');
  if (active.length > 1) throw new Error(label + '当前有多名员工，请先明确本次合同的复核负责人');
  reviewerUsers.push(active[0].user_id);
}
if (reviewerUsers[0] === reviewerUsers[1]) throw new Error('交付复核与商务复核必须由不同员工承担');
const total = Math.round(lines.reduce((sum, line) => sum + Number(line.taxed_subtotal || 0), 0) * 10000) / 10000;
const submittedAt = new Date().toISOString();
let outcome;
try {
  outcome = await ctx.api.transaction(async () => {
    const current = await ctx.api.object('forge_sales_contract').findOne({ where: { id } });
    if (!current) throw new Error('当前合同不存在或不可访问');
    const submission = await ctx.api.object('forge_sales_contract_submission').findOne({ where: { contract_id: id } });
    if (submission || current.submitted_material_id || current.submitted_material_sha256) {
      const sameMaterial = submission
        ? submission.material_file_id === fileId && submission.material_sha256 === sha256 && submission.material_name === materialName
        : storedFileId(current.submitted_material_id) === fileId && current.submitted_material_sha256 === sha256 && current.submitted_material_name === materialName;
      if (sameMaterial) return { repeated: true, status: current.status, submitted_at: current.submitted_at || submission.submitted_at };
      throw new Error('当前合同已经绑定另一份提交版本，请刷新合同后处理');
    }
    if (current.status !== 'draft') throw new Error('仅草稿合同可以提交正式审批');
    await ctx.api.object('forge_sales_contract_submission').insert({
      name: String(current.code || current.name || '合同') + ' 首次提交', contract_id: id,
      material_file_id: fileId, material_name: materialName, material_sha256: sha256,
      submitted_by: actor, submitted_at: submittedAt,
    });
    await ctx.api.object('forge_sales_contract').update({
      id, total_amount: total, status: 'pending_approval',
      submitted_material_id: fileId, submitted_material_name: materialName,
      submitted_material_sha256: sha256, submitted_at: submittedAt,
    });
    return { repeated: false, status: 'pending_approval', submitted_at: submittedAt };
  });
} catch (error) {
  const current = await ctx.api.object('forge_sales_contract').findOne({ where: { id } });
  const submission = await ctx.api.object('forge_sales_contract_submission').findOne({ where: { contract_id: id } });
  if (current && submission && current.status === 'pending_approval' && submission.material_file_id === fileId && submission.material_sha256 === sha256 && submission.material_name === materialName) {
    outcome = { repeated: true, status: current.status, submitted_at: current.submitted_at || submission.submitted_at };
  } else if (submission && (submission.material_file_id !== fileId || submission.material_sha256 !== sha256 || submission.material_name !== materialName)) {
    throw new Error('当前合同已经绑定另一份提交版本，请刷新合同后处理');
  } else {
    throw error;
  }
}
const saved = await ctx.api.object('forge_sales_contract').findOne({ where: { id } });
if (!saved || storedFileId(saved.submitted_material_id) !== fileId || saved.submitted_material_sha256 !== sha256 || saved.status !== 'pending_approval') {
  throw new Error('合同提交结果与本次固定材料不一致，请核对后重试');
}
return { id, total_amount: saved.total_amount, status: saved.status, material_file_id: fileId, material_name: materialName, material_sha256: sha256, submitted_at: outcome.submitted_at, repeated: outcome.repeated };
`,
  },
});

export const ContractBindRevisionAttachments = defineAction({
  name: 'contract_bind_revision_attachments', label: '绑定合同修订附件', objectName: 'forge_sales_contract', icon: 'paperclip',
  locations: ['record_more'], visible: false,
  requiredPermissions: ['sales_contract_operator'],
  ai: {
    exposed: true,
    description: '仅在原合同审批已退回修改时，把本次冻结的配套文件绑定到合同，供下一轮人工复核。输入为本次工作中每个 Forge 文件的标识、名称和 SHA-256 组成的 JSON 数组。此动作只绑定附件，不重新提交审批；相同退回轮次重复绑定同一清单只返回原结果。',
    category: 'action', requiresConfirmation: false,
  },
  params: [
    { name: 'attachment_manifest', label: '冻结附件清单', type: 'text', required: true },
  ],
  body: {
    language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
if (ctx.recordLoadDenied === true || !id || !ctx.record) throw new Error('当前合同不存在或不可访问');
const actor = ctx.session && ctx.session.userId;
if (!actor) throw new Error('无法识别当前员工');
let manifest;
try { manifest = JSON.parse(String(ctx.input.attachment_manifest || '')); }
catch { throw new Error('修订附件清单不是有效的 JSON'); }
if (!Array.isArray(manifest) || manifest.length < 1 || manifest.length > 10) throw new Error('请提供 1 至 10 份配套文件');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;
const files = manifest.map(item => ({
  file_id: String(item && item.file_id || '').trim(),
  name: String(item && item.name || '').trim(),
  sha256: String(item && item.sha256 || '').trim().toLowerCase(),
}));
if (files.some(item => !uuid.test(item.file_id) || !item.name || item.name.length > 255 || !digest.test(item.sha256))) throw new Error('修订附件的标识、名称或摘要无效');
if (new Set(files.map(item => item.file_id)).size !== files.length) throw new Error('修订附件不能重复');
files.sort((a, b) => a.file_id.localeCompare(b.file_id));
const canonical = JSON.stringify(files);
for (const item of files) {
  const file = await ctx.api.object('sys_file').findOne({ where: { id: item.file_id } });
  if (!file || file.status !== 'committed' || file.owner_id !== actor || file.name !== item.name) throw new Error('修订附件不存在、未上传完成或不属于当前员工');
}
const requests = await ctx.api.object('sys_approval_request').find({ where: { object_name: 'forge_sales_contract', record_id: id } });
const latest = [...requests].sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))[0];
if (!latest || latest.status !== 'returned' || latest.submitter_id !== actor) throw new Error('当前合同没有属于本人的待修订审批');
let repeated = false;
await ctx.api.transaction(async () => {
  const approval = await ctx.api.object('sys_approval_request').findOne({ where: { id: latest.id } });
  if (!approval || approval.status !== 'returned' || approval.submitter_id !== actor) throw new Error('审批已变化，请刷新后重试');
  const current = await ctx.api.object('forge_sales_contract').findOne({ where: { id } });
  if (!current || current.status !== 'pending_approval' || !current.submitted_material_id) throw new Error('合同状态或主文件已变化，请刷新后重试');
  const boundRound = String(current.submitted_attachment_revision_request_id || '');
  if (boundRound === latest.id) {
    if (current.submitted_attachment_manifest !== canonical) throw new Error('本轮已经绑定另一份附件清单，请重新核对');
    repeated = true;
    return;
  }
  await ctx.api.object('forge_sales_contract').update({
    id, attachment_ids: files.map(item => item.file_id),
    submitted_attachment_manifest: canonical,
    submitted_attachment_revision_request_id: latest.id,
  });
});
const saved = await ctx.api.object('forge_sales_contract').findOne({ where: { id } });
if (!saved || saved.submitted_attachment_revision_request_id !== latest.id || saved.submitted_attachment_manifest !== canonical) throw new Error('修订附件绑定结果尚未确认，请先核对合同再重试');
return { id, revision_request_id: latest.id, attachment_count: files.length, attachment_manifest: canonical, repeated };
`,
  },
});

export const SalesOrderSubmit = defineAction({
  name: 'sales_order_submit', label: '提交审批', objectName: 'forge_sales_order', icon: 'send', locations: [...locations], order: 10,
  visible: `record.status == 'draft'`, confirmText: '提交前将校验合同额度和物料数量，是否继续？', refreshAfter: true,
  successMessage: '销售订单已提交审批',
  body: {
    language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
if (ctx.recordLoadDenied === true || !id) throw new Error('当前订单不存在或不可访问');
const record = ctx.record;
if (!record || record.status !== 'draft') throw new Error('订单状态已变化，请刷新后重试');
const lines = await ctx.api.object('forge_sales_order_line').find({ where: { order_id: id } });
if (!lines.length) throw new Error('订单至少需要一条物料明细');
const total = Math.round(lines.reduce((sum, line) => sum + Number(line.taxed_subtotal || 0), 0) * 10000) / 10000;
if (record.source_type === 'contract') {
  if (!record.contract_id) throw new Error('关联合同订单必须选择合同');
  const contract = await ctx.api.object('forge_sales_contract').findOne({ where: { id: record.contract_id } });
  if (!contract || contract.status !== 'active') throw new Error('关联合同需为执行中状态');
  if (contract.has_order_amount_limit && Number(contract.ordered_amount || 0) + total > Number(contract.order_amount_limit || 0)) {
    throw new Error('订单金额超过合同剩余额度');
  }
  const contractLines = await ctx.api.object('forge_sales_contract_line').find({ where: { contract_id: record.contract_id } });
  const limits = new Map(contractLines.map(line => [line.id, line]));
  for (const line of lines) {
    const contractLine = limits.get(line.contract_line_id);
    if (!contractLine) throw new Error('订单明细必须来自当前合同清单');
    if (Number(contractLine.ordered_quantity || 0) + Number(line.quantity || 0) > Number(contractLine.quantity_limit || 0)) {
      throw new Error('订单物料数量超过合同剩余数量');
    }
  }
}
await ctx.api.object('forge_sales_order').update({ id, total_amount: total, status: 'pending_approval' });
return { id, total_amount: total, status: 'pending_approval' };
`,
  },
});

export const SalesOrderApprove = defineAction({
  name: 'sales_order_approve', label: '同意', objectName: 'forge_sales_order', icon: 'circle-check', locations: [...locations], order: 10,
  visible: `record.status == 'pending_approval'`, confirmText: '确认同意并开始执行这张订单？', refreshAfter: true,
  successMessage: '订单审批通过，合同执行进度已更新',
  body: {
    language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
if (ctx.recordLoadDenied === true || !id) throw new Error('当前订单不存在或不可访问');
const record = ctx.record;
if (!record || record.status !== 'pending_approval') throw new Error('订单状态已变化，请刷新后重试');
{
  await ctx.api.object('forge_sales_order').update({ id, status: 'active' });
  if (!record.contract_id) return;
  const orders = await ctx.api.object('forge_sales_order').find({ where: { contract_id: record.contract_id } });
  const activeOrders = orders.filter(order => ['approved', 'active', 'partially_shipped', 'shipped', 'completed'].includes(order.status));
  const orderedAmount = Math.round(activeOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0) * 10000) / 10000;
  const quantities = new Map();
  for (const order of activeOrders) {
    const orderLines = await ctx.api.object('forge_sales_order_line').find({ where: { order_id: order.id } });
    for (const line of orderLines) {
      if (!line.contract_line_id) continue;
      quantities.set(line.contract_line_id, Number(quantities.get(line.contract_line_id) || 0) + Number(line.quantity || 0));
    }
  }
  const contractLines = await ctx.api.object('forge_sales_contract_line').find({ where: { contract_id: record.contract_id } });
  for (const line of contractLines) {
    await ctx.api.object('forge_sales_contract_line').update({ id: line.id, ordered_quantity: Number(quantities.get(line.id) || 0) });
  }
  await ctx.api.object('forge_sales_contract').update({ id: record.contract_id,
    ordered_count: activeOrders.length, ordered_amount: orderedAmount, status: 'active'
  });
}
return { id, status: 'active', contract_id: record.contract_id || null };
`,
  },
});

export const SalesOrderCreateShipment = defineAction({
  name: 'sales_order_create_shipment', label: '创建发货单', objectName: 'forge_sales_order', icon: 'package-check',
  locations: [...locations], order: 20, visible: `record.status == 'active' || record.status == 'partially_shipped'`, refreshAfter: true,
  description: '从执行中订单创建一张分批发货计划；建单不会改变库存或已发货数量。', successMessage: '发货单与发货明细已创建',
  params: [
    { field: 'code', objectOverride: 'forge_sales_shipment', required: true },
    { field: 'shipment_on', objectOverride: 'forge_sales_shipment', required: true },
    { field: 'recipient', objectOverride: 'forge_sales_shipment', required: true },
    { field: 'recipient_phone', objectOverride: 'forge_sales_shipment' },
    { field: 'delivery_address', objectOverride: 'forge_sales_shipment', required: true },
    { field: 'quantity', objectOverride: 'forge_sales_shipment_line', required: true },
    { field: 'remarks', objectOverride: 'forge_sales_shipment' },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.sales/forge_sales_shipment/record/${result.id}' },
  body: {
    language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
const order = ctx.record;
if (ctx.recordLoadDenied === true || !id || !order) throw new Error('当前订单不存在或不可访问');
if (!['active', 'partially_shipped'].includes(order.status)) throw new Error('仅执行中或部分发货订单可以创建发货单');
const orderLines = await ctx.api.object('forge_sales_order_line').find({ where: { order_id: id } });
if (orderLines.length !== 1) throw new Error('当前切片仅支持单条物料明细订单分批建单');
const orderLine = orderLines[0];
const requested = Number(ctx.input.quantity || 0);
if (!(requested > 0)) throw new Error('本次发货数量必须大于0');
const existingLines = await ctx.api.object('forge_sales_shipment_line').find({ where: { order_line_id: orderLine.id } });
let plannedQuantity = 0, plannedAmount = 0;
const activeShipmentIds = new Set();
for (const line of existingLines) {
  const shipment = await ctx.api.object('forge_sales_shipment').findOne({ where: { id: line.shipment_id } });
  if (!shipment || shipment.status === 'cancelled') continue;
  plannedQuantity += Number(line.quantity || 0);
  plannedAmount += Number(line.taxed_subtotal || 0);
  activeShipmentIds.add(shipment.id);
}
const remaining = Number(orderLine.quantity || 0) - plannedQuantity;
if (requested > remaining) throw new Error('本次发货数量超过订单未建单数量');
const round4 = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
const lineUnitAmount = round4(Number(orderLine.taxed_subtotal || 0) / Number(orderLine.quantity || 1));
const lineAmount = round4(lineUnitAmount * requested);
let shipmentId = null;
const created = await ctx.api.object('forge_sales_shipment').insert({
    name: order.code + ' 发货 ' + ctx.input.code, code: ctx.input.code, customer_id: order.customer_id,
    contact_id: order.contact_id || null, shipment_on: ctx.input.shipment_on,
    recipient: ctx.input.recipient, recipient_phone: ctx.input.recipient_phone || null,
    delivery_address: ctx.input.delivery_address, total_amount: lineAmount, total_quantity: requested,
    outbound_quantity: 0, outbound_count: 0, responsible_id: order.responsible_id,
    remarks: ctx.input.remarks || ('由销售订单 ' + order.code + ' 创建'),
});

shipmentId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
if (!shipmentId) throw new Error('发货单创建后未返回记录ID');
await ctx.api.object('forge_sales_shipment_line').insert({
    name: orderLine.name, shipment_id: shipmentId, order_id: id, order_line_id: orderLine.id,
    sku_id: orderLine.sku_id, item_code: orderLine.item_code || null, model: orderLine.model || null,
    specification: orderLine.specification || null, unit_name: orderLine.unit_name || null,
    quantity: requested, outbound_quantity: 0, taxed_unit_price: lineUnitAmount,
    taxed_subtotal: lineAmount, remarks: orderLine.remarks || null,
});

await ctx.api.object('forge_sales_order').update({ id,
  shipment_count: activeShipmentIds.size + 1, planned_shipment_amount: round4(plannedAmount + lineAmount)
});
return { id: shipmentId, order_id: id, quantity: requested, total_amount: lineAmount, remaining_quantity: round4(remaining - requested) };
`,
  },
});

export const SalesShipmentCreateOutbound = defineAction({
  name: 'sales_shipment_create_outbound', label: '确认发货', objectName: 'forge_sales_shipment', icon: 'truck',
  locations: [...locations], order: 20, visible: `record.status == 'pending_shipment' || record.status == 'partially_outbounded'`, refreshAfter: true,
  description: '校验可用库存后创建出库单，并回写发货单、订单的出库进度。', successMessage: '出库单已创建，发货进度已更新',
  params: [
    { field: 'code', objectOverride: 'forge_sales_outbound', required: true }, { field: 'warehouse_id', objectOverride: 'forge_sales_outbound', required: true },
    { field: 'outbound_on', objectOverride: 'forge_sales_outbound', required: true }, { field: 'quantity', objectOverride: 'forge_sales_outbound', required: true },
    { field: 'customer_pickup', objectOverride: 'forge_sales_outbound' },
    { field: 'remarks', objectOverride: 'forge_sales_outbound' },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.supply-chain/forge_sales_outbound/record/${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const shipment = ctx.record;
if (ctx.recordLoadDenied === true || !id || !shipment) throw new Error('当前发货单不存在或不可访问');
if (!['pending_shipment', 'partially_outbounded'].includes(shipment.status)) throw new Error('发货单状态已变化，请刷新后重试');
const lines = await ctx.api.object('forge_sales_shipment_line').find({ where: { shipment_id: id } }); if (lines.length !== 1) throw new Error('当前切片仅支持单条物料明细发货单');
const line = lines[0], quantity = Number(ctx.input.quantity || 0), already = Number(shipment.outbound_quantity || 0);
if (!(quantity > 0)) throw new Error('本次出库数量必须大于0'); if (quantity + already > Number(shipment.total_quantity || 0)) throw new Error('本次出库数量超过发货单剩余数量');
const round4 = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
const balanceKey = ctx.input.warehouse_id + ':' + line.sku_id;
const balances = await ctx.api.object('forge_inventory_balance').find({ where: { balance_key: balanceKey } });
if (balances.length > 1) throw new Error('同一仓库和物料存在重复库存余额');
if (!balances.length) throw new Error('出库仓库没有该物料的库存余额');
const balance = balances[0], available = Number(balance.available_quantity || 0), beforeOnHand = Number(balance.on_hand_quantity || 0), reserved = Number(balance.reserved_quantity || 0), unitCost = Number(balance.average_cost || 0), beforeValue = Number(balance.inventory_value || 0);
if (quantity > available || quantity > beforeOnHand) throw new Error('可用库存不足，无法创建出库单');
const afterOnHand = round4(beforeOnHand - quantity), afterAvailable = round4(available - quantity), inventoryAmount = round4(quantity * unitCost), afterValue = Math.max(0, round4(beforeValue - inventoryAmount));
const nextStatus = quantity + already >= Number(shipment.total_quantity || 0) ? 'outbounded' : 'partially_outbounded';
const created = await ctx.api.object('forge_sales_outbound').insert({ name: shipment.name + ' 出库 ' + ctx.input.code, code: ctx.input.code, shipment_id: id, order_id: line.order_id, warehouse_id: ctx.input.warehouse_id, sku_id: line.sku_id, outbound_on: ctx.input.outbound_on, quantity, customer_pickup: Boolean(ctx.input.customer_pickup), recipient: shipment.recipient, recipient_phone: shipment.recipient_phone || null, delivery_address: shipment.delivery_address, available_quantity: available, before_on_hand: beforeOnHand, after_on_hand: afterOnHand, unit_cost: unitCost, inventory_amount: inventoryAmount, status: 'outbounded', responsible_id: shipment.responsible_id, remarks: ctx.input.remarks || ('由发货单 ' + shipment.code + ' 创建') });
const outboundId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id)); if (!outboundId) throw new Error('出库单创建后未返回记录ID');
const occurredAt = new Date().toISOString();
await ctx.api.object('forge_inventory_balance').update({ id: balance.id, on_hand_quantity: afterOnHand, reserved_quantity: reserved, available_quantity: afterAvailable, average_cost: unitCost, inventory_value: afterValue, last_movement_at: occurredAt });
await ctx.api.object('forge_inventory_ledger').insert({ name: ctx.input.code + ' ' + line.name + ' 出库', code: ctx.input.code + '-001', warehouse_id: ctx.input.warehouse_id, sku_id: line.sku_id, direction: 'outbound', movement_type: 'sales_outbound', quantity, before_on_hand: beforeOnHand, after_on_hand: afterOnHand, before_available: available, after_available: afterAvailable, unit_cost: unitCost, amount: inventoryAmount, occurred_at: occurredAt, source_object: 'forge_sales_outbound', source_id: outboundId, source_line_id: line.id, responsible_id: shipment.responsible_id, remarks: ctx.input.remarks || ('由发货单 ' + shipment.code + ' 创建') });
const order = await ctx.api.object('forge_sales_order').findOne({ where: { id: line.order_id } }); const orderLines = await ctx.api.object('forge_sales_order_line').find({ where: { order_id: line.order_id } });
const orderLine = orderLines.find(item => item.id === line.order_line_id); if (!orderLine) throw new Error('发货单关联的销售订单明细不存在');
const shipped = Number(orderLines.reduce((sum, item) => sum + Number(item.shipped_quantity || 0), 0)) + quantity;
await ctx.api.object('forge_sales_shipment').update({ id, outbound_quantity: already + quantity, outbound_count: Number(shipment.outbound_count || 0) + 1, status: nextStatus }); await ctx.api.object('forge_sales_shipment_line').update({ id: line.id, outbound_quantity: Number(line.outbound_quantity || 0) + quantity }); await ctx.api.object('forge_sales_order_line').update({ id: line.order_line_id, shipped_quantity: Number(orderLine.shipped_quantity || 0) + quantity });
if (order) { const shippedUnitAmount = round4(Number(line.taxed_subtotal || 0) / Number(line.quantity || 1)); await ctx.api.object('forge_sales_order').update({ id: order.id, shipped_amount: round4(Number(order.shipped_amount || 0) + quantity * shippedUnitAmount), status: shipped >= Number(orderLines.reduce((sum, item) => sum + Number(item.quantity || 0), 0)) ? 'shipped' : 'partially_shipped' }); }
return { id: outboundId, shipment_id: id, quantity, status: nextStatus };
` },
});

export const ContractConvertToSalesOrder = defineAction({
  name: 'contract_convert_to_sales_order', label: '创建销售订单', objectName: 'forge_sales_contract', icon: 'clipboard-list',
  locations: [...locations], order: 20, visible: `record.status == 'active'`, refreshAfter: true,
  description: '按合同当前未下单数量建立销售订单。', successMessage: '销售订单与订单明细已创建',
  params: [
    { field: 'code', objectOverride: 'forge_sales_order', required: true },
    { field: 'name', objectOverride: 'forge_sales_order', required: true },
    { field: 'planned_delivery_on', objectOverride: 'forge_sales_order', required: true },
    { field: 'payment_term', objectOverride: 'forge_sales_order', required: true },
    { field: 'payment_method', objectOverride: 'forge_sales_order', required: true, defaultValue: 'bank_transfer' },
    { field: 'delivery_address', objectOverride: 'forge_sales_order' },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.sales/forge_sales_order/record/${result.id}' },
  body: {
    language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
const contract = ctx.record;
if (ctx.recordLoadDenied === true || !id || !contract) throw new Error('当前合同不存在或不可访问');
if (contract.status !== 'active') throw new Error('仅执行中合同可以创建销售订单');
const existing = await ctx.api.object('forge_sales_order').find({ where: { contract_id: id } });
if (existing.some(order => order.status !== 'cancelled')) throw new Error('该合同已有未取消的销售订单');
const lines = await ctx.api.object('forge_sales_contract_line').find({ where: { contract_id: id } });
const remaining = lines.map(line => ({ line, quantity: Number(line.quantity_limit || 0) - Number(line.ordered_quantity || 0) }))
  .filter(item => item.quantity > 0);
if (!remaining.length) throw new Error('合同没有可下单的剩余数量');
const round4 = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
let orderId = null;
let total = 0;
for (const item of remaining) total += Number(item.line.taxed_subtotal || 0) * item.quantity / Number(item.line.quantity_limit || 1);
total = round4(total);
{
  const created = await ctx.api.object('forge_sales_order').insert({
    name: ctx.input.name, code: ctx.input.code, source_type: 'contract', customer_id: contract.customer_id,
    contact_id: contract.contact_id || null, contract_id: id, quotation_id: contract.quotation_id || null,
    planned_delivery_on: ctx.input.planned_delivery_on, responsible_id: contract.responsible_id,
    payment_term: ctx.input.payment_term, payment_method: ctx.input.payment_method,
    revenue_trigger: contract.revenue_trigger || 'shipment', total_amount: total,
    delivery_address: ctx.input.delivery_address || null, remarks: '由合同 ' + contract.code + ' 转换生成',
  });
  orderId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
  if (!orderId) throw new Error('订单创建后未返回记录ID');
  for (const item of remaining) {
    const line = item.line;
    const lineTotal = round4(Number(line.taxed_subtotal || 0) * item.quantity / Number(line.quantity_limit || 1));
    const rate = Number(line.tax_rate || 0) / 100;
    await ctx.api.object('forge_sales_order_line').insert({
      name: line.name, order_id: orderId, contract_line_id: line.id, quotation_line_id: line.quotation_line_id || null,
      sku_id: line.sku_id, item_code: line.item_code || null, model: line.model || null,
      specification: line.specification || null, unit_name: line.unit_name || null, quantity: item.quantity,
      shipped_quantity: 0, invoiced_quantity: 0, taxed_unit_price: Number(line.taxed_unit_price || 0),
      untaxed_unit_price: rate > 0 ? round4(Number(line.taxed_unit_price || 0) / (1 + rate)) : Number(line.taxed_unit_price || 0),
      tax_rate: Number(line.tax_rate || 0), discount_rate: Number(line.discount_rate || 0),
      taxed_subtotal: lineTotal, planned_delivery_on: ctx.input.planned_delivery_on, remarks: line.remarks || null,
    });
  }
}
return { id: orderId, contract_id: id, line_count: remaining.length, total_amount: total };
`,
  },
});

const serviceOrderTransitionBody = (from: string, to: string, extraSource = '') => ({
  language: 'js' as const,
  capabilities: ['api.write' as const],
  source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
const record = ctx.record;
if (ctx.recordLoadDenied === true || !id || !record) throw new Error('当前服务工单不存在或不可访问');
if (record.status !== '${from}') throw new Error('工单状态已变化，请刷新后重试');
const now = new Date().toISOString();
const patch = { id, status: '${to}' };
${extraSource}
await ctx.api.object('forge_service_order').update(patch);
return { id, status: '${to}' };
`,
});

export const ServiceOrderAccept = defineAction({
  name: 'service_order_accept', label: '受理', objectName: 'forge_service_order', icon: 'circle-check', locations: [...locations], order: 10,
  visible: `record.status == 'pending_acceptance'`, confirmText: '确认受理该服务工单并进入派工？', refreshAfter: true,
  successMessage: '服务工单已受理，等待派工',
  body: serviceOrderTransitionBody('pending_acceptance', 'pending_dispatch', `patch.accepted_at = now; patch.next_step = '派工';`),
});

export const ServiceOrderDispatch = defineAction({
  name: 'service_order_dispatch', label: '派工', objectName: 'forge_service_order', icon: 'route', locations: [...locations], order: 20,
  visible: `record.status == 'pending_dispatch'`, refreshAfter: true,
  successMessage: '服务工单已派工，等待工程师接单',
  params: [
    { field: 'engineer_name', objectOverride: 'forge_service_order', required: true },
    { field: 'scheduled_at', objectOverride: 'forge_service_order' },
    { field: 'dispatch_note', objectOverride: 'forge_service_order', required: true },
  ],
  body: serviceOrderTransitionBody('pending_dispatch', 'pending_receive', `
const engineerName = String(ctx.input.engineer_name || '').trim();
const note = String(ctx.input.dispatch_note || '').trim();
if (!engineerName) throw new Error('请选择或填写服务工程师');
if (!note) throw new Error('派工说明不能为空');
patch.engineer_name = engineerName;
patch.scheduled_at = ctx.input.scheduled_at || null;
patch.dispatch_note = note;
patch.dispatched_at = now;
patch.next_step = '工程师接单';
`),
});

export const ServiceOrderEngineerAccept = defineAction({
  name: 'service_order_engineer_accept', label: '工程师接单', objectName: 'forge_service_order', icon: 'wrench', locations: [...locations], order: 30,
  visible: `record.status == 'pending_receive'`, confirmText: '确认工程师已接单并开始服务？', refreshAfter: true,
  successMessage: '工程师已接单，工单进入服务中',
  body: serviceOrderTransitionBody('pending_receive', 'in_progress', `patch.received_at = now; patch.next_step = '处理记录 / 到场签到 / 提交服务结果';`),
});


export const SalesLeadConvertToOpportunity = defineAction({
  name: 'sales_lead_convert_to_opportunity', label: '转为商机', objectName: 'forge_sales_lead', icon: 'sparkles', locations: [...locations], order: 10,
  requiredPermissions: ['sales_lead_convert'],
  visible: `record.status == 'new' || record.status == 'following' || record.status == 'public_pool'`, refreshAfter: true,
  description: '确认后会将线索转为客户档案和销售商机。', successMessage: '线索已转为客户和商机',
  ai: {
    exposed: true,
    description: '将当前员工可处理且尚未转化的线索转为客户和商机；同一线索与相同金额、预计成交日期重复调用时返回原关联，不同输入或失效状态会被拒绝。',
    category: 'action',
    requiresConfirmation: false,
  },
  params: [{ field: 'amount', objectOverride: 'forge_sales_opportunity' }, { field: 'expected_close_on', objectOverride: 'forge_sales_opportunity' }],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = String(ctx.recordId || (ctx.record && ctx.record.id) || '').trim();
if (ctx.recordLoadDenied === true || !id || !ctx.record) throw new Error('当前线索不存在或不可访问');
const params = ctx.input || {};
const amount = params.amount === undefined || params.amount === null || params.amount === '' ? 0 : Number(params.amount);
if (!Number.isFinite(amount) || amount < 0) throw new Error('商机金额必须是大于或等于零的数字');
const expectedCloseOn = params.expected_close_on || null;
const requestSignature = JSON.stringify({ amount, expected_close_on: expectedCloseOn });
const leadObject = ctx.api.object('forge_sales_lead');
const opportunityObject = ctx.api.object('forge_sales_opportunity');
const customerObject = ctx.api.object('forge_customer');

const existingResult = async lead => {
  if (!lead || lead.status !== 'converted') throw new Error('当前线索状态已变化，不能继续转化，请刷新后核对');
  if (!lead.conversion_request_signature) throw new Error('该线索已转化，但缺少原转化输入记录；请先核对已关联商机，不能再次创建');
  if (lead.conversion_request_signature !== requestSignature) throw new Error('该线索已按不同金额或预计成交日期转化；请刷新并核对现有商机');
  const customerId = lead.converted_customer_id;
  const opportunityId = lead.converted_opportunity_id;
  if (!customerId || !opportunityId) throw new Error('该线索的转化关系不完整；请先核对客户和商机记录');
  const opportunity = await opportunityObject.findOne({ where: { id: opportunityId } });
  if (!opportunity || opportunity.lead_id !== id || opportunity.customer_id !== customerId) {
    throw new Error('该线索的客户与商机关联已变化；请先核对现有业务记录');
  }
  return { id, status: 'converted', customer_id: customerId, opportunity_id: opportunityId };
};

try {
  return await ctx.api.transaction(async () => {
    const lead = await leadObject.findOne({ where: { id } });
    if (!lead) throw new Error('当前线索不存在或不可访问');
    if (lead.status === 'converted') return existingResult(lead);
    if (!['new', 'following', 'public_pool'].includes(lead.status)) throw new Error('当前线索状态已变化，不能转化，请刷新后核对');
    if (!lead.responsible_id) throw new Error('请先为线索指定负责人，再转化为商机');

    const linkedOpportunities = await opportunityObject.find({ where: { lead_id: id } });
    if (linkedOpportunities.length) throw new Error('该线索已存在关联商机，但转化关系不完整；请先核对记录，不会重复创建');

    const now = new Date().toISOString();
    const existingCustomers = await customerObject.find({ where: { name: lead.company_name }, fields: ['id', 'owner_id'] });
    if (existingCustomers.some(customer => String(customer.owner_id || '') !== String(lead.responsible_id))) {
      throw new Error('同名客户已归属其他销售，不能自动关联；请先核对客户归属');
    }
    if (existingCustomers.length > 1) throw new Error('存在多个同名客户，不能自动关联；请先核对客户记录');
    let customerId = existingCustomers[0]?.id || null;
    if (!customerId) {
      const categories = await ctx.api.object('forge_customer_category').find({ where: { code: 'CUST-CAT-PROJECT' } });
      const categoryId = categories[0]?.id || null;
      if (!categoryId) throw new Error('销售业务设置缺少项目客户分类；请先由管理员维护分类后再转化线索');
      const createdCustomer = await customerObject.insert({
        name: lead.company_name, customer_type: 'company', category_id: categoryId,
        owner_id: lead.responsible_id, responsible_id: lead.responsible_id, remarks: '由销售线索转入客户档案',
      });
      customerId = typeof createdCustomer === 'string' ? createdCustomer : createdCustomer && (createdCustomer.id || (createdCustomer.record && createdCustomer.record.id));
      if (!customerId) throw new Error('客户创建后未返回记录标识');
    }

    const createdOpportunity = await opportunityObject.insert({
      name: lead.company_name + ' 项目商机', customer_id: customerId, lead_id: id,
      contact_name: lead.contact_name || null, phone: lead.phone || null,
      stage: 'needs_confirmed', source: lead.source || '线索转化', description: lead.remarks || null,
      priority: 'medium', amount, win_rate: 30, expected_close_on: expectedCloseOn,
      owner_id: lead.responsible_id, responsible_id: lead.responsible_id,
    });
    const opportunityId = typeof createdOpportunity === 'string'
      ? createdOpportunity
      : createdOpportunity && (createdOpportunity.id || (createdOpportunity.record && createdOpportunity.record.id));
    if (!opportunityId) throw new Error('商机创建后未返回记录标识');

    await leadObject.update({
      id, status: 'converted', converted_customer_id: customerId,
      converted_opportunity_id: opportunityId, converted_at: now,
      conversion_request_signature: requestSignature,
    });
    return { id, status: 'converted', customer_id: customerId, opportunity_id: opportunityId };
  });
} catch (error) {
  // A concurrent identical request can lose the unique lead_id insert after
  // the winning transaction commits. Re-read the source and return its result
  // only when the persisted input signature matches this request.
  const current = await leadObject.findOne({ where: { id } });
  if (current && current.status === 'converted') return existingResult(current);
  throw error;
}
` },
});

export const SalesOpportunityAdvance = defineAction({
  name: 'sales_opportunity_advance', label: '推进阶段', objectName: 'forge_sales_opportunity', icon: 'arrow-right-circle', locations: [...locations], order: 10,
  visible: `record.stage != 'won' && record.stage != 'lost'`, refreshAfter: true, successMessage: '商机阶段已推进',
  params: [{ field: 'stage', objectOverride: 'forge_sales_opportunity', required: true }],
  body: { language: 'js', capabilities: ['api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const record = ctx.record;
if (ctx.recordLoadDenied === true || !id || !record) throw new Error('当前商机不存在或不可访问');
const allowed = ['initial_contact','needs_confirmed','proposal_quoted','negotiation','won','lost'];
const stage = String(ctx.input.stage || '').trim();
if (!allowed.includes(stage)) throw new Error('请选择有效商机阶段');
const patch = { id, stage };
if (stage === 'won') patch.win_rate = 100;
if (stage === 'lost') patch.win_rate = 0;
await ctx.api.object('forge_sales_opportunity').update(patch);
return { id, stage };
` },
});

export const CustomerPoolClaim = defineAction({
  name: 'customer_pool_claim', label: '领取', objectName: 'forge_customer_pool', icon: 'user-check', locations: [...locations], order: 10,
  visible: `record.status == 'claimable' || record.status == 'released'`, confirmText: '确认领取该公海客户并建立客户档案？', refreshAfter: true,
  successMessage: '公海客户已领取',
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const pool = ctx.record;
if (ctx.recordLoadDenied === true || !id || !pool) throw new Error('当前公海客户不存在或不可访问');
if (!['claimable','released'].includes(pool.status)) throw new Error('当前公海客户不能领取');
const now = new Date().toISOString(); let customerId = null;
const existing = await ctx.api.object('forge_customer').find({ where: { name: pool.name } }); customerId = existing[0]?.id;
if (!customerId) { const cats = await ctx.api.object('forge_customer_category').find({ where: { code: 'CUST-CAT-PROJECT' } }); let categoryId = cats[0]?.id; if (!categoryId) { const cat = await ctx.api.object('forge_customer_category').insert({ name: '项目客户', code: 'CUST-CAT-PROJECT', status: 'active' }); categoryId = typeof cat === 'string' ? cat : cat && (cat.id || (cat.record && cat.record.id)); } const created = await ctx.api.object('forge_customer').insert({ name: pool.name, customer_type: 'company', category_id: categoryId, responsible_id: ctx.session?.userId || null, remarks: '由公海客户领取建档' }); customerId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id)); }
await ctx.api.object('forge_customer_pool').update({ id, status: 'claimed', claimed_customer_id: customerId, claimed_at: now });
return { id, status: 'claimed', customer_id: customerId };
` },
});

export const ServiceOrderComplete = defineAction({
  name: 'service_order_complete', label: '提交服务结果', objectName: 'forge_service_order', icon: 'check-circle', locations: [...locations], order: 40,
  visible: `record.status == 'in_progress'`, refreshAfter: true,
  successMessage: '服务工单已完工，可继续生成报价、结算或质保卡',
  params: [
    { field: 'service_hours', objectOverride: 'forge_service_order' },
    { field: 'treatment_record', objectOverride: 'forge_service_order' },
    { field: 'onsite_evidence_count', objectOverride: 'forge_service_order' },
    { field: 'service_result', objectOverride: 'forge_service_order' },
  ],
  body: serviceOrderTransitionBody('in_progress', 'completed', `
const result = String(ctx.input.service_result || '').trim();
const treatment = String(ctx.input.treatment_record || '').trim();
const hours = Number(ctx.input.service_hours || 0);
const imageCount = Number(ctx.input.onsite_evidence_count || 0);
if (!treatment) throw new Error('请至少填写一条处理记录后再提交服务结果');
if (!(hours > 0)) throw new Error('服务耗时必须大于 0');
if (!(imageCount >= 1)) throw new Error('请至少记录一张现场处理图片');
if (!result) throw new Error('服务结果不能为空');
patch.service_hours = hours;
patch.treatment_record = treatment;
patch.onsite_evidence_count = imageCount;
patch.service_result = result;
patch.completed_at = now;
patch.next_step = '服务报价 / 服务结算 / 质保卡';
`),
});

export const ServiceOrderCreateQuotation = defineAction({
  name: 'service_order_create_quotation', label: '生成服务报价', objectName: 'forge_service_order', icon: 'file-text', locations: [...locations], order: 50,
  visible: `record.status == 'completed'`, refreshAfter: true,
  successMessage: '服务报价单已生成',
  params: [
    { field: 'total_amount', objectOverride: 'forge_service_quotation', required: true },
    { field: 'valid_until', objectOverride: 'forge_service_quotation', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const order = ctx.record;
if (ctx.recordLoadDenied === true || !id || !order) throw new Error('当前服务工单不存在或不可访问');
if (order.status !== 'completed') throw new Error('仅已完工服务工单可以生成报价');
const amount = Number(ctx.input.total_amount || 0); if (!(amount >= 0)) throw new Error('报价金额不能为负数');
if (!ctx.input.valid_until) throw new Error('有效期不能为空');
const actor = ctx.session && ctx.session.userId;
const existing = await ctx.api.object('forge_service_quotation').find({ where: { service_order_id: id } });
if (existing.length) throw new Error('该服务工单已生成服务报价');
const code = 'SQ-' + new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
const created = await ctx.api.object('forge_service_quotation').insert({ name: order.name + ' - 服务报价', code, service_order_id: id, order_code: order.code, customer_id: order.customer_id, contact_id: order.contact_id || null, total_amount: amount, status: 'draft', valid_until: ctx.input.valid_until, responsible_id: order.responsible_id || actor || null, remarks: order.service_result || order.remarks || null });
const quotationId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
await ctx.api.object('forge_service_order').update({ id, quotation_code: code, quotation_handling: '已生成服务报价', next_step: '客户确认服务报价' });
return { id: quotationId, code, service_order_id: id };
` },
});

export const ServiceOrderCreateSettlement = defineAction({
  name: 'service_order_create_settlement', label: '生成服务结算', objectName: 'forge_service_order', icon: 'receipt-text', locations: [...locations], order: 55,
  visible: `record.status == 'completed'`, refreshAfter: true,
  successMessage: '服务结算单已生成',
  params: [{ field: 'total_amount', objectOverride: 'forge_service_settlement', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const order = ctx.record;
if (ctx.recordLoadDenied === true || !id || !order) throw new Error('当前服务工单不存在或不可访问');
if (order.status !== 'completed') throw new Error('仅已完工服务工单可以生成结算');
const amount = Number(ctx.input.total_amount || 0); if (!(amount >= 0)) throw new Error('结算金额不能为负数');
const actor = ctx.session && ctx.session.userId;
const existing = await ctx.api.object('forge_service_settlement').find({ where: { service_order_id: id } });
if (existing.length) throw new Error('该服务工单已生成服务结算');
const code = 'SS-' + new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
const created = await ctx.api.object('forge_service_settlement').insert({ name: order.name + ' - 服务结算', code, service_order_id: id, quotation_id: null, order_code: order.code, customer_id: order.customer_id, contact_id: order.contact_id || null, total_amount: amount, status: 'draft', responsible_id: order.responsible_id || actor || null, remarks: order.service_result || order.remarks || null });
const settlementId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
await ctx.api.object('forge_service_order').update({ id, settlement_code: code, next_step: '服务结算确认 / 财务应收' });
return { id: settlementId, code, service_order_id: id };
` },
});

export const ServiceQuotationConfirm = defineAction({
  name: 'service_quotation_confirm', label: '客户确认', objectName: 'forge_service_quotation', icon: 'circle-check', locations: [...locations], order: 10,
  visible: `record.status == 'draft' || record.status == 'pending_confirmation'`, confirmText: '确认客户已接受这份服务报价？', refreshAfter: true,
  successMessage: '服务报价已确认',
  body: { language: 'js', capabilities: ['api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const record = ctx.record;
if (ctx.recordLoadDenied === true || !id || !record) throw new Error('当前服务报价不存在或不可访问');
if (!['draft','pending_confirmation'].includes(record.status)) throw new Error('当前服务报价状态不能确认');
await ctx.api.object('forge_service_quotation').update({ id, status: 'confirmed' });
return { id, status: 'confirmed' };
` },
});

export const ServiceQuotationCreateSettlement = defineAction({
  name: 'service_quotation_create_settlement', label: '转服务结算', objectName: 'forge_service_quotation', icon: 'receipt-text', locations: [...locations], order: 20,
  visible: `record.status == 'confirmed'`, refreshAfter: true,
  successMessage: '服务结算单已生成',
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const quote = ctx.record;
if (ctx.recordLoadDenied === true || !id || !quote) throw new Error('当前服务报价不存在或不可访问');
if (quote.status !== 'confirmed') throw new Error('仅已确认服务报价可以转结算');
const existing = await ctx.api.object('forge_service_settlement').find({ where: { quotation_id: id } });
if (existing.length) throw new Error('该服务报价已生成服务结算');
const actor = ctx.session && ctx.session.userId;
const code = 'SS-' + new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
const created = await ctx.api.object('forge_service_settlement').insert({ name: quote.name.replace('服务报价','服务结算'), code, service_order_id: quote.service_order_id || null, quotation_id: id, order_code: quote.order_code, customer_id: quote.customer_id, contact_id: quote.contact_id || null, total_amount: Number(quote.total_amount || 0), status: 'draft', responsible_id: quote.responsible_id || actor || null, remarks: quote.remarks || null });
const settlementId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
await ctx.api.object('forge_service_quotation').update({ id, status: 'settlement_created' });
if (quote.service_order_id) await ctx.api.object('forge_service_order').update({ id: quote.service_order_id, settlement_code: code, next_step: '服务结算确认' });
return { id: settlementId, code, quotation_id: id };
` },
});

export const ServiceSettlementConfirm = defineAction({
  name: 'service_settlement_confirm', label: '确认结算', objectName: 'forge_service_settlement', icon: 'circle-check', locations: [...locations], order: 10,
  visible: `record.status == 'draft' || record.status == 'customer_confirming'`, confirmText: '确认服务结算金额并进入财务应收？', refreshAfter: true,
  successMessage: '服务结算已确认',
  body: { language: 'js', capabilities: ['api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const record = ctx.record;
if (ctx.recordLoadDenied === true || !id || !record) throw new Error('当前服务结算不存在或不可访问');
if (!['draft','customer_confirming'].includes(record.status)) throw new Error('当前服务结算状态不能确认');
await ctx.api.object('forge_service_settlement').update({ id, status: 'confirmed' });
return { id, status: 'confirmed' };
` },
});

export const ServiceSettlementCreateReceivable = defineAction({
  name: 'service_settlement_create_receivable', label: '生成应收', objectName: 'forge_service_settlement', icon: 'wallet-cards', locations: [...locations], order: 20,
  visible: `record.status == 'confirmed'`, refreshAfter: true,
  successMessage: '服务应收已生成',
  params: [{ field: 'due_on', objectOverride: 'forge_accounts_receivable', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const settlement = ctx.record;
if (ctx.recordLoadDenied === true || !id || !settlement) throw new Error('当前服务结算不存在或不可访问');
if (settlement.status !== 'confirmed') throw new Error('仅已确认服务结算可以生成应收');
if (!ctx.input.due_on) throw new Error('应收到期日不能为空');
const actor = ctx.session && ctx.session.userId;
const responsibleId = settlement.responsible_id || actor;
if (!responsibleId) throw new Error('无法识别当前应收负责人');
const existing = await ctx.api.object('forge_accounts_receivable').find({ where: { service_settlement_id: id } });
if (existing.length) throw new Error('该服务结算已生成应收');
const code = 'AR-SVC-' + new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
await ctx.api.object('forge_accounts_receivable').insert({ name: settlement.name + ' - 应收', code, source_type: 'service_settlement', service_settlement_id: id, customer_id: settlement.customer_id, recognized_on: new Date().toISOString().slice(0,10), due_on: ctx.input.due_on, original_amount: Number(settlement.total_amount || 0), collected_amount: 0, outstanding_amount: Number(settlement.total_amount || 0), status: 'open', responsible_id: responsibleId, remarks: '服务结算生成应收' });
await ctx.api.object('forge_service_settlement').update({ id, status: 'receivable_created', receivable_code: code });
if (settlement.service_order_id) await ctx.api.object('forge_service_order').update({ id: settlement.service_order_id, next_step: '财务收款 / 服务复盘' });
return { id, receivable_code: code };
` },
});

export const ServiceOrderCreateWarranty = defineAction({
  name: 'service_order_create_warranty', label: '生成质保卡', objectName: 'forge_service_order', icon: 'shield-check', locations: [...locations], order: 60,
  visible: `record.status == 'completed'`, refreshAfter: true,
  successMessage: '质保卡已生成',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const order = ctx.record;
if (ctx.recordLoadDenied === true || !id || !order) throw new Error('当前服务工单不存在或不可访问');
if (order.status !== 'completed') throw new Error('仅已完工服务工单可以生成质保卡');
const existing = await ctx.api.object('forge_warranty_card').find({ where: { service_order_id: id } });
if (existing.length) throw new Error('该服务工单已生成质保卡');
const code = 'WC-' + new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
await ctx.api.object('forge_warranty_card').insert({ name: order.service_object || order.name, code, service_order_id: id, sales_order_id: order.sales_order_id || null, customer_id: order.customer_id, product_sn: order.service_object || order.name, scope: '整机/整单服务', starts_on: order.warranty_starts_on || new Date().toISOString().slice(0,10), ends_on: order.warranty_ends_on || null, status: 'active', responsible_party: '供应商', remarks: order.service_result || null });
await ctx.api.object('forge_service_order').update({ id, warranty_code: code });
return { id, warranty_code: code };
` },
});

export const GoodwillOrderSubmit = defineAction({
  name: 'goodwill_order_submit', label: '提交审批', objectName: 'forge_goodwill_order', icon: 'send', locations: [...locations], order: 10,
  visible: `record.status == 'draft'`, confirmText: '提交后 Goodwill 订单将进入审批，是否继续？', refreshAfter: true,
  successMessage: 'Goodwill 订单已提交审批', body: statusBody('forge_goodwill_order', 'draft', 'pending_approval'),
});

export const GoodwillOrderApprove = defineAction({
  name: 'goodwill_order_approve', label: '同意', objectName: 'forge_goodwill_order', icon: 'circle-check', locations: [...locations], order: 20,
  visible: `record.status == 'pending_approval'`, confirmText: '确认同意这张 Goodwill 订单？', refreshAfter: true,
  successMessage: 'Goodwill 订单审批通过',
  body: {
    language: 'js', capabilities: ['api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
if (ctx.recordLoadDenied === true || !id) throw new Error('当前 Goodwill 订单不存在或不可访问');
const record = ctx.record;
if (!record || record.status !== 'pending_approval') throw new Error('Goodwill 订单状态已变化，请刷新后重试');
const now = new Date().toISOString();
await ctx.api.object('forge_goodwill_order').update({ id, status: 'approved', approved_by: 'Dev Admin', approved_at: now });
return { id, status: 'approved', approved_at: now };
`,
  },
});

export const GoodwillOrderCreateShipment = defineAction({
  name: 'goodwill_order_create_shipment', label: '创建发货', objectName: 'forge_goodwill_order', icon: 'truck', locations: [...locations], order: 30,
  visible: `record.status == 'approved'`, refreshAfter: true,
  successMessage: 'Goodwill 发货已记录',
  params: [
    { field: 'delivery_address', objectOverride: 'forge_goodwill_order', required: true },
    { field: 'recipient', objectOverride: 'forge_goodwill_order', required: true },
    { field: 'recipient_phone', objectOverride: 'forge_goodwill_order', required: true },
    { field: 'logistics_company', objectOverride: 'forge_goodwill_order' },
    { field: 'tracking_no', objectOverride: 'forge_goodwill_order' },
  ],
  body: {
    language: 'js', capabilities: ['api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
if (ctx.recordLoadDenied === true || !id) throw new Error('当前 Goodwill 订单不存在或不可访问');
const record = ctx.record;
if (!record || record.status !== 'approved') throw new Error('仅已审批 Goodwill 订单可以创建发货');
const deliveryAddress = String(ctx.input.delivery_address || '').trim();
const recipient = String(ctx.input.recipient || '').trim();
const recipientPhone = String(ctx.input.recipient_phone || '').trim();
if (!deliveryAddress) throw new Error('收货地址不能为空');
if (!recipient) throw new Error('收件人不能为空');
if (!recipientPhone) throw new Error('联系电话不能为空');
const now = new Date().toISOString();
const shippedQuantity = Number(record.quantity || 0) || Number(String(record.item_summary || '').match(/\d+(?:\.\d+)?/)?.[0] || 0);
const shipmentCode = record.shipment_code || 'DN-GW-' + now.slice(0,10).replace(/-/g,'') + '-001';
await ctx.api.object('forge_goodwill_order').update({
  id, status: 'shipping', shipment_code: shipmentCode, shipment_status: '待发货', shipment_count: 1, shipped_quantity: shippedQuantity,
  logistics_company: String(ctx.input.logistics_company || '').trim() || null, tracking_no: String(ctx.input.tracking_no || '').trim() || null,
  delivery_address: deliveryAddress, recipient, recipient_phone: recipientPhone, shipped_at: now,
});
return { id, status: 'shipping', shipment_code: shipmentCode, shipped_quantity: shippedQuantity };
`,
  },
});

export const GoodwillOrderComplete = defineAction({
  name: 'goodwill_order_complete', label: '确认完成', objectName: 'forge_goodwill_order', icon: 'check-circle', locations: [...locations], order: 40,
  visible: `record.status == 'shipping'`, confirmText: '确认客户已收到赠送物品并完成这张 Goodwill 订单？', refreshAfter: true,
  successMessage: 'Goodwill 订单已确认完成',
  body: {
    language: 'js', capabilities: ['api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
if (ctx.recordLoadDenied === true || !id) throw new Error('当前 Goodwill 订单不存在或不可访问');
const record = ctx.record;
if (!record || record.status !== 'shipping') throw new Error('仅发货中的 Goodwill 订单可以确认完成');
const now = new Date().toISOString();
await ctx.api.object('forge_goodwill_order').update({ id, status: 'completed', shipment_status: '已完成', completed_at: now });
return { id, status: 'completed', completed_at: now };
`,
  },
});
