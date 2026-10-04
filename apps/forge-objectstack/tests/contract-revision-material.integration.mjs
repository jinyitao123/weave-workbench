import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { approvalPayloadVersion, ContractRevisionMaterialService } from '../src/plugins/contract-revision-material.ts';
import { ApprovalWorkbenchContextPlugin } from '../src/plugins/approval-workbench-context.plugin.ts';

const contractId = 'contract-A';
const requestId = 'approval-returned';
const mainId = '11111111-1111-4111-8111-111111111111';
const attachmentId = '22222222-2222-4222-8222-222222222222';
const requestKey = '33333333-3333-4333-8333-333333333333';
const officePrimaryId = '44444444-4444-4444-8444-444444444444';
const officeAttachmentId = '55555555-5555-4555-8555-555555555555';
const otherOfficePrimaryId = '66666666-6666-4666-8666-666666666666';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function harness() {
  const oldPayload = { submitted_material_id: 'old-file', submitted_material_sha256: 'a'.repeat(64), name: '原合同' };
  const request = {
    id: requestId, object_name: 'forge_sales_contract', record_id: contractId,
    process_name: 'sales_contract_approval', submitter_id: 'sales-A', status: 'returned',
    organization_id: 'org-A', record_title: '原合同', step_label: '合同复核', payload: oldPayload,
    flow_run_id: 'run-A', flow_node_id: 'contract_review',
    node_config_json: JSON.stringify({ __round: 1 }), created_at: '2026-09-23T10:00:00.000Z',
    viewer: { is_submitter: true },
  };
  // Mirrors ObjectStack 17.3 `/storage/upload/presigned`: caller scope, private ACL, session owner, and active organization.
  const files = new Map([
    [mainId, { id: mainId, key: 'main-key', name: '修订合同.txt', mime_type: 'text/plain', status: 'committed', owner_id: 'sales-A', organization_id: 'org-A', size: 12, bytes: Buffer.from('修订合同 A', 'utf8') }],
    [attachmentId, { id: attachmentId, key: 'attachment-key', name: '技术附件.txt', mime_type: 'text/plain', status: 'committed', owner_id: 'sales-A', organization_id: 'org-A', size: 12, bytes: Buffer.from('技术附件 A', 'utf8') }],
    [officePrimaryId, { id: officePrimaryId, key: 'office-primary-key', name: '修订合同.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', status: 'committed', owner_id: 'sales-A', organization_id: 'org-A', scope: 'attachments', acl: 'private', size: 0, bytes: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('docx bytes')]) }],
    [officeAttachmentId, { id: officeAttachmentId, key: 'office-attachment-key', name: '修订技术协议.pdf', mime_type: 'application/pdf', status: 'committed', owner_id: 'sales-A', organization_id: 'org-A', scope: 'attachments', acl: 'private', size: 0, bytes: Buffer.from('%PDF-1.7\\nsynthetic pdf bytes') }],
    [otherOfficePrimaryId, { id: otherOfficePrimaryId, key: 'office-other-key', name: '另一版合同.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', status: 'committed', owner_id: 'sales-A', organization_id: 'org-A', scope: 'attachments', acl: 'private', size: 0, bytes: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('different docx bytes')]) }],
  ]);
  for (const file of files.values()) file.size = file.bytes.length;
  const ledger = new Map();
  const nativeAttachments = [];
  const actions = [{ id: 'return-action-A', action: 'revise', comment: '请修改验收条款' }];
  const relatedRequests = [request];
  const contract = { id: contractId, status: 'pending_approval', code: 'HT-A', submitted_material_id: 'old-file' };
  const engine = {
    async find(name, query) {
      if (name === 'sys_approval_request') {
        if (query.where.id) return relatedRequests.filter((row) => row.id === query.where.id);
        return relatedRequests.filter((row) =>
          row.flow_run_id === query.where.flow_run_id && row.object_name === query.where.object_name && row.record_id === query.where.record_id);
      }
      if (name === 'sys_file') {
        const ids = Array.isArray(query.where.id?.$in) ? query.where.id.$in : [query.where.id];
        return ids.map((id) => files.get(id)).filter(Boolean);
      }
      return [];
    },
    getObject(name) {
      if (name !== 'forge_sales_contract') return undefined;
      return { fields: {
        submitted_material_id: { type: 'file', label: '合同主件' },
        attachment_ids: { type: 'file', label: '合同附件' },
        submitted_material_name: { type: 'text', label: '提交版本名称', system: true },
        submitted_material_sha256: { type: 'text', label: '提交版本摘要', system: true },
        submitted_attachment_manifest: { type: 'textarea', label: '提交附件清单', system: true },
      } };
    },
    async findOne(name, query) {
      if (name === 'forge_sales_contract') return query.where.id === contractId ? contract : null;
      if (name === 'sys_file') return files.get(query.where.id) ?? null;
      if (name === 'sys_approval_request') return query.where.id === requestId
        ? { ...request, payload: undefined, payload_json: JSON.stringify(request.payload) } : null;
      if (name === 'forge_sales_contract_revision_material') {
        if (query.where.id) return [...ledger.values()].find((row) => row.id === query.where.id) ?? null;
        if (query.where.approval_request_id) return ledger.get(query.where.approval_request_id) ?? null;
        if (query.where.idempotency_key) return [...ledger.values()].find((row) => row.idempotency_key === query.where.idempotency_key) ?? null;
      }
      if (name === 'sys_attachment') {
        return nativeAttachments.find((row) => row.parent_object === query.where.parent_object &&
          row.parent_id === query.where.parent_id && row.file_id === query.where.file_id) ?? null;
      }
      return null;
    },
    async transaction(callback, _context, options) {
      assert.equal(options.require, true);
      return callback({ isSystem: true }, { owned: true });
    },
    async insert(name, row) {
      if (name === 'sys_attachment') {
        nativeAttachments.push(structuredClone(row));
        return row;
      }
      assert.equal(name, 'forge_sales_contract_revision_material');
      if (ledger.has(row.approval_request_id)) throw new Error('unique approval key');
      ledger.set(row.approval_request_id, structuredClone(row));
      return row;
    },
    async update(name, values) {
      assert.equal(name, 'forge_sales_contract');
      assert.equal(values.id, contractId);
      Object.assign(contract, values);
      return contract;
    },
  };
  const approvals = {
    async getRequest(id) { return relatedRequests.find((item) => item.id === id) ?? null; },
    async listActions() { return actions; },
  };
  const storage = {
    async download(key) { return Buffer.from([...files.values()].find((file) => file.key === key)?.bytes ?? []); },
  };
  const service = new ContractRevisionMaterialService(approvals, engine, storage);
  const input = {
    requestId, returnVersion: 'return-action-A', sourceMaterialVersion: await approvalPayloadVersion(oldPayload),
    idempotencyKey: requestKey,
    primary: { fileId: mainId, name: files.get(mainId).name, sha256: sha256(files.get(mainId).bytes) },
    attachments: [{ fileId: attachmentId, name: files.get(attachmentId).name, sha256: sha256(files.get(attachmentId).bytes) }],
  };
  return { service, engine, approvals, request, files, ledger, actions, relatedRequests, contract, input,
    context: { userId: 'sales-A', tenantId: 'org-A', organizationId: 'org-A', positions: [], permissions: [] } };
}

test('returned submitter prepares one exact material version and same request reuses it', async () => {
  const { service, files, ledger, contract, input, context } = await harness();
  files.get(mainId).mime_type = 'text/plain; charset=utf-8';
  const first = await service.prepare(input, context);
  assert.equal(first.repeated, false);
  assert.equal(first.requestId, requestId);
  assert.match(first.bindingId, /^[0-9a-f-]{36}$/);
  assert.match(first.newVersionDigest, /^[0-9a-f]{64}$/);
  assert.equal(ledger.size, 1);
  assert.equal(contract.submitted_material_id, mainId);
  assert.deepEqual(contract.attachment_ids, [attachmentId]);
  const repeated = await service.prepare(input, context);
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.bindingId, first.bindingId);
  assert.equal(ledger.size, 1);
});

test('same returned request cannot bind a different material or a different request key', async () => {
  const { service, ledger, input, context } = await harness();
  await service.prepare(input, context);
  await assert.rejects(service.prepare({ ...input, idempotencyKey: '44444444-4444-4444-8444-444444444444' }, context), /REVISION_CONFLICT/);
  await assert.rejects(service.prepare({ ...input, attachments: [] }, context), /REVISION_CONFLICT/);
  assert.equal(ledger.size, 1);
});

test('Office primary and attachment preserve MIME, actual byte count, SHA, organization, and same-key identity', async () => {
  const { service, request, files, ledger, context } = await harness();
  const docx = files.get(officePrimaryId);
  const pdf = files.get(officeAttachmentId);
  const input = {
    requestId, returnVersion: 'return-action-A',
    sourceMaterialVersion: await approvalPayloadVersion(request.payload), idempotencyKey: requestKey,
    primary: { fileId: docx.id, name: docx.name, mediaType: docx.mime_type, bytes: docx.bytes.length, sha256: sha256(docx.bytes) },
    attachments: [{ fileId: pdf.id, name: pdf.name, mediaType: pdf.mime_type, bytes: pdf.bytes.length, sha256: sha256(pdf.bytes) }],
  };
  const first = await service.prepare(input, context);
  assert.equal(first.repeated, false);
  assert.equal(ledger.get(requestId).primary_media_type, docx.mime_type);
  assert.equal(ledger.get(requestId).primary_bytes, docx.bytes.length);
  assert.deepEqual(JSON.parse(ledger.get(requestId).attachment_manifest), [{
    fileId: pdf.id, name: pdf.name, mediaType: pdf.mime_type, bytes: pdf.bytes.length, sha256: sha256(pdf.bytes),
  }]);
  const verification = {
    request, actorId: 'sales-A', context, idempotencyKey: requestKey,
    materialBinding: {
      bindingId: first.bindingId, returnVersion: first.returnVersion,
      sourceMaterialVersion: first.sourceMaterialVersion, newVersionDigest: first.newVersionDigest,
    },
  };
  assert.equal(await service.verifyBinding(verification), true, 'native approval guard rechecks both Office originals');
  const repeated = await service.prepare(input, context);
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.bindingId, first.bindingId);

  const otherDocx = files.get(otherOfficePrimaryId);
  await assert.rejects(service.prepare({
    ...input,
    primary: { fileId: otherDocx.id, name: otherDocx.name, mediaType: otherDocx.mime_type,
      bytes: otherDocx.bytes.length, sha256: sha256(otherDocx.bytes) },
  }, context), /REVISION_CONFLICT/);
  await assert.rejects(service.prepare({ ...input, primary: { ...input.primary, bytes: input.primary.bytes + 1 } }, context), /REVISION_MATERIAL_MISMATCH/);
  await assert.rejects(service.prepare(input, { ...context, tenantId: 'other-org', organizationId: 'other-org' }), /REVISION_NOT_AVAILABLE/);
});

test('Office type must match its extension and signature; legacy text remains UTF-8 only', async () => {
  const { service, request, files, ledger, input, context } = await harness();
  const docx = files.get(officePrimaryId);
  const pdf = files.get(officeAttachmentId);
  const officeInput = {
    ...input,
    primary: { fileId: docx.id, name: docx.name, mediaType: docx.mime_type, bytes: docx.bytes.length, sha256: sha256(docx.bytes) },
    attachments: [{ fileId: pdf.id, name: pdf.name, mediaType: pdf.mime_type, bytes: pdf.bytes.length, sha256: sha256(pdf.bytes) }],
  };
  const originalOrganizationId = request.organization_id;
  delete request.organization_id;
  await assert.rejects(service.prepare(officeInput, context), /REVISION_MATERIAL_UNAVAILABLE/);
  request.organization_id = originalOrganizationId;
  await assert.rejects(service.prepare({ ...officeInput, primary: { ...officeInput.primary, mediaType: 'application/pdf' } }, context), /REVISION_MATERIAL_MISMATCH/);
  const priorScope = docx.scope;
  docx.scope = 'user';
  await assert.rejects(service.prepare(officeInput, context), /REVISION_MATERIAL_UNAVAILABLE/);
  docx.scope = priorScope;
  const priorAcl = pdf.acl;
  pdf.acl = 'public';
  await assert.rejects(service.prepare(officeInput, context), /REVISION_MATERIAL_UNAVAILABLE/);
  pdf.acl = priorAcl;
  const priorBytes = Buffer.from(docx.bytes);
  docx.bytes = Buffer.from('not a zip container');
  docx.size = docx.bytes.length;
  await assert.rejects(service.prepare({ ...officeInput, primary: { ...officeInput.primary, bytes: docx.bytes.length, sha256: sha256(docx.bytes) } }, context), /REVISION_MATERIAL_INVALID/);
  docx.bytes = priorBytes;
  docx.size = priorBytes.length;
  await assert.rejects(service.prepare({ ...officeInput, primary: { fileId: docx.id, name: docx.name, sha256: sha256(docx.bytes) } }, context), /REVISION_MATERIAL_INVALID/);
  assert.equal(ledger.size, 0);
  const legacy = await service.prepare(input, context);
  assert.equal(legacy.repeated, false, 'legacy UTF-8 body upload remains accepted');
});

test('a resumed Office revision appears in the next native approval and reads back the exact originals', async () => {
  const { service, engine, approvals, request, files, relatedRequests, contract, context } = await harness();
  const docx = files.get(officePrimaryId);
  const pdf = files.get(officeAttachmentId);
  const input = {
    requestId, returnVersion: 'return-action-A',
    sourceMaterialVersion: await approvalPayloadVersion(request.payload), idempotencyKey: requestKey,
    primary: { fileId: docx.id, name: docx.name, mediaType: docx.mime_type, bytes: docx.bytes.length, sha256: sha256(docx.bytes) },
    attachments: [{ fileId: pdf.id, name: pdf.name, mediaType: pdf.mime_type, bytes: pdf.bytes.length, sha256: sha256(pdf.bytes) }],
  };
  await service.prepare(input, context);
  const nextRequest = {
    ...request,
    id: 'approval-next-office-round',
    status: 'pending',
    viewer: { can_act: true, is_submitter: false },
    record_title: '合同新版本',
    payload: structuredClone(contract),
    payload_labels: { name: '合同名称', code: '合同编号' },
    payload_display: {},
  };
  relatedRequests.push(nextRequest);

  const routes = new Map();
  const server = { get(path, handler) { routes.set(`GET ${path}`, handler); } };
  const sessions = new Map([
    ['reviewer-token', { user: { id: 'delivery-A' }, session: { activeOrganizationId: 'org-A' } }],
  ]);
  const storage = { async download(key) {
    const file = [...files.values()].find((item) => item.key === key);
    if (!file) throw new Error('missing storage object');
    return Buffer.from(file.bytes);
  } };
  let ready;
  const contextPlugin = {
    getService(name) {
      const services = {
        'http.server': server,
        auth: { api: { async getSession({ headers }) { return sessions.get(headers.get('authorization')?.slice(7)) ?? null; } } },
        objectql: engine, approvals, storage,
      };
      if (!(name in services)) throw new Error(`missing service ${name}`);
      return services[name];
    },
    getKernel() { return {}; },
    hook(name, callback) { if (name === 'kernel:ready') ready = callback; },
    logger: { error() {}, info() {} },
  };
  new ApprovalWorkbenchContextPlugin().init(contextPlugin);
  await ready();

  async function invoke(method, route, params, headers = {}) {
    const handler = routes.get(`${method} ${route}`);
    assert.ok(handler, `${method} ${route} is mounted`);
    let status = 200;
    let response;
    const responseHeaders = {};
    await handler({ method, path: route, params, query: {}, body: undefined,
      headers: { authorization: 'Bearer reviewer-token', ...headers } }, {
      status(value) { status = value; return this; },
      header(name, value) { responseHeaders[name] = value; return this; },
      json(value) { response = value; return this; },
      send(value) { response = Buffer.from(value); return this; },
    });
    return { status, body: response, headers: responseHeaders };
  }

  const contextPath = '/api/v1/approvals/requests/:requestId/workbench-context';
  const current = await invoke('GET', contextPath, { requestId: nextRequest.id });
  assert.equal(current.status, 200, JSON.stringify(current.body));
  assert.deepEqual(current.body.originalFiles.map((file) => file.fileId).sort(), [docx.id, pdf.id].sort());
  assert.ok(current.body.originalFiles.every((file) => file.requestId === nextRequest.id && file.sourceKind === 'approval'));
  for (const file of [docx, pdf]) {
    const original = await invoke('GET', '/api/v1/approvals/requests/:requestId/workbench-context/files/:fileId/original',
      { requestId: nextRequest.id, fileId: file.id }, { 'if-match': `"${sha256(file.bytes)}"` });
    assert.equal(original.status, 200, JSON.stringify(original.body));
    assert.deepEqual(original.body, file.bytes);
    assert.equal(original.headers['X-Content-SHA256'], sha256(file.bytes));
  }
});

test('the native approval guard verifies the persisted binding and current file bytes', async () => {
  const { service, request, files, ledger, input, context } = await harness();
  const binding = await service.prepare(input, context);
  delete ledger.get(requestId).primary_media_type;
  delete ledger.get(requestId).primary_bytes;
  const verification = {
    request, actorId: 'sales-A', context, idempotencyKey: input.idempotencyKey,
    materialBinding: {
      bindingId: binding.bindingId, returnVersion: binding.returnVersion,
      sourceMaterialVersion: binding.sourceMaterialVersion, newVersionDigest: binding.newVersionDigest,
    },
  };
  assert.equal(await service.verifyBinding(verification), true);
  assert.equal(await service.verifyBinding({ ...verification, actorId: 'other-employee' }), false);
  files.get(attachmentId).bytes[0] = 0x58;
  assert.equal(await service.verifyBinding(verification), false);
  files.get(attachmentId).bytes[0] = Buffer.from('技术附件 A', 'utf8')[0];
  ledger.get(requestId).new_version_digest = 'f'.repeat(64);
  assert.equal(await service.verifyBinding(verification), false);
});

test('lost response is reconciled from native action and next-round request without replaying resubmit', async () => {
  const { service, actions, relatedRequests, input, context } = await harness();
  const binding = await service.prepare(input, context);
  assert.equal((await service.receipt(requestId, input.idempotencyKey, context))?.state, 'prepared');
  assert.equal(await service.receipt(requestId, '44444444-4444-4444-8444-444444444444', context), null);
  actions.push({ id: 'resubmit-action-A', action: 'resubmit' });
  assert.equal((await service.receipt(requestId, input.idempotencyKey, context))?.state, 'resume_unknown');
  relatedRequests.push({ id: 'approval-round-2', object_name: 'forge_sales_contract', record_id: contractId,
    flow_run_id: 'run-A', flow_node_id: 'contract_review', node_config_json: JSON.stringify({ __round: 2 }),
    created_at: '2026-09-23T10:01:00.000Z' });
  const outcome = await service.receipt(requestId, input.idempotencyKey, context);
  assert.deepEqual(outcome, {
    requestId, bindingId: binding.bindingId, newVersionDigest: binding.newVersionDigest,
    state: 'resumed', repeated: true,
  });
});

test('foreign owner, changed bytes and stale return decision cannot create a binding', async () => {
  const { service, files, ledger, input, context } = await harness();
  await assert.rejects(service.prepare(input, { ...context, userId: 'other-employee' }), /REVISION_NOT_AVAILABLE/);
  files.get(mainId).owner_id = 'other-employee';
  await assert.rejects(service.prepare(input, context), /REVISION_MATERIAL_UNAVAILABLE/);
  files.get(mainId).owner_id = 'sales-A';
  files.get(mainId).bytes[0] = 0x58;
  await assert.rejects(service.prepare(input, context), /REVISION_MATERIAL_MISMATCH/);
  files.get(mainId).bytes[0] = Buffer.from('修订合同 A', 'utf8')[0];
  await assert.rejects(service.prepare({ ...input, returnVersion: 'older-return' }, context), /REVISION_STALE/);
  assert.equal(ledger.size, 0);
});
