import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { ProjectAttachment } from '../src/objects/project.object.ts';

test('project attachment keys are issued by the native SQL runtime, not supplied by the caller', async t => {
  const field = ProjectAttachment.fields.attachment_key;
  assert.deepEqual([field.type, field.autonumberFormat, field.unique, field.readonly], ['autonumber', 'PFA-{YYYYMMDD}-{0000}', 'global', true]);
  assert.equal(ProjectAttachment.fields.uploaded_by.readonly, true);
  assert.equal(ProjectAttachment.fields.uploaded_at.readonly, true);

  const directory = await mkdtemp(join(tmpdir(), 'forge-project-attachment-number-'));
  const attachmentSchema = ObjectSchema.create({
    name: 'forge_project_attachment_number_probe',
    label: '项目附件编号测试',
    fields: { name: Field.text({ required: true }), attachment_key: field },
  });
  const organizationSchema = ObjectSchema.create({ name: 'sys_organization', label: '组织', fields: { name: Field.text({}) } });
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(directory, 'test.sqlite') }, useNullAsDefault: true });
  const engine = new ObjectQL();
  engine.registerObject(attachmentSchema);
  engine.registerObject(organizationSchema);
  engine.registerDriver(driver, true);
  await engine.init();
  await driver.initObjects([attachmentSchema, organizationSchema]);
  t.after(async () => { await driver.disconnect(); await rm(directory, { recursive: true, force: true }); });

  const context = { userId: 'attachment-uploader' };
  await engine.insert(attachmentSchema.name, { name: '第一份材料', attachment_key: 'CALLER-SUPPLIED' }, { context });
  await engine.insert(attachmentSchema.name, { name: '第二份材料' }, { context });
  const rows = await engine.find(attachmentSchema.name, { orderBy: [{ field: 'attachment_key', order: 'asc' }] }, { context });
  assert.equal(rows.length, 2);
  assert.match(rows[0].attachment_key, /^PFA-\d{8}-\d{4}$/);
  assert.match(rows[1].attachment_key, /^PFA-\d{8}-\d{4}$/);
  assert.notEqual(rows[0].attachment_key, 'CALLER-SUPPLIED');
  assert.notEqual(rows[0].attachment_key, rows[1].attachment_key);
});
