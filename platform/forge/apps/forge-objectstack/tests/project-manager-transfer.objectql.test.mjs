import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { P } from '@objectstack/spec';
import { actionBodyRunnerFactory, QuickJSScriptRunner } from '@objectstack/runtime';
import { ProjectManagerTransfer } from '../src/actions/project-manager-transfer.action.ts';
import { ProjectMemberAdd, ProjectMemberDeactivate, ProjectMemberUpdate } from '../src/actions/project-member-maintenance.action.ts';
import { ProjectMemberMaintenancePlugin } from '../src/plugins/project-member-maintenance.plugin.ts';
import { createProjectMembershipRlsResolver, PROJECT_MANAGER_RLS_KEY, PROJECT_RLS_MEMBERSHIP_KEY, projectPositionReadScopeKey } from '../src/plugins/project-rls-membership.plugin.ts';

const organizationId = 'org-1';
const oldManagerId = 'manager-1';
const newManagerId = 'manager-2';
const projectId = 'project-1';
const businessDate = new Date().toISOString().slice(0, 10);

const schema = (name, fields) => ObjectSchema.create({ name, label: name, fields, enable: { apiEnabled: true, trackHistory: true } });
const objects = [
  schema('sys_organization', { name: Field.text({}), timezone: Field.text({}) }),
  schema('sys_user', { name: Field.text({}), display_name: Field.text({}), active: Field.boolean({}), banned: Field.boolean({}) }),
  schema('sys_member', { user_id: Field.text({}), organization_id: Field.text({}), active: Field.boolean({}), valid_from: Field.datetime({}), valid_until: Field.datetime({}) }),
  schema('sys_user_position', { user_id: Field.text({}), position: Field.text({}), organization_id: Field.text({}), valid_from: Field.datetime({}), valid_until: Field.datetime({}) }),
  schema('sys_position', { name: Field.text({}), label: Field.text({}), active: Field.boolean({}) }),
  schema('sys_position_permission_set', { position_id: Field.text({}), permission_set_id: Field.text({}) }),
  schema('sys_permission_set', { active: Field.boolean({}), object_permissions: Field.text({}), system_permissions: Field.text({}) }),
  schema('forge_project', {
    name: Field.text({ required: true }), organization_id: Field.text({}), owner_id: Field.text({}),
    manager_id: Field.user({ required: true, readonlyWhen: P`true` }),
    manager_transfer_target_id: Field.user({ hidden: true }), manager_name_snapshot: Field.text({ readonly: true }),
  }),
  schema('forge_project_member', {
    name: Field.text({ required: true }), membership_key: Field.text({ unique: true }),
    project_id: Field.text({ required: true }), organization_id: Field.text({}), user_id: Field.text({ required: true }),
    member_duty: Field.text({ required: true }), joined_on: Field.date({ required: true }),
    active: Field.boolean({}), position_assignment_revision: Field.number({}), remarks: Field.text({}),
  }),
  schema('forge_project_timesheet', { organization_id: Field.text({}), project_id: Field.text({}), status: Field.text({}), approval_status: Field.text({}) }),
  schema('forge_project_expense', { organization_id: Field.text({}), project_id: Field.text({}), status: Field.text({}), approval_status: Field.text({}) }),
  schema('forge_project_member_position_assignment', {
    name: Field.text({}), assignment_key: Field.text({}), project_id: Field.text({}), member_id: Field.text({}), organization_id: Field.text({}),
    position_id: Field.text({}), position_name_snapshot: Field.text({}), is_default: Field.boolean({}), active: Field.boolean({}),
    assigned_at: Field.datetime({}), ended_at: Field.datetime({}),
  }),
];

async function fixture(t, { activeNewMember = false, failAfterHandoff = false, newAppointment = { user_id: newManagerId, organization_id: organizationId, active: true }, targetPermissions = ['forge_project_operator', 'forge_project_manager'] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'forge-project-manager-transfer-'));
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(directory, 'test.sqlite') }, useNullAsDefault: true });
  const engine = new ObjectQL();
  for (const object of objects) engine.registerObject(object);
  engine.registerDriver(driver, true);
  await engine.init();
  await driver.initObjects(objects);
  t.after(async () => { await driver.disconnect(); await rm(directory, { recursive: true, force: true }); });

  const context = { isSystem: true, userId: oldManagerId, tenantId: organizationId, positions: [], permissions: ['forge_project_operator'] };
  await engine.insert('sys_organization', { id: organizationId, name: '交接测试组织', timezone: 'UTC' }, { context });
  await engine.insert('sys_user', { id: oldManagerId, name: '旧负责人', display_name: '旧负责人', active: true, banned: false }, { context });
  await engine.insert('sys_user', { id: newManagerId, name: '新负责人', display_name: '新负责人', active: true, banned: false }, { context });
  await engine.insert('sys_member', { id: 'membership-old', user_id: oldManagerId, organization_id: organizationId, active: true }, { context });
  await engine.insert('sys_member', { id: 'membership-new', ...newAppointment }, { context });
  await engine.insert('sys_user_position', { id: 'position-grant-old', user_id: oldManagerId, position: 'project_manager', organization_id: organizationId }, { context });
  await engine.insert('sys_position', { id: 'position-1', name: 'project_manager', label: '项目经理', active: true }, { context });
  await engine.insert('sys_permission_set', { id: 'manager-position-set', active: true, object_permissions: JSON.stringify({ forge_project_cost_entry: { allowRead: true } }), system_permissions: '[]' }, { context });
  await engine.insert('sys_position_permission_set', { id: 'manager-position-binding', position_id: 'position-1', permission_set_id: 'manager-position-set' }, { context });
  await engine.insert('forge_project', {
    id: projectId, name: '项目经理交接样板', organization_id: organizationId,
    owner_id: 'owner-1', manager_id: oldManagerId, manager_name_snapshot: '旧负责人',
  }, { context });
  await engine.insert('forge_project_member', {
    id: 'manager-row-old', name: '旧负责人', membership_key: projectId + ':' + oldManagerId,
    project_id: projectId, organization_id: organizationId, user_id: oldManagerId,
    member_duty: 'manager', joined_on: businessDate, active: true,
  }, { context });
  await engine.insert('forge_project_member_position_assignment', {
    id: 'old-manager-role-assignment', name: '旧负责人岗位', assignment_key: projectId + ':' + oldManagerId + ':position-1',
    project_id: projectId, member_id: 'manager-row-old', organization_id: organizationId,
    position_id: 'position-1', position_name_snapshot: '项目管理', is_default: true, active: true,
    assigned_at: '2026-01-01T00:00:00.000Z', ended_at: null,
  }, { context });
  if (activeNewMember) await engine.insert('forge_project_member', {
    id: 'member-row-new', name: '新负责人', membership_key: projectId + ':' + newManagerId,
    project_id: projectId, organization_id: organizationId, user_id: newManagerId,
    member_duty: 'member', joined_on: '2026-09-10', active: true, remarks: '既有成员历史',
  }, { context });

  new ProjectMemberMaintenancePlugin(async (_reader, userId) => ({ systemPermissions: userId === newManagerId ? targetPermissions : ['forge_project_operator', 'forge_project_manager'] })).start({
    hook(_event, ready) { ready(); }, getService() { return engine; },
  });
  if (failAfterHandoff) engine.registerHook('afterUpdate', hook => {
    if (hook.object === 'forge_project' && hook.result?.manager_id === newManagerId) throw new Error('交接后故障注入');
  }, { object: 'forge_project', priority: 200, packageId: 'com.inoforge.test-project-manager-transfer' });

  const runBodyAction = async (action, { object = 'forge_project', recordId = projectId, actor = oldManagerId, input = {} } = {}) => {
    const callerContext = { userId: actor, tenantId: organizationId, positions: [], permissions: ['forge_project_operator'] };
    const record = await engine.findOne(object, { where: { id: recordId } }, { context: { ...callerContext, isSystem: true } });
    const params = { ...input };
    if (action === ProjectManagerTransfer && params.updated_at == null) params.updated_at = record?.updated_at;
    const runner = new QuickJSScriptRunner({ actionTimeoutMs: 10_000 });
    const handler = actionBodyRunnerFactory(runner, { ql: engine, appId: 'forge-project-manager-transfer-test' })(action);
    try {
      return await handler({
        object, record, recordId, params,
        session: { userId: actor, organizationId, positions: [] },
        user: { id: actor, organizationId, positions: [] },
        api: engine.createContext(callerContext),
      });
    } finally { await runner.dispose(); }
  };
  const runAction = ({ actor = oldManagerId, target = newManagerId, expectedUpdatedAt, ...rest } = {}) => runBodyAction(ProjectManagerTransfer, {
    actor, input: { manager_id: target, ...(expectedUpdatedAt !== undefined ? { updated_at: expectedUpdatedAt } : {}) }, ...rest,
  });

  return { engine, context, runAction, runBodyAction };
}

test('the real ObjectQL before/after hooks transfer a manager and promote an existing member in one transaction', async t => {
  for (const activeNewMember of [false, true]) {
    const h = await fixture(t, { activeNewMember });
    const current = await h.engine.findOne('forge_project', { where: { id: projectId } }, { context: h.context });
    const result = await h.runAction({ expectedUpdatedAt: current.updated_at });
    const [savedProject, members, assignments] = await Promise.all([
      h.engine.findOne('forge_project', { where: { id: projectId } }, { context: h.context }),
      h.engine.find('forge_project_member', { where: { project_id: projectId }, orderBy: [{ field: 'id', order: 'asc' }] }, { context: h.context }),
      h.engine.find('forge_project_member_position_assignment', { where: { project_id: projectId } }, { context: h.context }),
    ]);
    assert.equal(result.status, 'transferred');
    assert.equal(savedProject.manager_id, newManagerId);
    assert.equal(savedProject.manager_name_snapshot, '新负责人');
    const activeManagers = members.filter(row => row.member_duty === 'manager' && row.active === true);
    assert.deepEqual(activeManagers.map(row => row.user_id), [newManagerId]);
    assert.equal(members.find(row => row.id === 'manager-row-old').active, false);
    assert.equal(assignments.find(row => row.id === 'old-manager-role-assignment').active, false);
    assert.equal(assignments.find(row => row.id === 'old-manager-role-assignment').is_default, false);
    assert.ok(assignments.find(row => row.id === 'old-manager-role-assignment').ended_at);
    const newRelation = members.find(row => row.user_id === newManagerId);
    assert.equal(newRelation.member_duty, 'manager');
    if (activeNewMember) {
      assert.equal(newRelation.id, 'member-row-new');
      assert.equal(newRelation.remarks, '既有成员历史');
      assert.equal(newRelation.joined_on, '2026-09-10');
    } else {
      assert.equal(newRelation.joined_on, businessDate);
    }
    const resolver = createProjectMembershipRlsResolver(() => h.engine);
    const [oldScope, newScope] = await Promise.all([
      resolver.resolve({ userId: oldManagerId, tenantId: organizationId, permissions: ['forge_project_manager'] }),
      resolver.resolve({ userId: newManagerId, tenantId: organizationId, permissions: ['forge_project_manager'] }),
    ]);
    assert.deepEqual(oldScope[PROJECT_RLS_MEMBERSHIP_KEY], []);
    assert.deepEqual(oldScope[PROJECT_MANAGER_RLS_KEY], []);
    assert.deepEqual(newScope[PROJECT_RLS_MEMBERSHIP_KEY], [projectId]);
    assert.deepEqual(newScope[PROJECT_MANAGER_RLS_KEY], [projectId]);
    assert.deepEqual(oldScope[projectPositionReadScopeKey('forge_project_cost_entry')], []);
    assert.deepEqual(newScope[projectPositionReadScopeKey('forge_project_cost_entry')], []);
  }
});

test('manager handoff is blocked while a project sheet or expense still awaits approval or cost posting', async t => {
  for (const objectName of ['forge_project_timesheet', 'forge_project_expense']) {
    const h = await fixture(t);
    await h.engine.insert(objectName, {
      id: objectName + '-pending', organization_id: organizationId, project_id: projectId,
      status: 'pending_review', approval_status: objectName === 'forge_project_timesheet' ? 'approved' : 'pending',
    }, { context: h.context });
    const current = await h.engine.findOne('forge_project', { where: { id: projectId } }, { context: h.context });
    await assert.rejects(h.runAction({ expectedUpdatedAt: current.updated_at }), /仍有待审批或审批结果待入账/);
    const [savedProject, members] = await Promise.all([
      h.engine.findOne('forge_project', { where: { id: projectId } }, { context: h.context }),
      h.engine.find('forge_project_member', { where: { project_id: projectId } }, { context: h.context }),
    ]);
    assert.equal(savedProject.manager_id, oldManagerId);
    assert.equal(members.length, 1);
    assert.equal(members[0].user_id, oldManagerId);
  }
});

test('a downstream afterUpdate failure rolls back the project manager and both team relationships', async t => {
  const h = await fixture(t, { failAfterHandoff: true });
  const current = await h.engine.findOne('forge_project', { where: { id: projectId } }, { context: h.context });
  await assert.rejects(h.runAction({ expectedUpdatedAt: current.updated_at }), /交接后故障注入/);
  const [savedProject, members, assignments] = await Promise.all([
    h.engine.findOne('forge_project', { where: { id: projectId } }, { context: h.context }),
    h.engine.find('forge_project_member', { where: { project_id: projectId } }, { context: h.context }),
    h.engine.find('forge_project_member_position_assignment', { where: { project_id: projectId } }, { context: h.context }),
  ]);
  assert.equal(savedProject.manager_id, oldManagerId);
  assert.equal(savedProject.manager_name_snapshot, '旧负责人');
  assert.equal(members.length, 1);
  assert.equal(members[0].user_id, oldManagerId);
  assert.equal(members[0].active, true);
  assert.equal(members[0].member_duty, 'manager');
  assert.equal(assignments[0].active, true);
  assert.equal(assignments[0].is_default, true);
  assert.equal(assignments[0].ended_at, null);
});

test('readonly manager fields and unversioned transfer requests are rejected outside the Action', async t => {
  const h = await fixture(t);
  await assert.rejects(() => h.engine.update('forge_project', { id: projectId, manager_id: newManagerId }, { context: h.context }), /负责人只读/);
  await assert.rejects(() => h.engine.update('forge_project', { manager_transfer_target_id: newManagerId }, { multi: true, where: { id: projectId, manager_id: oldManagerId }, context: h.context }), /必须使用当前版本办理/);
  const saved = await h.engine.findOne('forge_project', { where: { id: projectId } }, { context: h.context });
  assert.equal(saved.manager_id, oldManagerId);
});

test('QuickJS manager Action rejects stale versions, invalid appointments and non-owner/non-manager actors', async t => {
  const stale = await fixture(t);
  await assert.rejects(stale.runAction({ expectedUpdatedAt: '2026-10-03T00:00:00.000Z' }), /项目资料已变化/);
  const unauthorized = await fixture(t);
  await assert.rejects(unauthorized.runAction({ actor: 'other-user' }), /仅项目所有者或当前项目经理/);
  const crossOrg = await fixture(t, { newAppointment: { user_id: newManagerId, organization_id: 'org-2', active: true } });
  await assert.rejects(crossOrg.runAction(), /当前组织内有效账号/);
  const inactive = await fixture(t, { newAppointment: { user_id: newManagerId, organization_id: organizationId, active: false } });
  await assert.rejects(inactive.runAction(), /当前组织内有效账号/);
  const noManagerCapability = await fixture(t, { targetPermissions: ['forge_project_operator'] });
  await assert.rejects(noManagerCapability.runAction(), /必须具备项目经理执行权限/);
});

test('QuickJS member add/edit/deactivate Actions use the same transaction API and predicate CAS writes', async t => {
  const h = await fixture(t);
  const add = await h.runBodyAction(ProjectMemberAdd, { input: { user_id: newManagerId, member_duty: 'member', joined_on: businessDate, remarks: '项目成员' } });
  assert.equal(add.status, 'created');
  const member = await h.engine.findOne('forge_project_member', { where: { membership_key: projectId + ':' + newManagerId } }, { context: h.context });
  assert.equal(member.member_duty, 'member');

  const updated = await h.runBodyAction(ProjectMemberUpdate, {
    object: 'forge_project_member', recordId: member.id,
    input: { expected_updated_at: member.updated_at, joined_on: businessDate, remarks: '修改后备注' },
  });
  assert.equal(updated.status, 'updated');
  const changed = await h.engine.findOne('forge_project_member', { where: { id: member.id } }, { context: h.context });
  assert.equal(changed.remarks, '修改后备注');

  await assert.rejects(h.runBodyAction(ProjectMemberUpdate, {
    object: 'forge_project_member', recordId: member.id,
    input: { expected_updated_at: member.updated_at, joined_on: businessDate, remarks: '旧版本' },
  }), /已被修改/);
  const deactivated = await h.runBodyAction(ProjectMemberDeactivate, {
    object: 'forge_project_member', recordId: member.id,
    input: { expected_updated_at: changed.updated_at },
  });
  assert.equal(deactivated.status, 'deactivated');
  const final = await h.engine.findOne('forge_project_member', { where: { id: member.id } }, { context: h.context });
  assert.equal(final.active, false);
});
