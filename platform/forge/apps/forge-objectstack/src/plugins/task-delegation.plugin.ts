import type { Plugin, PluginContext } from '@objectstack/core';
import { makeExecutionContextResolver } from '@objectstack/plugin-hono-server';
import type { IHttpRequest, IHttpResponse, IHttpServer, IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import * as actionDeclarations from '../actions/index.js';
import {
  TASK_DELEGATION_OBJECT, DelegationRegistry, actionAllowed, bearerToken, decodeScope, delegableActions, encodeScope,
  entryAllowed, isLive, maxLifetimeMs, parseIssueRequest, sameScope, sha256Hex,
  type ActiveDelegation, type IssueRequest,
} from './task-delegation.js';

const ISSUE_ROUTE = '/api/v1/workbench/task-delegations';
const REVOKE_ROUTE = '/api/v1/workbench/task-delegations/:delegationId';
const IDENTITY_ROUTE = '/api/v1/workbench/identity-source';
const ISSUER_ENV = 'FORGE_IDENTITY_ISSUER';
const MAX_HOURS_ENV = 'FORGE_TASK_DELEGATION_MAX_HOURS';
const ISSUER = /^[A-Za-z][A-Za-z0-9+.-]*:\S{1,240}$/;
const SYSTEM_CONTEXT: ExecutionContext = { isSystem: true, positions: [], permissions: [] };
const WRITE_EVENTS = ['beforeInsert', 'beforeUpdate', 'beforeDelete'] as const;

type Row = Record<string, unknown>;
interface AuthContextLike {
  internalAdapter: {
    createSession(userId: string, dontRememberMe?: boolean, override?: Row): Promise<{ id: string; token: string } | null>;
    deleteSession(token: string): Promise<void>;
  };
  adapter: { delete(input: { model: string; where: Array<{ field: string; value: unknown }> }): Promise<void> };
}
interface AsyncStore<T> { run<R>(store: T, callback: () => R): R; getStore(): T | undefined }

function env(name: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}

// Node's AsyncLocalStorage, reached without a type dependency on @types/node.
function asyncStore<T>(): AsyncStore<T> {
  const process = (globalThis as { process?: { getBuiltinModule?: (name: string) => unknown } }).process;
  const module = process?.getBuiltinModule?.('node:async_hooks') as { AsyncLocalStorage?: new () => AsyncStore<T> } | undefined;
  if (!module?.AsyncLocalStorage) throw new Error('AsyncLocalStorage is required for task delegation guards');
  return new module.AsyncLocalStorage();
}

function service<T>(context: PluginContext, name: string): T | undefined {
  try { return context.getService<T>(name); } catch { return undefined; }
}

function sessionHeaders(headers: IHttpRequest['headers']): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (Array.isArray(value)) for (const item of value) result.append(name, item);
    else if (typeof value === 'string') result.set(name, value);
  }
  return result;
}

async function sendError(response: IHttpResponse, status: number, code: string): Promise<void> {
  response.header('Cache-Control', 'private, no-store');
  await response.status(status).json({ error: { code } });
}

function timestamp(value: unknown): number {
  const result = value instanceof Date ? value.getTime() : typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime() : NaN;
  return Number.isFinite(result) ? result : 0;
}

function activeFromRow(row: Row | null | undefined): ActiveDelegation | null {
  if (!row) return null;
  const scope = decodeScope(row.scope_json);
  const delegationId = typeof row.delegation_id === 'string' ? row.delegation_id : '';
  const organizationId = typeof row.organization_id === 'string' ? row.organization_id : '';
  const employeeId = typeof row.employee_id === 'string' ? row.employee_id : '';
  // A row that cannot be read back exactly is treated as a revoked credential.
  if (!scope || !delegationId || !organizationId || !employeeId) {
    return { delegationId: delegationId || 'invalid', organizationId, employeeId, actions: [], files: [], expiresAt: 0, revoked: true };
  }
  return { delegationId, organizationId, employeeId, ...scope, expiresAt: timestamp(row.expires_at), revoked: row.revoked_at != null };
}

/**
 * Decision 002: Forge issues a task delegation as a separate native session
 * for the same employee and enforces its scope with three guards. Verified on
 * ObjectStack 17.3: `server.use` runs before native routes, write hooks see
 * the caller's bearer, and deleting the session revokes it natively.
 */
export class TaskDelegationPlugin implements Plugin {
  name = 'com.inocube.forge.task-delegation';
  version = '1.0.0';
  type = 'standard' as const;

  init(context: PluginContext): void {
    context.hook('kernel:ready', () => {
      const server = service<IHttpServer>(context, 'http.server') ?? service<IHttpServer>(context, 'http-server');
      const engine = service<IObjectQLEngine>(context, 'objectql');
      if (!server || !engine) {
        context.logger.error('[task-delegation] HTTP or data service unavailable; delegations are disabled');
        return;
      }
      const resolveContext = makeExecutionContextResolver(context);
      const declared = delegableActions(Object.values(actionDeclarations));
      const insideAction = asyncStore<{ delegationId: string }>();
      const registry = new DelegationRegistry(async (tokenSha256) => activeFromRow(
        await engine.findOne(TASK_DELEGATION_OBJECT, { where: { token_sha256: tokenSha256 } }, { context: SYSTEM_CONTEXT }) as Row | null,
      ));
      const authContext = async (): Promise<AuthContextLike> => {
        const manager = service<{ getAuthInstance(): Promise<{ $context: Promise<AuthContextLike> }> }>(context, 'auth');
        if (!manager) throw new Error('auth service unavailable');
        return (await manager.getAuthInstance()).$context;
      };
      const delegationFor = async (token: string | undefined): Promise<ActiveDelegation | null> =>
        token ? registry.lookup(await sha256Hex(token)) : null;

      // Guard 1: a task credential reaches only the paths it needs.
      server.use(async (request, response, next) => {
        let delegation: ActiveDelegation | null;
        try { delegation = await delegationFor(bearerToken(request.headers)); }
        catch {
          context.logger.error('[task-delegation] delegation lookup failed; request refused');
          return sendError(response, 503, 'TASK_DELEGATION_UNAVAILABLE');
        }
        if (!delegation) return next();
        if (!isLive(delegation, Date.now())) return sendError(response, 401, 'TASK_DELEGATION_INACTIVE');
        if (!entryAllowed(delegation, request.method, request.path)) return sendError(response, 403, 'TASK_DELEGATION_SCOPE');
        return next();
      });

      // Guard 2: every business action a task credential triggers must be in scope.
      const actionEngine = engine as unknown as {
        executeAction(objectName: string, key: string, ctx: Row): Promise<unknown>;
        listRegisteredActions(): Array<{ objectName: string; actionName: string }>;
      };
      const originalExecute = actionEngine.executeAction.bind(engine);
      const registered = (objectName: string, key: string) =>
        actionEngine.listRegisteredActions().some((entry) => entry.objectName === objectName && entry.actionName === key);
      actionEngine.executeAction = async (objectName, key, actionContext) => {
        const executionContext = actionContext?.executionContext as { accessToken?: unknown } | undefined;
        const token = typeof executionContext?.accessToken === 'string' ? executionContext.accessToken : undefined;
        const delegation = await delegationFor(token);
        if (!delegation) return originalExecute(objectName, key, actionContext);
        // The runtime probes [object, 'global', '*'] keys in turn; an absent
        // registration must keep failing as "not registered" so it moves on.
        if (!registered(objectName, key)) return originalExecute(objectName, key, actionContext);
        const params = actionContext?.params as { recordId?: unknown } | undefined;
        const recordId = typeof params?.recordId === 'string' && params.recordId ? params.recordId : undefined;
        if (!isLive(delegation, Date.now()) || !actionAllowed(delegation, declared, objectName, key, recordId)) {
          throw Object.assign(new Error('TASK_DELEGATION_SCOPE: this action is outside the delegated task'), { status: 403, code: 'TASK_DELEGATION_SCOPE' });
        }
        return insideAction.run({ delegationId: delegation.delegationId }, () => originalExecute(objectName, key, actionContext));
      };

      // Guard 3: outside a delegated action, a task credential writes nothing
      // (this closes MCP create_record / update_record / delete_record).
      for (const event of WRITE_EVENTS) {
        engine.registerHook(event, async (hook: { session?: { accessToken?: unknown } }) => {
          const token = typeof hook?.session?.accessToken === 'string' ? hook.session.accessToken : undefined;
          const delegation = await delegationFor(token);
          if (!delegation) return;
          if (insideAction.getStore()?.delegationId === delegation.delegationId && isLive(delegation, Date.now())) return;
          throw Object.assign(new Error('TASK_DELEGATION_SCOPE: task credentials cannot write outside a delegated action'), { status: 403, code: 'TASK_DELEGATION_SCOPE' });
        }, { priority: 1, packageId: 'com.inocube.forge.task-delegation' });
      }

      server.get(IDENTITY_ROUTE, async (_request, response) => {
        const issuer = env(ISSUER_ENV)?.trim();
        if (!issuer || !ISSUER.test(issuer)) return sendError(response, 503, 'IDENTITY_SOURCE_UNCONFIGURED');
        response.header('Cache-Control', 'no-store');
        await response.status(200).json({ version: '1', issuer });
      });

      server.post(ISSUE_ROUTE, async (request, response) => {
        response.header('Cache-Control', 'private, no-store');
        const actor = await resolveContext({ req: { raw: { headers: sessionHeaders(request.headers) } } }) as ExecutionContext | undefined;
        if (!actor?.userId || !actor.tenantId) return sendError(response, 401, 'UNAUTHENTICATED');
        const issuer = env(ISSUER_ENV)?.trim();
        if (!issuer || !ISSUER.test(issuer)) return sendError(response, 503, 'IDENTITY_SOURCE_UNCONFIGURED');
        try {
          if (await delegationFor(bearerToken(request.headers))) return sendError(response, 403, 'TASK_DELEGATION_SCOPE');
        } catch { return sendError(response, 503, 'TASK_DELEGATION_UNAVAILABLE'); }
        const parsed = parseIssueRequest(request.body);
        if (!parsed.ok) return sendError(response, 422, parsed.code);
        const input = parsed.value;
        try {
          const scopeError = await this.verifyScope(engine, declared, actor, input);
          if (scopeError) return sendError(response, scopeError.status, scopeError.code);
          const result = await this.issue(engine, await authContext(), registry, actor, input);
          if ('error' in result) return sendError(response, result.status, result.error);
          context.logger.info('[task-delegation] issued', { delegationId: result.delegationId, deduplicated: result.deduplicated });
          await response.status(result.deduplicated ? 200 : 201).json({
            version: '1', delegationId: result.delegationId, issuer, credential: result.token,
            expiresAt: new Date(result.expiresAt).toISOString(), deduplicated: result.deduplicated,
          });
        } catch {
          context.logger.error('[task-delegation] issue failed');
          await sendError(response, 503, 'TASK_DELEGATION_UNAVAILABLE');
        }
      });

      server.delete(REVOKE_ROUTE, async (request, response) => {
        response.header('Cache-Control', 'private, no-store');
        const delegationId = typeof request.params?.delegationId === 'string' ? request.params.delegationId : '';
        const token = bearerToken(request.headers);
        const reasonValue = (request.body as { reason?: unknown } | undefined)?.reason;
        try {
          const own = await delegationFor(token);
          let row: Row | null;
          let reason: 'run_terminal' | 'employee_cancel';
          if (own) {
            // A task credential may revoke only itself, when its run ended.
            if (own.delegationId !== delegationId) return sendError(response, 403, 'TASK_DELEGATION_SCOPE');
            reason = 'run_terminal';
            row = await engine.findOne(TASK_DELEGATION_OBJECT, { where: { delegation_id: delegationId, organization_id: own.organizationId } }, { context: SYSTEM_CONTEXT }) as Row | null;
          } else {
            const actor = await resolveContext({ req: { raw: { headers: sessionHeaders(request.headers) } } }) as ExecutionContext | undefined;
            if (!actor?.userId || !actor.tenantId) return sendError(response, 401, 'UNAUTHENTICATED');
            reason = 'employee_cancel';
            row = await engine.findOne(TASK_DELEGATION_OBJECT, { where: { delegation_id: delegationId, organization_id: actor.tenantId, employee_id: actor.userId } }, { context: SYSTEM_CONTEXT }) as Row | null;
          }
          if (reasonValue !== undefined && reasonValue !== reason) return sendError(response, 422, 'DELEGATION_REQUEST_INVALID');
          if (!row) return sendError(response, 404, 'TASK_DELEGATION_NOT_FOUND');
          await this.revoke(engine, await authContext(), registry, row, reason, own ? token : undefined);
          await response.status(200).json({ version: '1', delegationId, revoked: true });
        } catch {
          context.logger.error('[task-delegation] revoke failed');
          await sendError(response, 503, 'TASK_DELEGATION_UNAVAILABLE');
        }
      });
    });
  }

  private async verifyScope(
    engine: IObjectQLEngine, declared: ReturnType<typeof delegableActions>, actor: ExecutionContext, input: IssueRequest,
  ): Promise<{ status: number; code: string } | undefined> {
    for (const action of input.actions) {
      if (!declared.has(`${action.objectName}:${action.actionName}`)) return { status: 422, code: 'DELEGATION_SCOPE_INVALID' };
    }
    if (input.record) {
      // The employee must see the record with their own native context.
      const found = await engine.findOne(input.record.objectName, { where: { id: input.record.recordId } }, { context: actor }).catch(() => null);
      if (!found) return { status: 403, code: 'DELEGATION_SCOPE_DENIED' };
    }
    for (const file of input.files) {
      const row = await engine.findOne('sys_file', { where: { id: file.fileId } }, { context: SYSTEM_CONTEXT }) as Row | null;
      if (!row || row.status !== 'committed' || (row.organization_id && row.organization_id !== actor.tenantId)) {
        return { status: 403, code: 'DELEGATION_SCOPE_DENIED' };
      }
      // Approval files are authorized per read by the approval snapshot routes;
      // owner files must belong to the employee now.
      if (file.sourceKind === 'owner' && row.owner_id !== actor.userId) return { status: 403, code: 'DELEGATION_SCOPE_DENIED' };
    }
    return undefined;
  }

  private async issue(
    engine: IObjectQLEngine, auth: AuthContextLike, registry: DelegationRegistry, actor: ExecutionContext, input: IssueRequest,
  ): Promise<{ delegationId: string; token: string; expiresAt: number; deduplicated: boolean } | { status: number; error: string }> {
    const organizationId = String(actor.tenantId), employeeId = String(actor.userId);
    const existing = await engine.findOne(TASK_DELEGATION_OBJECT, {
      where: { idempotency_key: input.idempotencyKey, organization_id: organizationId },
    }, { context: SYSTEM_CONTEXT }) as Row | null;
    if (existing) {
      const scope = decodeScope(existing.scope_json);
      if (existing.employee_id !== employeeId || existing.input_digest !== input.inputDigest || !scope || !sameScope(scope, input)) {
        return { status: 409, error: 'DELEGATION_CONFLICT' };
      }
      if (existing.revoked_at != null || timestamp(existing.expires_at) <= Date.now()) return { status: 409, error: 'DELEGATION_INACTIVE' };
      // The plaintext credential is never stored, so a retried issue rotates
      // it: a new session replaces the old one, which stops working at once.
      const expiresAt = timestamp(existing.expires_at);
      const session = await auth.internalAdapter.createSession(employeeId, false, {
        activeOrganizationId: organizationId, expiresAt: new Date(expiresAt), userAgent: 'forge-task-delegation',
      });
      if (!session?.token) throw new Error('session not created');
      const tokenSha256 = await sha256Hex(session.token);
      await engine.update(TASK_DELEGATION_OBJECT, { id: existing.id, session_id: session.id, token_sha256: tokenSha256 }, { context: SYSTEM_CONTEXT });
      await auth.adapter.delete({ model: 'session', where: [{ field: 'id', value: existing.session_id }] });
      registry.forget(String(existing.token_sha256));
      const delegationId = String(existing.delegation_id);
      registry.remember(tokenSha256, { delegationId, organizationId, employeeId, ...input, expiresAt, revoked: false });
      return { delegationId, token: session.token, expiresAt, deduplicated: true };
    }
    const issuedAt = Date.now();
    const expiresAt = issuedAt + maxLifetimeMs(env(MAX_HOURS_ENV));
    const delegationId = crypto.randomUUID();
    const session = await auth.internalAdapter.createSession(employeeId, false, {
      activeOrganizationId: organizationId, expiresAt: new Date(expiresAt), userAgent: 'forge-task-delegation',
    });
    if (!session?.token) throw new Error('session not created');
    const tokenSha256 = await sha256Hex(session.token);
    try {
      await engine.insert(TASK_DELEGATION_OBJECT, {
        name: `团队任务委托 ${new Date(issuedAt).toISOString().slice(0, 16).replace('T', ' ')}`,
        delegation_id: delegationId, organization_id: organizationId, employee_id: employeeId,
        session_id: session.id, token_sha256: tokenSha256, idempotency_key: input.idempotencyKey, input_digest: input.inputDigest,
        scope_json: encodeScope(input), issued_at: new Date(issuedAt), expires_at: new Date(expiresAt),
      }, { context: SYSTEM_CONTEXT });
    } catch (error) {
      // Never leave a usable session without its scope record.
      await auth.internalAdapter.deleteSession(session.token).catch(() => undefined);
      throw error;
    }
    registry.remember(tokenSha256, { delegationId, organizationId, employeeId, ...input, expiresAt, revoked: false });
    return { delegationId, token: session.token, expiresAt, deduplicated: false };
  }

  private async revoke(
    engine: IObjectQLEngine, auth: AuthContextLike, registry: DelegationRegistry, row: Row,
    reason: 'run_terminal' | 'employee_cancel', token: string | undefined,
  ): Promise<void> {
    if (row.revoked_at == null) {
      await engine.update(TASK_DELEGATION_OBJECT, { id: row.id, revoked_at: new Date(), revocation_reason: reason }, { context: SYSTEM_CONTEXT });
    }
    if (token) await auth.internalAdapter.deleteSession(token);
    else await auth.adapter.delete({ model: 'session', where: [{ field: 'id', value: row.session_id }] });
    registry.forget(String(row.token_sha256));
  }
}
