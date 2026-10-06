import type { IDataDriver, IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { StorageNameMapping } from '@objectstack/spec/system';
import { SYSTEM_READ, TaskConnectionFailure } from './native-task-auth.js';

const TABLES = new Set(['forge_quotation', 'forge_quotation_line', 'forge_sales_contract', 'forge_sales_order', 'forge_customer_prepayment', 'forge_cash_receipt', 'forge_fund_account', 'sys_file']);
export function businessDriver(engine: IObjectQLEngine, objects: string[]): IDataDriver {
  const name = engine.getDefaultDriverName?.(), driver = name ? engine.getDriverByName?.(name) : undefined;
  if (!driver?.execute || !engine.getDriverForObject || objects.some(object => engine.getDriverForObject!(object) !== driver)) {
    throw new TaskConnectionFailure(503, 'BUSINESS_TRANSACTION_UNAVAILABLE', '当前业务需要同一数据源的原生事务');
  }
  return driver;
}

/** A lock is not an access grant. Callers must first verify native record
 * access and may only pass a domain-owned, server-resolved reference. */
export async function lockBusinessRow(engine: IObjectQLEngine, object: string, id: string, organizationId: string, context: ExecutionContext): Promise<void> {
  if (!TABLES.has(object) || !id || !organizationId || !context.transaction) throw new TaskConnectionFailure(503, 'BUSINESS_TRANSACTION_UNAVAILABLE', '业务事务上下文不可核验');
  const driver = businessDriver(engine, [object]);
  let result: unknown;
  try { result = await driver.execute!('SELECT id FROM ?? WHERE id = ? AND organization_id = ? FOR UPDATE',
    [StorageNameMapping.resolveTableName({ name: object }), id, organizationId], { transaction: context.transaction }); }
  catch { throw new TaskConnectionFailure(503, 'BUSINESS_TRANSACTION_UNAVAILABLE', '当前数据源无法保护业务版本'); }
  const rows = result && typeof result === 'object' && 'rows' in result ? (result as { rows: unknown }).rows : result;
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== id) throw new TaskConnectionFailure(409, 'BUSINESS_RECORD_CHANGED', '业务记录已变化，请重新读取');
}

export function businessContext(userId: string, organizationId: string): ExecutionContext {
  return { ...SYSTEM_READ, userId, tenantId: organizationId };
}
