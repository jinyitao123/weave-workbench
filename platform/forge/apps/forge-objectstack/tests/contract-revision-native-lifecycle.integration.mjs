import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LiteKernel } from '@objectstack/core';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectQL } from '@objectstack/objectql';
import { ApprovalService, ApprovalsServicePlugin, SysApprovalAction, SysApprovalApprover, SysApprovalRequest } from '@objectstack/plugin-approvals';
import { RestServer } from '@objectstack/rest';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { ContractRevisionMaterialPlugin, approvalPayloadVersion } from '../src/plugins/contract-revision-material.ts';
import { ApprovalResubmitGuardPlugin } from '../src/plugins/approval-resubmit-guard.plugin.ts';
import { ContractType, SalesContract, SalesContractRevisionMaterial } from '../src/objects/sales.object.ts';

const CONTRACT_ID = 'contract-native-A';
const REQUEST_ID = 'approval-native-returned';
const RETURN_ACTION_ID = 'return-native-A';
const FILE_ID = '11111111-1111-4111-8111-111111111111';
const IDEMPOTENCY_KEY = '33333333-3333-4333-8333-333333333333';
const SYSTEM = { isSystem: true, positions: [], permissions: [] };

function simpleObject(name, fields) {
  return ObjectSchema.create({ name, label: name, fields, enable: { apiEnabled: true } });
}

function makeFileSchema() {
  return simpleObject('sys_file', {
    key: Field.text({ label: 'Storage key' }),
    name: Field.text({ label: 'Name' }),
    mime_type: Field.text({ label: 'MIME type' }),
    size: Field.number({ label: 'Size' }),
    status: Field.text({ label: 'Status' }),
    owner_id: Field.text({ label: 'Owner' }),
    ref_object: Field.text({ label: 'Object' }),
    ref_id: Field.text({ label: 'Record' }),
    organization_id: Field.text({ label: 'Organization' }),
  });
}

function makeFixtureObjects() {
  return [
    ContractType,
    simpleObject('forge_customer', { name: Field.text({ label: 'Name', required: true }) }),
    simpleObject('sys_user', { name: Field.text({ label: 'Name' }), email: Field.email({ label: 'Email' }) }),
    simpleObject('sys_organization', { name: Field.text({ label: 'Name' }) }),
    simpleObject('sys_member', { user_id: Field.text({}), organization_id: Field.text({}), role: Field.text({}) }),
    simpleObject('sys_user_position', { user_id: Field.text({}), position: Field.text({}), organization_id: Field.text({}) }),
    simpleObject('sys_user_permission_set', { user_id: Field.text({}), permission_set_id: Field.text({}), organization_id: Field.text({}) }),
    simpleObject('sys_position', { name: Field.text({}) }),
    simpleObject('sys_approval_request', SysApprovalRequest.fields),
    simpleObject('sys_approval_action', SysApprovalAction.fields),
    simpleObject('sys_approval_approver', SysApprovalApprover.fields),
    makeFileSchema(),
    SalesContract,
    SalesContractRevisionMaterial,
  ];
}

async function createEngine() {
  const directory = mkdtempSync(join(tmpdir(), 'forge-approval-native-'));
  const file = join(directory, 'objectstack.sqlite');
  const engine = new ObjectQL();
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
  const objects = makeFixtureObjects();
  for (const object of objects) engine.registerObject(object);
  engine.registerDriver(driver, true);
  await engine.init();
  await driver.initObjects(objects);
  return {
    directory,
    engine,
    driver,
    async close() {
      await driver.disconnect();
      rmSync(directory, { recursive: true, force: true });
    },
  };
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
  };
}

async function invoke(routes, method, path, params, body, authorization = 'Bearer sales-token') {
  const handler = routes.get(`${method} ${path}`);
  assert.ok(handler, `${method} ${path} was registered`);
  const req = { params, body, headers: { authorization }, method, path };
  let status = 200;
  let response;
  const res = {
    status(value) { status = value; return this; },
    json(value) { response = value; return this; },
    end() { return this; },
  };
  await handler(req, res);
  return { status, body: response };
}

test('LiteKernel slot guards native REST and revision route writes one native action', async (t) => {
  const fixture = await createEngine();
  t.after(() => fixture.close());
  const bytes = Buffer.from('修订合同正文', 'utf8');
  const fileSha = createHash('sha256').update(bytes).digest('hex');
  const payload = { name: '原合同', submitted_material_id: 'old-file', submitted_material_sha256: 'a'.repeat(64) };
  const routes = routeServer();
  const storage = { async download(key) { assert.equal(key, 'revision-key-A'); return Buffer.from(bytes); } };
  const auth = { api: { async getSession({ headers }) {
    return headers.get('authorization') === 'Bearer sales-token'
      ? { user: { id: 'sales-A' }, session: { activeOrganizationId: 'org-A' } }
      : null;
  } } };
  const manifest = { register() {} };

  const insert = (name, row) => fixture.engine.insert(name, row, { context: SYSTEM });
  await insert('forge_contract_type', { id: 'type-A', name: '合同' });
  await insert('forge_customer', { id: 'customer-A', name: '客户 A' });
  await insert('sys_user', { id: 'sales-A', name: '销售 A', email: 'sales@example.invalid' });
  await insert('sys_organization', { id: 'org-A', name: '测试组织' });
  await insert('forge_sales_contract', {
    id: CONTRACT_ID, name: '销售合同 A', code: 'HT-A', contract_type_id: 'type-A',
    customer_id: 'customer-A', responsible_id: 'sales-A', status: 'pending_approval',
    submitted_material_id: 'old-file',
  });
  await insert('sys_file', {
    id: FILE_ID, key: 'revision-key-A', name: '修订合同.txt', mime_type: 'text/plain', size: bytes.length,
    status: 'committed', owner_id: 'sales-A', ref_object: null, ref_id: null, organization_id: 'org-A',
  });
  await insert('sys_approval_request', {
    id: REQUEST_ID, process_name: 'sales-contract-approval', object_name: 'forge_sales_contract',
    record_id: CONTRACT_ID, submitter_id: 'sales-A', status: 'returned', pending_approvers: '',
    payload_json: JSON.stringify(payload), flow_run_id: 'run-native-A', flow_node_id: 'approval-node-A',
    node_config_json: JSON.stringify({}), organization_id: 'org-A', created_at: '2026-09-23T09:00:00.000Z',
    updated_at: '2026-09-23T09:01:00.000Z',
  });
  await insert('sys_approval_action', {
    id: RETURN_ACTION_ID, request_id: REQUEST_ID, organization_id: 'org-A', step_name: 'approval-node-A',
    step_index: 0, action: 'revise', actor_id: 'approver-A', comment: '请修订合同',
    created_at: '2026-09-23T09:01:00.000Z',
  });

  const basePlugin = {
    name: 'com.objectstack.engine.objectql', version: '1.0.0', type: 'standard', dependencies: [],
    init(ctx) {
      ctx.registerService('objectql', fixture.engine);
      ctx.registerService('auth', auth);
      ctx.registerService('storage', storage);
      ctx.registerService('http.server', routes);
      ctx.registerService('manifest', manifest);
    },
  };
  const approvalsPlugin = new ApprovalsServicePlugin({ disableAutoHooks: true });
  const guardPlugin = new ApprovalResubmitGuardPlugin({
    requiredMaterialObjects: ['forge_sales_contract'],
    verifierServiceName: 'forge.contract.revision.material',
  });
  const materialPlugin = new ContractRevisionMaterialPlugin();
  const kernel = new LiteKernel({ logger: { level: 'error' } });
  kernel.use(basePlugin).use(approvalsPlugin).use(guardPlugin).use(materialPlugin);
  await kernel.bootstrap();
  t.after(() => kernel.shutdown());

  const guardedApprovals = kernel.getService('approvals');
  assert.ok(approvalsPlugin.service instanceof ApprovalService);
  assert.notEqual(guardedApprovals, approvalsPlugin.service, 'start() replaced the native service slot');
  assert.ok(kernel.getService('forge.contract.revision.material'), 'kernel:ready registered the material service');
  approvalsPlugin.service.attachAutomation({
    async hasSuspendedRun(runId) { assert.equal(runId, 'run-native-A'); return true; },
    async resume() { throw new Error('simulated lost resume response'); },
  });

  const nativeRest = new RestServer(routes, {}, {}, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, async () => kernel.getService('approvals'));
  nativeRest.resolveExecCtx = async () => ({ userId: 'sales-A', tenantId: 'org-A', positions: [], permissions: [] });
  nativeRest.registerApprovalsEndpoints('/api/v1');
  const nativeRoute = await invoke(routes.routes, 'POST', '/api/v1/approvals/requests/:id/resubmit', { id: REQUEST_ID }, {
    actorId: 'sales-A', idempotencyKey: IDEMPOTENCY_KEY,
    materialBinding: { bindingId: '44444444-4444-4444-8444-444444444444' },
  });
  assert.equal(nativeRoute.status, 400);
  assert.equal(nativeRoute.body.code, 'VALIDATION_FAILED');
  assert.equal((await fixture.engine.find('sys_approval_action', { where: { request_id: REQUEST_ID, action: 'resubmit' }, context: SYSTEM })).length, 0);

  const body = {
    returnVersion: RETURN_ACTION_ID,
    sourceMaterialVersion: await approvalPayloadVersion(payload),
    idempotencyKey: IDEMPOTENCY_KEY,
    primary: { fileId: FILE_ID, name: '修订合同.txt', sha256: fileSha },
    attachments: [],
  };
  const revisionPath = '/api/v1/approvals/requests/:requestId/workbench-revision';
  const first = await invoke(routes.routes, 'POST', revisionPath, { requestId: REQUEST_ID }, body);
  assert.equal(first.status, 202);
  assert.equal(first.body.state, 'resume_unknown');
  const repeated = await invoke(routes.routes, 'POST', revisionPath, { requestId: REQUEST_ID }, body);
  assert.equal(repeated.status, 202);
  assert.equal(repeated.body.state, 'resume_unknown');
  assert.equal((await fixture.engine.find('sys_approval_action', {
    where: { request_id: REQUEST_ID, action: 'resubmit' }, context: SYSTEM,
  })).length, 1, 'unknown resume and repeated POST leave exactly one native audit action');
  const savedContract = await fixture.engine.findOne('forge_sales_contract', { where: { id: CONTRACT_ID }, context: SYSTEM });
  assert.equal(savedContract.submitted_material_id.id, FILE_ID);
  assert.equal(savedContract.submitted_material_sha256, fileSha);
});
