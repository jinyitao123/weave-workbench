import { SharingService, type SharingEngine } from '@objectstack/plugin-sharing';
import type { IObjectQLEngine, ISharingService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

type Options = Record<string, unknown> & { context?: ExecutionContext };

/**
 * The sandbox transaction is explicit, not an ambient ObjectQL transaction.
 * Native SharingService 17.5 replaces its storage context with SYSTEM_CTX and
 * drops that handle. Bind its public storage interface to the caller's handle;
 * retain the native service, schema validation and sys_record_share authority.
 * This writer is only for system hooks which have already checked their domain.
 */
export function sharingInTransaction(
  engine: IObjectQLEngine,
  service: ISharingService,
  context: ExecutionContext,
): ISharingService {
  if (context.transaction === undefined) return service;
  if (context.isSystem !== true || !context.tenantId) throw new Error('分享事务缺少有效的系统与组织上下文');
  const bind = (options: Options = {}) => ({ ...context, ...options.context, transaction: context.transaction });
  const query = (options: Options = {}) => { const { context: _context, ...criteria } = options; return criteria; };
  const schemas = engine as IObjectQLEngine & Pick<SharingEngine, 'getSchema'>;
  const storage: SharingEngine = {
    getSchema: object => schemas.getSchema?.(object),
    find: (object, options = {}) => engine.find(object, query(options), { context: bind(options) }),
    findOne: (object, options = {}) => engine.findOne(object, query(options), { context: bind(options) }),
    insert: (object, values, options = {}) => engine.insert(object, values, { ...options, context: bind(options) }),
    update: (object, values, options = {}) => engine.update(object, values, { ...options, context: bind(options) }),
    delete: (object, options = {}) => engine.delete(object, { ...query(options), context: bind(options) }),
  };
  return new SharingService({ engine: storage });
}
