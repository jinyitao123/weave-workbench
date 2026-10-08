import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/pages/finance-management.page.ts', import.meta.url), 'utf8');
const policy = source.match(/const financeReadStateRuntime = String.raw`([\s\S]*?)`;/)[1];
const readers = source.slice(source.indexOf('async function request('), source.indexOf('React.useEffect(()=>{load()},[]);'));

async function loadPage(replies, object = 'forge_fund_account', related = ['sys_user']) {
  let state = { loading: false, rows: [{ id: 'old-record', current_balance: 100 }], related: { sys_user: [{ id: 'old-user' }] } };
  const context = vm.createContext({
    DEF: { object, related },
    adapter: { fetchImpl: async url => {
      const name = url.split('/data/')[1].split('?')[0];
      const reply = replies[name];
      if (reply instanceof Error) throw reply;
      const status = reply.status ?? 200;
      return { ok: status < 400, status, json: async () => reply.body ?? { records: reply.records ?? [] } };
    } },
    setState: next => { state = typeof next === 'function' ? next(state) : next; },
  });
  vm.runInContext(`${policy}\n${readers}`, context);
  await vm.runInContext('load()', context);
  return { state: JSON.parse(JSON.stringify(state)), label: (row, id) => context.financeRecordLabel(row, id) };
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
