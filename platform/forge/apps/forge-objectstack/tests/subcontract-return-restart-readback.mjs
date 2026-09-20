import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4442';
const database = process.env.FORGE_DB || '/tmp/forge-subcontract-return-rerun-20260912.sqlite';
const report = JSON.parse(await readFile('.objectstack/acceptance/subcontract-return-report.json', 'utf8'));
const api = await connect(endpoint);
async function find(object, where = {}) { const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '500' }); const response = await api.request(`/data/${object}?${query}`); assert.equal(response.status, 200, object); return (response.value.records || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value)); }
const record = (await find('forge_subcontract_return', { id: report.returnId }))[0];
assert.ok(record, 'latest accepted return must be readable after restart');
const inbound = (await find('forge_subcontract_return_inbound', { id: report.inboundId }))[0];
const line = (await find('forge_subcontract_return_line', { return_id: record.id }))[0];
const stock = (await find('forge_subcontract_stock_balance', { id: report.stockId }))[0];
const ledger = await find('forge_subcontract_stock_ledger', { source_id: record.id, movement_type: report.movementType });
assert.deepEqual({ returnStatus: record.status, inboundStatus: inbound.status, lineStatus: line.status, onHand: Number(stock.on_hand_quantity), returned: Number(stock.returned_quantity), ledgerRows: ledger.length }, { returnStatus: 'stocked', inboundStatus: 'stocked', lineStatus: 'stocked', onHand: Number(report.result.stockAfter), returned: Number(report.result.returnedTotal), ledgerRows: report.result.ledgerRows });
console.log(JSON.stringify({ suite: 'subcontract-return-restart-readback', status: 'passed', database, returnId: record.id, inboundId: inbound.id, assertion: '同一 SQLite 停服重启后退料单、待入库单、明细、委外库存余额和退料入库流水按本次验收记录回读' }, null, 2));
