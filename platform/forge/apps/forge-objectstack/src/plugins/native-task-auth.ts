import type { PluginContext } from '@objectstack/core';
import { resolveUserAuthzGrants, evaluateAuthGate } from '@objectstack/core';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import type { IObjectQLEngine, IHttpRequest } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

export const SYSTEM_READ: ExecutionContext = { isSystem: true, positions: [], permissions: [] };

export function taskIdentityIssuer(): string {
  const issuer = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.FORGE_IDENTITY_ISSUER?.trim();
  if (!issuer || !/^[A-Za-z][A-Za-z0-9+.-]*:\S{1,240}$/.test(issuer) || /^https?:\/\//i.test(issuer)) {
    throw new TaskConnectionFailure(503, 'IDENTITY_SOURCE_UNCONFIGURED', '身份来源尚未配置');
  }
  return issuer;
}

export function taskAudience(issuer: string): string { return `forge_task:${issuer}`; }

export function taskLifetimeMs(): number {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.FORGE_TASK_DELEGATION_MAX_HOURS;
  const hours = raw === undefined || raw === '' ? 24 : Number(raw);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new TaskConnectionFailure(503, 'FORGE_TASK_LIFETIME_INVALID', '任务有效期配置无效');
  return Math.floor(hours * 60 * 60_000 / 1000) * 1000;
}

export interface NativeAuthApi {
  getSession(args: { headers: Headers }): Promise<{ user?: { id?: string; authGate?: { code: string; message?: string } }; session?: { id?: string; activeOrganizationId?: string; expiresAt?: string | Date } } | null>;
  signJWT(args: { body: { payload: Record<string, unknown> } }): Promise<{ token: string }>;
  verifyJWT(args: { body: { token: string; issuer: string } }): Promise<{ payload?: Record<string, unknown> } | null>;
  getJwks(): Promise<JSONWebKeySet>;
}

export interface NativeAuthService {
  getApi(): Promise<NativeAuthApi>;
  getAuthIssuer(): string;
}

export class TaskConnectionFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function headersFor(request: IHttpRequest): Headers {
  const headers = new Headers();
  for (const [name, raw] of Object.entries(request.headers ?? {})) {
    if (raw != null) headers.set(name, Array.isArray(raw) ? raw.join(', ') : String(raw));
  }
  return headers;
}

export function service<T>(context: PluginContext, name: string): T {
  try { return context.getService<T>(name); }
  catch { throw new TaskConnectionFailure(503, 'FORGE_TASK_SERVICE_UNAVAILABLE', '任务连接暂不可用'); }
}

export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .filter(([, entry]) => entry !== undefined).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJSON(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function digest(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function nonempty(value: unknown, maximum = 128): string | undefined {
  return typeof value === 'string' && value.length <= maximum && value.trim() === value && value.length && !/[\x00-\x1f\x7f]/.test(value) ? value : undefined;
}

/** Same JOSE verifier and live native JWKS that AuthManager's MCP verifier
 * uses. The generic server-only verifyJWT API fixes its default audience, so
 * it cannot verify a purpose-bound connection audience; never relax that aud. */
export async function verifyNativeConnection(api: NativeAuthApi, token: string, issuer: string, audience: string): Promise<Record<string, unknown> | null> {
  try {
    const jwks = await api.getJwks();
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), { issuer, audience });
    return payload;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_JWT_EXPIRED') throw new TaskConnectionFailure(401, 'FORGE_TASK_DELEGATION_EXPIRED', '本次任务授权已过期');
    return null;
  }
}

export async function nativeEmployee(context: PluginContext, request: IHttpRequest) {
  const auth = service<NativeAuthService>(context, 'auth');
  const api = await auth.getApi();
  const session = await api.getSession({ headers: headersFor(request) });
  const gate = evaluateAuthGate(session?.user, '/api/v1/apps/forge/task-connection');
  if (gate) throw new TaskConnectionFailure(403, gate.code, '请先完成企业账号要求的登录验证');
  const userId = nonempty(session?.user?.id), organizationId = nonempty(session?.session?.activeOrganizationId);
  const sessionId = nonempty(session?.session?.id);
  const expiresAt = Date.parse(String(session?.session?.expiresAt ?? ''));
  if (!userId || !organizationId || !sessionId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new TaskConnectionFailure(401, 'UNAUTHENTICATED', '请重新登录');
  }
  // A live login alone does not retain organization access after membership ends.
  const actor = await currentNativeActor(context, userId, organizationId);
  return { userId, organizationId, sessionId, expiresAt, auth, api, actor };
}

export async function currentNativeActor(context: PluginContext, userId: string, organizationId: string): Promise<ExecutionContext> {
  const engine = service<IObjectQLEngine>(context, 'objectql');
  const user = await engine.findOne('sys_user', { where: { id: userId }, fields: ['id', 'banned', 'ban_expires'] }, { context: SYSTEM_READ });
  if (!user || user.banned === true && (!user.ban_expires || Date.parse(String(user.ban_expires)) > Date.now())) {
    throw new TaskConnectionFailure(401, 'FORGE_TASK_SUBJECT_INACTIVE', '员工身份已失效');
  }
  const grants = await resolveUserAuthzGrants(engine, userId, { tenantId: organizationId, bypassGrantsCache: true });
  if (!grants.accessible_org_ids.includes(organizationId)) {
    throw new TaskConnectionFailure(403, 'FORGE_TASK_ORGANIZATION_FORBIDDEN', '当前员工已无权访问此组织');
  }
  return { userId, tenantId: organizationId, positions: grants.positions, permissions: grants.permissions,
    systemPermissions: grants.systemPermissions, tabPermissions: grants.tabPermissions, posture: grants.posture,
    org_user_ids: grants.org_user_ids, accessible_org_ids: grants.accessible_org_ids, isSystem: false };
}
