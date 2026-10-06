import assert from 'node:assert/strict';
import test from 'node:test';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { createProjectMembershipRlsResolver, PROJECT_RLS_MEMBERSHIP_KEY, CONTRACT_REVIEW_RLS_KEY, PROJECT_MANAGER_RLS_KEY, PROJECT_POSITION_RLS_POLICY_PREFIX, projectPositionReadScopeKey, projectPositionCreateScopeKey, projectPositionEditScopeKey, projectPositionDeleteScopeKey, ProjectRlsMembershipPlugin } from '../src/plugins/project-rls-membership.plugin.ts';
import { projectManagerPermission, projectOperatorPermission } from '../src/permissions/project-operator.permission.ts';
import { solutionOperatorPermission, projectGateReviewerPermission, procurementOperatorPermission, financeReceivablesOperatorPermission, financeReviewerPermission, warehouseOperatorPermission, serviceManagerPermission } from '../src/permissions/otc-role.permission.ts';

function membershipRow({ id, userId = 'actor-a', projectId, organizationId = 'org-a', active = true }) {
  return { id, user_id: userId, project_id: projectId, organization_id: organizationId, active };
}

function rowMatches(row, where = {}) {
  if (!where || typeof where !== 'object') return true;
  if (Array.isArray(where.$and) && !where.$and.every(part => rowMatches(row, part))) return false;
  if (Array.isArray(where.$or) && !where.$or.some(part => rowMatches(row, part))) return false;
  return Object.entries(where).every(([key, value]) => {
    if (key === '$and' || key === '$or') return true;
    const actual = row[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('$in' in value && !value.$in.includes(actual)) return false;
      if ('$eq' in value && actual !== value.$eq) return false;
      if ('$ne' in value && actual === value.$ne) return false;
      if ('$gte' in value && !(String(actual) >= String(value.$gte))) return false;
      if ('$lt' in value && !(String(actual) < String(value.$lt))) return false;
      return true;
    }
    return actual === value;
  });
}

function fakeEngine(rows, projects = [], extraRows = {}) {
  const calls = [];
  return {
    calls,
    engine: {
      getSchema(object) {
        const candidates = extraRows[object] || (object === 'forge_project' ? projects : object === 'forge_project_member' ? rows : []);
        const sample = candidates[0];
        return sample ? { name: object, fields: Object.fromEntries(Object.keys(sample).map(field => [field, { hidden: false }])) } : undefined;
      },
      async find(object, query, options) {
        calls.push({ object, query, context: options?.context });
        const candidates = extraRows[object] || (object === 'forge_project' ? projects : object === 'forge_project_member' ? rows : []);
        const matches = candidates.filter(row => rowMatches(row, query.where || {}));
        return matches.slice(query.offset || 0, (query.offset || 0) + query.limit);
      },
    },
  };
}

test('project RLS membership is declared only on Project SELECT and never widens writes', () => {
  const policies = projectOperatorPermission.rowLevelSecurity.filter(policy => policy.object === 'forge_project');
  const select = policies.find(policy => policy.operation === 'select');
  assert.ok(select);
  assert.match(select.using, /id in current_user\.active_project_ids/);

  const writePolicies = policies.filter(policy => policy.operation !== 'select');
  assert.deepEqual(new Set(writePolicies.map(policy => policy.operation)), new Set(['insert', 'update', 'delete']));
  for (const policy of writePolicies) {
    assert.doesNotMatch(policy.using || '', /active_project_ids/);
    assert.doesNotMatch(policy.check || '', /active_project_ids/);
  }
  const managerReadObjects = ['forge_project_member', 'forge_project_cost_entry', 'forge_project_daily_report', 'forge_project_settlement', 'forge_project_plan', 'forge_project_work_item', 'forge_project_timesheet', 'forge_project_expense', 'forge_project_expense_line', 'forge_project_attachment', 'sys_file', 'forge_project_plan_template', 'sys_import_job'];
  const sourceObjects=['forge_customer','forge_sales_contract','forge_sales_contract_line','forge_sales_order','forge_sales_order_line','forge_quotation','forge_quotation_line'];
  assert.deepEqual(Object.keys(projectManagerPermission.objects), [...sourceObjects,...managerReadObjects]);
  for (const object of sourceObjects) {assert.equal(projectManagerPermission.objects[object].allowRead,true);assert.equal(projectManagerPermission.objects[object].readScope,'own');for(const key of ['allowCreate','allowEdit','allowDelete','allowTransfer','viewAllRecords','modifyAllRecords'])assert.equal(Boolean(projectManagerPermission.objects[object][key]),false);assert.ok(!(projectManagerPermission.rowLevelSecurity||[]).some(rule=>rule.object===object),'native own/shared source read has no erroneous project-position AND');}
  for (const objectName of managerReadObjects) {
    const grant = projectManagerPermission.objects[objectName];
    assert.equal(grant.allowRead, true);
    assert.equal(Boolean(grant.allowEdit || grant.allowDelete), false);
    assert.equal(Boolean(grant.allowCreate), objectName === 'forge_project_work_item', 'only guarded native task import can create manager records');
    if (['forge_project_member', 'forge_project_cost_entry', 'forge_project_daily_report', 'forge_project_settlement', 'forge_project_plan', 'forge_project_work_item', 'forge_project_timesheet', 'forge_project_expense'].includes(objectName)) {
      const policy = projectManagerPermission.rowLevelSecurity.find(item => item.object === objectName && item.operation === 'select');
      assert.equal(policy?.using, 'project_id in current_user.managed_project_ids');
    }
  }
  assert.equal(projectManagerPermission.objects.sys_file.readScope, 'own');
  assert.equal(projectManagerPermission.objects.sys_import_job.readScope, 'own');
  const roleScopePolicies = set => (set.rowLevelSecurity || []).filter(policy => policy.name?.startsWith(PROJECT_POSITION_RLS_POLICY_PREFIX));
  assert.ok(roleScopePolicies(projectManagerPermission).some(policy => policy.object === 'forge_project_cost_entry' && policy.operation === 'select' && policy.using === `id in current_user.${projectPositionReadScopeKey('forge_project_cost_entry')}`));
  assert.ok(roleScopePolicies(projectManagerPermission).some(policy => policy.object === 'forge_project_work_item'));
  const attachmentPositionScope = `id in current_user.${projectPositionReadScopeKey('forge_project_attachment')}`;
  assert.equal(roleScopePolicies(projectManagerPermission).find(policy => policy.object === 'forge_project_attachment')?.using, `${attachmentPositionScope} || project_id in current_user.managed_project_ids`);
  assert.equal(roleScopePolicies(solutionOperatorPermission).find(policy => policy.object === 'forge_project_attachment')?.using, attachmentPositionScope, 'worker scope never gains the manager fallback');
  assert.equal(Boolean(solutionOperatorPermission.objects.forge_project_attachment.allowCreate), false, 'attachment audit fields are written only by the controlled action');
  assert.ok(!roleScopePolicies(projectManagerPermission).some(policy => policy.object === 'forge_project_expense_line'), 'expense lines inherit the native expense master-detail scope');
  assert.ok(roleScopePolicies(projectOperatorPermission).some(policy => policy.object === 'forge_project_member'));
  assert.ok(roleScopePolicies(solutionOperatorPermission).some(policy => policy.object === 'forge_project_work_item'));
  assert.ok(roleScopePolicies(projectGateReviewerPermission).some(policy => policy.object === 'forge_project_plan'));
  assert.deepEqual(roleScopePolicies(procurementOperatorPermission), [], 'procurement stays organization-scoped outside project-specific work');
  for (const permissionSet of [financeReceivablesOperatorPermission, financeReviewerPermission, warehouseOperatorPermission, serviceManagerPermission]) {
    assert.deepEqual(roleScopePolicies(permissionSet), [], `${permissionSet.name} retains its non-project organization duties`);
  }
  assert.equal(financeReceivablesOperatorPermission.objects.forge_project_settlement.readScope, 'org');
});

test('resolver returns only the current user active projects within core accessible organizations', async () => {
  const { engine, calls } = fakeEngine([
    membershipRow({ id: 'member-a1', projectId: 'project-a', organizationId: 'org-a' }),
    membershipRow({ id: 'member-a2', projectId: 'project-a', organizationId: 'org-a' }),
    membershipRow({ id: 'member-b1', projectId: 'project-b', organizationId: 'org-b' }),
    membershipRow({ id: 'inactive', projectId: 'project-inactive', organizationId: 'org-a', active: false }),
    membershipRow({ id: 'other-user', projectId: 'project-other-user', organizationId: 'org-a', userId: 'actor-b' }),
    membershipRow({ id: 'outside-org', projectId: 'project-outside', organizationId: 'org-c' }),
    membershipRow({ id: 'missing-project', projectId: '   ', organizationId: 'org-a' }),
  ]);
  const resolver = createProjectMembershipRlsResolver(() => engine);

  const result = await resolver.resolve({ userId: 'actor-a', tenantId: 'org-a', accessible_org_ids: ['org-a', 'org-b', 'org-a'] });

  assert.equal(resolver.keys[0], PROJECT_RLS_MEMBERSHIP_KEY);
  assert.equal(resolver.keys[1], PROJECT_MANAGER_RLS_KEY);
  assert.ok(resolver.keys.includes(projectPositionReadScopeKey('forge_project_cost_entry')));
  assert.ok(resolver.keys.includes(projectPositionCreateScopeKey('forge_project_work_item')));
  assert.deepEqual(result.active_project_ids.sort(), ['project-a', 'project-b']);
  assert.deepEqual(calls.filter(call => call.object === 'forge_project_member').map(call => call.query.where), [
    { user_id: 'actor-a', active: true, organization_id: 'org-a' },
    { user_id: 'actor-a', active: true, organization_id: 'org-b' },
  ]);
  for (const call of calls.filter(call => call.object === 'forge_project_member')) {
    assert.equal(call.object, 'forge_project_member');
    assert.equal(call.context.isSystem, true);
    assert.equal(call.context.userId, 'actor-a');
    assert.equal(call.context.tenantId, call.query.where.organization_id);
    assert.deepEqual(call.query.orderBy, [{ field: 'id', order: 'asc' }]);
  }
});

test('resolver fails closed without identity or a tenant scope and does not query membership rows', async () => {
  let engineCalls = 0;
  const resolver = createProjectMembershipRlsResolver(() => ({ find: async () => { engineCalls++; return []; } }));

  const noIdentity = await resolver.resolve({ tenantId: 'org-a' });
  const noOrganization = await resolver.resolve({ userId: 'actor-a', accessible_org_ids: [] });
  assert.deepEqual(noIdentity.active_project_ids, []);
  assert.deepEqual(noOrganization.active_project_ids, []);
  assert.deepEqual(noIdentity[projectPositionReadScopeKey('forge_project_cost_entry')], []);
  assert.deepEqual(noOrganization[projectPositionCreateScopeKey('forge_project_work_item')], []);
  assert.equal(engineCalls, 0);
});

test('resolver reads all membership pages and deduplicates project ids', async () => {
  const rows = Array.from({ length: 205 }, (_, index) => membershipRow({
    id: `member-${String(index).padStart(3, '0')}`,
    projectId: `project-${index}`,
  }));
  const { engine, calls } = fakeEngine(rows);
  const resolver = createProjectMembershipRlsResolver(() => engine);

  const result = await resolver.resolve({ userId: 'actor-a', tenantId: 'org-a' });

  assert.equal(result.active_project_ids.length, 205);
  assert.equal(new Set(result.active_project_ids).size, 205);
  assert.deepEqual(calls.filter(call => call.object === 'forge_project_member').map(call => call.query.offset), [0, 200]);
});

test('resolver query failures propagate so SecurityPlugin leaves the membership key unresolved', async () => {
  const resolver = createProjectMembershipRlsResolver(() => ({
    find: async () => { throw new Error('membership store unavailable'); },
  }));
  await assert.rejects(
    resolver.resolve({ userId: 'actor-a', tenantId: 'org-a' }),
    /membership store unavailable/,
  );
});

test('manager cost scope follows the formal manager and admitted organization, not active membership', async () => {
  const { engine, calls } = fakeEngine(
    [membershipRow({ id: 'member-only', projectId: 'project-other-manager' })],
    [
      { id: 'project-owned', manager_id: 'actor-a', organization_id: 'org-a' },
      { id: 'project-other-manager', manager_id: 'actor-b', organization_id: 'org-a' },
      { id: 'project-outside', manager_id: 'actor-a', organization_id: 'org-b' },
    ],
  );
  const resolver = createProjectMembershipRlsResolver(() => engine);
  const result = await resolver.resolve({ userId: 'actor-a', tenantId: 'org-a', permissions: ['forge_project_manager'] });
  assert.deepEqual(result.active_project_ids, ['project-other-manager']);
  assert.deepEqual(result.managed_project_ids, ['project-owned']);
  const managedReads = calls.filter(call => call.object === 'forge_project');
  assert.equal(managedReads.length, 1);
  assert.deepEqual(managedReads[0].query.where, { manager_id: 'actor-a', organization_id: 'org-a' });
  assert.equal(managedReads[0].context.tenantId, 'org-a');

  const ordinary = await resolver.resolve({ userId: 'actor-a', tenantId: 'org-a', permissions: ['forge_project_operator'] });
  assert.equal(ordinary.managed_project_ids, undefined, 'a general member has no cost-read scope');
});

test('manager scope reads every page and leaves failed scope unresolved without losing member scope', async () => {
  const projects = Array.from({ length: 205 }, (_, index) => ({ id: 'managed-' + index, manager_id: 'actor-a', organization_id: 'org-a' }));
  const { engine, calls } = fakeEngine([membershipRow({ id: 'member', projectId: 'member-project' })], projects);
  const resolver = createProjectMembershipRlsResolver(() => engine);
  const context = { userId: 'actor-a', tenantId: 'org-a', permissions: ['forge_project_manager'] };
  assert.equal((await resolver.resolve(context)).managed_project_ids.length, 205);
  assert.deepEqual(calls.filter(call => call.object === 'forge_project').map(call => call.query.offset), [0, 200]);
  const failed = createProjectMembershipRlsResolver(() => ({
    ...engine,
    async find(object, query, options) {
      if (object === 'forge_project') throw new Error('manager scope unavailable');
      return engine.find(object, query, options);
    },
  }));
  const result = await failed.resolve(context);
  assert.deepEqual(result.active_project_ids, ['member-project']);
  assert.equal(result.managed_project_ids, undefined);
});

test('plugin registers the native resolver service during init for SecurityPlugin.start()', () => {
  const registrations = [];
  const context = {
    registerService(name, service) { registrations.push({ name, service }); },
    getService() { throw new Error('objectql should be resolved lazily'); },
  };
  const plugin = new ProjectRlsMembershipPlugin();

  plugin.init(context);

  assert.ok(plugin.providesServices.includes('rls-membership-resolver'));
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, 'rls-membership-resolver');
  assert.equal(registrations[0].service.keys[0], PROJECT_RLS_MEMBERSHIP_KEY);
  assert.equal(registrations[0].service.keys[1], PROJECT_MANAGER_RLS_KEY);
  assert.ok(registrations[0].service.keys.includes(projectPositionReadScopeKey('forge_project_cost_entry')));
});

test('native position PermissionSets yield per-object project scopes and cannot leak a manager into another project cost', async () => {
  const members = [
    membershipRow({ id: 'member-a', userId: 'manager-a', projectId: 'project-a' }),
    membershipRow({ id: 'manager-tech-member-b', userId: 'manager-a', projectId: 'project-b' }),
    membershipRow({ id: 'member-b', userId: 'tech-b', projectId: 'project-b' }),
  ];
  const appointment = (userId, position) => ({ user_id: userId, position, organization_id: 'org-a', active: true });
  const assignment = (id, memberId, projectId, positionId) => ({
    id, member_id: memberId, project_id: projectId, position_id: positionId, organization_id: 'org-a', active: true,
  });
  const { engine } = fakeEngine(members, [
    { id: 'project-a', manager_id: 'manager-a', organization_id: 'org-a' },
    { id: 'project-b', manager_id: 'manager-b', organization_id: 'org-a' },
  ], {
    forge_project_member_position_assignment: [
      assignment('assignment-a', 'member-a', 'project-a', 'position-manager'),
      assignment('assignment-manager-tech-b', 'manager-tech-member-b', 'project-b', 'position-tech'),
      assignment('assignment-b', 'member-b', 'project-b', 'position-tech'),
    ],
    sys_user_position: [appointment('manager-a', 'project_manager'), appointment('manager-a', 'hardware_engineer'), appointment('tech-b', 'hardware_engineer')],
    sys_position: [
      { id: 'position-manager', name: 'project_manager', active: true },
      { id: 'position-tech', name: 'hardware_engineer', active: true },
    ],
    sys_position_permission_set: [
      { id: 'binding-manager', position_id: 'position-manager', permission_set_id: 'set-manager' },
      { id: 'binding-tech', position_id: 'position-tech', permission_set_id: 'set-tech' },
    ],
    sys_permission_set: [
      { id: 'set-manager', name: 'forge_project_manager', active: true, object_permissions: { forge_project_cost_entry: { allowRead: true }, forge_project_work_item: { allowRead: true } }, row_level_security: JSON.stringify([{ name: 'manager-cost-owner-scope', object: 'forge_project_cost_entry', operation: 'select', using: 'project_id in current_user.managed_project_ids' }]) },
      { id: 'set-tech', name: 'hardware_engineer', active: true, object_permissions: { forge_project_work_item: { allowRead: true }, forge_project_cost_entry: { allowRead: false }, forge_bom_node: { allowRead: true } } },
    ],
    forge_project_cost_entry: [
      { id: 'cost-a', project_id: 'project-a', organization_id: 'org-a' },
      { id: 'cost-b', project_id: 'project-b', organization_id: 'org-a' },
    ],
    forge_project_work_item: [{ id: 'task-b', project_id: 'project-b', organization_id: 'org-a' }],
    forge_bom: [
      { id: 'bom-a', project_id: 'project-a', organization_id: 'org-a' },
      { id: 'bom-b', project_id: 'project-b', organization_id: 'org-a' },
    ],
    forge_bom_node: [
      { id: 'node-a', bom_id: 'bom-a', organization_id: 'org-a' },
      { id: 'node-b', bom_id: 'bom-b', organization_id: 'org-a' },
    ],
  });
  const resolver = createProjectMembershipRlsResolver(() => engine);
  const manager = await resolver.resolve({ userId: 'manager-a', tenantId: 'org-a', positions: ['project_manager', 'hardware_engineer'], permissions: ['forge_project_manager'] });
  const tech = await resolver.resolve({ userId: 'tech-b', tenantId: 'org-a', permissions: ['forge_project_operator'] });

  assert.deepEqual(manager.active_project_ids.sort(), ['project-a', 'project-b']);
  assert.deepEqual(manager.managed_project_ids, ['project-a']);
  assert.deepEqual(manager[projectPositionReadScopeKey('forge_project_cost_entry')], ['cost-a']);
  assert.deepEqual(tech[projectPositionReadScopeKey('forge_project_work_item')], ['task-b']);
  assert.deepEqual(tech[projectPositionReadScopeKey('forge_bom_node')], ['node-b'], 'child records follow the declared native BOM parent relationship');
  assert.deepEqual(tech[projectPositionReadScopeKey('forge_project_cost_entry')], []);
  assert.deepEqual(tech[projectPositionCreateScopeKey('forge_project_cost_entry')], []);
});

test('SecurityPlugin applies the manager native RLS together with project-position record IDs', async () => {
  const members = [
    membershipRow({ id: 'member-a', userId: 'manager-a', projectId: 'project-a' }),
    membershipRow({ id: 'manager-tech-member-b', userId: 'manager-a', projectId: 'project-b' }),
  ];
  const appointment = (id, userId, position) => ({ id, user_id: userId, position, organization_id: 'org-a', active: true });
  const assignment = (id, memberId, projectId, positionId) => ({ id, member_id: memberId, project_id: projectId, position_id: positionId, organization_id: 'org-a', active: true });
  const { engine } = fakeEngine(members, [
    { id: 'project-a', manager_id: 'manager-a', organization_id: 'org-a' },
    { id: 'project-b', manager_id: 'manager-b', organization_id: 'org-a' },
  ], {
    forge_project_member_position_assignment: [
      assignment('assignment-manager-a', 'member-a', 'project-a', 'position-manager'),
      assignment('assignment-technician-b', 'manager-tech-member-b', 'project-b', 'position-tech'),
    ],
    sys_user_position: [appointment('grant-manager', 'manager-a', 'project_manager'), appointment('grant-tech', 'manager-a', 'hardware_engineer')],
    sys_position: [
      { id: 'position-manager', name: 'project_manager', active: true },
      { id: 'position-tech', name: 'hardware_engineer', active: true },
    ],
    sys_position_permission_set: [
      { id: 'binding-manager', position_id: 'position-manager', permission_set_id: 'set-manager' },
      { id: 'binding-tech', position_id: 'position-tech', permission_set_id: 'set-tech' },
    ],
    sys_permission_set: [
      { id: 'set-manager', name: 'forge_project_manager', label: '项目经理执行办理', active: true,
        object_permissions: JSON.stringify({ forge_project_cost_entry: { allowRead: true }, forge_project_work_item: { allowRead: true } }),
        field_permissions: '{}', system_permissions: '["forge_project_manager"]',
        row_level_security: JSON.stringify([{ name: 'assigned_project_manager_cost_read', object: 'forge_project_cost_entry', operation: 'select', using: 'project_id in current_user.managed_project_ids' }]) },
      { id: 'set-tech', name: 'hardware_engineer', label: '硬件工程师', active: true,
        object_permissions: JSON.stringify({ forge_project_work_item: { allowRead: true }, forge_project_cost_entry: { allowRead: false } }),
        field_permissions: '{}', system_permissions: '[]', row_level_security: '[]' },
    ],
    forge_project_cost_entry: [
      { id: 'cost-a', project_id: 'project-a', organization_id: 'org-a', name: 'A项目成本' },
      { id: 'cost-b', project_id: 'project-b', organization_id: 'org-a', name: 'B项目成本' },
    ],
    forge_project_work_item: [
      { id: 'task-a', project_id: 'project-a', organization_id: 'org-a', name: 'A项目任务' },
      { id: 'task-b', project_id: 'project-b', organization_id: 'org-a', name: 'B项目任务' },
    ],
  });
  const schemas = [
    { name: 'forge_project', access: { default: 'private' }, sharingModel: 'private', fields: { id: { type: 'text' }, owner_id: { type: 'text' }, created_by: { type: 'text' }, manager_id: { type: 'text' }, organization_id: { type: 'text' } } },
    { name: 'forge_project_cost_entry', access: { default: 'private' }, sharingModel: 'private', fields: { id: { type: 'text' }, project_id: { type: 'text' }, organization_id: { type: 'text' }, name: { type: 'text' } } },
    { name: 'forge_project_work_item', access: { default: 'private' }, sharingModel: 'private', fields: { id: { type: 'text' }, project_id: { type: 'text' }, organization_id: { type: 'text' }, name: { type: 'text' } } },
  ];
  const ql = {
    ...engine,
    registerMiddleware() {}, registerWriteGateProbe() {}, registerEffectiveObjectPermissionsResolver() {}, setTenancyPostureProvider() {},
    getSchema(name) { return schemas.find(schema => schema.name === name); },
    registry: { getAllObjects: () => schemas },
  };
  const services = new Map([
    ['manifest', { register() {} }],
    ['metadata', { list: () => [], get: async name => schemas.find(schema => schema.name === name), watch: () => () => {} }],
    ['objectql', ql], ['tenancy', { posture: 'single' }],
  ]);
  const context = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    registerService(name, service) { services.set(name, service); },
    getService(name) { if (!services.has(name)) throw new Error(`Service ${name} is not registered`); return services.get(name); },
    hook() {},
  };
  const security = new SecurityPlugin({ defaultPermissionSets: [projectOperatorPermission, projectManagerPermission], fallbackPermissionSet: null });
  await security.init(context);
  new ProjectRlsMembershipPlugin().init(context);
  await security.start(context);

  const filter = await security.getReadFilter('forge_project_cost_entry', {
    userId: 'manager-a', tenantId: 'org-a', positions: ['project_manager', 'hardware_engineer'],
    permissions: ['forge_project_manager'],
  });
  const serialized = JSON.stringify(filter);
  assert.match(serialized, /cost-a|project-a/);
  assert.doesNotMatch(serialized, /cost-b|project-b/);
});

test('native manager RLS keeps direct managed-project access without a project position assignment', async () => {
  const { engine } = fakeEngine([], [
    { id: 'project-a', manager_id: 'manager-a', organization_id: 'org-a' },
    { id: 'project-b', manager_id: 'manager-b', organization_id: 'org-a' },
  ], {
    forge_project_cost_entry: [
      { id: 'cost-a', project_id: 'project-a', organization_id: 'org-a', name: 'A项目成本' },
      { id: 'cost-b', project_id: 'project-b', organization_id: 'org-a', name: 'B项目成本' },
    ],
  });
  const schemas = [
    { name: 'forge_project', access: { default: 'private' }, sharingModel: 'private', fields: { id: { type: 'text' }, owner_id: { type: 'text' }, created_by: { type: 'text' }, manager_id: { type: 'text' }, organization_id: { type: 'text' } } },
    { name: 'forge_project_cost_entry', access: { default: 'private' }, sharingModel: 'private', fields: { id: { type: 'text' }, project_id: { type: 'text' }, organization_id: { type: 'text' }, name: { type: 'text' } } },
  ];
  const ql = {
    ...engine,
    registerMiddleware() {}, registerWriteGateProbe() {}, registerEffectiveObjectPermissionsResolver() {}, setTenancyPostureProvider() {},
    getSchema(name) { return schemas.find(schema => schema.name === name); },
    registry: { getAllObjects: () => schemas },
  };
  const services = new Map([
    ['manifest', { register() {} }],
    ['metadata', { list: () => [], get: async name => schemas.find(schema => schema.name === name), watch: () => () => {} }],
    ['objectql', ql], ['tenancy', { posture: 'single' }],
  ]);
  const context = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    registerService(name, service) { services.set(name, service); },
    getService(name) { if (!services.has(name)) throw new Error(`Service ${name} is not registered`); return services.get(name); },
    hook() {},
  };
  const security = new SecurityPlugin({ defaultPermissionSets: [projectManagerPermission], fallbackPermissionSet: null });
  await security.init(context);
  new ProjectRlsMembershipPlugin().init(context);
  await security.start(context);

  const filter = await security.getReadFilter('forge_project_cost_entry', {
    userId: 'manager-a', tenantId: 'org-a', positions: ['project_manager'], permissions: ['forge_project_manager'],
  });
  assert.equal(rowMatches({ id: 'cost-a', project_id: 'project-a', organization_id: 'org-a' }, filter), true);
  assert.equal(rowMatches({ id: 'cost-b', project_id: 'project-b', organization_id: 'org-a' }, filter), false);
});

test('organization-wide finance settlement access is unchanged by project position scopes', async () => {
  const { engine } = fakeEngine([], [], {
    forge_project_settlement: [
      { id: 'settlement-a', project_id: 'project-a', organization_id: 'org-a', name: 'A项目结算' },
      { id: 'settlement-b', project_id: 'project-b', organization_id: 'org-a', name: 'B项目结算' },
    ],
  });
  const schemas = [{ name: 'forge_project_settlement', access: { default: 'private' }, sharingModel: 'private', fields: { id: { type: 'text' }, project_id: { type: 'text' }, organization_id: { type: 'text' }, name: { type: 'text' } } }];
  const ql = {
    ...engine,
    registerMiddleware() {}, registerWriteGateProbe() {}, registerEffectiveObjectPermissionsResolver() {}, setTenancyPostureProvider() {},
    getSchema(name) { return schemas.find(schema => schema.name === name); },
    registry: { getAllObjects: () => schemas },
  };
  const services = new Map([
    ['manifest', { register() {} }],
    ['metadata', { list: () => [], get: async name => schemas.find(schema => schema.name === name), watch: () => () => {} }],
    ['objectql', ql], ['tenancy', { posture: 'single' }],
  ]);
  const context = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    registerService(name, service) { services.set(name, service); },
    getService(name) { if (!services.has(name)) throw new Error(`Service ${name} is not registered`); return services.get(name); },
    hook() {},
  };
  const security = new SecurityPlugin({ defaultPermissionSets: [financeReceivablesOperatorPermission], fallbackPermissionSet: null });
  await security.init(context);
  new ProjectRlsMembershipPlugin().init(context);
  await security.start(context);

  const filter = await security.getReadFilter('forge_project_settlement', {
    userId: 'finance-a', tenantId: 'org-a', positions: ['finance_operator'], permissions: ['forge_finance_receivables_operator'],
  });
  assert.equal(rowMatches({ id: 'settlement-a', project_id: 'project-a', organization_id: 'org-a' }, filter), true);
  assert.equal(rowMatches({ id: 'settlement-b', project_id: 'project-b', organization_id: 'org-a' }, filter), true);
});

test('position scopes require an active project member, same-org assignment, active native position, readable fields and unexpired appointment', async () => {
  const resolveOne = async ({ memberActive = true, assignmentOrg = 'org-a', positionActive = true, validUntil = null, maskAllBusinessFields = false } = {}) => {
    const member = membershipRow({ id: 'member-role', userId: 'actor-a', projectId: 'project-role', active: memberActive });
    const { engine } = fakeEngine([member], [], {
      forge_project_member_position_assignment: [{ id: 'role-assignment', member_id: 'member-role', project_id: 'project-role', organization_id: assignmentOrg, position_id: 'position-role', active: true }],
      sys_user_position: [{ id: 'native-role', user_id: 'actor-a', position: 'hardware_engineer', organization_id: 'org-a', valid_until: validUntil }],
      sys_position: [{ id: 'position-role', name: 'hardware_engineer', active: positionActive }],
      sys_position_permission_set: [{ id: 'role-binding', position_id: 'position-role', permission_set_id: 'role-permission' }],
      sys_permission_set: [{ id: 'role-permission', active: true, object_permissions: { forge_project_cost_entry: { allowRead: true } },
        field_permissions: maskAllBusinessFields ? JSON.stringify({
          'forge_project_cost_entry.project_id': { readable: false },
          'forge_project_cost_entry.name': { readable: false },
          'forge_project_cost_entry.total_amount': { readable: false },
        }) : '{}' }],
      forge_project_cost_entry: [{ id: 'role-cost', project_id: 'project-role', organization_id: 'org-a', name: '工时成本', total_amount: 10 }],
    });
    return createProjectMembershipRlsResolver(() => engine).resolve({ userId: 'actor-a', tenantId: 'org-a' });
  };
  const active = await resolveOne();
  assert.deepEqual(active[projectPositionReadScopeKey('forge_project_cost_entry')], ['role-cost']);
  for (const invalid of [
    { memberActive: false },
    { assignmentOrg: 'org-other' },
    { positionActive: false },
    { validUntil: '2000-01-01T00:00:00.000Z' },
    { maskAllBusinessFields: true },
  ]) {
    const result = await resolveOne(invalid);
    assert.deepEqual(result[projectPositionReadScopeKey('forge_project_cost_entry')], [], JSON.stringify(invalid));
  }
});

test('project read-ID scope admits only exact Native contract-review shares and their controlled contract lines', async () => {
  const member = membershipRow({ id: 'reviewer-project-member', userId: 'reviewer-a', projectId: 'project-a' });
  const reviewPrefix = 'forge-contract-review:';
  const validShare = {
    id: 'share-valid', organization_id: 'org-a', object_name: 'forge_sales_contract', record_id: 'contract-shared',
    recipient_type: 'user', recipient_id: 'reviewer-a', access_level: 'read', source: 'team', source_id: reviewPrefix + 'contract-shared',
  };
  const shareRows = [
    validShare,
    { ...validShare, id: 'share-wrong-recipient', recipient_id: 'reviewer-b' },
    { ...validShare, id: 'share-wrong-org', record_id: 'contract-other-org', organization_id: 'org-b', source_id: reviewPrefix + 'contract-other-org' },
    { ...validShare, id: 'share-wrong-object', object_name: 'forge_sales_order' },
    { ...validShare, id: 'share-wrong-level', access_level: 'edit' },
    { ...validShare, id: 'share-wrong-source', source: 'manual' },
    { ...validShare, id: 'share-wrong-source-id', source_id: 'other:' + 'contract-shared' },
    { ...validShare, id: 'share-mismatched-record-id', record_id: 'contract-shared', source_id: reviewPrefix + 'another-contract' },
    { ...validShare, id: 'share-missing-parent', record_id: 'missing-parent', source_id: reviewPrefix + 'missing-parent' },
  ];
  const appointment = { id: 'native-solution-position', user_id: 'reviewer-a', position: 'solution_engineer', organization_id: 'org-a' };
  const assignment = { id: 'project-solution-assignment', member_id: member.id, project_id: 'project-a', position_id: 'position-solution', organization_id: 'org-a', active: true };
  const solutionSet = { ...solutionOperatorPermission, objects: { ...solutionOperatorPermission.objects, forge_sales_contract: { allowRead: true, readScope: 'org' } } };
  const { engine } = fakeEngine([member], [], {
    forge_project_member_position_assignment: [assignment],
    sys_user_position: [appointment],
    sys_position: [{ id: 'position-solution', name: 'solution_engineer', active: true, organization_id: 'org-a' }],
    sys_position_permission_set: [{ id: 'solution-binding', position_id: 'position-solution', permission_set_id: 'solution-set' }],
    sys_permission_set: [{
      id: 'solution-set', name: solutionSet.name, active: true,
      object_permissions: JSON.stringify(solutionSet.objects),
      field_permissions: JSON.stringify(solutionSet.fields),
      system_permissions: JSON.stringify(solutionSet.systemPermissions),
      row_level_security: JSON.stringify(solutionSet.rowLevelSecurity),
    }],
    sys_record_share: shareRows,
    forge_project_sales_link: [{ id: 'project-only-link', project_id: 'project-a', contract_id: 'contract-project-only', organization_id: 'org-a' }],
    forge_sales_contract: [
      { id: 'contract-project-only', organization_id: 'org-a', name: 'Project-visible unsigned contract', owner_id: 'maker-a' },
      { id: 'contract-shared', organization_id: 'org-a', name: 'Shared contract', owner_id: 'maker-a' },
      { id: 'contract-other-org', organization_id: 'org-b', name: 'Other org contract', owner_id: 'maker-b' },
      { id: 'forge_sales_order', organization_id: 'org-a', name: 'Wrong target type', owner_id: 'maker-a' },
    ],
    forge_sales_contract_line: [
      { id: 'line-shared', organization_id: 'org-a', contract_id: 'contract-shared', name: 'Shared line' },
      { id: 'line-unshared', organization_id: 'org-a', contract_id: 'contract-unshared', name: 'Unshared line' },
      { id: 'line-cross-org', organization_id: 'org-b', contract_id: 'contract-other-org', name: 'Other org line' },
    ],
  });
  const resolver = createProjectMembershipRlsResolver(() => engine);
  const result = await resolver.resolve({ userId: 'reviewer-a', tenantId: 'org-a', permissions: ['forge_solution_operator'] });

  assert.deepEqual(result[projectPositionReadScopeKey('forge_sales_contract')], ['contract-shared']);
  assert.deepEqual(result[projectPositionReadScopeKey('forge_sales_contract_line')], ['line-shared']);
  assert.deepEqual(result[projectPositionEditScopeKey('forge_sales_contract')], []);
  assert.deepEqual(result[projectPositionDeleteScopeKey('forge_sales_contract')], []);
  assert.deepEqual(result[projectPositionEditScopeKey('forge_sales_contract_line')], []);
  assert.deepEqual(result[projectPositionDeleteScopeKey('forge_sales_contract_line')], []);
  assert.deepEqual(result[CONTRACT_REVIEW_RLS_KEY], ['contract-shared']);
  assert.ok(!result[CONTRACT_REVIEW_RLS_KEY].includes('contract-project-only'), 'project assignment without exact native review share never enters the signed-contract read exception');
});

test('direct project settlement rows are scoped by their native project_id relation', async () => {
  const member = membershipRow({ id: 'finance-member', userId: 'finance-a', projectId: 'project-a' });
  const { engine } = fakeEngine([member], [], {
    forge_project_member_position_assignment: [{ id: 'finance-assignment', member_id: member.id, project_id: 'project-a', organization_id: 'org-a', position_id: 'finance-position', active: true }],
    sys_user_position: [{ id: 'finance-appointment', user_id: 'finance-a', position: 'finance_operator', organization_id: 'org-a' }],
    sys_position: [{ id: 'finance-position', name: 'finance_operator', active: true }],
    sys_position_permission_set: [{ id: 'finance-binding', position_id: 'finance-position', permission_set_id: 'finance-permission' }],
    sys_permission_set: [{ id: 'finance-permission', active: true, object_permissions: { forge_project_settlement: { allowRead: true } } }],
    forge_project_settlement: [
      { id: 'settlement-a', project_id: 'project-a', organization_id: 'org-a', name: 'A 项目结算' },
      { id: 'settlement-b', project_id: 'project-b', organization_id: 'org-a', name: 'B 项目结算' },
    ],
  });
  const result = await createProjectMembershipRlsResolver(() => engine).resolve({ userId: 'finance-a', tenantId: 'org-a' });
  assert.deepEqual(result[projectPositionReadScopeKey('forge_project_settlement')], ['settlement-a']);
});

test('multi-parent child rows are scoped only when every declared relationship resolves inside the project', async () => {
  const member = membershipRow({ id: 'member-bom', userId: 'engineer-b', projectId: 'project-b' });
  const { engine } = fakeEngine([member], [], {
    forge_project_member_position_assignment: [{ id: 'assignment-bom', member_id: member.id, project_id: 'project-b', organization_id: 'org-a', position_id: 'position-bom', active: true }],
    sys_user_position: [{ id: 'appointment-bom', user_id: 'engineer-b', position: 'bom_engineer', organization_id: 'org-a' }],
    sys_position: [{ id: 'position-bom', name: 'bom_engineer', active: true }],
    sys_position_permission_set: [{ id: 'binding-bom', position_id: 'position-bom', permission_set_id: 'permission-bom' }],
    sys_permission_set: [{ id: 'permission-bom', active: true, object_permissions: { forge_bom_shortage_line: { allowRead: true } } }],
    forge_bom: [
      { id: 'bom-a', project_id: 'project-a', organization_id: 'org-a' },
      { id: 'bom-b', project_id: 'project-b', organization_id: 'org-a' },
    ],
    forge_bom_shortage_analysis: [
      { id: 'analysis-a', project_id: 'project-a', organization_id: 'org-a' },
      { id: 'analysis-b', project_id: 'project-b', organization_id: 'org-a' },
    ],
    forge_bom_shortage_line: [
      { id: 'line-both-b', analysis_id: 'analysis-b', bom_id: 'bom-b', organization_id: 'org-a' },
      { id: 'line-cross-parent', analysis_id: 'analysis-a', bom_id: 'bom-b', organization_id: 'org-a' },
    ],
  });
  const result = await createProjectMembershipRlsResolver(() => engine).resolve({ userId: 'engineer-b', tenantId: 'org-a' });
  assert.deepEqual(result[projectPositionReadScopeKey('forge_bom_shortage_line')], ['line-both-b']);
});

test('SecurityPlugin compiles the active project set into the project SELECT RLS filter', async () => {
  const { engine } = fakeEngine([
    membershipRow({ id: 'member-a', projectId: 'project-visible', organizationId: 'org-a' }),
  ]);
  const projectSchema = {
    name: 'forge_project',
    access: { default: 'private' },
    sharingModel: 'private',
    fields: Object.fromEntries(['id', 'owner_id', 'created_by', 'manager_id', 'organization_id'].map(name => [name, { type: 'text' }])),
  };
  const ql = {
    ...engine,
    registerMiddleware() {},
    registerWriteGateProbe() {},
    registerEffectiveObjectPermissionsResolver() {},
    setTenancyPostureProvider() {},
    getSchema(name) { return name === 'forge_project' ? projectSchema : undefined; },
    registry: { getAllObjects: () => [projectSchema] },
  };
  const services = new Map([
    ['manifest', { register() {} }],
    ['metadata', { list: () => [], get: async () => projectSchema, watch: () => () => {} }],
    ['objectql', ql],
    ['tenancy', { posture: 'single' }],
  ]);
  const context = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    registerService(name, service) { services.set(name, service); },
    getService(name) {
      if (!services.has(name)) throw new Error(`Service ${name} is not registered`);
      return services.get(name);
    },
    hook() {},
  };
  const security = new SecurityPlugin({
    defaultPermissionSets: [projectOperatorPermission],
    fallbackPermissionSet: null,
  });

  await security.init(context);
  new ProjectRlsMembershipPlugin().init(context);
  await security.start(context);

  const actorContext = {
    userId: 'actor-a',
    tenantId: 'org-a',
    positions: [],
    permissions: ['forge_project_operator'],
  };
  const filter = await security.getReadFilter('forge_project', actorContext);
  const source = JSON.stringify(filter);
  assert.match(source, /project-visible/);
  assert.match(source, /owner_id|created_by|manager_id/);
  assert.doesNotMatch(source, /project-inactive|project-other-user/);

  const permissionSets = await security.resolvePermissionSetsForContext(actorContext);
  const updateUsing = await security.computeRlsFilter(permissionSets, 'forge_project', 'update', actorContext);
  const updateCheck = await security.computeWriteCheckFilter(permissionSets, 'forge_project', 'update', actorContext);
  const writeSource = JSON.stringify({ updateUsing, updateCheck });
  assert.match(writeSource, /owner_id|created_by|manager_id/);
  assert.doesNotMatch(writeSource, /project-visible|active_project_ids/);
});
