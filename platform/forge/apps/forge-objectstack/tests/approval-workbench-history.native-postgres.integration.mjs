import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectQL } from '@objectstack/objectql';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { ContractType, SalesContract, SalesContractRevisionMaterial, SalesContractSubmission } from '../src/objects/sales.object.ts';
import { ApprovalWorkbenchContextPlugin } from '../src/plugins/approval-workbench-context.plugin.ts';
import { WorkbenchOwnedMaterialPlugin } from '../src/plugins/workbench-owned-material.plugin.ts';
import { retainContractMaterialFiles } from '../src/plugins/contract-material-holder.ts';

const DATABASE = 'forge_material_holder_test';
const HOST = '127.0.0.1';
const PORT = Number(process.env.FORGE_CONTRACT_MATERIAL_PG_PORT || 55439);
const SYSTEM = { isSystem: true, positions: [], permissions: [] };
const CONTRACT_OBJECT = 'forge_sales_contract';
const ORIGINAL_MEDIA_TYPE = 'application/pdf';
const serviceStoragePath = '../node_modules/.pnpm/@objectstack+service-storage@17.3.0/node_modules/@objectstack/service-storage/dist/index.js';
const platformObjectsPath = '../node_modules/.pnpm/@objectstack+platform-objects@17.3.0/node_modules/@objectstack/platform-objects/dist/index.mjs';
const { LocalStorageAdapter, SystemFile, installAttachmentLifecycleHooks, installFileReferenceHooks } = await import(serviceStoragePath);
const { SysAttachment } = await import(platformObjectsPath);

function id() { return randomUUID(); }

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function simpleObject(name, fields) {
  return ObjectSchema.create({
    name, label: name,
    fields: { ...fields, organization_id: Field.text({ label: 'Organization ID' }) },
    enable: { apiEnabled: true },
  });
}

function fixtureObjects() {
  const TestContractType = ObjectSchema.create({
    ...ContractType,
    fields: { ...ContractType.fields, organization_id: Field.text({ label: 'Organization ID' }) },
  });
  const TestSalesContract = ObjectSchema.create({
    ...SalesContract,
    fields: {
      ...SalesContract.fields,
      owner_id: Field.lookup('sys_user', { label: 'Owner' }),
      organization_id: Field.text({ label: 'Organization ID' }),
    },
  });
  const TestSystemFile = ObjectSchema.create({
    ...SystemFile,
    fields: { ...SystemFile.fields, organization_id: Field.text({ label: 'Organization ID' }) },
  });
  return [
    TestContractType,
    simpleObject('forge_customer', { name: Field.text({ label: 'Name', required: true }) }),
    simpleObject('sys_user', { name: Field.text({ label: 'Name' }), email: Field.email({ label: 'Email' }) }),
    simpleObject('sys_member', { user_id: Field.text({ label: 'User ID' }), role: Field.text({ label: 'Role' }) }),
    simpleObject('sys_user_position', { user_id: Field.text({ label: 'User ID' }), position_id: Field.text({ label: 'Position ID' }) }),
    simpleObject('sys_user_permission_set', { user_id: Field.text({ label: 'User ID' }), permission_set_id: Field.text({ label: 'Permission Set ID' }) }),
    simpleObject('sys_position', { name: Field.text({ label: 'Position Name' }) }),
    TestSystemFile,
    SysAttachment,
    TestSalesContract,
    SalesContractSubmission,
    SalesContractRevisionMaterial,
  ];
}

function approvalRequest(ids, material) {
  return {
    id: ids.request,
    organization_id: ids.organization,
    process_name: 'flow:contract_approval',
    object_name: CONTRACT_OBJECT,
    record_id: ids.contract,
    submitter_id: ids.submitter,
    status: 'returned',
    current_step: 'review',
    step_label: '合同复核',
    record_title: '历史版本合同',
    object_label: '销售合同',
    payload: {
      submitted_material_id: material.fileId,
      submitted_material_name: material.name,
      submitted_material_sha256: material.sha256,
      attachment_ids: [],
      submitted_attachment_manifest: '[]',
    },
    pending_approvers: [ids.unactedApprover],
  };
}

function approvalServices(request, ids, actions) {
  const calls = { getRequest: [], listActions: [], decisions: 0 };
  return {
    calls,
    service: {
      async getRequest(requestId, context) {
        calls.getRequest.push({ requestId, userId: context.userId, organizationId: context.tenantId || context.organizationId });
        if (requestId !== request.id) return null;
        return {
          ...request,
          viewer: {
            can_act: false,
            is_submitter: context.userId === ids.submitter,
            can_override: context.userId === ids.admin,
          },
        };
      },
      async listActions(requestId, context) {
        calls.listActions.push({ requestId, userId: context.userId, organizationId: context.tenantId || context.organizationId });
        return requestId === request.id ? actions : [];
      },
      async decide() { calls.decisions += 1; throw new Error('history reads must not decide approvals'); },
    },
  };
}

function harness({ engine, storage, approvals, ids }) {
  const sessions = new Map([
    ['submitter-token', { user: { id: ids.submitter }, session: { activeOrganizationId: ids.organization } }],
    ['reviewer-token', { user: { id: ids.reviewer }, session: { activeOrganizationId: ids.organization } }],
    ['unacted-reviewer-token', { user: { id: ids.unactedApprover }, session: { activeOrganizationId: ids.organization } }],
    ['admin-token', { user: { id: ids.admin }, session: { activeOrganizationId: ids.organization } }],
    ['other-org-token', { user: { id: ids.reviewer }, session: { activeOrganizationId: id() } }],
    ['other-owner-token', { user: { id: id() }, session: { activeOrganizationId: ids.organization } }],
  ]);
  const routes = new Map();
  const readyHooks = [];
  const server = {
    get(path, handler) { routes.set(`GET ${path}`, handler); },
  };
  const context = {
    getService(name) {
      const services = {
        'http.server': server,
        auth: { api: { async getSession({ headers }) { return sessions.get(headers.get('authorization')?.slice(7)) ?? null; } } },
        objectql: engine,
        storage,
        approvals,
      };
      if (!(name in services)) throw new Error(`service unavailable: ${name}`);
      return services[name];
    },
    getKernel() { return {}; },
    hook(name, handler) { if (name === 'kernel:ready') readyHooks.push(handler); },
    logger: { error() {}, info() {} },
  };
  new ApprovalWorkbenchContextPlugin().init(context);
  new WorkbenchOwnedMaterialPlugin().init(context);

  async function call(method, route, params, token, digest) {
    const handler = routes.get(`${method} ${route}`);
    assert.ok(handler, `route mounted: ${method} ${route}`);
    let status = 200, body, raw;
    const headers = {};
    const response = {
      status(value) { status = value; return this; },
      header(name, value) { headers[name.toLowerCase()] = value; return this; },
      json(value) { body = value; },
      send(value) { raw = Buffer.from(value); },
    };
    await handler({
      params,
      headers: {
        authorization: `Bearer ${token}`,
        ...(digest ? { 'if-match': `"${digest}"` } : {}),
      },
    }, response);
    return { status, body, raw, headers };
  }

  return {
    routes,
    async start() { await Promise.all(readyHooks.map((ready) => ready())); },
    callHistory(token, fileId, digest) {
      return call('GET', '/api/v1/approvals/requests/:requestId/workbench-history/files/:fileId/original',
        { requestId: ids.request, fileId }, token, digest);
    },
    callCurrentContext(token) {
      return call('GET', '/api/v1/approvals/requests/:requestId/workbench-context', { requestId: ids.request }, token);
    },
    callCurrentOriginal(token, fileId, digest) {
      return call('GET', '/api/v1/approvals/requests/:requestId/workbench-context/files/:fileId/original',
        { requestId: ids.request, fileId }, token, digest);
    },
    callOwnerOriginal(token, fileId, digest) {
      return call('GET', '/api/v1/workbench/materials/:fileId/original', { fileId }, token, digest);
    },
  };
}

test('historical approval and owner routes read deleted contract originals only through frozen ledger holders', {
  skip: process.env.FORGE_CONTRACT_MATERIAL_PG_TEST !== '1'
    ? 'set FORGE_CONTRACT_MATERIAL_PG_TEST=1 for the isolated local PostgreSQL run'
    : false,
  timeout: 120_000,
}, async (t) => {
  assert.ok(Number.isInteger(PORT) && PORT > 0 && PORT < 65536, 'FORGE_CONTRACT_MATERIAL_PG_PORT must be a valid local PostgreSQL port');
  const storageRoot = mkdtempSync(join(tmpdir(), 'forge-approval-history-storage-'));
  const storage = new LocalStorageAdapter({ rootDir: storageRoot });
  const storageReads = [];
  const download = storage.download.bind(storage);
  storage.download = async (key) => {
    storageReads.push(key);
    return download(key);
  };
  const engine = new ObjectQL();
  const driver = new SqlDriver({ client: 'pg', connection: {
    host: HOST, port: PORT, database: DATABASE,
    user: process.env.FORGE_CONTRACT_MATERIAL_PG_USER || 'postgres',
  } });
  const objects = fixtureObjects();
  for (const object of objects) engine.registerObject(object);
  engine.registerDriver(driver, true);
  await engine.init();
  await driver.initObjects(objects);
  engine.isFileReferencesMigrationVerified = async () => true;
  const logger = { info() {}, warn(message) { throw new Error(message); }, debug() {} };
  installFileReferenceHooks(engine, () => storage, logger);
  installAttachmentLifecycleHooks(engine, logger);
  t.after(async () => {
    await driver.disconnect();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  const ids = {
    organization: id(), customer: id(), type: id(), submitter: id(), reviewer: id(),
    unactedApprover: id(), admin: id(), contract: id(), submission: id(), request: `history-${id()}`,
    oldFile: id(), currentFile: id(),
  };
  const tenantContext = { ...SYSTEM, tenantId: ids.organization };
  const oldBytes = Buffer.from('%PDF-1.7\nfirst approval round original bytes');
  const currentBytes = Buffer.from('%PDF-1.7\ncurrent contract original bytes');
  const oldKey = `attachments/${ids.oldFile}/R1合同.pdf`;
  const currentKey = `attachments/${ids.currentFile}/R2合同.pdf`;
  const oldDigest = sha256(oldBytes);
  const currentDigest = sha256(currentBytes);
  await storage.upload(oldKey, oldBytes, { contentType: ORIGINAL_MEDIA_TYPE });
  await storage.upload(currentKey, currentBytes, { contentType: ORIGINAL_MEDIA_TYPE });
  for (const [fileId, key, name, bytes] of [
    [ids.oldFile, oldKey, 'R1合同.pdf', oldBytes],
    [ids.currentFile, currentKey, 'R2合同.pdf', currentBytes],
  ]) {
    await engine.insert('sys_file', {
      id: fileId, key, name, mime_type: ORIGINAL_MEDIA_TYPE, size: bytes.length,
      scope: 'attachments', acl: 'private', status: 'committed', owner_id: ids.submitter,
      organization_id: ids.organization,
    }, { context: tenantContext });
  }
  await engine.insert('sys_user', { id: ids.submitter, name: 'Submitter', email: `${ids.submitter}@example.invalid`, organization_id: ids.organization }, { context: tenantContext });
  await engine.insert('forge_customer', { id: ids.customer, name: 'Customer', organization_id: ids.organization }, { context: tenantContext });
  await engine.insert('forge_contract_type', { id: ids.type, name: 'Sales Contract', organization_id: ids.organization }, { context: tenantContext });
  await engine.insert(CONTRACT_OBJECT, {
    id: ids.contract, name: 'Historical material test', code: `HT-${ids.contract}`,
    contract_type_id: ids.type, customer_id: ids.customer, responsible_id: ids.submitter,
    owner_id: ids.submitter, organization_id: ids.organization,
    status: 'pending_approval', requires_legal_review: false,
    submitted_material_id: ids.oldFile, submitted_material_name: 'R1合同.pdf', submitted_material_sha256: oldDigest,
    attachment_ids: [], submitted_attachment_manifest: '[]',
  }, { context: tenantContext });

  const frozenFiles = [{
    fileId: ids.oldFile, name: 'R1合同.pdf', mediaType: ORIGINAL_MEDIA_TYPE, bytes: oldBytes.length, sha256: oldDigest,
  }];
  await engine.insert('forge_sales_contract_submission', {
    id: ids.submission, name: 'Historical material test R1', contract_id: ids.contract,
    material_file_id: ids.oldFile, material_name: frozenFiles[0].name, material_sha256: oldDigest,
    material_manifest: JSON.stringify(frozenFiles.map((file) => ({
      file_id: file.fileId, name: file.name, media_type: file.mediaType, bytes: file.bytes, sha256: file.sha256, role: 'primary',
    }))),
    package_sha256: sha256(Buffer.from(JSON.stringify(frozenFiles))),
    organization_id: ids.organization, submitted_by: ids.submitter, submitted_at: new Date().toISOString(),
  }, { context: tenantContext });
  await retainContractMaterialFiles(engine, {
    parentObject: 'forge_sales_contract_submission', parentId: ids.submission,
    submitterId: ids.submitter, files: frozenFiles, context: tenantContext,
  });
  await engine.update(CONTRACT_OBJECT, {
    id: ids.contract, submitted_material_id: ids.currentFile,
    submitted_material_name: 'R2合同.pdf', submitted_material_sha256: currentDigest,
    attachment_ids: [], submitted_attachment_manifest: '[]',
  }, { context: tenantContext });
  await engine.update('sys_file', { id: ids.oldFile, status: 'deleted' }, { context: SYSTEM });

  const deleted = await engine.findOne('sys_file', { where: { id: ids.oldFile } }, { context: SYSTEM });
  const holder = await engine.findOne('sys_attachment', {
    where: { parent_object: 'forge_sales_contract_submission', parent_id: ids.submission, file_id: ids.oldFile },
  }, { context: SYSTEM });
  assert.equal(deleted.status, 'deleted');
  assert.ok(holder, 'the real native sys_attachment row retains this immutable submission version');
  assert.equal(await storage.exists(deleted.key), true, 'the local blob remains available before the native holder GC grace window expires');

  const frozenRequest = approvalRequest(ids, { fileId: ids.oldFile, name: 'R1合同.pdf', sha256: oldDigest });
  const actions = [
    { id: id(), request_id: ids.request, action: 'revise', actor_id: ids.reviewer },
    { id: id(), request_id: ids.request, action: 'resubmit', actor_id: ids.submitter, via_override: false },
  ];
  const approvalHarness = approvalServices(frozenRequest, ids, actions);
  const work = harness({ engine, storage, approvals: approvalHarness.service, ids });
  await work.start();

  const original = await work.callHistory('reviewer-token', ids.oldFile, oldDigest);
  assert.equal(original.status, 200);
  assert.deepEqual(original.raw, oldBytes);
  assert.deepEqual(approvalHarness.calls.getRequest[0], {
    requestId: ids.request, userId: ids.reviewer, organizationId: ids.organization,
  }, 'the native ApprovalService receives the Bearer-derived employee and organization');
  assert.equal(original.headers['content-type'], ORIGINAL_MEDIA_TYPE);
  assert.equal(original.headers['content-length'], String(oldBytes.length));
  assert.equal(original.headers.etag, `"${oldDigest}"`);
  assert.equal(original.headers['x-content-sha256'], oldDigest);
  assert.equal(original.headers['cache-control'], 'private, no-store');
  assert.equal(original.headers['x-content-type-options'], 'nosniff');

  const submitterOriginal = await work.callHistory('submitter-token', ids.oldFile, oldDigest);
  assert.equal(submitterOriginal.status, 200);
  assert.deepEqual(submitterOriginal.raw, oldBytes);
  assert.equal((await work.callHistory('reviewer-token', ids.oldFile, 'f'.repeat(64))).status, 409,
    'If-Match must equal the SHA frozen in this approval round');
  assert.equal((await work.callHistory('unacted-reviewer-token', ids.oldFile, oldDigest)).status, 404,
    'current or previously unacted approver slots do not prove historical participation');
  assert.equal((await work.callHistory('admin-token', ids.oldFile, oldDigest)).status, 404,
    'an admin override capability does not grant historical material access');
  assert.equal((await work.callHistory('other-org-token', ids.oldFile, oldDigest)).status, 404,
    'the approval must belong to the Bearer session organization');
  assert.equal((await work.callHistory('reviewer-token', ids.currentFile, currentDigest)).status, 404,
    'a live contract file absent from this round snapshot cannot be guessed as historical material');

  const resubmitAction = actions.pop();
  const currentRoundOriginal = await work.callCurrentOriginal('submitter-token', ids.oldFile, oldDigest);
  assert.equal(currentRoundOriginal.status, 200, 'a not-yet-resubmitted current approval can read a deleted original through its valid holder');
  assert.deepEqual(currentRoundOriginal.raw, oldBytes);
  actions.push(resubmitAction);
  const currentContext = await work.callCurrentContext('submitter-token');
  assert.equal(currentContext.status, 409, 'the current continuation context remains stale after the request was resubmitted');
  const currentOriginalAfterResubmit = await work.callCurrentOriginal('submitter-token', ids.oldFile, oldDigest);
  assert.equal(currentOriginalAfterResubmit.status, 409, 'the current original route remains stale after the request was resubmitted');
  assert.equal(approvalHarness.calls.decisions, 0, 'history access is read-only and never invokes an approval decision');
  assert.ok(work.routes.has('GET /api/v1/approvals/requests/:requestId/workbench-history/files/:fileId/original'));
  assert.equal([...work.routes.keys()].some((route) => route.startsWith('POST /api/v1/approvals/requests/')), false,
    'the history plugin exposes no approval action route');

  const ownerOriginal = await work.callOwnerOriginal('submitter-token', ids.oldFile, oldDigest);
  assert.equal(ownerOriginal.status, 200, 'the owner can reopen a deleted old original using its immutable holder');
  assert.deepEqual(ownerOriginal.raw, oldBytes);
  assert.equal((await work.callOwnerOriginal('other-owner-token', ids.oldFile, oldDigest)).status, 404);
  const currentOwnerOriginal = await work.callOwnerOriginal('submitter-token', ids.currentFile, currentDigest);
  assert.equal(currentOwnerOriginal.status, 200, 'the owner keeps the existing read path for the current committed file');
  assert.deepEqual(currentOwnerOriginal.raw, currentBytes);

  const finalDeleted = await engine.findOne('sys_file', { where: { id: ids.oldFile } }, { context: SYSTEM });
  assert.equal(finalDeleted.status, 'deleted', 'read-only routes do not change file or approval state');
  await engine.update('sys_attachment', { id: holder.id, file_name: 'holder-mismatch.pdf' }, { context: SYSTEM });
  const storageReadsBeforeMismatch = storageReads.length;
  const mismatchedHolder = await work.callHistory('reviewer-token', ids.oldFile, oldDigest);
  assert.equal(mismatchedHolder.status, 404, 'a holder row that disagrees with the immutable version ledger is not valid authority');
  assert.equal(storageReads.length, storageReadsBeforeMismatch, 'invalid holder metadata is rejected before reading the blob');
  const resubmit = actions.pop();
  assert.equal((await work.callCurrentOriginal('submitter-token', ids.oldFile, oldDigest)).status, 404,
    'the current approval route also refuses a deleted original whose native holder no longer matches');
  assert.equal((await work.callOwnerOriginal('submitter-token', ids.oldFile, oldDigest)).status, 404,
    'the owner route refuses a deleted original after its valid holder is removed');
  actions.push(resubmit);
});
