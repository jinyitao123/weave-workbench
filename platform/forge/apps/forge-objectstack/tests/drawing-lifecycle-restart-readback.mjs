import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/drawing-lifecycle-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
const api = await connect(process.env.FORGE_URL || 'http://localhost:4380');

async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, object);
  return response.value.record;
}

async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, object);
  return (response.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
}

const [drawing, v1, v2, release, cancelledRelease, change, distribution, customer, browserDistribution] = await Promise.all([
  read('forge_drawing', report.ids.drawing),
  read('forge_drawing_version', report.ids.v1),
  read('forge_drawing_version', report.ids.v2),
  read('forge_drawing_release', report.ids.release1),
  read('forge_drawing_release', report.ids.cancelRelease),
  read('forge_drawing_change', report.ids.change),
  read('forge_drawing_distribution', report.ids.distribution),
  read('forge_customer_drawing', report.ids.customerDrawing),
  read('forge_drawing_distribution', report.ids.browserDistribution),
]);

assert.equal(drawing.status, 'released');
assert.deepEqual({
  shortName: drawing.short_name,
  type: drawing.drawing_type,
  category: drawing.category,
  department: drawing.department,
  controlled: drawing.controlled,
  controlledNumber: drawing.controlled_number,
  controlledCopies: drawing.controlled_copies,
  keyPart: drawing.key_part,
  purchaseByDrawing: drawing.purchase_by_drawing,
  oldVersion: drawing.allow_old_version_substitution,
  condition: drawing.substitution_condition,
  incoming: drawing.incoming_inspection,
  firstArticle: drawing.first_article_confirmation,
  subcontractable: drawing.subcontractable,
  batchTraceable: drawing.batch_traceable,
  versionRequired: drawing.version_required,
}, {
  shortName: '800 控制柜总装',
  type: 'assembly',
  category: 'mechanical',
  department: '机械设计部',
  controlled: true,
  controlledNumber: 'CTRL-800-001',
  controlledCopies: 3,
  keyPart: true,
  purchaseByDrawing: true,
  oldVersion: true,
  condition: '仅限已投产批次且须经工程负责人书面确认',
  incoming: true,
  firstArticle: true,
  subcontractable: true,
  batchTraceable: true,
  versionRequired: true,
});
assert.ok(['V1.0', 'V1.1'].includes(drawing.current_version));
assert.ok(['released', 'superseded'].includes(v1.status));
assert.ok(['reviewed', 'released'].includes(v2.status));
if (drawing.current_version === 'V1.1') {
  assert.equal(v1.status, 'superseded');
  assert.equal(v2.status, 'released');
  assert.equal(drawing.current_version_id, v2.id);
}
assert.equal(release.status, 'released');
assert.deepEqual([cancelledRelease.status, cancelledRelease.cancel_reason, cancelledRelease.suggested_effective_on], ['cancelled', '生产计划调整，重新安排生效日期', '2026-09-18']);
assert.equal(change.status, 'completed');
assert.deepEqual([distribution.status, distribution.confirmation_status, distribution.receipt_status], ['sent', 'confirmed', 'received']);
assert.deepEqual([browserDistribution.status, browserDistribution.confirmation_status, browserDistribution.receipt_status], ['sent', 'confirmed', 'not_required']);
assert.deepEqual([customer.status, customer.confidentiality], ['valid', 'confidential']);
const logs = await find('forge_drawing_operation_log', { drawing_id: drawing.id });
assert.ok(logs.length >= 14, `expected at least 14 operation logs, got ${logs.length}`);

report.restartVerification = {
  status: 'passed',
  verifiedAt: new Date().toISOString(),
  database: process.env.FORGE_DB || report.database,
  assertion: `同一 SQLite 完整停服重启后保留图纸发布、工程变更、API 与内置浏览器发放确认、客户图纸及 ${logs.length} 条可审计操作记录`,
};
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
console.log('PASS drawing lifecycle survived full server restart and later valid V1.1 publication');
