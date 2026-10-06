import assert from 'node:assert/strict';
import test from 'node:test';
import { CashReceiptAllocate } from '../src/actions/finance.action.ts';
import { ServiceSettlementCreateReceivable } from '../src/actions/sales.action.ts';
import { AccountsReceivable } from '../src/objects/finance.object.ts';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = action => new AsyncFunction('ctx', action.body.source);

test('service settlement receivable starts unpaid, passes allocation status gate, and still rejects duplicates', async () => {
  const settlement = {
    id: 'settlement-1', organization_id: 'org-1', status: 'confirmed',
    name: 'Service settlement', customer_id: 'customer-1', service_order_id: null,
    responsible_id: 'manager-1', total_amount: 1500,
  };
  const receivables = [];
  const settlementUpdates = [];
  let allocationInsert;
  const createReceivableContext = () => ({
    recordId: settlement.id,
    record: settlement,
    session: { organizationId: 'org-1', userId: 'manager-1' },
    input: { due_on: '2026-10-15' },
    api: {
      object(name) {
        if (name === 'forge_accounts_receivable') return {
          find: async ({ where }) => receivables.filter(row => row.service_settlement_id === where.service_settlement_id),
          insert: async fields => {
            const row = { id: 'receivable-1', ...fields };
            receivables.push(row);
            return { id: row.id };
          },
        };
        if (name === 'forge_service_settlement') return {
          update: async fields => settlementUpdates.push(fields),
        };
        throw new Error('Unexpected object: ' + name);
      },
    },
  });

  const created = await execute(ServiceSettlementCreateReceivable)(createReceivableContext());
  assert.equal(created.receivable_code, receivables[0].code);
  assert.equal(receivables.length, 1);
  assert.equal(receivables[0].status, 'unpaid');
  assert.ok(AccountsReceivable.fields.status.options.some(option => option.value === receivables[0].status));
  assert.deepEqual(settlementUpdates, [{ id: settlement.id, status: 'receivable_created', receivable_code: receivables[0].code }]);

  const receipt = {
    id: 'receipt-1', status: 'unallocated', responsible_id: 'finance-1',
    customer_id: 'customer-1', allocated_amount: 0, unallocated_amount: 1500,
  };
  const allocationContext = {
    recordId: receipt.id,
    record: receipt,
    session: { userId: 'finance-1' },
    input: { receivable_id: receivables[0].id, code: 'allocation-1', allocated_on: '2026-10-05', amount: 500 },
    api: {
      object(name) {
        if (name === 'forge_accounts_receivable') return {
          findOne: async ({ where }) => receivables.find(row => row.id === where.id) || null,
        };
        if (name === 'forge_collection_allocation') return {
          insert: async fields => {
            allocationInsert = fields;
            throw new Error('stopped at allocation insert boundary');
          },
        };
        throw new Error('Unexpected object: ' + name);
      },
    },
  };
  await assert.rejects(execute(CashReceiptAllocate)(allocationContext), /stopped at allocation insert boundary/);
  assert.equal(allocationInsert?.receivable_id, receivables[0].id, 'the existing allocation status/customer/amount checks accepted the unpaid receivable');

  await assert.rejects(execute(ServiceSettlementCreateReceivable)(createReceivableContext()), /该服务结算已生成应收/);
  assert.equal(receivables.length, 1, 'retry still refuses a second receivable');
  assert.equal(settlementUpdates.length, 1, 'retry does not update the settlement again');
});
