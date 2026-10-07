import assert from 'node:assert/strict';
import test from 'node:test';
import { employeeBusinessBinding, withEmployeeBusinessBinding } from '../src/plugins/employee-business-binding.ts';

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
