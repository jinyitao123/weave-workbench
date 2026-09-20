import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/subcontract-issue-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
const endpoint = process.env.FORGE_URL || 'http://localhost:4387';
const api = await connect(endpoint);
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}`);
  return response.value.record;
}
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, object);
  return (response.value.records || []).filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
}

const [issue] = await find('forge_subcontract_issue', { code: process.env.FORGE_BROWSER_SUBCONTRACT_ISSUE || 'SI-BROWSER-001' });
assert.ok(issue, 'browser-created subcontract issue');
const [lines, outbounds, logs, stockBalances, sourceBalances] = await Promise.all([
  find('forge_subcontract_issue_line', { issue_id: issue.id }),
  find('forge_subcontract_outbound', { issue_id: issue.id }),
  find('forge_subcontract_issue_log', { issue_id: issue.id }),
  find('forge_subcontract_stock_balance', { order_id: issue.order_id }),
  find('forge_inventory_balance', { balance_key: issue.warehouse_id + ':' + report.ids.rawSku }),
]);
assert.equal(lines.length, 1);
assert.equal(outbounds.length, 1);
assert.equal(stockBalances.length, 1);
assert.equal(sourceBalances.length, 1);
assert.deepEqual({
  issue: [issue.status, issue.issue_type, issue.total_quantity],
  line: [lines[0].item_code, lines[0].issue_quantity, lines[0].batch_number, lines[0].status],
  outbound: [outbounds[0].status, outbounds[0].total_quantity],
  logs: logs.map((row) => row.action).sort(),
  source: [sourceBalances[0].on_hand_quantity, sourceBalances[0].reserved_quantity, sourceBalances[0].available_quantity, sourceBalances[0].inventory_value],
  stock: [stockBalances[0].cumulative_issued_quantity, stockBalances[0].on_hand_quantity, stockBalances[0].inventory_value],
}, {
  issue: ['signed', 'normal', 2],
  line: ['SC-RM-001', 2, 'SC-BATCH-BROWSER-001', 'signed'],
  outbound: ['outbounded', 2],
  logs: ['approved', 'issued', 'signed', 'submitted'],
  source: [22, 0, 22, 275],
  stock: [2, 2, 25],
});
assert.equal((await read('forge_subcontract_order', issue.order_id)).issued_quantity, 2);
report.ids.browserIssue = issue.id;
report.ids.browserIssueLine = lines[0].id;
report.ids.browserOutbound = outbounds[0].id;
report.ids.browserStockBalance = stockBalances[0].id;
report.browserVerification = {
  status: 'passed',
  verifiedAt: new Date().toISOString(),
  browser: 'Codex 内置浏览器',
  pageUrl: `${endpoint}/_console/apps/forge/page/page_subcontract_issue_workspace`,
  risemapLiveComparison: report.risemapLiveEvidence,
  observed: [
    '页面按 RISEMAP 已观察列表显示四项状态概览和八列表头',
    '从已审核甲供料订单 SC-BROWSER-001 的剩余计划创建 SI-BROWSER-001',
    '填写发料数量 2 和追溯批次 SC-BATCH-BROWSER-001，并完成草稿、提交与审核',
    '审核后页面进入待发料，确认出库后进入待签收并显示委外在外库存 2',
    '供应商签收后页面显示已签收，并明确未自动开始加工',
    'API 回读原仓库存 30 减至 22，其中 API 发料 6、浏览器发料 2；两张供应商委外库存余额分别为 6 和 2',
  ],
};
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
console.log('PASS browser-created subcontract issue, inventory movement, and supplier sign-off read back');
