import assert from 'node:assert/strict';
import test from 'node:test';
import { CollectionAllocationCancel } from '../src/actions/finance.action.ts';

function cancellationFixture(actor, { allocation = {}, receipt = {} } = {}) {
  const writes = [];
  const currentAllocation = {
    id: 'allocation-a', status: 'pending_review', receipt_id: 'receipt-a', amount: 40,
    allocated_on: '2026-09-28', owner_id: 'cashier-a', responsible_id: 'cashier-a',
    created_by: 'cashier-a', ...allocation,
  };
  const currentReceipt = {
    id: 'receipt-a', allocated_amount: 40, unallocated_amount: 0,
    owner_id: 'cashier-a', responsible_id: 'cashier-a', created_by: 'cashier-a',
    ...receipt,
  };
  const ctx = {
    recordId: currentAllocation.id,
    record: currentAllocation,
    session: { userId: actor },
    input: {},
    api: {
      object(name) {
        if (name === 'forge_cash_receipt') return {
          findOne: async () => currentReceipt,
          update: async patch => { writes.push({ object: name, patch }); return patch; },
        };
        if (name === 'forge_collection_allocation') return {
          update: async patch => { writes.push({ object: name, patch }); return patch; },
        };
        throw new Error(`Unexpected object ${name}`);
      },
    },
  };
  const invoke = new Function('ctx', `return (async () => { ${CollectionAllocationCancel.body.source} })()`);
  return { invoke: () => invoke(ctx), writes };
}

test('allocation cancellation requires the actor to own or handle the allocation or receipt', async () => {
  const fixture = cancellationFixture('reviewer-b');
  await assert.rejects(fixture.invoke(), /仅收款分配或收款流水的实际经办人可取消分配/);
  assert.equal(fixture.writes.length, 0, 'a reviewer with organization read scope must not mutate another cashier record');
});

test('the actual allocation handler can cancel their pending allocation', async () => {
  const fixture = cancellationFixture('cashier-a');
  const result = await fixture.invoke();
  assert.equal(result.status, 'cancelled');
  assert.equal(result.released_amount, 40);
  assert.deepEqual(fixture.writes.map(({ object }) => object), [
    'forge_cash_receipt', 'forge_collection_allocation',
  ]);
  assert.equal(fixture.writes[0].patch.unallocated_amount, 40);
  assert.equal(fixture.writes[1].patch.status, 'cancelled');
});

test('the actual receipt handler can cancel an allocation handled by a different employee', async () => {
  const fixture = cancellationFixture('cashier-a', {
    allocation: { owner_id: 'cashier-b', responsible_id: 'cashier-b', created_by: 'cashier-b' },
    receipt: { owner_id: 'cashier-a', responsible_id: 'cashier-a', created_by: 'cashier-a' },
  });
  const result = await fixture.invoke();
  assert.equal(result.status, 'cancelled');
  assert.equal(fixture.writes.length, 2);
});
