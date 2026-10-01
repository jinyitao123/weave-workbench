import type { Plugin, PluginContext } from '@objectstack/core';
import type { IObjectQLEngine, IHttpRequest, IHttpResponse, IHttpServer } from '@objectstack/spec/contracts';
import { SYSTEM_READ, TaskConnectionFailure, nativeEmployee, nonempty, service, verifyNativeConnection } from './native-task-auth.js';

const ROUTE = '/api/v1/apps/forge/workbench/inbox';
const READ_STATES = new Set(['read', 'clicked', 'dismissed']);
type Row = Record<string, unknown>;
interface Position { created_at: string; id: string }

function position(row: Row): Position {
  const id = nonempty(row.id);
  const milliseconds = row.created_at instanceof Date ? row.created_at.getTime() : Date.parse(String(row.created_at ?? ''));
  if (!id || !Number.isFinite(milliseconds)) throw new TaskConnectionFailure(503, 'INBOX_PAGE_INVALID', '消息列表暂不可完整读取');
  return { created_at: new Date(milliseconds).toISOString(), id };
}

function before(point: Position, inclusive: boolean) {
  return { $or: [
    { created_at: { $lt: point.created_at } },
    { created_at: point.created_at, id: { [inclusive ? '$lte' : '$lt']: point.id } },
  ] };
}

function cursorPosition(value: unknown): Position {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskConnectionFailure(400, 'INBOX_CURSOR_INVALID', '消息分页信息无效，请刷新');
  const item = value as Row;
  if (typeof item.created_at !== 'string' || !nonempty(item.id) || !Number.isFinite(Date.parse(item.created_at))) {
    throw new TaskConnectionFailure(400, 'INBOX_CURSOR_INVALID', '消息分页信息无效，请刷新');
  }
  return { created_at: item.created_at, id: item.id as string };
}

export async function readNativeInboxPage(context: PluginContext, request: IHttpRequest) {
  const employee = await nativeEmployee(context, request);
  const engine = service<IObjectQLEngine>(context, 'objectql');
  const rawLimit = request.query?.limit ?? '100';
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new TaskConnectionFailure(400, 'INBOX_LIMIT_INVALID', '消息分页大小无效');
  const issuer = employee.auth.getAuthIssuer();
  const audience = new URL(ROUTE, new URL(issuer).origin).toString();
  const cursor = request.query?.cursor;
  let anchor: Position | undefined, after: Position | undefined;
  if (cursor !== undefined) {
    if (!nonempty(cursor, 8192)) throw new TaskConnectionFailure(400, 'INBOX_CURSOR_INVALID', '消息分页信息无效，请刷新');
    const payload = await verifyNativeConnection(employee.api, String(cursor), issuer, audience).catch(() => null);
    if (!payload || payload.kind !== 'forge_inbox_cursor_v1' || payload.aud !== audience ||
        payload.sub !== employee.userId || payload.organization_id !== employee.organizationId) {
      throw new TaskConnectionFailure(400, 'INBOX_CURSOR_INVALID', '消息分页信息已失效，请刷新');
    }
    anchor = cursorPosition(payload.anchor);
    after = cursorPosition(payload.after);
  }
  const orgScope = { $or: [{ organization_id: employee.organizationId }, { organization_id: { $null: true } }] };
  const clauses: unknown[] = [{ user_id: employee.userId }, orgScope];
  if (anchor) clauses.push(before(anchor, true));
  if (after) clauses.push(before(after, false));
  const rows = await engine.find('sys_inbox_message', {
    where: { $and: clauses }, fields: ['id', 'user_id', 'organization_id', 'notification_id', 'topic', 'title', 'body_md', 'action_url', 'created_at'],
    orderBy: [{ field: 'created_at', order: 'desc' }, { field: 'id', order: 'desc' }], limit: limit + 1,
  }, { context: SYSTEM_READ });
  if (rows.some((row) => row.user_id !== employee.userId || row.organization_id != null && row.organization_id !== employee.organizationId)) {
    throw new TaskConnectionFailure(503, 'INBOX_PAGE_INVALID', '消息列表暂不可完整读取');
  }
  const page = rows.slice(0, limit), hasMore = rows.length > limit;
  if (!anchor && page.length) anchor = position(page[0]);
  const ids = [...new Set(page.map((row) => nonempty(row.notification_id)).filter((id): id is string => !!id))];
  const receipts = ids.length ? await engine.find('sys_notification_receipt', {
    where: { $and: [{ user_id: employee.userId, channel: 'inbox', notification_id: { $in: ids } }, orgScope] },
    fields: ['notification_id', 'user_id', 'organization_id', 'channel', 'state'], limit: ids.length + 1,
  }, { context: SYSTEM_READ }) : [];
  const stateById = new Map<string, string>();
  for (const receipt of receipts) {
    const id = nonempty(receipt.notification_id);
    if (!id || !ids.includes(id) || receipt.user_id !== employee.userId || receipt.channel !== 'inbox' || stateById.has(id) ||
        receipt.organization_id != null && receipt.organization_id !== employee.organizationId) {
      throw new TaskConnectionFailure(503, 'INBOX_RECEIPT_INVALID', '消息读取状态暂不可完整核对');
    }
    stateById.set(id, String(receipt.state));
  }
  let next: string | null = null;
  if (hasMore && anchor && page.length) {
    const now = Math.floor(Date.now() / 1000);
    next = (await employee.api.signJWT({ body: { payload: {
      kind: 'forge_inbox_cursor_v1', sub: employee.userId, organization_id: employee.organizationId,
      aud: audience, iss: issuer, iat: now, exp: now + 900, anchor, after: position(page[page.length - 1]),
    } } })).token;
  }
  return { version: '1', notifications: page.map((row) => ({
    id: nonempty(row.notification_id) ?? String(row.id), type: String(row.topic ?? 'notification'),
    title: String(row.title ?? ''), body: String(row.body_md ?? ''),
    read: READ_STATES.has(stateById.get(String(row.notification_id)) ?? ''),
    ...(row.action_url ? { actionUrl: String(row.action_url) } : {}), createdAt: position(row).created_at,
  })), next_cursor: next, has_more: hasMore };
}

function failure(response: IHttpResponse, error: unknown) {
  const known = error instanceof TaskConnectionFailure;
  return response.status(known ? error.status : 503).json({ error: {
    code: known ? error.code : 'INBOX_PAGE_UNAVAILABLE', message: known ? error.message : '消息列表暂不可完整读取',
  } });
}

/** Only fills the verified missing page door; all rows and read state stay native. */
export class WorkbenchInboxPlugin implements Plugin {
  name = 'com.inocube.forge.workbench-inbox-page';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.auth', 'com.objectstack.service.messaging'];
  init(context: PluginContext): void {
    context.hook('kernel:ready', () => {
      const server = service<IHttpServer>(context, 'http.server');
      server.get(ROUTE, async (request, response) => {
        response.header('Cache-Control', 'private, no-store');
        try { await response.status(200).json(await readNativeInboxPage(context, request)); }
        catch (error) {
          context.logger.error('[workbench-inbox] owned inbox page could not be completely read');
          await failure(response, error);
        }
      });
    });
  }
}
