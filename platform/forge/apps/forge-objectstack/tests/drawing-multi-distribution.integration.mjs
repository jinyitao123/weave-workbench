import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const lifecycle = JSON.parse(await readFile('.objectstack/acceptance/drawing-lifecycle-report.json', 'utf8'));
const endpoint = process.env.FORGE_URL || 'http://localhost:4382';
const database = process.env.FORGE_DB || '.objectstack/otc-drawing-multi-distribution.sqlite';
const api = await connect(endpoint);
const cases = [];
const run = Date.now().toString().slice(-8);
const ids = { operator: api.userId, drawing: lifecycle.ids.drawing, version: null };

async function test(name, fn) {
  try {
    await fn();
    cases.push({ name, status: 'passed' });
    console.log(`PASS ${name}`);
  } catch (error) {
    cases.push({ name, status: 'failed', error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

async function create(object, values) {
  const response = await api.request(`/data/${object}`, 'POST', values);
  assert.equal(response.status, 201, `${object}: ${JSON.stringify(response.value)}`);
  return response.value.id || response.value.record?.id;
}

async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, object);
  return response.value.record;
}

async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, object);
  return (response.value.records || []).filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
}

async function invoke(object, action, id, params = {}, authenticated = true) {
  return api.request(`/actions/${object}/${action}/${id}`, 'POST', { params }, authenticated);
}

const resultOf = (response) => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
const recipient = (type, name, organization) => ({ recipient_type: type, recipient_name: name, organization, contact: '021-55550000' });

ids.version = (await read('forge_drawing', ids.drawing)).current_version_id;
assert.ok(ids.version, '图号必须存在当前已发布版本');

ids.allRequiredDistribution = await create('forge_drawing_distribution', {
  name: '生产与质量联合发放 '+run, code: 'DIST-MULTI-API-ALL-'+run, drawing_id: ids.drawing, version_id: ids.version,
  purpose: 'production', recipient_type: 'department', recipient_name: '2 个接收对象', multi_recipient: true,
  require_all_confirmation: true, method: 'system', require_confirmation: true, require_receipt: true,
  receipt_due_on: '2026-09-18', receipt_requirement: '各接收对象确认并回执受控副本', restrict_download: true,
  add_watermark: true, watermark_text: '内部受控', cc_names: '项目经理',
});

await test('requires authentication, unique recipients, and at least two recipients', async () => {
  const anonymous = await invoke('forge_drawing_distribution', 'drawing_distribution_add_recipient', ids.allRequiredDistribution, recipient('department', '装配生产部', '制造中心'), false);
  assert.equal(anonymous.status, 401);
  const first = await invoke('forge_drawing_distribution', 'drawing_distribution_add_recipient', ids.allRequiredDistribution, recipient('department', '装配生产部', '制造中心'));
  assert.equal(first.status, 200, JSON.stringify(first.value));
  ids.productionRecipient = resultOf(first).id;
  assert.equal((await invoke('forge_drawing_distribution', 'drawing_distribution_execute', ids.allRequiredDistribution)).status, 400);
  assert.equal((await invoke('forge_drawing_distribution', 'drawing_distribution_add_recipient', ids.allRequiredDistribution, recipient('department', '装配生产部', '制造中心'))).status, 400);
  const second = await invoke('forge_drawing_distribution', 'drawing_distribution_add_recipient', ids.allRequiredDistribution, recipient('person', '质量工程师张敏', '质量部'));
  assert.equal(second.status, 200, JSON.stringify(second.value));
  ids.qualityRecipient = resultOf(second).id;
});

await test('executes one immutable delivery version for the full recipient list', async () => {
  const execution = await invoke('forge_drawing_distribution', 'drawing_distribution_execute', ids.allRequiredDistribution);
  assert.equal(execution.status, 200, JSON.stringify(execution.value));
  const distribution = await read('forge_drawing_distribution', ids.allRequiredDistribution);
  const recipients = await find('forge_drawing_distribution_recipient', { distribution_id: ids.allRequiredDistribution });
  assert.deepEqual({
    status: distribution.status,
    version: distribution.version_id,
    recipients: distribution.recipient_count,
    confirmed: distribution.confirmed_count,
    required: distribution.confirmation_required_count,
    satisfied: distribution.confirmation_satisfied,
    confirmation: distribution.confirmation_status,
    receipt: distribution.receipt_status,
  }, { status: 'sent', version: ids.version, recipients: 2, confirmed: 0, required: 2, satisfied: false, confirmation: 'pending', receipt: 'pending' });
  assert.equal(recipients.length, 2);
  assert.ok(recipients.every((row) => row.confirmation_status === 'pending' && row.receipt_status === 'pending'));
  assert.equal((await invoke('forge_drawing_distribution', 'drawing_distribution_confirm', ids.allRequiredDistribution, { receipt_received: true })).status, 400);
});

await test('records a partial confirmation without satisfying an all-recipient threshold', async () => {
  const confirmation = await invoke('forge_drawing_distribution_recipient', 'drawing_distribution_recipient_confirm', ids.productionRecipient, { receipt_received: true, receipt_note: '装配部已登记受控副本' });
  assert.equal(confirmation.status, 200, JSON.stringify(confirmation.value));
  assert.deepEqual(resultOf(confirmation), {
    id: ids.productionRecipient, distribution_id: ids.allRequiredDistribution, confirmation_status: 'partial',
    confirmed_count: 1, recipient_count: 2, confirmation_satisfied: false, receipt_status: 'pending', receipt_count: 1,
  });
  assert.equal((await invoke('forge_drawing_distribution_recipient', 'drawing_distribution_recipient_confirm', ids.productionRecipient, { receipt_received: true })).status, 400);
});

ids.anyRequiredDistribution = await create('forge_drawing_distribution', {
  name: '项目协同发放 '+run, code: 'DIST-MULTI-API-ANY-'+run, drawing_id: ids.drawing, version_id: ids.version,
  purpose: 'project', recipient_type: 'person', recipient_name: '2 个接收对象', multi_recipient: true,
  require_all_confirmation: false, method: 'system', require_confirmation: true, require_receipt: false,
});

await test('treats the first confirmation as sufficient when all confirmation is disabled', async () => {
  const manager = await invoke('forge_drawing_distribution', 'drawing_distribution_add_recipient', ids.anyRequiredDistribution, recipient('person', '项目经理李明', '项目部'));
  const designer = await invoke('forge_drawing_distribution', 'drawing_distribution_add_recipient', ids.anyRequiredDistribution, recipient('person', '电气设计王蕾', '设计部'));
  assert.equal(manager.status, 200);
  assert.equal(designer.status, 200);
  ids.managerRecipient = resultOf(manager).id;
  ids.designerRecipient = resultOf(designer).id;
  assert.equal((await invoke('forge_drawing_distribution', 'drawing_distribution_execute', ids.anyRequiredDistribution)).status, 200);
  const confirmation = await invoke('forge_drawing_distribution_recipient', 'drawing_distribution_recipient_confirm', ids.managerRecipient, { receipt_received: false, receipt_note: '项目经理确认' });
  assert.equal(confirmation.status, 200, JSON.stringify(confirmation.value));
  const distribution = await read('forge_drawing_distribution', ids.anyRequiredDistribution);
  assert.deepEqual({ status: distribution.confirmation_status, confirmed: distribution.confirmed_count, required: distribution.confirmation_required_count, satisfied: distribution.confirmation_satisfied, receipt: distribution.receipt_status }, { status: 'partial', confirmed: 1, required: 1, satisfied: true, receipt: 'not_required' });
});

const report = {
  suite: 'drawing-multi-recipient-distribution', endpoint, database, ids, cases,
  passed: cases.every((item) => item.status === 'passed'), completed_at: new Date().toISOString(),
  boundary: '证明同一已发布图纸版本可向多个接收对象发放，逐对象形成确认和回执状态，并区分全部确认与任一确认的达标门槛。RISEMAP 已观察这些开关和状态，但无有效数据成功链；外部消息投递、真实回执文件、并发确认原子性和业务角色权限仍不在本次声明内。',
};
await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/drawing-multi-distribution-report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
