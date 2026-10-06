import type { IObjectQLEngine, IStorageService } from '@objectstack/spec/contracts';
import type { ActionHandlerContext } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { businessContext, businessDriver, lockBusinessRow } from './business-transaction.js';
import { businessRecordVersion } from './business-record-version.js';
import { employeeBusinessBinding } from './employee-business-binding.js';
import { effectivePositionUsers } from './business-position-resolution.js';
import { quotationContentDigest } from './sales-quotation-readiness.js';
import { calendarDate, roundedMoney } from './sales-order-readiness.js';
import { canonicalJSON, digest, nonempty, TaskConnectionFailure } from './native-task-auth.js';

export const QUOTATION_SUBMIT_TARGET = 'forgeSubmitQuotation';
export const QUOTATION_SEND_TARGET = 'forgeRegisterQuotationSend';
export const QUOTATION_ACCEPT_TARGET = 'forgeRegisterQuotationAcceptance';
export const QUOTATION_CONVERT_TARGET = 'forgeConvertQuotationToContract';
type Row = Record<string, unknown>;
type Handler = ActionHandlerContext<Row> & { recordLoadDenied?: boolean };
type Caller = { actorId: string; organizationId: string; recordId: string };
function caller(ctx: Handler): Caller {
  const actorId = nonempty(ctx.user?.id), organizationId = nonempty(ctx.session?.organizationId), recordId = nonempty(ctx.record?.id);
  if (ctx.recordLoadDenied === true || !actorId || ctx.session?.userId !== actorId || !organizationId || !recordId
    || ctx.record.organization_id !== organizationId || ctx.params.recordId && ctx.params.recordId !== recordId) throw new Error('FORBIDDEN: 当前报价或操作员工及组织不可确认');
  return { actorId, organizationId, recordId };
}
function text(value: unknown, label: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || value.includes('\0')) throw new Error('请填写有效的' + label);
  return value.trim();
}
function fileId(value: unknown): string {
  if (Array.isArray(value) && value.length !== 1) throw new Error('此动作只接受一份准确原件');
  const item = Array.isArray(value) ? value[0] : value;
  return text(typeof item === 'string' ? item : item && typeof item === 'object' && 'id' in item ? item.id : undefined, '原件引用', 128);
}
async function get(engine: IObjectQLEngine, object: string, id: string, who: Caller, context: ExecutionContext): Promise<Row> {
  const row = await engine.findOne(object, { where: { id, organization_id: who.organizationId } }, { context });
  if (!row) throw new Error('FORBIDDEN: 相关业务记录不存在或组织不一致');
  return row;
}
function version(quote: Row): number {
  const value = Number(quote.pricing_version ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('当前报价核价版本无效');
  return value;
}
async function lockedQuotation(engine: IObjectQLEngine, who: Caller, transaction: ExecutionContext, actionName: string) {
  await lockBusinessRow(engine, 'forge_quotation', who.recordId, who.organizationId, transaction);
  const quote = await get(engine, 'forge_quotation', who.recordId, who, transaction);
  if (quote.responsible_id !== who.actorId || quote.owner_id !== who.actorId) throw new Error('FORBIDDEN: 仅报价负责人本人可以办理自己的报价');
  let lines = await engine.find('forge_quotation_line', { where: { quotation_id: who.recordId, organization_id: who.organizationId }, orderBy: [{ field: 'id', order: 'asc' }], limit: 1001 }, { context: transaction });
  if (!lines.length || lines.length > 1000) throw new Error('报价明细不可完整核对');
  for (const line of lines) await lockBusinessRow(engine, 'forge_quotation_line', String(line.id), who.organizationId, transaction);
  const lockedIds = lines.map(line => line.id);
  lines = await engine.find('forge_quotation_line', { where: { quotation_id: who.recordId, organization_id: who.organizationId }, orderBy: [{ field: 'id', order: 'asc' }], limit: 1001 }, { context: transaction });
  if (lines.length !== lockedIds.length || lines.some((line, index) => line.id !== lockedIds[index])) throw new Error('报价原始明细已变化，请重新读取');
  const bound = employeeBusinessBinding();
  if (bound && (!Number.isFinite(Date.parse(bound.expiresAt)) || Date.parse(bound.expiresAt) <= Date.now())) throw new TaskConnectionFailure(409, 'EMPLOYEE_ACTION_CONTEXT_CHANGED', '本次报价办理上下文已过期，请重新打开');
  if (bound && (bound.userId !== who.actorId || bound.organizationId !== who.organizationId || bound.objectName !== 'forge_quotation'
    || bound.recordId !== who.recordId || bound.actionName !== actionName || bound.recordVersion !== await businessRecordVersion(engine, 'forge_quotation', who.recordId, who.organizationId, transaction))) {
    throw new TaskConnectionFailure(409, 'EMPLOYEE_ACTION_CONTEXT_CHANGED', '本次授权的报价或原始明细版本已变化');
  }
  return { quote, lines };
}
async function assertFrozenContent(quote: Row, lines: Row[]) {
  const current = version(quote);
  if (quote.submitted_pricing_version == null || Number(quote.submitted_pricing_version) !== current
    || !/^[0-9a-f]{64}$/.test(String(quote.submitted_content_sha256)) || await quotationContentDigest(quote, lines) !== quote.submitted_content_sha256) throw new Error('报价内容与已提交审批的版本不一致，请核对原结果');
  return current;
}
async function evidence(engine: IObjectQLEngine, storage: IStorageService, who: Caller, id: string, parameter: string, transaction: ExecutionContext) {
  await lockBusinessRow(engine, 'sys_file', id, who.organizationId, transaction);
  const file = await get(engine, 'sys_file', id, who, transaction);
  if (file.status !== 'committed' || file.owner_id !== who.actorId || file.acl !== 'private' || !file.key
    || !['user', 'attachments'].includes(String(file.scope))) throw new Error('凭证必须是当前员工已上传的准确原件');
  const bytes = new Uint8Array(await storage.download(String(file.key)));
  if (!bytes.length || bytes.length > 2 * 1024 * 1024 || bytes.length !== Number(file.size)) throw new Error('凭证原件字节不可核验');
  const hash = await digest(bytes), bound = employeeBusinessBinding();
  if (bound && (!bound.file || bound.file.parameter !== parameter || bound.file.fileId !== id || bound.file.sha256 !== hash
    || bound.file.name !== file.name || bound.file.mediaType !== String(file.mime_type).toLowerCase() || bound.file.bytes !== bytes.length)) {
    throw new TaskConnectionFailure(409, 'EMPLOYEE_ACTION_FILE_CHANGED', '本轮原件与固定材料不一致');
  }
  return { file, sha256: hash };
}
async function verifyArchivedEvidence(engine: IObjectQLEngine, storage: IStorageService, who: Caller, quote: Row, field: string, hash: string, transaction: ExecutionContext) {
  const id = fileId(quote[field]), file = await get(engine, 'sys_file', id, who, transaction);
  if (file.status !== 'committed' || file.owner_id !== who.actorId || file.ref_object !== 'forge_quotation' || file.ref_id !== who.recordId
    || file.ref_field !== field || !file.key || await digest(new Uint8Array(await storage.download(String(file.key)))) !== hash) throw new Error('凭证原件与当前报价的归档绑定不一致');
}

/** These are the four existing native actions, now with one domain transaction
 * shared by GUI and the employee connection. No alternate write path. */
export async function submitQuotation(engine: IObjectQLEngine, ctx: Handler) {
  const who = caller(ctx);
  businessDriver(engine, ['forge_quotation', 'forge_quotation_line']);
  return engine.transaction(async transaction => {
    const { quote, lines } = await lockedQuotation(engine, who, transaction, 'quotation_submit'), current = version(quote);
    if (quote.status !== 'draft') {
      if (quote.submitted_by === who.actorId && Number(quote.submitted_pricing_version) === current
        && quote.submitted_content_sha256 === await quotationContentDigest(quote, lines) && typeof quote.submitted_action_receipt === 'string') {
        const receipt = JSON.parse(quote.submitted_action_receipt) as Row;
        if (receipt.id === who.recordId && receipt.status === 'pending_approval') return { ...receipt, repeated: true };
      }
      throw new Error('仅本人草稿报价可以提交审批，已有提交须沿原结果核对');
    }
    if (quote.valid_until && String(quote.valid_until).slice(0, 10) < new Date().toISOString().slice(0, 10)) throw new Error('报价已过有效期，请更新有效期后再提交');
    const customer = await get(engine, 'forge_customer', String(quote.customer_id), who, transaction);
    if (customer.owner_id !== who.actorId) throw new Error('报价客户不属于当前负责员工');
    await get(engine, 'forge_quotation_issuer', String(quote.issuer_id), who, transaction);
    if (quote.contact_id) {
      const contact = await get(engine, 'forge_contact', String(quote.contact_id), who, transaction);
      if (contact.customer_id !== quote.customer_id || contact.owner_id !== who.actorId || contact.employment_status !== 'active') throw new Error('报价联系人不存在或已不可用');
    }
    if (lines.length > 100) throw new Error('报价最多支持100条明细');
    let subtotal = 0, total = 0, tax = 0;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index], quantity = Number(line.quantity), price = Number(line.taxed_unit_price), rate = Number(line.tax_rate), discount = Number(line.discount_rate);
      if (!(quantity > 0) || !Number.isFinite(quantity) || !Number.isFinite(price) || price < 0 || !Number.isFinite(rate) || rate < 0 || rate > 100
        || !Number.isFinite(discount) || discount < 0 || discount > 100) throw new Error('第' + (index + 1) + '条报价明细数量、价格、税率或折扣无效');
      if (line.line_type === 'service') {
        if (!line.name || line.sku_id) throw new Error('服务项目必须有名称且不能关联物料规格');
      } else if (line.line_type === 'material') {
        if (!line.sku_id) throw new Error('物料明细缺少规格');
        const sku = await get(engine, 'forge_material_sku', String(line.sku_id), who, transaction);
        const material = await get(engine, 'forge_material', String(sku.material_id), who, transaction);
        const unit = material.unit_id ? await get(engine, 'forge_unit', String(material.unit_id), who, transaction) : undefined;
        if (sku.enabled === false || material.status === 'inactive' || !unit || unit.status === 'inactive') throw new Error('物料规格或计量单位已不可用');
      } else throw new Error('报价明细类型无效');
      const lineTotal = roundedMoney(quantity * price * (1 - discount / 100));
      subtotal += quantity * price; total += lineTotal; tax += rate > 0 ? lineTotal - lineTotal / (1 + rate / 100) : 0;
      await engine.update('forge_quotation_line', { id: line.id, taxed_subtotal: lineTotal }, { context: transaction });
    }
    const reviewers = await effectivePositionUsers(engine, who.organizationId, 'sales_quotation_reviewer', { exclude: who.actorId, context: transaction });
    if (!reviewers.length) throw new Error('销售报价审批岗缺少独立有效任职员工，请先完成分配');
    const totals = { item_count: lines.length, subtotal: roundedMoney(subtotal), discount_amount: roundedMoney(subtotal - total), tax_amount: roundedMoney(tax), total_amount: roundedMoney(total) };
    const submittedAt = new Date().toISOString();
    const receipt = { id: who.recordId, ...totals, submitted_pricing_version: current, submitted_at: submittedAt, status: 'pending_approval' };
    const refreshedLines = await engine.find('forge_quotation_line', { where: { quotation_id: who.recordId, organization_id: who.organizationId }, orderBy: [{ field: 'id', order: 'asc' }], limit: 1001 }, { context: transaction });
    const content = await quotationContentDigest({ ...quote, ...totals }, refreshedLines);
    const changed = await engine.update('forge_quotation', { ...totals, submitted_pricing_version: current, submitted_content_sha256: content,
      submitted_action_receipt: JSON.stringify(receipt), approved_pricing_version: null, submitted_at: submittedAt, submitted_by: who.actorId, status: 'pending_approval' },
    { multi: true, where: { id: who.recordId, organization_id: who.organizationId, owner_id: who.actorId, responsible_id: who.actorId, status: 'draft', pricing_version: quote.pricing_version ?? null }, context: transaction });
    if (changed !== 1) throw new Error('报价状态或核价版本已变化，请刷新后重试');
    return receipt;
  }, businessContext(who.actorId, who.organizationId), { require: true });
}

async function registerEvidence(engine: IObjectQLEngine, storage: IStorageService, ctx: Handler, accepting: boolean) {
  const who = caller(ctx), action = accepting ? 'quotation_accept' : 'quotation_send';
  const field = accepting ? 'customer_acceptance_evidence_attachment' : 'sent_evidence_attachment';
  const noteField = accepting ? 'customer_acceptance_note' : 'sent_evidence_note';
  const signatureField = accepting ? 'customer_acceptance_request_signature' : 'sent_evidence_request_signature';
  const hashField = accepting ? 'customer_acceptance_evidence_sha256' : 'sent_evidence_sha256';
  const stage = accepting ? 'accepted' : 'sent', previous = accepting ? 'sent' : 'approved';
  const rawNote = ctx.params[noteField], note = text(rawNote, accepting ? '客户接受说明' : '发送说明', 2000), sourceId = fileId(ctx.params[field]);
  businessDriver(engine, ['forge_quotation', 'forge_quotation_line', 'sys_file']);
  return engine.transaction(async transaction => {
    const { quote, lines } = await lockedQuotation(engine, who, transaction, action), current = await assertFrozenContent(quote, lines);
    const signature = JSON.stringify({ action, quotation_id: who.recordId, organization_id: who.organizationId,
      actor_id: who.actorId, pricing_version: current, source_file_id: sourceId, note: rawNote });
    const original = await evidence(engine, storage, who, sourceId, field, transaction);
    if (quote[signatureField] === signature && quote[noteField] === note && quote[hashField] === original.sha256
      && quote[stage + '_by'] === who.actorId && Number(quote[stage + '_pricing_version']) === current
      && (quote.status === stage || !accepting && quote.status === 'accepted')) {
      await verifyArchivedEvidence(engine, storage, who, quote, field, original.sha256, transaction);
      return { id: who.recordId, status: stage, [stage + '_at']: quote[stage + '_at'], [stage + '_pricing_version']: current, repeated: true };
    }
    if (quote.status !== previous) throw new Error('凭证请求与已登记原件不一致，或报价状态已变化');
    if (quote.approved_pricing_version == null || Number(quote.approved_pricing_version) !== current
      || accepting && (quote.sent_pricing_version == null || Number(quote.sent_pricing_version) !== current)) throw new Error('当前凭证必须对应准确已审批或已发送的报价版本');
    if (accepting) await verifyArchivedEvidence(engine, storage, who, quote, 'sent_evidence_attachment', String(quote.sent_evidence_sha256), transaction);
    const at = new Date().toISOString();
    const changed = await engine.update('forge_quotation', { status: stage, [noteField]: note, [signatureField]: signature, [hashField]: original.sha256,
      [stage + '_at']: at, [stage + '_by']: who.actorId, [stage + '_pricing_version']: current },
    { multi: true, where: { id: who.recordId, organization_id: who.organizationId, responsible_id: who.actorId, owner_id: who.actorId, status: previous,
      pricing_version: quote.pricing_version ?? null, submitted_pricing_version: current, approved_pricing_version: current,
      ...(accepting ? { sent_pricing_version: current } : {}) }, context: transaction });
    if (changed !== 1) throw new Error('报价状态或核价版本已变化，请刷新后重试');
    const linked = await engine.update('forge_quotation', { id: who.recordId, [field]: sourceId }, { context: transaction });
    if (!linked) throw new Error('凭证关联失败，事务已回滚');
    const archived = await get(engine, 'forge_quotation', who.recordId, who, transaction);
    await verifyArchivedEvidence(engine, storage, who, archived, field, original.sha256, transaction);
    return { id: who.recordId, status: stage, [stage + '_at']: at, [stage + '_pricing_version']: current };
  }, businessContext(who.actorId, who.organizationId), { require: true });
}
export function registerQuotationSend(engine: IObjectQLEngine, storage: IStorageService, ctx: Handler) { return registerEvidence(engine, storage, ctx, false); }
export function registerQuotationAcceptance(engine: IObjectQLEngine, storage: IStorageService, ctx: Handler) { return registerEvidence(engine, storage, ctx, true); }

export async function convertQuotationToContract(engine: IObjectQLEngine, storage: IStorageService, ctx: Handler) {
  const who = caller(ctx), typeId = text(ctx.params.contract_type_id, '合同类型', 128), code = text(ctx.params.code, '合同编号', 100), name = text(ctx.params.name, '合同名称', 255);
  const startsOn = calendarDate(ctx.params.starts_on, '合同生效日期'), endsOn = calendarDate(ctx.params.ends_on, '合同到期日期');
  if (endsOn < startsOn) throw new Error('合同到期日期不得早于生效日期');
  businessDriver(engine, ['forge_quotation', 'forge_quotation_line', 'forge_sales_contract', 'forge_sales_contract_line', 'forge_quotation_contract_conversion', 'sys_file']);
  return engine.transaction(async transaction => {
    const { quote, lines } = await lockedQuotation(engine, who, transaction, 'quotation_convert_to_contract'), current = await assertFrozenContent(quote, lines);
    if (quote.status !== 'accepted' || quote.accepted_by !== who.actorId || quote.approved_pricing_version == null || Number(quote.approved_pricing_version) !== current
      || quote.sent_pricing_version == null || Number(quote.sent_pricing_version) !== current
      || quote.accepted_pricing_version == null || Number(quote.accepted_pricing_version) !== current) throw new Error('仅当前核价版本已审批、发送并接受的报价可以转为合同');
    const requestSignature = JSON.stringify({ action: 'quotation_convert_to_contract', organization_id: who.organizationId, quotation_id: who.recordId,
      actor_id: who.actorId, pricing_version: current, contract_type_id: typeId, code, name, starts_on: startsOn, ends_on: endsOn });
    const receipt = await engine.findOne('forge_quotation_contract_conversion', { where: { quotation_id: who.recordId, organization_id: who.organizationId } }, { context: transaction });
    if (receipt) {
      if (receipt.converted_by !== who.actorId || receipt.request_signature !== requestSignature || Number(receipt.pricing_version) !== current) throw new Error('该报价已有正式转换，当前请求与原转换请求不一致');
      const existing = await get(engine, 'forge_sales_contract', String(receipt.contract_id), who, transaction), count = Number(receipt.line_count);
      if (existing.owner_id !== who.actorId || existing.quotation_id !== who.recordId || existing.quotation_source_type !== 'formal_conversion'
        || !Number.isSafeInteger(count) || count < 1) throw new Error('正式转换绑定无法核对原合同，请保留现场并核验');
      return { id: existing.id, quotation_id: who.recordId, line_count: count, status: existing.status, repeated: true };
    }
    await verifyArchivedEvidence(engine, storage, who, quote, 'customer_acceptance_evidence_attachment', String(quote.customer_acceptance_evidence_sha256), transaction);
    const customer = await get(engine, 'forge_customer', String(quote.customer_id), who, transaction), contractType = await get(engine, 'forge_contract_type', typeId, who, transaction);
    if (customer.owner_id !== who.actorId) throw new Error('只能为本人拥有的客户建立合同');
    if (contractType.status !== 'active') throw new Error('合同类型不存在或已停用');
    if (quote.contact_id) {
      const contact = await get(engine, 'forge_contact', String(quote.contact_id), who, transaction);
      if (contact.customer_id !== quote.customer_id || contact.owner_id !== who.actorId || contact.employment_status === 'inactive') throw new Error('报价联系人不属于当前客户或已不可用');
    }
    if (Number(quote.item_count) !== lines.length) throw new Error('报价明细与已接受版本不一致');
    const total = roundedMoney(lines.reduce((sum, line) => sum + Number(line.taxed_subtotal || 0), 0));
    if (!Number.isFinite(total) || total < 0 || total !== roundedMoney(Number(quote.total_amount))) throw new Error('报价明细金额与已接受报价总额不一致');
    const sourceContracts = await engine.find('forge_sales_contract', { where: { quotation_id: who.recordId, organization_id: who.organizationId }, fields: ['id', 'quotation_source_type'], limit: 5001 }, { context: transaction });
    if (sourceContracts.length > 5000 || sourceContracts.some(item => item.quotation_source_type !== 'template_import')) throw new Error('存在来源待核对合同，不能自动判定历史正式转换，请先完成来源核验');
    const contractId = crypto.randomUUID();
    await engine.insert('forge_sales_contract', { id: contractId, name, code, contract_type_id: typeId, customer_id: quote.customer_id, contact_id: quote.contact_id || null,
      quotation_id: who.recordId, quotation_source_type: 'formal_conversion', organization_id: who.organizationId,
      signed_on: null, starts_on: startsOn, ends_on: endsOn, owner_id: who.actorId, responsible_id: who.actorId, total_amount: total,
      has_order_amount_limit: true, order_amount_limit: total, outside_item_requires_approval: true, revenue_trigger: 'shipment',
      payment_term: quote.payment_term || null, business_terms: quote.business_terms || null,
      draft_request_signature: await digest(canonicalJSON({ requestSignature, content: quote.submitted_content_sha256 })), remarks: '由报价 ' + quote.code + ' 转换生成' }, { context: transaction });
    for (const line of lines) await engine.insert('forge_sales_contract_line', { name: line.name, contract_id: contractId, organization_id: who.organizationId,
      line_type: line.line_type || 'material', quotation_line_id: line.id, sku_id: line.sku_id || null, item_code: line.item_code || null,
      model: line.model || null, specification: line.specification || null, unit_name: line.unit_name || null,
      quantity_limit: Number(line.quantity || 0), ordered_quantity: 0, taxed_unit_price: Number(line.taxed_unit_price || 0), tax_rate: Number(line.tax_rate || 0),
      discount_rate: Number(line.discount_rate || 0), taxed_subtotal: Number(line.taxed_subtotal || 0), remarks: line.remarks || null }, { context: transaction });
    await engine.insert('forge_quotation_contract_conversion', { name: '报价 ' + quote.code + ' 正式转换', quotation_id: who.recordId, contract_id: contractId,
      organization_id: who.organizationId, converted_by: who.actorId, converted_at: new Date().toISOString(), pricing_version: current,
      line_count: lines.length, request_signature: requestSignature, acceptance_file_id: fileId(quote.customer_acceptance_evidence_attachment) }, { context: transaction });
    return { id: contractId, quotation_id: who.recordId, line_count: lines.length, status: 'draft' };
  }, businessContext(who.actorId, who.organizationId), { require: true });
}
