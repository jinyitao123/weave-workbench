import assert from 'node:assert/strict';
import test from 'node:test';
import { businessActionPolicy, isTeamDelegableAction, projectBusinessActionPolicy } from '../src/plugins/business-action-policy.ts';

test('personal business decisions remain personal even during human-owned task issuance', () => {
  for (const [objectName, name] of [
    ['forge_sales_contract', 'contract_register_signature'],
    ['forge_sales_contract', 'contract_convert_to_sales_order'],
    ['forge_sales_contract', 'contract_approval_mcp_approve'],
    ['forge_sales_contract', 'contract_approval_mcp_send_back'],
    ['forge_sales_order', 'sales_order_submit'],
    ['forge_sales_order', 'sales_order_approve'],
    ['forge_customer_prepayment', 'customer_prepayment_confirm'],
  ]) {
    const nativeAction = { objectName, name, requiresRecord: true };
    assert.equal(isTeamDelegableAction(nativeAction), false);
    assert.deepEqual(projectBusinessActionPolicy(nativeAction), {
      ...nativeAction, effect: 'write', executionMode: 'employee_only',
    });
  }
});

test('team submission remains available and policy uses the full object/action identity', () => {
  assert.equal(isTeamDelegableAction({ objectName: 'forge_sales_contract', name: 'contract_submit_material_package' }), true);
  assert.equal(isTeamDelegableAction({ objectName: 'forge_unrelated', name: 'sales_order_approve' }), true);
  assert.equal(isTeamDelegableAction({ name: 'sales_order_approve' }), false);
  assert.equal(isTeamDelegableAction({ objectName: 'forge_sales_order' }), false);
});

test('client-supplied policy cannot widen a native personal action', () => {
  const action = { objectName: 'forge_sales_order', name: 'sales_order_submit', executionMode: 'team_delegable', effect: 'read' };
  assert.deepEqual(projectBusinessActionPolicy(action), {
    ...action, executionMode: 'employee_only', effect: 'write',
  });
  assert.deepEqual(businessActionPolicy('forge_sales_contract', 'contract_submit_frozen_material'), {
    effect: 'read', executionMode: 'team_delegable',
  });
});
