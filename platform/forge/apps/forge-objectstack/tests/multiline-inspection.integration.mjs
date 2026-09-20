import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const arrival = JSON.parse(await readFile('.objectstack/acceptance/multiline-arrival-report.json', 'utf8'));
assert.equal(arrival.passed, true, 'multiline arrival acceptance must pass first');
const endpoint = process.env.FORGE_URL || 'http://localhost:4354';
const database = process.env.FORGE_DB || '.objectstack/otc-multiline-inspection-final.sqlite';
const api = await connect(endpoint); const cases = []; const ids = { receipt: arrival.ids.receipt, order: arrival.ids.order };
async function test(name, run) { try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); } catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); } }
async function find(object, where = {}) { const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '100' }); const response = await api.request(`/data/${object}?${query}`); assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`); return response.value.records.filter(record => Object.entries(where).every(([key, value]) => record[key] === value)); }
async function read(object, id) { const response = await api.request(`/data/${object}/${id}`); assert.equal(response.status, 200, `${object}/${id}: ${JSON.stringify(response.value)}`); return response.value.record; }
const invoke = (object, action, id, params = {}, authenticated = true) => api.request(`/actions/${object}/${action}/${id}`, 'POST', { params }, authenticated);
const resultOf = response => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;

let pending = await find('forge_pending_inspection', { receipt_id: ids.receipt });
await test('creates one pending-inspection record and one inspection order for every arrived material line', async () => {
  assert.equal(pending.length, 4); assert.ok(pending.every(item => item.status === 'inspection_created' && item.inspection_id && item.arrival_quantity > 0 && item.receipt_line_id));
  assert.deepEqual(Object.fromEntries(pending.map(item => [item.item_code, item.arrival_quantity])), { 'RM-PLC-1215C': 1, 'RM-HMI-700': 1, 'RM-PSU-24V10A': 2, 'RM-CAB-800': 1 });
  ids.pending = pending.map(item => item.id);
});

await test('rejects anonymous and invalid inspection-order creation', async () => {
  assert.equal((await invoke('forge_pending_inspection', 'pending_inspection_create_order', pending[0].id, { inspection_method: 'full' }, false)).status, 401);
  const duplicate = await invoke('forge_pending_inspection', 'pending_inspection_create_order', pending[0].id, { inspection_method: 'full' });
  assert.equal(duplicate.status, 400, JSON.stringify(duplicate.value)); assert.match(duplicate.value.error.message, /状态已变化|已经生成/);
});

await test('generates exactly one material inspection order per pending record', async () => {
  ids.inspections = {};
  for (let index = 0; index < pending.length; index++) {
    const item = pending[index], method = 'full';
    ids.inspections[item.item_code] = item.inspection_id;
    const inspection = await read('forge_purchase_inspection', item.inspection_id);
    assert.deepEqual({ pending: inspection.pending_inspection_id, receiptLine: inspection.receipt_line_id, total: inspection.total_quantity, status: inspection.status, result: inspection.result, method: inspection.inspection_method },
      { pending: item.id, receiptLine: item.receipt_line_id, total: item.arrival_quantity, status: 'pending', result: 'pending', method });
  }
  assert.equal((await find('forge_purchase_inspection', { receipt_id: ids.receipt })).length, 4);
  assert.equal((await read('forge_purchase_receipt', ids.receipt)).status, 'pending_inspection');
});

await test('blocks duplicate inspection order for the same material', async () => {
  const response = await invoke('forge_pending_inspection', 'pending_inspection_create_order', pending[0].id, { inspection_method: 'full' });
  assert.equal(response.status, 400, JSON.stringify(response.value)); assert.match(response.value.error.message, /状态已变化|已经生成/);
  assert.equal((await find('forge_purchase_inspection', { pending_inspection_id: pending[0].id })).length, 1);
});

await test('enforces accepted quantity and inspection conclusion boundaries', async () => {
  const id = ids.inspections['RM-PSU-24V10A'];
  const over = await invoke('forge_purchase_inspection', 'purchase_inspection_complete', id, { inspected_on: '2026-09-10', accepted_quantity: 3, inspection_note: '越界' });
  assert.equal(over.status, 400, JSON.stringify(over.value)); assert.match(over.value.error.message, /0和到货总数之间/);
  const blank = await invoke('forge_purchase_inspection', 'purchase_inspection_complete', id, { inspected_on: '2026-09-10', accepted_quantity: 1, inspection_note: ' ' });
  assert.equal(blank.status, 400, JSON.stringify(blank.value)); assert.match(blank.value.error.message, /inspection_note|检验结论不能为空/);
});

await test('keeps the receipt in inspection until the final material is decided', async () => {
  const decisions = { 'RM-PLC-1215C': 1, 'RM-PSU-24V10A': 1, 'RM-CAB-800': 0 };
  for (const [code, accepted] of Object.entries(decisions)) {
    const response = await invoke('forge_purchase_inspection', 'purchase_inspection_complete', ids.inspections[code], { inspected_on: '2026-09-10', accepted_quantity: accepted, inspection_note: `${code} 来料检验记录` });
    assert.equal(response.status, 200, JSON.stringify(response.value));
  }
  assert.equal((await read('forge_purchase_receipt', ids.receipt)).status, 'pending_inspection');
  const psu = await read('forge_purchase_inspection', ids.inspections['RM-PSU-24V10A']), cabinet = await read('forge_purchase_inspection', ids.inspections['RM-CAB-800']);
  assert.deepEqual({ result: psu.result, accepted: psu.accepted_quantity, rejected: psu.rejected_quantity }, { result: 'partial', accepted: 1, rejected: 1 });
  assert.deepEqual({ result: cabinet.result, accepted: cabinet.accepted_quantity, rejected: cabinet.rejected_quantity }, { result: 'rejected', accepted: 0, rejected: 1 });
});

await test('completes the receipt only after all four material inspections finish', async () => {
  const id = ids.inspections['RM-HMI-700'];
  const response = await invoke('forge_purchase_inspection', 'purchase_inspection_complete', id, { inspected_on: '2026-09-10', accepted_quantity: 1, inspection_note: '触摸屏外观、通电与通讯检查合格' });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  assert.equal((await read('forge_purchase_receipt', ids.receipt)).status, 'inspected');
  assert.ok((await find('forge_pending_inspection', { receipt_id: ids.receipt })).every(item => item.status === 'inspected'));
  assert.ok((await find('forge_purchase_receipt_line', { receipt_id: ids.receipt })).every(item => item.status === 'inspected'));
  assert.equal((await find('forge_purchase_inbound', { receipt_id: ids.receipt })).length, 0, 'inspection must not fabricate purchase inbound');
  const orderLines = await find('forge_purchase_order_line', { order_id: ids.order });
  assert.deepEqual(Object.fromEntries(orderLines.map(item => [item.item_code, [item.inspected_quantity, item.accepted_quantity]])), {
    'RM-PLC-1215C': [1, 1], 'RM-HMI-700': [1, 1], 'RM-PSU-24V10A': [2, 1], 'RM-CAB-800': [1, 0],
  });
});

await test('rejects repeated completion and anonymous inspection access', async () => {
  const id = ids.inspections['RM-HMI-700'];
  const repeated = await invoke('forge_purchase_inspection', 'purchase_inspection_complete', id, { inspected_on: '2026-09-10', accepted_quantity: 1, inspection_note: '重复' });
  assert.equal(repeated.status, 400, JSON.stringify(repeated.value)); assert.match(repeated.value.error.message, /状态已变化/);
  assert.equal((await api.request(`/data/forge_purchase_inspection/${id}`, 'GET', undefined, false)).status, 401);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = { recordedAt: new Date().toISOString(), kind: 'risemap-aligned-multiline-inspection-acceptance', fixture: 'OEM-RM-20260909-A-multiline-inspection-v0.1', endpoint, database, ids, cases, passed: cases.every(item => item.status === 'passed'),
  risemapObserved: { pendingGranularity: 'one record per arrived material', inspectionGranularity: 'one order per material', columns: ['检验单','到货单号','物料名称','供应商/客户','方式','总数量','合格数量','不合格数量','结果','状态','检验员'], nextState: '采购入库' },
  boundary: 'This slice creates and completes one inspection order per arrived material. RISEMAP post-submit behavior remains pending remote confirmation; inspection rules, exemptions, measurement items, disposition and purchase inbound are not claimed.' };
await writeFile('.objectstack/acceptance/multiline-inspection-report.json', JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;
