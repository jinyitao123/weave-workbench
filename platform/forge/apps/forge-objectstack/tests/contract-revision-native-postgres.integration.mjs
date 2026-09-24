import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { LiteKernel } from '@objectstack/core';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectQL } from '@objectstack/objectql';
import { AutomationServicePlugin, SysAutomationRun, SysFlowDispatch } from '@objectstack/service-automation';
import { ApprovalService, ApprovalsServicePlugin, SysApprovalAction, SysApprovalApprover, SysApprovalRequest } from '@objectstack/plugin-approvals';
import { RestServer } from '@objectstack/rest';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { ContractType, SalesContract, SalesContractRevisionMaterial } from '../src/objects/sales.object.ts';
import { SalesContractApprovalFlow } from '../src/flows/sales-contract-approval.flow.ts';
import { ApprovalResubmitGuardPlugin } from '../src/plugins/approval-resubmit-guard.plugin.ts';
import { ApprovalWorkbenchContextPlugin } from '../src/plugins/approval-workbench-context.plugin.ts';
import { ContractRevisionMaterialPlugin, approvalPayloadVersion } from '../src/plugins/contract-revision-material.ts';

const DATABASE = 'forge_contract_test';
const HOST = '127.0.0.1';
const PORT = 55439;
const SYSTEM = { isSystem: true, positions: [], permissions: [] };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const id = () => randomUUID();

function fileId(value) {
  if (typeof value === 'string') return value;
  return value && typeof value === 'object' && typeof value.id === 'string' ? value.id : undefined;
}

function simpleObject(name, fields) {
  return ObjectSchema.create({ name, label: name, fields, enable: { apiEnabled: true } });
}

function fixtureObjects() {
  return [
    ContractType,
    simpleObject('forge_customer', { name: Field.text({ label: 'Name', required: true }) }),
    simpleObject('sys_user', { name: Field.text({ label: 'Name' }), email: Field.email({ label: 'Email' }) }),
    simpleObject('sys_organization', { name: Field.text({ label: 'Name' }) }),
    simpleObject('sys_member', { user_id: Field.text({}), organization_id: Field.text({}), role: Field.text({}) }),
    simpleObject('sys_position', { name: Field.text({}) }),
    simpleObject('sys_user_position', { user_id: Field.text({}), position: Field.text({}), organization_id: Field.text({}) }),
    simpleObject('sys_position_permission_set', { position_id: Field.text({}), permission_set_id: Field.text({}), organization_id: Field.text({}) }),
    simpleObject('sys_user_permission_set', { user_id: Field.text({}), permission_set_id: Field.text({}), organization_id: Field.text({}) }),
    simpleObject('sys_approval_request', SysApprovalRequest.fields),
    simpleObject('sys_approval_action', SysApprovalAction.fields),
    simpleObject('sys_approval_approver', SysApprovalApprover.fields),
    simpleObject('sys_file', {
      key: Field.text({ label: 'Storage key' }),
      name: Field.text({ label: 'Name' }),
      mime_type: Field.text({ label: 'MIME type' }),
      size: Field.number({ label: 'Size' }),
      status: Field.text({ label: 'Status' }),
      owner_id: Field.text({ label: 'Owner' }),
      ref_object: Field.text({ label: 'Object' }),
      ref_id: Field.text({ label: 'Record' }),
      ref_field: Field.text({ label: 'Field' }),
      organization_id: Field.text({ label: 'Organization' }),
    }),
    simpleObject('sys_automation_run', SysAutomationRun.fields),
    simpleObject('sys_flow_dispatch', SysFlowDispatch.fields),
    SalesContract,
    SalesContractRevisionMaterial,
  ];
}

function routeServer() {
  const routes = new Map();
  return {
    routes,
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); },
    put(path, handler) { routes.set(`PUT ${path}`, handler); },
    patch(path, handler) { routes.set(`PATCH ${path}`, handler); },
    delete(path, handler) { routes.set(`DELETE ${path}`, handler); },
    use() {},
  };
}

async function invoke(routes, method, path, params, body, token = 'sales-token') {
  const handler = routes.get(`${method} ${path}`);
  assert.ok(handler, `${method} ${path} is mounted`);
  let status = 200;
  let response;
  const res = {
    status(value) { status = value; return this; },
    json(value) { response = value; return this; },
    end() { return this; },
  };
  await handler({
    method,
    path,
    params,
    query: {},
    body,
    headers: { authorization: `Bearer ${token}` },
  }, res);
  return { status, body: response };
}

function executionContext(userId, organizationId) {
  return { userId, tenantId: organizationId, organizationId, positions: [], permissions: [] };
}

test('native ObjectStack 17.3 contract revision uses PostgreSQL, preserves the old snapshot, opens a fresh round, and reconciles a lost resume acknowledgement', {
  skip: process.env.FORGE_NATIVE_PG_APPROVAL_TEST !== '1' ? 'set FORGE_NATIVE_PG_APPROVAL_TEST=1 for the isolated PostgreSQL 16 run' : false,
}, async (t) => {
  const engine = new ObjectQL();
  const driver = new SqlDriver({
    client: 'pg',
    connection: { host: HOST, port: PORT, database: DATABASE },
  });
  const objects = fixtureObjects();
  for (const object of objects) engine.registerObject(object);
  engine.registerDriver(driver, true);
  await engine.init();
  await driver.initObjects(objects);

  const ids = {
    contract: id(),
    organization: id(),
    customer: id(),
    type: id(),
    submitter: id(),
    delivery: id(),
    commercial: id(),
    oldPrimary: id(),
    oldAttachment: id(),
    newPrimary: id(),
    newAttachment: id(),
  };
  const routes = routeServer();
  const content = new Map();
  const tokens = new Map([
    ['sales-token', ids.submitter],
    ['delivery-token', ids.delivery],
    ['commercial-token', ids.commercial],
    ['foreign-token', id()],
  ]);
  const auth = {
    api: {
      async getSession({ headers }) {
        const userId = tokens.get(headers.get('authorization')?.replace(/^Bearer\s+/i, ''));
        return userId ? { user: { id: userId }, session: { activeOrganizationId: ids.organization } } : null;
      },
    },
  };
  const storage = {
    async download(key) {
      const bytes = content.get(key);
      if (!bytes) throw new Error('test storage key is unavailable');
      return Buffer.from(bytes);
    },
  };
  const manifest = { register() {} };
  const basePlugin = {
    name: 'com.objectstack.engine.objectql',
    version: '1.0.0',
    type: 'standard',
    init(ctx) {
      ctx.registerService('objectql', engine);
      ctx.registerService('auth', auth);
      ctx.registerService('storage', storage);
      ctx.registerService('http.server', routes);
      ctx.registerService('manifest', manifest);
    },
  };
  const automationPlugin = new AutomationServicePlugin({ suspendedRunStore: 'memory' });
  const approvalsPlugin = new ApprovalsServicePlugin({ disableAutoHooks: true });
  const kernel = new LiteKernel({ logger: { level: 'silent' } });
  kernel.use(basePlugin)
    .use(automationPlugin)
    .use(approvalsPlugin)
    .use(new ApprovalResubmitGuardPlugin({
      requiredMaterialObjects: ['forge_sales_contract'],
      verifierServiceName: 'forge.contract.revision.material',
    }))
    .use(new ContractRevisionMaterialPlugin())
    .use(new ApprovalWorkbenchContextPlugin());
  t.after(async () => {
    await kernel.shutdown();
    await driver.disconnect();
  });
  await kernel.bootstrap();

  assert.ok(approvalsPlugin.service instanceof ApprovalService, 'the native approvals plugin owns the approval service');
  const approvals = kernel.getService('approvals');
  const automation = kernel.getService('automation');
  assert.notEqual(approvals, approvalsPlugin.service, 'the Forge guard wraps the native service slot');
  assert.ok(automation.getRegisteredNodeTypes().includes('approval'));
  assert.ok(automation.getRegisteredNodeTypes().includes('approval_revise'));

  const insert = (objectName, row) => engine.insert(objectName, row, {
    context: { ...SYSTEM, tenantId: ids.organization },
  });
  const existingOrganizations = await engine.find('sys_organization', { fields: ['id'], limit: 10 }, { context: SYSTEM });
  if (existingOrganizations?.[0]?.id) ids.organization = String(existingOrganizations[0].id);
  else await engine.insert('sys_organization', { id: ids.organization, name: 'Contract test organization' }, { context: SYSTEM });
  if ((existingOrganizations?.length ?? 0) < 2) {
    await engine.insert('sys_organization', { id: id(), name: 'Unrelated isolated organization' }, { context: SYSTEM });
  }
  await insert('forge_contract_type', { id: ids.type, name: 'Contract' });
  await insert('forge_customer', { id: ids.customer, name: 'Customer' });
  await insert('sys_user', { id: ids.submitter, name: 'Submitter', email: `${ids.submitter}@example.invalid` });
  await insert('sys_user', { id: ids.delivery, name: 'Delivery reviewer', email: `${ids.delivery}@example.invalid` });
  await insert('sys_user', { id: ids.commercial, name: 'Commercial reviewer', email: `${ids.commercial}@example.invalid` });
  await insert('sys_position', { id: id(), name: 'contract_delivery_reviewer' });
  await insert('sys_position', { id: id(), name: 'contract_commercial_reviewer' });
  await insert('sys_user_position', { id: id(), user_id: ids.delivery, position: 'contract_delivery_reviewer', organization_id: ids.organization });
  await insert('sys_user_position', { id: id(), user_id: ids.commercial, position: 'contract_commercial_reviewer', organization_id: ids.organization });

  const oldPrimaryBytes = Buffer.from('synthetic old contract content', 'utf8');
  const oldAttachmentBytes = Buffer.from('synthetic old attachment content', 'utf8');
  const newPrimaryBytes = Buffer.from('synthetic revised contract content', 'utf8');
  const newAttachmentBytes = Buffer.from('synthetic revised attachment content', 'utf8');
  const fileRows = [
    [ids.oldPrimary, 'old-primary-key', 'contract-original.txt', oldPrimaryBytes],
    [ids.oldAttachment, 'old-attachment-key', 'attachment-original.txt', oldAttachmentBytes],
    [ids.newPrimary, 'new-primary-key', 'contract-revised.txt', newPrimaryBytes],
    [ids.newAttachment, 'new-attachment-key', 'attachment-revised.txt', newAttachmentBytes],
  ];
  for (const [fileId, key, name, bytes] of fileRows) {
    content.set(key, bytes);
    await insert('sys_file', {
      id: fileId,
      key,
      name,
      mime_type: 'text/plain',
      size: bytes.length,
      status: 'committed',
      owner_id: ids.submitter,
      ref_object: 'forge_sales_contract',
      ref_id: ids.contract,
      ref_field: fileId === ids.oldAttachment || fileId === ids.newAttachment ? 'attachment_ids' : 'submitted_material_id',
      organization_id: ids.organization,
    });
  }

  const oldManifest = [{ file_id: ids.oldAttachment, name: 'attachment-original.txt', sha256: sha256(oldAttachmentBytes) }];
  const initialRecord = {
    id: ids.contract,
    name: 'Synthetic contract for native approval test',
    code: `HT-${ids.contract}`,
    contract_type_id: ids.type,
    customer_id: ids.customer,
    responsible_id: ids.submitter,
    status: 'pending_approval',
    attachment_ids: [ids.oldAttachment],
    submitted_material_id: ids.oldPrimary,
    submitted_material_name: 'contract-original.txt',
    submitted_material_sha256: sha256(oldPrimaryBytes),
    submitted_attachment_manifest: JSON.stringify(oldManifest),
  };
  await insert('forge_sales_contract', initialRecord);

  const flows = automation;
  flows.registerFlow(SalesContractApprovalFlow.name, SalesContractApprovalFlow);
  const started = await flows.execute(SalesContractApprovalFlow.name, {
    object: 'forge_sales_contract',
    record: structuredClone(initialRecord),
    userId: ids.submitter,
    organizationId: ids.organization,
    tenantId: ids.organization,
    previous: { status: 'draft' },
  });
  assert.equal(started.status, 'paused', 'the native approval node suspends the contract flow');
  assert.ok(started.runId);
  const initialRequests = await engine.find('sys_approval_request', {
    where: { flow_run_id: started.runId, object_name: 'forge_sales_contract', record_id: ids.contract },
    orderBy: [{ field: 'created_at', order: 'asc' }],
    limit: 10,
  }, { context: SYSTEM });
  assert.equal(initialRequests.length, 1);
  const firstRequest = initialRequests[0];
  const firstSnapshot = JSON.parse(firstRequest.payload_json);
  assert.equal(firstSnapshot.submitted_material_id, ids.oldPrimary);
  assert.deepEqual(firstSnapshot.attachment_ids, [ids.oldAttachment]);
  const firstSnapshotVersion = await approvalPayloadVersion(firstSnapshot);

  const contextPath = '/api/v1/approvals/requests/:requestId/workbench-context';
  const firstReviewerContext = await invoke(routes.routes, 'GET', contextPath, { requestId: firstRequest.id }, undefined, 'delivery-token');
  assert.equal(firstReviewerContext.status, 200, 'the native current approver can read the frozen first-round context');
  assert.deepEqual(firstReviewerContext.body.files.map((file) => file.fileId).sort(), [ids.oldPrimary, ids.oldAttachment].sort());
  assert.equal(firstReviewerContext.body.sourceMaterialVersion, firstSnapshotVersion);

  const rest = new RestServer(routes, {}, {}, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, async () => kernel.getService('approvals'));
  rest.resolveExecCtx = async (_environmentId, req) => {
    const token = String(req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '');
    const userId = tokens.get(token);
    return userId ? executionContext(userId, ids.organization) : null;
  };
  rest.registerApprovalsEndpoints('/api/v1');
  const sentBack = await invoke(routes.routes, 'POST', '/api/v1/approvals/requests/:id/revise', { id: firstRequest.id }, {
    comment: 'synthetic return reason',
  }, 'delivery-token');
  assert.equal(sentBack.status, 200);
  const returnedRequest = await approvalsPlugin.service.getRequest(firstRequest.id, executionContext(ids.submitter, ids.organization));
  assert.equal(returnedRequest.status, 'returned');
  assert.equal((await engine.find('sys_approval_action', {
    where: { request_id: firstRequest.id, action: 'revise' }, limit: 10,
  }, { context: SYSTEM })).length, 1);

  const submitterContext = await invoke(routes.routes, 'GET', contextPath, { requestId: firstRequest.id }, undefined, 'sales-token');
  assert.equal(submitterContext.status, 200, 'the submitter can resume with the native returned snapshot');
  assert.equal(submitterContext.body.viewer, 'original_submitter');
  assert.deepEqual(submitterContext.body.files.map((file) => file.fileId).sort(), [ids.oldPrimary, ids.oldAttachment].sort());

  const revisionPath = '/api/v1/approvals/requests/:requestId/workbench-revision';
  const body = {
    returnVersion: (await approvalsPlugin.service.listActions(firstRequest.id, executionContext(ids.submitter, ids.organization)))
      .findLast((action) => action.action === 'revise').id,
    sourceMaterialVersion: firstSnapshotVersion,
    idempotencyKey: id(),
    primary: { fileId: ids.newPrimary, name: 'contract-revised.txt', sha256: sha256(newPrimaryBytes) },
    attachments: [{ fileId: ids.newAttachment, name: 'attachment-revised.txt', sha256: sha256(newAttachmentBytes) }],
  };

  const unauthorized = await invoke(routes.routes, 'POST', revisionPath, { requestId: firstRequest.id }, body, 'foreign-token');
  assert.equal(unauthorized.status, 404, 'an authenticated non-submitter cannot bind revision materials');
  assert.equal((await engine.find('forge_sales_contract_revision_material', { where: { approval_request_id: firstRequest.id }, limit: 10 }, { context: SYSTEM })).length, 0);

  const stale = await invoke(routes.routes, 'POST', revisionPath, { requestId: firstRequest.id }, {
    ...body,
    sourceMaterialVersion: 'f'.repeat(64),
  }, 'sales-token');
  assert.equal(stale.status, 409, 'a stale returned snapshot is rejected');
  assert.equal(stale.body.error.code, 'REVISION_STALE');

  const directNative = await invoke(routes.routes, 'POST', '/api/v1/approvals/requests/:id/resubmit', { id: firstRequest.id }, {
    comment: 'direct native retry must be fenced',
    idempotencyKey: body.idempotencyKey,
    materialBinding: { bindingId: id(), returnVersion: body.returnVersion,
      sourceMaterialVersion: body.sourceMaterialVersion, newVersionDigest: 'a'.repeat(64) },
  }, 'sales-token');
  assert.equal(directNative.status, 400, 'ObjectStack 17.3 REST drops custom binding fields and the Forge guard fails closed');
  assert.equal((await engine.find('sys_approval_action', { where: { request_id: firstRequest.id, action: 'resubmit' }, limit: 10 }, { context: SYSTEM })).length, 0);

  const automationResume = automation.resume.bind(automation);
  let lostAcknowledgement = false;
  automation.resume = async (runId, signal) => {
    const result = await automationResume(runId, signal);
    if (!lostAcknowledgement && signal?.output?.resubmitted === true) {
      lostAcknowledgement = true;
      throw new Error('simulated lost resume acknowledgement');
    }
    return result;
  };

  const submitted = await invoke(routes.routes, 'POST', revisionPath, { requestId: firstRequest.id }, body, 'sales-token');
  assert.equal(lostAcknowledgement, true, 'the test lost the acknowledgement after the native flow advanced');
  assert.equal(submitted.status, 200, 'Forge reconciles the native result from the persisted action and next request');
  assert.equal(submitted.body.state, 'resumed');

  const replay = await invoke(routes.routes, 'POST', revisionPath, { requestId: firstRequest.id }, body, 'sales-token');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.state, 'resumed');

  const requests = await engine.find('sys_approval_request', {
    where: { flow_run_id: started.runId, object_name: 'forge_sales_contract', record_id: ids.contract },
    orderBy: [{ field: 'created_at', order: 'asc' }],
    limit: 10,
  }, { context: SYSTEM });
  assert.equal(requests.length, 2, 'the native back-edge opens exactly one new approval round');
  const oldAfterRows = await engine.find('sys_approval_request', {
    where: { id: firstRequest.id }, fields: ['payload_json'], limit: 1,
  }, { context: SYSTEM });
  const oldAfter = JSON.parse(String(oldAfterRows[0]?.payload_json ?? 'null'));
  assert.deepEqual(oldAfter, firstSnapshot, 'the original approval snapshot remains immutable');
  const secondRequest = requests.find((request) => request.id !== firstRequest.id);
  assert.ok(secondRequest);
  const secondSnapshot = JSON.parse(secondRequest.payload_json);
  assert.equal(fileId(secondSnapshot.submitted_material_id), ids.newPrimary, 'the new approval round snapshots the revised main file');
  assert.deepEqual(secondSnapshot.attachment_ids.map(fileId), [ids.newAttachment], 'the new approval round snapshots the revised attachment');
  assert.equal(secondSnapshot.submitted_material_sha256, sha256(newPrimaryBytes));

  const secondReviewerContext = await invoke(routes.routes, 'GET', contextPath, { requestId: secondRequest.id }, undefined, 'delivery-token');
  assert.equal(secondReviewerContext.status, 200);
  assert.deepEqual(secondReviewerContext.body.files.map((file) => file.fileId).sort(), [ids.newPrimary, ids.newAttachment].sort());
  assert.equal(secondReviewerContext.body.sourceMaterialVersion, await approvalPayloadVersion(secondSnapshot));

  const resubmitActions = await engine.find('sys_approval_action', {
    where: { request_id: firstRequest.id, action: 'resubmit' }, limit: 10,
  }, { context: SYSTEM });
  assert.equal(resubmitActions.length, 1, 'same-key replay did not duplicate the native resubmit action');
  assert.equal((await engine.find('forge_sales_contract_revision_material', {
    where: { approval_request_id: firstRequest.id }, limit: 10,
  }, { context: SYSTEM })).length, 1);
  const resumedReceipt = await invoke(routes.routes, 'GET',
    '/api/v1/approvals/requests/:requestId/workbench-revision/:idempotencyKey',
    { requestId: firstRequest.id, idempotencyKey: body.idempotencyKey }, undefined, 'sales-token');
  assert.equal(resumedReceipt.status, 200);
  assert.equal(resumedReceipt.body.state, 'resumed');

  console.log(JSON.stringify({
    suite: 'contract-revision-native-postgres',
    status: 'passed',
    database: DATABASE,
    runtime: 'ObjectStack 17.3 native approvals and automation services',
    checks: [
      'native returned request and real approval_revise suspension',
      'authenticated submitter and current reviewer approval context',
      'unauthorized employee, stale snapshot, and direct REST resubmit rejected',
      'new main file and attachment passed the Forge material guard',
      'native resubmit back-edge opened one new approval round',
      'original snapshot retained and new round snapshot verified',
      'same request replay did not duplicate the native resubmit action',
      'lost resume acknowledgement reconciled from PostgreSQL readback',
    ],
  }));
});
