import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { forgeProductUiRuntime } from '../src/pages/product-ui.ts';

const source = readFileSync(new URL('../src/pages/finance-management.page.ts', import.meta.url), 'utf8');
const policy = source.match(/const financeReadStateRuntime = String.raw`([\s\S]*?)`;/)[1];
const readers = source.slice(source.indexOf('async function request('), source.indexOf('React.useEffect(()=>{load()},[]);'));

const sharedReaders = forgeProductUiRuntime.slice(forgeProductUiRuntime.indexOf('async function ForgeApiRequest('), forgeProductUiRuntime.indexOf('async function ForgeOrganizationBusinessContext('));

async function loadPage(replies, object = 'forge_fund_account', related = ['sys_user']) {
  let state = { loading: false, rows: [{ id: 'old-record', current_balance: 100 }], related: { sys_user: [{ id: 'old-user' }] } };
  const calls = [];
  const context = vm.createContext({
    URLSearchParams,
    DEF: { object, related },
    adapter: { baseUrl: 'https://finance.example/', getAuthHeaders: () => ({ Authorization: 'Bearer test-session' }), fetchImpl: async (url, options) => {
      const parsed = new URL(url), name = parsed.pathname.split('/data/')[1];
      const skip = Number(parsed.searchParams.get('$skip') || 0), top = Number(parsed.searchParams.get('$top') || 100);
      calls.push({ url, options, name, skip });
      const reply = typeof replies[name] === 'function' ? replies[name](skip) : replies[name];
      if (reply instanceof Error) throw reply;
      const status = reply.status ?? 200;
      return { ok: status < 400, status, json: async () => reply.body ?? { records: (reply.records ?? []).slice(skip, skip + Math.min(top, 50)), totalCount: (reply.records ?? []).length } };
    } },
    setState: next => { state = typeof next === 'function' ? next(state) : next; },
  });
  vm.runInContext(`${sharedReaders}\n${policy}\n${readers}`, context);
  await vm.runInContext('load()', context);
  return { state: JSON.parse(JSON.stringify(state)), calls, label: (row, id) => context.financeRecordLabel(row, id) };
}

test('primary forbidden, server and network failures never become a successful empty ledger', async () => {
  for (const reply of [{ status: 403 }, { status: 500, body: { message: '账本服务不可用' } }, new Error('连接失败')]) {
    const { state } = await loadPage({ forge_fund_account: reply, sys_user: { records: [] } });
    assert.ok(state.error);
    assert.equal(state.loading, false);
    assert.deepEqual(state.rows, []);
    assert.deepEqual(state.related, {});
  }
});

test('auxiliary forbidden preserves authorized primary records with an explicit warning', async () => {
  const { state, label } = await loadPage({ forge_fund_account: { records: [{ id: 'account', name: '现金' }] }, sys_user: { status: 403 } });
  assert.equal(state.rows[0].name, '现金');
  assert.equal(state.error, '');
  assert.match(state.warning, /无权查看/);
  assert.equal(label(undefined, 'c0d809bd-0f2d-43bd-beca-c8a24a44ecde'), '关联信息不可用');
});

test('auxiliary network failure is reported and a subsequent successful reload clears the warning', async () => {
  const replies = { forge_fund_account: { records: [{ id: 'account' }] }, sys_user: new Error('连接失败') };
  const failed = await loadPage(replies);
  assert.match(failed.state.warning, /加载失败/);
  replies.sys_user = { records: [{ id: 'user', name: '财务人员' }] };
  const recovered = await loadPage(replies);
  assert.equal(recovered.state.warning, '');
  assert.equal(recovered.state.related.sys_user[0].name, '财务人员');
});

test('unauthorized response on either primary or auxiliary clears stale records', async () => {
  for (const failed of ['forge_fund_account', 'sys_user']) {
    const { state } = await loadPage({ forge_fund_account: { records: [{ id: 'account' }] }, sys_user: { records: [] }, [failed]: { status: 401 } });
    assert.match(state.error, /重新登录/);
    assert.deepEqual(state.rows, []);
    assert.deepEqual(state.related, {});
    assert.equal(state.warning, '');
  }
});

test('missing related financial ledger blocks fabricated balances rather than becoming a lookup warning', async () => {
  const { state } = await loadPage({ forge_accounts_receivable: { records: [{ id: 'receivable', outstanding_amount: 123 }] }, forge_accounts_payable: { status: 403 } }, 'forge_accounts_receivable', ['forge_accounts_payable']);
  assert.ok(state.error);
  assert.deepEqual(state.rows, []);
});

test('genuine empty data succeeds; names and readable order codes remain available', async () => {
  const { state, label } = await loadPage({ forge_fund_account: { records: [] }, sys_user: { records: [] } });
  assert.equal(state.error, '');
  assert.equal(state.warning, '');
  assert.equal(label({ name: '销售订单', code: 'SO-0001' }, 'internal-id'), '销售订单');
  assert.equal(label({ code: 'SO-0001' }, 'internal-id'), 'SO-0001');
  assert.equal(label(undefined, undefined), '—');
});


test('authenticated full-page reads retain financial and reference records beyond 500 under server page clamping', async () => {
  const accounts = Array.from({ length: 601 }, (_, index) => ({ id: `account-${index}`, current_balance: index, account_manager: 'user-550' }));
  const users = Array.from({ length: 553 }, (_, index) => ({ id: `user-${index}`, name: `财务人员${index}` }));
  const { state, calls, label } = await loadPage({ forge_fund_account: { records: accounts }, sys_user: { records: users } });
  assert.equal(state.error, '');
  assert.equal(state.warning, '');
  assert.deepEqual(state.rows, accounts);
  assert.deepEqual(state.related.sys_user, users);
  assert.equal(state.rows.reduce((sum, row) => sum + row.current_balance, 0), 180300);
  assert.equal(label(state.related.sys_user.find(row => row.id === state.rows.at(-1).account_manager)), '财务人员550');
  assert.deepEqual(calls.filter(call => call.name === 'forge_fund_account').map(call => call.skip), Array.from({ length: 13 }, (_, index) => index * 50));
  for (const { url, options } of calls) {
    assert.equal(new URL(url).origin, 'https://finance.example');
    assert.equal(options.headers.Authorization, 'Bearer test-session');
    assert.equal(options.credentials, 'include');
  }
});

test('failure after an initial page never publishes a partial ledger and late session expiry clears all data', async () => {
  const records = Array.from({ length: 101 }, (_, index) => ({ id: `record-${index}` }));
  for (const [failed, status] of [['forge_fund_account', 500], ['sys_user', 401]]) {
    const replies = { forge_fund_account: { records }, sys_user: { records } };
    replies[failed] = skip => skip === 0 ? { records } : { status };
    const { state, calls } = await loadPage(replies);
    assert.ok(calls.some(call => call.name === failed && call.skip === 50));
    assert.ok(state.error);
    if (status === 401) assert.match(state.error, /重新登录/);
    assert.deepEqual(state.rows, []);
    assert.deepEqual(state.related, {});
    assert.equal(state.warning, '');
  }
});
