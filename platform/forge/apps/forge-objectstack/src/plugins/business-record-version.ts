import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { canonicalJSON, digest, TaskConnectionFailure } from './native-task-auth.js';

/** Includes the complete header and original child rows, including quotation
 * pricing/submitted/approved/sent/accepted versions. No client version input. */
export async function businessRecordVersion(engine: IObjectQLEngine, objectName: string, recordId: string, organizationId: string, context: ExecutionContext): Promise<string> {
  const record = await engine.findOne(objectName, { where: { id: recordId, organization_id: organizationId } }, { context });
  if (!record) throw new TaskConnectionFailure(404, 'EMPLOYEE_ACTION_RECORD_NOT_FOUND', '当前业务记录不可读取');
  const related: unknown[] = [];
  const child = objectName === 'forge_sales_contract' ? ['forge_sales_contract_line', 'contract_id']
    : objectName === 'forge_sales_order' ? ['forge_sales_order_line', 'order_id']
      : objectName === 'forge_quotation' ? ['forge_quotation_line', 'quotation_id'] : undefined;
  if (child) {
    const rows = await engine.find(child[0], { where: { [child[1]]: recordId, organization_id: organizationId }, orderBy: [{ field: 'id', order: 'asc' }], limit: 1001 }, { context });
    if (rows.length > 1000) throw new TaskConnectionFailure(503, 'EMPLOYEE_ACTION_RECORD_INCOMPLETE', '当前业务明细不可完整核对');
    related.push(rows);
  }
  if (objectName === 'forge_project') {
    for (const object of ['forge_project_sales_link', 'forge_project_member']) {
      const rows = await engine.find(object, { where: { project_id: recordId, organization_id: organizationId }, orderBy: [{ field: 'id', order: 'asc' }], limit: 1001 }, { context });
      if (rows.length > 1000) throw new TaskConnectionFailure(503, 'EMPLOYEE_ACTION_RECORD_INCOMPLETE', '项目关联或成员无法完整核对');
      related.push(rows);
    }
  }
  if (objectName === 'forge_customer' || objectName === 'forge_project') {
    const orders = await engine.find('forge_sales_order', { where: { organization_id: organizationId,
      ...(objectName === 'forge_project' ? { id: record.source_order_id || '__no_source__' } : { customer_id: recordId, status: { $in: ['approved', 'active'] }, approval_outcome: 'approved' }) },
      orderBy: [{ field: 'id', order: 'asc' }], limit: 101 }, { context });
    if (orders.length > 100) throw new TaskConnectionFailure(503, 'EMPLOYEE_ACTION_RECORD_INCOMPLETE', '项目可选订单超过完整核对范围');
    related.push(orders);
    for (const order of orders) {
      const contract = await engine.findOne('forge_sales_contract', { where: { id: order.contract_id, organization_id: organizationId } }, { context });
      related.push(contract);
      for (const [object, field, id] of [['forge_sales_order_line', 'order_id', order.id], ['forge_sales_contract_line', 'contract_id', order.contract_id],
        ...(contract?.quotation_id ? [['forge_quotation_line', 'quotation_id', contract.quotation_id]] : [])]) {
        const rows = await engine.find(object as string, { where: { [field as string]: id, organization_id: organizationId }, orderBy: [{ field: 'id', order: 'asc' }], limit: 1001 }, { context });
        if (rows.length > 1000) throw new TaskConnectionFailure(503, 'EMPLOYEE_ACTION_RECORD_INCOMPLETE', '项目来源明细无法完整核对');
        related.push(rows);
      }
      if (contract?.quotation_id) related.push(await engine.findOne('forge_quotation', { where: { id: contract.quotation_id, organization_id: organizationId } }, { context }));
    }
  }
  return digest(canonicalJSON(JSON.parse(JSON.stringify({ record, related }))));
}
