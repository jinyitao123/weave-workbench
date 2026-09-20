import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/formal-bom-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true, 'formal BOM API acceptance must pass before browser readback');
const forgeUrl = process.env.FORGE_URL || 'http://localhost:4344';
const api = await connect();
async function find(object, where) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '100' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object} find`);
  return response.value.records.filter(record => Object.entries(where).every(([field, value]) => record[field] === value));
}

const candidates = await find('forge_bom', { project_id: report.ids.browserProject });
const browserBom = candidates.find(bom => bom.source_bom_id === report.ids.standardBom && bom.code === 'BOM-RM-CAB-800-V1-PRJ-2026-002');
assert.ok(browserBom, 'browser-created project BOM must remain readable');
assert.deepEqual(
  { type: browserBom.bom_type, status: browserBom.status, source: browserBom.source_bom_id, project: browserBom.project_id,
    version: browserBom.version, count: browserBom.node_count, cost: browserBom.total_cost, approver: browserBom.approved_by },
  { type: 'project', status: 'active', source: report.ids.standardBom, project: report.ids.browserProject,
    version: 'V1.0', count: 4, cost: 14442.48, approver: report.ids.operator },
);
assert.ok(browserBom.effective_at, 'browser approval must set an effective time');
const nodes = await find('forge_bom_node', { bom_id: browserBom.id });
assert.equal(nodes.length, 5);
assert.equal(nodes.filter(node => !node.parent_id).length, 1);
assert.equal(nodes.filter(node => node.sku_id).length, 4);
assert.ok(nodes.every(node => node.bom_status === 'active'));
const logs = await find('forge_bom_approval_log', { bom_id: browserBom.id });
assert.deepEqual(logs.map(log => log.action).sort(), ['approved', 'submitted']);
assert.ok(logs.find(log => log.action === 'approved')?.comment.includes('浏览器验收'));

report.ids.browserProjectBom = browserBom.id;
report.browserVerification = {
  verifiedAt: new Date().toISOString(), status: 'passed',
  recordUrl: `${forgeUrl}/_console/apps/forge/page/page_bom_workspace?id=${browserBom.id}`,
  observed: [
    '从已生效标准 BOM 页面打开项目 BOM 派生表单，选择 PRJ-2026-002 后保存成功',
    '项目 BOM 详情回读来源标准 BOM、项目、客户、V1.0、4 个物料和未税成本 14442.48',
    '提交评审后页面进入待评审，评审选择同意并填写意见后提示 BOM评审已完成',
    '页面进入已生效阶段，显示生效时间、评审人和复制到新版本动作',
    'API 回读 5 个结构节点全部随 BOM 生效，并保存提交与同意两条审批日志',
    '专用 BOM 工作台按 RISEMAP 标题状态区、动作区和七页签布局回读同一记录',
    'BOM结构页签回读根节点、四项物料、关键件、位号、物料数 4 和未税成本 14442.48',
    '版本历史与审批日志页签回读真实持久数据；未实现页签明确标为待复核且不计入完成范围',
  ],
  limitation: '本次未在 RISEMAP 远端保存新的项目 BOM；RISEMAP 标准 BOM 流转和项目派生表单已观察。缺料分析、图纸关联、版本替代、真实附件与导入导出仍未验证。',
};
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS browser-derived project BOM review and activation persisted');
