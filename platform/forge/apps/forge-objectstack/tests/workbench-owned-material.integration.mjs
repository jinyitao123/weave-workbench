import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { WorkbenchOwnedMaterialPlugin } from '../src/plugins/workbench-owned-material.plugin.ts';

const FILE_ID = 'bd5215cf-9264-4e94-bd21-5a03aa2c63df';

function fixture() {
  const bytes = Buffer.from('这版沟通纪要只用于员工当前工作。', 'utf8');
  const file = {
    id: FILE_ID, key: 'private/key', name: '沟通纪要.md', mime_type: 'text/plain; charset=utf-8',
    size: bytes.length, status: 'committed', scope: 'user', acl: 'private',
    owner_id: 'employee-a', organization_id: 'org-a',
  };
  const sessions = new Map([
    ['employee-token', { user: { id: 'employee-a' }, session: { activeOrganizationId: 'org-a' } }],
    ['other-token', { user: { id: 'employee-b' }, session: { activeOrganizationId: 'org-a' } }],
  ]);
  const storageReads = [];
  const routes = new Map();
  let ready;
  const server = { get(path, handler) { routes.set(path, handler); } };
  const engine = {
    async findOne(objectName, query) {
      assert.equal(objectName, 'sys_file');
      return query.where.id === FILE_ID ? file : null;
    },
    async find() { return []; },
  };
  const storage = {
    async download(key) {
      storageReads.push(key);
      return Buffer.from(bytes);
    },
  };
  const context = {
    getService(name) {
      const services = {
        'http.server': server,
        auth: { api: { async getSession({ headers }) { return sessions.get(headers.get('authorization')?.slice(7)) ?? null; } } },
        objectql: engine,
        storage,
      };
      if (!(name in services)) throw new Error('service unavailable');
      return services[name];
    },
    getKernel() { return {}; },
    hook(name, handler) { if (name === 'kernel:ready') ready = handler; },
    logger: { error() {} },
  };
  new WorkbenchOwnedMaterialPlugin().init(context);
  return {
    file, bytes, storageReads,
    async call(token, extraHeaders = {}) {
      await ready();
      const handler = routes.get('/api/v1/workbench/materials/:fileId');
      assert.ok(handler);
      let status = 200, body;
      const response = {
        status(value) { status = value; return this; },
        header() { return this; },
        json(value) { body = value; },
      };
      await handler({
        params: { fileId: FILE_ID },
        headers: { authorization: `Bearer ${token}`, ...extraHeaders },
      }, response);
      return { status, body };
    },
  };
}

test('only the native authenticated owner reads the exact committed text bytes', async () => {
  const work = fixture();
  const denied = await work.call('other-token', { 'x-user-id': 'employee-a' });
  assert.equal(denied.status, 404);
  assert.deepEqual(work.storageReads, []);
  const anonymous = await work.call('unknown-token');
  assert.equal(anonymous.status, 401);

  const owned = await work.call('employee-token');
  assert.equal(owned.status, 200);
  assert.equal(owned.body.name, '沟通纪要.md');
  assert.equal(owned.body.bytes, work.bytes.length);
  assert.equal(owned.body.content, work.bytes.toString('utf8'));
  assert.equal(owned.body.sha256, createHash('sha256').update(work.bytes).digest('hex'));
  assert.deepEqual(work.storageReads, ['private/key']);
});

test('new native-gated uploads and legacy owner files remain scoped to exact bytes', async () => {
  const work = fixture();
  work.file.scope = 'other';
  assert.equal((await work.call('employee-token')).status, 404);
  assert.deepEqual(work.storageReads, []);

  work.file.scope = 'attachments';
  assert.equal((await work.call('employee-token')).status, 200);
  work.file.size += 1;
  const changed = await work.call('employee-token');
  assert.equal(changed.status, 422);
  assert.equal(changed.body.error.code, 'MATERIAL_CHANGED');
});
