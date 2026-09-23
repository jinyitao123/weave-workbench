import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ContractRevisionMaterialPlugin, approvalPayloadVersion } from '../src/plugins/contract-revision-material.ts';

const requestId = 'approval-returned';
const contractId = 'contract-A';
const fileId = '11111111-1111-4111-8111-111111111111';
const key = '33333333-3333-4333-8333-333333333333';

async function fixture({ failAfterAction = false, failBeforeAction = false } = {}) {
  const bytes = Buffer.from('修订合同正文', 'utf8');
  const file = { id: fileId, key: 'file-key', name: '修订合同.txt', mime_type: 'text/plain',
    size: bytes.length, status: 'committed', owner_id: 'sales-A' };
  const contract = { id: contractId, code: 'HT-A', status: 'pending_approval', submitted_material_id: 'old-file' };
  const request = { id: requestId, object_name: 'forge_sales_contract', record_id: contractId,
    submitter_id: 'sales-A', status: 'returned', viewer: { is_submitter: true },
    flow_run_id: 'run-A', created_at: '2026-09-23T10:00:00.000Z', payload: { name: '原合同' } };
  const actions = [{ id: 'return-action-A', action: 'revise' }];
  const requests = [request];
  const ledger = new Map();
  const engine = {
    async find(name, query) {
      if (name === 'sys_file') return query.where.id.$in.includes(fileId) ? [file] : [];
      if (name === 'sys_approval_request') return requests.filter((row) =>
        row.flow_run_id === query.where.flow_run_id && row.record_id === query.where.record_id);
      return [];
    },
    async findOne(name, query) {
      if (name === 'forge_sales_contract') return query.where.id === contractId ? contract : null;
      if (name === 'sys_approval_request') return query.where.id === requestId
        ? { ...request, payload: undefined, payload_json: JSON.stringify(request.payload) } : null;
      if (name === 'forge_sales_contract_revision_material') {
        if (query.where.id) return [...ledger.values()].find((row) => row.id === query.where.id) ?? null;
        if (query.where.approval_request_id) return ledger.get(query.where.approval_request_id) ?? null;
        if (query.where.idempotency_key) return [...ledger.values()].find((row) => row.idempotency_key === query.where.idempotency_key) ?? null;
      }
      return null;
    },
    async transaction(callback, _context, options) { assert.equal(options.require, true); return callback({ isSystem: true }, { owned: true }); },
    async insert(name, row) { assert.equal(name, 'forge_sales_contract_revision_material'); ledger.set(row.approval_request_id, row); return row; },
    async update(name, row) { assert.equal(name, 'forge_sales_contract'); Object.assign(contract, row); return contract; },
  };
  let materials;
  let resubmitCalls = 0;
  const approvals = {
    async getRequest(id) { return id === requestId ? request : null; },
    async listActions() { return actions; },
    async resubmit(id, input, context) {
      resubmitCalls++;
      assert.equal(id, requestId);
      assert.equal(context.userId, 'sales-A');
      assert.equal(input.actorId, 'sales-A');
      assert.equal(await materials.verifyBinding({ request, actorId: 'sales-A', context,
        materialBinding: input.materialBinding, idempotencyKey: input.idempotencyKey }), true);
      if (failBeforeAction) throw new Error('approval service unavailable before action');
      actions.push({ id: 'resubmit-action-A', action: 'resubmit' });
      if (failAfterAction) throw new Error('resume failed after approval action');
      requests.push({ id: 'approval-round-2', object_name: 'forge_sales_contract', record_id: contractId,
        flow_run_id: 'run-A', created_at: '2026-09-23T10:01:00.000Z' });
      return { request, resumed: true };
    },
  };
  const routes = new Map();
  const server = {
    post(path, handler) { routes.set(`POST ${path}`, handler); },
    get(path, handler) { routes.set(`GET ${path}`, handler); },
  };
  const services = {
    approvals, objectql: engine, storage: { async download() { return Buffer.from(bytes); } },
    'http.server': server,
    auth: { api: { async getSession({ headers }) {
      return headers.get('authorization') === 'Bearer sales-token'
        ? { user: { id: 'sales-A' }, session: { activeOrganizationId: 'org-A' } } : null;
    } } },
  };
  let ready;
  const context = {
    hook(name, callback) { if (name === 'kernel:ready') ready = callback; },
    getService(name) { if (!(name in services)) throw new Error(`missing ${name}`); return services[name]; },
    registerService(name, service) { services[name] = service; materials = service; },
    getKernel() { return {}; }, logger: { error() {} },
  };
  new ContractRevisionMaterialPlugin().init(context);
  await ready();
  const body = { returnVersion: 'return-action-A', sourceMaterialVersion: await approvalPayloadVersion(request.payload),
    idempotencyKey: key, primary: { fileId, name: file.name, sha256: createHash('sha256').update(bytes).digest('hex') }, attachments: [] };
  async function call(method, route, params, input = body, token = 'sales-token') {
    const handler = routes.get(`${method} ${route}`);
    assert.ok(handler);
    let status = 200;
    let response;
    await handler({ params, body: input, headers: { authorization: `Bearer ${token}` } }, {
      status(value) { status = value; return this; },
      json(value) { response = value; },
    });
    return { status, body: response };
  }
  return { call, body, contract, ledger, get resubmitCalls() { return resubmitCalls; } };
}

test('employee revision updates the contract then resumes the original approval exactly once', async () => {
  const f = await fixture();
  const route = '/api/v1/approvals/requests/:requestId/workbench-revision';
  const first = await f.call('POST', route, { requestId });
  assert.equal(first.status, 200);
  assert.equal(first.body.state, 'resumed');
  assert.equal(f.contract.submitted_material_id, fileId);
  assert.equal(f.ledger.size, 1);
  assert.equal(f.resubmitCalls, 1);
  const repeated = await f.call('POST', route, { requestId });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.state, 'resumed');
  assert.equal(f.resubmitCalls, 1);
  const receipt = await f.call('GET', '/api/v1/approvals/requests/:requestId/workbench-revision/:idempotencyKey', { requestId, idempotencyKey: key });
  assert.equal(receipt.status, 200);
  assert.equal(receipt.body.state, 'resumed');
});

test('unknown native resume outcome stays queryable and never replays the approval action', async () => {
  const f = await fixture({ failAfterAction: true });
  const route = '/api/v1/approvals/requests/:requestId/workbench-revision';
  const first = await f.call('POST', route, { requestId });
  assert.equal(first.status, 202);
  assert.equal(first.body.state, 'resume_unknown');
  const repeated = await f.call('POST', route, { requestId });
  assert.equal(repeated.status, 202);
  assert.equal(f.resubmitCalls, 1);
});

test('a failure before the native action reports not submitted and does not silently replay', async () => {
  const f = await fixture({ failBeforeAction: true });
  const route = '/api/v1/approvals/requests/:requestId/workbench-revision';
  const first = await f.call('POST', route, { requestId });
  assert.equal(first.status, 503);
  assert.equal(first.body.state, 'prepared');
  const repeated = await f.call('POST', route, { requestId });
  assert.equal(repeated.status, 202);
  assert.equal(repeated.body.state, 'prepared');
  assert.equal(f.resubmitCalls, 1);
});
