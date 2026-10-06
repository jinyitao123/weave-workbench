import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceOrderReferenceSharingPlugin } from '../src/plugins/service-order-reference-sharing.plugin.ts';

const sourceId = 'forge_service_order_assignment';
const referenceFields = [
  ['forge_customer', 'customer_id'],
  ['forge_contact', 'contact_id'],
  ['forge_sales_order', 'sales_order_id'],
  ['forge_sales_contract', 'contract_id'],
];

function engineerRows(org = 'org-a', user = 'engineer-a') {
  return {
    sys_position: [{ id: `${org}-after-sales`, name: 'after_sales_operator', active: true, organization_id: org }],
    sys_user_position: [{ user_id: user, position: 'after_sales_operator', organization_id: org, valid_from: null, valid_until: null }],
    sys_member: [{ user_id: user, organization_id: org, role: 'member' }],
    sys_user: [{ id: user, name: user, banned: false }],
  };
}

function fakeRuntime({ organizations = ['org-a'], tables: supplied = {} } = {}) {
  const registrations = [];
  const lifecycle = [];
  const findCalls = [];
  const grantCalls = [];
  const revokeCalls = [];
  const tables = {
    sys_organization: organizations.map(id => ({ id })),
    forge_service_order: [],
    sys_record_share: [],
    sys_position: [],
    sys_user_position: [],
    sys_member: [],
    sys_user: [],
    ...supplied,
  };
  let shareSequence = 0;
  const engine = {
    registerHook(event, handler, options) { registrations.push({ event, handler, options }); },
    find: async (object, query, options) => {
      findCalls.push({ object, query, context: options?.context });
      const matches = (tables[object] || []).filter(row => Object.entries(query?.where || {}).every(([key, value]) => row[key] === value));
      const page = matches.slice(query?.offset || 0, (query?.offset || 0) + (query?.limit || matches.length));
      return query?.fields ? page.map(row => Object.fromEntries(query.fields.map(field => [field, row[field]]))) : page.map(row => ({ ...row }));
    },
    findOne: async (object, query, options) => {
      findCalls.push({ object, query, context: options?.context, findOne: true });
      const row = (tables[object] || []).find(item => Object.entries(query?.where || {}).every(([key, value]) => item[key] === value));
      if (!row) return null;
      return query?.fields ? Object.fromEntries(query.fields.map(field => [field, row[field]])) : { ...row };
    },
  };
  const shareRows = (object, recordId) => tables.sys_record_share.filter(row => row.object_name === object && row.record_id === recordId);
  const sharing = {
    grant: async (input, context) => {
      grantCalls.push({ input: { ...input }, context });
      const existing = tables.sys_record_share.find(row => row.object_name === input.object
        && row.record_id === input.recordId && row.recipient_type === (input.recipientType || 'user')
        && row.recipient_id === input.recipientId && row.source === (input.source || 'manual'));
      if (existing) {
        existing.source_id = input.sourceId;
        existing.reason = input.reason;
        return { ...existing };
      }
      const row = {
        id: `share-${++shareSequence}`,
        object_name: input.object,
        record_id: input.recordId,
        recipient_type: input.recipientType || 'user',
        recipient_id: input.recipientId,
        access_level: input.accessLevel || 'read',
        source: input.source || 'manual',
        source_id: input.sourceId,
        organization_id: context.tenantId,
        reason: input.reason,
      };
      tables.sys_record_share.push(row);
      return { ...row };
    },
    listShares: async (object, recordId, context) => {
      return shareRows(object, recordId).map(row => ({ ...row, source_id: row.source_id }));
    },
    revoke: async (shareId, context, scope) => {
      revokeCalls.push({ shareId, context, scope });
      const index = tables.sys_record_share.findIndex(row => row.id === shareId
        && row.object_name === scope.object && row.record_id === scope.recordId);
      if (index >= 0) tables.sys_record_share.splice(index, 1);
    },
  };
  const context = {
    hook: (event, handler) => lifecycle.push({ event, handler }),
    getService: name => {
      if (name === 'objectql') return engine;
      if (name === 'sharing') return sharing;
      throw new Error(`Unexpected service ${name}`);
    },
  };
  return {
    context, tables, registrations, findCalls, grantCalls, revokeCalls,
    async trigger(event) {
      for (const item of lifecycle.filter(item => item.event === event)) await item.handler();
    },
    registered(event, object) {
      const match = registrations.find(item => item.event === event && item.options.object === object);
      assert.ok(match, `expected ${event} hook for ${object}`);
      return match.handler;
    },
  };
}

function order({ id = 'ticket-a', organization_id = 'org-a', engineer_id = null, owner_id = 'manager-a', status = 'pending_dispatch', suffix = 'a' } = {}) {
  return {
    id, organization_id, engineer_id, owner_id, responsible_id: engineer_id || owner_id, status,
    customer_id: `customer-${suffix}`, contact_id: `contact-${suffix}`,
    sales_order_id: `sales-order-${suffix}`, contract_id: `contract-${suffix}`,
  };
}

function hookContext(event, { previous = null, result = null, organizationId = 'org-a', userId = 'manager-a' } = {}) {
  return {
    id: `trace-${event}`,
    object: 'forge_service_order',
    event,
    session: { userId, organizationId },
    user: { id: userId, organizationId },
    input: result?.id ? { id: result.id, data: result } : {},
    ...(previous ? { previous } : {}),
    ...(result ? { result } : {}),
  };
}

function readable(runtime, object, recordId, userId, ownerId = null) {
  if (ownerId === userId) return true;
  return runtime.tables.sys_record_share.some(row => row.object_name === object
    && row.record_id === recordId && row.recipient_type === 'user'
    && row.recipient_id === userId && row.access_level === 'read');
}

async function boot(runtime, plugin = new ServiceOrderReferenceSharingPlugin()) {
  plugin.start(runtime.context);
  assert.equal(runtime.registrations.length, 0, 'record hooks wait for kernel:ready');
  await runtime.trigger('kernel:ready');
  await runtime.trigger('kernel:bootstrapped');
}

test('boot backfill enumerates organizations globally then shares within each tenant context', async () => {
  const a = { ...engineerRows('org-a', 'engineer-a') };
  const b = { sys_position: [], sys_user_position: [], sys_member: [], sys_user: [] };
  const runtime = fakeRuntime({
    organizations: ['org-a', 'org-b'],
    tables: {
      ...a,
      ...Object.fromEntries(Object.entries(b).map(([key, value]) => [key, [...(a[key] || []), ...value]])),
      forge_service_order: [order({ id: 'ticket-a', engineer_id: 'engineer-a', status: 'pending_receive', suffix: 'a' }),
        order({ id: 'ticket-b', organization_id: 'org-b', engineer_id: 'engineer-b', status: 'in_progress', suffix: 'b' })],
    },
  });
  await boot(runtime);
  assert.equal(runtime.grantCalls.length, 4);
  assert.deepEqual(runtime.grantCalls.map(call => call.input.object).sort(), referenceFields.map(([object]) => object).sort());
  assert.ok(runtime.grantCalls.every(call => call.context.isSystem && call.context.tenantId === 'org-a'));
  const directoryRead = runtime.findCalls.find(call => call.object === 'sys_organization');
  assert.equal(directoryRead.context.isSystem, true);
  assert.equal(directoryRead.context.tenantId, undefined);
  assert.ok(runtime.findCalls.filter(call => call.object === 'forge_service_order').every(call => call.context.tenantId === call.query.where.organization_id));
  assert.equal(runtime.tables.sys_record_share.filter(row => row.organization_id === 'org-b').length, 0);
});

test('assignment grants four linked records, reassign revokes old access, and new assignee gains it', async () => {
  const ids = engineerRows();
  const second = engineerRows('org-a', 'engineer-b');
  const runtime = fakeRuntime({ tables: {
    ...Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, [...value, ...(second[key] || [])]])),
    sys_user_position: [...ids.sys_user_position, ...second.sys_user_position],
    sys_member: [...ids.sys_member, ...second.sys_member],
    sys_user: [...ids.sys_user, ...second.sys_user],
    forge_service_order: [order()],
  } });
  await boot(runtime);
  const ticket = runtime.tables.forge_service_order[0];
  assert.equal(readable(runtime, 'forge_customer', ticket.customer_id, 'engineer-a'), false);
  const assigned = { ...ticket, engineer_id: 'engineer-a', owner_id: 'engineer-a', responsible_id: 'engineer-a', status: 'pending_receive' };
  runtime.tables.forge_service_order[0] = assigned;
  await runtime.registered('afterUpdate', 'forge_service_order')(hookContext('afterUpdate', { previous: ticket, result: assigned }));
  assert.equal(runtime.grantCalls.length, 4);
  for (const [object, field] of referenceFields) assert.equal(readable(runtime, object, assigned[field], 'engineer-a'), true);

  const reassigned = { ...assigned, engineer_id: 'engineer-b', owner_id: 'engineer-b', responsible_id: 'engineer-b' };
  runtime.tables.forge_service_order[0] = reassigned;
  await runtime.registered('afterUpdate', 'forge_service_order')(hookContext('afterUpdate', { previous: assigned, result: reassigned }));
  for (const [object, field] of referenceFields) {
    assert.equal(readable(runtime, object, assigned[field], 'engineer-a'), false);
    assert.equal(readable(runtime, object, reassigned[field], 'engineer-b'), true);
  }
  assert.equal(runtime.revokeCalls.length, 4);
  assert.ok(runtime.revokeCalls.every(call => call.context.tenantId === 'org-a' && call.scope.object));
});

test('shared references survive one ticket reassignment and are revoked after the last active ticket closes', async () => {
  const identity = engineerRows();
  const engineerB = engineerRows('org-a', 'engineer-b');
  for (const key of ['sys_position', 'sys_user_position', 'sys_member', 'sys_user']) identity[key].push(...engineerB[key]);
  const first = order({ id: 'ticket-one', engineer_id: 'engineer-a', owner_id: 'engineer-a', status: 'in_progress', suffix: 'shared' });
  const second = order({ id: 'ticket-two', engineer_id: 'engineer-a', owner_id: 'engineer-a', status: 'pending_receive', suffix: 'shared' });
  const runtime = fakeRuntime({ tables: { ...identity, forge_service_order: [first, second] } });
  await boot(runtime);
  assert.equal(runtime.grantCalls.length, 4, 'the native grant key materializes one row per shared record and engineer');
  const changedSecond = { ...second, engineer_id: 'engineer-b', owner_id: 'engineer-b', responsible_id: 'engineer-b' };
  runtime.tables.forge_service_order[1] = changedSecond;
  await runtime.registered('afterUpdate', 'forge_service_order')(hookContext('afterUpdate', { previous: second, result: changedSecond }));
  assert.equal(runtime.revokeCalls.length, 0, 'the first ticket still justifies engineer-a access');
  assert.equal(readable(runtime, 'forge_customer', first.customer_id, 'engineer-a'), true);

  const closedFirst = { ...first, status: 'closed' };
  runtime.tables.forge_service_order[0] = closedFirst;
  await runtime.registered('afterUpdate', 'forge_service_order')(hookContext('afterUpdate', { previous: first, result: closedFirst }));
  assert.equal(readable(runtime, 'forge_customer', first.customer_id, 'engineer-a'), false);
  assert.equal(readable(runtime, 'forge_customer', changedSecond.customer_id, 'engineer-b'), true);
});

test('position deactivation withdraws assignment shares; reactivation restores them', async () => {
  const identity = engineerRows();
  const ticket = order({ engineer_id: 'engineer-a', owner_id: 'engineer-a', status: 'in_progress' });
  const runtime = fakeRuntime({ tables: { ...identity, forge_service_order: [ticket] } });
  await boot(runtime);
  assert.equal(runtime.grantCalls.length, 4);
  const position = runtime.tables.sys_position[0];
  const disabled = { ...position, active: false };
  runtime.tables.sys_position[0] = disabled;
  await runtime.registered('afterUpdate', 'sys_position')({
    ...hookContext('afterUpdate'), object: 'sys_position', previous: position, result: disabled,
  });
  assert.equal(runtime.revokeCalls.length, 4);
  assert.equal(readable(runtime, 'forge_customer', ticket.customer_id, 'engineer-a'), false);
  runtime.tables.sys_position[0] = position;
  await runtime.registered('afterUpdate', 'sys_position')({
    ...hookContext('afterUpdate'), object: 'sys_position', previous: disabled, result: position,
  });
  assert.equal(readable(runtime, 'forge_customer', ticket.customer_id, 'engineer-a'), true);
});

test('existing team shares are never overwritten or revoked; plugin grant returns when the other cause disappears', async () => {
  const identity = engineerRows();
  const ticket = order({ engineer_id: 'engineer-a', owner_id: 'engineer-a', status: 'in_progress' });
  const external = {
    id: 'external-team-grant', object_name: 'forge_customer', record_id: ticket.customer_id,
    recipient_type: 'user', recipient_id: 'engineer-a', access_level: 'read', source: 'team', source_id: 'another-team', organization_id: 'org-a',
  };
  const runtime = fakeRuntime({ tables: { ...identity, forge_service_order: [ticket], sys_record_share: [external] } });
  await boot(runtime);
  const stillExternal = runtime.tables.sys_record_share.find(row => row.id === external.id);
  assert.equal(stillExternal.source_id, 'another-team');
  assert.equal(runtime.tables.sys_record_share.filter(row => row.object_name === 'forge_customer' && row.record_id === ticket.customer_id).length, 1);
  assert.equal(runtime.grantCalls.filter(call => call.input.object === 'forge_customer').length, 0);

  runtime.tables.sys_record_share.splice(runtime.tables.sys_record_share.findIndex(row => row.id === external.id), 1);
  await runtime.registered('afterDelete', 'sys_record_share')({
    ...hookContext('afterDelete'), object: 'sys_record_share', previous: external,
  });
  assert.ok(runtime.tables.sys_record_share.some(row => row.object_name === 'forge_customer'
    && row.record_id === ticket.customer_id && row.source_id === sourceId));
  assert.equal(runtime.revokeCalls.some(call => call.shareId === external.id), false);
});

test('empty organization directory permits cold start and later organization creation reconciles shares', async () => {
  const runtime = fakeRuntime({ organizations: [], tables: {
    ...engineerRows('org-a', 'engineer-a'),
    forge_service_order: [order({ engineer_id: 'engineer-a', status: 'in_progress' })],
  } });
  const plugin = new ServiceOrderReferenceSharingPlugin();
  plugin.start(runtime.context);
  await runtime.trigger('kernel:ready');
  await runtime.trigger('kernel:bootstrapped');
  assert.equal(runtime.grantCalls.length, 0);
  await runtime.registered('afterInsert', 'sys_user')(hookContext('afterInsert', { result: { id: 'engineer-a' } }));
  assert.equal(runtime.grantCalls.length, 0);
  runtime.tables.sys_organization.push({ id: 'org-a' });
  await runtime.registered('afterInsert', 'sys_organization')(hookContext('afterInsert', { result: { id: 'org-a' } }));
  assert.ok(runtime.grantCalls.length > 0);
  assert.ok(runtime.grantCalls.every(call => call.context.tenantId === 'org-a'));
});
