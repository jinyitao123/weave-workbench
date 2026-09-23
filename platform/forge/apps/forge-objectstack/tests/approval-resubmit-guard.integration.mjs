import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { LiteKernel } from '@objectstack/core';
import { RestServer } from '../node_modules/.pnpm/@objectstack+rest@17.3.0/node_modules/@objectstack/rest/dist/index.js';
import { ApprovalResubmitGuardPlugin } from '../src/plugins/approval-resubmit-guard.plugin.ts';

const contractRequest = {
  id: 'request-contract',
  object_name: 'forge_sales_contract',
  record_id: 'contract-1',
  process_name: 'flow:sales_contract_approval',
  status: 'returned',
  submitter_id: 'user-1',
  payload: { name: 'A contract', submitted_material_sha256: 'a'.repeat(64) },
};

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

async function boot(request, { verifyMaterialBinding, verifierServiceName, verifier } = {}) {
  const writes = [];
  const native = {
    async getRequest(id) { return id === request.id ? request : null; },
    async listActions() { return [{ id: 'return-action-1', action: 'revise', created_at: '2026-09-23T00:00:00.000Z' }]; },
    async resubmit(id, input, context) {
      writes.push({ kind: 'approval_action', requestId: id, actorId: input.actorId });
      return { request: { id, status: 'returned' }, runId: 'run-1', resumed: true };
    },
  };
  const approvalPlugin = {
    name: 'com.objectstack.service.approvals',
    version: '1.0.0',
    type: 'standard',
    providesServices: ['approvals'],
    init() {},
    start(ctx) { ctx.registerService('approvals', native); },
  };
  const kernel = new LiteKernel({ logger: { level: 'silent' } });
  kernel.use(approvalPlugin);
  kernel.use(new ApprovalResubmitGuardPlugin({
    requiredMaterialObjects: ['forge_sales_contract'],
    verifyMaterialBinding,
    verifierServiceName,
  }));
  if (verifierServiceName) kernel.use({
    name: 'test.material-verifier', version: '1.0.0', type: 'standard',
    init() {},
    start(ctx) { ctx.registerService(verifierServiceName, { verifyBinding: verifier }); },
  });
  await kernel.bootstrap();

  const fakeServer = { get() {}, post() {}, put() {}, delete() {}, patch() {}, use() {} };
  const protocol = {
    async getDiscovery() { return { version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }; },
    async getMetaTypes() { return []; },
    async getMetaItems() { return { items: [] }; },
    async findData() { return { records: [] }; },
  };
  const rest = new RestServer(
    fakeServer,
    protocol,
    { api: { requireAuth: false } },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async () => kernel.getService('approvals'),
  );
  rest.resolveExecCtx = async () => ({ isSystem: false, userId: 'user-1', positions: [], permissions: [] });
  rest.registerRoutes();
  const route = rest.getRoutes().find((entry) => entry.method === 'POST' && entry.path === '/api/v1/approvals/requests/:id/resubmit');
  assert.ok(route, 'the native approval resubmit route is registered');

  async function postResubmit(id, body = {}) {
    const response = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
    };
    await route.handler({
      method: 'POST',
      path: `/api/v1/approvals/requests/${id}/resubmit`,
      params: { id },
      query: {},
      headers: {},
      body,
    }, response);
    return response;
  }

  return { kernel, native, writes, postResubmit };
}

test('native REST resubmit rejects a material-required contract before the approval service writes an action', async () => {
  const state = await boot(contractRequest);
  try {
    // ObjectStack REST 17.3 maps only actorId/comment into IApprovalService.resubmit,
    // so a direct REST retry arrives without the internal material binding.
    const response = await state.postResubmit(contractRequest.id, {
      comment: 'Please resubmit',
      idempotencyKey: '41111111-1111-4111-8111-111111111111',
      materialBinding: {
        bindingId: '42222222-2222-4222-8222-222222222222',
        returnVersion: 'return-action-1',
        sourceMaterialVersion: 'a'.repeat(64),
        newVersionDigest: 'b'.repeat(64),
      },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, 'VALIDATION_FAILED');
    assert.match(response.body.error, /material binding and idempotency key are required/);
    assert.deepEqual(state.writes, [], 'the native service was not invoked, so no resubmit action was written');
    assert.notEqual(state.kernel.getService('approvals'), state.native, 'the service registry contains the guard wrapper');
  } finally {
    await state.kernel.shutdown();
  }
});

test('ordinary approvals remain unchanged when their object has no material policy', async () => {
  const request = { ...contractRequest, id: 'request-order', object_name: 'forge_sales_order' };
  const state = await boot(request);
  try {
    const response = await state.postResubmit(request.id, { actorId: 'user-1', comment: 'No materials required' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.request.id, request.id);
    assert.deepEqual(state.writes, [{ kind: 'approval_action', requestId: request.id, actorId: 'user-1' }]);
  } finally {
    await state.kernel.shutdown();
  }
});

test('the internal binding seam verifies with the authenticated session actor before delegation', async () => {
  // This harness verifier is a stub for the later Forge domain validator. It
  // tests the adapter contract only; it does not prove durable one-time use.
  const verified = [];
  const state = await boot(contractRequest, {
    verifyMaterialBinding: async (input) => {
      verified.push(input);
      return true;
    },
  });
  try {
    const approvals = state.kernel.getService('approvals');
    const result = await approvals.resubmit(contractRequest.id, {
      actorId: 'forged-user',
      comment: 'Updated material is ready',
      idempotencyKey: '41111111-1111-4111-8111-111111111111',
      materialBinding: {
        bindingId: '42222222-2222-4222-8222-222222222222',
        returnVersion: 'return-action-1',
        sourceMaterialVersion: sha256(contractRequest.payload),
        newVersionDigest: 'b'.repeat(64),
      },
    }, { isSystem: false, userId: 'user-1', positions: [], permissions: [] });
    assert.equal(result.request.id, contractRequest.id);
    assert.equal(verified.length, 1);
    assert.equal(verified[0].actorId, 'user-1');
    assert.deepEqual(state.writes, [{ kind: 'approval_action', requestId: contractRequest.id, actorId: 'user-1' }]);
  } finally {
    await state.kernel.shutdown();
  }
});

test('the guard resolves a Forge material service registered after its startup', async () => {
  const verified = [];
  const state = await boot(contractRequest, {
    verifierServiceName: 'forge.contract.revision.material',
    verifier: async (input) => { verified.push(input); return true; },
  });
  try {
    const approvals = state.kernel.getService('approvals');
    await approvals.resubmit(contractRequest.id, {
      idempotencyKey: '41111111-1111-4111-8111-111111111111',
      materialBinding: {
        bindingId: '42222222-2222-4222-8222-222222222222',
        returnVersion: 'return-action-1',
        sourceMaterialVersion: sha256(contractRequest.payload),
        newVersionDigest: 'b'.repeat(64),
      },
    }, { isSystem: false, userId: 'user-1', positions: [], permissions: [] });
    assert.equal(verified.length, 1);
    assert.deepEqual(state.writes, [{ kind: 'approval_action', requestId: contractRequest.id, actorId: 'user-1' }]);
  } finally {
    await state.kernel.shutdown();
  }
});
