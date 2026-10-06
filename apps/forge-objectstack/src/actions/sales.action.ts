import { QUOTATION_SUBMIT_TARGET, QUOTATION_SEND_TARGET, QUOTATION_ACCEPT_TARGET, QUOTATION_CONVERT_TARGET } from '../plugins/sales-quotation-domain.js';
import { SIGNATURE_TARGET, ORDER_CONDITIONS_TARGET, CONTRACT_ORDER_TARGET, ORDER_SUBMIT_TARGET, ORDER_APPLY_APPROVAL_TARGET } from '../plugins/sales-order-domain.js';
import { defineAction } from '@objectstack/spec';
import { hasExactQuotationLineSet } from './sales-contract-source-set.js';
import { CONTRACT_MATERIAL_SUBMISSION_TARGET, CONTRACT_REVISION_ATTACHMENT_RETIRED_TARGET, CONTRACT_SUBMISSION_RECEIPT_TARGET } from '../plugins/contract-material-submission.js';

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
    { name: 'opportunity_id', label: '来源商机', type: 'text' },
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
const opportunityId = getText('opportunity_id', '来源商机', false, 128);
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
const opportunityObject = ctx.api.object('forge_sales_opportunity');
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
  let opportunity = null;
  if (opportunityId) {
    opportunity = await opportunityObject.findOne({
      where: { id: opportunityId, organization_id: organizationId },
      fields: ['id', 'organization_id', 'customer_id', 'name', 'owner_id', 'responsible_id'],
    });
    if (!orgRecord(opportunity) || opportunity.customer_id !== customerId
      || !ownedByActor(opportunity) || String(opportunity.responsible_id || '') !== actor) {
      throw new Error('所选来源商机不存在、无权访问或与当前客户不匹配，请刷新后重试');
    }
  }
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
    opportunity_id: opportunity ? opportunity.id : null,
    opportunity_name: opportunity ? String(opportunity.name || '').trim() : null,
    quotation_type_id: quotationTypeId, issuer_id: issuerId,
    quotation_date: quotationDate, valid_until: validUntil,
    payment_method: null, payment_method_confirmed: false, payment_term: getText('payment_term', '付款条件', false, 255),
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
    description: '只调整当前员工负责的草稿报价中指定一行的含税单价，并在同一事务中重算报价金额。expected_pricing_version 必须取报价主记录的 pricing_version（新草稿可为 0），不能取工作快照格式 version；line_id 取同一报价已读取明细的原生标识。相同请求返回原回执，异参或旧版本会冲突。',
    category: 'action',
    requiresConfirmation: false,
  },
  params: [
    { name: 'line_id', label: '报价明细标识', type: 'text', required: true },
    { name: 'expected_pricing_version', label: '报价核价版本（pricing_version，非快照版本）', type: 'number', required: true },
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
const allowed = ['expected_pricing_version', 'idempotency_key', 'line_id', 'taxed_unit_price'];
const routeKeys = ['objectName', 'recordId'];
for (const key of Object.keys(adjustment)) if (!allowed.includes(key) && !routeKeys.includes(key)) throw new Error('报价调整只接受本次授权的单行标量参数');
if (adjustment.objectName && adjustment.objectName !== 'forge_quotation') throw new Error('报价调整对象与本次授权不一致');
if (adjustment.recordId && String(adjustment.recordId) !== id) throw new Error('报价调整记录与本次授权不一致');
for (const key of allowed) if (!Object.prototype.hasOwnProperty.call(adjustment, key)) throw new Error('报价调整缺少必填参数');
const lineId = String(adjustment.line_id || '').trim();
const idempotencyKey = String(adjustment.idempotency_key || '').trim();
const expectedVersion = Number(adjustment.expected_pricing_version);
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
  requiredPermissions: ['sales_quotation_draft_create'],
  visible: `record.status == 'draft'`, confirmText: '提交核价版本后，报价明细将锁定并进入 ObjectStack 审批中心。是否继续？', refreshAfter: true,
  successMessage: '报价已提交原生审批',
  type: 'script', target: QUOTATION_SUBMIT_TARGET,
  ai: { exposed: true, category: 'action', requiresConfirmation: true,
    description: '由报价负责人本人提交当前核价报价进入原生岗位审批，冻结本次原始明细和金额；发起人不能审批自己的报价，不代替审批员工决定。' },
});

export const QuotationSend = defineAction({
  name: 'quotation_send', label: '登记报价已发送', objectName: 'forge_quotation', icon: 'mail', locations: [...locations], order: 10,
  requiredPermissions: ['sales_quotation_draft_create'],
  visible: `record.status == 'approved'`, refreshAfter: true,
  description: '请确认报价已实际发送给客户，并上传发送凭证和送达说明。此动作只登记发送，不会替你发送邮件或消息。', successMessage: '客户发送凭证已归档',
  params: [
    { field: 'sent_evidence_attachment', objectOverride: 'forge_quotation', required: true },
    { field: 'sent_evidence_note', objectOverride: 'forge_quotation', required: true },
  ],
  type: 'script', target: QUOTATION_SEND_TARGET,
  ai: { exposed: true, category: 'action', requiresConfirmation: true,
    description: '由报价负责人本人登记已实际发送的当前审批报价及本轮发送凭证原件，严格核对版本、员工与组织；仅登记凭证，不发送外部邮件或消息。' },
});

export const QuotationAccept = defineAction({
  name: 'quotation_accept', label: '记录客户接受', objectName: 'forge_quotation', icon: 'handshake', locations: [...locations], order: 10,
  requiredPermissions: ['sales_quotation_draft_create'],
  visible: `record.status == 'sent'`, refreshAfter: true,
  description: '仅在客户实际接受后上传凭证；请确认凭证对应本次已发送的报价版本。无客户凭证时不得调用。', successMessage: '客户接受凭证已归档，接受的报价版本已锁定',
  params: [
    { field: 'customer_acceptance_evidence_attachment', objectOverride: 'forge_quotation', required: true },
    { field: 'customer_acceptance_note', objectOverride: 'forge_quotation', required: true },
  ],
  type: 'script', target: QUOTATION_ACCEPT_TARGET,
  ai: { exposed: true, category: 'action', requiresConfirmation: true,
    description: '由报价负责人本人登记客户已接受准确发送版本的报价，归档本轮客户接受凭证与说明并核对原件；此动作不构成或伪造真实客户同意。' },
});

export const QuotationConvertToContract = defineAction({
  name: 'quotation_convert_to_contract', label: '转为合同', objectName: 'forge_quotation', icon: 'scroll-text',
  locations: [...locations], order: 20, visible: `record.status == 'accepted'`, refreshAfter: true,
  requiredPermissions: ['sales_contract_operator'],
  description: '用已接受报价建立一份同客户、同价格和同数量的框架合同。', successMessage: '合同与合同明细已创建',
  params: [
    { field: 'contract_type_id', objectOverride: 'forge_sales_contract', required: true },
    { field: 'code', objectOverride: 'forge_sales_contract', required: true },
    { field: 'name', objectOverride: 'forge_sales_contract', required: true },
    { field: 'starts_on', objectOverride: 'forge_sales_contract', required: true },
    { field: 'ends_on', objectOverride: 'forge_sales_contract', required: true },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.sales/forge_sales_contract/record/${result.id}' },
  type: 'script', target: QUOTATION_CONVERT_TARGET,
  ai: { exposed: true, category: 'action', requiresConfirmation: true,
    description: '由报价负责人本人按准确已接受报价的原始数量、单价、税率、折扣和金额创建合同草稿；合同类型、编号、名称和日期须由当前员工明确提供。' },
});

export const SalesContractDraftCreate = defineAction({
  name: 'sales_contract_draft_create', label: '保存合同草稿', objectName: 'forge_sales_contract', icon: 'file-plus-2',
  requiredPermissions: ['sales_contract_operator'],
  params: [
    { name: 'header_json', label: '合同信息', type: 'text', required: true },
    { name: 'lines_json', label: '物料与服务明细', type: 'text', required: true },
    { name: 'fees_json', label: '附加费用', type: 'text' },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const hasExactQuotationLineSet = ${hasExactQuotationLineSet.toString()};
const actor = String(ctx.session && ctx.session.userId || '').trim();
const organizationId = String(ctx.session && ctx.session.organizationId || '').trim();
if (!actor || !organizationId) throw new Error('无法确认当前员工和组织，请重新登录后重试');
const parse = (value, label, fallback) => {
  try { return value == null || value === '' ? fallback : JSON.parse(String(value)); }
  catch { throw new Error(label + '格式无效'); }
};
const header = parse(ctx.input && ctx.input.header_json, '合同信息', null);
const requestedLines = parse(ctx.input && ctx.input.lines_json, '合同明细', null);
const requestedFees = parse(ctx.input && ctx.input.fees_json, '附加费用', []);
if (!header || typeof header !== 'object' || Array.isArray(header)) throw new Error('合同信息无效');
if (!Array.isArray(requestedLines) || requestedLines.length < 1 || requestedLines.length > 100) throw new Error('合同至少需要一条明细，且最多支持100条');
if (!Array.isArray(requestedFees) || requestedFees.length > 50) throw new Error('附加费用最多支持50项');
const text = (value, label, required, max = 255) => {
  const result = String(value == null ? '' : value).trim();
  if (required && !result) throw new Error(label + '不能为空');
  if (result.length > max) throw new Error(label + '长度不能超过' + max + '个字符');
  return result || null;
};
const round4 = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
const number = (value, label, min, max) => {
  if (value === '' || value === null || value === undefined) throw new Error(label + '不能为空');
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max || round4(result) !== result) throw new Error(label + '无效，最多支持四位小数');
  return result;
};
const belongs = row => row && String(row.organization_id || '') === organizationId;
const customerId = text(header.customer_id, '客户', true, 128);
const contractTypeId = text(header.contract_type_id, '合同类型', true, 128);
const contractCode = text(header.code, '合同编号', true, 100);
const contractName = text(header.name, '合同名称', true, 255);
const quoteId = text(header.quotation_id, '来源报价', false, 128);
if (String(header.responsible_id || actor) !== actor) throw new Error('合同负责人必须是当前员工');
if (header.signed_on && !/^\\d{4}-\\d{2}-\\d{2}$/.test(String(header.signed_on))) throw new Error('合同签订日期格式无效');
if (header.starts_on && !/^\\d{4}-\\d{2}-\\d{2}$/.test(String(header.starts_on))) throw new Error('合同生效日期格式无效');
if (header.ends_on && !/^\\d{4}-\\d{2}-\\d{2}$/.test(String(header.ends_on))) throw new Error('合同到期日期格式无效');
if (header.starts_on && header.ends_on && header.ends_on < header.starts_on) throw new Error('合同到期日期不得早于生效日期');
const customer = await ctx.api.object('forge_customer').findOne({ where: { id: customerId } });
if (!belongs(customer) || customer.owner_id !== actor) throw new Error('只能为本人负责的客户创建合同');
const contractType = await ctx.api.object('forge_contract_type').findOne({ where: { id: contractTypeId } });
if (!belongs(contractType) || contractType.status === 'inactive') throw new Error('合同类型不存在、已停用或不属于当前组织');
if (header.contact_id) {
  const contact = await ctx.api.object('forge_contact').findOne({ where: { id: String(header.contact_id) } });
  if (!belongs(contact) || contact.customer_id !== customerId || contact.owner_id !== actor || contact.employment_status === 'inactive') throw new Error('所选联系人不属于当前客户或已不可用');
}
let quote = null;
if (quoteId) {
  quote = await ctx.api.object('forge_quotation').findOne({ where: { id: quoteId } });
  if (!belongs(quote) || quote.customer_id !== customerId || quote.responsible_id !== actor) throw new Error('来源报价不属于当前客户或当前员工');
}
const quoteLines = quoteId ? await ctx.api.object('forge_quotation_line').find({ where: { quotation_id: quoteId } }) : [];
const quoteLinesById = new Map(quoteLines.map(line => [line.id, line]));
const lines = [];
for (let index = 0; index < requestedLines.length; index += 1) {
  const input = requestedLines[index];
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('第' + (index + 1) + '条明细格式无效');
  const type = String(input.line_type || 'material');
  if (!['material', 'service'].includes(type)) throw new Error('第' + (index + 1) + '条明细类型无效');
  const sourceId = text(input.quotation_line_id, '来源报价明细', false, 128);
  let source = null;
  if (sourceId) {
    source = quoteLinesById.get(sourceId);
    if (!quote || !source) throw new Error('第' + (index + 1) + '条来源明细不属于所选报价');
  }
  const lineType = source ? source.line_type : type;
  if (source && type !== source.line_type) throw new Error('第' + (index + 1) + '条明细类型与来源报价不一致');
  const quantity = source ? Number(source.quantity) : number(input.quantity_limit, '第' + (index + 1) + '条数量', 0.0001, 1000000000);
  const unitPrice = source ? Number(source.taxed_unit_price) : number(input.taxed_unit_price, '第' + (index + 1) + '条含税单价', 0, 1000000000000);
  const taxRate = source ? Number(source.tax_rate) : number(input.tax_rate, '第' + (index + 1) + '条税率', 0, 100);
  const discountRate = source ? Number(source.discount_rate) : number(input.discount_rate, '第' + (index + 1) + '条折扣率', 0, 100);
  const skuId = source ? (source.sku_id || null) : text(input.sku_id, '物料规格', false, 128);
  const name = text(source ? source.name : input.name, '第' + (index + 1) + '条名称', true);
  const sameText = (left, right) => String(left || '') === String(right || '');
  let sku = null, material = null, unit = null;
  if (lineType === 'material') {
    if (!skuId) throw new Error('第' + (index + 1) + '条物料明细必须选择规格');
    sku = await ctx.api.object('forge_material_sku').findOne({ where: { id: skuId } });
    if (!belongs(sku) || sku.enabled === false) throw new Error('第' + (index + 1) + '条物料规格不存在、已停用或不属于当前组织');
    material = await ctx.api.object('forge_material').findOne({ where: { id: sku.material_id } });
    if (!belongs(material) || material.status === 'inactive') throw new Error('第' + (index + 1) + '条物料不存在、已停用或不属于当前组织');
    unit = material.unit_id ? await ctx.api.object('forge_unit').findOne({ where: { id: material.unit_id } }) : null;
    if (!belongs(unit) || unit.status === 'inactive') throw new Error('第' + (index + 1) + '条物料计量单位不可用');
  } else if (skuId) throw new Error('服务项目不能关联物料规格');
  const lineQuantity = number(quantity, '第' + (index + 1) + '条数量', 0.0001, 1000000000);
  const linePrice = number(unitPrice, '第' + (index + 1) + '条含税单价', 0, 1000000000000);
  const lineTax = number(taxRate, '第' + (index + 1) + '条税率', 0, 100);
  const lineDiscount = number(discountRate, '第' + (index + 1) + '条折扣率', 0, 100);
  if (source && (Number(input.quantity_limit) !== lineQuantity || Number(input.taxed_unit_price) !== linePrice || Number(input.tax_rate) !== lineTax || Number(input.discount_rate) !== lineDiscount || !sameText(input.name, source.name) || !sameText(input.sku_id, source.sku_id) || !sameText(input.item_code, source.item_code) || !sameText(input.model, source.model) || !sameText(input.specification, source.specification) || !sameText(input.unit_name, source.unit_name) || !sameText(input.remarks, source.remarks))) throw new Error('第' + (index + 1) + '条来源报价明细的名称、规格、数量和价税必须保持原值');
  const subtotal = round4(lineQuantity * linePrice * (1 - lineDiscount / 100));
  lines.push({ name, line_type: lineType, quotation_line_id: sourceId, sku_id: skuId,
    item_code: source ? source.item_code || null : material && material.code || null,
    model: source ? source.model || null : material && material.model || null,
    specification: source ? source.specification || null : sku && sku.name || null,
    unit_name: source ? source.unit_name || null : unit && unit.name || null,
    quantity_limit: lineQuantity, ordered_quantity: 0, taxed_unit_price: linePrice, tax_rate: lineTax,
    discount_rate: lineDiscount, taxed_subtotal: subtotal, remarks: source ? source.remarks || null : text(input.remarks, '备注', false, 1000) });
}
if (quoteId && !hasExactQuotationLineSet(quoteLines, lines)) throw new Error('来源报价的每条明细都必须完整带入合同');
const fees = requestedFees.map((fee, index) => {
  if (!fee || typeof fee !== 'object') throw new Error('第' + (index + 1) + '项附加费用格式无效');
  const amount = number(fee.total_amount, '第' + (index + 1) + '项费用金额', 0.0001, 1000000000000);
  const occurredOn = text(fee.occurred_on, '第' + (index + 1) + '项费用日期', true, 10);
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(occurredOn)) throw new Error('第' + (index + 1) + '项费用日期格式无效');
  const bearing = String(fee.bearing_type || 'customer');
  if (!['customer', 'company'].includes(bearing)) throw new Error('第' + (index + 1) + '项费用承担方无效');
  return { fee_item: text(fee.fee_item, '第' + (index + 1) + '项费用名称', true), bearing_type: bearing, occurred_on: occurredOn, total_amount: amount };
});
const signatureSource = JSON.stringify({ header: { ...header, responsible_id: actor }, lines, fees });
const hash = value => { let a = 2166136261, b = 2246822519; for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); a = Math.imul(a ^ c, 16777619) >>> 0; b = Math.imul(b ^ c, 3266489917) >>> 0; } return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0'); };
const signature = hash(signatureSource);
return await ctx.api.transaction(async () => {
  const existing = await ctx.api.object('forge_sales_contract').findOne({ where: { code: contractCode } });
  if (existing) {
    if (existing.owner_id === actor && existing.status === 'draft' && existing.draft_request_signature === signature) return { id: existing.id, code: contractCode, status: 'draft', repeated: true };
    throw new Error('合同编号已存在，请刷新合同列表后重试');
  }
  const subtotal = round4(lines.reduce((sum, line) => sum + line.taxed_subtotal, 0));
  const feeTotal = round4(fees.reduce((sum, fee) => sum + fee.total_amount, 0));
  const total = round4(subtotal + feeTotal);
  const contract = await ctx.api.object('forge_sales_contract').insert({
    name: contractName, code: contractCode, customer_po_number: text(header.customer_po_number, '客户单号', false),
    contract_type_id: contractTypeId, customer_id: customerId, contact_id: header.contact_id || null,
    quotation_id: quoteId, quotation_source_type: quoteId ? 'template_import' : 'direct', project_name: text(header.project_name, '关联项目', false), company_account_id: header.company_account_id || null,
    delivery_address: text(header.delivery_address, '收货地址', false), delivery_contact: text(header.delivery_contact, '收货人', false), delivery_phone: text(header.delivery_phone, '收货联系电话', false),
    signed_on: null, signed_evidence_attachment: null, signed_evidence_note: null,
    signed_recorded_by: null, signed_recorded_at: null, starts_on: header.starts_on || null, ends_on: header.ends_on || null,
    owner_id: actor, responsible_id: actor, collaborator_ids: header.collaborator_ids || [], total_amount: total,
    has_order_amount_limit: Boolean(header.has_order_amount_limit), order_amount_limit: header.has_order_amount_limit ? number(header.order_amount_limit, '累计下单金额上限', 0.0001, 1000000000000) : 0,
    allow_affiliate_orders: Boolean(header.allow_affiliate_orders), affiliate_company_names: header.allow_affiliate_orders ? text(header.affiliate_company_names, '关联公司', false, 2000) : null,
    outside_item_requires_approval: header.outside_item_requires_approval !== false, all_orders_require_approval: Boolean(header.all_orders_require_approval),
    revenue_trigger: header.revenue_trigger || 'shipment', ordered_count: 0, ordered_amount: 0, invoiced_amount: 0, shipped_amount: 0, collected_amount: 0,
    status: 'draft', payment_term: text(header.payment_term, '付款条件', false, 2000), delivery_cycle_days: header.delivery_cycle_days === '' ? null : Number(header.delivery_cycle_days || 0),
    warranty_months: header.warranty_months === '' ? null : Number(header.warranty_months || 0), business_terms: text(header.business_terms, '商务条款', false, 8000),
    requires_legal_review: header.requires_legal_review === true,
    attachment_ids: Array.isArray(header.attachment_ids) ? header.attachment_ids : [], attachment_note: text(header.attachment_note, '附件说明', false, 2000),
    draft_request_signature: signature, remarks: text(header.remarks, '备注', false, 4000),
  });
  const contractId = typeof contract === 'string' ? contract : contract && (contract.id || contract.record && contract.record.id);
  if (!contractId) throw new Error('合同创建后未返回记录ID');
  for (const line of lines) await ctx.api.object('forge_sales_contract_line').insert({ ...line, contract_id: contractId });
  for (let index = 0; index < fees.length; index++) {
    const fee = fees[index];
    await ctx.api.object('forge_sales_additional_fee').insert({ name: fee.fee_item + ' ' + contractCode, code: contractCode + '-F' + String(index + 1).padStart(2, '0'),
      source_type: 'sales_contract', contract_id: contractId, customer_id: customerId, bearing_type: fee.bearing_type, fee_item: fee.fee_item,
      occurred_on: fee.occurred_on, total_amount: fee.total_amount, document_status: 'draft', finance_status: fee.bearing_type === 'customer' ? 'pending_invoice' : 'pending_payment', responsible_id: actor });
  }
  return { id: contractId, code: contractCode, status: 'draft', line_count: lines.length, total_amount: total };
});
` },
});

export const ContractSubmit = defineAction({
  name: 'contract_submit', label: '提交审批', objectName: 'forge_sales_contract', icon: 'send', locations: [...locations], order: 10,
  requiredPermissions: ['sales_contract_operator'], visible: false,
  successMessage: '已读取既有合同提交回执',
  ai: { exposed: false, description: '此旧入口仅用于兼容读取已有提交回执，不再创建新的合同提交；没有旧回执时请使用当前完整材料提交动作。' },
  target: CONTRACT_SUBMISSION_RECEIPT_TARGET,
});

export const ContractSubmitMaterialPackage = defineAction({
  name: 'contract_submit_material_package', label: '提交审批', objectName: 'forge_sales_contract', icon: 'send',
  locations: [...locations], order: 10, refreshAfter: true,
  requiredPermissions: ['sales_contract_operator'], visible: `record.status == 'draft'`,
  description: '将本次明确选定的合同正文和全部附件一起提交审批；材料不齐时请先补齐，提交后进入合同复核流程。',
  successMessage: '合同已提交审批',
  ai: {
    exposed: true,
    description: '将本次明确选定的合同正文和全部附件一起提交审批；材料不齐时请先补齐，提交后进入合同复核流程。',
    category: 'action', requiresConfirmation: false,
  },
  params: [
    { name: 'primary_file_id', label: '合同主件', type: 'file', required: true },
    { name: 'material_file_ids', label: '本次提交全部材料', type: 'file', multiple: true, required: true },
  ],
  target: CONTRACT_MATERIAL_SUBMISSION_TARGET,
});

export const ContractRegisterSignature = defineAction({
  name: 'contract_register_signature', label: '登记客户签署', objectName: 'forge_sales_contract', icon: 'signature',
  locations: [...locations], order: 30, refreshAfter: true,
  requiredPermissions: ['contract_signature_registrar'],
  visible: `record.status == 'active' && record.signed_on == null`,
  description: '内部合同审批通过后，上传客户签署版本并登记实际签订日期；此动作不替代签署本身。',
  successMessage: '客户签署凭证已归档',
  params: [
    { field: 'signed_on', objectOverride: 'forge_sales_contract', required: true },
    { field: 'signed_evidence_attachment', objectOverride: 'forge_sales_contract', required: true },
    { field: 'signed_evidence_note', objectOverride: 'forge_sales_contract', required: true },
  ],
  ai: { exposed: true, description: '由独立签署登记员工归档本轮客户签署原件及实际签订日期，重新校验合同内部复核结果与当前身份，不代替真实客户签署。', category: 'action', requiresConfirmation: false },
  target: SIGNATURE_TARGET,
});

export const ContractSubmitFrozenMaterial = defineAction({
  name: 'contract_submit_frozen_material', label: '读取旧版提交回执', objectName: 'forge_sales_contract', icon: 'file-check',
  locations: ['record_more'], visible: false,
  requiredPermissions: ['sales_contract_operator'],
  ai: {
    exposed: true,
    description: '旧版标量提交入口只读取与全部参数完全一致的既有回执；不接受新写入，也不把旧主件升级成材料包。',
    category: 'action', requiresConfirmation: false,
  },
  params: [
    { name: 'material_file_id', label: '既有合同文件', type: 'text', required: true },
    { name: 'material_name', label: '既有文件名称', type: 'text', required: true },
    { name: 'material_sha256', label: '既有文件摘要', type: 'text', required: true },
  ],
  target: CONTRACT_SUBMISSION_RECEIPT_TARGET,
});

export const ContractBindRevisionAttachments = defineAction({
  name: 'contract_bind_revision_attachments', label: '已停用的单独附件绑定', objectName: 'forge_sales_contract', icon: 'paperclip',
  locations: ['record_more'], visible: false,
  requiredPermissions: ['sales_contract_operator'],
  ai: { exposed: false, description: '此旧入口不再单独写入附件。合同退回修订时，请在同一次操作中选好正文和全部附件后一起提交。' },
  params: [{ name: 'attachment_manifest', label: '已停用的旧版附件清单', type: 'text', required: true }],
  target: CONTRACT_REVISION_ATTACHMENT_RETIRED_TARGET,
});

export const SalesOrderSubmit = defineAction({
  name: 'sales_order_submit', label: '提交审批', objectName: 'forge_sales_order', icon: 'send', locations: [...locations], order: 10,
  visible: `record.status == 'draft'`, confirmText: '提交前将校验合同额度和明细数量，是否继续？', refreshAfter: true,
  requiredPermissions: ['sales_order_operator'],
  successMessage: '销售订单已提交审批',
  ai: { exposed: true, description: '订单经办员工提交本人草稿订单，校验合同来源和预付款条件并冻结本次明细，交给原生审批中的独立订单复核人办理。', category: 'action', requiresConfirmation: false },
  target: ORDER_SUBMIT_TARGET,
});

export const SalesOrderApprove = defineAction({
  name: 'sales_order_approve', label: '办理订单审批', objectName: 'forge_sales_order',
  icon: 'circle-check', locations: [...locations], visible: "record.status == 'pending_approval'",
  requiredPermissions: ['sales_order_reviewer'],
  type: 'url', target: '/_console/approvals',
});

export const SalesOrderCreateShipment = defineAction({
  name: 'sales_order_create_shipment', label: '创建发货单', objectName: 'forge_sales_order', icon: 'package-check',
  locations: [...locations], order: 20, visible: `record.status == 'active' || record.status == 'partially_shipped'`, refreshAfter: true,
  requiredPermissions: ['sales_order_fulfillment_operator'],
  description: '从执行中订单的单条物料明细创建分批发货计划；服务行保留在订单和项目交付范围内，不进入库存或发货单。', successMessage: '物料发货计划已创建',
  params: [
    { field: 'order_line_id', objectOverride: 'forge_sales_order_line', required: true },
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
    language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
if (ctx.recordLoadDenied === true || !id || !ctx.record) throw new Error('当前订单不存在或不可访问');
return await ctx.api.transaction(async () => {
  const order = await ctx.api.object('forge_sales_order').findOne({ where: { id } });
  if (!order || !['active', 'partially_shipped'].includes(order.status)) throw new Error('仅执行中或部分发货订单可以创建发货单');
  const orderLines = await ctx.api.object('forge_sales_order_line').find({ where: { order_id: id } });
  const orderLine = orderLines.find(line => line.id === ctx.input.order_line_id);
  if (!orderLine || orderLine.order_id !== id) throw new Error('请选择当前订单中的物料明细');
  if (orderLine.line_type !== 'material' || !orderLine.sku_id) throw new Error('服务项目不进入库存或发货单，请选择订单中的物料行');
  const requested = Number(ctx.input.quantity || 0);
  if (!(requested > 0)) throw new Error('本次发货数量必须大于0');
  const shipmentLines = await ctx.api.object('forge_sales_shipment_line').find({ where: { order_id: id } });
  let plannedQuantity = 0, plannedAmount = 0, orderPlannedAmount = 0;
  const activeShipmentIds = new Set();
  for (const line of shipmentLines) {
    const shipment = await ctx.api.object('forge_sales_shipment').findOne({ where: { id: line.shipment_id } });
    if (!shipment || shipment.status === 'cancelled') continue;
    orderPlannedAmount += Number(line.taxed_subtotal || 0);
    activeShipmentIds.add(shipment.id);
    if (line.order_line_id === orderLine.id) {
      plannedQuantity += Number(line.quantity || 0);
      plannedAmount += Number(line.taxed_subtotal || 0);
    }
  }
  const remaining = Number(orderLine.quantity || 0) - plannedQuantity;
  if (requested > remaining) throw new Error('本次发货数量超过该物料行未建单数量');
  const round4 = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
  const unitAmount = round4(Number(orderLine.taxed_subtotal || 0) / Number(orderLine.quantity || 1));
  const lineAmount = round4(unitAmount * requested);
  const created = await ctx.api.object('forge_sales_shipment').insert({
    name: order.code + ' 发货 ' + ctx.input.code, code: ctx.input.code, customer_id: order.customer_id,
    contact_id: order.contact_id || null, shipment_on: ctx.input.shipment_on,
    recipient: ctx.input.recipient, recipient_phone: ctx.input.recipient_phone || null,
    delivery_address: ctx.input.delivery_address, total_amount: lineAmount, total_quantity: requested,
    outbound_quantity: 0, outbound_count: 0, responsible_id: order.responsible_id,
    remarks: ctx.input.remarks || ('由销售订单 ' + order.code + ' 创建'),
  });
  const shipmentId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
  if (!shipmentId) throw new Error('发货单创建后未返回记录ID');
  await ctx.api.object('forge_sales_shipment_line').insert({
    name: orderLine.name, shipment_id: shipmentId, order_id: id, order_line_id: orderLine.id,
    sku_id: orderLine.sku_id, item_code: orderLine.item_code || null, model: orderLine.model || null,
    specification: orderLine.specification || null, unit_name: orderLine.unit_name || null,
    quantity: requested, outbound_quantity: 0, taxed_unit_price: unitAmount,
    taxed_subtotal: lineAmount, remarks: orderLine.remarks || null,
  });
  await ctx.api.object('forge_sales_order').update({ id,
    shipment_count: activeShipmentIds.size + 1, planned_shipment_amount: round4(orderPlannedAmount + lineAmount)
  });
  return { id: shipmentId, order_id: id, order_line_id: orderLine.id, quantity: requested,
    total_amount: lineAmount, planned_amount: round4(plannedAmount + lineAmount), remaining_quantity: round4(remaining - requested) };
});
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
  locations: [...locations], order: 20, visible: `record.status == 'active' && record.signed_on != null`, refreshAfter: true,
  requiredPermissions: ['sales_order_operator'],
  description: '按合同当前未下单数量建立销售订单。', successMessage: '销售订单与订单明细已创建',
  params: [
    { field: 'code', objectOverride: 'forge_sales_order', required: true },
    { field: 'name', objectOverride: 'forge_sales_order', required: true },
    { field: 'planned_delivery_on', objectOverride: 'forge_sales_order', required: true },
    { field: 'payment_term', objectOverride: 'forge_sales_order', required: true },
    { field: 'payment_method', objectOverride: 'forge_sales_order', required: true },
    { field: 'delivery_address', objectOverride: 'forge_sales_order' },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.sales/forge_sales_order/record/${result.id}' },
  ai: { exposed: true, description: '订单经办员工按已签署合同的剩余明细创建本人订单，重新核验约定预付款已独立确认、来源数量和金额，不自动审批订单。', category: 'action', requiresConfirmation: false },
  target: CONTRACT_ORDER_TARGET,
});

const serviceOrderTransitionBody = (from: string, to: string, extraSource = '') => ({
  language: 'js' as const,
  capabilities: ['api.write' as const],
  source: `
const id = ctx.recordId || (ctx.record && ctx.record.id);
const record = ctx.record;
const actor = String(ctx.session && ctx.session.userId || '').trim();
const organizationId = String((ctx.session && ctx.session.organizationId) || (ctx.user && ctx.user.organizationId) || '').trim();
if (!actor || !organizationId) throw new Error('无法确认当前服务员工及组织');
if (ctx.recordLoadDenied === true || !id || !record) throw new Error('当前服务工单不存在或不可访问');
if (String(record.organization_id || '') !== organizationId) throw new Error('服务工单不属于当前组织');
if (record.status !== '${from}') throw new Error('工单状态已变化，请刷新后重试');
const now = new Date().toISOString();
const patch = { id, status: '${to}' };
${extraSource}
await ctx.api.object('forge_service_order').update(patch);
return { id, status: '${to}' };
`,
});

const serviceOrderDispatchActorSource = `
const actor = String(ctx.session && ctx.session.userId || '').trim();
const organizationId = String((ctx.session && ctx.session.organizationId) || (ctx.user && ctx.user.organizationId) || '').trim();
const id = String(ctx.recordId || (ctx.record && ctx.record.id) || '').trim();
const record = ctx.record;
if (!actor || !organizationId) throw new Error('无法确认当前服务员工及组织');
if (ctx.recordLoadDenied === true || !id || !record) throw new Error('当前服务工单不存在或不可访问');
if (String(record.organization_id || '') !== organizationId) throw new Error('服务工单不属于当前组织');
if (record.status !== 'pending_dispatch') throw new Error('工单状态已变化，请刷新后重试');
// This Action is gated by forge_service_manager; supervisors may dispatch any in-org queue item.
`;

const serviceOrderDispatchEngineerSource = `
const positionRows = await ctx.api.object('sys_position').find({
  where: { organization_id: organizationId },
  fields: ['id', 'name', 'active', 'organization_id'],
});
const servicePositions = positionRows.filter(position => position.name === 'after_sales_operator' && position.active !== false);
const servicePositionKeys = new Set(servicePositions.flatMap(position => [String(position.id || ''), String(position.name || '')]));
const nowMs = Date.now();
const effectiveAt = assignment => {
  const from = assignment.valid_from ? Date.parse(String(assignment.valid_from)) : Number.NEGATIVE_INFINITY;
  const until = assignment.valid_until ? Date.parse(String(assignment.valid_until)) : Number.POSITIVE_INFINITY;
  return !Number.isNaN(from) && !Number.isNaN(until) && from <= nowMs && nowMs < until;
};
const [assignments, members, users] = await Promise.all([
  ctx.api.object('sys_user_position').find({
    where: { organization_id: organizationId },
    fields: ['user_id', 'position', 'organization_id', 'valid_from', 'valid_until'],
  }),
  ctx.api.object('sys_member').find({
    where: { organization_id: organizationId },
    fields: ['user_id', 'organization_id', 'role'],
  }),
  ctx.api.object('sys_user').find({ where: {}, fields: ['id', 'name', 'banned'] }),
]);
const assignedUserIds = new Set(assignments
  .filter(assignment => String(assignment.organization_id || '') === organizationId &&
    servicePositionKeys.has(String(assignment.position || '')) && effectiveAt(assignment))
  .map(assignment => String(assignment.user_id || '').trim())
  .filter(Boolean));
const memberUserIds = new Set(members
  .filter(member => String(member.organization_id || '') === organizationId && member.role === 'member')
  .map(member => String(member.user_id || '').trim())
  .filter(Boolean));
const engineers = users
  .filter(user => user.id && assignedUserIds.has(String(user.id)) && memberUserIds.has(String(user.id)) && user.banned !== true)
  .map(user => ({ id: String(user.id), name: String(user.name || '').trim() }))
  .filter(user => user.name)
  .sort((left, right) => left.name.localeCompare(right.name));
`;


export const ServiceOrderDispatchEngineers = defineAction({
  name: 'service_order_dispatch_engineers', label: '查询可派服务工程师', objectName: 'forge_service_order', icon: 'users',
  locations: [], requiredPermissions: ['forge_service_manager'],
  body: {
    language: 'js', capabilities: ['api.read'],
    source: serviceOrderDispatchActorSource + serviceOrderDispatchEngineerSource + `
return { engineers };
`,
  },
});

export const ServiceOrderManagerContext = defineAction({
  name: 'service_order_manager_context', label: '查询售后管理权限', objectName: 'forge_service_order',
  locations: [], requiredPermissions: ['forge_service_manager'],
  body: { language: 'js', capabilities: ['api.read'], source: `return { canManage: true };` },
});

export const ServiceOrderCreate = defineAction({
  name: 'service_order_create', label: '创建服务工单', objectName: 'forge_service_order', icon: 'file-plus-2',
  locations: [], refreshAfter: true, requiredPermissions: ['forge_service_manager'],
  params: [{ name: 'draft_json', label: '服务工单内容', type: 'textarea', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const actor=ctx.session&&ctx.session.userId,organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'');
if(!actor||!organizationId)throw new Error('无法确认当前服务员工及组织');
let draft;try{draft=JSON.parse(String(ctx.input.draft_json||''))}catch{throw new Error('服务工单格式无效')}
if(!draft||typeof draft!=='object'||Array.isArray(draft))throw new Error('服务工单格式无效');
const name=String(draft.name||'').trim(),code=String(draft.code||'').trim();
if(!name||!code||!draft.customer_id||!draft.sales_order_id)throw new Error('请填写工单标题、编号、客户和来源订单');
if(!['onsite','remote','return_repair'].includes(draft.service_mode)||!['low','medium','high','urgent'].includes(draft.urgency))throw new Error('服务方式或紧急度无效');
const customer=await ctx.api.object('forge_customer').findOne({where:{id:draft.customer_id,organization_id:organizationId}});
const order=await ctx.api.object('forge_sales_order').findOne({where:{id:draft.sales_order_id}});
if(!customer||!order||String(customer.organization_id||'')!==organizationId||String(order.organization_id||'')!==organizationId||order.customer_id!==customer.id)throw new Error('客户与来源订单不匹配或不可访问');
if(customer.status==='inactive'||!['approved','active','partially_shipped','shipped','completed'].includes(String(order.status||'')))throw new Error('服务工单必须关联启用客户和已审批或履行中的来源订单');
if(draft.contract_id&&order.contract_id!==draft.contract_id)throw new Error('关联合同与来源订单不匹配');
let contact=null;if(draft.contact_id){contact=await ctx.api.object('forge_contact').findOne({where:{id:draft.contact_id,organization_id:organizationId}});if(!contact||contact.customer_id!==customer.id||String(contact.organization_id||'')!==organizationId||contact.employment_status!=='active')throw new Error('联系人不属于当前客户或已停用')}
const fields=['service_address','service_object','service_type','region','warranty_starts_on','warranty_ends_on','warranty_status','responsibility_type','quotation_handling','fault_symptom','impact_scope','expected_visit_on','remarks'];
const payload={name,code,owner_id:actor,customer_id:customer.id,contact_id:contact&&contact.id||null,contact_phone:String(draft.contact_phone||contact&&contact.phone||''),sales_order_id:order.id,contract_id:order.contract_id||null,service_mode:draft.service_mode,urgency:draft.urgency,status:'pending_acceptance',revision:1,next_step:'受理',submitted_at:new Date().toISOString(),responsible_id:actor};
for(const field of fields)if(draft[field]!==undefined&&draft[field]!==null)payload[field]=String(draft[field]).trim();
const saved=await ctx.api.object('forge_service_order').insert(payload);
const id=typeof saved==='string'?saved:saved&&(saved.id||(saved.record&&saved.record.id));
if(!id)throw new Error('服务工单创建后未返回记录');
return{id,status:'pending_acceptance'};
` },
});

export const ServiceOrderAccept = defineAction({
  name: 'service_order_accept', label: '受理', objectName: 'forge_service_order', icon: 'circle-check', locations: [...locations], order: 10,
  requiredPermissions: ['forge_service_manager'],
  visible: `record.status == 'pending_acceptance'`, confirmText: '确认受理该服务工单并进入派工？', refreshAfter: true,
  successMessage: '服务工单已受理，等待派工',
  body: serviceOrderTransitionBody('pending_acceptance', 'pending_dispatch', `patch.accepted_at = now; patch.next_step = '派工';`),
});

export const ServiceOrderDispatch = defineAction({
  name: 'service_order_dispatch', label: '派工', objectName: 'forge_service_order', icon: 'route', locations: [...locations], order: 20,
  requiredPermissions: ['forge_service_manager'],
  visible: `record.status == 'pending_dispatch'`, refreshAfter: true,
  successMessage: '服务工单已派工，等待工程师接单',
  params: [
    { field: 'engineer_id', objectOverride: 'forge_service_order', required: true },
    { field: 'scheduled_at', objectOverride: 'forge_service_order' },
    { field: 'dispatch_note', objectOverride: 'forge_service_order', required: true },
  ],
  body: {
    language: 'js', capabilities: ['api.read', 'api.write'],
    source: serviceOrderDispatchActorSource + serviceOrderDispatchEngineerSource + `
const engineerId = String((ctx.input && ctx.input.engineer_id) || '').trim();
const engineer = engineers.find(user => user.id === engineerId);
const note = String((ctx.input && ctx.input.dispatch_note) || '').trim();
if (!engineer) throw new Error('请选择当前组织中有效任职的售后工程师');
if (!note) throw new Error('派工说明不能为空');
const now = new Date().toISOString();
const updatedAt = String(record.updated_at || ''), version = Date.parse(updatedAt), revision = Number(record.revision || 1);
if (!Number.isFinite(version)) throw new Error('服务工单读取版本无效，请刷新后重试');
const patch = {
  status: 'pending_receive',
  revision: revision + 1,
  owner_id: engineer.id,
  responsible_id: engineer.id,
  engineer_id: engineer.id,
  engineer_name: engineer.name,
  scheduled_at: (ctx.input && ctx.input.scheduled_at) || null,
  dispatch_note: note,
  dispatched_at: now,
  next_step: '工程师接单',
};
const changed = await ctx.api.object('forge_service_order').update(patch, { multi: true, where: { id, organization_id: organizationId, status: 'pending_dispatch', revision: record.revision == null ? null : revision, updated_at: { $gte: new Date(version).toISOString(), $lt: new Date(version + 1).toISOString() } } });
if (changed !== 1) throw new Error('工单已被其他操作修改，请刷新后重试');
return { id, status: patch.status, engineer_id: engineer.id, engineer_name: engineer.name };
`,
  },
});

export const ServiceOrderEngineerAccept = defineAction({
  name: 'service_order_engineer_accept', label: '工程师接单', objectName: 'forge_service_order', icon: 'wrench', locations: [...locations], order: 30,
  requiredPermissions: ['forge_service_operator'],
  visible: `record.status == 'pending_receive'`, confirmText: '确认工程师已接单并开始服务？', refreshAfter: true,
  successMessage: '工程师已接单，工单进入服务中',
  body: {
    language: 'js', capabilities: ['api.write'],
    source: `
const actor = String(ctx.session && ctx.session.userId || '').trim();
const organizationId = String((ctx.session && ctx.session.organizationId) || (ctx.user && ctx.user.organizationId) || '').trim();
const id = String(ctx.recordId || (ctx.record && ctx.record.id) || '').trim();
const record = ctx.record;
if (!actor || !organizationId) throw new Error('无法确认当前服务员工及组织');
if (ctx.recordLoadDenied === true || !id || !record) throw new Error('当前服务工单不存在或不可访问');
if (String(record.organization_id || '') !== organizationId) throw new Error('服务工单不属于当前组织');
if (record.status !== 'pending_receive') throw new Error('工单状态已变化，请刷新后重试');
if (String(record.engineer_id || '') !== actor || String(record.owner_id || '') !== actor || String(record.responsible_id || '') !== actor) {
  throw new Error('只有当前指派的服务工程师可以接单');
}
const now = new Date().toISOString();
const updatedAt=String(record.updated_at||''),version=Date.parse(updatedAt),revision=Number(record.revision||1);
if(!Number.isFinite(version))throw new Error('服务工单读取版本无效，请刷新后重试');
const patch = { status: 'in_progress', revision:revision+1, received_at: now, next_step: '处理记录 / 到场签到 / 提交服务结果' };
const changed=await ctx.api.object('forge_service_order').update(patch,{multi:true,where:{id,organization_id:organizationId,status:'pending_receive',engineer_id:actor,owner_id:actor,responsible_id:actor,revision:record.revision==null?null:revision,updated_at:{$gte:new Date(version).toISOString(),$lt:new Date(version+1).toISOString()}}});
if(changed!==1)throw new Error('工单已被其他操作修改，请刷新后重试');
return { id, status: patch.status };
`,
  },
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
  params: [{ field: 'amount', objectOverride: 'forge_sales_opportunity', required: true }, { field: 'expected_close_on', objectOverride: 'forge_sales_opportunity' }],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = String(ctx.recordId || (ctx.record && ctx.record.id) || '').trim();
if (ctx.recordLoadDenied === true || !id || !ctx.record) throw new Error('当前线索不存在或不可访问');
const params = ctx.input || {};
const rawAmount = params.amount;
if (rawAmount === undefined || rawAmount === null || (typeof rawAmount === 'string' && rawAmount.trim() === '')) {
  throw new Error('请填写商机金额');
}
if (typeof rawAmount !== 'number' && typeof rawAmount !== 'string') {
  throw new Error('商机金额必须是大于或等于零的数字');
}
const amount = Number(rawAmount);
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
  requiredPermissions: ['forge_service_operator'],
  visible: `record.status == 'in_progress'`, refreshAfter: true,
  successMessage: '服务结果已提交，后续由主管处理报价与结算',
  params: [
    { field: 'service_hours', objectOverride: 'forge_service_order' },
    { field: 'treatment_record', objectOverride: 'forge_service_order' },
    { field: 'service_result', objectOverride: 'forge_service_order' },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim(),record=ctx.record;
const actor=String(ctx.session&&ctx.session.userId||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(ctx.recordLoadDenied===true||!id||!record)throw new Error('当前服务工单不存在或不可访问');
if(!actor||!organizationId)throw new Error('无法确认当前服务员工及组织');
const treatment=String(ctx.input.treatment_record||'').trim(),result=String(ctx.input.service_result||'').trim(),hours=Number(ctx.input.service_hours||0);
if(!treatment)throw new Error('请至少填写一条处理记录后再提交服务结果');
if(!Number.isFinite(hours)||!(hours>0))throw new Error('服务耗时必须大于 0');
if(!result)throw new Error('服务结果不能为空');
const fileTokens=value=>Array.isArray(value)?value.flatMap(fileTokens):value&&typeof value==='object'?fileTokens(value.id||value.fileId):typeof value==='string'?[value.trim()]:[];
const fileIds=[...new Set(fileTokens(record.onsite_evidence_attachments).filter(Boolean))];
if(!fileIds.length)throw new Error('请先上传并关联至少一张现场处理图片');
if(fileIds.length>20)throw new Error('现场处理图片不能超过 20 张');
return await ctx.api.transaction(async()=>{
  const orders=ctx.api.object('forge_service_order'),files=ctx.api.object('sys_file');
  const current=await orders.findOne({where:{id,organization_id:organizationId}});
  if(!current||String(current.organization_id||'')!==organizationId)throw new Error('服务工单不存在或不属于当前组织');
  if(current.status!=='in_progress')throw new Error('工单状态已变化，请刷新后重试');
  if(String(current.engineer_id||'')!==actor||String(current.owner_id||'')!==actor||String(current.responsible_id||'')!==actor)throw new Error('只有当前指派的服务工程师可以提交服务结果');
  if(String(record.updated_at||'')!==String(current.updated_at||''))throw new Error('服务工单已被其他操作修改，请刷新后重试');
  for(const fileId of fileIds){
    const file=await files.findOne({where:{id:fileId}});
    if(!file||file.status!=='committed'||String(file.owner_id||'')!==actor||String(file.organization_id||'')!==organizationId||!String(file.mime_type||'').toLowerCase().startsWith('image/'))throw new Error('现场图片尚未提交完成或不属于当前员工及组织');
    if(file.ref_object!=='forge_service_order'||String(file.ref_id||'')!==id||file.ref_field!=='onsite_evidence_attachments')throw new Error('现场图片尚未关联到当前服务工单');
  }
  const time=Date.parse(String(current.updated_at||''));
  if(!Number.isFinite(time))throw new Error('服务工单读取版本无效，请刷新后重试');
  const lower=new Date(time).toISOString(),upper=new Date(time+1).toISOString(),now=new Date().toISOString();
  const currentRevision=Number(current.revision||1),changed=await orders.update({status:'completed',revision:currentRevision+1,service_hours:hours,treatment_record:treatment,service_result:result,completed_at:now,next_step:'服务报价 / 服务结算 / 质保卡'},{multi:true,where:{id,organization_id:organizationId,status:'in_progress',engineer_id:actor,owner_id:actor,responsible_id:actor,revision:current.revision==null?null:currentRevision,updated_at:{$gte:lower,$lt:upper}}});
  if(changed!==1)throw new Error('服务工单已被其他操作修改，请刷新后重试');
  return{id,status:'completed',onsite_evidence_attachments:fileIds};
});
` },
});

export const ServiceOrderCreateQuotation = defineAction({
  name: 'service_order_create_quotation', label: '生成服务报价', objectName: 'forge_service_order', icon: 'file-text', locations: [...locations], order: 50,
  requiredPermissions: ['forge_service_manager'],
  visible: `record.status == 'completed'`, refreshAfter: true,
  successMessage: '服务报价单已生成',
  params: [
    { field: 'total_amount', objectOverride: 'forge_service_quotation', required: true },
    { field: 'valid_until', objectOverride: 'forge_service_quotation', required: true },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const order = ctx.record;
if (ctx.recordLoadDenied === true || !id || !order) throw new Error('当前服务工单不存在或不可访问');
const organizationId = String((ctx.session && ctx.session.organizationId) || (ctx.user && ctx.user.organizationId) || '').trim();
if (!organizationId || String(order.organization_id || '') !== organizationId) throw new Error('当前服务工单不属于当前组织');
if (order.status !== 'completed') throw new Error('仅已完工服务工单可以生成报价');
const amount = Number(ctx.input.total_amount || 0); if (!(amount >= 0)) throw new Error('报价金额不能为负数');
if (!ctx.input.valid_until) throw new Error('有效期不能为空');
const actor = ctx.session && ctx.session.userId;
const existing = await ctx.api.object('forge_service_quotation').find({ where: { service_order_id: id } });
if (existing.length) throw new Error('该服务工单已生成服务报价');
const code = 'SQ-' + new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
const created = await ctx.api.object('forge_service_quotation').insert({ name: order.name + ' - 服务报价', code, owner_id:actor, service_order_id: id, order_code: order.code, customer_id: order.customer_id, contact_id: order.contact_id || null, total_amount: amount, status: 'draft', valid_until: ctx.input.valid_until, responsible_id: order.responsible_id || actor || null, remarks: order.service_result || order.remarks || null });
const quotationId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
await ctx.api.object('forge_service_order').update({ id, quotation_code: code, quotation_handling: '已生成服务报价', next_step: '客户确认服务报价' });
return { id: quotationId, code, service_order_id: id };
` },
});

export const ServiceOrderCreateSettlement = defineAction({
  name: 'service_order_create_settlement', label: '生成服务结算', objectName: 'forge_service_order', icon: 'receipt-text', locations: [...locations], order: 55,
  requiredPermissions: ['forge_service_manager'],
  visible: `record.status == 'completed'`, refreshAfter: true,
  successMessage: '服务结算单已生成',
  params: [{ field: 'total_amount', objectOverride: 'forge_service_settlement', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const order = ctx.record;
if (ctx.recordLoadDenied === true || !id || !order) throw new Error('当前服务工单不存在或不可访问');
const organizationId = String((ctx.session && ctx.session.organizationId) || (ctx.user && ctx.user.organizationId) || '').trim();
if (!organizationId || String(order.organization_id || '') !== organizationId) throw new Error('当前服务工单不属于当前组织');
if (order.status !== 'completed') throw new Error('仅已完工服务工单可以生成结算');
const amount = Number(ctx.input.total_amount || 0); if (!(amount >= 0)) throw new Error('结算金额不能为负数');
const actor = ctx.session && ctx.session.userId;
const existing = await ctx.api.object('forge_service_settlement').find({ where: { service_order_id: id } });
if (existing.length) throw new Error('该服务工单已生成服务结算');
const code = 'SS-' + new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
const created = await ctx.api.object('forge_service_settlement').insert({ name: order.name + ' - 服务结算', code, owner_id:actor, service_order_id: id, quotation_id: null, order_code: order.code, customer_id: order.customer_id, contact_id: order.contact_id || null, total_amount: amount, status: 'draft', responsible_id: order.responsible_id || actor || null, remarks: order.service_result || order.remarks || null });
const settlementId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
await ctx.api.object('forge_service_order').update({ id, settlement_code: code, next_step: '服务结算确认 / 财务应收' });
return { id: settlementId, code, service_order_id: id };
` },
});

const serviceQuotationRevisionGuard = `
const actor = String(ctx.session && ctx.session.userId || '').trim();
if (!actor || !organizationId) throw new Error('无法确认当前服务主管及组织');
if (ctx.user && ctx.user.id != null && String(ctx.user.id) !== actor) throw new Error('当前员工身份不一致，请重新登录');
if (ctx.user && ctx.user.organizationId != null && String(ctx.user.organizationId) !== organizationId) throw new Error('当前组织身份不一致，请重新登录');
const requestedRevision = ctx.input && ctx.input.expected_revision;
const snapshotRevision = quote.revision == null ? 1 : Number(quote.revision);
const expectedRevision = requestedRevision == null ? snapshotRevision : Number(requestedRevision);
if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !Number.isSafeInteger(snapshotRevision) || snapshotRevision < 1) throw new Error('服务报价版本不可用，请重新打开核对');
const quotations = ctx.api.object('forge_service_quotation');
`;

export const ServiceQuotationConfirm = defineAction({
  name: 'service_quotation_confirm', label: '客户确认', objectName: 'forge_service_quotation', icon: 'circle-check', locations: [...locations], order: 10,
  requiredPermissions: ['forge_service_manager'],
  visible: `record.status == 'draft' || record.status == 'pending_confirmation'`, description: '确认客户已接受这份服务报价？', refreshAfter: true,
  successMessage: '服务报价已确认',
  params: [{ name: 'expected_revision', label: '读取数据版本', type: 'number', visible: 'false' }],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const quote = ctx.record;
if (ctx.recordLoadDenied === true || !id || !quote) throw new Error('当前服务报价不存在或不可访问');
const organizationId = String((ctx.session && ctx.session.organizationId) || (ctx.user && ctx.user.organizationId) || '').trim();
if (!organizationId || String(quote.organization_id || '') !== organizationId) throw new Error('当前服务报价不属于当前组织');
${serviceQuotationRevisionGuard}
return await ctx.api.transaction(async () => {
  const current = await quotations.findOne({ where: { id, organization_id: organizationId } });
  if (!current || String(current.organization_id || '') !== organizationId) throw new Error('当前服务报价不存在或不可访问');
  if (!['draft','pending_confirmation'].includes(current.status)) throw new Error('当前服务报价状态不能确认');
  const revision = current.revision == null ? 1 : Number(current.revision), nextRevision = revision + 1;
  if (revision !== expectedRevision || !Number.isSafeInteger(nextRevision)) throw new Error('服务报价已变化，请重新打开核对');
  const changed = await quotations.update({ status: 'confirmed', revision: nextRevision }, { multi: true, where: { id, organization_id: organizationId, status: current.status, revision: current.revision == null ? null : revision } });
  if (changed !== 1) throw new Error('服务报价已变化，请重新打开核对');
  return { id, status: 'confirmed', revision: nextRevision };
});
` },
});

export const ServiceQuotationCreateSettlement = defineAction({
  name: 'service_quotation_create_settlement', label: '转服务结算', objectName: 'forge_service_quotation', icon: 'receipt-text', locations: [...locations], order: 20,
  requiredPermissions: ['forge_service_manager'],
  visible: `record.status == 'confirmed'`, refreshAfter: true,
  successMessage: '服务结算单已生成',
  params: [{ name: 'expected_revision', label: '读取数据版本', type: 'number', visible: 'false' }],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const quote = ctx.record;
if (ctx.recordLoadDenied === true || !id || !quote) throw new Error('当前服务报价不存在或不可访问');
const organizationId = String((ctx.session && ctx.session.organizationId) || (ctx.user && ctx.user.organizationId) || '').trim();
if (!organizationId || String(quote.organization_id || '') !== organizationId) throw new Error('当前服务报价不属于当前组织');
${serviceQuotationRevisionGuard}
return await ctx.api.transaction(async () => {
const current = await quotations.findOne({ where: { id, organization_id: organizationId } });
if (!current || String(current.organization_id || '') !== organizationId) throw new Error('当前服务报价不存在或不可访问');
if (current.status !== 'confirmed') throw new Error('仅已确认服务报价可以转结算');
const revision = current.revision == null ? 1 : Number(current.revision), nextRevision = revision + 1;
if (revision !== expectedRevision || !Number.isSafeInteger(nextRevision)) throw new Error('服务报价已变化，请重新打开核对');
const existing = await ctx.api.object('forge_service_settlement').find({ where: { quotation_id: id, organization_id: organizationId } });
if (existing.length) throw new Error('该服务报价已生成服务结算');
if (current.total_amount == null || current.total_amount === '' || !Number.isFinite(Number(current.total_amount)) || Number(current.total_amount) < 0) throw new Error('当前报价金额不可用，不能生成服务结算');
if (current.service_order_id) {
  const order = await ctx.api.object('forge_service_order').findOne({ where: { id: current.service_order_id, organization_id: organizationId } });
  if (!order || String(order.organization_id || '') !== organizationId) throw new Error('关联服务工单不存在或不属于当前组织');
}
const changed = await quotations.update({ status: 'settlement_created', revision: nextRevision }, { multi: true, where: { id, organization_id: organizationId, status: 'confirmed', revision: current.revision == null ? null : revision } });
if (changed !== 1) throw new Error('服务报价已变化，请重新打开核对');
const code = 'SS-' + new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
const created = await ctx.api.object('forge_service_settlement').insert({ name: String(current.name || current.code || '服务报价').replace('服务报价','服务结算'), code, owner_id:actor, organization_id: organizationId, service_order_id: current.service_order_id || null, quotation_id: id, order_code: current.order_code, customer_id: current.customer_id, contact_id: current.contact_id || null, total_amount: Number(current.total_amount), status: 'draft', responsible_id: current.responsible_id || actor || null, remarks: current.remarks || null });
const settlementId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
if (!settlementId) throw new Error('服务结算创建后未返回记录标识');
if (current.service_order_id) await ctx.api.object('forge_service_order').update({ id: current.service_order_id, settlement_code: code, next_step: '服务结算确认' });
return { id: settlementId, code, quotation_id: id };
});
` },
});

export const ServiceSettlementConfirm = defineAction({
  name: 'service_settlement_confirm', label: '确认结算', objectName: 'forge_service_settlement', icon: 'circle-check', locations: [...locations], order: 10,
  requiredPermissions: ['forge_service_manager'],
  visible: `record.status == 'draft' || record.status == 'customer_confirming'`, confirmText: '确认服务结算金额并进入财务应收？', refreshAfter: true,
  successMessage: '服务结算已确认',
  body: { language: 'js', capabilities: ['api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const record = ctx.record;
if (ctx.recordLoadDenied === true || !id || !record) throw new Error('当前服务结算不存在或不可访问');
const organizationId = String((ctx.session && ctx.session.organizationId) || (ctx.user && ctx.user.organizationId) || '').trim();
if (!organizationId || String(record.organization_id || '') !== organizationId) throw new Error('当前服务结算不属于当前组织');
if (!['draft','customer_confirming'].includes(record.status)) throw new Error('当前服务结算状态不能确认');
await ctx.api.object('forge_service_settlement').update({ id, status: 'confirmed' });
return { id, status: 'confirmed' };
` },
});

export const ServiceSettlementCreateReceivable = defineAction({
  name: 'service_settlement_create_receivable', label: '生成应收', objectName: 'forge_service_settlement', icon: 'wallet-cards', locations: [...locations], order: 20,
  requiredPermissions: ['forge_service_manager'],
  visible: `record.status == 'confirmed'`, refreshAfter: true,
  successMessage: '服务应收已生成',
  params: [{ field: 'due_on', objectOverride: 'forge_accounts_receivable', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const settlement = ctx.record;
if (ctx.recordLoadDenied === true || !id || !settlement) throw new Error('当前服务结算不存在或不可访问');
const organizationId = String((ctx.session && ctx.session.organizationId) || (ctx.user && ctx.user.organizationId) || '').trim();
if (!organizationId || String(settlement.organization_id || '') !== organizationId) throw new Error('当前服务结算不属于当前组织');
if (settlement.status !== 'confirmed') throw new Error('仅已确认服务结算可以生成应收');
if (!ctx.input.due_on) throw new Error('应收到期日不能为空');
const actor = ctx.session && ctx.session.userId;
const responsibleId = settlement.responsible_id || actor;
if (!responsibleId) throw new Error('无法识别当前应收负责人');
const existing = await ctx.api.object('forge_accounts_receivable').find({ where: { service_settlement_id: id } });
if (existing.length) throw new Error('该服务结算已生成应收');
const code = 'AR-SVC-' + new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
await ctx.api.object('forge_accounts_receivable').insert({ name: settlement.name + ' - 应收', code, source_type: 'service_settlement', service_settlement_id: id, customer_id: settlement.customer_id, recognized_on: new Date().toISOString().slice(0,10), due_on: ctx.input.due_on, original_amount: Number(settlement.total_amount || 0), collected_amount: 0, outstanding_amount: Number(settlement.total_amount || 0), status: 'unpaid', responsible_id: responsibleId, remarks: '服务结算生成应收' });
await ctx.api.object('forge_service_settlement').update({ id, status: 'receivable_created', receivable_code: code });
if (settlement.service_order_id) await ctx.api.object('forge_service_order').update({ id: settlement.service_order_id, next_step: '财务收款 / 服务复盘' });
return { id, receivable_code: code };
` },
});

export const ServiceOrderCreateWarranty = defineAction({
  name: 'service_order_create_warranty', label: '生成质保卡', objectName: 'forge_service_order', icon: 'shield-check', locations: [...locations], order: 60,
  requiredPermissions: ['forge_service_operator'],
  visible: `record.status == 'completed'`, refreshAfter: true,
  successMessage: '待激活质保卡已生成',
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id=String(ctx.recordId||(ctx.record&&ctx.record.id)||'').trim(),order=ctx.record;
const actor=String(ctx.session&&ctx.session.userId||'').trim();
const organizationId=String((ctx.session&&ctx.session.organizationId)||(ctx.user&&ctx.user.organizationId)||'').trim();
if(ctx.recordLoadDenied===true||!id||!order)throw new Error('当前服务工单不存在或不可访问');
if(!actor||!organizationId)throw new Error('无法识别当前服务员工及组织');
if(String(order.organization_id||'')!==organizationId)throw new Error('服务工单不属于当前组织');
if(String(order.engineer_id||'')!==actor||String(order.owner_id||'')!==actor||String(order.responsible_id||'')!==actor)throw new Error('只有当前指派的服务工程师可以生成质保卡');
return await ctx.api.transaction(async()=>{
  const orders=ctx.api.object('forge_service_order'),cards=ctx.api.object('forge_warranty_card');
  const current=await orders.findOne({where:{id,organization_id:organizationId}});
  if(!current||current.status!=='completed')throw new Error('仅已完工服务工单可以生成质保卡');
  const existing=await cards.find({where:{service_order_id:id,organization_id:organizationId}});
  if(existing.length)throw new Error('该服务工单已生成质保卡');
  const created=await cards.insert({name:current.service_object||current.name,owner_id:actor,service_order_id:id,sales_order_id:current.sales_order_id||null,customer_id:current.customer_id,product_sn:current.service_object||current.name,scope:'整机/整单服务',starts_on:current.warranty_starts_on||null,ends_on:current.warranty_ends_on||null,status:'pending_activation',revision:1,responsible_party:'供应商',remarks:current.service_result||null,organization_id:organizationId});
  const cardId=typeof created==='string'?created:created&&(created.id||(created.record&&created.record.id));
  if(!cardId)throw new Error('质保卡创建后未返回记录标识');
  const savedCard=await cards.findOne({where:{id:cardId,organization_id:organizationId}}),code=String(savedCard&&savedCard.code||'');
  if(!code)throw new Error('质保卡编号生成后未能读回');
  const time=Date.parse(String(current.updated_at||''));
  if(!Number.isFinite(time))throw new Error('服务工单读取版本无效，请刷新后重试');
  const revision=Number(current.revision||1),changed=await orders.update({warranty_code:code,revision:revision+1},{multi:true,where:{id,organization_id:organizationId,status:'completed',revision:current.revision==null?null:revision,updated_at:{$gte:new Date(time).toISOString(),$lt:new Date(time+1).toISOString()}}});
  if(changed!==1)throw new Error('服务工单已被其他操作修改，请刷新后重试');
  return{id:cardId,warranty_code:code,status:'pending_activation'};
});
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

export const ContractSetOrderConditions = defineAction({
  name: 'contract_set_order_conditions', label: '确认下单条件', objectName: 'forge_sales_contract',
  icon: 'clipboard-check', locations: [...locations], refreshAfter: true,
  requiredPermissions: ['sales_contract_operator'], visible: "record.status == 'active' && record.signed_on == null",
  ai: { exposed: true, category: 'action', requiresConfirmation: false,
    description: '合同负责人根据已内部复核通过的合同原文明确是否先收预付款及金额，签署归档后不允许覆盖；不从自由文本或模型推断付款条件。' },
  params: [
    { name: 'order_payment_requirement', label: '下单付款条件', type: 'select', required: true,
      options: [{ value: 'none', label: '无需预付款' }, { value: 'prepayment', label: '先确认预付款' }] },
    { field: 'order_prepayment_amount', objectOverride: 'forge_sales_contract' },
  ], target: ORDER_CONDITIONS_TARGET,
});

export const SalesOrderApplyCompletedApproval = defineAction({
  name: 'sales_order_apply_completed_approval', label: '核对并完成订单', objectName: 'forge_sales_order',
  icon: 'clipboard-check', locations: ['record_header', 'record_more'], refreshAfter: true,
  requiredPermissions: ['sales_order_operator'],
  visible: "record.status == 'pending_approval'",
  ai: { exposed: true, category: 'action', requiresConfirmation: false,
    description: '订单原生审批已有正式结论但业务状态更新中断时，由本人经办人核对同一审批及提交版本，原子补全原订单和合同累计，不新建审批或重作意见。' },
  target: ORDER_APPLY_APPROVAL_TARGET,
});
