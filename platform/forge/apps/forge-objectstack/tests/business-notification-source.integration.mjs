import assert from 'node:assert/strict';
import test from 'node:test';
import { WeaveRunEventPlugin } from '../src/plugins/weave-run-event.plugin.ts';

const notificationId = 'Bz6TFrP02xL8s9yQ';
const contractId = 'a56c45af-a536-4c8e-a431-97f448f1f00a';
const approvalRequestId = 'approval-r2';
const sourceFiles = [
  {
    id: '71abc177-9076-47ec-8812-ccbbd8a96c1d', name: 'R1-正文.docx',
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 101,
    sha256: '1'.repeat(64), status: 'deleted',
  },
  {
    id: '72abc177-9076-47ec-8812-ccbbd8a96c1d', name: 'R1-技术.pdf',
    mime_type: 'application/pdf', size: 102, sha256: '2'.repeat(64), status: 'deleted',
  },
  {
    id: '81abc177-9076-47ec-8812-ccbbd8a96c1d', name: 'R2-正文.docx',
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 201,
    sha256: '3'.repeat(64), status: 'committed',
  },
  {
    id: '82abc177-9076-47ec-8812-ccbbd8a96c1d', name: 'R2-技术.pdf',
    mime_type: 'application/pdf', size: 202, sha256: '4'.repeat(64), status: 'committed',
  },
  {
    id: '83abc177-9076-47ec-8812-ccbbd8a96c1d', name: 'R2-指标.pdf',
    mime_type: 'application/pdf', size: 203, sha256: '5'.repeat(64), status: 'committed',
  },
].map((file) => ({
  ...file, owner_id: 'employee-a', organization_id: 'org-a', scope: 'attachments', acl: 'private',
}));

const initialSubmission = {
  id: 'submission-r1', contract_id: contractId, organization_id: 'org-a', submitted_by: 'employee-a',
  material_file_id: sourceFiles[0].id, material_name: sourceFiles[0].name, material_sha256: sourceFiles[0].sha256,
  material_manifest: JSON.stringify([
    { file_id: sourceFiles[0].id, name: sourceFiles[0].name, media_type: sourceFiles[0].mime_type, bytes: sourceFiles[0].size, sha256: sourceFiles[0].sha256 },
    { file_id: sourceFiles[1].id, name: sourceFiles[1].name, media_type: sourceFiles[1].mime_type, bytes: sourceFiles[1].size, sha256: sourceFiles[1].sha256 },
  ]),
  package_sha256: 'a'.repeat(64),
};

const revision = {
  id: 'revision-r2', contract_id: contractId, approval_request_id: approvalRequestId,
  organization_id: 'org-a', submitted_by: 'employee-a',
  primary_file_id: sourceFiles[2].id, primary_name: sourceFiles[2].name,
  primary_media_type: sourceFiles[2].mime_type, primary_bytes: sourceFiles[2].size,
  primary_sha256: sourceFiles[2].sha256,
  attachment_manifest: JSON.stringify([
    { fileId: sourceFiles[3].id, name: sourceFiles[3].name, mediaType: sourceFiles[3].mime_type, bytes: sourceFiles[3].size, sha256: sourceFiles[3].sha256 },
    { fileId: sourceFiles[4].id, name: sourceFiles[4].name, mediaType: sourceFiles[4].mime_type, bytes: sourceFiles[4].size, sha256: sourceFiles[4].sha256 },
  ]),
};

const contract = {
  id: contractId, organization_id: 'org-a', owner_id: 'employee-a', status: 'approved',
  submitted_material_id: sourceFiles[2].id, submitted_material_name: sourceFiles[2].name,
  submitted_material_sha256: sourceFiles[2].sha256,
  submitted_attachment_revision_request_id: approvalRequestId,
  submitted_attachment_manifest: JSON.stringify([
    { file_id: sourceFiles[3].id, name: sourceFiles[3].name, sha256: sourceFiles[3].sha256 },
    { file_id: sourceFiles[4].id, name: sourceFiles[4].name, sha256: sourceFiles[4].sha256 },
  ]),
};

function harness() {
  const routes = new Map();
  const sessions = new Map([
    ['owner', { user: { id: 'employee-a' }, session: { activeOrganizationId: 'org-a' } }],
    ['unrelated', { user: { id: 'employee-b' }, session: { activeOrganizationId: 'org-a' } }],
    ['other-org', { user: { id: 'employee-a' }, session: { activeOrganizationId: 'org-b' } }],
  ]);
  const inbox = { notification_id: notificationId, user_id: 'employee-a', organization_id: 'org-a', topic: 'forge.sales.contract.approved' };
  const notice = {
    id: notificationId, organization_id: 'org-a', topic: inbox.topic,
    source_object: 'forge_sales_contract', source_id: contractId,
    // These values deliberately disagree with the native source columns.
    payload: { body: '错误合同记录 aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actionUrl: '/contracts/wrong-record' },
  };
  const currentContract = { ...contract };
  const attachments = sourceFiles.map((file, index) => ({
    id: `holder-${index}`, parent_object: index < 2 ? 'forge_sales_contract_submission' : 'forge_sales_contract_revision_material',
    parent_id: index < 2 ? 'submission-r1' : 'revision-r2', file_id: file.id,
    file_name: file.name, mime_type: file.mime_type, size: file.size, uploaded_by: 'employee-a',
  }));
  const reads = [];
  let contractReadFailure;
  const engine = {
    async find(objectName, query, options) {
      reads.push({ method: 'find', objectName, query, options });
      if (objectName === 'sys_inbox_message' && query.where.notification_id === notificationId && query.where.user_id === inbox.user_id) return [{ ...inbox }];
      if (objectName === 'forge_sales_contract_revision_material' && query.where.contract_id === contractId) return [{ ...revision }];
      return [];
    },
    async findOne(objectName, query, options) {
      reads.push({ method: 'findOne', objectName, query, options });
      if (objectName === 'sys_notification' && query.where.id === notificationId) return { ...notice };
      if (objectName === 'forge_sales_contract' && query.where.id === contractId) {
        if (contractReadFailure) throw contractReadFailure;
        return options?.context?.userId === 'employee-a' && options.context.tenantId === 'org-a' ? { ...currentContract } : null;
      }
      if (objectName === 'forge_sales_lead' && query.where.id === contractId) {
        return options?.context?.userId === 'employee-a' && options.context.tenantId === 'org-a'
          ? { id: contractId, organization_id: 'org-a' } : null;
      }
      if (objectName === 'forge_sales_contract_submission' && query.where.contract_id === contractId) return { ...initialSubmission };
      if (objectName === 'forge_sales_contract_revision_material' && query.where.contract_id === contractId && query.where.approval_request_id === approvalRequestId) return { ...revision };
      if (objectName === 'sys_attachment') return attachments.find((row) =>
        row.parent_object === query.where.parent_object && row.parent_id === query.where.parent_id && row.file_id === query.where.file_id) ?? null;
      if (objectName === 'sys_file') return sourceFiles.find((row) => row.id === query.where.id) ?? null;
      return null;
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
    inbox, notice, contract: currentContract, reads, attachments, sourceFiles,
    setContractReadFailure(error) { contractReadFailure = error; },
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

test('native business notification returns its recorded source and only the exact current revision material package', async () => {
  const h = harness();
  const result = await h.call('owner');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    version: '1', notificationId, kind: 'business',
    source: { system: 'forge', objectName: 'forge_sales_contract', recordId: contractId },
    materialStatus: 'available',
    originalFiles: [sourceFiles[2], sourceFiles[3], sourceFiles[4]].map(({ id, name, mime_type, size, sha256 }) => ({
      sourceKind: 'owner', fileId: id, name, mediaType: mime_type, bytes: size, sha256,
    })),
  });
  assert.ok(result.body.originalFiles.every((file) => !Object.hasOwn(file, 'requestId')));
  assert.ok(result.body.originalFiles.every((file) => !file.fileId.startsWith('71') && !file.fileId.startsWith('72')));
  const contractRead = h.reads.find((read) => read.method === 'findOne' && read.objectName === 'forge_sales_contract');
  assert.equal(contractRead.options.context.userId, 'employee-a');
  assert.equal(contractRead.options.context.tenantId, 'org-a');
  assert.notEqual(contractRead.options.context.isSystem, true);
  assert.equal(h.reads.find((read) => read.objectName === 'sys_notification').query.fields.includes('source_object'), true);
  const materialReadIndex = h.reads.findIndex((read) => read.objectName === 'forge_sales_contract_revision_material');
  assert.ok(h.reads.indexOf(contractRead) < materialReadIndex, 'the employee-visible business read must precede any privileged material lookup');
  assert.equal(result.body.source.recordId, contractId);
  assert.equal(result.body.source.recordId === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
});

test('native source is hidden from nonrecipients, another organization, and recipients without native record access', async () => {
  const h = harness();
  assert.equal((await h.call('unrelated')).status, 404);
  assert.equal((await h.call('other-org')).status, 404);

  h.inbox.user_id = 'employee-b';
  const denied = await h.call('unrelated');
  assert.equal(denied.status, 404);
  const deniedRecordRead = h.reads.find((read) => read.method === 'findOne' && read.objectName === 'forge_sales_contract' && read.options.context.userId === 'employee-b');
  assert.ok(deniedRecordRead, 'record must be re-read with the notification recipient context');
  assert.notEqual(deniedRecordRead.options.context.isSystem, true);
  assert.equal(h.reads.some((read) => read.objectName === 'forge_sales_contract_revision_material'), false);
});

test('missing current holder returns unavailable without fabricating an old file or digest', async () => {
  const h = harness();
  h.attachments.splice(h.attachments.findIndex((row) => row.file_id === sourceFiles[3].id), 1);
  const result = await h.call('owner');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.materialStatus, 'unavailable');
  assert.deepEqual(result.body.originalFiles, []);
  assert.equal(result.body.originalFiles.some((file) => file.fileId === sourceFiles[0].id), false);
});

test('a business source without an implemented domain material projection reports unavailable', async () => {
  const h = harness();
  h.notice.source_object = 'forge_sales_lead';
  h.notice.source_id = contractId;
  const result = await h.call('owner');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    version: '1', notificationId, kind: 'business',
    source: { system: 'forge', objectName: 'forge_sales_lead', recordId: contractId },
    materialStatus: 'unavailable', originalFiles: [],
  });
});

test('message text cannot substitute for absent native source columns', async () => {
  const h = harness();
  h.notice.source_object = null;
  h.notice.source_id = null;
  assert.equal((await h.call('owner')).status, 404);
});

test('system objects cannot be projected as business notification sources', async () => {
  const h = harness();
  h.notice.source_object = 'sys_user';
  h.notice.source_id = 'employee-a';
  assert.equal((await h.call('owner')).status, 404);
  assert.equal(h.reads.some((read) => read.objectName === 'sys_user' && read.options?.context?.userId === 'employee-a'), false);
});

test('only explicit native denial/not-found maps to hidden source; infrastructure failures stay unavailable', async () => {
  const denied = harness();
  denied.setContractReadFailure(Object.assign(new Error('record read denied'), { code: 'PERMISSION_DENIED' }));
  assert.equal((await denied.call('owner')).status, 404);

  const unavailable = harness();
  unavailable.setContractReadFailure(Object.assign(new Error('database connection lost'), { code: 'DATABASE_UNAVAILABLE' }));
  const result = await unavailable.call('owner');
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: { code: 'TEAM_MESSAGE_UNAVAILABLE' } });
});

test('a draft with no frozen package reports none', async () => {
  const h = harness();
  h.contract.status = 'draft';
  delete h.contract.submitted_material_id;
  delete h.contract.submitted_material_name;
  delete h.contract.submitted_material_sha256;
  delete h.contract.submitted_attachment_revision_request_id;
  delete h.contract.submitted_attachment_manifest;
  const result = await h.call('owner');
  assert.equal(result.status, 200);
  assert.equal(result.body.materialStatus, 'none');
  assert.deepEqual(result.body.originalFiles, []);
});
