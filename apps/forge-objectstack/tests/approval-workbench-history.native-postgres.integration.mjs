import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectQL } from '@objectstack/objectql';
import { ApprovalService, SysApprovalAction, SysApprovalApprover, SysApprovalRequest } from '@objectstack/plugin-approvals';
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
const serviceStoragePath = '../node_modules/.pnpm/@objectstack+service-storage@17.5.0/node_modules/@objectstack/service-storage/dist/index.js';
const platformObjectsPath = '../node_modules/.pnpm/@objectstack+platform-objects@17.5.0/node_modules/@objectstack/platform-objects/dist/index.mjs';
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

function nativeObject(name, fields) {
  return ObjectSchema.create({ name, label: name, fields, enable: { apiEnabled: true } });
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
    simpleObject('sys_organization', { name: Field.text({ label: 'Name' }) }),
    simpleObject('sys_member', { user_id: Field.text({ label: 'User ID' }), role: Field.text({ label: 'Role' }) }),
    simpleObject('sys_user_position', {
      user_id: Field.text({ label: 'User ID' }),
      position_id: Field.text({ label: 'Position ID' }),
      position: Field.text({ label: 'Position' }),
    }),
    simpleObject('sys_user_permission_set', { user_id: Field.text({ label: 'User ID' }), permission_set_id: Field.text({ label: 'Permission Set ID' }) }),
    simpleObject('sys_position', { name: Field.text({ label: 'Position Name' }) }),
    nativeObject('sys_approval_request', SysApprovalRequest.fields),
    nativeObject('sys_approval_action', SysApprovalAction.fields),
    nativeObject('sys_approval_approver', SysApprovalApprover.fields),
    TestSystemFile,
    SysAttachment,
    TestSalesContract,
    SalesContractSubmission,
    SalesContractRevisionMaterial,
  ];
}

function observedNativeApprovalService(engine) {
  const calls = { getRequest: [], listActions: [], decisions: 0 };
  const service = new ApprovalService({
    engine,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  const getRequest = service.getRequest.bind(service);
  const listActions = service.listActions.bind(service);
  const decide = service.decide.bind(service);
  service.getRequest = async (requestId, context) => {
    const result = await getRequest(requestId, context);
    calls.getRequest.push({
      requestId,
      userId: context.userId,
      organizationId: context.tenantId || context.organizationId,
      positions: [...(context.positions ?? [])],
      isSystem: context.isSystem === true,
      resultId: result?.id ?? null,
    });
    return result;
  };
  service.listActions = async (requestId, context) => {
    const result = await listActions(requestId, context);
    calls.listActions.push({
      requestId,
      userId: context.userId,
      organizationId: context.tenantId || context.organizationId,
      isSystem: context.isSystem === true,
      actions: result.map(({ action, actor_id, via_override }) => ({ action, actor_id, via_override })),
    });
    return result;
  };
  service.decide = async (...args) => {
    calls.decisions += 1;
    return decide(...args);
  };
  return {
    calls,
    service,
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
    unactedApprover: id(), admin: id(), contract: id(), submission: id(), request: id(),
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
  await engine.insert('sys_organization', { id: ids.organization, name: 'History fixture organization' }, { context: SYSTEM });
  for (const [userId, name] of [
    [ids.submitter, 'Submitter'],
    [ids.reviewer, 'Historical reviewer'],
    [ids.unactedApprover, 'Unacted approver'],
    [ids.admin, 'Override actor'],
  ]) {
    await engine.insert('sys_user', {
      id: userId, name, email: `${userId}@example.invalid`, organization_id: ids.organization,
    }, { context: tenantContext });
    await engine.insert('sys_member', {
      id: id(), user_id: userId, organization_id: ids.organization,
      role: userId === ids.admin ? 'admin' : 'member',
    }, { context: SYSTEM });
  }
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

  const frozenPayload = {
    submitted_material_id: ids.oldFile,
    submitted_material_name: 'R1合同.pdf',
    submitted_material_sha256: oldDigest,
    attachment_ids: [],
    submitted_attachment_manifest: '[]',
  };
  const requestCreatedAt = '2026-09-29T07:00:00.000Z';
  await engine.insert('sys_approval_request', {
    id: ids.request,
    organization_id: ids.organization,
    process_name: 'flow:contract_approval',
    object_name: CONTRACT_OBJECT,
    record_id: ids.contract,
    submitter_id: ids.submitter,
    status: 'returned',
    current_step: 'contract_review',
    current_step_index: 1,
    pending_approvers: '',
    payload_json: JSON.stringify(frozenPayload),
    flow_run_id: `run-${id()}`,
    flow_node_id: 'contract_review',
    node_config_json: JSON.stringify({ __flowLabel: '合同审批', __nodeLabel: '合同复核' }),
    created_at: requestCreatedAt,
    updated_at: requestCreatedAt,
    completed_at: requestCreatedAt,
  }, { context: tenantContext });
  const overrideAction = {
    id: id(), request_id: ids.request, organization_id: ids.organization,
    step_name: 'manager_review', step_index: 0, action: 'approve', actor_id: ids.admin,
    via_override: true, created_at: '2026-09-29T07:01:00.000Z',
  };
  const reviseAction = {
    id: id(), request_id: ids.request, organization_id: ids.organization,
    step_name: 'contract_review', step_index: 1, action: 'revise', actor_id: ids.reviewer,
    comment: '请修订合同', created_at: '2026-09-29T07:02:00.000Z',
  };
  const resubmitAction = {
    id: id(), request_id: ids.request, organization_id: ids.organization,
    step_name: 'contract_review', step_index: 1, action: 'resubmit', actor_id: ids.submitter,
    created_at: '2026-09-29T07:03:00.000Z',
  };
  await engine.insert('sys_approval_action', overrideAction, { context: SYSTEM });
  await engine.insert('sys_approval_action', reviseAction, { context: SYSTEM });
  const approvalHarness = observedNativeApprovalService(engine);
  assert.ok(approvalHarness.service instanceof ApprovalService, 'the history routes use the native ApprovalService implementation');

  const reviewerContext = { userId: ids.reviewer, tenantId: ids.organization, positions: [], permissions: [] };
  const nativeRequest = await approvalHarness.service.getRequest(ids.request, reviewerContext);
  assert.equal(nativeRequest?.id, ids.request, 'native ApprovalService exposes this round to its recorded revise actor');
  assert.equal(nativeRequest?.payload?.submitted_material_id, ids.oldFile, 'native payload projection retains the frozen file reference');
  assert.equal(nativeRequest?.payload?.submitted_material_sha256, oldDigest, 'native payload projection retains the frozen SHA');
  const nativeActions = await approvalHarness.service.listActions(ids.request, reviewerContext);
  assert.equal(nativeActions.find((action) => action.id === overrideAction.id)?.via_override, true,
    'native action projection preserves the admin override marker');
  assert.equal(nativeActions.find((action) => action.id === reviseAction.id)?.via_override, undefined,
    'native revise action is recorded without an override field because sendBack has no override path');
  const nativeOverrideActorRequest = await approvalHarness.service.getRequest(ids.request, {
    userId: ids.admin, tenantId: ids.organization, positions: [], permissions: [],
  });
  assert.equal(nativeOverrideActorRequest?.id, ids.request, 'native request visibility includes a recorded override actor');
  assert.equal((await approvalHarness.service.listActions(ids.request, {
    userId: ids.admin, tenantId: ids.organization, positions: [], permissions: [],
  })).find((action) => action.actor_id === ids.admin)?.via_override, true,
  'native listActions keeps the override marker for the actor who used the admin path');
  assert.equal(await approvalHarness.service.getRequest(ids.request, {
    userId: ids.unactedApprover, tenantId: ids.organization, positions: [], permissions: [],
  }), null, 'native ApprovalService does not expose this completed round to an unacted approver');
  assert.equal(await engine.find('sys_approval_approver', { where: { request_id: ids.request }, context: SYSTEM }).then((rows) => rows.length), 0,
    'a completed returned request has no current pending-approver index rows');
  approvalHarness.calls.getRequest.length = 0;
  approvalHarness.calls.listActions.length = 0;

  const work = harness({ engine, storage, approvals: approvalHarness.service, ids });
  await work.start();

  const original = await work.callHistory('reviewer-token', ids.oldFile, oldDigest);
  assert.equal(original.status, 200);
  assert.deepEqual(original.raw, oldBytes);
  assert.deepEqual(approvalHarness.calls.getRequest[0], {
    requestId: ids.request, userId: ids.reviewer, organizationId: ids.organization,
    positions: ['org_member', 'everyone'], isSystem: false, resultId: ids.request,
  }, 'the native ApprovalService receives the Bearer-derived employee, org, and non-system context');
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
  const unactedRead = await work.callHistory('unacted-reviewer-token', ids.oldFile, oldDigest);
  assert.equal(unactedRead.status, 404,
    'current or previously unacted approver slots do not prove historical participation');
  const unactedServiceRead = [...approvalHarness.calls.getRequest].reverse().find((call) => call.userId === ids.unactedApprover);
  assert.equal(unactedServiceRead?.resultId, null, 'native getRequest denies the unacted employee before file lookup');
  assert.equal(approvalHarness.calls.listActions.some((call) => call.userId === ids.unactedApprover), false,
    'native listActions is not queried for a request the employee cannot see');
  const adminRead = await work.callHistory('admin-token', ids.oldFile, oldDigest);
  assert.equal(adminRead.status, 404,
    'an admin override capability does not grant historical material access');
  const adminServiceRead = [...approvalHarness.calls.getRequest].reverse().find((call) => call.userId === ids.admin);
  assert.equal(adminServiceRead?.resultId, ids.request, 'native getRequest can expose a request to its recorded override actor');
  assert.ok(adminServiceRead?.positions.includes('org_admin'), 'the Bearer-resolved caller is currently an organization admin');
  const adminServiceActions = [...approvalHarness.calls.listActions].reverse().find((call) => call.userId === ids.admin)?.actions;
  assert.equal(adminServiceActions?.find((action) => action.actor_id === ids.admin)?.via_override, true,
    'the route receives the native override marker and still refuses history bytes');
  assert.equal((await work.callHistory('other-org-token', ids.oldFile, oldDigest)).status, 404,
    'the approval must belong to the Bearer session organization');
  assert.equal((await work.callHistory('reviewer-token', ids.currentFile, currentDigest)).status, 404,
    'a live contract file absent from this round snapshot cannot be guessed as historical material');

  const currentRoundOriginal = await work.callCurrentOriginal('submitter-token', ids.oldFile, oldDigest);
  assert.equal(currentRoundOriginal.status, 200, 'a not-yet-resubmitted current approval can read a deleted original through its valid holder');
  assert.deepEqual(currentRoundOriginal.raw, oldBytes);
  await engine.insert('sys_approval_action', resubmitAction, { context: SYSTEM });
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
  await engine.delete('sys_approval_action', { where: { id: resubmitAction.id } }, { context: SYSTEM });
  assert.equal((await work.callCurrentOriginal('submitter-token', ids.oldFile, oldDigest)).status, 404,
    'the current approval route also refuses a deleted original whose native holder no longer matches');
  assert.equal((await work.callOwnerOriginal('submitter-token', ids.oldFile, oldDigest)).status, 404,
    'the owner route refuses a deleted original after its valid holder is removed');
});
