import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const report = JSON.parse(await readFile('.objectstack/acceptance/customer-drawing-draft-report.json', 'utf8'));
const endpoint = process.env.FORGE_URL || 'http://localhost:4356';
const api = await connect(endpoint);
const response = await api.request(`/data/forge_customer_drawing/${report.id}`);
assert.equal(response.status, 200, JSON.stringify(response.value));
const drawing = response.value.record;
assert.equal(drawing.code, report.code);
assert.equal(drawing.status, 'valid');
assert.equal(drawing.contract_number, report.contractNumber);
assert.equal(drawing.order_number, report.orderNumber);
console.log(`PASS customer drawing draft ${report.code} survived full restart as valid`);
