import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceFileReferenceTransactionBridgePlugin } from '../src/plugins/service-file-reference-transaction-bridge.plugin.ts';

test('nested Native sys_file inserts inherit the transaction of a bound file-field update', async () => {
  const writes = [];
  const engine = {
    async insert(object, data, options = {}) {
      writes.push({ method: 'insert', object, data, options });
      return { id: data?.id };
    },
    async update(object, data, options = {}) {
      writes.push({ method: 'update', object, data, options });
      if (object === 'forge_quotation') {
        await engine.insert('sys_file', { id: 'copy-on-claim' }, {
          context: { isSystem: true, tenantId: 'quotation-org', userId: 'storage-hook' },
        });
      }
      return { id: data?.id };
    },
    async find() { return []; },
    async findOne() { return null; },
  };

  new ServiceFileReferenceTransactionBridgePlugin().start({
    hook(_event, ready) { ready(); },
    getService() { return engine; },
  });

  const transaction = { marker: 'active-quotation-transaction' };
  await engine.update('forge_quotation', { customer_acceptance_evidence_attachment: { id: 'send-file' } }, {
    context: { transaction, tenantId: 'quotation-org', userId: 'quotation-maker' },
  });

  const copiedFileInsert = writes.find(write => write.method === 'insert' && write.object === 'sys_file');
  assert.ok(copiedFileInsert, 'Native copy-on-claim inserts a new sys_file row');
  assert.strictEqual(copiedFileInsert.options.context.transaction, transaction);
  assert.equal(copiedFileInsert.options.context.isSystem, true);
  assert.equal(copiedFileInsert.options.context.tenantId, 'quotation-org');
  assert.equal(copiedFileInsert.options.context.userId, 'storage-hook');
});
