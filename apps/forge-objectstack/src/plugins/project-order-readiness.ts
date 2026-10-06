import { isGrantActive, isRowActive } from '@objectstack/core';
import { buildContextForUser } from '@objectstack/plugin-security';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { effectivePositionUsers } from './business-position-resolution.js';
import { lockBusinessRow } from './business-transaction.js';
import { canonicalJSON, digest, TaskConnectionFailure } from './native-task-auth.js';
import { matchesOrderApprovalSnapshot, salesOrderDigest } from './sales-order-readiness.js';

export type ProjectRow = Record<string, unknown>;
const fail = (message: string): never => { throw new TaskConnectionFailure(409, 'PROJECT_SOURCE_INVALID', message); };

export async function qualifiedProjectManagers(engine: IObjectQLEngine, organizationId: string, context: ExecutionContext): Promise<string[]> {
  const candidates = await effectivePositionUsers(engine, organizationId, 'project_manager', { context });
  const now = Date.now(), result: string[] = [];
  const reader = { find: (object: string, query: ProjectRow = {}) => {
    const { context: _context, ...criteria } = query;
    return engine.find(object, criteria, { context });
  } };
  for (const id of candidates) {
    const [user, members, effective] = await Promise.all([
      engine.findOne('sys_user', { where: { id } }, { context }),
      engine.find('sys_member', { where: { user_id: id, organization_id: organizationId }, limit: 2 }, { context }),
      buildContextForUser(reader, id, now, organizationId),
    ]);
    const member = members[0], from = member?.valid_from ? Date.parse(String(member.valid_from)) : -Infinity;
    const until = member?.valid_until ? Date.parse(String(member.valid_until)) : Infinity;
    const permissions = new Set(Array.isArray(effective?.systemPermissions) ? effective.systemPermissions : []);
    if (user && isRowActive(user) && user.banned !== true && members.length === 1 && isRowActive(member)
      && isGrantActive(member, now) && from <= now && now < until
      && permissions.has('forge_project_manager') && permissions.has('forge_project_operator')) result.push(id);
  }
  return result;
}

export async function projectRows(engine: IObjectQLEngine, object: string, where: ProjectRow, context: ExecutionContext, lock = false): Promise<ProjectRow[]> {
  let rows = await engine.find(object, { where, orderBy: [{ field: 'id', order: 'asc' }], limit: 1001 }, { context });
  if (rows.length > 1000) fail('项目来源明细无法完整核对');
  if (lock) {
    for (const row of rows) await lockBusinessRow(engine, object, String(row.id), String(context.tenantId), context);
    const ids = rows.map(row => row.id);
    rows = await engine.find(object, { where, orderBy: [{ field: 'id', order: 'asc' }], limit: 1001 }, { context });
    if (rows.length !== ids.length || rows.some((row, index) => row.id !== ids[index])) fail('项目来源明细集合已变化，请重新读取');
  }
  return rows;
}

/** Resolves one exact order, never every order under a contract. This is domain
 * validation, not a read grant; handlers separately require native visibility. */
export async function approvedProjectOrder(engine: IObjectQLEngine, customerId: string, orderId: string, context: ExecutionContext, lock = false) {
  const organizationId = String(context.tenantId);
  const get = async (object: string, id: string) => {
    const row = await engine.findOne(object, { where: { id, organization_id: organizationId } }, { context });
    if (!row) return fail('项目来源不存在或不属于当前组织');
    return row;
  };
  let order = await get('forge_sales_order', orderId);
  const contractId = String(order.contract_id || '');
  if (lock) {
    await lockBusinessRow(engine, 'forge_sales_contract', contractId, organizationId, context);
    await lockBusinessRow(engine, 'forge_sales_order', orderId, organizationId, context);
    order = await get('forge_sales_order', orderId);
  }
  const contract = await get('forge_sales_contract', contractId);
  if (order.contract_id !== contractId || order.customer_id !== customerId || contract.customer_id !== customerId
    || !['approved', 'active'].includes(String(order.status)) || order.approval_outcome !== 'approved' || contract.status !== 'active' || !contract.signed_on || !contract.signed_evidence_attachment) fail('必须选择本客户已签署有效合同下当前已批准的准确订单');
  const orderLines = await projectRows(engine, 'forge_sales_order_line', { order_id: orderId, organization_id: organizationId }, context, lock);
  const contractLines = await projectRows(engine, 'forge_sales_contract_line', { contract_id: contractId, organization_id: organizationId }, context, lock);
  if (!orderLines.length || !contractLines.length) fail('项目订单或合同缺少完整来源明细');
  if (order.submitted_order_digest) {
    const requests = await engine.find('sys_approval_request', { where: { object_name: 'forge_sales_order', record_id: orderId,
      organization_id: organizationId, submitter_id: order.submitted_by, status: { $in: ['pending', 'approved', 'rejected', 'recalled'] } }, limit: 2 }, { context });
    if (requests.length !== 1 || requests[0].status !== 'approved' || !matchesOrderApprovalSnapshot(requests[0], order)
      || await salesOrderDigest(engine, order, context) !== order.submitted_order_digest) fail('订单原生批准结果与当前完整内容不一致');
  } else fail('订单缺少可核验的原生批准版本');
  let quotation: ProjectRow | null = null, quotationLines: ProjectRow[] = [];
  if (contract.quotation_id || order.quotation_id || orderLines.some(line => line.quotation_line_id)) {
    if (!contract.quotation_id || order.quotation_id !== contract.quotation_id) fail('报价、合同与订单来源不一致');
    const quoteId = String(contract.quotation_id);
    if (lock) await lockBusinessRow(engine, 'forge_quotation', quoteId, organizationId, context);
    quotation = await get('forge_quotation', quoteId);
    quotationLines = await projectRows(engine, 'forge_quotation_line', { quotation_id: quoteId, organization_id: organizationId }, context, lock);
    if (quotation.customer_id !== customerId || quotation.status !== 'accepted' || !quotation.customer_acceptance_evidence_attachment
      || quotation.accepted_pricing_version == null || Number(quotation.accepted_pricing_version) !== Number(quotation.pricing_version)) fail('报价客户接受版本已变化');
  }
  const same = (left: unknown, right: unknown) => Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Math.abs(Number(left) - Number(right)) < 0.0001;
  let amount = 0;
  for (const line of orderLines) {
    const original = contractLines.find(item => item.id === line.contract_line_id) ?? fail('未找到准确来源合同明细');
    const quote = quotationLines.find(item => item.id === line.quotation_line_id);
    if (!original || original.contract_id !== contractId || !['material', 'service'].includes(String(line.line_type))
      || line.line_type !== original.line_type || line.name !== original.name || !(Number(line.quantity) > 0)
      || Number(line.quantity) > Number(original.quantity_limit) + 0.0001 || (line.sku_id || null) !== (original.sku_id || null)
      || line.line_type === 'service' && line.sku_id || line.line_type === 'material' && !line.sku_id
      || !['taxed_unit_price', 'tax_rate', 'discount_rate'].every(field => same(line[field], original[field]))
      || !same(Number(original.taxed_subtotal) * Number(line.quantity) / Number(original.quantity_limit), line.taxed_subtotal)) fail('订单与原合同设备及服务明细不一致');
    if (quotation && (!quote || original.quotation_line_id !== quote.id || quote.line_type !== original.line_type || quote.name !== original.name
      || (quote.sku_id || null) !== (original.sku_id || null) || !same(quote.quantity, original.quantity_limit)
      || !['taxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal'].every(field => same(quote[field], original[field])))) fail('报价、合同与订单原始明细不一致');
    amount += Number(line.taxed_subtotal);
  }
  if (!same(amount, order.total_amount)) fail('订单完整明细金额与订单总额不一致');
  const version = await digest(canonicalJSON(JSON.parse(JSON.stringify({ order, contract, orderLines, contractLines, quotation, quotationLines }))));
  return { order, contract, orderLines, contractLines, quotation, quotationLines, version };
}

export async function validProjectManagerMember(engine: IObjectQLEngine, project: ProjectRow, context: ExecutionContext, lock = false): Promise<boolean> {
  if (!(await qualifiedProjectManagers(engine, String(context.tenantId), context)).includes(String(project.manager_id))) return false;
  const members = await projectRows(engine, 'forge_project_member', { project_id: project.id, organization_id: context.tenantId }, context, lock);
  return members.filter(member => member.active === true && member.member_duty === 'manager' && member.user_id === project.manager_id).length === 1;
}
