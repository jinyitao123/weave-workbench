import type { IObjectQLEngine, ISharingService, RlsMembershipContext } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

export const SALES_CONTRACT_ORDER_LINE_READ_KEY = 'native_sales_contract_order_line_ids';
type Row = Record<string, unknown>;

/** Feeds one native child RLS policy. It cannot grant object admission, bypass
 * the parent filter or expose business records. The native Sharing service
 * supplies the own/shared arm; the other arm is the current contract owner. */
export async function salesProjectOrderLineScope(engine: IObjectQLEngine, sharing: ISharingService, actor: RlsMembershipContext, organizationId: string): Promise<string[]> {
  if (!actor.userId || !organizationId || !sharing.buildReadFilter) throw new Error('销售订单行原生范围不可可靠核对');
  const transaction = (actor as ExecutionContext).transaction;
  const system: ExecutionContext = { isSystem: true, userId: actor.userId, tenantId: organizationId,
    ...(transaction ? { transaction } : {}) };
  const rows = async (object: string, where: Row, fields: string[]) => {
    const result = await engine.find(object, { where, fields, orderBy: [{ field: 'id', order: 'asc' }], limit: 1001 }, { context: system });
    if (!Array.isArray(result) || result.length > 1000) throw new Error('销售订单行原生范围超过完整读取边界');
    return result;
  };
  const contracts = await rows('forge_sales_contract', { organization_id: organizationId, owner_id: actor.userId }, ['id', 'customer_id']);
  const owned = contracts.length ? await rows('forge_sales_order', { organization_id: organizationId, contract_id: { $in: contracts.map(row => row.id) } }, ['id', 'contract_id', 'customer_id']) : [];
  const ownIds = owned.filter(order => contracts.some(contract => contract.id === order.contract_id && contract.customer_id === order.customer_id)).map(row => row.id);
  // Do not carry a parent object's org read-scope hint into this child's own
  // admission. Identity/tenancy are unchanged; the native own filter is exact.
  const filter = await sharing.buildReadFilter('forge_sales_order', { ...actor, isSystem: false, userId: actor.userId,
    tenantId: organizationId, __readScope: 'own' } as ExecutionContext);
  if (filter != null && (typeof filter !== 'object' || Array.isArray(filter))) throw new Error('原生订单分享未返回可靠过滤条件');
  const shared = await rows('forge_sales_order', { $and: [{ organization_id: organizationId }, filter ?? {}] }, ['id']);
  const orderIds = [...new Set([...ownIds, ...shared.map(row => row.id)])];
  if (!orderIds.length) return [];
  const lines = await rows('forge_sales_order_line', { organization_id: organizationId, order_id: { $in: orderIds } }, ['id', 'order_id']);
  return lines.map(line => String(line.id));
}
