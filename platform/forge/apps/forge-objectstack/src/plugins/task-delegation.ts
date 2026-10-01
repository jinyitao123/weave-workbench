// Decision 002 (weave-workbench): pure scope logic for Forge-issued task
// delegations. The plugin wires these checks into three guards (entry, action,
// data); keeping them here makes the rules testable without a runtime.

export const TASK_DELEGATION_OBJECT = 'forge_task_delegation';
export const DEFAULT_MAX_HOURS = 24;

const OBJECT_NAME = /^[a-z][a-z0-9_]{1,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ACTIONS = 32;
const MAX_FILES = 10;

export interface ScopedAction { objectName: string; actionName: string }
export interface ScopedRecord { objectName: string; recordId: string }
export interface ScopedFile { fileId: string; sha256: string; sourceKind: 'owner' | 'approval'; requestId?: string }

export interface DelegationScope {
  actions: ScopedAction[];
  record?: ScopedRecord;
  files: ScopedFile[];
}

export interface IssueRequest extends DelegationScope {
  idempotencyKey: string;
  inputDigest: string;
}

/** A live delegation as the guards see it. */
export interface ActiveDelegation extends DelegationScope {
  delegationId: string;
  organizationId: string;
  employeeId: string;
  expiresAt: number;
  revoked: boolean;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; code: string };

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result && result.length <= max && !result.includes('\0') ? result : undefined;
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseScope(body: Record<string, unknown>): ParseResult<DelegationScope> {
  if (!Array.isArray(body.actions) || body.actions.length > MAX_ACTIONS) return { ok: false, code: 'DELEGATION_SCOPE_INVALID' };
  const actions: ScopedAction[] = [];
  for (const item of body.actions) {
    const value = record(item);
    const objectName = text(value?.objectName, 128), actionName = text(value?.actionName, 128);
    if (!value || !exactKeys(value, ['objectName', 'actionName']) || !objectName || !OBJECT_NAME.test(objectName) || !actionName) {
      return { ok: false, code: 'DELEGATION_SCOPE_INVALID' };
    }
    if (actions.some((existing) => existing.objectName === objectName && existing.actionName === actionName)) {
      return { ok: false, code: 'DELEGATION_SCOPE_INVALID' };
    }
    actions.push({ objectName, actionName });
  }
  let scopedRecord: ScopedRecord | undefined;
  if (body.record !== undefined) {
    const value = record(body.record);
    const objectName = text(value?.objectName, 128), recordId = text(value?.recordId, 128);
    if (!value || !exactKeys(value, ['objectName', 'recordId']) || !objectName || !OBJECT_NAME.test(objectName) || !recordId) {
      return { ok: false, code: 'DELEGATION_SCOPE_INVALID' };
    }
    scopedRecord = { objectName, recordId };
  }
  if (!Array.isArray(body.files) || body.files.length > MAX_FILES) return { ok: false, code: 'DELEGATION_SCOPE_INVALID' };
  const files: ScopedFile[] = [];
  for (const item of body.files) {
    const value = record(item);
    const fileId = text(value?.fileId, 128), sha256 = text(value?.sha256, 64)?.toLowerCase();
    const sourceKind = value?.sourceKind;
    const requestId = value?.requestId === undefined ? undefined : text(value.requestId, 128);
    if (!value || !exactKeys(value, ['fileId', 'sha256', 'sourceKind', 'requestId']) || !fileId || !sha256 || !SHA256.test(sha256) ||
        (sourceKind !== 'owner' && sourceKind !== 'approval') ||
        (sourceKind === 'approval') !== (requestId !== undefined) || (value.requestId !== undefined && !requestId) ||
        files.some((existing) => existing.fileId === fileId)) {
      return { ok: false, code: 'DELEGATION_SCOPE_INVALID' };
    }
    files.push({ fileId, sha256, sourceKind, ...(requestId ? { requestId } : {}) });
  }
  return { ok: true, value: { actions, ...(scopedRecord ? { record: scopedRecord } : {}), files } };
}

export function parseIssueRequest(input: unknown): ParseResult<IssueRequest> {
  const body = record(input);
  if (!body || body.version !== '1' || !exactKeys(body, ['version', 'idempotencyKey', 'inputDigest', 'actions', 'record', 'files'])) {
    return { ok: false, code: 'DELEGATION_REQUEST_INVALID' };
  }
  const idempotencyKey = text(body.idempotencyKey, 64);
  const inputDigest = text(body.inputDigest, 64)?.toLowerCase();
  if (!idempotencyKey || !UUID.test(idempotencyKey) || !inputDigest || !SHA256.test(inputDigest)) {
    return { ok: false, code: 'DELEGATION_REQUEST_INVALID' };
  }
  const scope = parseScope(body);
  if (!scope.ok) return scope;
  return { ok: true, value: { idempotencyKey: idempotencyKey.toLowerCase(), inputDigest, ...scope.value } };
}

/** Serialized scope stored on the ledger; parsing is strict so a corrupt row fails closed. */
export function encodeScope(scope: DelegationScope): string {
  return JSON.stringify({ actions: scope.actions, ...(scope.record ? { record: scope.record } : {}), files: scope.files });
}

export function decodeScope(value: unknown): DelegationScope | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = parseScope(JSON.parse(value) as Record<string, unknown>);
    return parsed.ok ? parsed.value : undefined;
  } catch { return undefined; }
}

export function sameScope(left: DelegationScope, right: DelegationScope): boolean {
  return encodeScope(left) === encodeScope(right);
}

/**
 * Declared action metadata the guard needs. Handler keys follow ObjectStack's
 * `resolveActionHandlerKeys`: a declaration dispatches through `target` and
 * `name`, so both identify the same declared action.
 */
export interface DeclaredAction { name: string; objectName: string; target?: string; type?: string; ai?: { exposed?: boolean } }

export function delegableActions(declarations: Iterable<unknown>): Map<string, DeclaredAction> {
  const result = new Map<string, DeclaredAction>();
  for (const value of declarations) {
    const action = record(value) as DeclaredAction | undefined;
    if (!action || typeof action.name !== 'string' || typeof action.objectName !== 'string') continue;
    // Flow actions bypass the ObjectQL handler seam, so the action guard could
    // not see them; they are never delegable.
    if (action.ai?.exposed !== true || action.type === 'flow') continue;
    result.set(`${action.objectName}:${action.name}`, action);
  }
  return result;
}

export function actionAllowed(
  delegation: Pick<ActiveDelegation, 'actions' | 'record'>, declared: Map<string, DeclaredAction>,
  objectName: string, handlerKey: string, recordId: string | undefined,
): boolean {
  const permitted = delegation.actions.some((scoped) => {
    if (scoped.objectName !== objectName) return false;
    const action = declared.get(`${scoped.objectName}:${scoped.actionName}`);
    return !!action && (handlerKey === action.name || handlerKey === action.target);
  });
  if (!permitted) return false;
  if (recordId === undefined) return true;
  return delegation.record?.objectName === objectName && delegation.record.recordId === recordId;
}

/**
 * Paths a task credential may call. Everything else is refused before any
 * route runs. File routes are further limited to the delegated files.
 */
export function entryAllowed(
  delegation: Pick<ActiveDelegation, 'delegationId' | 'files'>, method: string, path: string,
): boolean {
  const verb = method.toUpperCase();
  const clean = path.split('?')[0]!.replace(/\/+$/, '');
  if (clean === '/api/v1/mcp') return true;
  // Weave verifies the credential through the session and permission reads.
  if (verb === 'GET' && (clean === '/api/v1/auth/me/permissions' || clean === '/api/v1/auth/get-session')) return true;
  if (verb === 'GET' && /^\/api\/v1\/meta\/objects?\/[a-z][a-z0-9_]{1,127}$/.test(clean)) return true;
  if (verb === 'DELETE' && clean === `/api/v1/workbench/task-delegations/${delegation.delegationId}`) return true;
  if (verb !== 'GET') return false;
  // Weave also verifies frozen text materials through the native storage route.
  const owned = /^\/api\/v1\/(?:workbench\/materials\/([^/]+)(?:\/original)?|storage\/files\/([^/]+))$/.exec(clean);
  if (owned) {
    const fileId = decodeURIComponent((owned[1] ?? owned[2])!);
    return delegation.files.some((file) => file.sourceKind === 'owner' && file.fileId === fileId);
  }
  const approval = /^\/api\/v1\/approvals\/requests\/([^/]+)\/(?:workbench-context|workbench-history)\/files\/([^/]+)\/original$/.exec(clean);
  if (approval) {
    const requestId = decodeURIComponent(approval[1]!), fileId = decodeURIComponent(approval[2]!);
    return delegation.files.some((file) => file.sourceKind === 'approval' && file.fileId === fileId && file.requestId === requestId);
  }
  return false;
}

export function bearerToken(headers: Record<string, string | string[] | undefined> | undefined): string | undefined {
  const match = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === 'authorization')?.[1];
  const value = Array.isArray(match) ? match[0] : match;
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return undefined;
  const token = value.slice(7).trim();
  return token && token.length <= 4096 ? token : undefined;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}

export function maxLifetimeMs(raw: string | undefined): number {
  const hours = raw === undefined || raw.trim() === '' ? DEFAULT_MAX_HOURS : Number(raw);
  if (!Number.isFinite(hours) || hours <= 0 || hours > DEFAULT_MAX_HOURS) return DEFAULT_MAX_HOURS * 60 * 60 * 1000;
  return Math.round(hours * 60 * 60 * 1000);
}

/**
 * Resolves bearer tokens to live delegations. Desktop tokens are remembered
 * as "not a task credential" (a task token is always issued before its first
 * use, so a negative answer never becomes wrong); positive answers are kept
 * briefly and dropped on revoke in this process. Revocation in another
 * process is still enforced natively because the session row is deleted.
 */
export class DelegationRegistry {
  private readonly negative = new Map<string, true>();
  private readonly positive = new Map<string, { value: ActiveDelegation | null; until: number }>();

  constructor(
    private readonly load: (tokenSha256: string) => Promise<ActiveDelegation | null>,
    private readonly now: () => number = () => Date.now(),
    private readonly positiveTtlMs = 30_000,
    private readonly negativeLimit = 5_000,
  ) {}

  /** `null` = not a task credential; an ActiveDelegation may be revoked or expired. */
  async lookup(tokenSha256: string): Promise<ActiveDelegation | null> {
    if (this.negative.has(tokenSha256)) return null;
    const cached = this.positive.get(tokenSha256);
    if (cached && cached.until > this.now()) return cached.value;
    const value = await this.load(tokenSha256);
    if (!value) {
      if (this.negative.size >= this.negativeLimit) this.negative.delete(this.negative.keys().next().value!);
      this.negative.set(tokenSha256, true);
      return null;
    }
    this.positive.set(tokenSha256, { value, until: this.now() + this.positiveTtlMs });
    return value;
  }

  /** Mark a freshly issued token as a task credential before its first use. */
  remember(tokenSha256: string, value: ActiveDelegation): void {
    this.negative.delete(tokenSha256);
    this.positive.set(tokenSha256, { value, until: this.now() + this.positiveTtlMs });
  }

  forget(tokenSha256: string): void {
    this.positive.delete(tokenSha256);
  }
}

export function isLive(delegation: ActiveDelegation, now: number): boolean {
  return !delegation.revoked && delegation.expiresAt > now;
}
