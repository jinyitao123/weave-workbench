import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4491';
const api = await connect(endpoint);
const query = new URLSearchParams({ $filter: JSON.stringify({ code: 'IN-ALL-AGGREGATE-001' }), $top: '20' });
const result = await api.request(`/data/forge_opening_inbound?${query}`);
assert.equal(result.status, 200, JSON.stringify(result.value));
const record = (result.value.records || []).find((row) => row.code === 'IN-ALL-AGGREGATE-001');
assert.ok(record, 'aggregate acceptance inbound must survive restart');
assert.deepEqual({
  status: record.status,
  quantity: Number(record.total_quantity),
  amount: Number(record.total_amount),
  remarks: record.remarks,
}, {
  status: 'draft', quantity: 18, amount: 5400,
  remarks: '独立聚合页面与重启回读验收',
});

console.log(JSON.stringify({ suite: 'all-inbounds-restart-readback', status: 'passed', endpoint, id: record.id }, null, 2));
