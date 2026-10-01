import assert from 'node:assert/strict';
import test from 'node:test';
import { actionAllowed, delegableActions, entryAllowed, parseIssueRequest } from '../src/plugins/task-delegation.ts';

// Pure scope rules behind the Forge task delegation guards (decision 002).
const delegation = {
  delegationId: 'd-1',
  files: [
    { fileId: 'owned-1', sha256: 'a'.repeat(64), sourceKind: 'owner' },
    { fileId: 'approval-1', sha256: 'b'.repeat(64), sourceKind: 'approval', requestId: 'req-1' },
  ],
};

test('entry allowlist covers exactly the paths Weave uses with a task credential', () => {
  const allowed = [
    ['POST', '/api/v1/mcp'], ['GET', '/api/v1/auth/me/permissions'], ['GET', '/api/v1/auth/get-session'], ['GET', '/api/v1/meta/objects/forge_sales_contract'],
    ['GET', '/api/v1/storage/files/owned-1'], ['GET', '/api/v1/workbench/materials/owned-1'], ['GET', '/api/v1/workbench/materials/owned-1/original'],
    ['GET', '/api/v1/approvals/requests/req-1/workbench-history/files/approval-1/original'], ['DELETE', '/api/v1/workbench/task-delegations/d-1'],
  ];
  for (const [method, path] of allowed) assert.equal(entryAllowed(delegation, method, path), true, `${method} ${path}`);
  const refused = [
    ['GET', '/api/v1/storage/files/other'], ['GET', '/api/v1/workbench/materials/approval-1'],
    ['GET', '/api/v1/approvals/requests/req-2/workbench-history/files/approval-1/original'], ['DELETE', '/api/v1/workbench/task-delegations/d-2'],
    ['POST', '/api/v1/workbench/task-delegations'], ['GET', '/api/v1/data/forge_sales_contract'], ['PATCH', '/api/v1/data/forge_sales_contract/x'],
    ['POST', '/api/v1/auth/sign-out'], ['GET', '/api/v1/notifications'],
  ];
  for (const [method, path] of refused) assert.equal(entryAllowed(delegation, method, path), false, `${method} ${path}`);
});

test('actions match by declared name or target and stay on the delegated record', () => {
  const declared = delegableActions([
    { name: 'contract_submit_material_package', objectName: 'forge_sales_contract', target: 'contract_submit_target', ai: { exposed: true } },
    { name: 'hidden_action', objectName: 'forge_sales_contract', ai: { exposed: false } },
    { name: 'flow_action', objectName: 'forge_sales_contract', type: 'flow', ai: { exposed: true } },
  ]);
  assert.deepEqual([...declared.keys()], ['forge_sales_contract:contract_submit_material_package']);
  const scope = { actions: [{ objectName: 'forge_sales_contract', actionName: 'contract_submit_material_package' }], record: { objectName: 'forge_sales_contract', recordId: 'c-1' } };
  assert.equal(actionAllowed(scope, declared, 'forge_sales_contract', 'contract_submit_target', 'c-1'), true);
  assert.equal(actionAllowed(scope, declared, 'forge_sales_contract', 'contract_submit_material_package', 'c-1'), true);
  assert.equal(actionAllowed(scope, declared, 'forge_sales_contract', 'contract_submit_target', 'c-2'), false);
  assert.equal(actionAllowed(scope, declared, 'global', 'contract_submit_target', 'c-1'), false);
  assert.equal(actionAllowed(scope, declared, 'forge_sales_contract', 'hidden_action', 'c-1'), false);
});

test('issue requests are strict', () => {
  const base = { version: '1', idempotencyKey: '7c9e6679-7425-40de-944b-e07fc1f90ae7', inputDigest: 'c'.repeat(64), actions: [], files: [] };
  assert.equal(parseIssueRequest(base).ok, true);
  assert.equal(parseIssueRequest({ ...base, extra: 1 }).ok, false);
  assert.equal(parseIssueRequest({ ...base, files: [{ fileId: 'f', sha256: 'd'.repeat(64), sourceKind: 'approval' }] }).ok, false, 'approval files need their request');
  assert.equal(parseIssueRequest({ ...base, files: [{ fileId: 'f', sha256: 'd'.repeat(64), sourceKind: 'owner', requestId: 'r' }] }).ok, false);
  assert.equal(parseIssueRequest({ ...base, actions: [{ objectName: 'Bad Name', actionName: 'x' }] }).ok, false);
});
