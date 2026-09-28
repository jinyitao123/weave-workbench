import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectAttachmentAssignmentGuard, ProjectLogAssignmentGuard } from '../src/hooks/project-evidence.hook.ts';
import { ProjectMemberSharingPlugin } from '../src/plugins/project-member-sharing.plugin.ts';

function fakeRuntime({ members = [], attachments = [], logs = [], shares = [] } = {}) {
  const registrations = [];
  const findCalls = [];
  const grantCalls = [];
  const revokeCalls = [];
  const lifecycleHooks = [];
  const shareRows = new Map(shares.map(row => [`${row.object_name}:${row.record_id}`, row.rows]));
  const datasets = {
    forge_project_member: members,
    forge_project_attachment: attachments,
    forge_project_log: logs,
  };
  const engine = {
    registerHook(event, handler, options) { registrations.push({ event, handler, options }); },
    findOne: async (object, query, options) => {
      findCalls.push({ kind: 'findOne', object, query, context: options?.context });
      if (object === 'forge_project' && query?.where?.id === 'project-a') {
        return { id: 'project-a', organization_id: 'org-a' };
      }
      if (object === 'forge_project_member') {
        return (datasets.forge_project_member || []).find(row => row.id === query?.where?.id) || null;
      }
      return null;
    },
    find: async (object, query, options) => {
      findCalls.push({ kind: 'find', object, query, context: options?.context });
      const rows = datasets[object] || [];
      return rows.filter(row => Object.entries(query?.where || {}).every(([key, value]) => row[key] === value));
    },
  };
  const sharing = {
    grant: async (input, context) => {
      grantCalls.push({ input, context });
      return { id: `share-${grantCalls.length}`, ...input, source_id: input.sourceId };
    },
    listShares: async (object, recordId, context) => {
      findCalls.push({ kind: 'listShares', object, recordId, context });
      return shareRows.get(`${object}:${recordId}`) || [];
    },
    revoke: async (shareId, context, scope) => { revokeCalls.push({ shareId, context, scope }); },
  };
  const context = { hook: (event, handler) => { lifecycleHooks.push({ event, handler }); }, getService: name => {
    if (name === 'objectql') return engine;
    if (name === 'sharing') return sharing;
    throw new Error(`Unexpected service ${name}`);
  } };
  return { context, registrations, findCalls, grantCalls, revokeCalls,
    ready: async () => {
      for (const hook of lifecycleHooks) {
        assert.equal(hook.event, 'kernel:ready');
        await hook.handler();
      }
    },
  };
}

function registered(runtime, event, object) {
  const item = runtime.registrations.find(entry => entry.event === event && entry.options.object === object);
  assert.ok(item, `${event} hook is registered for ${object}`);
  return item.handler;
}

function operationContext(overrides = {}) {
  return {
    id: 'trace-a',
    object: 'forge_project_member',
    event: 'afterInsert',
    session: { userId: 'project-admin-a', organizationId: 'org-a' },
    user: { id: 'project-admin-a', organizationId: 'org-a' },
    transaction: { id: 'tx-a' },
    input: {},
    ...overrides,
  };
}

test('plugin binds membership lifecycle and evidence insert hooks after the native sharing service is ready', async () => {
  const runtime = fakeRuntime();
  new ProjectMemberSharingPlugin().start(runtime.context);
  assert.equal(runtime.registrations.length, 0);
  await runtime.ready();
  assert.deepEqual(runtime.registrations.map(({ event, options }) => [event, options.object]), [
    ['afterInsert', 'forge_project_member'],
    ['afterUpdate', 'forge_project_member'],
    ['afterDelete', 'forge_project_member'],
    ['afterInsert', 'forge_project_attachment'],
    ['afterInsert', 'forge_project_log'],
  ]);
  assert.ok(runtime.registrations.every(item => item.options.packageId === 'com.inoforge.forge.project-member-sharing'));
});

test('adding an active member shares the project and existing evidence with a tenant-preserving system context', async () => {
  const runtime = fakeRuntime({
    members: [{ id: 'member-row-a', project_id: 'project-a', user_id: 'member-a', active: true, organization_id: 'org-a' }],
    attachments: [{ id: 'attachment-a', project_id: 'project-a', organization_id: 'org-a' }],
    logs: [{ id: 'log-a', project_id: 'project-a', organization_id: 'org-a' }],
  });
  new ProjectMemberSharingPlugin().start(runtime.context);
  await runtime.ready();
  const member = { id: 'member-row-a', project_id: 'project-a', user_id: 'member-a', active: true, organization_id: 'org-a' };
  const insertResultWithoutDefault = { ...member };
  delete insertResultWithoutDefault.active;
  await registered(runtime, 'afterInsert', 'forge_project_member')(operationContext({ result: insertResultWithoutDefault }));

  assert.deepEqual(runtime.grantCalls.map(({ input }) => [input.object, input.recordId, input.recipientId]), [
    ['forge_project', 'project-a', 'member-a'],
    ['forge_project_attachment', 'attachment-a', 'member-a'],
    ['forge_project_log', 'log-a', 'member-a'],
  ]);
  for (const { input, context } of runtime.grantCalls) {
    assert.equal(input.accessLevel, 'read');
    assert.equal(input.source, 'team');
    assert.equal(input.sourceId, member.id);
    assert.equal(context.isSystem, true);
    assert.equal(context.userId, 'project-admin-a');
    assert.equal(context.tenantId, 'org-a');
    assert.equal(context.transaction.id, 'tx-a');
  }
});

test('evidence inserted later is shared with active members only', async () => {
  const runtime = fakeRuntime({
    members: [
      { id: 'member-row-a', project_id: 'project-a', user_id: 'member-a', active: true, organization_id: 'org-a' },
      { id: 'member-row-b', project_id: 'project-a', user_id: 'member-b', active: false, organization_id: 'org-a' },
    ],
  });
  new ProjectMemberSharingPlugin().start(runtime.context);
  await runtime.ready();
  await registered(runtime, 'afterInsert', 'forge_project_attachment')(operationContext({
    object: 'forge_project_attachment',
    event: 'afterInsert',
    result: { id: 'attachment-new', project_id: 'project-a', organization_id: 'org-a' },
  }));

  assert.deepEqual(runtime.grantCalls.map(({ input }) => [input.object, input.recordId, input.recipientId, input.sourceId]), [
    ['forge_project_attachment', 'attachment-new', 'member-a', 'member-row-a'],
    ['forge_project', 'project-a', 'member-a', 'member-row-a'],
  ]);
});

test('deactivating a member revokes only that membership relation shares', async () => {
  const member = { id: 'member-row-a', project_id: 'project-a', user_id: 'member-a', active: true, organization_id: 'org-a' };
  const runtime = fakeRuntime({
    members: [{ ...member, active: false }],
    attachments: [{ id: 'attachment-a', project_id: 'project-a', organization_id: 'org-a' }],
    logs: [{ id: 'log-a', project_id: 'project-a', organization_id: 'org-a' }],
    shares: [
      { object_name: 'forge_project', record_id: 'project-a', rows: [
        { id: 'team-project', source: 'team', source_id: member.id, recipient_id: member.user_id },
        { id: 'manual-project', source: 'manual', source_id: 'admin-a', recipient_id: member.user_id },
        { id: 'other-member-project', source: 'team', source_id: 'member-row-b', recipient_id: 'member-b' },
      ] },
      { object_name: 'forge_project_attachment', record_id: 'attachment-a', rows: [
        { id: 'team-attachment', source: 'team', source_id: member.id, recipient_id: member.user_id },
      ] },
      { object_name: 'forge_project_log', record_id: 'log-a', rows: [
        { id: 'team-log', source: 'team', source_id: member.id, recipient_id: member.user_id },
      ] },
    ],
  });
  new ProjectMemberSharingPlugin().start(runtime.context);
  await runtime.ready();
  await registered(runtime, 'afterUpdate', 'forge_project_member')(operationContext({
    event: 'afterUpdate',
    previous: member,
    result: { ...member, active: false },
  }));

  assert.deepEqual(runtime.revokeCalls.map(({ shareId }) => shareId), [
    'team-project', 'team-attachment', 'team-log',
  ]);
  assert.equal(runtime.grantCalls.length, 0);
  assert.ok(runtime.revokeCalls.every(({ context, scope }) => context.isSystem && context.userId === 'project-admin-a'
    && context.tenantId === 'org-a' && scope.object));
});

test('evidence assignment guards elevate only their scoped read API and keep caller checks', () => {
  for (const hook of [ProjectAttachmentAssignmentGuard, ProjectLogAssignmentGuard]) {
    assert.equal(hook.runAs, 'system');
    assert.match(hook.body.source, /ctx\.session&&ctx\.session\.userId/);
    assert.match(hook.body.source, /ctx\.session&&ctx\.session\.organizationId/);
    assert.match(hook.body.source, /row\.active===true/);
    assert.match(hook.body.source, /organization_id/);
  }
});
