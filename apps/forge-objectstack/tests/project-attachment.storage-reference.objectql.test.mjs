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
import { ProjectAttachmentCreate } from '../src/actions/project-attachment.action.ts';
import { ProjectAttachment } from '../src/objects/project.object.ts';
import { ServiceFileReferenceTransactionBridgePlugin } from '../src/plugins/service-file-reference-transaction-bridge.plugin.ts';

const actor = 'project-member';
const organizationId = 'project-attachment-org';
const projectId = 'project-attachment-project';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'forge-project-attachment-'));
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(directory, 'fixture.sqlite') }, useNullAsDefault: true });
  const engine = new ObjectQL();
  const sysFile = ObjectSchema.create({
    ...SystemFile,
    fields: { ...SystemFile.fields, organization_id: Field.text({ label: 'Organization ID' }) },
  });
  const project = ObjectSchema.create({
    name: 'forge_project', label: 'Project', fields: {
      name: Field.text({ required: true }), organization_id: Field.text({}), status: Field.text({}),
    }, enable: { apiEnabled: true, trackHistory: true },
  });
  const objects = [sysFile, project, ProjectAttachment];
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

  const system = { isSystem: true, userId: actor, tenantId: organizationId, permissions: ['forge_project_work_member'] };
  await engine.insert('forge_project', {
    id: projectId, name: '项目附件测试项目', organization_id: organizationId, status: 'in_progress',
  }, { context: system });
  await engine.insert('sys_file', {
    id: 'project-file-1', key: 'user/project-file-1.txt', name: '真实项目材料.txt',
    mime_type: 'text/plain', size: 128, scope: 'user', status: 'committed',
    owner_id: actor, organization_id: organizationId,
  }, { context: system });

  async function action({ fileId = 'project-file-1', permissions = ['forge_project_work_member'], denied = false, targetProjectId = projectId, remarks = '已核验', category = 'technical' } = {}) {
    const caller = { userId: actor, tenantId: organizationId, permissions };
    const record = await engine.findOne('forge_project', { where: { id: targetProjectId } }, { context: { ...caller, isSystem: true } });
    const runner = new QuickJSScriptRunner({ actionTimeoutMs: 10_000 });
    const handler = actionBodyRunnerFactory(runner, { ql: engine, appId: 'project-attachment-test' })(ProjectAttachmentCreate);
    try {
      return await handler({
        object: 'forge_project', recordId: targetProjectId, record, recordLoadDenied: denied,
        params: { file_id: fileId, category, remarks },
        session: { userId: actor, organizationId },
        user: { id: actor, organizationId, systemPermissions: permissions },
        api: engine.createContext({ ...caller, isSystem: true }),
      });
    } finally { await runner.dispose(); }
  }
  function failAfterFileClaim() {
    let armed = true;
    engine.registerHook('afterInsert', async hook => {
      if (!armed || hook.object !== 'forge_project_attachment') return;
      armed = false;
      const file = await engine.findOne('sys_file', { where: { id: 'project-file-1' } }, {
        context: { ...system, transaction: hook.transaction },
      });
      assert.equal(file.ref_object, 'forge_project_attachment', 'failure injection observes the native 17.5 file claim');
      assert.ok(file.ref_id);
      assert.equal(file.ref_field, 'attachment');
      throw new Error('injected project attachment failure after native file claim');
    }, { object: 'forge_project_attachment', priority: 200, packageId: 'com.inoforge.test-project-attachment' });
  }
  return { engine, system, action, failAfterFileClaim };
}

test('17.5 native file-field insert creates a project attachment with server-owned identity and file holding', async t => {
  const state = await fixture(t);
  const result = await state.action();
  assert.equal(result.replayed, false);
  assert.match(result.attachment_key, /^PFA-\d{8}-\d{4}$/);
  const [attachment, file] = await Promise.all([
    state.engine.findOne('forge_project_attachment', { where: { id: result.id } }, { context: state.system }),
    state.engine.findOne('sys_file', { where: { id: 'project-file-1' } }, { context: state.system }),
  ]);
  assert.equal(attachment.project_id, projectId);
  assert.equal(attachment.name, '真实项目材料.txt');
  assert.equal(attachment.uploaded_by, actor);
  assert.ok(attachment.uploaded_at);
  assert.equal(file.ref_object, 'forge_project_attachment');
  assert.equal(String(file.ref_id), String(result.id));
  assert.equal(file.ref_field, 'attachment');

  const repeated = await state.action();
  assert.equal(repeated.id, result.id);
  assert.equal(repeated.replayed, true);
  assert.equal((await state.engine.find('forge_project_attachment', { where: { project_id: projectId } }, { context: state.system })).length, 1);
});

test('17.5 sys_file claim and attachment insert roll back together after a downstream failure', async t => {
  const state = await fixture(t);
  state.failAfterFileClaim();
  await assert.rejects(state.action(), /injected project attachment failure after native file claim/);
  const [attachments, file] = await Promise.all([
    state.engine.find('forge_project_attachment', { where: { project_id: projectId } }, { context: state.system }),
    state.engine.findOne('sys_file', { where: { id: 'project-file-1' } }, { context: state.system }),
  ]);
  assert.deepEqual(attachments, []);
  assert.equal(file.ref_object, null);
  assert.equal(file.ref_id, null);
  assert.equal(file.ref_field, null);
});

test('native parent access and member or manager capability are required before storage ownership changes', async t => {
  const state = await fixture(t);
  await assert.rejects(state.action({ denied: true }), /当前项目不存在或不可访问/);
  await assert.rejects(state.action({ permissions: [] }), /当前账号没有项目附件上传权限/);
  const file = await state.engine.findOne('sys_file', { where: { id: 'project-file-1' } }, { context: state.system });
  assert.equal(file.ref_object, null);
  assert.equal((await state.engine.find('forge_project_attachment', { where: { project_id: projectId } }, { context: state.system })).length, 0);
});
