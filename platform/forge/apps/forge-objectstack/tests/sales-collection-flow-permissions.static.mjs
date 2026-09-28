import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CashReceiptReverse,
  CollectionAllocationApprove,
  CollectionAllocationCancel,
} from '../src/actions/finance.action.ts';
import {
  salesCollectionActionVisibilitySource,
  SalesCollectionFlowPage,
} from '../src/pages/sales-collection-flow.page.ts';

const getVisibility = new Function(
  `${salesCollectionActionVisibilitySource}; return collectionActionVisibility;`,
)();

const receipt = { owner_id: 'cashier-a', responsible_id: 'cashier-a', created_by: 'cashier-a' };
const allocation = { owner_id: 'cashier-a', responsible_id: 'cashier-a', created_by: 'cashier-a' };

test('receivables operator sees allocation actions only for owned or handled records', () => {
  const actions = getVisibility(['forge_finance_receivables_operator'], 'cashier-a', allocation, receipt);
  assert.deepEqual(actions, { canAllocate: true, canApprove: false, canCancel: true, canReverse: false });

  const otherEmployeeAllocation = { owner_id: 'cashier-b', responsible_id: 'cashier-b', created_by: 'cashier-b' };
  const otherEmployeeReceipt = { owner_id: 'cashier-b', responsible_id: 'cashier-b', created_by: 'cashier-b' };
  const otherEmployeeActions = getVisibility(
    ['forge_finance_receivables_operator'], 'cashier-a', otherEmployeeAllocation, otherEmployeeReceipt,
  );
  assert.equal(otherEmployeeActions.canCancel, false);

  const reassignedReceipt = getVisibility(
    ['forge_finance_receivables_operator'], 'cashier-a', allocation,
    { ...receipt, responsible_id: 'cashier-b' },
  );
  assert.equal(reassignedReceipt.canAllocate, false, 'allocation entry must follow the server action responsible_id check');
});

test('finance reviewer sees approval and reversal actions without receivables-operator actions', () => {
  const actions = getVisibility(['forge_finance_reviewer'], 'reviewer-a', allocation, receipt);
  assert.deepEqual(actions, { canAllocate: false, canApprove: true, canCancel: false, canReverse: true });

  const ownReview = getVisibility(['forge_finance_reviewer'], 'cashier-a', allocation, receipt);
  assert.equal(ownReview.canApprove, false, 'the UI should mirror the server self-review rejection');
});

test('page loads effective permissions and applies each role gate while retaining server gates', () => {
  const source = SalesCollectionFlowPage.source;
  assert.match(source, /request\('\/auth\/me\/permissions'\)/);
  assert.match(source, /systemPermissions=Array\.isArray\(permissions\.systemPermissions\)/);
  assert.match(source, /receiptAccess\.canAllocate/);
  assert.match(source, /allocationAccess\.canApprove/);
  assert.match(source, /allocationAccess\.canCancel/);
  assert.match(source, /receiptAccess\.canReverse/);
  assert.doesNotMatch(source, /find\('sys_user'\)/, 'unused user directory read must not block the page for the operator role');

  assert.deepEqual(CollectionAllocationCancel.requiredPermissions, ['forge_finance_receivables_operator']);
  assert.deepEqual(CollectionAllocationApprove.requiredPermissions, ['forge_finance_reviewer']);
  assert.deepEqual(CashReceiptReverse.requiredPermissions, ['forge_finance_reviewer']);
});
