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
  const auditEntries = [];
  const storedBytes = new Map([[file.key, Buffer.from(bytes)]]);
  const boundRecord = {
    id: 'contract-a', owner_id: 'employee-a', organization_id: 'org-a',
    submitted_material_id: FILE_ID,
  };
  const routes = new Map();
  let ready;
  const server = { get(path, handler) { routes.set(path, handler); } };
  const engine = {
    async findOne(objectName, query, options) {
      if (objectName === 'sys_file') return query.where.id === FILE_ID ? file : null;
      assert.equal(objectName, 'forge_sales_contract');
      return query.where.id === boundRecord.id && options?.context?.userId === boundRecord.owner_id
        ? boundRecord : null;
    },
    async find() { return []; },
  };
  const storage = {
    async download(key) {
      storageReads.push(key);
      const value = storedBytes.get(key);
      if (!value) throw new Error('missing file');
      return Buffer.from(value);
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
    logger: { error() {}, info(message, meta) { auditEntries.push({ message, meta }); } },
  };
  new WorkbenchOwnedMaterialPlugin().init(context);
  return {
    file, bytes, boundRecord, storageReads, auditEntries,
    store(key, value) { storedBytes.set(key, Buffer.from(value)); },
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
    async callOriginal(token, sha256, extraHeaders = {}) {
      await ready();
      const handler = routes.get('/api/v1/workbench/materials/:fileId/original');
      assert.ok(handler);
      let status = 200, body, raw;
      const responseHeaders = {};
      const response = {
        status(value) { status = value; return this; },
        header(name, value) { responseHeaders[name.toLowerCase()] = value; return this; },
        json(value) { body = value; },
        send(value) { raw = Buffer.from(value); },
      };
      await handler({
        params: { fileId: FILE_ID },
        headers: { authorization: `Bearer ${token}`, ...(sha256 ? { 'if-match': `"${sha256}"` } : {}), ...extraHeaders },
      }, response);
      return { status, body, raw, headers: responseHeaders };
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

test('PDF originals return unmodified bytes only to the authenticated owner and matching If-Match SHA', async () => {
  const work = fixture();
  const bytes = Buffer.from('%PDF-1.7\nfixture-original-bytes');
  Object.assign(work.file, {
    key: 'private/original.pdf', name: '客户合同.pdf', mime_type: 'application/pdf',
    size: bytes.length, scope: 'attachments',
  });
  work.store(work.file.key, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');

  const unauthorized = await work.callOriginal('other-token', digest, { 'x-user-id': 'employee-a' });
  assert.equal(unauthorized.status, 404);
  assert.deepEqual(work.storageReads, []);

  const missingSha = await work.callOriginal('employee-token', undefined);
  assert.equal(missingSha.status, 428);
  assert.equal(missingSha.body.error.code, 'MATERIAL_HASH_REQUIRED');
  assert.deepEqual(work.storageReads, []);

  const wrongSha = await work.callOriginal('employee-token', 'f'.repeat(64));
  assert.equal(wrongSha.status, 409);
  assert.equal(wrongSha.body.error.code, 'MATERIAL_SHA_MISMATCH');
  assert.deepEqual(work.storageReads, ['private/original.pdf']);

  const original = await work.callOriginal('employee-token', digest);
  assert.equal(original.status, 200);
  assert.deepEqual(original.raw, bytes);
  assert.equal(original.body, undefined, 'original bytes are never wrapped in a JSON body');
  assert.equal(original.headers['content-type'], 'application/pdf');
  assert.equal(original.headers['content-length'], String(bytes.length));
  assert.equal(original.headers.etag, `"${digest}"`);
  assert.equal(original.headers['x-content-sha256'], digest);
  assert.equal(original.headers['cache-control'], 'private, no-store');
  assert.equal(original.headers['x-content-type-options'], 'nosniff');
  assert.match(original.headers['content-disposition'], /filename\*=UTF-8''/);
  assert.deepEqual(work.auditEntries.map(({ meta }) => meta), [{
    userId: 'employee-a', organizationId: 'org-a', fileId: FILE_ID,
    mediaType: 'application/pdf', bytes: bytes.length, sha256: digest,
  }]);
  assert.deepEqual(work.storageReads, ['private/original.pdf', 'private/original.pdf']);

  work.file.organization_id = 'org-other';
  const crossOrganization = await work.callOriginal('employee-token', digest);
  assert.equal(crossOrganization.status, 404);
  assert.deepEqual(work.storageReads, ['private/original.pdf', 'private/original.pdf']);
});

test('original route rejects files bound through a reference field even when other reference columns are empty', async () => {
  const work = fixture();
  const bytes = Buffer.from('%PDF-1.7\nfixture-original-bytes');
  Object.assign(work.file, {
    key: 'private/original.pdf', name: '客户合同.pdf', mime_type: 'application/pdf',
    size: bytes.length, scope: 'attachments', ref_field: 'attachment_ids',
  });
  work.store(work.file.key, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');

  const result = await work.callOriginal('employee-token', digest);
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, 'MATERIAL_NOT_FOUND');
  assert.deepEqual(work.storageReads, []);
});

test('owner can reopen an original after its exact version is bound to an accessible business record', async () => {
  const work = fixture();
  const bytes = Buffer.from('%PDF-1.7\nfixture-original-bytes');
  Object.assign(work.file, {
    key: 'private/original.pdf', name: '客户合同.pdf', mime_type: 'application/pdf',
    size: bytes.length, scope: 'attachments', ref_object: 'forge_sales_contract',
    ref_id: work.boundRecord.id, ref_field: 'submitted_material_id',
  });
  work.boundRecord.submitted_material_id = JSON.stringify(FILE_ID);
  work.store(work.file.key, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');

  assert.equal((await work.callOriginal('other-token', digest)).status, 404);
  assert.deepEqual(work.storageReads, []);
  const owned = await work.callOriginal('employee-token', digest);
  assert.equal(owned.status, 200);
  assert.deepEqual(owned.raw, bytes);

  work.boundRecord.submitted_material_id = 'another-file';
  assert.equal((await work.callOriginal('employee-token', digest)).status, 404);
  work.boundRecord.submitted_material_id = FILE_ID;
  work.boundRecord.organization_id = 'other-org';
  assert.equal((await work.callOriginal('employee-token', digest)).status, 404);
  assert.deepEqual(work.storageReads, ['private/original.pdf']);
});

test('DOCX MIME and file signature must agree and the two MiB original limit is enforced', async () => {
  const work = fixture();
  const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x10, 0x20, 0x30]);
  Object.assign(work.file, {
    key: 'private/original.docx', name: '技术协议.docx',
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: bytes.length,
  });
  work.store(work.file.key, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const original = await work.callOriginal('employee-token', digest);
  assert.equal(original.status, 200);
  assert.deepEqual(original.raw, bytes);
  assert.equal(original.headers['content-type'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  work.file.size = 2 * 1024 * 1024 + 1;
  const tooLarge = await work.callOriginal('employee-token', digest);
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.error.code, 'MATERIAL_TOO_LARGE');

  work.file.size = bytes.length;
  work.store(work.file.key, Buffer.from('not a zip file'));
  const invalid = await work.callOriginal('employee-token', digest);
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error.code, 'MATERIAL_INVALID');
});
