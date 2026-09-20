import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
import { snapshotPath } from '../scripts/seed-reference-data.mjs';

const fixture = JSON.parse(await readFile(snapshotPath, 'utf8'));
const registry = JSON.parse(await readFile('.objectstack/acceptance/reference-data.json', 'utf8'));
const api = await connect();
const ids = { operator: api.userId, ...Object.fromEntries(registry.results.map(r => [r.key, r.id])) };
const cases = [];
async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
const records = new Map();
await test('same-input readback: all 30 records, values and references', async () => {
  let fieldCount = 0;
  for (const entry of fixture.records) {
    const result = await api.request(`/data/${entry.object}/${ids[entry.key]}`);
    assert.equal(result.status, 200, `${entry.key} must exist`);
    const record = result.value.record;
    assert.ok(record, `No record envelope: ${entry.key}`);
    records.set(entry.key, record);
    for (const [field, value] of Object.entries(entry.data)) {
      const expected = value && typeof value === 'object' && '$ref' in value ? ids[value.$ref] : value;
      assert.deepEqual(record[field], expected, `${entry.key}.${field}`);
      fieldCount++;
    }
  }
  cases.push({ name: 'readback coverage', status: 'info', records: fixture.records.length, fields: fieldCount });
});
await test('BOM retains root, four SKU references and PSU quantity 2', async () => {
  const root = records.get('bom_root');
  assert.equal(root.bom_id, ids.bom);
  assert.equal(root.parent_id, null);
  for (const [key, qty] of [['plc', 1], ['hmi', 1], ['psu', 2], ['cab', 1]]) {
    const node = records.get(`bom_${key}`);
    assert.equal(node.parent_id, ids.bom_root);
    assert.equal(node.bom_id, ids.bom);
    assert.equal(node.sku_id, ids[`${key}_sku`]);
    assert.equal(node.quantity, qty);
  }
});
await test('server rejects empty required BOM node name', async () => {
  const result = await api.request('/data/forge_bom_node', 'POST', { name: '', bom_id: ids.bom, quantity: 1 });
  assert.equal(result.status, 400);
  assert.ok(result.value.fields.some(f => f.field === 'name'));
});
await test('server rejects missing linked BOM', async () => {
  const result = await api.request('/data/forge_bom_node', 'POST', { name: 'Reference rejection', bom_id: 'missing_bom', quantity: 1 });
  assert.equal(result.status, 400);
  assert.ok(result.value.fields.some(f => f.field === 'bom_id' && f.code === 'reference_not_found'));
});
await test('server rejects duplicate material code', async () => {
  const result = await api.request('/data/forge_material', 'POST', { name: 'Duplicate rejection', code: 'FG-RM-CAB-800', model: 'duplicate', category_id: ids.material_category, unit_id: ids.unit_tai });
  assert.ok([400, 409].includes(result.status), JSON.stringify(result));
});
await test('server rejects unknown material state', async () => {
  const result = await api.request(`/data/forge_material/${ids.fg}`, 'PATCH', { status: 'invented_state' });
  assert.equal(result.status, 400);
  const after = await api.request(`/data/forge_material/${ids.fg}`);
  assert.equal(after.value.record.status, 'active');
});
await test('anonymous customer read and write are rejected', async () => {
  assert.equal((await api.request('/data/forge_customer', 'GET', undefined, false)).status, 401);
  assert.equal((await api.request('/data/forge_customer', 'POST', { name: 'Unauthorized' }, false)).status, 401);
});
await test('four-decimal price survives write/read without changing fixture', async () => {
  const before = records.get('plc_sku').cost_price;
  try {
    const saved = await api.request(`/data/forge_material_sku/${ids.plc_sku}`, 'PATCH', { cost_price: 6800.1234 });
    assert.equal(saved.status, 200, JSON.stringify(saved));
    const after = await api.request(`/data/forge_material_sku/${ids.plc_sku}`);
    assert.equal(after.value.record.cost_price, 6800.1234);
  } finally {
    const restored = await api.request(`/data/forge_material_sku/${ids.plc_sku}`, 'PATCH', { cost_price: before });
    assert.equal(restored.status, 200, 'fixture price must be restored');
  }
});
await mkdir('.objectstack/acceptance', { recursive: true });
const report = { recordedAt: new Date().toISOString(), fixtureId: fixture.fixtureId, snapshotVersion: fixture.snapshotVersion, kind: 'local-foundation-api-acceptance', cases, passed: cases.every(c => c.status !== 'failed'), limitations: fixture.limitations };
await writeFile('.objectstack/acceptance/master-data-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
