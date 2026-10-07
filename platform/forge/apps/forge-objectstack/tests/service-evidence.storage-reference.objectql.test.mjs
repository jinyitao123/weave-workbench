import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { QuickJSScriptRunner, actionBodyRunnerFactory } from '@objectstack/runtime';
import { SystemFile, installFileReferenceHooks } from '../node_modules/.pnpm/@objectstack+service-storage@17.5.0/node_modules/@objectstack/service-storage/dist/index.js';
import { ServiceOrderAttachEvidence } from '../src/actions/service-workspace.action.ts';
import { ServiceOrderComplete } from '../src/actions/sales.action.ts';
import { ServiceFileReferenceTransactionBridgePlugin } from '../src/plugins/service-file-reference-transaction-bridge.plugin.ts';

const actor = 'service-engineer';
const organizationId = 'service-org';
const orderId = 'service-order-1';

/** A real 17.5 ObjectQL + service-storage hook fixture, without starting HTTP services. */
async function StorageReferenceFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'forge-service-evidence-'));
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(directory, 'fixture.sqlite') }, useNullAsDefault: true });
  const engine = new ObjectQL();
  const sysFile = ObjectSchema.create({
    ...SystemFile,
    fields: { ...SystemFile.fields, organization_id: Field.text({ label: 'Organization ID' }) },
  });
  const serviceOrder = ObjectSchema.create({
    name: 'forge_service_order', label: 'Service Order', sharingModel: 'private',
    fields: {
      name: Field.text({ required: true }), code: Field.text({}), organization_id: Field.text({}),
      revision: Field.number({ defaultValue: 1 }),
      owner_id: Field.text({}), responsible_id: Field.text({}), engineer_id: Field.text({}),
      status: Field.text({}), service_hours: Field.number({}), treatment_record: Field.textarea({}),
      service_result: Field.textarea({}), completed_at: Field.datetime({}), next_step: Field.text({}),
      onsite_evidence_attachments: Field.file({ label: 'On-site images', multiple: true, accept: ['image/*'] }),
    },
    enable: { apiEnabled: true, trackHistory: true },
  });
  const objects = [sysFile, serviceOrder];
  for (const object of objects) engine.registerObject(object);
  engine.registerDriver(driver, true);
  await engine.init();
  await driver.initObjects(objects.map(object => engine.getObject(object.name)));
  new ServiceFileReferenceTransactionBridgePlugin().start({
    hook(_event, ready) { ready(); },
    getService() { return engine; },
  });
  installFileReferenceHooks(engine, () => null, { warn() {}, debug() {} });
  t.after(async () => { await driver.disconnect(); await rm(directory, { recursive: true, force: true }); });

  const system = { isSystem: true, userId: actor, tenantId: organizationId, permissions: ['forge_service_operator'] };
  await engine.insert('sys_file', {
    id: 'service-image-1', key: 'user/service-image-1.jpg', name: '现场照片.jpg',
    mime_type: 'image/jpeg', size: 128, scope: 'user', status: 'committed',
    owner_id: actor, organization_id: organizationId,
  }, { context: system });
  await engine.insert('sys_file', {
    id: 'service-image-2', key: 'user/service-image-2.jpg', name: '现场照片二.jpg',
    mime_type: 'image/jpeg', size: 128, scope: 'user', status: 'committed',
    owner_id: actor, organization_id: organizationId,
  }, { context: system });
  await engine.insert('sys_file', {
    id: 'service-image-3', key: 'user/service-image-3.jpg', name: '现场照片三.jpg',
    mime_type: 'image/jpeg', size: 128, scope: 'user', status: 'committed',
    owner_id: actor, organization_id: organizationId,
  }, { context: system });
  await engine.insert('forge_service_order', {
    id: orderId, name: '现场维修', code: 'SO-TEST', organization_id: organizationId,
    owner_id: actor, responsible_id: actor, engineer_id: actor, status: 'in_progress',
    onsite_evidence_attachments: [],
  }, { context: system });

  async function action(definition, params) {
    const caller = { userId: actor, tenantId: organizationId, permissions: ['forge_service_operator'] };
    const record = await engine.findOne(definition.objectName, { where: { id: orderId } }, { context: { ...caller, isSystem: true } });
    const runner = new QuickJSScriptRunner({ actionTimeoutMs: 10_000 });
    const handler = actionBodyRunnerFactory(runner, { ql: engine, appId: 'service-evidence-storage-reference-test' })(definition);
    try {
      return await handler({
        object: definition.objectName, recordId: orderId, record, params,
        session: { userId: actor, organizationId }, user: { id: actor, organizationId },
        api: engine.createContext({ ...caller, isSystem: true }),
      });
    } finally { await runner.dispose(); }
  }
  function failAfterNextClaim() {
    let armed = true;
    engine.registerHook('afterUpdate', async hook => {
      if (!armed || hook.object !== 'forge_service_order' || !hook.input?.data?.onsite_evidence_attachments) return;
      armed = false;
      const fieldFile = hook.input.data.onsite_evidence_attachments[0];
      const fileId = typeof fieldFile === 'string' ? fieldFile : fieldFile&&fieldFile.id;
      const row = await engine.findOne('sys_file', { where: { id: fileId } }, { context: { ...system, transaction: hook.transaction } });
      assert.equal(row.ref_object, 'forge_service_order', 'failure injection runs after the native sys_file claim');
      assert.equal(String(row.ref_id), orderId);
      throw new Error('injected failure after native file claim');
    }, { object: 'forge_service_order', priority: 200, packageId: 'com.inoforge.test-service-evidence' });
  }
  return { engine, system, action, failAfterNextClaim };
}

test('real 17.5 QuickJS action writes a native file-field reference and completion reads it back', async t => {
  const fixture = await StorageReferenceFixture(t);
  const before = await fixture.engine.findOne('forge_service_order', { where: { id: orderId } }, { context: fixture.system });
  const linked = await fixture.action(ServiceOrderAttachEvidence, {
    file_ids: JSON.stringify(['service-image-1']), expected_updated_at: before.updated_at,
  });
  assert.equal(linked.attachment_count, 1);

  const [savedOrder, savedFile] = await Promise.all([
    fixture.engine.findOne('forge_service_order', { where: { id: orderId } }, { context: fixture.system }),
    fixture.engine.findOne('sys_file', { where: { id: 'service-image-1' } }, { context: fixture.system }),
  ]);
  assert.deepEqual(savedOrder.onsite_evidence_attachments.map(file => file.id), ['service-image-1']);
  assert.equal(savedFile.ref_object, 'forge_service_order');
  assert.equal(String(savedFile.ref_id), orderId);
  assert.equal(savedFile.ref_field, 'onsite_evidence_attachments');

  const completed = await fixture.action(ServiceOrderComplete, {
    service_hours: 1, treatment_record: '更换接线端子', service_result: '设备恢复运行',
  });
  assert.equal(completed.status, 'completed');
  const finalOrder = await fixture.engine.findOne('forge_service_order', { where: { id: orderId } }, { context: fixture.system });
  assert.equal(finalOrder.status, 'completed');
  assert.deepEqual(finalOrder.onsite_evidence_attachments.map(file => file.id), ['service-image-1']);
});

test('17.5 file claim and service-order write roll back together after a downstream hook failure', async t => {
  const fixture = await StorageReferenceFixture(t);
  fixture.failAfterNextClaim();
  const before = await fixture.engine.findOne('forge_service_order', { where: { id: orderId } }, { context: fixture.system });
  await assert.rejects(fixture.action(ServiceOrderAttachEvidence, {
    file_ids: JSON.stringify(['service-image-1']), expected_updated_at: before.updated_at,
  }), /injected failure after native file claim/);
  const [savedOrder, savedFile] = await Promise.all([
    fixture.engine.findOne('forge_service_order', { where: { id: orderId } }, { context: fixture.system }),
    fixture.engine.findOne('sys_file', { where: { id: 'service-image-1' } }, { context: fixture.system }),
  ]);
  assert.deepEqual(savedOrder.onsite_evidence_attachments, []);
  assert.equal(savedOrder.revision, 1);
  assert.equal(savedFile.ref_object, null);
  assert.equal(savedFile.ref_id, null);
  assert.equal(savedFile.ref_field, null);
});

test('two evidence appends from one stale service-order read cannot overwrite each other', async t => {
  const fixture = await StorageReferenceFixture(t);
  const before = await fixture.engine.findOne('forge_service_order', { where: { id: orderId } }, { context: fixture.system });
  const inputs = ['service-image-2', 'service-image-3'].map(fileId => fixture.action(ServiceOrderAttachEvidence, {
    file_ids: JSON.stringify([fileId]), expected_updated_at: before.updated_at,
  }));
  const outcomes = await Promise.allSettled(inputs);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  const saved = await fixture.engine.findOne('forge_service_order', { where: { id: orderId } }, { context: fixture.system });
  assert.equal(saved.onsite_evidence_attachments.length, 1);
  assert.ok(['service-image-2', 'service-image-3'].includes(saved.onsite_evidence_attachments[0].id));
});
