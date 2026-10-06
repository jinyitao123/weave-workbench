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
  return digest(canonicalJSON(JSON.parse(JSON.stringify({ record, related }))));
}
