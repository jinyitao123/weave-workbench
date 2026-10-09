import assert from 'node:assert/strict';
import test from 'node:test';
import { employeeBusinessBinding, withEmployeeBusinessBinding } from '../src/plugins/employee-business-binding.ts';
import { normalizeReferenceIds, createEmployeeLead } from '../src/plugins/employee-business-creation.ts';

const intent = userId => ({ userId, organizationId: 'test-org', objectName: 'forge_quotation', recordId: userId + '-quote',
  actionName: 'quotation_submit', recordVersion: 'a'.repeat(64), expiresAt: new Date(Date.now()+600000).toISOString(), operationKey: userId + '-operation', requestDigest: 'b'.repeat(64) });
test('employee intent stays isolated across parallel users and closes after rejection or completion', async () => {
  let finishA, finishB;
  const gateA = new Promise(resolve => { finishA = resolve; }), gateB = new Promise(resolve => { finishB = resolve; });
  const a = withEmployeeBusinessBinding(intent('a'), async () => {
    assert.equal(employeeBusinessBinding().userId, 'a'); finishB(); await gateA;
    assert.equal(employeeBusinessBinding().recordId, 'a-quote');
    await assert.rejects(withEmployeeBusinessBinding(intent('inner'), async () => {
      assert.equal(employeeBusinessBinding().userId, 'inner'); throw new Error('controlled rejection');
    }), /controlled rejection/);
    assert.equal(employeeBusinessBinding().userId, 'a');
  });
  const b = withEmployeeBusinessBinding(intent('b'), async () => {
    await gateB; assert.equal(employeeBusinessBinding().userId, 'b'); finishA();
  });
  assert.equal(employeeBusinessBinding(), undefined); await Promise.all([a, b]);
  assert.equal(employeeBusinessBinding(), undefined);
  let runDetached;
  const detached = new Promise(resolve => { runDetached = resolve; });
  let detachedResult;
  await withEmployeeBusinessBinding(intent('detached'), async () => {
    detachedResult = detached.then(() => employeeBusinessBinding());
  });
  runDetached(); assert.equal(await detachedResult, undefined, 'late inherited async work cannot reuse closed intent');
  await assert.rejects(withEmployeeBusinessBinding(intent('reject'), async () => { throw new Error('rejected'); }), /rejected/);
  assert.equal(employeeBusinessBinding(), undefined);
});

test('creation references reject prototype keys and an invalid private expiry never reaches a write', async () => {
  assert.throws(() => normalizeReferenceIds('{"__proto__":["record"]}', 'forge_quotation'), /未声明/);
  assert.throws(() => normalizeReferenceIds('{"constructor":["record"]}', 'forge_quotation'), /未声明/);
  assert.throws(() => normalizeReferenceIds({}, 'forge_quotation'), /未声明/);
  assert.deepEqual(normalizeReferenceIds({ sku_id: ['sku-b', 'sku-a'] }, 'forge_quotation'), { sku_id: ['sku-a', 'sku-b'] });
  let writes = 0;
  await withEmployeeBusinessBinding({ ...intent('creator'), objectName: 'forge_sales_lead', recordId: undefined,
    recordVersion: undefined, actionName: 'sales_lead_create', expiresAt: 'invalid', creationCode: 'XS-20261008-001' }, async () => {
    await assert.rejects(createEmployeeLead({ transaction() { writes++; throw new Error('unexpected write'); } },
      { user: { id: 'creator' }, session: { userId: 'creator', organizationId: 'test-org' }, record: {}, params: { objectName: 'forge_sales_lead', name: 'Lead', company_name: 'Company' } }), /本人当前业务上下文/);
  });
  assert.equal(writes, 0);
});
