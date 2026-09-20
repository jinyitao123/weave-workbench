import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
const path = '.objectstack/acceptance/customer-drawing-files-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true);
const endpoint = process.env.FORGE_URL || 'http://localhost:4384';
const api = await connect(endpoint);
const login = await fetch(`${endpoint}/api/v1/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(endpoint).origin }, body: JSON.stringify({ email: process.env.FORGE_TEST_EMAIL || 'admin@objectos.ai', password: process.env.FORGE_TEST_PASSWORD || 'admin123' }) });
assert.equal(login.status, 200);
const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const expectedApiBytes = {
  [report.ids.files.originalDwg]: Buffer.from('AC1027\nFORGE-CUSTOMER-DRAWING-DWG\n'),
  [report.ids.files.originalZip]: Buffer.from('PK\u0003\u0004FORGE-CUSTOMER-DRAWING-ZIP'),
  [report.ids.files.pdf]: Buffer.from('%PDF-1.4\n% Forge customer drawing PDF\n%%EOF\n'),
  [report.ids.files.technical]: Buffer.from('PK\u0003\u0004FORGE-CUSTOMER-TECHNICAL-DOCX'),
  [report.ids.files.other]: Buffer.from('\u0089PNG\r\n\u001a\nFORGE-CUSTOMER-PHOTO', 'latin1'),
};
async function read(object, id) { const response = await api.request(`/data/${object}/${id}`); assert.equal(response.status, 200, `${object}/${id}`); return response.value.record; }
const drawings = await Promise.all([read('forge_customer_drawing', report.ids.customerDrawing), read('forge_customer_drawing', report.ids.browserCustomerDrawing)]);
const idsOf = value => (Array.isArray(value) ? value : value ? [value] : []).map(item => typeof item === 'string' ? item : item.id || item.fileId);
for (const drawing of drawings) {
  assert.equal(idsOf(drawing.customer_original_files).length, 2);
  assert.equal(idsOf(drawing.pdf_file).length, 1);
  assert.equal(idsOf(drawing.technical_requirement_file).length, 1);
  assert.equal(idsOf(drawing.other_attachment_file).length, 1);
  for (const fileId of [...idsOf(drawing.customer_original_files), ...idsOf(drawing.pdf_file), ...idsOf(drawing.technical_requirement_file), ...idsOf(drawing.other_attachment_file)]) {
    const response = await fetch(`${endpoint}/api/v1/storage/files/${fileId}`, { headers: { cookie: '' } });
    assert.equal(response.status, 401);
    const record = await read('sys_file', fileId);
    assert.equal(record.status, 'committed');
    assert.equal(record.owner_id, report.ids.operator);
    assert.ok(record.size > 0);
    assert.equal(record.ref_object, 'forge_customer_drawing');
    assert.equal(record.ref_id, drawing.id);
    const authenticated = await fetch(`${endpoint}/api/v1/storage/files/${fileId}`, { headers: { cookie } });
    assert.equal(authenticated.status, 200);
    const bytes = Buffer.from(await authenticated.arrayBuffer());
    assert.ok(bytes.byteLength > 0);
    if (expectedApiBytes[fileId]) assert.deepEqual(bytes, expectedApiBytes[fileId]);
  }
}
report.restartVerification = { status: 'passed', verifiedAt: new Date().toISOString(), database: process.env.FORGE_DB || report.database, assertion: '同一 SQLite 完整停服重启后保留 API 与浏览器两份客户图纸、十个字段文件引用、sys_file 元数据、文件字节和登录访问边界' };
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
console.log('PASS customer drawing records and governed files survived full server restart');
