import type { Plugin, PluginContext } from '@objectstack/core';
import { makeExecutionContextResolver } from '@objectstack/plugin-hono-server';
import type { IHttpRequest, IHttpResponse, IHttpServer, IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { EmitInput, MessagingService } from '@objectstack/service-messaging';

const EVENT_PATH = '/api/v1/apps/forge/weave-events/team-runs';
const SOURCE_PATH = '/api/v1/workbench/notifications/:notificationId/source';
const EVENT_SECRET_ENV = 'FORGE_WEAVE_EVENT_SECRET';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NATIVE_NOTIFICATION_ID = /^[A-Za-z0-9_-]{12,128}$/;
const EVENT_KINDS = new Set(['result', 'failure', 'revision_required', 'cancelled']);
const SYSTEM_CONTEXT: ExecutionContext = { isSystem: true, positions: [], permissions: [] };

function sessionHeaders(headers: IHttpRequest['headers']): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (Array.isArray(value)) for (const part of value) result.append(name, part);
    else result.set(name, value);
  }
  return result;
}

async function sourceError(response: IHttpResponse, status: number, code: string): Promise<void> {
  response.header('Cache-Control', 'no-store');
  await response.status(status).json({ error: { code } });
}

function eventPayload(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try { return eventPayload(JSON.parse(value)); } catch { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

interface TeamRunEvent {
  version: '1';
  eventId: string;
  kind: 'result' | 'failure' | 'revision_required' | 'cancelled';
  organizationId: string;
  assigneeAccountId: string;
  title: string;
  summary: string;
  occurredAt: string;
  actionUrl?: string;
  source: {
    workReference: string;
    runReference: string;
    sessionReference: string;
    idempotencyKey: string;
  };
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max && !normalized.includes('\0') ? normalized : null;
}

function parseTeamRunEvent(value: unknown): TeamRunEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const source = event.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const sourceRecord = source as Record<string, unknown>;
  const eventId = boundedString(event.eventId, 64);
  const kind = boundedString(event.kind, 64);
  const organizationId = boundedString(event.organizationId, 128);
  const assigneeAccountId = boundedString(event.assigneeAccountId, 128);
  const title = boundedString(event.title, 300);
  const summary = boundedString(event.summary, 4000);
  const occurredAt = boundedString(event.occurredAt, 64);
  const actionUrl = event.actionUrl === undefined ? undefined : boundedString(event.actionUrl, 1024);
  const workReference = boundedString(sourceRecord.workReference, 512);
  const runReference = boundedString(sourceRecord.runReference, 512);
  const sessionReference = boundedString(sourceRecord.sessionReference, 512);
  const idempotencyKey = boundedString(sourceRecord.idempotencyKey, 256);
  if (event.version !== '1' || !eventId || !UUID.test(eventId) || !kind || !EVENT_KINDS.has(kind) ||
      !organizationId || !assigneeAccountId || !title || !summary || !occurredAt ||
      !Number.isFinite(Date.parse(occurredAt)) || event.actionUrl !== undefined && !actionUrl ||
      !workReference || !runReference || !sessionReference || !idempotencyKey) return null;
  return {
    version: '1', eventId, kind: kind as TeamRunEvent['kind'], organizationId,
    assigneeAccountId, title, summary, occurredAt, ...(actionUrl ? { actionUrl } : {}),
    source: { workReference, runReference, sessionReference, idempotencyKey },
  };
}

async function authorized(headers: Record<string, string | string[]>, expected: string): Promise<boolean> {
  const raw = headers.authorization ?? headers.Authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!expected || typeof value !== 'string' || !value.startsWith('Bearer ')) return false;
  const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const [supplied, secret] = await Promise.all([digest(value.slice(7)), digest(expected)]);
  let difference = supplied.length ^ secret.length;
  for (let index = 0; index < Math.max(supplied.length, secret.length); index += 1) {
    difference |= (supplied[index] ?? 0) ^ (secret[index] ?? 0);
  }
  return difference === 0;
}

function severity(kind: TeamRunEvent['kind']): 'info' | 'warning' | 'critical' {
  if (kind === 'failure') return 'critical';
  if (kind === 'revision_required' || kind === 'cancelled') return 'warning';
  return 'info';
}

export class WeaveRunEventPlugin implements Plugin {
  name = 'com.inocube.forge.weave-run-events';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.service.messaging'];

  init(ctx: PluginContext): void {
    ctx.hook('kernel:ready', () => {
      const readServer = (name: string): IHttpServer | null => {
        try { return ctx.getService<IHttpServer>(name); } catch { return null; }
      };
      const server = readServer('http.server') ?? readServer('http-server');
      if (!server) {
        ctx.logger.error('[weave-run-events] HTTP service unavailable; ingress route was not mounted');
        return;
      }
      const messaging = ctx.getService<MessagingService>('messaging');
      const resolveContext = makeExecutionContextResolver(ctx);
      server.get(SOURCE_PATH, async (req, res) => {
        res.header('Cache-Control', 'no-store');
        const actor = await resolveContext({ req: { raw: { headers: sessionHeaders(req.headers) } } });
        if (!actor?.userId) return sourceError(res, 401, 'UNAUTHENTICATED');
        const notificationId = boundedString(req.params?.notificationId, 128);
        if (!notificationId || !NATIVE_NOTIFICATION_ID.test(notificationId)) return sourceError(res, 404, 'TEAM_MESSAGE_NOT_FOUND');
        let engine: IObjectQLEngine | null = null;
        try { engine = ctx.getService<IObjectQLEngine>('objectql'); } catch { /* unavailable */ }
        if (!engine) return sourceError(res, 503, 'TEAM_MESSAGE_UNAVAILABLE');
        try {
          const inbox = await engine.find('sys_inbox_message', {
            where: { notification_id: notificationId, user_id: actor.userId },
            fields: ['notification_id', 'user_id', 'organization_id', 'topic'],
            limit: 2,
          }, { context: SYSTEM_CONTEXT });
          if (!inbox.length || inbox.some((row) => row.user_id !== actor.userId ||
              row.notification_id !== notificationId ||
              !boundedString(row.topic, 128)?.startsWith('weave.team_run.') ||
              row.topic !== inbox[0].topic ||
              row.organization_id !== inbox[0].organization_id)) {
            return sourceError(res, 404, 'TEAM_MESSAGE_NOT_FOUND');
          }
          const notice = await engine.findOne('sys_notification', {
            where: { id: notificationId },
            fields: ['id', 'topic', 'organization_id', 'payload'],
          }, { context: SYSTEM_CONTEXT });
          if (!notice || notice.id !== notificationId || notice.topic !== inbox[0].topic ||
              notice.organization_id !== inbox[0].organization_id) {
            return sourceError(res, 404, 'TEAM_MESSAGE_NOT_FOUND');
          }
          const event = eventPayload(eventPayload(notice.payload)?.weaveEvent);
          const kind = boundedString(event?.kind, 64);
          const workReference = boundedString(event?.workReference, 512);
          const runReference = boundedString(event?.runReference, 512);
          const sessionReference = boundedString(event?.sessionReference, 512);
          if (event?.version !== '1' || !kind || !EVENT_KINDS.has(kind) ||
              notice.topic !== `weave.team_run.${kind}` ||
              !workReference || !runReference || !sessionReference) {
            return sourceError(res, 404, 'TEAM_MESSAGE_NOT_FOUND');
          }
          await res.status(200).json({
            version: '1', notificationId, kind,
            source: { system: 'weave', workReference, runReference, sessionReference },
          });
        } catch {
          ctx.logger.error('[weave-run-events] failed to read an owned team message source');
          await sourceError(res, 503, 'TEAM_MESSAGE_UNAVAILABLE');
        }
      });
      server.post(EVENT_PATH, async (req, res) => {
        const secret = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[EVENT_SECRET_ENV]?.trim() ?? '';
        if (!secret) {
          await res.status(503).json({ error: { code: 'WEAVE_EVENT_INGRESS_UNAVAILABLE', message: 'Team run event ingress is unavailable' } });
          return;
        }
        if (!await authorized(req.headers, secret)) {
          await res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Service authentication required' } });
          return;
        }
        const event = parseTeamRunEvent(req.body);
        if (!event) {
          await res.status(400).json({ error: { code: 'INVALID_TEAM_RUN_EVENT', message: 'Team run event is invalid' } });
          return;
        }
        const topic = `weave.team_run.${event.kind}`;
        const input: EmitInput = {
          topic,
          audience: event.assigneeAccountId,
          organizationId: event.organizationId,
          dedupKey: event.source.idempotencyKey,
          severity: severity(event.kind),
          channels: ['inbox'],
          payload: {
            title: event.title,
            body: event.summary,
            ...(event.actionUrl ? { actionUrl: event.actionUrl } : {}),
            weaveEvent: {
              version: event.version,
              eventId: event.eventId,
              kind: event.kind,
              occurredAt: event.occurredAt,
              workReference: event.source.workReference,
              runReference: event.source.runReference,
              sessionReference: event.source.sessionReference,
            },
          },
        };
        try {
          const result = await messaging.emit(input);
          await res.status(result.deduped ? 200 : 202).json({
            eventId: event.eventId,
            notificationId: result.notificationId,
            deduped: result.deduped,
            accepted: result.deduped || result.enqueued > 0 || result.delivered > 0,
          });
        } catch (error) {
          ctx.logger.error('[weave-run-events] event ingestion failed', error instanceof Error ? error : new Error(String(error)));
          await res.status(500).json({ error: { code: 'WEAVE_EVENT_INGRESS_FAILED', message: 'Team run event was not accepted' } });
        }
      });
    });
  }
}

export { EVENT_PATH, parseTeamRunEvent };
