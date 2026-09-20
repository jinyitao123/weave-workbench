import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const api = await connect();
const title = '页面验收加班申请 20260915';
const query = new URLSearchParams({
  $filter: JSON.stringify({ page_key: 'overtime_requests' }),
  $top: '50',
});

const response = await api.request(`/data/forge_administration_record?${query}`);
assert.equal(response.status, 200, 'administration records must be readable after restart');
const record = response.value.records.find(item => item.title === title);
assert.ok(record, 'browser-created overtime record must remain readable after restart');
assert.deepEqual(
  {
    pageKey: record.page_key,
    category: record.category,
    status: record.status,
    owner: record.owner_name,
    department: record.department,
    start: record.start_on,
    end: record.end_on,
    quantity: record.quantity,
    details: record.details,
  },
  {
    pageKey: 'overtime_requests',
    category: '调休',
    status: 'draft',
    owner: 'Dev Admin',
    department: '研发中心',
    start: '2026-09-15',
    end: '2026-09-15',
    quantity: 2,
    details: '行政页面内置浏览器验收记录',
  },
);

const invalid = await api.request('/data/forge_administration_record', 'POST', {
  title: '', page_key: 'overtime_requests', status: 'draft',
});
assert.equal(invalid.status, 400, 'server must reject an empty required title');

const anonymous = await api.request('/data/forge_administration_record', 'GET', undefined, false);
assert.equal(anonymous.status, 401, 'anonymous administration reads must be rejected');

console.log('PASS browser-created administration record survived restart; required-field and auth API checks passed');
