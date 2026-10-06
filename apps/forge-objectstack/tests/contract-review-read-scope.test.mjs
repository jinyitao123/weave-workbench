import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { RLSCompiler, RLS_DENY_FILTER } from '@objectstack/plugin-security';
import { salesOrderOperatorPermission } from '../src/permissions/sales-order.permission.ts';
import { CONTRACT_REVIEW_RLS_KEY, projectPositionReadScopeKey } from '../src/plugins/project-rls-membership.plugin.ts';

const require = createRequire(import.meta.url);
const requireSDK = createRequire(require.resolve('@objectstack/plugin-security'));
const { matchesFilterCondition } = await import(pathToFileURL(requireSDK.resolve('@objectstack/formula')).href);
const declared = new Set(['id', 'status', 'signed_on', 'signed_evidence_attachment']);
const unsigned = id => ({ id, status: 'pending_approval', signed_on: null, signed_evidence_attachment: null });
const signed = { id: 'signed', status: 'active', signed_on: '2026-10-06', signed_evidence_attachment: 'evidence' };
const policy = salesOrderOperatorPermission.rowLevelSecurity.filter(row => row.object === 'forge_sales_contract');

test('native signed-contract policy fails closed when its declared review projection is unavailable', () => {
  const filter = new RLSCompiler().compileFilter(policy, {
    userId: 'synthetic-user', tenantId: 'synthetic-org',
    rlsMembership: { [projectPositionReadScopeKey('forge_sales_contract')]: ['project-only'] },
  }, 'using', { declared });
  assert.equal(filter, RLS_DENY_FILTER);
  assert.equal(matchesFilterCondition(signed, filter, { declared }), false);
});

test('project positions alone cannot authorize an unsigned contract through the order permission', () => {
  const filter = new RLSCompiler().compileFilter(policy, {
    userId: 'synthetic-user', tenantId: 'synthetic-org',
    rlsMembership: { [projectPositionReadScopeKey('forge_sales_contract')]: ['project-only'], [CONTRACT_REVIEW_RLS_KEY]: [] },
  }, 'using', { declared });
  assert.equal(matchesFilterCondition(signed, filter, { declared }), true);
  for (const id of ['project-only', 'review', 'unrelated']) assert.equal(matchesFilterCondition(unsigned(id), filter, { declared }), false);
});

test('an exact native review grant adds only its selected unsigned contract and preserves the signed branch', () => {
  const filter = new RLSCompiler().compileFilter(policy, {
    userId: 'synthetic-user', tenantId: 'synthetic-org',
    rlsMembership: { [projectPositionReadScopeKey('forge_sales_contract')]: ['project-only'], [CONTRACT_REVIEW_RLS_KEY]: ['review'] },
  }, 'using', { declared });
  assert.equal(matchesFilterCondition(signed, filter, { declared }), true);
  assert.equal(matchesFilterCondition(unsigned('review'), filter, { declared }), true);
  for (const id of ['project-only', 'unrelated']) assert.equal(matchesFilterCondition(unsigned(id), filter, { declared }), false);
});
