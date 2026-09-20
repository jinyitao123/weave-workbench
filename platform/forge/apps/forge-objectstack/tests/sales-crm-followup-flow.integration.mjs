import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const cases = [];
const ids = { operator: api.userId };
const codes = { lead: `LEAD-FLOW-${stamp}`, pool: `POOL-FLOW-${stamp}` };
async function test(name, run) { try { await run(); cases.push({ name, status: 'passed' }); console.log(`PASS ${name}`); } catch (error) { cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`); } }
async function find(object, where = {}) { const q = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' }); const r = await api.request(`/data/${object}?${q}`); assert.equal(r.status, 200, `${object}: ${JSON.stringify(r.value)}`); return (r.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value)); }
async function read(object, id) { const r = await api.request(`/data/${object}/${id}`); assert.equal(r.status, 200, `${object}/${id}: ${JSON.stringify(r.value)}`); return r.value.record; }
async function create(object, data) { const r = await api.request(`/data/${object}`, 'POST', data); assert.equal(r.status, 201, `${object}: ${JSON.stringify(r.value)}`); return r.value.id || r.value.record?.id || r.value.data?.id || r.value.result?.id; }
async function invoke(object, action, id, params = {}) { const r = await api.request(`/actions/${object}/${action}/${id}`, 'POST', { params }); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.value)}`); return r.value?.result ?? r.value?.data?.result ?? r.value?.data ?? r.value; }

await test('sales lead can be created and converted to customer plus opportunity', async () => {
  ids.lead = await create('forge_sales_lead', { name: '苏州澄岳二期柔性线扩容线索', code: codes.lead, company_name: '苏州澄岳自动化装备有限公司', contact_name: '周启明', phone: '13800002609', source: '客户现场回访', status: 'new', responsible_id: api.userId, remarks: '客户计划新增一条柔性线控制柜扩容需求。' });
  const result = await invoke('forge_sales_lead', 'sales_lead_convert_to_opportunity', ids.lead, { amount: 320000, expected_close_on: '2026-10-30' });
  ids.customer = result.customer_id;
  ids.opportunity = result.opportunity_id;
  const lead = await read('forge_sales_lead', ids.lead);
  assert.equal(lead.status, 'converted');
  assert.equal(lead.converted_customer_id, ids.customer);
  assert.equal(lead.converted_opportunity_id, ids.opportunity);
  const opportunity = await read('forge_sales_opportunity', ids.opportunity);
  assert.equal(opportunity.lead_id, ids.lead);
  assert.equal(opportunity.stage, 'needs_confirmed');
  assert.equal(opportunity.amount, 320000);
});

await test('opportunity can record follow-up and advance stage', async () => {
  ids.followUp = await create('forge_sales_follow_up', { name: '二期柔性线需求电话沟通', customer_id: ids.customer, opportunity_id: ids.opportunity, follow_type: 'phone', content: '确认客户二期柔性线扩容需求，约定下周提交初步方案。', followed_at: '2026-09-13', next_follow_on: '2026-09-20', status: 'completed', responsible_id: api.userId, remarks: '客户关注交期和现场调试支持。' });
  await invoke('forge_sales_opportunity', 'sales_opportunity_advance', ids.opportunity, { stage: 'proposal_quoted' });
  const opportunity = await read('forge_sales_opportunity', ids.opportunity);
  assert.equal(opportunity.stage, 'proposal_quoted');
  const follow = await read('forge_sales_follow_up', ids.followUp);
  assert.equal(follow.status, 'completed');
});

await test('customer pool can be claimed into customer archive', async () => {
  ids.pool = await create('forge_customer_pool', { name: `无锡精密装备有限公司-${stamp}`, industry: '装备制造', level: 'A', contact_name: '陈经理', city: '无锡', source: '展会名片', estimated_value: 180000, released_days: 12, status: 'claimable', remarks: '销售公海客户领取测试' });
  const result = await invoke('forge_customer_pool', 'customer_pool_claim', ids.pool);
  ids.poolCustomer = result.customer_id;
  const pool = await read('forge_customer_pool', ids.pool);
  assert.equal(pool.status, 'claimed');
  assert.equal(pool.claimed_customer_id, ids.poolCustomer);
  const customer = await read('forge_customer', ids.poolCustomer);
  assert.match(customer.name, /无锡精密装备有限公司/);
});

await mkdir('.objectstack/acceptance', { recursive: true });
const report = { recordedAt: new Date().toISOString(), kind: 'forge-sales-crm-followup-flow', endpoint, codes, ids, cases, passed: cases.every(x => x.status === 'passed'), risemapObserved: { pages: ['/sales/leads', '/sales/opportunities', '/sales/follow-ups', '/sales/public-sea'], state: 'RISEMAP 当前 CRM 列表多为空，本目标允许新建合理数据继续走流程。' }, forgeDecision: '线索转客户和商机、商机阶段推进、跟进记录、公海领取为 CRM 后续最小闭环。' };
await writeFile('.objectstack/acceptance/sales-crm-followup-flow-report.json', JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
