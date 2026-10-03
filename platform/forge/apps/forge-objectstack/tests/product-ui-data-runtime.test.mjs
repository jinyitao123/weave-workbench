import assert from 'node:assert/strict';
import test from 'node:test';
import { forgeProductUiRuntime } from '../src/pages/product-ui.ts';

function readAllWith(request) {
  const begin = forgeProductUiRuntime.indexOf('async function ForgeReadAllRecords(');
  const end = forgeProductUiRuntime.indexOf('async function ForgeOrganizationBusinessDate(', begin);
  return new Function('ForgeApiRequest', forgeProductUiRuntime.slice(begin, end) + ';return ForgeReadAllRecords;')(request);
}

test('reference options survive native page-size clamping and retain the server filter', async () => {
  const rows = Array.from({ length: 105 }, (_, index) => ({ id: `local-${index}`, name: `选项${index}` }));
  const offsets = [];
  const readAll = readAllWith(async (_adapter, path) => {
    const query = new URL(path, 'http://localhost').searchParams;
    assert.deepEqual(JSON.parse(query.get('$filter')), { customer_id: 'test-customer' });
    assert.equal(query.get('$orderby'), 'id asc');
    assert.equal(query.get('$select'), 'id,name');
    const skip = Number(query.get('$skip'));
    offsets.push(skip);
    return { records: rows.slice(skip, skip + 50), totalCount: rows.length };
  });
  assert.deepEqual(await readAll({}, 'forge_contact', { fields: 'id,name', filter: { customer_id: 'test-customer' } }), rows);
  assert.deepEqual(offsets, [0, 50, 100]);
});

test('incomplete or repeated pages fail instead of silently truncating selector options', async () => {
  let requests = 0;
  const incomplete = readAllWith(async () => ({ records: requests++ === 0 ? [{ id: 'one' }] : [], totalCount: 2 }));
  await assert.rejects(incomplete({}, 'forge_contact', { label: '联系人' }), /联系人未读取完整/);
  const repeated = readAllWith(async () => ({ records: [{ id: 'one' }], totalCount: 2 }));
  await assert.rejects(repeated({}, 'forge_contact'), /分页期间发生变化/);
});

test('empty results are valid and an explicit read ceiling never masquerades as the whole list', async () => {
  assert.deepEqual(await readAllWith(async () => ({ data: { records: [], totalCount: 0 } }))({}, 'forge_contact'), []);
  await assert.rejects(readAllWith(async () => ({ records: [], totalCount: 201 }))({}, 'forge_contact', { limit: 200 }), /超过可读取上限/);
});

test('a clamped page without a count continues until the actual end', async () => {
  const rows = Array.from({ length: 105 }, (_, index) => ({ id: `clamped-${index}` }));
  const offsets = [];
  const readAll = readAllWith(async (_adapter, path) => {
    const skip = Number(new URL(path, 'http://localhost').searchParams.get('$skip'));
    offsets.push(skip);
    return { records: rows.slice(skip, skip + 50) };
  });
  assert.deepEqual(await readAll({}, 'forge_contact'), rows);
  assert.deepEqual(offsets, [0, 50, 100, 105]);
});

test('native HTTP refusal retains status so an unavailable reference does not hide the main work list', async () => {
  const begin = forgeProductUiRuntime.indexOf('async function ForgeApiRequest(');
  const end = forgeProductUiRuntime.indexOf('async function ForgeReadAllRecords(', begin);
  const request = new Function(forgeProductUiRuntime.slice(begin, end) + ';return ForgeApiRequest;')();
  await assert.rejects(request({ fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: '当前账号不可读取' }) }) }, '/data/forge_project'),
    error => error.status === 403 && error.message === '当前账号不可读取');
});

test('full Console links use the basename-aware host bridge once and preserve opaque query values', () => {
  const begin = forgeProductUiRuntime.indexOf('function ForgeNavigate(');
  const end = forgeProductUiRuntime.indexOf('async function ForgeApiResponse(', begin);
  const calls = [];
  const location = { href: 'http://localhost:4635/_console/apps/project/center', origin: 'http://localhost:4635' };
  const navigate = new Function('location', 'navigate', 'window', forgeProductUiRuntime.slice(begin, end) + ';return ForgeNavigate;')(location, (...args) => calls.push(args), {});
  navigate('/_console/apps/project/member?project=local&return=%2F_console%2Fapps%2Fproject#details', { replace: true });
  assert.deepEqual(calls, [['/apps/project/member?project=local&return=%2F_console%2Fapps%2Fproject#details', { replace: true }]]);
  assert.throws(() => navigate('javascript:alert(1)'), /当前应用/);
  assert.throws(() => navigate('https://other.example/'), /当前应用/);
  assert.equal(calls.length, 1);
});
