import type { IObjectQLEngine, IStorageService } from '@objectstack/spec/contracts';
import type { ActionHandlerContext } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { businessContext, businessDriver, lockBusinessRow } from './business-transaction.js';
import { requireUniquePositionUser, effectivePositionUsers } from './business-position-resolution.js';
import { assertContractOrderReady, calendarDate, moneyValue, requiredPrepayment, roundedMoney, salesOrderDigest, matchesOrderApprovalSnapshot, type OrderRow } from './sales-order-readiness.js';
import { digest, nonempty, TaskConnectionFailure } from './native-task-auth.js';

type Handler = ActionHandlerContext<Record<string, unknown>> & { recordLoadDenied?: boolean };
export const SIGNATURE_TARGET = 'forgeRegisterContractSignature';
export const ORDER_CONDITIONS_TARGET = 'forgeSetContractOrderConditions';
export const CONTRACT_ORDER_TARGET = 'forgeCreateOrderFromContract';
export const ORDER_SUBMIT_TARGET = 'forgeSubmitSalesOrder';
export const CONTRACT_PREPAYMENT_TARGET = 'forgeRegisterContractPrepayment';
export const PREPAYMENT_CONFIRM_TARGET = 'forgeConfirmCustomerPrepayment';
export const ORDER_APPLY_APPROVAL_TARGET = 'forgeApplyCompletedOrderApproval';
export const PREPAYMENT_REFUND_TARGET = 'forgeRequestCustomerPrepaymentRefund';

function caller(ctx: Handler) {
  const actorId = nonempty(ctx.user?.id), organizationId = nonempty(ctx.session?.organizationId), recordId = nonempty(ctx.record?.id);
  if (ctx.recordLoadDenied === true || !actorId || ctx.session?.userId !== actorId || !organizationId || !recordId
    || ctx.record?.organization_id !== organizationId || ctx.params.recordId && ctx.params.recordId !== recordId) throw new Error('FORBIDDEN: 当前员工或业务记录不可办理');
  return { actorId, organizationId, recordId };
}
function text(value: unknown, label: string, limit = 2000): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result.length > limit || result.includes('\0')) throw new Error(`请填写有效的${label}`);
  return result;
}
function fileId(value: unknown): string {
  if (Array.isArray(value) && value.length !== 1) throw new Error('此动作只接受一份准确原件');
  const item = Array.isArray(value) ? value[0] : value;
  return text(typeof item === 'string' ? item : item && typeof item === 'object' && 'id' in item ? item.id : undefined, '原件引用', 128);
}
async function get(engine: IObjectQLEngine, object: string, id: string, organizationId: string, context: ExecutionContext): Promise<OrderRow> {
  const row = await engine.findOne(object, { where: { id, organization_id: organizationId } }, { context });
  if (!row) throw new Error('FORBIDDEN: 相关业务记录不存在或组织不一致');
  return row;
}
async function requirePosition(engine: IObjectQLEngine, organizationId: string, position: string, actorId: string, context: ExecutionContext) {
  if (!(await effectivePositionUsers(engine, organizationId, position, { context })).includes(actorId)) throw new Error('FORBIDDEN: 当前员工已无有效业务岗位');
}

function requireAvailableFileSlot(file: OrderRow, object: string, recordId: string, field: string) {
  if ([file.ref_object, file.ref_id, file.ref_field].some(value => value != null)
    && (file.ref_object !== object || file.ref_id !== recordId || file.ref_field !== field)) throw new Error('该原件已用于其他业务位置，请本轮重新选择上传');
}
async function verifyFileSlot(engine: IObjectQLEngine, object: string, recordId: string, field: string, evidenceId: string, organizationId: string, context: ExecutionContext) {
  const record = await get(engine, object, recordId, organizationId, context), file = await get(engine, 'sys_file', evidenceId, organizationId, context);
  if (fileId(record[field]) !== evidenceId || file.ref_object !== object || file.ref_id !== recordId || file.ref_field !== field) throw new Error('原件与业务记录的原生访问绑定未完成，已停止归档');
}

export async function setContractOrderConditions(engine: IObjectQLEngine, ctx: Handler) {
  const who = caller(ctx), requirement = ctx.params.order_payment_requirement;
  if (!['none', 'prepayment'].includes(String(requirement))) throw new Error('请明确无需预付款或先确认预付款');
  const amount = requirement === 'none' ? 0 : moneyValue(ctx.params.order_prepayment_amount, '下单预付款');
  return engine.transaction(async transaction => {
    await lockBusinessRow(engine, 'forge_sales_contract', who.recordId, who.organizationId, transaction);
    const row = await get(engine, 'forge_sales_contract', who.recordId, who.organizationId, transaction);
    if (row.responsible_id !== who.actorId || row.status !== 'active' || row.signed_on) throw new Error('FORBIDDEN: 仅合同负责人可在内部复核通过后、签署登记前确认下单条件');
    if (requirement === 'prepayment' && (!(amount > 0) || amount > moneyValue(row.total_amount, '合同金额'))) throw new Error('预付款金额必须大于零且不超过合同金额');
    await engine.update('forge_sales_contract', { id: who.recordId, order_payment_requirement: requirement, order_prepayment_amount: amount,
      order_conditions_set_by: who.actorId, order_conditions_set_at: new Date().toISOString() }, { context: transaction });
    return { id: who.recordId, order_payment_requirement: requirement, order_prepayment_amount: amount };
  }, businessContext(who.actorId, who.organizationId), { require: true });
}

export async function registerContractSignature(engine: IObjectQLEngine, storage: IStorageService, ctx: Handler) {
  const who = caller(ctx), signedOn = calendarDate(ctx.params.signed_on, '签订日期'), note = text(ctx.params.signed_evidence_note, '签署说明');
  const evidenceId = fileId(ctx.params.signed_evidence_attachment);
  return engine.transaction(async transaction => {
    await lockBusinessRow(engine, 'forge_sales_contract', who.recordId, who.organizationId, transaction);
    const contract = await get(engine, 'forge_sales_contract', who.recordId, who.organizationId, transaction);
    await requirePosition(engine, who.organizationId, 'contract_signature_registrar', who.actorId, transaction);
    if (contract.status !== 'active' || contract.responsible_id === who.actorId) throw new Error('签署登记须由内部复核通过合同的独立登记人办理');
    requiredPrepayment(contract);
    await lockBusinessRow(engine, 'sys_file', evidenceId, who.organizationId, transaction);
    const file = await get(engine, 'sys_file', evidenceId, who.organizationId, transaction);
    requireAvailableFileSlot(file, 'forge_sales_contract', who.recordId, 'signed_evidence_attachment');
    if (file.status !== 'committed' || file.owner_id !== who.actorId || !file.key || !['attachments', 'user'].includes(String(file.scope))) throw new Error('签署凭证必须是当前员工已上传的准确原件');
    const bytes = new Uint8Array(await storage.download(String(file.key)));
    if (!bytes.length || bytes.length > 2 * 1024 * 1024 || bytes.length !== Number(file.size)) throw new Error('签署原件字节不可核验');
    const hash = await digest(bytes);
    if (contract.signed_on || contract.signed_evidence_attachment) {
      if (String(contract.signed_on).slice(0, 10) === signedOn && fileId(contract.signed_evidence_attachment) === evidenceId
        && contract.signed_evidence_note === note && contract.signed_recorded_by === who.actorId && contract.signed_evidence_sha256 === hash) return { id: who.recordId, signed_on: signedOn, repeated: true };
      throw new Error('CONFLICT: 已归档签署版本不能覆盖，请按合同修订规则处理');
    }
    await engine.update('forge_sales_contract', { id: who.recordId, signed_on: signedOn, signed_evidence_attachment: evidenceId,
      signed_evidence_sha256: hash, signed_evidence_note: note, signed_recorded_by: who.actorId, signed_recorded_at: new Date().toISOString() }, { context: transaction });
    await verifyFileSlot(engine, 'forge_sales_contract', who.recordId, 'signed_evidence_attachment', evidenceId, who.organizationId, transaction);
    return { id: who.recordId, signed_on: signedOn, signed_evidence_attachment: evidenceId, repeated: false };
  }, businessContext(who.actorId, who.organizationId), { require: true });
}

export async function createSalesOrder(engine: IObjectQLEngine, ctx: Handler) {
  const who = caller(ctx), code = text(ctx.params.code, '订单编号', 100), name = text(ctx.params.name, '订单名称', 255);
  const planned = calendarDate(ctx.params.planned_delivery_on, '计划交货日期'), term = text(ctx.params.payment_term, '付款条件', 255);
  const method = text(ctx.params.payment_method, '付款方式', 80), address = String(ctx.params.delivery_address ?? '');
  businessDriver(engine, ['forge_sales_contract', 'forge_sales_order', 'forge_sales_order_line', 'forge_customer_prepayment']);
  return engine.transaction(async transaction => {
    await lockBusinessRow(engine, 'forge_sales_contract', who.recordId, who.organizationId, transaction);
    const contract = await get(engine, 'forge_sales_contract', who.recordId, who.organizationId, transaction);
    await requirePosition(engine, who.organizationId, 'sales_order_operator', who.actorId, transaction);
    const prior = await engine.findOne('forge_sales_order', { where: { code, organization_id: who.organizationId } }, { context: transaction });
    if (prior) {
      if (prior.contract_id !== who.recordId || prior.responsible_id !== who.actorId || prior.name !== name
        || String(prior.planned_delivery_on).slice(0, 10) !== planned || prior.payment_term !== term || prior.payment_method !== method
        || String(prior.delivery_address ?? '') !== address) throw new Error('CONFLICT: 订单编号已用于不同来源或内容');
      return { id: prior.id, contract_id: who.recordId, repeated: true };
    }
    const existing = await engine.find('forge_sales_order', { where: { contract_id: who.recordId, organization_id: who.organizationId, status: { $ne: 'cancelled' } }, limit: 1 }, { context: transaction });
    if (existing.length) throw new Error('合同已有未取消的销售订单，请先核对原结果');
    const readiness = await assertContractOrderReady(engine, contract, transaction);
    const lines = await engine.find('forge_sales_contract_line', { where: { contract_id: who.recordId, organization_id: who.organizationId }, limit: 1001 }, { context: transaction });
    if (!lines.length || lines.length > 1000) throw new Error('合同明细不可完整核对');
    const remaining = lines.map(line => ({ line, quantity: Number(line.quantity_limit) - Number(line.ordered_quantity || 0) })).filter(item => item.quantity > 0);
    if (!remaining.length) throw new Error('合同没有剩余可下单数量');
    let total = 0;
    for (const { line, quantity } of remaining) {
      if (!Number.isFinite(quantity) || line.line_type === 'material' && !line.sku_id || line.line_type === 'service' && line.sku_id || !['material', 'service'].includes(String(line.line_type))) throw new Error('合同物料或服务明细无效');
      total = roundedMoney(total + moneyValue(line.taxed_subtotal, '合同明细金额') * quantity / Number(line.quantity_limit));
    }
    const orderId = crypto.randomUUID();
    await engine.insert('forge_sales_order', { id: orderId, code, name, source_type: 'contract', customer_id: contract.customer_id,
      contact_id: contract.contact_id ?? null, contract_id: who.recordId, quotation_id: contract.quotation_id ?? null,
      planned_delivery_on: planned, responsible_id: who.actorId, owner_id: who.actorId, organization_id: who.organizationId,
      payment_term: term, payment_method: method, delivery_address: address || null, revenue_trigger: contract.revenue_trigger || 'shipment',
      total_amount: total, status: 'draft', remarks: `由合同 ${contract.code || contract.name} 创建` }, { context: transaction });
    for (const { line, quantity } of remaining) {
      const rate = Number(line.tax_rate || 0) / 100;
      await engine.insert('forge_sales_order_line', { name: line.name, order_id: orderId, organization_id: who.organizationId,
        line_type: line.line_type, contract_line_id: line.id, quotation_line_id: line.quotation_line_id ?? null, sku_id: line.sku_id ?? null,
        item_code: line.item_code ?? null, model: line.model ?? null, specification: line.specification ?? null, unit_name: line.unit_name ?? null,
        quantity, shipped_quantity: 0, invoiced_quantity: 0, taxed_unit_price: line.taxed_unit_price,
        untaxed_unit_price: roundedMoney(Number(line.taxed_unit_price) / (1 + rate)), tax_rate: line.tax_rate || 0, discount_rate: line.discount_rate || 0,
        taxed_subtotal: roundedMoney(Number(line.taxed_subtotal) * quantity / Number(line.quantity_limit)), planned_delivery_on: planned }, { context: transaction });
    }
    for (const prepayment of readiness.rows) {
      await lockBusinessRow(engine, 'forge_customer_prepayment', String(prepayment.id), who.organizationId, transaction);
      await engine.update('forge_customer_prepayment', { id: prepayment.id, order_id: orderId }, { context: transaction });
    }
    return { id: orderId, contract_id: who.recordId, total_amount: total, line_count: remaining.length, repeated: false };
  }, businessContext(who.actorId, who.organizationId), { require: true });
}

export async function submitSalesOrder(engine: IObjectQLEngine, ctx: Handler) {
  const who = caller(ctx);
  businessDriver(engine, ['forge_sales_contract', 'forge_sales_order', 'forge_sales_order_line', 'forge_sales_contract_line']);
  return engine.transaction(async transaction => {
    const initial = await get(engine, 'forge_sales_order', who.recordId, who.organizationId, transaction);
    if (initial.contract_id) await lockBusinessRow(engine, 'forge_sales_contract', String(initial.contract_id), who.organizationId, transaction);
    await lockBusinessRow(engine, 'forge_sales_order', who.recordId, who.organizationId, transaction);
    const order = await get(engine, 'forge_sales_order', who.recordId, who.organizationId, transaction);
    await requirePosition(engine, who.organizationId, 'sales_order_operator', who.actorId, transaction);
    if (order.responsible_id !== who.actorId || order.status !== 'draft') throw new Error('仅本人草稿订单可以提交复核');
    if (!order.payment_term || !order.payment_method) throw new Error('请先填写付款条件及方式');
    calendarDate(String(order.planned_delivery_on).slice(0, 10), '计划交货日期');
    const lines = await engine.find('forge_sales_order_line', { where: { order_id: who.recordId, organization_id: who.organizationId }, limit: 1001 }, { context: transaction });
    if (!lines.length || lines.length > 1000) throw new Error('订单明细不可完整核对');
    const total = roundedMoney(lines.reduce((sum, line) => sum + moneyValue(line.taxed_subtotal, '订单明细金额'), 0));
    if (order.source_type === 'contract') {
      const contract = await get(engine, 'forge_sales_contract', String(order.contract_id), who.organizationId, transaction);
      await assertContractOrderReady(engine, contract, transaction, who.recordId);
      if (contract.customer_id !== order.customer_id || contract.has_order_amount_limit && Number(contract.ordered_amount || 0) + total > Number(contract.order_amount_limit || 0)) throw new Error('订单客户或额度与合同不符');
      const originals = await engine.find('forge_sales_contract_line', { where: { contract_id: contract.id, organization_id: who.organizationId }, limit: 1001 }, { context: transaction });
      if (originals.length > 1000) throw new Error('合同明细不可完整核对');
      const quantities = new Map<string, number>();
      for (const line of lines) {
        const key = String(line.contract_line_id), quantity = Number(line.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('订单数量必须是有效正数');
        quantities.set(key, (quantities.get(key) || 0) + quantity);
        const original = originals.find(row => row.id === line.contract_line_id);
        if (!original || original.line_type !== line.line_type || (original.sku_id || null) !== (line.sku_id || null)
          || Number(line.quantity) <= 0 || quantities.get(String(line.contract_line_id))! + Number(original.ordered_quantity || 0) > Number(original.quantity_limit)
          || Number(line.taxed_unit_price) !== Number(original.taxed_unit_price) || Number(line.tax_rate || 0) !== Number(original.tax_rate || 0)
          || Number(line.discount_rate || 0) !== Number(original.discount_rate || 0)
          || moneyValue(line.taxed_subtotal, '订单明细金额') !== roundedMoney(Number(original.taxed_subtotal) * Number(line.quantity) / Number(original.quantity_limit))) throw new Error('订单明细来源、数量或价格与合同约定不符');
      }
    }
    if (order.quotation_id) {
      const quote = await get(engine, 'forge_quotation', String(order.quotation_id), who.organizationId, transaction);
      if (quote.status !== 'accepted' || !quote.customer_acceptance_evidence_attachment || Number(quote.accepted_pricing_version) !== Number(quote.pricing_version || 0)) throw new Error('来源报价须有当前核价版本的客户接受凭证');
    }
    const reviewer = await requireUniquePositionUser(engine, who.organizationId, 'sales_order_reviewer', { exclude: who.actorId, preferred: nonempty(order.review_owner_id), context: transaction });
    const summary = lines.map((line, index) => `${index + 1}. ${String(line.name || '订单明细')}；数量 ${Number(line.quantity)}；含税单价 ${moneyValue(line.taxed_unit_price, '含税单价')}；税率 ${Number(line.tax_rate || 0)}%；折扣 ${Number(line.discount_rate || 0)}%；含税小计 ${moneyValue(line.taxed_subtotal, '含税小计')}`).join('\n');
    const normalized = { ...order, total_amount: total };
    const version = await salesOrderDigest(engine, normalized, transaction);
    await engine.update('forge_sales_order', { id: who.recordId, total_amount: total, review_owner_id: reviewer, submitted_by: who.actorId,
      submitted_at: new Date().toISOString(), submitted_line_summary: summary, submitted_order_digest: version, approval_outcome: 'pending', status: 'pending_approval' }, { context: transaction });
    const requests = await engine.find('sys_approval_request', { where: { object_name: 'forge_sales_order', record_id: who.recordId, organization_id: who.organizationId, status: 'pending', submitter_id: who.actorId }, limit: 2 }, { context: transaction });
    if (requests.length !== 1) throw new Error('原生订单审批未能准确建立，订单保持草稿，请核对流程配置');
    return { id: who.recordId, status: 'pending_approval', total_amount: total };
  }, businessContext(who.actorId, who.organizationId), { require: true });
}

export async function confirmCustomerPrepayment(engine: IObjectQLEngine, ctx: Handler) {
  const who = caller(ctx), comment = text(ctx.params.confirmation_comment, '确认意见');
  return engine.transaction(async transaction => {
    const initial = await get(engine, 'forge_customer_prepayment', who.recordId, who.organizationId, transaction);
    if (initial.contract_id) await lockBusinessRow(engine, 'forge_sales_contract', String(initial.contract_id), who.organizationId, transaction);
    await lockBusinessRow(engine, 'forge_customer_prepayment', who.recordId, who.organizationId, transaction);
    const prepayment = await get(engine, 'forge_customer_prepayment', who.recordId, who.organizationId, transaction);
    await requirePosition(engine, who.organizationId, 'finance_reviewer', who.actorId, transaction);
    await lockBusinessRow(engine, 'forge_cash_receipt', String(prepayment.receipt_id), who.organizationId, transaction);
    const receipt = await get(engine, 'forge_cash_receipt', String(prepayment.receipt_id), who.organizationId, transaction);
    const registrar = prepayment.registered_by || receipt.created_by;
    if (!registrar || registrar === who.actorId || prepayment.confirmation_reviewer_id && prepayment.confirmation_reviewer_id !== who.actorId) throw new Error('FORBIDDEN: 预收款须由已分配的独立财务人员确认');
    if (prepayment.status === 'active' && prepayment.confirmed_by === who.actorId && prepayment.confirmation_comment === comment) return { id: who.recordId, status: 'active', repeated: true };
    if (prepayment.status !== 'pending_confirmation' || receipt.status !== 'pending_review' || receipt.customer_id !== prepayment.customer_id
      || moneyValue(receipt.amount, '到账金额') !== moneyValue(prepayment.original_amount, '预收金额')) throw new Error('预收款与原到账流水状态或金额不一致');
    await engine.update('forge_cash_receipt', { id: receipt.id, allocated_amount: receipt.amount, unallocated_amount: 0, status: 'allocated' }, { context: transaction });
    await engine.update('forge_customer_prepayment', { id: who.recordId, status: 'active', confirmed_by: who.actorId, confirmed_at: new Date().toISOString(), confirmation_comment: comment }, { context: transaction });
    return { id: who.recordId, status: 'active', balance_amount: prepayment.balance_amount, repeated: false };
  }, businessContext(who.actorId, who.organizationId), { require: true });
}

export async function registerContractPrepayment(engine: IObjectQLEngine, storage: IStorageService, ctx: Handler) {
  const who = caller(ctx), code = text(ctx.params.code, '到账编号', 100), amount = moneyValue(ctx.params.amount, '到账金额');
  const receivedOn = calendarDate(ctx.params.received_on, '到账日期'), method = text(ctx.params.payment_method, '付款方式', 80);
  const accountId = text(ctx.params.account_id, '公司账户', 128), reference = text(ctx.params.counterpart_reference, '交易流水号', 255);
  const evidenceId = fileId(ctx.params.receipt_evidence_attachment);
  if (!(amount > 0)) throw new Error('到账金额必须大于零');
  businessDriver(engine, ['forge_sales_contract', 'forge_customer_prepayment', 'forge_cash_receipt', 'forge_fund_account']);
  return engine.transaction(async transaction => {
    await lockBusinessRow(engine, 'forge_sales_contract', who.recordId, who.organizationId, transaction);
    const contract = await get(engine, 'forge_sales_contract', who.recordId, who.organizationId, transaction);
    await requirePosition(engine, who.organizationId, 'finance_receivables_operator', who.actorId, transaction);
    if (contract.status !== 'active' || !contract.signed_on || !contract.signed_evidence_attachment) throw new Error('合同须完成内部复核和客户签署归档');
    requiredPrepayment(contract);
    await lockBusinessRow(engine, 'sys_file', evidenceId, who.organizationId, transaction);
    const file = await get(engine, 'sys_file', evidenceId, who.organizationId, transaction);
    if (file.status !== 'committed' || file.owner_id !== who.actorId || !file.key || !['attachments', 'user'].includes(String(file.scope))) throw new Error('到账凭证须为当前员工上传的原件');
    const bytes = new Uint8Array(await storage.download(String(file.key)));
    if (!bytes.length || bytes.length > 2 * 1024 * 1024 || bytes.length !== Number(file.size)) throw new Error('到账原件字节不可核验');
    const hash = await digest(bytes);
    const prior = await engine.findOne('forge_cash_receipt', { where: { code, organization_id: who.organizationId } }, { context: transaction });
    if (prior) {
      const prepayment = await engine.findOne('forge_customer_prepayment', { where: { receipt_id: prior.id, organization_id: who.organizationId } }, { context: transaction });
      if (!prepayment || prepayment.contract_id !== contract.id || prepayment.registered_by !== who.actorId
        || prior.account_id !== accountId || Number(prior.amount) !== amount || String(prior.received_on).slice(0, 10) !== receivedOn
        || prior.payment_method !== method || prior.counterpart_reference !== reference
        || fileId(prepayment.receipt_evidence_attachment) !== evidenceId || prepayment.receipt_evidence_sha256 !== hash) throw new Error('CONFLICT: 到账编号已对应不同内容');
      return { id: prepayment.id, receipt_id: prior.id, repeated: true };
    }
    requireAvailableFileSlot(file, 'forge_customer_prepayment', '', 'receipt_evidence_attachment');
    const held = await engine.find('forge_customer_prepayment', { where: { contract_id: contract.id, organization_id: who.organizationId }, limit: 1001 }, { context: transaction });
    if (held.length > 1000) throw new Error('合同预收清单不可完整核对');
    const committed = held.reduce((sum, row) => sum + moneyValue(row.original_amount, '已登记预收') - moneyValue(row.refunded_amount || 0, '已退款金额'), 0);
    if (roundedMoney(committed + amount) > moneyValue(contract.total_amount, '合同金额')) throw new Error('预收金额超过合同未收余额');
    const reviewer = await requireUniquePositionUser(engine, who.organizationId, 'finance_reviewer', { exclude: who.actorId, context: transaction });
    await lockBusinessRow(engine, 'forge_fund_account', accountId, who.organizationId, transaction);
    const account = await get(engine, 'forge_fund_account', accountId, who.organizationId, transaction);
    if (account.status !== 'active') throw new Error('公司账户未启用');
    const periods = await engine.find('forge_financial_period', { where: { account_id: accountId, organization_id: who.organizationId }, limit: 1001 }, { context: transaction });
    if (periods.length > 1000 || periods.length && !periods.some(p => p.status === 'open' && receivedOn >= String(p.period_start).slice(0, 10) && receivedOn <= String(p.period_end).slice(0, 10))) throw new Error('到账日期不在开放财务期间');
    const receiptId = crypto.randomUUID(), prepaymentId = crypto.randomUUID();
    await engine.insert('forge_cash_receipt', { id: receiptId, name: `${contract.code} 合同预收`, code, customer_id: contract.customer_id,
      account_id: accountId, received_on: receivedOn, payment_method: method, amount, allocated_amount: 0, unallocated_amount: amount,
      counterpart_reference: reference, status: 'pending_review', responsible_id: who.actorId, owner_id: who.actorId, organization_id: who.organizationId }, { context: transaction });
    await engine.insert('forge_customer_prepayment', { id: prepaymentId, name: `${contract.code} 合同预收款`, code: `PRE-${code}`,
      customer_id: contract.customer_id, contract_id: contract.id, order_id: null, receipt_id: receiptId,
      original_amount: amount, offset_amount: 0, refunded_amount: 0, balance_amount: amount, status: 'pending_confirmation',
      registered_by: who.actorId, confirmation_reviewer_id: reviewer, receipt_evidence_attachment: evidenceId, receipt_evidence_sha256: hash,
      responsible_id: who.actorId, owner_id: who.actorId, organization_id: who.organizationId }, { context: transaction });
    await verifyFileSlot(engine, 'forge_customer_prepayment', prepaymentId, 'receipt_evidence_attachment', evidenceId, who.organizationId, transaction);
    await engine.update('forge_fund_account', { id: accountId,
      current_balance: roundedMoney(moneyValue(account.current_balance ?? account.opening_balance ?? 0, '账户余额') + amount) }, { context: transaction });
    return { id: prepaymentId, receipt_id: receiptId, amount, status: 'pending_confirmation', repeated: false };
  }, businessContext(who.actorId, who.organizationId), { require: true });
}

/** Native approval owns its decision. Only this transaction activates the
 * reviewed business snapshot and advances the contract counters together. */
export async function applySalesOrderApproval(engine: IObjectQLEngine, recordId: string, organizationId: string) {
  const driver = businessDriver(engine, ['forge_sales_order', 'forge_sales_contract', 'forge_sales_contract_line', 'forge_sales_order_line', 'forge_customer_prepayment']);
  return engine.transaction(async (transaction, info) => {
    // ObjectQL joins an ambient transaction without a nested rollback. Keep
    // domain effects atomic even when the native decision owns that transaction.
    const joined = info?.owned === false;
    if (joined && !driver.rollback) throw new Error('业务事务不支持完整回滚，不能应用订单结果');
    if (joined) await driver.execute!('SAVEPOINT forge_order_approval', [], { transaction: transaction.transaction });
    const savepointCommand = async (command: string) => {
      try { await driver.execute!(command, [], { transaction: transaction.transaction }); }
      catch (error) {
        // A failed savepoint rollback/release cannot leave a caller free to
        // commit partial domain effects. Abort the enclosing transaction.
        await driver.rollback!(transaction.transaction);
        throw error;
      }
    };
    const apply = async () => {
      const initial = await get(engine, 'forge_sales_order', recordId, organizationId, transaction);
      if (initial.contract_id) await lockBusinessRow(engine, 'forge_sales_contract', String(initial.contract_id), organizationId, transaction);
      await lockBusinessRow(engine, 'forge_sales_order', recordId, organizationId, transaction);
      const order = await get(engine, 'forge_sales_order', recordId, organizationId, transaction);
      if (order.status === 'active' && order.approval_outcome === 'approved' || order.status === 'cancelled' && ['rejected', 'recalled'].includes(String(order.approval_outcome))) return;
      if (order.status !== 'pending_approval' || !['pending', 'approved', 'rejected', 'recalled'].includes(String(order.approval_outcome))) throw new Error('订单没有可应用的原生审批结论');
      const requests = await engine.find('sys_approval_request', { where: { object_name: 'forge_sales_order', record_id: recordId, organization_id: organizationId }, limit: 101 }, { context: transaction });
      if (requests.length > 100) throw new Error('原生审批记录不可完整核对');
      if (requests.some(r => r.status === 'pending' && matchesOrderApprovalSnapshot(r, order))) throw new Error('订单仍有未完成的原生审批，不能应用业务结果');
      // The decision is durable even when the suspended run was lost. Recover from
      // that exact native snapshot, without replaying the native decision or
      // relying on the flow's mirrored outcome having been written.
      const matching = requests.filter(r => ['approved', 'rejected', 'recalled'].includes(String(r.status)) && (
        r.status === order.approval_outcome || order.approval_outcome === 'rejected' && r.status === 'recalled' ||
        order.approval_outcome === 'pending'
      ) && matchesOrderApprovalSnapshot(r, order));
      if (matching.length !== 1) throw new Error('订单原生审批结论尚不可唯一核验');
      const request = matching[0];
      if (['rejected', 'recalled'].includes(String(request.status))) {
        const prepayments = await engine.find('forge_customer_prepayment', { where: { order_id: recordId, organization_id: organizationId }, limit: 1001 }, { context: transaction });
        if (prepayments.length > 1000) throw new Error('订单预收款关联不可完整核对');
        for (const row of prepayments) {
          await lockBusinessRow(engine, 'forge_customer_prepayment', String(row.id), organizationId, transaction);
          await engine.update('forge_customer_prepayment', { id: row.id, order_id: null }, { context: transaction });
        }
        await engine.update('forge_sales_order', { id: recordId, status: 'cancelled', approval_outcome: request.status }, { context: transaction });
        return;
      }
      if (order.submitted_order_digest !== await salesOrderDigest(engine, order, transaction)) throw new Error('订单内容与审批提交版本不同');
      if (order.contract_id) {
        const contract = await get(engine, 'forge_sales_contract', String(order.contract_id), organizationId, transaction);
        await assertContractOrderReady(engine, contract, transaction, recordId);
        const amount = roundedMoney(moneyValue(contract.ordered_amount || 0, '合同已下单金额') + moneyValue(order.total_amount, '订单金额'));
        if (contract.has_order_amount_limit && amount > moneyValue(contract.order_amount_limit, '合同额度')) throw new Error('合同剩余额度已不足');
        const lines = await engine.find('forge_sales_order_line', { where: { order_id: recordId, organization_id: organizationId }, limit: 1001 }, { context: transaction });
        if (lines.length > 1000) throw new Error('订单明细不可完整核对');
        const quantities = new Map<string, number>();
        for (const line of lines) quantities.set(String(line.contract_line_id), (quantities.get(String(line.contract_line_id)) || 0) + Number(line.quantity));
        for (const [id, quantity] of quantities) {
          const source = await get(engine, 'forge_sales_contract_line', id, organizationId, transaction);
          const next = Number(source.ordered_quantity || 0) + quantity;
          if (source.contract_id !== contract.id || !Number.isFinite(next) || quantity <= 0 || next > Number(source.quantity_limit)) throw new Error('合同剩余数量已不足');
          await engine.update('forge_sales_contract_line', { id, ordered_quantity: next }, { context: transaction });
        }
        await engine.update('forge_sales_contract', { id: contract.id, ordered_count: Number(contract.ordered_count || 0) + 1, ordered_amount: amount }, { context: transaction });
      }
      await engine.update('forge_sales_order', { id: recordId, status: 'active', approval_outcome: 'approved' }, { context: transaction });
    };
    try { await apply(); }
    catch (error) {
      if (joined) await savepointCommand('ROLLBACK TO SAVEPOINT forge_order_approval');
      throw error;
    } finally {
      if (joined) await savepointCommand('RELEASE SAVEPOINT forge_order_approval');
    }
  }, { isSystem: true, tenantId: organizationId, permissions: [], positions: [] }, { require: true });
}

export async function recoverSalesOrderApproval(engine: IObjectQLEngine, ctx: Handler) {
  const who = caller(ctx);
  if (ctx.record.responsible_id !== who.actorId) throw new Error('FORBIDDEN: 只能核对本人订单');
  await requirePosition(engine, who.organizationId, 'sales_order_operator', who.actorId, businessContext(who.actorId, who.organizationId));
  await applySalesOrderApproval(engine, who.recordId, who.organizationId);
  return { id: who.recordId, status: (await get(engine, 'forge_sales_order', who.recordId, who.organizationId, businessContext(who.actorId, who.organizationId))).status };
}

export async function requestCustomerPrepaymentRefund(engine: IObjectQLEngine, ctx: Handler) {
  const who = caller(ctx), code = text(ctx.params.code, '退款编号', 100), amount = moneyValue(ctx.params.requested_amount, '退款金额');
  const reason = text(ctx.params.reason, '退款原因'), date = calendarDate(ctx.params.application_on, '申请日期');
  return engine.transaction(async transaction => {
    const initial = await get(engine, 'forge_customer_prepayment', who.recordId, who.organizationId, transaction);
    if (initial.contract_id) await lockBusinessRow(engine, 'forge_sales_contract', String(initial.contract_id), who.organizationId, transaction);
    await lockBusinessRow(engine, 'forge_customer_prepayment', who.recordId, who.organizationId, transaction);
    const prepay = await get(engine, 'forge_customer_prepayment', who.recordId, who.organizationId, transaction);
    await requirePosition(engine, who.organizationId, 'finance_receivables_operator', who.actorId, transaction);
    if (!['active', 'partially_used'].includes(String(prepay.status)) || amount <= 0) throw new Error('当前预收款不可申请该退款金额');
    const prior = await engine.findOne('forge_customer_refund', { where: { code, organization_id: who.organizationId } }, { context: transaction });
    if (prior) {
      if (prior.prepayment_id !== prepay.id || prior.applicant_id !== who.actorId || Number(prior.requested_amount) !== amount || prior.reason !== reason || String(prior.application_on).slice(0, 10) !== date || prior.refund_method !== ctx.params.refund_method || String(prior.remarks || '') !== String(ctx.params.remarks || '')) throw new Error('CONFLICT: 退款编号已经对应不同内容');
      return { id: prior.id, repeated: true };
    }
    if (prepay.order_id) {
      const order = await get(engine, 'forge_sales_order', String(prepay.order_id), who.organizationId, transaction);
      if (order.status === 'pending_approval') throw new Error('订单正在复核，须先处理原生审批后再申请退款');
    }
    const refunds = await engine.find('forge_customer_refund', { where: { prepayment_id: prepay.id, organization_id: who.organizationId }, limit: 1001 }, { context: transaction });
    if (refunds.length > 1000) throw new Error('退款占用不可完整核对');
    const reserved = refunds.filter(row => ['pending_review', 'approved', 'pending_writeoff'].includes(String(row.document_status))).reduce((sum, row) => sum + moneyValue(row.requested_amount, '退款占用'), 0);
    if (roundedMoney(reserved + amount) > moneyValue(prepay.balance_amount, '预收款余额')) throw new Error('退款金额超过扣除占用后的余额');
    const refundId = crypto.randomUUID();
    await engine.insert('forge_customer_refund', { id: refundId, code, name: `${prepay.code} 客户退款`, prepayment_id: prepay.id,
      order_id: prepay.order_id ?? null, contract_id: prepay.contract_id ?? null, customer_id: prepay.customer_id,
      currency: 'cny', requested_amount: amount, actual_amount: 0, refund_method: text(ctx.params.refund_method, '退款方式', 80),
      application_on: date, reason, document_status: 'pending_review', finance_status: 'pending', payment_status: 'pending', writeoff_status: 'pending',
      applicant_id: who.actorId, responsible_id: who.actorId, owner_id: who.actorId, organization_id: who.organizationId, remarks: String(ctx.params.remarks || '') }, { context: transaction });
    return { id: refundId, prepayment_id: prepay.id, requested_amount: amount, status: 'pending_review' };
  }, businessContext(who.actorId, who.organizationId), { require: true });
}
