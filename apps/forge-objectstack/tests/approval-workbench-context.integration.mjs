import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ApprovalWorkbenchContextPlugin } from '../src/plugins/approval-workbench-context.plugin.ts';
import { approvalPayloadVersion } from '../src/plugins/contract-revision-material.ts';
import { SalesContract } from '../src/objects/sales.object.ts';

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
    id, organization_id: 'org-A', process_name: 'flow:contract_approval', object_name: CONTRACT_OBJECT, record_id: recordId,
    status, submitter_id: submitter, current_step: 'review', step_label: '合同复核',
    record_title: title, object_label: '销售合同', payload,
    payload_labels: {
      name: '合同名称', code: '合同编号', customer_id: '客户', submitted_material_name: '提交版本名称',
    },
    payload_display: { customer_id: '客户甲', status: '旧审批状态', unknown_status: '已审批' },
    approver,
  };
}

function contextPayload(material, extraFiles = []) {
  const manifest = extraFiles.map((file) => ({ file_id: file.id, name: file.name, sha256: sha256(file.bytes) }));
  return {
    name: '设备验收合同', code: 'HT-2026-001', customer_id: 'customer-private-id',
    status: 'pending_approval', unknown_status: 'pending_legal', draft_request_signature: '0123456789abcdef',
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
  const pdfBytes = Buffer.from('%PDF-1.7\napproval-original');
  const materialPdf = {
    id: 'file-pdf-A', key: 'key-pdf-A', name: '合同正文.pdf', mime_type: 'application/pdf',
    size: pdfBytes.length, status: 'committed', scope: 'attachments', acl: 'private', ref_object: CONTRACT_OBJECT, ref_id: 'contract-PDF',
    ref_field: 'submitted_material_id', owner_id: 'sales-PDF', organization_id: 'org-A', bytes: pdfBytes,
  };
  const files = new Map([materialA, attachmentA, duplicateMainAttachment, materialB, materialPdf].map((file) => [file.id, file]));
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
  const pendingPdf = approval({
    id: 'approval-PDF', recordId: 'contract-PDF', approver: 'reviewer-PDF', submitter: 'sales-PDF',
    payload: contextPayload(materialPdf), title: 'PDF 原件审批',
  });
  const returned = approval({
    id: 'approval-returned', recordId: 'contract-returned', status: 'returned', approver: 'reviewer-old', submitter: 'sales-returned',
    payload: { name: '已退回合同', code: 'HT-RETURNED' }, title: '已退回合同',
  });
  const noFrozenDigest = approval({
    id: 'approval-no-digest', recordId: CONTRACT_A, approver: 'reviewer-A', submitter: 'sales-A',
    payload: { name: '没有冻结摘要的合同', submitted_material_id: materialA.id }, title: '没有冻结摘要的合同',
  });
  const requests = new Map([[pendingA.id, pendingA], [pendingLegacyAttachment.id, pendingLegacyAttachment], [pendingB.id, pendingB], [pendingPdf.id, pendingPdf], [returned.id, returned], [noFrozenDigest.id, noFrozenDigest]]);
  requests.set('approval-order', { ...pendingA, id: 'approval-order', object_name: 'forge_sales_order',
    record_id: 'order-A', submitter_id: 'sales-returned', payload: { name: '合成订单', code: 'TEST-ORDER' } });
  const sessions = new Map([
    ['reviewer-token', { user: { id: 'reviewer-A' }, session: { activeOrganizationId: 'org-A' } }],
    ['reviewer-b-token', { user: { id: 'reviewer-B' }, session: { activeOrganizationId: 'org-A' } }],
    ['reviewer-pdf-token', { user: { id: 'reviewer-PDF' }, session: { activeOrganizationId: 'org-A' } }],
    ['submitter-pdf-token', { user: { id: 'sales-PDF' }, session: { activeOrganizationId: 'org-A' } }],
    ['sales-token', { user: { id: 'sales-returned' }, session: { activeOrganizationId: 'org-A' } }],
    ['former-reviewer-token', { user: { id: 'reviewer-old' }, session: { activeOrganizationId: 'org-A' } }],
  ]);
  const fileQueries = [];
  const downloadedKeys = [];
  const auditEntries = [];
  let requestReads = 0;
  const actionLists = new Map([[returned.id, [{
    id: 'action-revise', request_id: returned.id, action: 'revise', comment: '请补充签字页',
  }]]]);

  const engine = {
    async find(objectName, query, options) {
      if (objectName === 'sys_file') {
        fileQueries.push({ query, options });
        const ids = query.where.id.$in ?? [query.where.id];
        return ids.map((id) => files.get(id)).filter(Boolean);
      }
      // The canonical authz resolver asks the real query surface for session grants.
      return [];
    },
    getObject(objectName) {
      if (objectName !== CONTRACT_OBJECT) return undefined;
      return { fields: {
        ...SalesContract.fields,
        unknown_status: { type: 'select', label: '未知状态', options: [{ value: 'draft', label: '草稿' }] },
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
    logger: { error() {}, info(message, meta) { auditEntries.push({ message, meta }); } },
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
    setRequestStatus(requestId, status) {
      const request = requests.get(requestId);
      assert.ok(request, 'fixture request exists');
      request.status = status;
    },
    setReturnedRequestId(requestId, returnedId) {
      const request = requests.get(requestId);
      assert.ok(request, 'fixture request exists');
      request.id = returnedId;
    },
    addFile(file) { files.set(file.id, file); },
    addRequest(request) { requests.set(request.id, request); },
    setActions(requestId, actions) { actionLists.set(requestId, actions); },
    async call(requestId, token, extraHeaders = {}) {
      const handler = routes.get('/api/v1/approvals/requests/:requestId/workbench-context');
      assert.ok(handler, 'approval context route mounted');
      let status = 200;
      let body;
      const response = {
        status(value) { status = value; return this; },
        header() { return this; },
        json(value) { body = value; },
      };
      await handler({
        params: { requestId }, query: { fileId: 'file-main-B' }, body: { userId: 'reviewer-B', fileId: 'file-main-B' },
        headers: { authorization: `Bearer ${token}`, ...extraHeaders },
      }, response);
      return { status, body, fileQueries: [...fileQueries], downloadedKeys: [...downloadedKeys], requestReads };
    },
    async callOriginal(requestId, fileId, token, sha256, extraHeaders = {}) {
      const handler = routes.get('/api/v1/approvals/requests/:requestId/workbench-context/files/:fileId/original');
      assert.ok(handler, 'approval original file route mounted');
      let status = 200, body, raw;
      const responseHeaders = {};
      const response = {
        status(value) { status = value; return this; },
        header(name, value) { responseHeaders[name.toLowerCase()] = value; return this; },
        json(value) { body = value; },
        send(value) { raw = Buffer.from(value); },
      };
      await handler({
        params: { requestId, fileId },
        headers: { authorization: `Bearer ${token}`, ...(sha256 ? { 'if-match': `"${sha256}"` } : {}), ...extraHeaders },
      }, response);
      return { status, body, raw, headers: responseHeaders, downloadedKeys: [...downloadedKeys], auditEntries: [...auditEntries] };
    },
    get fixtureFiles() { return { materialA, attachmentA, duplicateMainAttachment, materialB, materialPdf }; },
  };
}

test('only the original order submitter receives pending recall context; approver keeps decisions and contract submitter stays denied', async () => {
  const harness = createHarness();
  await harness.start();
  const own = await harness.call('approval-order', 'sales-token');
  assert.equal(own.status, 200);
  assert.equal(own.body.viewer, 'original_submitter');
  assert.equal(own.body.status, 'pending');
  assert.deepEqual(own.body.availableActions.map(action => [action.semantic, action.execution.actionName]), [['recall', 'order_approval_mcp_recall']]);
  const reviewer = await harness.call('approval-order', 'reviewer-token');
  assert.equal(reviewer.status, 200);
  assert.equal(reviewer.body.viewer, 'current_approver');
  assert.deepEqual(reviewer.body.availableActions.map(action => action.semantic), ['approve', 'reject']);
  assert.equal((await harness.call('approval-order', 'reviewer-b-token')).status, 404);
  assert.equal((await harness.call('approval-PDF', 'submitter-pdf-token')).status, 404);
});

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
    { label: '合同状态', value: '待审批' },
    { label: '未知状态', value: '未知（原值：pending_legal）' },
    { label: '提交版本名称', value: '合同正文.txt' },
  ]);
  assert.equal(JSON.stringify(result.body.fields).includes('0123456789abcdef'), false,
    'metadata-hidden technical signatures are excluded from approval fields');
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

test('approval context returns PDF metadata only and original bytes only to the current snapshot participant', async () => {
  const harness = createHarness();
  await harness.start();
  const file = harness.fixtureFiles.materialPdf;
  const digest = sha256(file.bytes);
  const context = await harness.call('approval-PDF', 'reviewer-pdf-token');

  assert.equal(context.status, 200);
  assert.equal(context.body.requestId, 'approval-PDF');
  assert.deepEqual(context.body.files, []);
  assert.deepEqual(context.body.originalFiles, [{
    sourceKind: 'approval', requestId: 'approval-PDF', fileId: file.id, name: file.name,
    mediaType: 'application/pdf', bytes: file.bytes.length, sha256: digest,
  }]);
  assert.deepEqual(context.downloadedKeys, [], 'approval context returns metadata without reading or embedding binary bytes');
  assert.equal(JSON.stringify(context.body).includes(file.bytes.toString('utf8')), false, 'approval JSON never contains PDF bytes');

  const beforeUnauthorized = context.downloadedKeys.length;
  const wrongReviewer = await harness.callOriginal('approval-PDF', file.id, 'reviewer-token', digest);
  assert.equal(wrongReviewer.status, 404);
  assert.equal(wrongReviewer.downloadedKeys.length, beforeUnauthorized, 'a nonparticipant cannot trigger storage reads');

  const wrongRequest = await harness.callOriginal('approval-A', file.id, 'reviewer-token', digest);
  assert.equal(wrongRequest.status, 404, 'a file from another request is not in this fixed snapshot');

  const wrongHash = await harness.callOriginal('approval-PDF', file.id, 'reviewer-pdf-token', 'f'.repeat(64));
  assert.equal(wrongHash.status, 409);
  assert.equal(wrongHash.body.error.code, 'APPROVAL_MATERIAL_HASH_MISMATCH');
  const missingHeader = await harness.callOriginal('approval-PDF', file.id, 'reviewer-pdf-token', undefined);
  assert.equal(missingHeader.status, 428);
  assert.equal(missingHeader.body.error.code, 'APPROVAL_MATERIAL_HASH_REQUIRED');
  const noFrozenHash = await harness.callOriginal('approval-no-digest', harness.fixtureFiles.materialA.id, 'reviewer-token',
    sha256(harness.fixtureFiles.materialA.bytes));
  assert.equal(noFrozenHash.status, 422);
  assert.equal(noFrozenHash.body.error.code, 'APPROVAL_MATERIAL_HASH_UNAVAILABLE');

  const approvedOriginal = await harness.callOriginal('approval-PDF', file.id, 'reviewer-pdf-token', digest);
  assert.equal(approvedOriginal.status, 200, JSON.stringify(approvedOriginal.body));
  assert.deepEqual(approvedOriginal.raw, file.bytes);
  assert.equal(approvedOriginal.body, undefined, 'original bytes are not placed in JSON');
  assert.equal(approvedOriginal.headers['content-type'], 'application/pdf');
  assert.equal(approvedOriginal.headers.etag, `"${digest}"`);
  assert.equal(approvedOriginal.headers['x-content-sha256'], digest);
  assert.equal(approvedOriginal.headers['cache-control'], 'private, no-store');
  assert.ok(approvedOriginal.auditEntries.some(({ meta }) => meta.requestId === 'approval-PDF' &&
    meta.fileId === file.id && meta.sha256 === digest && meta.userId === 'reviewer-PDF' && !('content' in meta)));

  harness.setRequestStatus('approval-PDF', 'returned');
  harness.setActions('approval-PDF', [{ id: 'return-PDF', request_id: 'approval-PDF', action: 'revise', comment: '请补充说明' }]);
  const submitterOriginal = await harness.callOriginal('approval-PDF', file.id, 'submitter-pdf-token', digest);
  assert.equal(submitterOriginal.status, 200, 'the original submitter may read a current returned snapshot');

  harness.setActions('approval-PDF', [
    { id: 'return-PDF', request_id: 'approval-PDF', action: 'revise', comment: '请补充说明' },
    { id: 'resubmit-PDF', request_id: 'approval-PDF', action: 'resubmit', comment: '已补充' },
  ]);
  const staleOriginal = await harness.callOriginal('approval-PDF', file.id, 'submitter-pdf-token', digest);
  assert.equal(staleOriginal.status, 409, 'a returned snapshot cannot be reused after resubmission');
  assert.equal(staleOriginal.body.error.code, 'APPROVAL_CONTEXT_STALE');

  const otherOrganization = createHarness();
  await otherOrganization.start();
  otherOrganization.fixtureFiles.materialPdf.organization_id = 'org-other';
  const crossOrganization = await otherOrganization.callOriginal('approval-PDF', file.id, 'reviewer-pdf-token', digest);
  assert.equal(crossOrganization.status, 404);
  assert.deepEqual(crossOrganization.downloadedKeys, [], 'a cross-organization snapshot never reads storage');
});

test('a native request ID mismatch blocks both context metadata and original bytes', async () => {
  const harness = createHarness();
  await harness.start();
  const file = harness.fixtureFiles.materialPdf;
  const digest = sha256(file.bytes);
  harness.setReturnedRequestId('approval-PDF', 'approval-alias');

  const context = await harness.call('approval-PDF', 'reviewer-pdf-token');
  assert.equal(context.status, 404);
  assert.equal(context.body.error.code, 'APPROVAL_CONTEXT_NOT_FOUND');
  assert.equal(context.body.originalFiles, undefined, 'a mismatched native request cannot return any original-file reference');
  assert.deepEqual(context.fileQueries, []);
  assert.deepEqual(context.downloadedKeys, []);

  const original = await harness.callOriginal('approval-PDF', file.id, 'reviewer-pdf-token', digest);
  assert.equal(original.status, 404);
  assert.equal(original.body.error.code, 'APPROVAL_CONTEXT_NOT_FOUND');
  assert.equal(original.raw, undefined);
  assert.deepEqual(original.downloadedKeys, []);
});

test('approval context rejects snapshots exceeding the eight MiB aggregate before reading storage', async () => {
  const harness = createHarness();
  await harness.start();
  const largeFiles = Array.from({ length: 4 }, (_, index) => {
    const id = `file-large-${index + 1}`;
    const bytes = Buffer.alloc(2 * 1024 * 1024, index + 1);
    bytes.set(Buffer.from('%PDF-'), 0);
    const file = {
      id, key: `key-${id}`, name: `attachment-${index + 1}.pdf`, mime_type: 'application/pdf', size: bytes.length,
      status: 'committed', scope: 'attachments', acl: 'private', owner_id: 'sales-large',
      organization_id: 'org-A', ref_object: CONTRACT_OBJECT, ref_id: 'contract-large', ref_field: 'attachment_ids', bytes,
    };
    harness.addFile(file);
    return file;
  });
  harness.addRequest(approval({
    id: 'approval-large', recordId: 'contract-large', approver: 'reviewer-A', submitter: 'sales-large',
    payload: contextPayload(harness.fixtureFiles.materialA, largeFiles), title: '超过总量限制的审批材料',
  }));

  const result = await harness.call('approval-large', 'reviewer-token');
  assert.equal(result.status, 413);
  assert.equal(result.body.error.code, 'APPROVAL_CONTEXT_TOO_LARGE');
  assert.deepEqual(result.downloadedKeys, [], 'size limits are checked before storage bytes are fetched');
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
  harness.fixtureFiles.materialA.mime_type = 'image/png';
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

test('approval context returns more than eleven small files while respecting the aggregate byte limit', async () => {
  const harness = createHarness();
  await harness.start();
  const attachments = Array.from({ length: 11 }, (_, index) => textFile(
    `file-many-${index + 1}`,
    `key-many-${index + 1}`,
    `技术附件-${index + 1}.txt`,
    CONTRACT_A,
    'attachment_ids',
    `附件正文 ${index + 1}`,
  ));
  attachments.forEach((file) => harness.addFile(file));
  harness.changePayload('approval-A', contextPayload(harness.fixtureFiles.materialA, attachments));

  const result = await harness.call('approval-A', 'reviewer-token');
  assert.equal(result.status, 200);
  assert.equal(result.body.files.length, 12, 'the primary and eleven attachments are returned without a count-only cap');
  assert.ok(result.body.files.reduce((total, file) => total + file.bytes, 0) < 8 * 1024 * 1024);
  assert.equal(result.downloadedKeys.length, 12);
  assert.deepEqual(result.body.files.map((file) => file.fileId), [
    'file-main-A', ...attachments.map((file) => file.id),
  ]);
});
