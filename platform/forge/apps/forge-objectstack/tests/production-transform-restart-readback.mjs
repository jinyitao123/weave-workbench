import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/production-transform-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
assert.equal(report.passed, true);
const api = await connect(process.env.FORGE_URL || 'http://localhost:4357');
const round4 = value => Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
async function read(object, id) {
  const response = await api.request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}`);
  return response.value.record;
}
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await api.request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, object);
  return (response.value.records || []).filter(record => Object.entries(where).every(([key, value]) => record[key] === value));
}

const disassemblyDraft = await read('forge_disassembly_order', report.ids.disassemblyDraft);
assert.equal(disassemblyDraft.status, 'pending_approval');
assert.equal(disassemblyDraft.warehouse_id, report.ids.warehouse);
assert.equal((await find('forge_inventory_ledger', { source_id: disassemblyDraft.id })).length, 0);
const disassemblyDraftLines = await find('forge_disassembly_line', { disassembly_id: disassemblyDraft.id });
assert.equal(disassemblyDraftLines.length, 4);
assert.ok(disassemblyDraftLines.every(line => line.status === 'pending_approval'));

const disassembly = await read('forge_disassembly_order', report.ids.disassembly);
assert.deepEqual({ status: disassembly.status, lines: disassembly.line_count, released: disassembly.released_cost, recovered: disassembly.recovered_value, loss: disassembly.scrap_loss },
  { status: 'stocked', lines: 4, released: report.financials.disassembly.releasedCost, recovered: report.financials.disassembly.recoveredValue, loss: report.financials.disassembly.scrapLoss });
const disassemblyLines = await find('forge_disassembly_line', { disassembly_id: disassembly.id });
assert.equal(disassemblyLines.length, 4);
const disassemblyLedgers = await find('forge_inventory_ledger', { source_id: disassembly.id });
const recoveryLedgers = disassemblyLedgers.filter(record => record.movement_type === 'disassembly_recovery');
assert.equal(disassemblyLedgers.filter(record => record.movement_type === 'disassembly_outbound').length, 1);
assert.equal(recoveryLedgers.length, disassemblyLines.filter(line => Number(line.recovered_quantity || 0) > 0).length);
assert.ok(recoveryLedgers.length >= 1);
assert.equal(disassemblyLedgers.length, 1 + recoveryLedgers.length);

const replacementDraft = await read('forge_replacement_order', report.ids.replacementDraft);
assert.equal(replacementDraft.status, 'pending_approval');
assert.equal(replacementDraft.warehouse_id, report.ids.warehouse);
assert.equal((await find('forge_inventory_ledger', { source_id: replacementDraft.id })).length, 0);
const replacementDraftLines = await find('forge_replacement_line', { replacement_id: replacementDraft.id });
assert.ok(replacementDraftLines.length >= 1);
assert.ok(replacementDraftLines.every(line => line.status === 'pending_approval'));

const replacement = await read('forge_replacement_order', report.ids.replacement);
const expectedProductAfterDisassembly = round4(report.sourceDatabaseSnapshot.baseline.product.onHand - report.sourceDatabaseSnapshot.disassemblyQuantity);
assert.deepEqual({ status: replacement.status, lines: replacement.line_count, before: replacement.product_before_on_hand, after: replacement.product_after_on_hand, newCost: replacement.new_part_cost, oldValue: replacement.old_part_value, change: replacement.cost_change },
  { status: 'stocked', lines: 2, before: expectedProductAfterDisassembly, after: expectedProductAfterDisassembly, newCost: report.financials.replacement.newPartCost, oldValue: report.financials.replacement.oldPartValue, change: report.financials.replacement.costChange });
const replacementLines = await find('forge_replacement_line', { replacement_id: replacement.id });
assert.equal(replacementLines.length, 2);
assert.ok(replacementLines.every(line => line.status === 'stocked'));
assert.equal((await find('forge_inventory_ledger', { source_id: replacement.id })).length, 3);
const product = await read('forge_inventory_balance', report.ids.productBalance);
assert.equal(Number(product.on_hand_quantity), expectedProductAfterDisassembly);
assert.equal(Number(product.available_quantity), round4(report.sourceDatabaseSnapshot.baseline.product.available - report.sourceDatabaseSnapshot.disassemblyQuantity));
report.restartVerification = { verifiedAt: new Date().toISOString(), status: 'passed', database: process.env.FORGE_DB || report.database, assertion: 'submitted drafts with persisted warehouses and no ledgers, disassembly order, full allocation lines, finished outbound, current-cost recoveries, replacement order, two lines, three part movements and unchanged replacement finished quantity survived a full server stop/start' };
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS production disassembly and replacement survived full server restart');
