import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const forge = await connect(process.env.FORGE_URL || 'http://localhost:4484');
const customerName = process.env.FORGE_CUSTOMER_NAME || '常州星河智能装备有限公司';

async function records(object) {
  const response = await forge.request(`/data/${object}?$top=500`);
  assert.equal(response.status, 200, `${object} should be readable`);
  return response.value.records || [];
}

const customers = await records('forge_customer');
const customer = customers.find((row) => row.name === customerName);
assert.ok(customer, `missing customer ${customerName}`);
assert.equal(customer.customer_type, 'company');
assert.equal(customer.credit_limit, 200000);
assert.equal(customer.payment_days, 30);
assert.equal(customer.city, '常州市');
assert.ok(customer.category_id, 'customer category should be persisted');
assert.ok(customer.responsible_id, 'customer owner should be persisted');

const contacts = await records('forge_contact');
const contact = contacts.find((row) => row.customer_id === customer.id && row.is_primary === true);
assert.ok(contact, 'primary contact should be linked to customer');
assert.equal(contact.name, '王工');
assert.equal(contact.job_title, '项目经理');

const channels = await records('forge_contact_channel');
const mobile = channels.find((row) => row.contact_id === contact.id && row.channel_type === 'mobile');
const email = channels.find((row) => row.contact_id === contact.id && row.channel_type === 'email');
assert.equal(mobile?.value, '13900002611');
assert.equal(email?.value, 'wang@example.invalid');

console.log(`PASS sales customer ${customer.id} -> contact ${contact.id} -> ${mobile.id}/${email.id}`);
