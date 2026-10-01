import type { Plugin, PluginContext } from '@objectstack/core';
import type { IObjectQLEngine, IHttpRequest, IHttpResponse, IHttpServer } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { SYSTEM_READ, TaskConnectionFailure, canonicalJSON, currentNativeActor, digest, headersFor,
  nativeEmployee, nonempty, service, taskAudience, taskIdentityIssuer, taskLifetimeMs, verifyNativeConnection, type NativeAuthService } from './native-task-auth.js';
import { TaskMcpAdapter } from './task-mcp-bridge.js';
import { actionKey, parseTaskScope, readTaskResource, type TaskScope } from './task-delegation-scope.js';

const ROOT = '/api/v1/apps/forge/task-delegations';
const OBJECT = 'forge_task_delegation';
type Row = Record<string, unknown>;

export class TaskDelegationService {
  readonly mcp: TaskMcpAdapter;
  constructor(readonly context: PluginContext) { this.mcp = new TaskMcpAdapter(context); }

  private engine() { return service<IObjectQLEngine>(this.context, 'objectql'); }
  private auth() { return service<NativeAuthService>(this.context, 'auth'); }

  private async latest(key: string): Promise<Row | undefined> {
    const rows = await this.engine().find(OBJECT, { where: { grant_key: key }, orderBy: [{ field: 'generation', order: 'desc' }], limit: 1 }, { context: SYSTEM_READ });
    return rows[0];
  }

  private scope(row: Row): TaskScope {
    if (typeof row.scope_json !== 'string') throw new TaskConnectionFailure(503, 'FORGE_TASK_GRANT_INVALID', '任务授权记录不可核对');
    return parseTaskScope(JSON.parse(row.scope_json));
  }

  private async response(row: Row) {
    const auth = this.auth(), api = await auth.getApi();
    const issuer = new URL(auth.getAuthIssuer()).origin;
    const scope = this.scope(row), generation = Number(row.generation);
    const issued = Math.floor(Date.parse(String(row.issued_at)) / 1000), expires = Math.floor(Date.parse(String(row.expires_at)) / 1000);
    if (!Number.isSafeInteger(generation) || generation < 1 || !Number.isFinite(issued) || !Number.isFinite(expires)) {
      throw new TaskConnectionFailure(503, 'FORGE_TASK_GRANT_INVALID', '任务授权记录不可核对');
    }
    const identityIssuer = taskIdentityIssuer();
    const payload = { kind: 'forge_task_v1', iss: identityIssuer, aud: taskAudience(identityIssuer),
      sub: String(row.user_id), organization_id: String(row.organization_id), parent_session_id: String(row.source_session_id),
      jti: String(row.id), grant_id: String(row.grant_key), generation, scope_sha256: String(row.scope_sha256), iat: issued, exp: expires };
    const signed = await api.signJWT({ body: { payload } });
    return { version: '1', token_type: 'forge_task', access_token: signed.token, grant_id: String(row.grant_key), generation,
      issued_at: new Date(issued * 1000).toISOString(), expires_at: new Date(expires * 1000).toISOString(),
      scope_sha256: String(row.scope_sha256), scope, subject: { id: String(row.user_id), organization_id: String(row.organization_id) }, issuer, identity_issuer: identityIssuer };
  }

  async issue(request: IHttpRequest) {
    const caller = await nativeEmployee(this.context, request);
    const body = request.body as { request_id?: unknown; scope?: unknown; expected_generation?: unknown } | undefined;
    const requestId = nonempty(body?.request_id, 256);
    if (!requestId) throw new TaskConnectionFailure(400, 'FORGE_TASK_REQUEST_INVALID', '任务授权请求无效');
    const scope = parseTaskScope(body?.scope);
    const scopeJSON = canonicalJSON(scope);
    if (new TextEncoder().encode(scopeJSON).length > 64 * 1024) throw new TaskConnectionFailure(400, 'FORGE_TASK_SCOPE_INVALID', '任务授权范围超限');
    const scopeHash = await digest(scopeJSON);
    const key = await digest(canonicalJSON([caller.userId, caller.organizationId, scope.input_revision_id]));
    // A handed-off task survives the desktop login. A retried original issuance
    // reuses the grant even when the employee has since logged in again.
    const requestHash = await digest(canonicalJSON([caller.userId, caller.organizationId, requestId]));
    const actor = caller.actor;
    const available = await this.mcp.actions(actor);
    if (scope.allowed_actions.some((action) => !available.some((definition) => actionKey(definition) === action))) {
      throw new TaskConnectionFailure(403, 'FORGE_TASK_ACTION_FORBIDDEN', '当前员工不能执行所选业务动作');
    }
    if (scope.business_record) {
      const bridge = await this.mcp.bridge(actor, scope);
      const record = await bridge.get(scope.business_record.object_name, scope.business_record.record_id);
      if (!record) throw new TaskConnectionFailure(404, 'FORGE_TASK_RECORD_NOT_FOUND', '当前业务记录不可读取');
    }
    for (const resource of scope.resources) await readTaskResource(this.context, actor, resource);
    const existing = await this.engine().findOne(OBJECT, { where: { request_hash: requestHash } }, { context: SYSTEM_READ });
    if (existing) {
      if (existing.scope_sha256 !== scopeHash || existing.grant_key !== key || existing.user_id !== caller.userId || existing.organization_id !== caller.organizationId) {
        throw new TaskConnectionFailure(409, 'FORGE_TASK_REQUEST_CONFLICT', '同一授权请求不能更换范围');
      }
      return this.response(existing);
    }
    const previous = await this.latest(key);
    if (previous && previous.scope_sha256 !== scopeHash) throw new TaskConnectionFailure(409, 'FORGE_TASK_SCOPE_CONFLICT', '原输入的授权范围不能更换');
    if (previous?.revoked_at && ['employee_cancel', 'subject_inactive'].includes(String(previous.revocation_reason))) {
      throw new TaskConnectionFailure(409, 'FORGE_TASK_REVOCATION_FINAL', '原工作授权已终止，请从新的工作输入开始');
    }
    const oldGeneration = previous ? Number(previous.generation) : 0;
    if (body?.expected_generation !== undefined && body.expected_generation !== oldGeneration) {
      throw new TaskConnectionFailure(409, 'FORGE_TASK_GENERATION_CONFLICT', '任务授权已有更新，请重新核对');
    }
    const issuedAt = Math.floor(Date.now() / 1000) * 1000;
    const expiresAt = issuedAt + taskLifetimeMs();
    if (expiresAt <= issuedAt) throw new TaskConnectionFailure(503, 'FORGE_TASK_LIFETIME_INVALID', '任务有效期配置无效');
    let row: Row;
    try {
      row = await this.engine().insert(OBJECT, { name: '任务授权', request_hash: requestHash, grant_key: key, scope_sha256: scopeHash,
        scope_json: scopeJSON, user_id: caller.userId, organization_id: caller.organizationId, source_session_id: caller.sessionId,
        input_revision_id: scope.input_revision_id, generation: oldGeneration + 1,
        issued_at: new Date(issuedAt).toISOString(), expires_at: new Date(expiresAt).toISOString() }, { context: SYSTEM_READ }) as Row;
    } catch {
      // Both unique indexes are the transaction boundary. A concurrent same
      // request replays; a different renewal must not mint a duplicate generation.
      const raced = await this.engine().findOne(OBJECT, { where: { request_hash: requestHash } }, { context: SYSTEM_READ });
      if (raced && raced.grant_key === key && raced.scope_sha256 === scopeHash && raced.user_id === caller.userId && raced.organization_id === caller.organizationId) return this.response(raced);
      const winner = await this.latest(key);
      if (winner && Number(winner.generation) > oldGeneration) throw new TaskConnectionFailure(409, 'FORGE_TASK_GENERATION_CONFLICT', '任务授权已有更新，请重新核对');
      throw new TaskConnectionFailure(503, 'FORGE_TASK_STORE_UNAVAILABLE', '任务授权暂未确认，请沿原请求核对');
    }
    return this.response(row);
  }

  async current(request: IHttpRequest) {
    const auth = this.auth(), api = await auth.getApi();
    const authorization = headersFor(request).get('authorization') ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const identityIssuer = taskIdentityIssuer(), audience = taskAudience(identityIssuer);
    const claim = token ? await verifyNativeConnection(api, token, identityIssuer, audience) : null;
    if (!claim || claim.kind !== 'forge_task_v1' || claim.aud !== audience || !nonempty(claim.jti) || !nonempty(claim.sub) || !nonempty(claim.organization_id)) {
      throw new TaskConnectionFailure(401, 'FORGE_TASK_DELEGATION_INVALID', '本次任务授权已失效，请重新授权');
    }
    const row = await this.engine().findOne(OBJECT, { where: { id: claim.jti } }, { context: SYSTEM_READ });
    if (!row || row.user_id !== claim.sub || row.organization_id !== claim.organization_id ||
        row.grant_key !== claim.grant_id || Number(row.generation) !== claim.generation || row.scope_sha256 !== claim.scope_sha256 ||
        row.source_session_id !== claim.parent_session_id || Date.parse(String(row.expires_at)) <= Date.now()) {
      throw new TaskConnectionFailure(401, 'FORGE_TASK_DELEGATION_REVOKED', '本次任务授权已失效，请重新授权');
    }
    if (row.revoked_at) {
      if (row.revocation_reason === 'subject_inactive') throw new TaskConnectionFailure(401, 'FORGE_TASK_SUBJECT_INACTIVE', '原任务因员工停用已失效');
      if (row.revocation_reason === 'employee_cancel') throw new TaskConnectionFailure(403, 'FORGE_TASK_CANCELLED', '原工作已由员工取消');
      throw new TaskConnectionFailure(401, 'FORGE_TASK_DELEGATION_REVOKED', '本次任务授权已撤销');
    }
    const latest = await this.latest(String(row.grant_key));
    if (!latest || latest.id !== row.id) throw new TaskConnectionFailure(401, 'FORGE_TASK_DELEGATION_REPLACED', '本次任务授权已有更新');
    const scope = this.scope(row);
    if (await digest(canonicalJSON(scope)) !== row.scope_sha256) throw new TaskConnectionFailure(503, 'FORGE_TASK_GRANT_INVALID', '任务授权记录不可核对');
    const actor = await currentNativeActor(this.context, String(row.user_id), String(row.organization_id));
    actor.principalKind = 'agent';
    actor.onBehalfOf = { userId: String(row.user_id), principalKind: 'human' };
    actor.oauthScopes = ['data:read', 'actions:execute'];
    actor.traceId = `forge-task:${String(row.grant_key)}`;
    return { row, scope, actor, issuer: new URL(auth.getAuthIssuer()).origin, identityIssuer };
  }

  async revoke(request: IHttpRequest) {
    const grantID = nonempty(request.params?.grantId, 64);
    if (!grantID || !/^[a-f0-9]{64}$/.test(grantID)) throw new TaskConnectionFailure(404, 'FORGE_TASK_GRANT_NOT_FOUND', '任务授权不存在');
    const auth = this.auth(), api = await auth.getApi(), identityIssuer = taskIdentityIssuer();
    const authorization = headersFor(request).get('authorization') ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const claim = token ? await verifyNativeConnection(api, token, identityIssuer, taskAudience(identityIssuer)) : null;
    const row = await this.latest(grantID);
    let reason: string;
    if (claim?.kind === 'forge_task_v1') {
      if (claim.grant_id !== grantID || !row || row.id !== claim.jti || Number(row.generation) !== claim.generation ||
          row.user_id !== claim.sub || row.organization_id !== claim.organization_id || row.scope_sha256 !== claim.scope_sha256) {
        throw new TaskConnectionFailure(403, 'FORGE_TASK_SCOPE_FORBIDDEN', '任务只能撤销自身授权');
      }
      reason = 'run_terminal';
    } else {
      const employee = await nativeEmployee(this.context, request);
      if (!row || row.user_id !== employee.userId || row.organization_id !== employee.organizationId) {
        throw new TaskConnectionFailure(404, 'FORGE_TASK_GRANT_NOT_FOUND', '任务授权不存在');
      }
      reason = 'employee_cancel';
    }
    const body = request.body as { reason?: unknown } | undefined;
    if (body?.reason !== undefined && body.reason !== reason) throw new TaskConnectionFailure(403, 'FORGE_TASK_SCOPE_FORBIDDEN', '撤销原因与调用者不符');
    if (!row!.revoked_at) await this.engine().update(OBJECT, { revoked_at: new Date().toISOString(), revocation_reason: reason },
      { multi: true, where: { id: row!.id, revoked_at: { $null: true } }, context: SYSTEM_READ });
    const revoked = await this.engine().findOne(OBJECT, { where: { id: row!.id } }, { context: SYSTEM_READ });
    if (!revoked?.revoked_at) throw new TaskConnectionFailure(503, 'FORGE_TASK_REVOCATION_UNCONFIRMED', '任务授权撤销尚未确认');
    return { version: '1', grant_id: grantID, revoked: true, reason: String(revoked.revocation_reason ?? reason) };
  }
}

function fail(response: IHttpResponse, error: unknown, noEffect: boolean) {
  const known = error instanceof TaskConnectionFailure || error instanceof Error && 'status' in error && 'code' in error;
  const status = known ? Number((error as TaskConnectionFailure).status) : 503;
  const code = known ? String((error as TaskConnectionFailure).code) : 'FORGE_TASK_SERVICE_UNAVAILABLE';
  return response.status(status).json({ error: { code, message: known ? String((error as Error).message) : '任务连接暂不可用',
    ...(noEffect ? { no_effect: true, phase: 'authorization' } : {}) } });
}

export class TaskDelegationPlugin implements Plugin {
  name = 'com.inocube.forge.task-delegation';
  version = '1.0.0'; type = 'standard' as const;
  dependencies = ['com.objectstack.auth', 'com.objectstack.mcp'];
  init(context: PluginContext): void {
    context.hook('kernel:ready', () => {
      const server = service<IHttpServer>(context, 'http.server'), tasks = new TaskDelegationService(context);
      const engine = service<IObjectQLEngine>(context, 'objectql');
      // Native Auth ban-user updates sys_user through these same public hooks.
      // Unbanning must not revive authority issued before the account was banned.
      engine.registerHook('afterUpdate', async (hook: {
        input?: { id?: string; data?: Row }; previous?: Row; result?: Row; transaction?: ExecutionContext['transaction'];
      }) => {
        if (hook.previous?.banned === true || hook.input?.data?.banned !== true && hook.result?.banned !== true) return;
        const id = nonempty(hook.input?.id ?? hook.previous?.id ?? hook.result?.id);
        if (!id) throw new TaskConnectionFailure(503, 'FORGE_TASK_REVOCATION_UNCONFIRMED', '员工任务授权撤销尚未确认');
        const auditContext = { ...SYSTEM_READ, ...(hook.transaction ? { transaction: hook.transaction } : {}) };
        const user = await engine.findOne('sys_user', { where: { id }, fields: ['id', 'banned'] }, { context: auditContext });
        if (user?.banned !== true) return;
        await engine.update(OBJECT, { revoked_at: new Date().toISOString(), revocation_reason: 'subject_inactive' },
          { multi: true, where: { user_id: id, revoked_at: { $null: true } }, context: auditContext });
      }, { object: 'sys_user', packageId: this.name });
      server.get('/api/v1/workbench/identity-source', async (_request, response) => {
        response.header('Cache-Control', 'no-store');
        try { await response.status(200).json({ version: '1', issuer: taskIdentityIssuer() }); }
        catch (error) { await fail(response, error, true); }
      });
      server.post(ROOT, async (request, response) => {
        response.header('Cache-Control', 'private, no-store');
        try { await response.status(200).json(await tasks.issue(request)); }
        catch (error) { await fail(response, error, true); }
      });
      server.get(`${ROOT}/current`, async (request, response) => {
        response.header('Cache-Control', 'private, no-store');
        try {
          const { row, scope, issuer, identityIssuer } = await tasks.current(request);
          await response.status(200).json({ version: '1', active: true, token_type: 'forge_task', grant_id: row.grant_key,
            generation: Number(row.generation), issuer, identity_issuer: identityIssuer, scope_sha256: row.scope_sha256, scope,
            subject: { id: row.user_id, organization_id: row.organization_id }, issued_at: row.issued_at, expires_at: row.expires_at });
        } catch (error) { await fail(response, error, true); }
      });
      server.delete(`${ROOT}/:grantId`, async (request, response) => {
        response.header('Cache-Control', 'private, no-store');
        try { await response.status(200).json(await tasks.revoke(request)); }
        catch (error) { await fail(response, error, false); }
      });
      server.get(`${ROOT}/objects/:objectName`, async (request, response) => {
        response.header('Cache-Control', 'private, no-store');
        try {
          const { actor, scope } = await tasks.current(request);
          await response.status(200).json(await tasks.mcp.objectMetadata(actor, scope, String(request.params?.objectName)));
        } catch (error) { await fail(response, error, true); }
      });
      server.get(`${ROOT}/files/:fileId/original`, async (request, response) => {
        response.header('Cache-Control', 'private, no-store');
        try {
          const { actor, scope } = await tasks.current(request);
          const resource = scope.resources.find((entry) => entry.id === request.params?.fileId);
          if (!resource) throw new TaskConnectionFailure(403, 'FORGE_TASK_SCOPE_FORBIDDEN', '材料不在本次授权范围');
          const original = await readTaskResource(context, actor, resource);
          response.header('Content-Type', original.mediaType); response.header('Content-Length', String(original.bytes.byteLength));
          response.header('X-Content-SHA256', original.sha256); response.header('ETag', `"${original.sha256}"`);
          await response.status(200).send(original.bytes);
        } catch (error) { await fail(response, error, true); }
      });
      server.post(`${ROOT}/mcp`, async (request, response) => {
        let authorized = false;
        response.header('Cache-Control', 'private, no-store');
        try {
          const { actor, scope, issuer } = await tasks.current(request);
          const webRequest = new Request(new URL(`${ROOT}/mcp`, issuer), { method: 'POST', headers: headersFor(request), body: JSON.stringify(request.body) });
          // Once the native MCP bridge is invoked an exception is not proof of
          // no effect. Only connection validation before this line can say so.
          authorized = true;
          const result = await tasks.mcp.handle(webRequest, request.body, actor, scope);
          result.headers.forEach((value, name) => response.header(name, value));
          await response.status(result.status).send(new Uint8Array(await result.arrayBuffer()));
        } catch (error) { await fail(response, error, !authorized); }
      });
    });
  }
}
