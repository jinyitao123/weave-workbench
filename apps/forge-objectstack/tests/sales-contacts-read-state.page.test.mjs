import assert from 'node:assert/strict';
import test from 'node:test';
import { SalesContactsPage } from '../src/pages/sales-contacts.page.ts';
import { createServicePageHarness, serviceNodes, serviceText } from './service-page-react-harness.mjs';

const records = {
  forge_contact: [{ id: 'contact-a', name: '可读联系人', customer_id: 'customer-a', responsible_id: 'actor-a', employment_status: 'active' }],
  forge_contact_channel: [{ id: 'channel-a', contact_id: 'contact-a', value: '01000000001', channel_type: 'telephone' }],
  forge_customer: [{ id: 'customer-a', name: '可读客户' }],
  sys_user: [{ id: 'actor-a', name: '维护员工' }],
};
function response(value, status = 200) {
  return { ok: status < 400, status, headers: new Headers(), json: async () => value };
}
function fixture(failures = {}, sourceRecords = records) {
  return createServicePageHarness(SalesContactsPage, {
    transport: async (url, options = {}) => {
      assert.equal(options.method || 'GET', 'GET', 'read-state testing cannot write business data');
      const parsed = new URL(url), object = parsed.pathname.split('/').at(-1);
      if (failures[object]) return response({ error: { message: 'backend message' } }, failures[object]);
      const all = sourceRecords[object] || [], skip = Number(parsed.searchParams.get('$skip') || 0), top = Number(parsed.searchParams.get('$top') || 100);
      return response({ records: all.slice(skip, skip + top), totalCount: all.length });
    },
  });
}

test('contact-channel denial keeps confirmed contacts and identifies the unavailable field', async () => {
  const h = fixture({ forge_contact_channel: 403 }); const tree = await h.flushEffects();
  const text = serviceText(tree);
  assert.ok(text.includes('可读联系人'));
  assert.ok(text.includes('当前账号无权读取联系方式'));
  assert.ok(text.includes('不可读取'));
  assert.equal(text.includes('01000000001'), false);
  const edit = serviceNodes(tree, n => n.type === 'button' && serviceText(n) === '编辑')[0];
  assert.equal(edit.props.disabled, true, 'incomplete channels cannot be used as an empty edit baseline');
});

test('primary-contact denial never shows empty contacts or zero metrics', async () => {
  const h = fixture({ forge_contact: 403 }); const tree = await h.flushEffects();
  const text = serviceText(tree);
  assert.ok(text.includes('当前账号无权读取联系人'));
  assert.equal(text.includes('联系人总数'), false);
  assert.equal(serviceNodes(tree, n => n.type === 'ForgeEmpty').length, 0);
  assert.equal(serviceNodes(tree, n => n.type === 'button' && serviceText(n).includes('新增联系人')).length, 0);
});

test('an expired read session does not leave a partial list pretending to be current', async () => {
  const h = fixture({ forge_contact_channel: 401 }); const tree = await h.flushEffects();
  assert.ok(serviceText(tree).includes('登录状态已失效'));
  assert.equal(serviceText(tree).includes('联系人总数'), false);
});

test('channel service failure remains different from a successfully empty channel list', async () => {
  const failed = fixture({ forge_contact_channel: 503 }); const failedTree = await failed.flushEffects();
  assert.ok(serviceText(failedTree).includes('联系方式读取失败'));
  assert.ok(serviceText(failedTree).includes('不可读取'));
  const empty = fixture({}, { ...records, forge_contact_channel: [] }); const emptyTree = await empty.flushEffects();
  assert.equal(serviceText(emptyTree).includes('不可读取'), false);
  assert.equal(serviceNodes(emptyTree, n => n.type === 'ForgeNotice' && n.props.tone === 'error').length, 0);
  assert.equal(serviceNodes(emptyTree, n => n.type === 'button' && serviceText(n) === '编辑')[0].props.disabled, false);
});

test('contact totals are based on a complete server read beyond the former first 500 rows', async () => {
  const contacts = Array.from({ length: 601 }, (_, i) => ({ ...records.forge_contact[0], id: 'contact-' + i, name: '分页联系人' + i }));
  const h = fixture({}, { ...records, forge_contact: contacts }); const tree = await h.flushEffects();
  assert.equal(h.states[0].contacts.length, 601);
  assert.equal(h.calls.filter(call => call.path === '/data/forge_contact').length, 7);
  assert.ok(serviceText(tree).includes('601'));
});

test('an incomplete primary read cannot produce partial totals', async () => {
  const h = createServicePageHarness(SalesContactsPage, {
    transport: async url => {
      const parsed = new URL(url), object = parsed.pathname.split('/').at(-1);
      if (object === 'forge_contact') {
        return response({ records: parsed.searchParams.get('$skip') === '0' ? records.forge_contact : [], totalCount: 2 });
      }
      return response({ records: records[object] || [], totalCount: (records[object] || []).length });
    },
  });
  const tree = await h.flushEffects();
  assert.ok(serviceText(tree).includes('结果不完整'));
  assert.equal(serviceText(tree).includes('联系人总数'), false);
});
