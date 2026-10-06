import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {
  ServiceOrderDispatch,
  ServiceOrderDispatchEngineers,
  ServiceOrderEngineerAccept,
} from '../src/actions/sales.action.ts';
import {
  ServiceDispatchPage,
  ServiceOrdersPage,
  ServiceWorkspacePage,
} from '../src/pages/sales-crm-service-pages.page.ts';

const servicePosition = { id: 'position-service', name: 'after_sales_operator', active: true, organization_id: 'org-a' };
const orderSeed = {
  id: 'order-1', organization_id: 'org-a', owner_id: 'dispatcher-1', responsible_id: 'dispatcher-1',
  status: 'pending_dispatch', engineer_id: null, engineer_name: null, revision: 1, updated_at: new Date().toISOString(),
};

function rowMatches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$gte' in expected && Date.parse(String(actual || '')) < Date.parse(String(expected.$gte))) return false;
      if ('$lt' in expected && Date.parse(String(actual || '')) >= Date.parse(String(expected.$lt))) return false;
      return true;
    }
    return actual === expected;
  });
}

function harness({ actor = 'dispatcher-1', organizationId = 'org-a', order = { ...orderSeed }, extraRows = {} } = {}) {
  const rows = {
    forge_service_order: [order],
    sys_position: [servicePosition],
    sys_user_position: [
      { user_id: 'engineer-1', position: servicePosition.name, organization_id: 'org-a', valid_from: null, valid_until: null },
      { user_id: 'expired-1', position: servicePosition.name, organization_id: 'org-a', valid_from: '2020-01-01T00:00:00Z', valid_until: '2021-01-01T00:00:00Z' },
      { user_id: 'other-role-1', position: 'sales_owner', organization_id: 'org-a', valid_from: null, valid_until: null },
      { user_id: 'other-org-1', position: servicePosition.name, organization_id: 'org-b', valid_from: null, valid_until: null },
      { user_id: 'banned-1', position: servicePosition.name, organization_id: 'org-a', valid_from: null, valid_until: null },
      { user_id: 'admin-1', position: servicePosition.name, organization_id: 'org-a', valid_from: null, valid_until: null },
    ],
    sys_member: [
      { user_id: 'engineer-1', organization_id: 'org-a', role: 'member' },
      { user_id: 'expired-1', organization_id: 'org-a', role: 'member' },
      { user_id: 'other-role-1', organization_id: 'org-a', role: 'member' },
      { user_id: 'other-org-1', organization_id: 'org-b', role: 'member' },
      { user_id: 'banned-1', organization_id: 'org-a', role: 'member' },
      { user_id: 'admin-1', organization_id: 'org-a', role: 'admin' },
    ],
    sys_user: [
      { id: 'engineer-1', name: '售后工程师甲', banned: false },
      { id: 'expired-1', name: '过期任职账号', banned: false },
      { id: 'other-role-1', name: '其他岗位账号', banned: false },
      { id: 'other-org-1', name: '其他组织账号', banned: false },
      { id: 'banned-1', name: '停用账号', banned: true },
      { id: 'admin-1', name: '组织管理员', banned: false },
    ],
    ...extraRows,
  };
  const writes = [];
  const calls = [];
  const object = name => ({
    find: async query => {
      calls.push({ name, method: 'find', query });
      const result = (rows[name] || []).filter(row => rowMatches(row, query.where || {}));
      return query.fields ? result.map(row => Object.fromEntries(query.fields.map(field => [field, row[field]]))) : result;
    },
    findOne: async query => {
      calls.push({ name, method: 'findOne', query });
      const row = (rows[name] || []).find(item => rowMatches(item, query.where || {}));
      return row || null;
    },
    update: async (patch, options = {}) => {
      writes.push({ name, patch: { ...patch } });
      const table = rows[name] || [];
      const where = options.where || { id: patch.id };
      const indexes = table.flatMap((row, index) => rowMatches(row, where) ? [index] : []);
      for (const index of (options.multi ? indexes : indexes.slice(0, 1))) table[index] = { ...table[index], ...patch };
      return indexes.length;
    },
  });
  const ctx = {
    recordId: order.id,
    record: order,
    recordLoadDenied: false,
    input: {},
    session: { userId: actor, organizationId },
    api: { object },
  };
  return { rows, writes, calls, ctx };
}

function execute(definition, ctx) {
  return new Function('ctx', `return (async () => { ${definition.body.source} })()`)(ctx);
}

test('candidate Action returns only active same-org ordinary members in the service position', async () => {
  const h = harness();
  const result = await execute(ServiceOrderDispatchEngineers, h.ctx);
  assert.deepEqual(result.engineers, [{ id: 'engineer-1', name: '售后工程师甲' }]);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(ServiceOrderDispatchEngineers.requiredPermissions, ['forge_service_manager']);
});

test('dispatch Action binds the selected user and transfers own-read ownership to that user', async () => {
  const h = harness();
  h.ctx.input = {
    engineer_id: 'engineer-1', engineer_name: '伪造姓名', scheduled_at: '2026-10-03', dispatch_note: '安排现场处理',
  };
  const result = await execute(ServiceOrderDispatch, h.ctx);
  const saved = h.rows.forge_service_order[0];
  assert.equal(result.engineer_id, 'engineer-1');
  assert.equal(result.engineer_name, '售后工程师甲');
  assert.equal(saved.status, 'pending_receive');
  assert.equal(saved.engineer_id, 'engineer-1');
  assert.equal(saved.engineer_name, '售后工程师甲');
  assert.equal(saved.owner_id, 'engineer-1');
  assert.equal(saved.responsible_id, 'engineer-1');
  assert.equal(saved.scheduled_at, '2026-10-03');
  assert.equal(saved.dispatch_note, '安排现场处理');
  assert.equal(h.writes.length, 1);
});

test('dispatch rejects a user without an effective service assignment before writing', async () => {
  const h = harness();
  h.ctx.input = { engineer_id: 'other-role-1', dispatch_note: '安排处理' };
  await assert.rejects(() => execute(ServiceOrderDispatch, h.ctx), /请选择当前组织中有效任职的售后工程师/);
  assert.equal(h.writes.length, 0);
});

test('supervisor capability can dispatch an in-org queue item created by another supervisor', async () => {
  const h = harness({ order: { ...orderSeed, owner_id: 'another-supervisor', responsible_id: 'another-supervisor' } });
  h.ctx.input = { engineer_id: 'engineer-1', dispatch_note: '主管接续处理待派工队列' };
  const result = await execute(ServiceOrderDispatch, h.ctx);
  assert.equal(result.status, 'pending_receive');
  assert.equal(h.rows.forge_service_order[0].owner_id, 'engineer-1');
  assert.deepEqual(ServiceOrderDispatch.requiredPermissions, ['forge_service_manager']);
});

test('only the assigned engineer can accept, and the assigned engineer can read back the accepted order', async () => {
  const assignedOrder = {
    ...orderSeed, owner_id: 'engineer-1', responsible_id: 'engineer-1', engineer_id: 'engineer-1',
    engineer_name: '售后工程师甲', status: 'pending_receive',
  };
  const h = harness({ order: assignedOrder, actor: 'other-role-1' });
  await assert.rejects(() => execute(ServiceOrderEngineerAccept, h.ctx), /只有当前指派的服务工程师可以接单/);
  assert.equal(h.writes.length, 0);

  h.ctx.session.userId = 'engineer-1';
  const result = await execute(ServiceOrderEngineerAccept, h.ctx);
  assert.equal(result.status, 'in_progress');
  assert.equal(h.rows.forge_service_order[0].status, 'in_progress');
  const readableAsAssignee = h.rows.forge_service_order.filter(row => row.owner_id === h.ctx.session.userId);
  assert.deepEqual(readableAsAssignee.map(row => row.id), ['order-1']);
  assert.equal(h.writes.length, 1);
});

test('service pages select account ids and remove the hard-coded dispatch target', () => {
  const page = readFileSync(new URL('../src/pages/sales-crm-service-pages.page.ts', import.meta.url), 'utf8');
  assert.match(page, /service_order_dispatch_engineers/);
  assert.match(page, /value=\{dialog\.engineer_id\|\|''\}/);
  assert.match(page, /engineer_id:dialog\.engineer_id/);
  assert.match(page, /x\.engineer_id===state\.currentUserId/);
  assert.match(page, /loadRelated\('forge_customer',rows\.map\(row=>row\.customer_id\)\)/);
  assert.match(page, /scheduled_at:row\.expected_visit_on\|\|''/);
  assert.doesNotMatch(page, /scheduled_at:'2026-09-15'/);
  assert.doesNotMatch(page, /售后工程师-苏州现场支持|SVC-ENG-SUZHOU-0913|派给苏州现场支持工程师处理/);
});

test('engineer page loads only references linked from visible service orders', () => {
  assert.match(ServiceOrdersPage.source, /service_order_manager_context/);
  assert.match(ServiceOrdersPage.source, /loadRelated\('forge_customer',rows\.map\(x=>x\.customer_id\)\)/);
  assert.match(ServiceOrdersPage.source, /loadRelated\('forge_sales_order',rows\.map\(x=>x\.sales_order_id\)\)/);
  assert.match(ServiceOrdersPage.source, /state\.canManage&&/);
  assert.match(ServiceDispatchPage.source, /当前账号无权访问此页面/);
  assert.match(ServiceWorkspacePage.source, /loadRelated\('forge_contact',rows\.map\(row=>row\.contact_id\)\)/);
});

test('dispatch and receiving page source parses after the role-based controls change', () => {
  for (const page of [ServiceDispatchPage, ServiceWorkspacePage, ServiceOrdersPage]) {
    const result = ts.transpileModule(page.source, {
      fileName: `${page.name}.tsx`,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
    });
    assert.deepEqual(result.diagnostics, [], `${page.name} contains invalid embedded JSX`);
  }
});
