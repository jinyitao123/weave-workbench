import assert from 'node:assert/strict';
import test from 'node:test';
import { WeaveRunEventPlugin } from '../src/plugins/weave-run-event.plugin.ts';

const notificationId = '7HwSkHJU1OpbuKZN';
const source = { version: '1', kind: 'revision_required', workReference: 'work-a', runReference: 'run-a', sessionReference: 'session-a' };

function harness() {
  const routes = new Map();
  const sessions = new Map([
    ['owner', { user: { id: 'employee-a' }, session: { activeOrganizationId: 'org-a' } }],
    ['other', { user: { id: 'employee-b' }, session: { activeOrganizationId: 'org-a' } }],
    ['other-org', { user: { id: 'employee-a' }, session: { activeOrganizationId: 'org-b' } }],
  ]);
  const inbox = { notification_id: notificationId, user_id: 'employee-a', organization_id: 'org-a', topic: 'weave.team_run.revision_required' };
  const notice = { id: notificationId, organization_id: 'org-a', topic: inbox.topic, payload: { weaveEvent: source } };
  const reads = [];
  const engine = {
    async find(objectName, query, options) {
      reads.push({ objectName, query, options });
      return objectName === 'sys_inbox_message' && query.where.notification_id === notificationId && query.where.user_id === inbox.user_id ? [inbox, { ...inbox }] : [];
    },
    async findOne(objectName, query, options) {
      reads.push({ objectName, query, options });
      return objectName === 'sys_notification' && query.where.id === notificationId ? notice : null;
    },
  };
  let ready;
  const ctx = {
    hook(name, callback) { if (name === 'kernel:ready') ready = callback; },
    getKernel() { return {}; },
    getService(name) {
      const services = {
        'http.server': { get(path, handler) { routes.set(path, handler); }, post() {} },
        messaging: { emit() {} },
        objectql: engine,
        auth: { api: { async getSession({ headers }) { return sessions.get(headers.get('authorization')?.slice(7)) ?? null; } } },
      };
      if (!(name in services)) throw new Error(`missing service ${name}`);
      return services[name];
    },
    logger: { error() {} },
  };
  new WeaveRunEventPlugin().init(ctx);
  return {
    inbox, notice, reads,
    async call(token, id = notificationId) {
      ready();
      const handler = routes.get('/api/v1/workbench/notifications/:notificationId/source');
      assert.ok(handler);
      let status = 200;
      let body;
      const headers = {};
      await handler({ params: { notificationId: id }, headers: token ? { authorization: `Bearer ${token}` } : {} }, {
        header(name, value) { headers[name] = value; return this; },
        status(value) { status = value; return this; },
        json(value) { body = value; return this; },
      });
      return { status, body, headers };
    },
  };
}

test('source projection exposes exact event references only to the original employee inbox recipient', async () => {
  const h = harness();
  const result = await h.call('owner');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    version: '1', notificationId, kind: 'revision_required',
    source: { system: 'weave', workReference: 'work-a', runReference: 'run-a', sessionReference: 'session-a' },
  });
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(h.reads.filter(({ objectName }) => objectName === 'sys_inbox_message').length, 1);
  assert.equal(h.reads.find(({ objectName }) => objectName === 'sys_inbox_message').options.context.isSystem, true);
  assert.equal((await h.call('other')).status, 404);
  assert.equal((await h.call('other-org')).status, 200);
  assert.equal((await h.call()).status, 401);
  assert.equal((await h.call('owner', '7HwSkHJU1OpbuKZO')).status, 404);
});

test('source projection rejects changed native inbox link or malformed event rather than trusting message text', async () => {
  const h = harness();
  h.notice.payload.weaveEvent = { ...source, runReference: '' };
  assert.equal((await h.call('owner')).status, 404);
  h.notice.payload.weaveEvent = source;
  h.inbox.topic = 'unrelated.topic';
  assert.equal((await h.call('owner')).status, 404);
  h.inbox.topic = 'weave.team_run.revision_required';
  h.notice.organization_id = 'other-organization';
  assert.equal((await h.call('owner')).status, 404);
});
