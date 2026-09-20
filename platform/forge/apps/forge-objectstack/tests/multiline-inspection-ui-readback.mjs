import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
const path = '.objectstack/acceptance/multiline-inspection-report.json', report = JSON.parse(await readFile(path, 'utf8')), api = await connect();
async function find(object, where = {}) { const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '100' }); const response = await api.request(`/data/${object}?${query}`); assert.equal(response.status, 200); return response.value.records.filter(record => Object.entries(where).every(([key, value]) => record[key] === value)); }
async function read(object, id) { const response = await api.request(`/data/${object}/${id}`); assert.equal(response.status, 200); return response.value.record; }
const invoke = (object, action, id, params = {}) => api.request(`/actions/${object}/${action}/${id}`, 'POST', { params }); const resultOf = response => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
const receipts = await find('forge_purchase_receipt', { logistics_number: process.env.FORGE_UI_IQC_LOGISTICS || 'FORGE-UI-IQC-20260910' }); assert.equal(receipts.length, 1); const receipt = receipts[0];
const hmiInspections = (await find('forge_purchase_inspection', { receipt_id: receipt.id })).filter(item => item.item_code === 'RM-HMI-700'); assert.equal(hmiInspections.length, 1); const hmi = hmiInspections[0];
assert.deepEqual({ status: hmi.status, total: hmi.total_quantity, accepted: hmi.accepted_quantity, rejected: hmi.rejected_quantity, result: hmi.result, note: hmi.inspection_note },
  { status: 'completed', total: 3, accepted: 2, rejected: 1, result: 'partial', note: '触摸屏外观、通电与通讯抽验，2件合格，1件隔离待处置' });
assert.equal(receipt.status, 'inspection_in_progress');
const pending = await find('forge_pending_inspection', { receipt_id: receipt.id }); assert.equal(pending.length, 4); assert.equal(pending.filter(item => item.status === 'inspected').length, 1); assert.equal(pending.filter(item => item.status === 'pending').length, 3);
const browserInspectionIds = [hmi.id];
for (const item of pending.filter(row => row.status === 'pending')) {
  const create = await invoke('forge_pending_inspection', 'pending_inspection_create_order', item.id, { inspection_method: 'full' }); assert.equal(create.status, 200, JSON.stringify(create.value)); const inspectionId = resultOf(create).id; browserInspectionIds.push(inspectionId);
  const complete = await invoke('forge_purchase_inspection', 'purchase_inspection_complete', inspectionId, { inspected_on: '2026-09-10', accepted_quantity: item.arrival_quantity, inspection_note: `${item.item_code} 全检合格` }); assert.equal(complete.status, 200, JSON.stringify(complete.value));
}
assert.equal((await read('forge_purchase_receipt', receipt.id)).status, 'inspected'); assert.equal((await find('forge_purchase_inspection', { receipt_id: receipt.id })).length, 4); assert.equal((await find('forge_purchase_inbound', { receipt_id: receipt.id })).length, 0);
report.ids.browserReceipt = receipt.id; report.ids.browserInspection = hmi.id; report.ids.browserPending = pending.map(item => item.id); report.ids.browserInspections = browserInspectionIds;
report.browserVerification = { verifiedAt: new Date().toISOString(), status: 'passed', action: 'created and completed the HMI inspection in the built-in browser', itemCode: 'RM-HMI-700', totalQuantity: 3, acceptedQuantity: 2, rejectedQuantity: 1, result: 'partial', finalReceiptStatus: 'inspected' };
await writeFile(path, JSON.stringify(report, null, 2)); console.log('PASS built-in browser created and completed one material inspection; remaining material decisions completed through API');
