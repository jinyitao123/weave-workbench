import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4489';
const api = await connect(endpoint);
const cases = [];
const ids = {};

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const result = await api.request(`/data/${object}?${query}`);
  assert.equal(result.status, 200, `${object}: ${JSON.stringify(result.value)}`);
  return (result.value.records || []).filter(record => Object.entries(where).every(([key, value]) => record[key] === value));
}
async function create(object, body) {
  const result = await api.request(`/data/${object}`, 'POST', body);
  assert.equal(result.status, 201, `${object}: ${JSON.stringify(result.value)}`);
  return result.value.id || result.value.record?.id;
}
async function read(object, id) {
  const result = await api.request(`/data/${object}/${id}`);
  assert.equal(result.status, 200, `${object}: ${JSON.stringify(result.value)}`);
  return result.value.record;
}
const invoke = (action, id, params = {}, authenticated = true) => api.request(`/actions/forge_supplier_price_book/${action}/${id}`, 'POST', { params }, authenticated);

async function ensure(object, where, body) {
  const [record] = await find(object, where);
  if (record) return record;
  const id = await create(object, body);
  return read(object, id);
}
const supplierCategory = await ensure('forge_supplier_category', { code: 'PB-SUP-CAT-001' }, { name: '价格本供应商分类', code: 'PB-SUP-CAT-001', status: 'active' });
const supplierLevel = await ensure('forge_supplier_level', { code: 'PB-SUP-LEVEL-001' }, { name: '价格本供应商等级', code: 'PB-SUP-LEVEL-001', status: 'active' });
const supplier = await ensure('forge_supplier', { code: 'PB-SUP-001' }, {
  name: '价格本验收供应商', code: 'PB-SUP-001', category_id: supplierCategory.id, level_id: supplierLevel.id,
  responsible_id: api.userId, contact_name: '采购报价窗口', phone: '13800000001', status: 'active', approval_status: 'approved',
});
const unit = await ensure('forge_unit', { code: 'PB-UNIT-001' }, { name: '件', code: 'PB-UNIT-001', status: 'active' });
const materialCategory = await ensure('forge_material_category', { code: 'PB-MAT-CAT-001' }, { name: '价格本物料分类', code: 'PB-MAT-CAT-001', status: 'active' });
const material = await ensure('forge_material', { code: 'PB-MAT-PLC-001' }, {
  name: 'PLC CPU 1215C', code: 'PB-MAT-PLC-001', model: 'CPU 1215C', category_id: materialCategory.id,
  unit_id: unit.id, property: 'raw_material', source_type: 'purchased', status: 'active', supplier_id: supplier.id, responsible_id: api.userId,
});
const sku = await ensure('forge_material_sku', { code: 'PB-SKU-PLC-001' }, {
  name: '14DI/10DO/2AI', code: 'PB-SKU-PLC-001', material_id: material.id, cost_price: 85.5, enabled: true,
});
Object.assign(ids, { supplier: supplier.id, sku: sku.id });

for (const code of ['PB-ACC-ACTIVE-001', 'PB-ACC-VOID-001', 'PB-ACC-EMPTY-001']) {
  for (const book of await find('forge_supplier_price_book', { code })) {
    for (const row of await find('forge_supplier_price_book_status_log', { price_book_id: book.id })) await api.request(`/data/forge_supplier_price_book_status_log/${row.id}`, 'DELETE');
    for (const row of await find('forge_supplier_price_book_batch_task', { price_book_id: book.id })) await api.request(`/data/forge_supplier_price_book_batch_task/${row.id}`, 'DELETE');
    for (const row of await find('forge_supplier_price_book_line', { price_book_id: book.id })) await api.request(`/data/forge_supplier_price_book_line/${row.id}`, 'DELETE');
    await api.request(`/data/forge_supplier_price_book/${book.id}`, 'DELETE');
  }
}

await test('empty price book cannot be activated', async () => {
  ids.empty = await create('forge_supplier_price_book', {
    name: '空价格本阻断验收', code: 'PB-ACC-EMPTY-001', supplier_id: supplier.id,
    currency: 'cny', valid_from: '2026-09-16', valid_to: '2026-12-31', status: 'draft',
  });
  const response = await invoke('supplier_price_book_activate', ids.empty);
  assert.equal(response.status, 400, JSON.stringify(response.value));
  assert.match(response.value.error.message, /至少需要一条物料价格/);
});

await test('two-level discount price line activates with source and audit log', async () => {
  ids.active = await create('forge_supplier_price_book', {
    name: 'PLC 供应商协议价', code: 'PB-ACC-ACTIVE-001', supplier_id: supplier.id,
    currency: 'cny', valid_from: '2026-09-16', valid_to: '2026-12-31',
    discount_level1: 10, discount_level2: 5, status: 'draft', line_count: 0,
  });
  ids.activeLine = await create('forge_supplier_price_book_line', {
    name: 'PLC CPU 1215C', price_book_id: ids.active, sku_id: sku.id, item_code: 'PLC-1215C',
    model: 'CPU 1215C', specification: '14DI/10DO/2AI', unit_name: '件', catalog_price: 100,
    discount_level1: 10, discount_level2: 5, net_price: 85.5, minimum_quantity: 1,
    valid_from: '2026-09-16', valid_to: '2026-12-31',
  });
  const response = await invoke('supplier_price_book_activate', ids.active);
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const book = await read('forge_supplier_price_book', ids.active);
  assert.deepEqual({ status: book.status, line_count: Number(book.line_count), supplier_id: book.supplier_id }, { status: 'active', line_count: 1, supplier_id: supplier.id });
  const [line] = await find('forge_supplier_price_book_line', { price_book_id: ids.active });
  assert.equal(Number(line.net_price), 85.5);
  const [log] = await find('forge_supplier_price_book_status_log', { price_book_id: ids.active });
  assert.deepEqual({ action: log.action, from: log.from_status, to: log.to_status }, { action: 'activated', from: 'draft', to: 'active' });
});

await test('void action requires a reason and persists status history', async () => {
  ids.void = await create('forge_supplier_price_book', {
    name: '待废弃协议价', code: 'PB-ACC-VOID-001', supplier_id: supplier.id,
    currency: 'cny', discount_level1: 0, discount_level2: 0, status: 'draft',
  });
  const blocked = await invoke('supplier_price_book_void', ids.void, { void_reason: '' });
  assert.equal(blocked.status, 400, JSON.stringify(blocked.value));
  assert.match(blocked.value.error.message, /废弃原因不能为空|void_reason.*required/);
  const response = await invoke('supplier_price_book_void', ids.void, { void_reason: '供应商报价协议已撤回' });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const book = await read('forge_supplier_price_book', ids.void);
  assert.deepEqual({ status: book.status, reason: book.void_reason }, { status: 'voided', reason: '供应商报价协议已撤回' });
  const [log] = await find('forge_supplier_price_book_status_log', { price_book_id: ids.void });
  assert.equal(log.action, 'voided');
});

await test('batch task result remains queryable', async () => {
  ids.task = await create('forge_supplier_price_book_batch_task', {
    name: 'PLC 价格条目导出', price_book_id: ids.active, direction: 'export', file_name: 'PB-ACC-ACTIVE-001.csv',
    total_rows: 1, success_rows: 1, failed_rows: 0, status: 'completed', message: '验收导出完成', completed_at: new Date().toISOString(),
  });
  const [task] = await find('forge_supplier_price_book_batch_task', { price_book_id: ids.active });
  assert.deepEqual({ direction: task.direction, total: Number(task.total_rows), success: Number(task.success_rows), status: task.status }, { direction: 'export', total: 1, success: 1, status: 'completed' });
});

await test('anonymous lifecycle action is rejected', async () => {
  const response = await invoke('supplier_price_book_void', ids.active, { void_reason: '匿名请求' }, false);
  assert.ok([401, 403].includes(response.status), JSON.stringify(response.value));
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'supplier-price-book-api-acceptance', endpoint,
  database: process.env.FORGE_DB || 'file:.objectstack/supplier-pricebook.sqlite', ids, cases,
  passed: cases.every(item => item.status === 'passed'),
  boundary: 'API evidence covers pricing formula persistence, lifecycle blocking, audit history and durable batch task records. Browser evidence is required for visible controls.',
};
await writeFile('.objectstack/acceptance/supplier-price-book-report.json', JSON.stringify(report, null, 2) + '\n');
if (!report.passed) process.exitCode = 1;
