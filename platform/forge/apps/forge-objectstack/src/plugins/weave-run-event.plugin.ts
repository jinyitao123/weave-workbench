import type { Plugin, PluginContext } from '@objectstack/core';
import type { IHttpServer } from '@objectstack/spec/contracts';
import type { EmitInput, MessagingService } from '@objectstack/service-messaging';

const EVENT_PATH = '/api/v1/apps/forge/weave-events/team-runs';
const EVENT_SECRET_ENV = 'FORGE_WEAVE_EVENT_SECRET';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_KINDS = new Set(['result', 'failure', 'revision_required', 'cancelled']);

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
