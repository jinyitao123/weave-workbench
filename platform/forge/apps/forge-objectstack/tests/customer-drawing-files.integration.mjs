import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4384';
const database = process.env.FORGE_DB || '.objectstack/otc-customer-drawing-files.sqlite';
const origin = new URL(endpoint).origin;
const api = await connect(endpoint);
const cases = [];
const ids = { operator: api.userId, files: {} };

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function create(object, values) {
  const response = await api.request(`/data/${object}`, 'POST', values);
  assert.equal(response.status, 201, `${object}: ${JSON.stringify(response.value)}`);
  return response.value.id || response.value.record?.id;
}
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}: ${JSON.stringify(response.value)}`);
  return response.value.record;
}

const loginResponse = await fetch(`${endpoint}/api/v1/auth/sign-in/email`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
  body: JSON.stringify({ email: process.env.FORGE_TEST_EMAIL || 'admin@objectos.ai', password: process.env.FORGE_TEST_PASSWORD || 'admin123' }),
});
assert.equal(loginResponse.status, 200);
const cookie = loginResponse.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');

async function raw(path, options = {}, authenticated = true) {
  return fetch(`${endpoint}/api/v1${path}`, { ...options, headers: { ...(authenticated ? { cookie } : {}), ...(options.headers || {}) } });
}
async function upload(filename, mimeType, bytes) {
  const signedResponse = await raw('/storage/upload/presigned', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, mimeType, size: bytes.byteLength, scope: 'user' }),
  });
  const signedText = await signedResponse.text();
  assert.equal(signedResponse.status, 200, signedText);
  const signedPayload = JSON.parse(signedText);
  const descriptor = signedPayload.data || signedPayload;
  const uploadResponse = await fetch(new URL(descriptor.uploadUrl, endpoint), {
    method: descriptor.method || 'PUT', headers: descriptor.headers || {}, body: bytes,
  });
  assert.ok(uploadResponse.ok, `${filename} upload HTTP ${uploadResponse.status}`);
  const completeResponse = await raw('/storage/upload/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId: descriptor.fileId }),
  });
  const completeText = await completeResponse.text();
  assert.equal(completeResponse.status, 200, completeText);
  return descriptor.fileId;
}
async function download(fileId, authenticated = true) {
  const response = await raw(`/storage/files/${fileId}`, {}, authenticated);
  return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type') };
}

const files = {
  originalDwg: { name: '客户柜体原图.dwg', type: 'application/acad', bytes: Buffer.from('AC1027\nFORGE-CUSTOMER-DRAWING-DWG\n') },
  originalZip: { name: '客户原图打包.zip', type: 'application/zip', bytes: Buffer.from('PK\u0003\u0004FORGE-CUSTOMER-DRAWING-ZIP') },
  pdf: { name: '客户柜体接口图.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-1.4\n% Forge customer drawing PDF\n%%EOF\n') },
  technical: { name: '客户技术要求.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: Buffer.from('PK\u0003\u0004FORGE-CUSTOMER-TECHNICAL-DOCX') },
  other: { name: '客户现场照片.png', type: 'image/png', bytes: Buffer.from('\u0089PNG\r\n\u001a\nFORGE-CUSTOMER-PHOTO', 'latin1') },
  invalidPdf: { name: '伪装文本.txt', type: 'text/plain', bytes: Buffer.from('plain text must not enter the PDF-only field') },
};

await test('requires authentication before creating an upload descriptor', async () => {
  const response = await raw('/storage/upload/presigned', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'anonymous.pdf', mimeType: 'application/pdf', size: 1, scope: 'user' }),
  }, false);
  assert.equal(response.status, 401);
});

await test('uploads five real byte streams and completes governed file records', async () => {
  for (const [key, file] of Object.entries(files).filter(([key]) => key !== 'invalidPdf')) {
    ids.files[key] = await upload(file.name, file.type, file.bytes);
  }
  assert.equal(new Set(Object.values(ids.files)).size, 5);
});

ids.category = await create('forge_customer_category', { name: '客户图纸文件分类', code: 'CD-FILE-CAT', status: 'active' });
ids.customer = await create('forge_customer', { name: '客户图纸文件验收单位', category_id: ids.category, responsible_id: api.userId });
ids.customerDrawing = await create('forge_customer_drawing', {
  code: 'CDW-FILE-API-001', name: '客户控制柜总装接口图', customer_id: ids.customer, version: 'V1',
  contact: '王工', contract_number: 'HT-CD-2026-001', order_number: 'SO-CD-2026-001', received_on: '2026-09-12', valid_until: '2027-09-12',
  confidentiality: 'confidential', usage_scope: 'project_only', status: 'valid',
  customer_original_files: [ids.files.originalDwg, ids.files.originalZip], pdf_file: ids.files.pdf,
  technical_requirement_file: ids.files.technical, other_attachment_file: ids.files.other,
  remarks: 'API 实字节文件治理验收',
});

await test('persists two originals and one file in each governed single-file zone', async () => {
  const drawing = await read('forge_customer_drawing', ids.customerDrawing);
  const normalize = value => (Array.isArray(value) ? value : [value]).filter(Boolean).map(item => typeof item === 'string' ? item : item.id || item.fileId);
  assert.deepEqual(normalize(drawing.customer_original_files).sort(), [ids.files.originalDwg, ids.files.originalZip].sort());
  assert.deepEqual(normalize(drawing.pdf_file), [ids.files.pdf]);
  assert.deepEqual(normalize(drawing.technical_requirement_file), [ids.files.technical]);
  assert.deepEqual(normalize(drawing.other_attachment_file), [ids.files.other]);
});

await test('returns exact authenticated bytes and denies anonymous file reads', async () => {
  for (const [key, fileId] of Object.entries(ids.files)) {
    const authenticated = await download(fileId);
    assert.equal(authenticated.status, 200, `${key} authenticated download`);
    assert.deepEqual(authenticated.bytes, files[key].bytes, `${key} byte content`);
    assert.equal((await download(fileId, false)).status, 401, `${key} anonymous download`);
  }
});

await test('rejects a completed text file assigned to the PDF-only field', async () => {
  ids.files.invalidPdf = await upload(files.invalidPdf.name, files.invalidPdf.type, files.invalidPdf.bytes);
  const response = await api.request('/data/forge_customer_drawing', 'POST', {
    code: 'CDW-FILE-INVALID-001', name: '不合规 PDF 附件', customer_id: ids.customer, pdf_file: ids.files.invalidPdf,
  });
  assert.ok(response.status >= 400, JSON.stringify(response.value));
  const query = new URLSearchParams({ $filter: JSON.stringify({ code: 'CDW-FILE-INVALID-001' }), $top: '20' });
  const readback = await api.request(`/data/forge_customer_drawing?${query}`);
  assert.equal(readback.status, 200);
  assert.equal((readback.value.records || []).filter(item => item.code === 'CDW-FILE-INVALID-001').length, 0);
  const file = await read('sys_file', ids.files.invalidPdf);
  assert.deepEqual({ refObject: file.ref_object, refId: file.ref_id, refField: file.ref_field }, { refObject: null, refId: null, refField: null });
});

const report = {
  suite: 'customer-drawing-files', endpoint, database, ids, cases,
  passed: cases.every(item => item.status === 'passed'), completed_at: new Date().toISOString(),
  risemapEvidence: ['内置浏览器实时只读核对 /drawing/customer 与 /drawing/customer/create', 'RM-080 客户图纸新增表单', 'DR-0462 四类附件区域与格式提示'],
  boundary: '已验证 Forge 客户图纸四类真实文件上传、受控引用、格式约束、登录下载和同库持久化。RISEMAP 列表与新建页已实时只读核对；未改动远端数据，保存后状态与后续动作仍标记待复核。',
};
await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/customer-drawing-files-report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
