import assert from 'node:assert/strict';
import test from 'node:test';
import { ApprovalWorkListPlugin, decodeCursor, encodeCursor, latestOpenReturn } from '../src/plugins/approval-work-list.plugin.ts';

// Decision 002 / C22: Forge pages the employee's own approval work so the
// desktop no longer caps at 50 items or reads each return comment itself.
function row(id, status, extra = {}) {
  return {
    id, status, process_name: 'sales_contract_approval', process_label: '销售合同审批', step_label: '交付复核',
    record_title: `合同${id}`, updated_at: `2026-10-01T08:${String(id.length).padStart(2, '0')}:00.000Z`, ...extra,
  };
}

function harness({ pending = [], returned = [], actions = {} } = {}) {
  const routes = new Map();
  const calls = [];
  const approvals = {
    async listRequests(filter, context) {
      calls.push({ filter, user: context.userId });
      const source = filter.status === 'pending' ? pending : returned;
      return source.slice(filter.offset ?? 0, (filter.offset ?? 0) + filter.limit);
    },
    async listActions(id) { return actions[id] ?? []; },
  };
  let ready;
  const ctx = {
    hook(name, callback) { if (name === 'kernel:ready') ready = callback; },
    getService(name) {
      const services = {
        'http.server': { get(path, handler) { routes.set(path, handler); } },
        approvals,
        auth: { api: { async getSession({ headers }) {
          return headers.get('authorization') === 'Bearer employee' ? { user: { id: 'employee-a' }, session: { activeOrganizationId: 'org-a' } } : null;
        } } },
      };
      if (!(name in services)) throw new Error(`missing service ${name}`);
      return services[name];
    },
    logger: { error() {} },
  };
  new ApprovalWorkListPlugin().init(ctx);
  ready();
  return {
    calls,
    async get(query = {}, token = 'employee') {
      let status = 200;
      let body;
      await routes.get('/api/v1/workbench/approvals')({ query, headers: token ? { authorization: `Bearer ${token}` } : {} }, {
        header() { return this; }, status(code) { status = code; return this; }, json(value) { body = value; return this; },
      });
      return { status, body };
    },
  };
}

const actor = { viewer: { can_act: true, is_submitter: false } };
const submitter = { viewer: { can_act: false, is_submitter: true } };

test('pages pending then returned items with return comments and no raw identifiers in titles', async () => {
  const h = harness({
    pending: [row('p1', 'pending', actor), row('p2', 'pending', actor), row('p3', 'pending', { viewer: { can_act: false } })],
    returned: [row('r1', 'returned', submitter), row('r2', 'returned', submitter)],
    actions: {
      r1: [{ action: 'submit' }, { action: 'revise', comment: '请补充付款条款' }],
      r2: [{ action: 'revise', comment: '旧意见' }, { action: 'resubmit' }],
    },
  });
  const first = await h.get({ limit: '2' });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.items.map((item) => [item.requestId, item.mode]), [['p1', 'approval'], ['p2', 'approval']]);
  assert.equal(first.body.items[0].title, '合同p1 · 交付复核');
  assert.ok(first.body.nextCursor, 'more items remain');

  const second = await h.get({ limit: '2', cursor: first.body.nextCursor });
  assert.deepEqual(second.body.items.map((item) => [item.requestId, item.mode, item.returnReason]), [['r1', 'revision', '请补充付款条款']],
    'pending items the employee cannot act on and resubmitted returns are skipped');
  assert.equal(second.body.items[0].title, '合同r1需要修改');
  assert.equal(second.body.nextCursor, undefined, 'the list is complete');
  assert.ok(h.calls.every((call) => call.user === 'employee-a'), 'native reads use the caller identity');
});

test('machine process names are never shown as titles', async () => {
  const h = harness({ pending: [row('p1', 'pending', { ...actor, process_label: undefined, step_label: undefined, record_title: undefined })] });
  const result = await h.get();
  assert.equal(result.body.items[0].title, '业务审批');
});

test('rejects unauthenticated callers, bad cursors and bad limits', async () => {
  const h = harness();
  assert.equal((await h.get({}, null)).status, 401);
  assert.equal((await h.get({ cursor: 'not-a-cursor' })).status, 400);
  assert.equal((await h.get({ limit: '0' })).status, 400);
  assert.equal((await h.get({ limit: '101' })).status, 400);
});

test('cursor and return helpers are strict', () => {
  assert.deepEqual(decodeCursor(encodeCursor({ phase: 'returned', offset: 7 })), { phase: 'returned', offset: 7 });
  assert.equal(decodeCursor(encodeCursor({ phase: 'other', offset: 1 })), null);
  assert.equal(latestOpenReturn([{ action: 'revise' }, { action: 'resubmit' }]), undefined);
  assert.equal(latestOpenReturn([{ action: 'resubmit' }, { action: 'revise', comment: 'x' }])?.comment, 'x');
});
