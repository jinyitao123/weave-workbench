import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectManagerTransfer } from '../src/actions/project-manager-transfer.action.ts';

const organizationId = 'org-1';
const project = {
  id: 'project-1', name: '负责人交接项目', organization_id: organizationId,
  owner_id: 'owner-1', manager_id: 'manager-1', manager_name_snapshot: '旧负责人',
  updated_at: '2026-10-03T12:00:00.000Z',
};
const oldManager = {
  id: 'manager-row-1', project_id: project.id, organization_id: organizationId,
  user_id: project.manager_id, membership_key: project.id + ':' + project.manager_id,
  member_duty: 'manager', active: true,
};
const nextUser = { id: 'manager-2', display_name: '新负责人', active: true, banned: false };

function createHarness({ actor = 'manager-1', target = nextUser, rows = [oldManager], updatedAt = project.updated_at, expectedUpdatedAt = updatedAt } = {}) {
  const writes = [];
  let transactions = 0;
  const repository = object => ({
    async findOne(query = {}) {
      const where = query.where || {};
      if (object === 'forge_project') return Object.entries(where).every(([key, value]) => project[key] === value)
        ? { ...project, updated_at: updatedAt } : null;
      if (object === 'sys_user') return target && Object.entries(where).every(([key, value]) => target[key] === value) ? target : null;
      return null;
    },
    async find(query = {}) {
      const where = query.where || {};
      if (object !== 'forge_project_member') return [];
      return rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
    },
    async update(data, options) { writes.push({ object, data, options }); return 1; },
  });
  const api = {
    object: repository,
    async transaction(callback) { transactions++; return callback(api); },
  };
  const context = {
    record: project,
    recordId: project.id,
    session: { userId: actor, organizationId },
    user: { id: actor, organizationId },
    input: { manager_id: target?.id || nextUser.id, updated_at: expectedUpdatedAt },
    api,
  };
  return {
    run: () => new Function('ctx', `return (async()=>{${ProjectManagerTransfer.body.source}})()`)(context),
    writes,
    get transactions() { return transactions; },
  };
}

test('manager handoff action uses an organization-scoped active appointment and exact read-version CAS', async () => {
  const harness = createHarness();
  const result = await harness.run();
  assert.deepEqual(result, { id: project.id, status: 'transferred', manager_name: '新负责人' });
  assert.equal(harness.transactions, 1);
  assert.equal(harness.writes.length, 1);
  assert.deepEqual(harness.writes[0].data, { manager_transfer_target_id: nextUser.id });
  assert.equal(harness.writes[0].options.multi, true);
  assert.deepEqual(harness.writes[0].options.where, {
    id: project.id,
    organization_id: organizationId,
    manager_id: project.manager_id,
    updated_at: { $gte: project.updated_at, $lt: '2026-10-03T12:00:00.001Z' },
  });
});

test('stale project version, unrelated actor and inactive account refuse before write', async () => {
  const stale = createHarness({ expectedUpdatedAt: '2026-10-03T11:59:59.999Z' });
  await assert.rejects(stale.run(), /项目资料已变化/);
  assert.equal(stale.writes.length, 0);

  const unrelated = createHarness({ actor: 'member-1' });
  await assert.rejects(unrelated.run(), /仅项目所有者或当前项目经理/);
  assert.equal(unrelated.writes.length, 0);

  const inactive = createHarness({ target: { ...nextUser, active: false } });
  await assert.rejects(inactive.run(), /当前组织内有效账号/);
  assert.equal(inactive.writes.length, 0);
});

test('owner and already-current manager results do not write a second or duplicate manager relation', async () => {
  const owner = createHarness({ actor: 'owner-1' });
  await owner.run();
  assert.equal(owner.writes.length, 1);

  const same = createHarness({ target: { ...nextUser, id: project.manager_id, display_name: '旧负责人' } });
  const result = await same.run();
  assert.equal(result.status, 'unchanged');
  assert.equal(same.writes.length, 0);
});
