import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { actionBodyRunnerFactory, QuickJSScriptRunner } from '@objectstack/runtime';
import {
  ProjectMemberPositionAssignmentsRead,
  ProjectMemberPositionAssignmentsSave,
  ProjectTaskOwnerPositionAssignmentsRead,
} from '../src/actions/project-member-position-assignment.action.ts';

const org = 'org-position-assignment-test';
const projectId = 'project-position-assignment-test';
const memberId = 'member-position-assignment-test';
const actorId = 'owner-position-assignment-test';
const employeeId = 'employee-position-assignment-test';
const stamp = '2026-10-03T08:00:00.000Z';
const schema = (name, fields) => ObjectSchema.create({ name, label: name, fields, enable: { apiEnabled: true, trackHistory: true } });

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'forge-project-position-'));
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(directory, 'test.sqlite') }, useNullAsDefault: true });
  const engine = new ObjectQL();
  const objects = [
    schema('forge_project', { name: Field.text({}), organization_id: Field.text({}), owner_id: Field.text({}), manager_id: Field.text({}) }),
    schema('forge_project_member', { name: Field.text({}), project_id: Field.text({}), organization_id: Field.text({}), user_id: Field.text({}), member_duty: Field.text({}), active: Field.boolean({}), position_assignment_revision: Field.number({}) }),
    schema('forge_project_member_position_assignment', { name: Field.text({}), assignment_key: Field.text({ unique: true }), project_id: Field.text({}), member_id: Field.text({}), organization_id: Field.text({}), position_id: Field.text({}), position_name_snapshot: Field.text({}), is_default: Field.boolean({}), active: Field.boolean({}), assigned_at: Field.datetime({}), ended_at: Field.datetime({}), remarks: Field.text({}) }),
    schema('sys_user_position', { user_id: Field.text({}), position: Field.text({}), organization_id: Field.text({}), active: Field.boolean({}), valid_from: Field.datetime({}), valid_until: Field.datetime({}) }),
    schema('sys_position', { name: Field.text({}), label: Field.text({}), active: Field.boolean({}) }),
    schema('sys_position_permission_set', { position_id: Field.text({}), permission_set_id: Field.text({}) }),
    schema('sys_permission_set', { label: Field.text({}), active: Field.boolean({}), object_permissions: Field.text({}), system_permissions: Field.text({}) }),
  ];
  for (const object of objects) engine.registerObject(object);
  engine.registerDriver(driver, true);
  await engine.init();
  await driver.initObjects(objects);
  t.after(async () => { await driver.disconnect(); await rm(directory, { recursive: true, force: true }); });
  const context = { isSystem: true, userId: actorId, tenantId: org, organizationId: org, permissions: ['forge_project_operator'] };
  await engine.insert('forge_project', { id: projectId, organization_id: org, name: '岗位项目', owner_id: actorId, manager_id: 'manager-position-test' }, { context });
  await engine.insert('forge_project_member', { id: memberId, organization_id: org, project_id: projectId, user_id: employeeId, name: '项目成员', member_duty: 'member', active: true, position_assignment_revision: 0, updated_at: stamp }, { context });
  const appointments = [
    { id: 'appointment-design', user_id: employeeId, position: 'hardware_engineer', organization_id: org, active: true, valid_from: null, valid_until: null },
    { id: 'appointment-qa', user_id: employeeId, position: 'quality_engineer', organization_id: org, active: true, valid_from: null, valid_until: null },
    { id: 'appointment-foreign', user_id: employeeId, position: 'cross_org_role', organization_id: 'org-other', active: true, valid_from: null, valid_until: null },
  ];
  for (const row of appointments) await engine.insert('sys_user_position', row, { context });
  for (const row of [
    { id: 'position-design', name: 'hardware_engineer', label: '硬件工程师', active: true },
    { id: 'position-qa', name: 'quality_engineer', label: '质量工程师', active: true },
    { id: 'position-foreign', name: 'cross_org_role', label: '跨组织岗位', active: true },
  ]) await engine.insert('sys_position', row, { context });
  await engine.insert('sys_permission_set', { id: 'permission-engineering', label: '项目计划读取', active: true, object_permissions: JSON.stringify({ forge_project_plan: { allowRead: true } }), system_permissions: JSON.stringify(['forge_project_work_member']) }, { context });
  await engine.insert('sys_permission_set', { id: 'permission-qa', label: '项目附件维护', active: true, object_permissions: JSON.stringify({ forge_project_attachment: { allowRead: true, allowCreate: true } }), system_permissions: '[]' }, { context });
  await engine.insert('sys_position_permission_set', { id: 'binding-design', position_id: 'position-design', permission_set_id: 'permission-engineering' }, { context });
  await engine.insert('sys_position_permission_set', { id: 'binding-qa', position_id: 'position-qa', permission_set_id: 'permission-qa' }, { context });
  const run = async (action, input = {}) => {
    const actionContext = { ...context, userId: actorId };
    const record = await engine.findOne(action.objectName, { where: { id: memberId } }, { context: actionContext });
    const runner = new QuickJSScriptRunner({ actionTimeoutMs: 10_000 });
    const handler = actionBodyRunnerFactory(runner, { ql: engine, appId: 'forge-project-position-assignment-test' })(action);
    try {
      return await handler({
        object: action.objectName, record, recordId: memberId, params: input,
        session: { userId: actorId, organizationId: org, permissions: ['forge_project_operator'] },
        user: { id: actorId, organizationId: org, permissions: ['forge_project_operator'] },
        api: engine.createContext(actionContext),
      });
    } finally { await runner.dispose(); }
  };
  return { engine, context, run };
}

test('native QuickJS position read dynamically resolves current appointments and PermissionSet modules', async t => {
  const h = await fixture(t);
  const result = await h.run(ProjectMemberPositionAssignmentsRead);
  assert.equal(result.member_id, memberId);
  assert.deepEqual(result.available_positions.map(row => row.label), ['硬件工程师', '质量工程师']);
  assert.deepEqual(result.available_positions.map(row => row.modules), [['计划与任务'], ['附件']]);
  assert.equal(result.default_assignment_id, null);
  assert.equal(result.assignments.length, 0, 'old members are not auto-backfilled');
});

test('native QuickJS save binds multiple appointments, permits one default, and preserves retired assignment history', async t => {
  const h = await fixture(t);
  const params = { expected_updated_at: stamp, position_ids: JSON.stringify(['position-design', 'position-qa']), default_position_id: 'position-qa' };
  const saved = await h.run(ProjectMemberPositionAssignmentsSave, params);
  assert.equal(saved.assignment_count, 2);
  const rows = await h.engine.find('forge_project_member_position_assignment', { where: { project_id: projectId, member_id: memberId, organization_id: org }, orderBy: [{ field: 'id', order: 'asc' }] }, { context: h.context });
  assert.equal(rows.filter(row => row.active === true).length, 2);
  assert.equal(rows.filter(row => row.active === true && row.is_default === true).length, 1);
  assert.equal(rows.find(row => row.is_default === true)?.position_id, 'position-qa');

  const member = await h.engine.findOne('forge_project_member', { where: { id: memberId } }, { context: h.context });
  const next = await h.run(ProjectMemberPositionAssignmentsSave, { expected_updated_at: member.updated_at, position_ids: JSON.stringify(['position-design']), default_position_id: 'position-design' });
  assert.equal(next.assignment_count, 1);
  const history = await h.engine.find('forge_project_member_position_assignment', { where: { project_id: projectId, member_id: memberId, organization_id: org }, orderBy: [{ field: 'position_id', order: 'asc' }] }, { context: h.context });
  assert.equal(history.length, 2, 'removed role remains as a history row');
  assert.equal(history.find(row => row.position_id === 'position-qa').active, false);
  assert.ok(history.find(row => row.position_id === 'position-qa').ended_at);
  assert.equal(history.find(row => row.position_id === 'position-design').is_default, true);
});

test('task-owner position choices derive project execution capability from the bound native PermissionSet', async t => {
  const h = await fixture(t);
  await h.run(ProjectMemberPositionAssignmentsSave, {
    expected_updated_at: stamp, position_ids: JSON.stringify(['position-design', 'position-qa']), default_position_id: 'position-qa',
  });
  const result = await h.run(ProjectTaskOwnerPositionAssignmentsRead);
  assert.equal(result.project_task_capable, true);
  assert.equal(result.assignments.find(row => row.positionId === 'position-design')?.projectTaskCapable, true);
  assert.equal(result.assignments.find(row => row.positionId === 'position-qa')?.projectTaskCapable, false);
  assert.equal(result.default_assignment_id, null, 'a default role without project task capability is not offered as the task owner default');
});

test('foreign-org appointment, stale member version and a default outside the selected set refuse without mutation', async t => {
  const h = await fixture(t);
  await assert.rejects(h.run(ProjectMemberPositionAssignmentsSave, { expected_updated_at: stamp, position_ids: JSON.stringify(['position-foreign']), default_position_id: 'position-foreign' }), /只能分配该员工当前组织内的有效岗位/);
  await assert.rejects(h.run(ProjectMemberPositionAssignmentsSave, { expected_updated_at: '2026-10-03T07:59:59.000Z', position_ids: '[]', default_position_id: null }), /资料已变化/);
  await assert.rejects(h.run(ProjectMemberPositionAssignmentsSave, { expected_updated_at: stamp, position_ids: JSON.stringify(['position-design']), default_position_id: 'position-qa' }), /默认岗位必须是当前有效分配/);
  assert.equal(await h.engine.count('forge_project_member_position_assignment', { where: { project_id: projectId, member_id: memberId } }, { context: h.context }), 0);
});

test('real QuickJS transaction rolls role rows back when the member revision compare-and-set fails', async t => {
  const h = await fixture(t);
  h.engine.registerHook('beforeUpdate', hook => {
    const update = hook.input?.data ?? hook.input ?? {};
    if (hook.object === 'forge_project_member' && Object.hasOwn(update, 'position_assignment_revision')) throw new Error('岗位修订CAS故障');
  }, { object: 'forge_project_member', priority: 200, packageId: 'com.inoforge.test-project-position-assignment' });
  await assert.rejects(h.run(ProjectMemberPositionAssignmentsSave, {
    expected_updated_at: stamp, position_ids: JSON.stringify(['position-design', 'position-qa']), default_position_id: 'position-qa',
  }), /岗位修订CAS故障/);
  const rows = await h.engine.find('forge_project_member_position_assignment', { where: { project_id: projectId, member_id: memberId, organization_id: org } }, { context: h.context });
  const member = await h.engine.findOne('forge_project_member', { where: { id: memberId } }, { context: h.context });
  assert.equal(rows.length, 0);
  assert.equal(Number(member.position_assignment_revision || 0), 0);
});
