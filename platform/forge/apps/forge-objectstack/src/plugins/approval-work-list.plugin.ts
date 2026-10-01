import type { Plugin, PluginContext } from '@objectstack/core';
import { makeExecutionContextResolver } from '@objectstack/plugin-hono-server';
import type { IApprovalService, IHttpRequest, IHttpResponse, IHttpServer } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';

const ROUTE = '/api/v1/workbench/approvals';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type Phase = 'pending' | 'returned';
interface Cursor { phase: Phase; offset: number }
type Row = Record<string, unknown> & { id: string; status: string };

interface WorkItem {
  requestId: string;
  mode: 'approval' | 'revision';
  title: string;
  processLabel?: string;
  stepLabel?: string;
  materialLabel?: string;
  returnReason?: string;
  updatedAt: string;
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

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result && !result.includes('\0') ? result.slice(0, max) : undefined;
}

function queryValue(value: unknown): string | undefined {
  return Array.isArray(value) ? text(value[0], 512) : text(value, 512);
}

export function encodeCursor(cursor: Cursor): string {
  // The cursor is ASCII JSON, so plain base64 is enough; made URL-safe.
  return btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(value: string | undefined): Cursor | undefined | null {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/'))) as Partial<Cursor>;
    if ((parsed.phase === 'pending' || parsed.phase === 'returned') && Number.isSafeInteger(parsed.offset) && parsed.offset! >= 0) {
      return { phase: parsed.phase, offset: parsed.offset! };
    }
  } catch { /* invalid cursor */ }
  return null;
}

/** A return is still open only when no resubmit follows the latest revise. */
export function latestOpenReturn(actions: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
  let latestReturn = -1;
  let latestResubmit = -1;
  actions.forEach((action, index) => {
    if (action.action === 'revise') latestReturn = index;
    if (action.action === 'resubmit') latestResubmit = index;
  });
  return latestReturn >= 0 && latestResubmit < latestReturn ? actions[latestReturn] : undefined;
}

function updatedAt(row: Row): string | undefined {
  const value = row.updated_at ?? row.created_at;
  const time = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

export function workItem(row: Row, mode: WorkItem['mode'], returnReason?: string): WorkItem | undefined {
  const time = updatedAt(row);
  if (!time) return undefined;
  // Labels come from the native service; machine names are never shown.
  const processLabel = text(row.process_label, 160);
  const stepLabel = text(row.step_label, 160);
  const recordTitle = text(row.record_title, 200);
  const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : undefined;
  const materialLabel = text(payload?.submitted_material_name, 255) ?? text(row.object_label, 255);
  const base = recordTitle ?? processLabel ?? '业务审批';
  const title = mode === 'revision' ? `${base}需要修改` : recordTitle ? `${recordTitle} · ${stepLabel ?? processLabel ?? '业务审批'}` : stepLabel ?? processLabel ?? '业务审批';
  return {
    requestId: row.id, mode, title: title.slice(0, 300), updatedAt: time,
    ...(processLabel ? { processLabel } : {}), ...(stepLabel ? { stepLabel } : {}),
    ...(materialLabel ? { materialLabel } : {}), ...(returnReason ? { returnReason: returnReason.slice(0, 4000) } : {}),
  };
}

async function sendError(response: IHttpResponse, status: number, code: string): Promise<void> {
  response.header('Cache-Control', 'private, no-store');
  await response.status(status).json({ error: { code } });
}

/**
 * Decision 002: a read-only, paged projection of the employee's own native
 * approval work (pending items they can decide, returned items they submitted
 * and have not resubmitted) with the latest return comment. It stores nothing
 * and does not replace the native approval routes.
 */
export class ApprovalWorkListPlugin implements Plugin {
  name = 'com.inocube.forge.approval-work-list';
  version = '1.0.0';
  type = 'standard' as const;

  init(context: PluginContext): void {
    context.hook('kernel:ready', () => {
      const server = service<IHttpServer>(context, 'http.server') ?? service<IHttpServer>(context, 'http-server');
      if (!server) {
        context.logger.error('[approval-work-list] HTTP service unavailable; route was not mounted');
        return;
      }
      const resolveContext = makeExecutionContextResolver(context);
      server.get(ROUTE, async (request, response) => {
        response.header('Cache-Control', 'private, no-store');
        const actor = await resolveContext({ req: { raw: { headers: sessionHeaders(request.headers) } } }) as ExecutionContext | undefined;
        if (!actor?.userId) return sendError(response, 401, 'UNAUTHENTICATED');
        const cursor = decodeCursor(queryValue(request.query?.cursor));
        if (cursor === null) return sendError(response, 400, 'APPROVAL_LIST_CURSOR_INVALID');
        const limitText = queryValue(request.query?.limit);
        const limit = limitText === undefined ? DEFAULT_LIMIT : Number(limitText);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) return sendError(response, 400, 'APPROVAL_LIST_LIMIT_INVALID');
        const approvals = service<IApprovalService>(context, 'approvals');
        if (!approvals) return sendError(response, 503, 'APPROVAL_LIST_UNAVAILABLE');
        try {
          const page = await this.page(approvals, actor, cursor ?? { phase: 'pending', offset: 0 }, limit);
          await response.status(200).json({ version: '1', items: page.items, ...(page.next ? { nextCursor: encodeCursor(page.next) } : {}) });
        } catch {
          context.logger.error('[approval-work-list] native approval read failed');
          await sendError(response, 503, 'APPROVAL_LIST_UNAVAILABLE');
        }
      });
    });
  }

  private async page(approvals: IApprovalService, actor: ExecutionContext, cursor: Cursor, limit: number): Promise<{ items: WorkItem[]; next?: Cursor }> {
    const userId = String(actor.userId);
    const items: WorkItem[] = [];
    let phase = cursor.phase;
    let offset = cursor.offset;
    while (items.length < limit) {
      const want = limit - items.length;
      const rows = (phase === 'pending'
        ? await approvals.listRequests({ status: 'pending', approverId: userId, limit: want, offset }, actor)
        : await approvals.listRequests({ status: 'returned', submitterId: userId, limit: want, offset }, actor)) as unknown as Row[];
      for (const row of rows) {
        const viewer = row.viewer as { can_act?: unknown; is_submitter?: unknown } | undefined;
        if (phase === 'pending') {
          if (viewer?.can_act !== true) continue;
          const item = workItem(row, 'approval');
          if (item) items.push(item);
        } else {
          if (viewer?.is_submitter !== true) continue;
          const open = latestOpenReturn(await approvals.listActions(row.id, actor) as unknown as Array<Record<string, unknown>>);
          if (!open) continue;
          const item = workItem(row, 'revision', text(open.comment, 4000));
          if (item) items.push(item);
        }
      }
      offset += rows.length;
      if (rows.length < want) {
        if (phase === 'returned') return { items };
        phase = 'returned';
        offset = 0;
      }
    }
    return { items, next: { phase, offset } };
  }
}
