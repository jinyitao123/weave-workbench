import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ApprovalWorkbenchContextPlugin } from '../src/plugins/approval-workbench-context.plugin.ts';
import { approvalPayloadVersion } from '../src/plugins/contract-revision-material.ts';

const CONTRACT_OBJECT = 'forge_sales_contract';
const CONTRACT_A = 'contract-A';
const CONTRACT_B = 'contract-B';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function textFile(id, key, name, recordId, field, content) {
  const bytes = Buffer.from(content, 'utf8');
  return {
    id, key, name, mime_type: 'text/plain', size: bytes.length, status: 'committed',
    ref_object: CONTRACT_OBJECT, ref_id: recordId, ref_field: field, bytes,
  };
}

function approval({ id, recordId, status = 'pending', approver, submitter, payload, title }) {
  return {
    id, process_name: 'flow:contract_approval', object_name: CONTRACT_OBJECT, record_id: recordId,
    status, submitter_id: submitter, current_step: 'review', step_label: '合同复核',
    record_title: title, object_label: '销售合同', payload,
    payload_labels: {
      name: '合同名称', code: '合同编号', customer_id: '客户', submitted_material_name: '提交版本名称',
    },
    payload_display: { customer_id: '客户甲' },
    approver,
  };
}

function contextPayload(material, extraFiles = []) {
  const manifest = extraFiles.map((file) => ({ file_id: file.id, name: file.name, sha256: sha256(file.bytes) }));
  return {
    name: '设备验收合同', code: 'HT-2026-001', customer_id: 'customer-private-id',
    submitted_material_id: material.id,
    submitted_material_name: material.name,
    submitted_material_sha256: sha256(material.bytes),
    attachment_ids: extraFiles.map((file) => file.id),
    submitted_attachment_manifest: JSON.stringify(manifest),
    submitted_attachment_revision_request_id: 'internal-request-id',
  };
}

function createHarness() {
  const materialA = textFile('file-main-A', 'key-main-A', '合同正文.txt', CONTRACT_A, 'submitted_material_id', '合同正文 A');
  const attachmentA = textFile('file-attachment-A', 'key-attachment-A', '技术说明.txt', CONTRACT_A, 'attachment_ids', '技术说明 A');
  const duplicateMainAttachment = textFile('file-main-attachment-A', 'key-main-attachment-A', '合同正文.txt', CONTRACT_A, 'attachment_ids', '合同正文 A');
  const materialB = textFile('file-main-B', 'key-main-B', '合同正文 B.txt', CONTRACT_B, 'submitted_material_id', '合同正文 B');
  const files = new Map([materialA, attachmentA, duplicateMainAttachment, materialB].map((file) => [file.id, file]));
  const pendingA = approval({
    id: 'approval-A', recordId: CONTRACT_A, approver: 'reviewer-A', submitter: 'sales-A',
    payload: contextPayload(materialA, [attachmentA]), title: '设备验收合同 A',
  });
  const legacyAttachmentPayload = contextPayload(materialA, [attachmentA]);
  delete legacyAttachmentPayload.submitted_attachment_manifest;
  const pendingLegacyAttachment = approval({
    id: 'approval-legacy-attachment', recordId: CONTRACT_A, approver: 'reviewer-A', submitter: 'sales-A',
    payload: legacyAttachmentPayload, title: '设备验收合同 A（历史附件清单）',
  });
  const pendingB = approval({
    id: 'approval-B', recordId: CONTRACT_B, approver: 'reviewer-B', submitter: 'sales-B',
    payload: contextPayload(materialB), title: '设备验收合同 B',
  });
  const returned = approval({
    id: 'approval-returned', recordId: 'contract-returned', status: 'returned', approver: 'reviewer-old', submitter: 'sales-returned',
    payload: { name: '已退回合同', code: 'HT-RETURNED' }, title: '已退回合同',
  });
  const noFrozenDigest = approval({
    id: 'approval-no-digest', recordId: CONTRACT_A, approver: 'reviewer-A', submitter: 'sales-A',
    payload: { name: '没有冻结摘要的合同', submitted_material_id: materialA.id }, title: '没有冻结摘要的合同',
  });
  const requests = new Map([[pendingA.id, pendingA], [pendingLegacyAttachment.id, pendingLegacyAttachment], [pendingB.id, pendingB], [returned.id, returned], [noFrozenDigest.id, noFrozenDigest]]);
  const sessions = new Map([
    ['reviewer-token', { user: { id: 'reviewer-A' }, session: { activeOrganizationId: 'org-A' } }],
    ['reviewer-b-token', { user: { id: 'reviewer-B' }, session: { activeOrganizationId: 'org-A' } }],
    ['sales-token', { user: { id: 'sales-returned' }, session: { activeOrganizationId: 'org-A' } }],
    ['former-reviewer-token', { user: { id: 'reviewer-old' }, session: { activeOrganizationId: 'org-A' } }],
  ]);
  const fileQueries = [];
  const downloadedKeys = [];
  let requestReads = 0;
  const actionLists = new Map([[returned.id, [{
    id: 'action-revise', request_id: returned.id, action: 'revise', comment: '请补充签字页',
  }]]]);

  const engine = {
    async find(objectName, query, options) {
      if (objectName === 'sys_file') {
        fileQueries.push({ query, options });
        const ids = query.where.id.$in;
        return ids.map((id) => files.get(id)).filter(Boolean);
      }
      // The canonical authz resolver asks the real query surface for session grants.
      return [];
    },
    getObject(objectName) {
      if (objectName !== CONTRACT_OBJECT) return undefined;
      return { fields: {
        name: { type: 'text', label: '合同名称' },
        code: { type: 'text', label: '合同编号' },
        customer_id: { type: 'lookup', label: '客户' },
        submitted_material_id: { type: 'file', label: '提交材料' },
        submitted_material_name: { type: 'text', label: '提交版本名称' },
        submitted_material_sha256: { type: 'text', label: '提交版本摘要' },
        attachment_ids: { type: 'file', label: '合同附件' },
        submitted_attachment_manifest: { type: 'textarea', label: '本次提交附件清单' },
        submitted_attachment_revision_request_id: { type: 'text', label: '修订轮次' },
      } };
    },
  };
  const approvals = {
    async getRequest(requestId, context) {
      requestReads += 1;
      const row = requests.get(requestId);
      if (!row) return null;
      // Simulate a broader legacy/native visibility tier. The endpoint must still
      // honor the service-computed current-participant flags below.
      return {
        ...row,
        viewer: {
          can_act: row.status === 'pending' && row.approver === context.userId,
          is_submitter: row.submitter_id === context.userId,
          can_override: false,
        },
      };
    },
    async listActions(requestId) { return actionLists.get(requestId) ?? []; },
  };
  const storage = {
    async download(key) {
      downloadedKeys.push(key);
      const file = [...files.values()].find((candidate) => candidate.key === key);
      if (!file) throw new Error('missing file');
      return Buffer.from(file.bytes);
    },
  };
  const routes = new Map();
  let ready;
  const server = { get(path, handler) { routes.set(path, handler); } };
  const context = {
    getService(name) {
      const services = {
        'http.server': server,
        auth: { api: { async getSession({ headers }) { return sessions.get(headers.get('authorization')?.slice(7)) ?? null; } } },
        objectql: engine,
        approvals,
        storage,
      };
      if (!(name in services)) throw new Error(`service unavailable: ${name}`);
      return services[name];
    },
    getKernel() { return {}; },
    hook(name, handler) { if (name === 'kernel:ready') ready = handler; },
    logger: { error() {} },
  };
  const plugin = new ApprovalWorkbenchContextPlugin();
  plugin.init(context);

  return {
    async start() { await ready(); },
    changePayload(requestId, payload) {
      const request = requests.get(requestId);
      assert.ok(request, 'fixture request exists');
      request.payload = payload;
    },
    setActions(requestId, actions) { actionLists.set(requestId, actions); },
    async call(requestId, token, extraHeaders = {}) {
      const handler = routes.get('/api/v1/approvals/requests/:requestId/workbench-context');
      assert.ok(handler, 'approval context route mounted');
      let status = 200;
      let body;
      const response = {
        status(value) { status = value; return this; },
        json(value) { body = value; },
      };
      await handler({
        params: { requestId }, query: { fileId: 'file-main-B' }, body: { userId: 'reviewer-B', fileId: 'file-main-B' },
        headers: { authorization: `Bearer ${token}`, ...extraHeaders },
      }, response);
      return { status, body, fileQueries: [...fileQueries], downloadedKeys: [...downloadedKeys], requestReads };
    },
    get fixtureFiles() { return { materialA, attachmentA, duplicateMainAttachment, materialB }; },
  };
}

test('pending approver receives only this request snapshot and verified text bytes', async () => {
  const harness = createHarness();
  await harness.start();
  const result = await harness.call('approval-A', 'reviewer-token', { 'x-user-id': 'reviewer-B' });

  assert.equal(result.status, 200);
  assert.equal(result.body.viewer, 'current_approver');
  assert.equal(result.body.title, '设备验收合同 A');
  assert.deepEqual(result.body.businessObject, { objectName: CONTRACT_OBJECT, recordId: CONTRACT_A, recordName: '设备验收合同 A' });
  assert.match(result.body.sourceMaterialVersion, /^[0-9a-f]{64}$/);
  assert.equal(result.body.sourceMaterialVersion,
    await approvalPayloadVersion(contextPayload(harness.fixtureFiles.materialA, [harness.fixtureFiles.attachmentA])));
  assert.deepEqual(result.body.fields, [
    { label: '合同名称', value: '设备验收合同' },
    { label: '合同编号', value: 'HT-2026-001' },
    { label: '客户', value: '客户甲' },
    { label: '提交版本名称', value: '合同正文.txt' },
  ]);
  assert.equal(result.body.revisionReady, undefined);
  assert.deepEqual(result.body.files.map(({ name, content, sha256, bytes }) => ({ name, content, sha256, bytes })), [
    { name: '合同正文.txt', content: '合同正文 A', sha256: sha256(harness.fixtureFiles.materialA.bytes), bytes: harness.fixtureFiles.materialA.bytes.length },
    { name: '技术说明.txt', content: '技术说明 A', sha256: sha256(harness.fixtureFiles.attachmentA.bytes), bytes: harness.fixtureFiles.attachmentA.bytes.length },
  ]);
  assert.deepEqual(result.body.files.map(({ fileId }) => fileId), ['file-main-A', 'file-attachment-A']);
  assert.deepEqual(result.fileQueries[0].query.where.id.$in.sort(), ['file-attachment-A', 'file-main-A']);
  assert.equal(result.fileQueries[0].options.context.isSystem, true);
  assert.deepEqual(result.downloadedKeys.sort(), ['key-attachment-A', 'key-main-A']);
  assert.equal(JSON.stringify(result.body).includes('file-main-B'), false);
  assert.equal(JSON.stringify(result.body).includes('customer-private-id'), false);
  assert.equal(JSON.stringify(result.body).includes('internal-request-id'), false);
});

test('legacy native contract approvals derive the companion digest from the immutable submitted file id', async () => {
  const harness = createHarness();
  await harness.start();
  const result = await harness.call('approval-legacy-attachment', 'reviewer-token');

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.files.map(({ name, sha256 }) => ({ name, sha256 })), [
    { name: '合同正文.txt', sha256: sha256(harness.fixtureFiles.materialA.bytes) },
    { name: '技术说明.txt', sha256: sha256(harness.fixtureFiles.attachmentA.bytes) },
  ]);
  assert.deepEqual(result.downloadedKeys.sort(), ['key-attachment-A', 'key-main-A']);
});

test('the same main document attached twice is returned once, ahead of companion files', async () => {
  const harness = createHarness();
  await harness.start();
  harness.changePayload('approval-A', contextPayload(harness.fixtureFiles.materialA, [
    harness.fixtureFiles.duplicateMainAttachment, harness.fixtureFiles.attachmentA,
  ]));
  const result = await harness.call('approval-A', 'reviewer-token');

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.files.map(({ name, content }) => ({ name, content })), [
    { name: '合同正文.txt', content: '合同正文 A' },
    { name: '技术说明.txt', content: '技术说明 A' },
  ]);
  assert.equal(result.body.files.length, 2);
});

test('non-recipient and other-contract request stay unreadable even through a broader native reader tier', async () => {
  const harness = createHarness();
  await harness.start();
  const result = await harness.call('approval-B', 'reviewer-token');

  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, 'APPROVAL_CONTEXT_NOT_FOUND');
  assert.equal(result.fileQueries.length, 0);
  assert.deepEqual(result.downloadedKeys, []);
});

test('returned request is readable only by its original submitter', async () => {
  const harness = createHarness();
  await harness.start();
  const formerApprover = await harness.call('approval-returned', 'former-reviewer-token');
  assert.equal(formerApprover.status, 404);
  assert.equal(formerApprover.fileQueries.length, 0);

  const submitter = await harness.call('approval-returned', 'sales-token');
  assert.equal(submitter.status, 200);
  assert.equal(submitter.body.viewer, 'original_submitter');
  assert.equal(submitter.body.status, 'returned');
  assert.equal(submitter.body.returnReason, '请补充签字页');
  assert.equal(submitter.body.returnVersion, 'action-revise');
  assert.deepEqual(submitter.body.businessObject, { objectName: CONTRACT_OBJECT, recordId: 'contract-returned', recordName: '已退回合同' });
  assert.match(submitter.body.sourceMaterialVersion, /^[0-9a-f]{64}$/);
  assert.equal(submitter.body.revisionReady, undefined);
});

test('returned request context expires after native resubmission without reading old files', async () => {
  const harness = createHarness();
  await harness.start();
  harness.setActions('approval-returned', [
    { id: 'action-submit', request_id: 'approval-returned', action: 'submit', comment: '提交' },
    { id: 'action-revise', request_id: 'approval-returned', action: 'revise', comment: '请补充签字页' },
    { id: 'action-resubmit', request_id: 'approval-returned', action: 'resubmit', comment: '已补充' },
  ]);

  const result = await harness.call('approval-returned', 'sales-token');
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'APPROVAL_CONTEXT_STALE');
  assert.equal(result.fileQueries.length, 0);
  assert.deepEqual(result.downloadedKeys, []);
});

test('source material version is stable across key order and changes with the frozen payload', async () => {
  const harness = createHarness();
  await harness.start();
  const initial = await harness.call('approval-A', 'reviewer-token');
  assert.equal(initial.status, 200);
  const original = contextPayload(harness.fixtureFiles.materialA, [harness.fixtureFiles.attachmentA]);
  harness.changePayload('approval-A', Object.fromEntries(Object.entries(original).reverse()));
  const reordered = await harness.call('approval-A', 'reviewer-token');
  assert.equal(reordered.body.sourceMaterialVersion, initial.body.sourceMaterialVersion);
  harness.changePayload('approval-A', { ...original, name: '经修改的合同' });
  const changed = await harness.call('approval-A', 'reviewer-token');
  assert.notEqual(changed.body.sourceMaterialVersion, initial.body.sourceMaterialVersion);
});

test('invalid bearer and material hash mismatch fail closed', async () => {
  const harness = createHarness();
  await harness.start();
  const unauthenticated = await harness.call('approval-A', 'unknown-token');
  assert.equal(unauthenticated.status, 401);

  // Corrupting a frozen primary file while retaining its request digest must
  // refuse the whole context.
  harness.fixtureFiles.materialA.bytes[0] = 0x58;
  const mismatch = await harness.call('approval-A', 'reviewer-token');
  assert.equal(mismatch.status, 422);
  assert.equal(mismatch.body.error.code, 'APPROVAL_MATERIAL_HASH_MISMATCH');
});

test('a material without a snapshot digest is never presented as frozen', async () => {
  const harness = createHarness();
  await harness.start();
  const result = await harness.call('approval-no-digest', 'reviewer-token');

  assert.equal(result.status, 422);
  assert.equal(result.body.error.code, 'APPROVAL_MATERIAL_HASH_UNAVAILABLE');
  assert.equal(result.fileQueries.length, 0);
  assert.deepEqual(result.downloadedKeys, []);
});

test('unsupported MIME type has a distinct response and no storage read', async () => {
  const harness = createHarness();
  await harness.start();
  harness.fixtureFiles.materialA.mime_type = 'application/pdf';
  const result = await harness.call('approval-A', 'reviewer-token');

  assert.equal(result.status, 415);
  assert.equal(result.body.error.code, 'APPROVAL_MATERIAL_UNSUPPORTED_TYPE');
  assert.deepEqual(result.downloadedKeys, []);
});

test('UTF-8 text upload MIME is accepted while the returned contract stays normalized', async () => {
  const harness = createHarness();
  await harness.start();
  harness.fixtureFiles.materialA.mime_type = 'text/plain; charset=utf-8';
  const result = await harness.call('approval-A', 'reviewer-token');
  assert.equal(result.status, 200);
  assert.equal(result.body.files[0].mediaType, 'text/plain; charset=utf-8');
});

test('committed Markdown contract materials are readable as plain text', async () => {
  const harness = createHarness();
  await harness.start();
  harness.fixtureFiles.materialA.mime_type = 'text/markdown';
  harness.fixtureFiles.attachmentA.mime_type = 'text/markdown; charset=utf-8';
  const result = await harness.call('approval-A', 'reviewer-token');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.files.map((file) => file.mediaType), [
    'text/plain; charset=utf-8', 'text/plain; charset=utf-8',
  ]);
  assert.deepEqual(result.body.files.map((file) => file.content), ['合同正文 A', '技术说明 A']);
});
