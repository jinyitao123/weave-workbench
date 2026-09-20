import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const projectReport = JSON.parse(await readFile('.objectstack/acceptance/project-initiation-report.json', 'utf8'));
const api = await connect();
const cases = [];
const ids = { project: projectReport.ids.project, browserProject: projectReport.ids.browserProject, operator: api.userId };

async function test(name, run) {
  try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}: ${JSON.stringify(response.value)}`);
  return response.value.record;
}
async function find(object, where) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '100' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object} find`);
  return response.value.records.filter(record => Object.entries(where).every(([field, value]) => record[field] === value));
}
async function invoke(action, id, params = {}, authenticated = true) {
  return api.request(`/actions/forge_bom/${action}/${id}`, 'POST', { params }, authenticated);
}
function actionResult(response) { return response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value; }

const standard = (await find('forge_bom', { code: 'BOM-RM-CAB-800-V1' }))[0];
assert.ok(standard, 'same-material standard BOM must exist');
ids.standardBom = standard.id;
const initialNodes = await find('forge_bom_node', { bom_id: ids.standardBom });
ids.standardRoot = initialNodes.find(node => !node.parent_id)?.id;
ids.standardComponent = initialNodes.find(node => node.sku_id)?.id;
assert.equal(initialNodes.length, 5, 'standard BOM must contain root plus four materials');

await test('rejects review submission when the caller is anonymous', async () => {
  assert.equal((await invoke('bom_submit_review', ids.standardBom, {}, false)).status, 401);
});

await test('submits the saved draft with exact component count and untaxed cost snapshot', async () => {
  const response = await invoke('bom_submit_review', ids.standardBom);
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const result = actionResult(response);
  assert.deepEqual({ status: result.status, count: result.node_count, cost: result.total_cost }, { status: 'pending_review', count: 4, cost: 14442.48 });
  const bom = await read('forge_bom', ids.standardBom);
  assert.deepEqual({ status: bom.status, count: bom.node_count, cost: bom.total_cost, submitter: bom.submitted_by },
    { status: 'pending_review', count: 4, cost: 14442.48, submitter: ids.operator });
});

await test('requires a review comment and activates V1.0 after approval', async () => {
  const missing = await invoke('bom_review', ids.standardBom, { decision: 'approve', comment: '' });
  assert.equal(missing.status, 400, JSON.stringify(missing.value));
  assert.match(JSON.stringify(missing.value), /(评审意见为必填|comment.*required)/);
  const response = await invoke('bom_review', ids.standardBom, { decision: 'approve', comment: '结构、用量与关键件核对无误，同意' });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const bom = await read('forge_bom', ids.standardBom);
  assert.equal(bom.status, 'active'); assert.equal(bom.approved_by, ids.operator); assert.ok(bom.effective_at);
  for (const node of await find('forge_bom_node', { bom_id: ids.standardBom })) assert.equal(node.bom_status, 'active');
});

await test('blocks raw quantity changes after the BOM structure is active', async () => {
  const before = await read('forge_bom_node', ids.standardComponent);
  const response = await api.request(`/data/forge_bom_node/${ids.standardComponent}`, 'PATCH', { quantity: 9 });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  assert.ok(response.value.droppedFields?.some(entry => entry.reason === 'readonly_when' && entry.fields.includes('quantity')),
    `quantity must be rejected by conditional readonly: ${JSON.stringify(response.value)}`);
  assert.equal((await read('forge_bom_node', ids.standardComponent)).quantity, before.quantity);
});

await test('creates one project BOM for the running OTC project with copied structure', async () => {
  const response = await invoke('bom_create_project_variant', ids.standardBom, { project_id: ids.project, change_note: '用于主 OTC 项目制造交付' });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  ids.projectBom = actionResult(response).id;
  const bom = await read('forge_bom', ids.projectBom);
  const project = await read('forge_project', ids.project);
  assert.deepEqual({ type: bom.bom_type, status: bom.status, source: bom.source_bom_id, project: bom.project_id, customer: bom.customer_id, version: bom.version, count: bom.node_count, cost: bom.total_cost },
    { type: 'project', status: 'draft', source: ids.standardBom, project: ids.project, customer: project.customer_id, version: 'V1.0', count: 4, cost: 14442.48 });
  const nodes = await find('forge_bom_node', { bom_id: ids.projectBom });
  assert.equal(nodes.length, 5); assert.equal(nodes.filter(node => !node.parent_id).length, 1); assert.equal(nodes.filter(node => node.sku_id).length, 4);
  const duplicate = await invoke('bom_create_project_variant', ids.standardBom, { project_id: ids.project });
  assert.equal(duplicate.status, 400, JSON.stringify(duplicate.value));
  assert.match(JSON.stringify(duplicate.value), /已经存在有效或待处理的项目BOM/);
});

await test('reviews the project BOM to an active manufacturing input', async () => {
  assert.equal((await invoke('bom_submit_review', ids.projectBom)).status, 200);
  const response = await invoke('bom_review', ids.projectBom, { decision: 'approve', comment: '项目适配内容与标准结构一致，同意生效' });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  assert.equal((await read('forge_bom', ids.projectBom)).status, 'active');
});

await test('copies the active standard BOM to an independent V1.1 draft', async () => {
  const response = await invoke('bom_copy_new_version', ids.standardBom, { change_note: '预留端子排位置优化' });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  ids.versionDraft = actionResult(response).id;
  const draft = await read('forge_bom', ids.versionDraft);
  assert.deepEqual({ status: draft.status, version: draft.version, source: draft.source_bom_id, note: draft.change_note, count: draft.node_count, cost: draft.total_cost },
    { status: 'draft', version: 'V1.1', source: ids.standardBom, note: '预留端子排位置优化', count: 4, cost: 14442.48 });
  assert.equal((await find('forge_bom_node', { bom_id: ids.versionDraft })).length, 5);
});

await test('records review rejection and returns the V1.1 draft to editable state', async () => {
  assert.equal((await invoke('bom_submit_review', ids.versionDraft)).status, 200);
  const response = await invoke('bom_review', ids.versionDraft, { decision: 'reject', comment: '端子排余量依据不足，补充后重提' });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  assert.equal((await read('forge_bom', ids.versionDraft)).status, 'draft');
  for (const node of await find('forge_bom_node', { bom_id: ids.versionDraft })) assert.equal(node.bom_status, 'draft');
});

await test('re-reviews and invalidates the copied version with an audited reason', async () => {
  assert.equal((await invoke('bom_submit_review', ids.versionDraft)).status, 200);
  assert.equal((await invoke('bom_review', ids.versionDraft, { decision: 'approve', comment: '补充依据后通过' })).status, 200);
  const missing = await invoke('bom_invalidate', ids.versionDraft, { reason: '' });
  assert.equal(missing.status, 400, JSON.stringify(missing.value));
  assert.match(JSON.stringify(missing.value), /(失效原因为必填|reason.*required)/);
  const response = await invoke('bom_invalidate', ids.versionDraft, { reason: '本次复制版本仅用于失效流程验收' });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  assert.equal((await read('forge_bom', ids.versionDraft)).status, 'inactive');
  for (const node of await find('forge_bom_node', { bom_id: ids.versionDraft })) assert.equal(node.bom_status, 'inactive');
});

await test('approval log preserves submit, approve, copy and reject decisions', async () => {
  const standardLogs = await find('forge_bom_approval_log', { bom_id: ids.standardBom });
  assert.deepEqual(standardLogs.map(log => log.action).sort(), ['approved', 'copied', 'submitted']);
  const projectLogs = await find('forge_bom_approval_log', { bom_id: ids.projectBom });
  assert.deepEqual(projectLogs.map(log => log.action).sort(), ['approved', 'submitted']);
  const versionLogs = await find('forge_bom_approval_log', { bom_id: ids.versionDraft });
  assert.deepEqual(versionLogs.map(log => log.action).sort(), ['approved', 'invalidated', 'rejected', 'submitted', 'submitted']);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = {
  recordedAt: new Date().toISOString(), kind: 'live-risemap-aligned-formal-bom-api-acceptance', fixture: 'OEM-RM-20260909-A-formal-bom-v0.1', ids, cases,
  passed: cases.every(testCase => testCase.status === 'passed'),
  risemapObserved: {
    standardBom: { code: 'BOM-RM-CAB-800-V1', version: 'V1.0', status: 'active', itemCount: 4, untaxedCost: 14442.48 },
    structure: ['PLC CPU 1215C x1', '7英寸触摸屏 x1', '24V 10A开关电源 x2', '800型柜体 x1'],
    approvalLog: ['创建', '提交评审', '评审通过'], actionsAfterActivation: ['复制到新版本', '失效'],
    projectVariantForm: ['派生自已生效标准BOM', '客户', '适用项目', 'V1.0', 'copied 5-node structure'],
  },
  boundary: 'This slice formalizes BOM review, activation, project derivation, version-copy draft and approval logs. Shortage analysis, drawing linkage, version superseding, real attachment/export and server-enforced raw-CRUD structure immutability remain outside the claim.',
};
await writeFile('.objectstack/acceptance/formal-bom-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
