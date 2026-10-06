import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { RestServer } from '@objectstack/rest';

const schema = {
  name: 'forge_export_probe', label: '导出验证',
  fields: {
    name: { type: 'text', label: '名称' },
    amount: { type: 'currency', label: '金额' },
    protected_value: { type: 'text', label: '受保护字段' },
  },
};
const record = { id: 'internal-record-id', name: '授权记录', amount: 12.34, protected_value: 'hidden-value' };

function exportHarness(security) {
  const reads = [];
  const server = { get() {}, post() {}, put() {}, delete() {}, patch() {}, use() {} };
  const protocol = {
    async getDiscovery() { return { version: 'v0', routes: { data: '/data', metadata: '', ui: '', auth: '/auth' } }; },
    async getMetaTypes() { return []; },
    async getMetaItems() { return { items: [schema] }; },
    async getMetaItem() { return schema; },
    async getObjectSchema() { return schema; },
    async findData(input) { reads.push(input); return { records: [record] }; },
  };
  const rest = new RestServer(server, protocol, { api: { requireAuth: false } });
  rest.resolveExecCtx = async () => ({ userId: 'authorized-employee', tenantId: 'test-organization' });
  rest.resolveSecurityService = async () => security;
  rest.registerRoutes();
  const route = rest.getRoutes().find(entry => entry.method === 'GET' && entry.path === '/api/v1/data/:object/export');
  assert.ok(route);
  return {
    reads,
    async export(format, fields) {
      const chunks = [];
      const response = {
        statusCode: 200, headers: {},
        status(code) { this.statusCode = code; return this; },
        header(name, value) { this.headers[name] = value; return this; },
        json(body) { this.body = body; return this; },
        write(chunk) { chunks.push(Buffer.from(chunk)); },
        end() { this.ended = true; },
      };
      await route.handler({ method: 'GET', path: '/api/v1/data/forge_export_probe/export', params: { object: schema.name },
        query: { format, limit: '1', ...(fields ? { fields } : {}) }, headers: {} }, response);
      return { ...response, bytes: Buffer.concat(chunks) };
    },
  };
}

test('all export formats fail closed before data reads when readable-field authorization is absent or broken', async () => {
  for (const security of [undefined, {}, { canExport: async () => true, getReadableFields: async () => null },
    { canExport: async () => true, getReadableFields: async () => { throw new Error('authorization unavailable'); } }]) {
    for (const format of ['csv', 'json', 'xlsx']) {
      const harness = exportHarness(security);
      const result = await harness.export(format, 'name');
      assert.equal(result.statusCode, 503);
      assert.equal(result.body.code, 'FIELD_PERMISSION_UNAVAILABLE');
      assert.equal(harness.reads.length, 0);
      assert.equal(result.bytes.length, 0);
    }
  }
});

test('export permission and id-only field selections are refused before data reads', async () => {
  for (const format of ['csv', 'json', 'xlsx']) {
    const denied = exportHarness({ canExport: async () => false, getReadableFields: async () => ['name'] });
    assert.equal((await denied.export(format, 'name')).body.code, 'EXPORT_NOT_PERMITTED');
    assert.equal(denied.reads.length, 0);
    const fields = exportHarness({ canExport: async () => true, getReadableFields: async () => ['id', 'name', 'amount'] });
    assert.equal((await fields.export(format, 'id,protected_value')).body.code, 'FIELD_READ_DENIED');
    assert.equal(fields.reads.length, 0);
  }
});

test('CSV, JSON and actual XLSX cells retain only the readable business-field intersection', async () => {
  const security = { canExport: async () => true, getReadableFields: async () => ['id', 'name', 'amount'] };
  const csv = await exportHarness(security).export('csv', 'id,name,protected_value,amount');
  assert.equal(csv.statusCode, 200);
  assert.match(csv.bytes.toString(), /名称/);
  assert.match(csv.bytes.toString(), /授权记录/);
  assert.doesNotMatch(csv.bytes.toString(), /internal-record-id|hidden-value|受保护字段/);
  const json = await exportHarness(security).export('json');
  assert.deepEqual(JSON.parse(json.bytes.toString()), [{ name: record.name, amount: record.amount }]);
  const xlsx = await exportHarness(security).export('xlsx', 'id,name,protected_value,amount');
  assert.equal(xlsx.statusCode, 200);
  const require = createRequire(import.meta.url);
  const restRequire = createRequire(require.resolve('@objectstack/rest'));
  const ExcelJS = restRequire('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsx.bytes);
  const sheet = workbook.worksheets[0];
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['名称', '金额']);
  assert.deepEqual(sheet.getRow(2).values.slice(1), ['授权记录', 12.34]);
});
