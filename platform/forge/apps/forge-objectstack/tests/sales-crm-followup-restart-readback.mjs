import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';
const endpoint = process.env.FORGE_URL || 'http://localhost:4321';
const api = await connect(endpoint);
const report = JSON.parse(await readFile('.objectstack/acceptance/sales-crm-followup-flow-report.json', 'utf8'));
assert.equal(report.passed, true);
async function read(object, id) { const r = await api.request(`/data/${object}/${id}`); assert.equal(r.status, 200, `${object}/${id}: ${JSON.stringify(r.value)}`); return r.value.record; }
const [lead, opportunity, followUp, pool, poolCustomer] = await Promise.all([
  read('forge_sales_lead', report.ids.lead), read('forge_sales_opportunity', report.ids.opportunity), read('forge_sales_follow_up', report.ids.followUp), read('forge_customer_pool', report.ids.pool), read('forge_customer', report.ids.poolCustomer),
]);
assert.equal(lead.status, 'converted');
assert.equal(lead.converted_opportunity_id, opportunity.id);
assert.equal(opportunity.stage, 'proposal_quoted');
assert.equal(followUp.status, 'completed');
assert.equal(pool.status, 'claimed');
assert.equal(pool.claimed_customer_id, poolCustomer.id);
await writeFile('.objectstack/acceptance/sales-crm-followup-restart-report.json', JSON.stringify({ recordedAt: new Date().toISOString(), kind: 'forge-sales-crm-followup-restart-readback', endpoint, ids: report.ids, passed: true, result: { lead: lead.status, opportunity: opportunity.stage, followUp: followUp.status, pool: pool.status } }, null, 2));
console.log('PASS CRM follow-up flow survived restart');
