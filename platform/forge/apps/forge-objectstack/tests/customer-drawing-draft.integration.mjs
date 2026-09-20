import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4356';
const api = await connect(endpoint);
const customers = await api.request('/data/forge_customer?$top=1');
assert.equal(customers.status, 200);
const customer = customers.value.records?.[0];
assert.ok(customer?.id, '需要至少一个客户才能验收客户图纸草稿');

const code = `CDW-DRAFT-API-${Date.now()}`;
const created = await api.request('/data/forge_customer_drawing', 'POST', {
  code,
  name: '800型柔性线控制柜客户图纸草稿',
  customer_id: customer.id,
  version: 'V1',
  confidentiality: 'general',
  usage_scope: 'project_only',
  status: 'draft',
  received_on: '2026-09-14',
  remarks: '客户图纸草稿 API 验收',
});
assert.equal(created.status, 201, JSON.stringify(created.value));
const id = created.value.id || created.value.record?.id;
assert.ok(id);

let readback = await api.request(`/data/forge_customer_drawing/${id}`);
assert.equal(readback.status, 200);
assert.equal(readback.value.record.status, 'draft');

const submitted = await api.request(`/data/forge_customer_drawing/${id}`, 'PATCH', {
  contract_number: 'HT-CD-DRAFT-API-001',
  order_number: 'SO-CD-DRAFT-API-001',
  status: 'valid',
});
assert.equal(submitted.status, 200, JSON.stringify(submitted.value));
readback = await api.request(`/data/forge_customer_drawing/${id}`);
assert.equal(readback.status, 200);
assert.equal(readback.value.record.status, 'valid');
assert.equal(readback.value.record.contract_number, 'HT-CD-DRAFT-API-001');
assert.equal(readback.value.record.order_number, 'SO-CD-DRAFT-API-001');

const pageSource = await readFile('src/pages/drawing-workspace.page.ts', 'utf8');
for (const text of ['保存草稿', '继续填写', "createCustomerDrawing(dialog,'draft')", "method:d.recordId?'PATCH':'POST'"]) {
  assert.ok(pageSource.includes(text), `客户图纸页面缺少 ${text}`);
}

const report = { endpoint, id, code, status: 'valid', contractNumber: 'HT-CD-DRAFT-API-001', orderNumber: 'SO-CD-DRAFT-API-001', verifiedAt: new Date().toISOString() };
await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/customer-drawing-draft-report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(`PASS customer drawing draft ${code} saved, resumed and submitted`);
