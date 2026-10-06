import type { IObjectQLEngine, ISharingService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { canonicalJSON, digest } from './native-task-auth.js';
import { TaskConnectionFailure } from './native-task-auth.js';
import { lockBusinessRow } from './business-transaction.js';
import { approvedProjectOrder, projectRows, validProjectManagerMember, type ProjectRow } from './project-order-readiness.js';
import { sharingInTransaction } from './native-sharing-transaction.js';

export const PROJECT_DELIVERY_SHARE_PREFIX = 'forge-project-delivery:';
type Desired = { object: string; recordId: string; recipientId: string; bindings: ProjectRow[]; sourceId?: string };
const key = (object: unknown, record: unknown, recipient: unknown) => JSON.stringify([object, record, recipient]);

/** One additive native provenance per recipient/record. Its digest is the
 * exact set of current links and member/manager assignments that justify it.
 * Native grant upserts on source, so an unrelated team grant is a conflict;
 * it must never be overwritten or later revoked by this projection. */
export async function synchronizeProjectOrderShares(engine: IObjectQLEngine, sharing: ISharingService, context: ExecutionContext, projectId: string): Promise<void> {
  if (context.isSystem !== true || !context.tenantId) throw new Error('项目来源分享缺少原生组织上下文');
  const currentProject = await engine.findOne('forge_project', { where: { id: projectId, organization_id: context.tenantId } }, { context });
  if (!currentProject?.customer_id) throw new Error('项目分享缺少准确客户来源');
  const customerId = String(currentProject.customer_id), prefix = PROJECT_DELIVERY_SHARE_PREFIX + customerId + ':';
  if (context.transaction) await lockBusinessRow(engine, 'forge_customer', customerId, String(context.tenantId), context);
  sharing = sharingInTransaction(engine, sharing, context);
  const desired = new Map<string, Desired>();
  const customerProjects = await projectRows(engine, 'forge_project', { customer_id: customerId, organization_id: context.tenantId }, context);
  const projects = new Map(customerProjects.map(project => [String(project.id), project]));
  const links = await projectRows(engine, 'forge_project_sales_link', { organization_id: context.tenantId, project_id: { $in: [...projects.keys()] } }, context);
  for (const link of links) {
    const projectId = String(link.project_id);
    const project = projects.get(projectId);
    if (!project || ['archived', 'terminated'].includes(String(project.status)) || link.order_id !== project.source_order_id) continue;
    const members = await projectRows(engine, 'forge_project_member', { project_id: projectId, organization_id: context.tenantId }, context);
    if (!await validProjectManagerMember(engine, project, context)) continue;
    let source: Awaited<ReturnType<typeof approvedProjectOrder>>;
    try { source = await approvedProjectOrder(engine, String(project.customer_id), String(link.order_id), context); }
    catch (error) { if (error instanceof TaskConnectionFailure && error.code === 'PROJECT_SOURCE_INVALID') continue; throw error; }
    if (source.contract.id !== link.contract_id || source.version !== project.source_order_version) continue;
    for (const member of members.filter(row => row.active === true)) {
      const userId = String(member.user_id);
      const [user, organizationMembers] = await Promise.all([
        engine.findOne('sys_user', { where: { id: userId } }, { context }),
        engine.find('sys_member', { where: { user_id: userId, organization_id: context.tenantId }, limit: 2 }, { context }),
      ]);
      if (!user || user.banned === true || user.active === false || organizationMembers.length !== 1 || organizationMembers[0].active === false) continue;
      const binding = { linkId: link.id, projectId, customerId: project.customer_id, orderId: source.order.id, contractId: source.contract.id,
        sourceVersion: source.version, managerId: project.manager_id, memberId: member.id, userId, memberDuty: member.member_duty,
        memberRevision: member.position_assignment_revision ?? null };
      for (const [object, recordId] of [['forge_customer', project.customer_id], ['forge_sales_contract', source.contract.id], ['forge_sales_order', source.order.id],
        ...(source.quotation ? [['forge_quotation', source.quotation.id]] : [])]) {
        const id = String(recordId), index = key(object, id, userId);
        const current = desired.get(index) ?? { object: String(object), recordId: id, recipientId: userId, bindings: [] };
        current.bindings.push(binding); desired.set(index, current);
      }
    }
  }
  for (const value of desired.values()) {
    value.bindings.sort((left, right) => canonicalJSON(left).localeCompare(canonicalJSON(right)));
    value.sourceId = prefix + await digest(canonicalJSON(value.bindings));
  }
  const existing = await engine.find('sys_record_share', { where: { organization_id: context.tenantId, recipient_type: 'user', source: 'team' }, limit: 5001 }, { context });
  if (existing.length > 5000) throw new Error('原生项目分享来源无法完整核对');
  for (const share of existing) {
    if (!String(share.source_id || '').startsWith(prefix)) continue;
    const current = desired.get(key(share.object_name, share.record_id, share.recipient_id));
    if (!current || current.sourceId !== share.source_id || share.access_level !== 'read')
      await sharing.revoke(String(share.id), context, { object: String(share.object_name), recordId: String(share.record_id) });
  }
  for (const current of desired.values()) {
    const grants = existing.filter(row => row.object_name === current.object && row.record_id === current.recordId && row.recipient_id === current.recipientId);
    if (grants.some(row => !String(row.source_id || '').startsWith(PROJECT_DELIVERY_SHARE_PREFIX))) throw new Error('CONFLICT: 已有其他团队来源的原生分享，项目关联未生效');
    if (grants.some(row => row.source_id === current.sourceId && row.access_level === 'read')) continue;
    await sharing.grant({ object: current.object, recordId: current.recordId, recipientType: 'user', recipientId: current.recipientId,
      accessLevel: 'read', source: 'team', sourceId: current.sourceId, reason: '当前有效项目成员读取准确已关联订单交付来源' }, context);
  }
}
