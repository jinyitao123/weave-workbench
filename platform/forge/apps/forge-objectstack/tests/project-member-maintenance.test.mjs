import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProjectMemberAdd,
  ProjectMemberDeactivate,
  ProjectMemberUpdate,
} from '../src/actions/project-member-maintenance.action.ts';
import { ProjectMember } from '../src/objects/project.object.ts';
import { assertProjectMemberMutation } from '../src/plugins/project-member-maintenance.plugin.ts';

const org = 'org-1';
const project = { id: 'project-1', organization_id: org, owner_id: 'owner-1', manager_id: 'manager-1', status: 'in_progress' };
const user = { id: 'member-1', organization_id: org, display_name: '张敏', active: true, banned: false };
const joinedOn = '2026-10-03';
const stamp = '2026-10-03T10:00:00.000Z';

function matches(row, where = {}) {
  return Object.entries(where).every(([field, expected]) => {
    const actual = row[field];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$gte' in expected && !(String(actual) >= String(expected.$gte))) return false;
      if ('$lt' in expected && !(String(actual) < String(expected.$lt))) return false;
      return true;
    }
    return actual === expected;
  });
}

function harness({ projects = [project], users = [user], memberships = [{ user_id: user.id, organization_id: org, active: true }], members = [] } = {}, { failInsert = false } = {}) {
  const tables = {
    forge_project: structuredClone(projects),
    sys_user: structuredClone(users),
    sys_member: structuredClone(memberships),
    forge_project_member: structuredClone(members),
  };
  const calls = [];
  let nextId = 1;
  const object = name => ({
    async findOne(query = {}) { calls.push({ name, method: 'findOne', query }); const found = (tables[name] || []).find(row => matches(row, query.where)); return found ? structuredClone(found) : null; },
    async find(query = {}) { calls.push({ name, method: 'find', query }); return structuredClone((tables[name] || []).filter(row => matches(row, query.where))); },
    async insert(values) {
      calls.push({ name, method: 'insert', values: structuredClone(values) });
      const created = { ...structuredClone(values), id: 'member-row-' + nextId++, updated_at: stamp };
      (tables[name] ||= []).push(created);
      if (failInsert) throw new Error('simulated sharing hook failure');
      return structuredClone(created);
    },
    async update(values, options = {}) {
      calls.push({ name, method: 'update', values: structuredClone(values), options: structuredClone(options) });
      const rows = tables[name] || [];
      const matching = options.multi ? rows.filter(row => matches(row, options.where)) : rows.filter(row => row.id === values.id);
      matching.forEach(row => Object.assign(row, structuredClone(values), { updated_at: '2026-10-03T11:00:00.000Z' }));
      return matching.length;
    },
  });
  const api = {
    object,
    async transaction(run) {
      const before = structuredClone(tables);
      try { return await run(); }
      catch (error) { for (const key of Object.keys(tables)) delete tables[key]; Object.assign(tables, before); throw error; }
    },
  };
  return { tables, calls, api };
}

function context(api, input, { record = project, recordId = record?.id, sessionUser = 'owner-1', organizationId = org, recordLoadDenied = false } = {}) {
  return { api, input, record, recordId, recordLoadDenied, session: { userId: sessionUser, organizationId }, user: { id: sessionUser, organizationId } };
}

function run(action, ctx) {
  return new Function('ctx', `return (async () => { ${action.body.source} })()`)(ctx);
}

const addInput = { user_id: user.id, member_duty: 'member', joined_on: joinedOn, remarks: '项目参与成员' };

test('membership key remains hidden and read-only; action write gates use the native project operator capability', () => {
  assert.equal(ProjectMember.fields.membership_key.hidden, true);
  assert.equal(ProjectMember.fields.membership_key.readonly, true);
  for (const action of [ProjectMemberAdd, ProjectMemberUpdate, ProjectMemberDeactivate]) {
    assert.deepEqual(action.requiredPermissions, ['forge_project_operator']);
    assert.deepEqual(action.body.capabilities, ['api.read', 'api.write', 'api.transaction']);
  }
});

test('adding the same account is idempotent and derives the relationship name and stable key', async () => {
  const h = harness();
  const result = await run(ProjectMemberAdd, context(h.api, addInput));
  assert.deepEqual(result, { id: 'member-row-1', status: 'created', member_duty: 'member' });
  assert.deepEqual(h.tables.forge_project_member[0], {
    name: '张敏', membership_key: 'project-1:member-1', project_id: 'project-1', user_id: 'member-1',
    member_duty: 'member', joined_on: joinedOn, active: true, remarks: '项目参与成员', organization_id: org,
    id: 'member-row-1', updated_at: stamp,
  });
  assert.equal((await run(ProjectMemberAdd, context(h.api, addInput))).status, 'unchanged');
  assert.equal(h.tables.forge_project_member.length, 1);
});

test('adding a reactivated membership keeps the same row and membership key', async () => {
  const previous = { id: 'member-row-old', name: '张敏', membership_key: 'project-1:member-1', project_id: project.id, user_id: user.id, member_duty: 'member', joined_on: '2026-09-01', active: false, organization_id: org, updated_at: stamp };
  const h = harness({ members: [previous] });
  const result = await run(ProjectMemberAdd, context(h.api, { ...addInput, joined_on: '2026-10-03' }));
  assert.deepEqual(result, { id: previous.id, status: 'reactivated', member_duty: 'member' });
  assert.equal(h.tables.forge_project_member.length, 1);
  assert.equal(h.tables.forge_project_member[0].active, true);
  assert.equal(h.tables.forge_project_member[0].membership_key, previous.membership_key);
});

test('non-owner/non-manager, manager promotion, foreign organization and invalid accounts are rejected', async () => {
  const unauthorized = harness();
  await assert.rejects(() => run(ProjectMemberAdd, context(unauthorized.api, addInput, { sessionUser: 'member-1' })), /仅项目所有者或当前项目经理/);
  await assert.rejects(() => run(ProjectMemberAdd, context(unauthorized.api, { ...addInput, member_duty: 'manager' })), /只能使用“项目成员”角色/);
  await assert.rejects(() => run(ProjectMemberAdd, context(unauthorized.api, { ...addInput, user_id: project.manager_id })), /项目负责人已由项目关系维护/);

  const foreign = harness({ users: [{ ...user, organization_id: 'org-2' }], memberships: [] });
  await assert.rejects(() => run(ProjectMemberAdd, context(foreign.api, addInput)), /当前组织内有效账号/);
  const inactive = harness({ users: [{ ...user, active: false }] });
  await assert.rejects(() => run(ProjectMemberAdd, context(inactive.api, addInput)), /当前组织内有效账号/);
  const banned = harness({ users: [{ ...user, banned: true }] });
  await assert.rejects(() => run(ProjectMemberAdd, context(banned.api, addInput)), /当前组织内有效账号/);
  const noMembership = harness({ memberships: [] });
  await assert.rejects(() => run(ProjectMemberAdd, context(noMembership.api, addInput)), /当前组织内有效账号/);
  assert.equal(unauthorized.tables.forge_project_member.length, 0);
  assert.equal(foreign.tables.forge_project_member.length, 0);
});

test('failed member creation rolls back the row; date validation is enforced', async () => {
  const failed = harness({}, { failInsert: true });
  await assert.rejects(() => run(ProjectMemberAdd, context(failed.api, addInput)), /simulated sharing hook failure/);
  assert.equal(failed.tables.forge_project_member.length, 0);

  const invalid = harness();
  await assert.rejects(() => run(ProjectMemberAdd, context(invalid.api, { ...addInput, joined_on: '2026-02-30' })), /加入日期必须是有效日期/);
  assert.equal(invalid.tables.forge_project_member.length, 0);
});

test('member edit and deactivation use expected-version predicates, and never mutate/remove the project manager', async () => {
  const ordinary = { id: 'member-row-1', name: '张敏', membership_key: 'project-1:member-1', project_id: project.id, user_id: user.id, member_duty: 'member', joined_on: joinedOn, active: true, organization_id: org, updated_at: stamp, remarks: null };
  const h = harness({ members: [ordinary] });
  const updateResult = await run(ProjectMemberUpdate, context(h.api, { expected_updated_at: stamp, joined_on: '2026-10-04', remarks: '更新日期' }, { record: ordinary, recordId: ordinary.id }));
  assert.equal(updateResult.status, 'updated');
  assert.equal(h.tables.forge_project_member[0].joined_on, '2026-10-04');
  await assert.rejects(() => run(ProjectMemberUpdate, context(h.api, { expected_updated_at: stamp, joined_on: joinedOn }, { record: ordinary, recordId: ordinary.id })), /已被修改/);

  const current = { id: 'manager-row', name: '项目经理', membership_key: 'project-1:manager-1', project_id: project.id, user_id: project.manager_id, member_duty: 'manager', joined_on: joinedOn, active: true, organization_id: org, updated_at: stamp };
  const protectedManager = harness({ members: [current] });
  await assert.rejects(() => run(ProjectMemberUpdate, context(protectedManager.api, { expected_updated_at: stamp, joined_on: '2026-10-04' }, { record: current, recordId: current.id })), /当前项目负责人关系只读/);
  await assert.rejects(() => run(ProjectMemberDeactivate, context(protectedManager.api, { expected_updated_at: stamp }, { record: current, recordId: current.id })), /不能移除当前项目负责人/);
  assert.equal(protectedManager.tables.forge_project_member[0].active, true);

  const deactivated = await run(ProjectMemberDeactivate, context(h.api, { expected_updated_at: '2026-10-03T11:00:00.000Z' }, { record: h.tables.forge_project_member[0], recordId: ordinary.id }));
  assert.equal(deactivated.status, 'deactivated');
  assert.equal(h.tables.forge_project_member[0].active, false);
});

function hookEngine({ projectRow = project, userRow = user, membershipRow = { user_id: user.id, organization_id: org, active: true } } = {}) {
  const rows = { forge_project: [projectRow].filter(Boolean), sys_user: [userRow].filter(Boolean), sys_member: [membershipRow].filter(Boolean) };
  return {
    async findOne(object, query) { return (rows[object] || []).find(candidate => matches(candidate, query.where)) || null; },
  };
}

function mutationHook(input, { previous, actor = 'owner-1', actorOrg = org } = {}) {
  return { object: 'forge_project_member', event: previous ? 'beforeUpdate' : 'beforeInsert', input, previous, session: { userId: actor, organizationId: actorOrg }, user: { id: actor, organizationId: actorOrg } };
}

const projectOperator = async () => ({ systemPermissions: ['forge_project_operator'] });

test('the native before hook stamps stable hidden fields and refuses direct CRUD privilege bypasses', async () => {
  const engine = hookEngine();
  const insert = mutationHook({ project_id: project.id, user_id: user.id, member_duty: 'member', joined_on: joinedOn, name: 'spoof', membership_key: 'forged', organization_id: 'org-2', active: true });
  await assertProjectMemberMutation(engine, insert, 'beforeInsert', projectOperator);
  assert.equal(insert.input.name, '张敏');
  assert.equal(insert.input.membership_key, 'project-1:member-1');
  assert.equal(insert.input.organization_id, org);
  assert.equal(insert.input.member_duty, 'member');

  await assert.rejects(() => assertProjectMemberMutation(engine, mutationHook({ project_id: project.id, user_id: user.id, member_duty: 'manager', joined_on: joinedOn }), 'beforeInsert', projectOperator), /普通项目成员不能被设置为项目经理/);
  await assert.rejects(() => assertProjectMemberMutation(engine, mutationHook({ project_id: project.id, user_id: user.id, member_duty: 'member', joined_on: joinedOn }, { actor: 'other-user' }), 'beforeInsert', projectOperator), /仅项目所有者或当前项目经理/);
  await assert.rejects(() => assertProjectMemberMutation(engine, mutationHook({ project_id: project.id, user_id: user.id, member_duty: 'member', joined_on: joinedOn }), 'beforeInsert', async () => ({ systemPermissions: [] })), /没有项目团队维护权限/);
});

test('the raw ObjectQL registerHook envelope unwraps insert and update data without losing guard mutations', async () => {
  const engine = hookEngine();
  const insert = {
    ...mutationHook(null),
    input: { id: 'member-new', data: { project_id: project.id, user_id: user.id, member_duty: 'member', joined_on: joinedOn, name: 'spoof' }, options: {} },
  };
  await assertProjectMemberMutation(engine, insert, 'beforeInsert', projectOperator);
  assert.equal(insert.input.data.name, '张敏');
  assert.equal(insert.input.data.membership_key, 'project-1:member-1');
  assert.equal(insert.input.data.organization_id, org);

  const existing = { id: 'member-row', project_id: project.id, user_id: user.id, member_duty: 'member', joined_on: joinedOn, active: true, organization_id: org };
  const update = mutationHook(null, { previous: existing });
  update.input = { id: existing.id, data: { remarks: '更新备注' }, options: { multi: true, where: { id: existing.id } } };
  await assertProjectMemberMutation(engine, update, 'beforeUpdate', projectOperator);
  assert.equal(update.input.data.remarks, '更新备注');
});

test('the native before hook rejects inactive, cross-organization, expired and future target memberships', async () => {
  const candidate = { project_id: project.id, user_id: user.id, member_duty: 'member', joined_on: joinedOn };
  const noMembership = hookEngine({ membershipRow: null });
  await assert.rejects(() => assertProjectMemberMutation(noMembership, mutationHook({ ...candidate }), 'beforeInsert', projectOperator), /当前组织内有效账号/);
  const expired = hookEngine({ membershipRow: { user_id: user.id, organization_id: org, active: true, valid_until: '2026-10-02T00:00:00.000Z' } });
  await assert.rejects(() => assertProjectMemberMutation(expired, mutationHook({ ...candidate }), 'beforeInsert', projectOperator), /当前组织内有效账号/);
  const future = hookEngine({ membershipRow: { user_id: user.id, organization_id: org, active: true, valid_from: '2999-01-01T00:00:00.000Z' } });
  await assert.rejects(() => assertProjectMemberMutation(future, mutationHook({ ...candidate }), 'beforeInsert', projectOperator), /当前组织内有效账号/);
  const wrongOrg = hookEngine({ membershipRow: { user_id: user.id, organization_id: 'org-2', active: true } });
  await assert.rejects(() => assertProjectMemberMutation(wrongOrg, mutationHook({ ...candidate }), 'beforeInsert', projectOperator), /当前组织内有效账号/);
});

test('the native before hook keeps the manager immutable and blocks hard deletion', async () => {
  const manager = { id: 'manager-row', project_id: project.id, user_id: project.manager_id, membership_key: 'project-1:manager-1', member_duty: 'manager', joined_on: joinedOn, active: true, organization_id: org };
  const engine = hookEngine({ userRow: { id: project.manager_id, display_name: '项目经理', active: true }, membershipRow: { user_id: project.manager_id, organization_id: org, active: true } });
  await assert.rejects(() => assertProjectMemberMutation(engine, mutationHook({ id: manager.id, active: false }, { previous: manager }), 'beforeUpdate', projectOperator), /不能移除当前项目负责人/);
  await assert.rejects(() => assertProjectMemberMutation(engine, mutationHook({ id: manager.id }, { previous: manager }), 'beforeDelete', projectOperator), /不能删除/);
});
