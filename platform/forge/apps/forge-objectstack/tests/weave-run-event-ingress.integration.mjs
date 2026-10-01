import assert from 'node:assert/strict';
import test from 'node:test';
import { WeaveRunEventPlugin } from '../src/plugins/weave-run-event.plugin.ts';

// Decision 002 / C24: the same idempotency key with different content is a
// conflict, the assignee must belong to the organization, and human_review
// events carry the Weave interaction reference end to end.
const SECRET = 'ingress-test-secret';

function event(overrides = {}) {
  const base = {
    version: '1', eventId: '0b5a2d0e-2c4f-5e7a-8b1c-0d2e3f4a5b6c', kind: 'result',
    organizationId: 'org-a', assigneeAccountId: 'employee-a', title: '团队运行已完成：合同检查', summary: '平台回执：本轮 Forge 业务动作调用记录为 0 条。',
    occurredAt: '2026-10-01T08:00:00.000Z',
    source: { workReference: 'work-a', runReference: 'run-a', sessionReference: 'session-a', idempotencyKey: 'run-a:succeeded' },
  };
  return { ...base, ...overrides, source: { ...base.source, ...(overrides.source ?? {}) } };
}

function harness() {
  const routes = new Map();
  const notifications = new Map();
  const byKey = new Map();
  const engine = {
    async find() { return []; },
    async findOne(objectName, query) {
      if (objectName === 'sys_member') {
        return query.where.user_id === 'employee-a' && query.where.organization_id === 'org-a' ? { id: 'member-a' } : null;
      }
      if (objectName === 'sys_notification') return notifications.get(query.where.id) ?? null;
      return null;
    },
  };
  const messaging = {
    async emit(input) {
      const existing = byKey.get(input.dedupKey);
      if (existing) return { notificationId: existing, deduped: true, enqueued: 0, delivered: 0 };
      const id = `N${String(notifications.size + 1).padStart(15, '0')}`;
      notifications.set(id, { id, topic: input.topic, organization_id: input.organizationId, payload: input.payload });
      byKey.set(input.dedupKey, id);
      return { notificationId: id, deduped: false, enqueued: 1, delivered: 0 };
    },
  };
  let ready;
  const ctx = {
    hook(name, callback) { if (name === 'kernel:ready') ready = callback; },
    getService(name) {
      const services = {
        'http.server': { get(path, handler) { routes.set(`GET ${path}`, handler); }, post(path, handler) { routes.set(`POST ${path}`, handler); } },
        messaging, objectql: engine,
        auth: { api: { async getSession() { return null; } } },
      };
      if (!(name in services)) throw new Error(`missing service ${name}`);
      return services[name];
    },
    logger: { error() {} },
  };
  new WeaveRunEventPlugin().init(ctx);
  ready();
  return {
    notifications,
    async post(body) {
      const handler = routes.get('POST /api/v1/apps/forge/weave-events/team-runs');
      let status = 200;
      let value;
      await handler({ headers: { authorization: `Bearer ${SECRET}` }, body }, {
        header() { return this; }, status(code) { status = code; return this; }, json(data) { value = data; return this; },
      });
      return { status, value };
    },
  };
}

test('team run event ingress detects same-key content conflicts and validates the assignee', async (t) => {
  process.env.FORGE_WEAVE_EVENT_SECRET = SECRET;
  t.after(() => { delete process.env.FORGE_WEAVE_EVENT_SECRET; });
  const h = harness();

  const first = await h.post(event());
  assert.equal(first.status, 202);
  const stored = [...h.notifications.values()][0];
  assert.match(stored.payload.weaveEvent.digest, /^[0-9a-f]{64}$/, 'the canonical event digest is stored with the native notification');

  const repeated = await h.post(event());
  assert.equal(repeated.status, 200, 'the same event is an idempotent duplicate');
  assert.equal(repeated.value.deduped, true);

  const changed = await h.post(event({ summary: '另一份摘要' }));
  assert.equal(changed.status, 409, 'the same key with different content is a conflict');
  assert.equal(changed.value.error.code, 'TEAM_RUN_EVENT_CONFLICT');

  const stranger = await h.post(event({ assigneeAccountId: 'employee-z', source: { idempotencyKey: 'run-z:succeeded' } }));
  assert.equal(stranger.status, 422, 'an assignee outside the organization is refused');
  assert.equal(h.notifications.size, 1);
});

test('human_review events require and keep the interaction reference', async (t) => {
  process.env.FORGE_WEAVE_EVENT_SECRET = SECRET;
  t.after(() => { delete process.env.FORGE_WEAVE_EVENT_SECRET; });
  const h = harness();
  const missing = await h.post(event({ kind: 'human_review', source: { idempotencyKey: 'run-a:human:1' } }));
  assert.equal(missing.status, 400, 'human_review without an interaction reference is invalid');
  const stray = await h.post(event({ source: { idempotencyKey: 'run-a:other', interactionReference: 'interaction-1' } }));
  assert.equal(stray.status, 400, 'only human_review carries an interaction reference');
  const accepted = await h.post(event({ kind: 'human_review', title: '团队运行等待人工处理：合同检查', source: { idempotencyKey: 'run-a:human:1', interactionReference: 'interaction-1' } }));
  assert.equal(accepted.status, 202);
  const stored = [...h.notifications.values()][0];
  assert.equal(stored.topic, 'weave.team_run.human_review');
  assert.equal(stored.payload.weaveEvent.interactionReference, 'interaction-1');
});
