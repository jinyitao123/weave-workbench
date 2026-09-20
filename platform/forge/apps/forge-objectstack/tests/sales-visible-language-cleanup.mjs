import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const replacements = [
  ['forge_goodwill_order', { code: 'GW-FORGE-20260913' }, {
    gift_type: 'onsite_support', reason: '项目交付后现场调试支持所需控制柜样件赠送。', item_name: '800型柔性线控制柜', quantity: 2, unit_name: '台', contact_name: '周启明', contact_phone: '13800002609', remarks: '用于客户现场支持物料发放',
  }],
  ['forge_sales_team', { code: 'TEAM-RM-20260913' }, { name: '项目客户销售团队', remarks: '负责项目客户商机、订单和回款跟进' }],
  ['forge_sales_target', { code: 'TARGET-RM-20260913' }, { remarks: '年度目标按合同额和回款额分月跟踪；月度合同额平均分配：83333/83333/83333/83333/83333/83333/83333/83333/83333/83333/83333/83337；月度回款平均分配：66666/66666/66666/66666/66666/66666/66666/66666/66666/66666/66666/66674' }],
  ['forge_service_config_item', { code: 'RMTESTSERVICE0913' }, { code: 'SVC-FIELD-0913', name: '现场调试支持', description: '用于安装调试、巡检保养和现场问题处理' }],
  ['forge_service_config_item', { code: 'RMTESTENGINEER0913' }, { code: 'SVC-ENG-SUZHOU-0913', name: '售后工程师-苏州现场支持', description: '电话 13800000913；团队 苏州服务组；区域 苏州 / 远程；技能 PLC、调试；状态 在岗' }],
  ['forge_service_config_item', { code: 'SVC-FIELD-0913' }, { name: '现场调试支持', description: '用于安装调试、巡检保养和现场问题处理' }],
  ['forge_service_config_item', { code: 'SVC-ENG-SUZHOU-0913' }, { name: '售后工程师-苏州现场支持', description: '电话 13800000913；团队 苏州服务组；区域 苏州 / 远程；技能 PLC、调试；状态 在岗' }],
  ['forge_service_order', { code: 'WO-FORGE-20260913' }, { name: '800型柔性线控制柜现场调试支持', service_type: '现场调试支持', remarks: '800型柔性线控制柜交付后例行调试支持。', engineer_name: '售后工程师-苏州现场支持', dispatch_note: '派给苏州现场支持工程师处理' }],
];
async function find(object, where) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '20' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, object);
  return (response.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
}
const updated = [];
for (const [object, where, patch] of replacements) {
  const rows = await find(object, where);
  for (const row of rows) {
    const response = await api.request(`/data/${object}/${row.id}`, 'PATCH', patch);
    assert.equal(response.status, 200, `${object}/${row.id}: ${JSON.stringify(response.value)}`);
    updated.push({ object, id: row.id, code: row.code || row.name });
  }
}
const scanned = [];
for (const object of ['forge_goodwill_order', 'forge_sales_team', 'forge_sales_target', 'forge_service_config_item', 'forge_service_order']) {
  const rows = await find(object, {});
  for (const row of rows) {
    const text = JSON.stringify(row);
    assert.equal(/RISEMAP 对照|复刻验收|用于 Forge|RMTEST|售后对照组|后续切片|本阶段仅验证/.test(text), false, `${object}/${row.id} still contains internal acceptance wording`);
    scanned.push({ object, id: row.id });
  }
}
await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/sales-visible-language-cleanup-report.json', JSON.stringify({ recordedAt: new Date().toISOString(), endpoint, updated, scanned: scanned.length, passed: true }, null, 2));
console.log('PASS sales visible language cleanup');
