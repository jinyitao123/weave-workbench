import assert from 'node:assert/strict';
import test from 'node:test';
import { QuickJSScriptRunner } from '@objectstack/runtime';
import {
  SALES_PERFORMANCE_BUSINESS_DATE_PROJECTION_KEY,
  SalesPerformanceCalendarPlugin,
  createSalesPerformanceCalendarActionHandler,
} from '../src/plugins/sales-performance-calendar.plugin.ts';

const ENTRY_OBJECT = 'forge_sales_performance_entry';
const ORG = 'calendar-adapter-org';

function fixture({ timezone = 'Asia/Shanghai', rows = {} } = {}) {
  const organizationReads = [];
  const calls = [];
  let writes = 0;
  const engine = {
    async findOne(objectName, query, options) {
      organizationReads.push({ objectName, query, options });
      assert.equal(objectName, 'sys_organization');
      return query.where.id === ORG ? { id: ORG, timezone } : null;
    },
  };
  const api = {
    marker: 'existing-authenticated-object-api',
    object(objectName) {
      return {
        async find(query) {
          calls.push({ objectName, method: 'find', query });
          return rows[objectName] || [];
        },
        async findOne(query) {
          calls.push({ objectName, method: 'findOne', query });
          return (rows[objectName] || [])[0] || null;
        },
        async update() {
          writes++;
          return 1;
        },
        async insert() {
          writes++;
          return { id: 'unexpected-write' };
        },
      };
    },
    async transaction(callback) { return callback(api); },
  };
  const actionContext = {
    user: { id: 'calendar-reader', organizationId: ORG, systemPermissions: ['sales_performance_read'] },
    session: { userId: 'calendar-reader', organizationId: ORG },
    params: {
      timezone: 'Pacific/Honolulu',
      organization_id: 'client-spoof-org',
      [SALES_PERFORMANCE_BUSINESS_DATE_PROJECTION_KEY]: { confirmed_at: '1900-01-01' },
    },
    api,
  };
  return { engine, api, actionContext, calls, organizationReads, get writes() { return writes; } };
}

function bodyAction(source, objectName = ENTRY_OBJECT) {
  return {
    name: 'calendar_adapter_test_action',
    objectName,
    type: 'script',
    body: { language: 'js', capabilities: ['api.read'], source },
  };
}

async function withHandler(engine, action, callback, options = {}) {
  const handler = createSalesPerformanceCalendarActionHandler(engine, action, options);
  try { return await callback(handler); }
  finally { await handler.dispose(); }
}

test('workspace body receives scoped temporary timestamp dates and preserves source timestamps and query shape', async () => {
  const entryRows = [
    {
      id: 'entry-quarter', organization_id: ORG,
      confirmed_at: '2026-03-31T16:30:00.000Z',
      submitted_at: '2025-12-31T16:30:00.000Z',
      created_at: '2026-03-31T16:30:00.000Z',
      recognition_on: '2026-03-31',
      [SALES_PERFORMANCE_BUSINESS_DATE_PROJECTION_KEY]: { confirmed_at: '1900-01-01' },
    },
    {
      id: 'entry-invalid', organization_id: { value: ORG },
      confirmed_at: '2026-04-01', // date-only is malformed for this datetime field
      submitted_at: '2026-02-31T16:30:00.000Z', // JS Date would normalize this impossible day
      created_at: '2026-04-01T25:00:00.000Z',
      recognition_on: '2026-04-01',
    },
    {
      id: 'foreign-entry', organization_id: 'another-org',
      confirmed_at: '2026-03-31T16:30:00.000Z',
      [SALES_PERFORMANCE_BUSINESS_DATE_PROJECTION_KEY]: { confirmed_at: '1900-01-01' },
    },
  ];
  const confirmationRows = [{
    id: 'confirmation', organization_id: ORG,
    approved_at: '2026-03-31T16:30:00.000Z',
    submitted_at: '2025-12-31T16:30:00.000Z',
    created_at: '2026-03-31T16:30:00.000Z',
  }];
  const rebookRows = [{
    id: 'rebook', organization_id: ORG,
    approved_at: '2026-03-31T16:30:00.000Z',
    submitted_at: '2025-12-31T16:30:00.000Z',
    created_at: '2026-03-31T16:30:00.000Z',
  }];
  const orderRows = [{
    id: 'order', organization_id: ORG,
    completed_at: '2026-03-31T16:30:00.000Z',
    completion_date: '2026-03-31',
  }];
  const h = fixture({ rows: {
    [ENTRY_OBJECT]: entryRows,
    forge_sales_performance_confirmation: confirmationRows,
    forge_sales_performance_rebook: rebookRows,
    forge_sales_order: orderRows,
  } });
  const action = bodyAction(`
const entryQuery = { where: { organization_id: ctx.session.organizationId, status: 'confirmed' }, fields: ['id', 'organization_id', 'confirmed_at', 'submitted_at', 'created_at', 'recognition_on'], limit: 25, offset: 0 };
const entries = await ctx.api.object('forge_sales_performance_entry').find(entryQuery);
const confirmation = await ctx.api.object('forge_sales_performance_confirmation').findOne({ where: { id: 'confirmation', organization_id: ctx.session.organizationId }, fields: ['id', 'organization_id', 'approved_at', 'submitted_at', 'created_at'] });
const rebook = await ctx.api.object('forge_sales_performance_rebook').findOne({ where: { id: 'rebook', organization_id: ctx.session.organizationId } });
const order = await ctx.api.object('forge_sales_order').findOne({ where: { id: 'order', organization_id: ctx.session.organizationId }, fields: ['id', 'organization_id', 'completed_at', 'completion_date'] });
return {
  actor_id: ctx.user && ctx.user.id,
  permission: ctx.user && ctx.user.systemPermissions && ctx.user.systemPermissions[0],
  organization_id: ctx.session.organizationId,
  entries: entries.map(row => ({ id: row.id, raw_confirmed_at: row.confirmed_at, confirmed_on: row.__forge_business_dates && row.__forge_business_dates.confirmed_at, submitted_on: row.__forge_business_dates && row.__forge_business_dates.submitted_at, created_on: row.__forge_business_dates && row.__forge_business_dates.created_at, recognition_on: row.recognition_on })),
  confirmation: { raw_approved_at: confirmation.approved_at, approved_on: confirmation.__forge_business_dates && confirmation.__forge_business_dates.approved_at },
  rebook: { raw_submitted_at: rebook.submitted_at, submitted_on: rebook.__forge_business_dates && rebook.__forge_business_dates.submitted_at },
  order: { raw_completed_at: order.completed_at, completed_on: order.__forge_business_dates && order.__forge_business_dates.completed_at, completion_date: order.completion_date },
  source_rows: entries,
};
`);

  await withHandler(h.engine, action, async handler => {
    const result = await handler(h.actionContext);
    assert.deepEqual({ actor_id: result.actor_id, permission: result.permission, organization_id: result.organization_id }, {
      actor_id: 'calendar-reader', permission: 'sales_performance_read', organization_id: ORG,
    }, 'the authenticated user/session passed to the existing QuickJS body are retained');
    assert.deepEqual(result.entries[0], {
      id: 'entry-quarter', raw_confirmed_at: '2026-03-31T16:30:00.000Z',
      confirmed_on: '2026-04-01', submitted_on: '2026-01-01', created_on: '2026-04-01', recognition_on: '2026-03-31',
    });
    assert.deepEqual(result.entries[1], {
      id: 'entry-invalid', raw_confirmed_at: '2026-04-01', confirmed_on: null, submitted_on: null, created_on: null, recognition_on: '2026-04-01',
    });
    assert.equal(result.source_rows[1].organization_id.value, ORG, 'lookup-shaped organization ids are scoped by their stable id/value');
    assert.deepEqual(result.entries[2], {
      id: 'foreign-entry', raw_confirmed_at: '2026-03-31T16:30:00.000Z',
    });
    assert.deepEqual(result.confirmation, { raw_approved_at: '2026-03-31T16:30:00.000Z', approved_on: '2026-04-01' });
    assert.deepEqual(result.rebook, { raw_submitted_at: '2025-12-31T16:30:00.000Z', submitted_on: '2026-01-01' });
    assert.deepEqual(result.order, { raw_completed_at: '2026-03-31T16:30:00.000Z', completed_on: '2026-04-01', completion_date: '2026-03-31' });
    assert.equal(Object.hasOwn(result.source_rows[0], SALES_PERFORMANCE_BUSINESS_DATE_PROJECTION_KEY), false, 'the private map is stripped recursively from the handler response');
    assert.equal(result.source_rows[0].confirmed_at, '2026-03-31T16:30:00.000Z', 'source DateTime values remain unchanged');
  }, { actionTimeoutMs: 30_000 });

  assert.equal(h.organizationReads.length, 1);
  assert.deepEqual(h.organizationReads[0].query, { where: { id: ORG }, fields: ['id', 'timezone'] });
  assert.equal(h.organizationReads[0].options.context.tenantId, ORG);
  assert.deepEqual(h.calls.map(call => [call.objectName, call.method]), [
    [ENTRY_OBJECT, 'find'],
    ['forge_sales_performance_confirmation', 'findOne'],
    ['forge_sales_performance_rebook', 'findOne'],
    ['forge_sales_order', 'findOne'],
  ]);
  assert.deepEqual(h.calls[0].query, {
    where: { organization_id: ORG, status: 'confirmed' },
    fields: ['id', 'organization_id', 'confirmed_at', 'submitted_at', 'created_at', 'recognition_on'],
    limit: 25,
    offset: 0,
  }, 'the original scoped predicate, selection, and paging options are passed through unchanged');
  assert.deepEqual(h.calls[1].query, {
    where: { id: 'confirmation', organization_id: ORG },
    fields: ['id', 'organization_id', 'approved_at', 'submitted_at', 'created_at'],
  }, 'findOne fields and organization scope are also passed through unchanged');
});

test('organization timezone uses DST transitions and client timezone parameters cannot override it', async () => {
  const rows = [{
    id: 'dst-before', organization_id: ORG, confirmed_at: '2026-03-08T06:59:59.999Z',
  }, {
    id: 'dst-after', organization_id: ORG, confirmed_at: '2026-03-08T07:00:00.000Z',
  }];
  const h = fixture({ timezone: 'America/New_York', rows: { [ENTRY_OBJECT]: rows } });
  const action = bodyAction(`
const rows = await ctx.api.object('forge_sales_performance_entry').find({ where: { organization_id: ctx.session.organizationId } });
return rows.map(row => ({ id: row.id, raw: row.confirmed_at, business_day: row.__forge_business_dates && row.__forge_business_dates.confirmed_at }));
`);
  await withHandler(h.engine, action, async handler => {
    const result = await handler(h.actionContext);
    assert.deepEqual(result, [
      { id: 'dst-before', raw: '2026-03-08T06:59:59.999Z', business_day: '2026-03-08' },
      { id: 'dst-after', raw: '2026-03-08T07:00:00.000Z', business_day: '2026-03-08' },
    ]);
  });
  assert.equal(h.organizationReads[0].query.where.id, ORG, 'the server derives the zone from the authenticated organization');
});

test('missing authenticated ObjectQL API fails closed without a system/global fallback', async () => {
  const h = fixture();
  const handler = createSalesPerformanceCalendarActionHandler(h.engine, bodyAction('return [];'));
  try {
    await assert.rejects(handler({ session: { userId: 'calendar-reader', organizationId: ORG }, params: {} }), /缺少认证ObjectQL API/);
    assert.equal(h.organizationReads.length, 0);
  } finally {
    await handler.dispose();
  }
});

test('conflicting authenticated user and session identities fail closed', async () => {
  const h = fixture();
  const handler = createSalesPerformanceCalendarActionHandler(h.engine, bodyAction('return [];'));
  try {
    await assert.rejects(handler({
      ...h.actionContext,
      user: { id: 'different-user', organizationId: ORG },
    }), /当前操作人和组织上下文不一致/);
    assert.equal(h.organizationReads.length, 0);
  } finally {
    await handler.dispose();
  }
});

test('the calendar wrapper does not grant an undeclared write capability', async () => {
  const h = fixture({ rows: { [ENTRY_OBJECT]: [{ id: 'entry', organization_id: ORG }] } });
  const action = bodyAction(`await ctx.api.object('forge_sales_performance_entry').update({ id: 'entry', status: 'rebooked' }); return true;`);
  const handler = createSalesPerformanceCalendarActionHandler(h.engine, action);
  try {
    await assert.rejects(handler(h.actionContext), /api\.write/);
    assert.equal(h.writes, 0);
  } finally {
    await handler.dispose();
  }
});

test('the plugin registers one wrapper per existing metadata action after kernel start and cleans up runners', async () => {
  const originalDispose = QuickJSScriptRunner.prototype.dispose;
  let disposed = 0;
  QuickJSScriptRunner.prototype.dispose = async function (...args) {
    disposed++;
    return originalDispose.apply(this, args);
  };
  const registered = [];
  const removed = [];
  const engine = {
    registerAction(objectName, actionName, handler, packageName) { registered.push({ objectName, actionName, handler, packageName }); },
    removeActionsByPackage(packageName) { removed.push(packageName); },
  };
  let onReady, destroyed = false;
  const plugin = new SalesPerformanceCalendarPlugin();
  try {
    plugin.start({
      getService: name => name === 'objectql' ? engine : undefined,
      hook: (name, handler) => { assert.equal(name, 'kernel:ready'); onReady = handler; },
    });
    assert.equal(registered.length, 0, 'the adapter waits until AppPlugin has registered bundled actions');
    await onReady();
    assert.deepEqual(registered.map(item => [item.objectName, item.actionName]), [
      ['forge_sales_performance_entry', 'sales_performance_workspace_query'],
      ['forge_sales_performance_rebook', 'sales_performance_rebook_export_create'],
    ]);
    assert.ok(registered.every(item => item.packageName === 'com.inoforge.forge.sales-performance-calendar'));
    await plugin.destroy();
    assert.deepEqual(removed, ['com.inoforge.forge.sales-performance-calendar']);
    assert.equal(disposed, 2);
    destroyed = true;
  } finally {
    if (onReady && registered.length && !destroyed) await plugin.destroy();
    QuickJSScriptRunner.prototype.dispose = originalDispose;
  }
});
