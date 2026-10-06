import type { PluginContext } from '@objectstack/core';
import type { IHttpRequest, IObjectQLEngine, ISecurityService } from '@objectstack/spec/contracts';
import { canonicalJSON, digest, nativeEmployee, nonempty, service, verifyNativeConnection, TaskConnectionFailure } from './native-task-auth.js';
import { businessContext } from './business-transaction.js';
import { effectivePositionUsers } from './business-position-resolution.js';
import { EmployeeNativeActions, businessRow, type BusinessRow } from './employee-business-native.js';
import { confirmedContractPrepayments, requiredPrepayment, completedOrderApproval } from './sales-order-readiness.js';
import { quotationFollowUpAction } from './sales-quotation-readiness.js';
import { businessRecordVersion } from './business-record-version.js';

type Kind = 'quotation_follow_up' | 'contract_order_conditions' | 'contract_signature' | 'contract_prepayment' | 'prepayment_confirmation' | 'sales_order_creation' | 'sales_order_submission';
const sources: Array<{ object: string; kinds: Kind[]; where: BusinessRow }> = [
  { object: 'forge_sales_contract', kinds: ['contract_order_conditions', 'contract_signature', 'contract_prepayment', 'sales_order_creation'], where: { status: 'active' } },
  { object: 'forge_customer_prepayment', kinds: ['prepayment_confirmation'], where: { status: 'pending_confirmation' } },
  { object: 'forge_sales_order', kinds: ['sales_order_submission'], where: { status: { $in: ['draft', 'pending_approval'] } } },
  { object: 'forge_quotation', kinds: ['quotation_follow_up'], where: { status: { $in: ['draft', 'rejected', 'approved', 'sent', 'accepted'] } } },
];

/** A read projection of business facts. There is no task table or lifecycle. */
export async function readEmployeeBusinessWork(context: PluginContext, request: IHttpRequest): Promise<BusinessRow> {
  const employee = await nativeEmployee(context, request), engine = service<IObjectQLEngine>(context, 'objectql');
  const query = request.query ?? {}, limit = Number(query.limit ?? 50), cursor = query.cursor;
  if (Object.keys(query).some(key => !['cursor', 'limit'].includes(key)) || !Number.isInteger(limit) || limit < 1 || limit > 100
    || cursor != null && !nonempty(cursor, 8192)) throw new TaskConnectionFailure(400, 'BUSINESS_WORK_INPUT_INVALID', '业务事项分页输入无效');
  const issuer = employee.auth.getAuthIssuer(), audience = new URL('/api/v1/workbench/business-work', new URL(issuer).origin).toString();
  const sourceVersion = await digest(canonicalJSON(sources));
  let sourceIndex = 0, after = '', anchor = new Date().toISOString();
  if (cursor != null) {
    const payload = await verifyNativeConnection(employee.api, String(cursor), issuer, audience).catch(() => null);
    if (!payload || payload.kind !== 'forge_business_work_cursor_v1' || payload.sub !== employee.userId || payload.organization_id !== employee.organizationId
      || payload.aud !== audience || !Number.isInteger(payload.sourceIndex) || Number(payload.sourceIndex) < 0 || Number(payload.sourceIndex) >= sources.length
      || payload.sourceVersion !== sourceVersion || payload.source !== sources[Number(payload.sourceIndex)]?.object
      || typeof payload.after !== 'string' || payload.after.length > 128 || typeof payload.anchor !== 'string' || !Number.isFinite(Date.parse(payload.anchor))) {
      throw new TaskConnectionFailure(400, 'BUSINESS_WORK_CURSOR_INVALID', '业务分页信息已失效，请刷新');
    }
    sourceIndex = Number(payload.sourceIndex); after = payload.after; anchor = payload.anchor;
  }
  const native = new EmployeeNativeActions(context, employee.actor), system = businessContext(employee.userId, employee.organizationId);
  const security = service<ISecurityService>(context, 'security');
  const objects = new Set((await native.bridge.listObjects()).map(o => o.name));
  const items: BusinessRow[] = [], errors = new Map<Kind, string>(), observedAt = new Date().toISOString();
  const positions = new Map<string, string[]>();
  async function candidates(position: string, exclude?: string): Promise<string[]> {
    if (!positions.has(position)) positions.set(position, await effectivePositionUsers(engine, employee.organizationId, position, { context: system }));
    return positions.get(position)!.filter(id => id !== exclude);
  }
  async function add(row: BusinessRow, objectName: string, kind: Kind, title: string, users: string[], preferred?: string) {
    const assignee = preferred ? (users.includes(preferred) ? preferred : undefined) : users.length === 1 ? users[0] : undefined;
    if (assignee ? assignee !== employee.userId : row.responsible_id !== employee.userId && row.registered_by !== employee.userId) return;
    const visible = businessRow(await native.bridge.get(objectName, String(row.id)));
    if (!visible || visible.id !== row.id) return;
    const label = String(visible.name || visible.code || '当前业务记录').slice(0, 300);
    const workKey = await digest(canonicalJSON({ organizationId: employee.organizationId, objectName, recordId: row.id, kind }));
    const modified = row.updated_at || row.created_at;
    items.push({ workKey, kind, title: `${title} · ${label}`.slice(0, 300),
      record: { objectName, recordId: row.id, label }, recordVersion: await businessRecordVersion(engine, objectName, String(row.id), employee.organizationId, system),
      updatedAt: modified && Number.isFinite(Date.parse(String(modified))) ? new Date(String(modified)).toISOString() : observedAt,
      assignment: assignee ? 'assigned' : 'needs_assignment',
      ...(!assignee ? { assignmentReason: !preferred && users.length > 1 ? 'multiple_eligible_employees' : 'no_eligible_employee' } : {}),
    });
  }
  let scanned = 0, successfulSources = 0, failedSources = 0;
  while (sourceIndex < sources.length && items.length < limit && scanned < 500) {
    const source = sources[sourceIndex];
    if (!objects.has(source.object)) {
      failedSources++; source.kinds.forEach(kind => errors.set(kind, 'BUSINESS_WORK_SOURCE_FORBIDDEN'));
      sourceIndex++; after = ''; continue;
    }
    try {
      if (!security.canReadObject) throw new TaskConnectionFailure(503, 'BUSINESS_WORK_SOURCE_UNAVAILABLE', '当前权限不可可靠核对');
      if (!await security.canReadObject(source.object, employee.actor)) throw new TaskConnectionFailure(403, 'BUSINESS_WORK_SOURCE_FORBIDDEN', '当前员工无权读取该事项来源');
      // Native object discovery is metadata visibility, not read permission.
      // Check the source with the employee even when no candidate row exists.
      const readable = businessRow(await native.bridge.query(source.object, { where: { organization_id: employee.organizationId }, fields: ['id'], limit: 1 }));
      if (!Array.isArray(readable?.records)) throw new TaskConnectionFailure(503, 'BUSINESS_WORK_SOURCE_UNAVAILABLE', '业务事项来源不可完整核对');
      const want = Math.min(100, 500 - scanned);
      const rows = await engine.find(source.object, { where: { ...source.where, organization_id: employee.organizationId, created_at: { $lte: anchor }, ...(after ? { id: { $gt: after } } : {}) }, limit: want, orderBy: [{ field: 'id', order: 'asc' }] }, { context: system });
      for (const row of rows) {
        if (items.length >= limit) break;
        after = String(row.id); scanned++;
        if (source.object === 'forge_quotation') {
          const actionName = quotationFollowUpAction(row, employee.userId);
          if (!actionName) continue;
          if (await engine.findOne('forge_quotation_contract_conversion', { where: { quotation_id: row.id, organization_id: employee.organizationId } }, { context: system })) continue;
          const action = (await native.employeeActions(source.object, row)).find(item => item.capabilityId.endsWith('.' + actionName));
          if (!action) continue;
          await add(row, source.object, 'quotation_follow_up', action.label, [employee.userId], employee.userId);
        } else if (source.object === 'forge_sales_order') {
          if (row.status !== 'draft' && !await completedOrderApproval(engine, row, system)) continue;
          if (row.responsible_id === employee.userId) await add(row, source.object, 'sales_order_submission', row.status === 'draft' ? '提交订单复核' : '核对并完成订单', await candidates('sales_order_operator'), employee.userId);
        } else if (source.object === 'forge_customer_prepayment') {
          await add(row, source.object, 'prepayment_confirmation', '独立确认预收款', await candidates('finance_reviewer', nonempty(row.registered_by)), nonempty(row.confirmation_reviewer_id));
        } else if (!['none', 'prepayment'].includes(String(row.order_payment_requirement))) {
          if (row.responsible_id === employee.userId && !row.signed_on) await add(row, source.object, 'contract_order_conditions', '确认下单付款条件', [employee.userId]);
        } else if (!row.signed_on) {
          await add(row, source.object, 'contract_signature', '登记客户签署', await candidates('contract_signature_registrar', nonempty(row.responsible_id)));
        } else {
          const orders = await engine.find('forge_sales_order', { where: { contract_id: row.id, organization_id: employee.organizationId, status: { $ne: 'cancelled' } }, limit: 1 }, { context: system });
          if (orders.length) continue;
          const required = requiredPrepayment(row), confirmed = await confirmedContractPrepayments(engine, row, system);
          if (confirmed.total >= required) {
            await add(row, source.object, 'sales_order_creation', '创建销售订单', await candidates('sales_order_operator'));
          } else {
            const pending = await engine.find('forge_customer_prepayment', { where: { contract_id: row.id, organization_id: employee.organizationId, status: 'pending_confirmation' }, limit: 1 }, { context: system });
            if (!pending.length) await add(row, source.object, 'contract_prepayment', '登记合同预收款', await candidates('finance_receivables_operator'));
          }
        }
      }
      successfulSources++;
      if (rows.length < want && after === String(rows.at(-1)?.id ?? after)) { sourceIndex++; after = ''; }
    } catch (error) {
      failedSources++; source.kinds.forEach(kind => errors.set(kind, error instanceof TaskConnectionFailure && error.status === 403 ? 'BUSINESS_WORK_SOURCE_FORBIDDEN' : 'BUSINESS_WORK_SOURCE_UNAVAILABLE'));
      sourceIndex++; after = '';
    }
  }
  if (failedSources && !successfulSources && !items.length) throw new TaskConnectionFailure(503, 'BUSINESS_WORK_UNAVAILABLE', '本人业务事项暂不可读取');
  let nextCursor: string | undefined;
  if (sourceIndex < sources.length) {
    const now = Math.floor(Date.now() / 1000);
    nextCursor = (await employee.api.signJWT({ body: { payload: {
      kind: 'forge_business_work_cursor_v1', sub: employee.userId, organization_id: employee.organizationId,
      aud: audience, iss: issuer, iat: now, exp: now + 900, sourceIndex, after, anchor,
      sourceVersion, source: sources[sourceIndex].object,
    } } })).token;
  }
  return { version: '1', items, readStatus: errors.size ? 'partial' : 'complete', observedAt,
    ...(nextCursor ? { nextCursor } : {}),
    ...(errors.size ? { sourceErrors: [...errors].map(([kind, code]) => ({ kind, code })) } : {}),
  };
}
