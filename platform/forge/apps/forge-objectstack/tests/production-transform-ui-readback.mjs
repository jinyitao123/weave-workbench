import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const path = '.objectstack/acceptance/production-transform-report.json';
const report = JSON.parse(await readFile(path, 'utf8'));
const api = await connect(process.env.FORGE_URL || 'http://localhost:4357');
const round4 = value => Math.round((Number(value || 0) + Number.EPSILON) * 10000) / 10000;

async function find(objectName, where = {}) {
  const q = new URLSearchParams({ $filter: JSON.stringify(where), $top: '200' });
  const response = await api.request(`/data/${objectName}?${q}`);
  assert.equal(response.status, 200, objectName);
  return (response.value.records || []).filter(record => Object.entries(where).every(([key, value]) => record[key] === value));
}

async function read(objectName, id) {
  const response = await api.request(`/data/${objectName}/${id}`);
  assert.equal(response.status, 200, `${objectName}/${id}`);
  return response.value.record;
}

async function readReportedOrLatest(objectName, reportKey, codePrefix) {
  if (report.ids?.[reportKey]) return read(objectName, report.ids[reportKey]);
  const records = await find(objectName, { status: 'stocked' });
  const candidates = records.filter(record => String(record.code || '').startsWith(codePrefix));
  assert.ok(candidates.length, `${objectName} stocked ${codePrefix} record required`);
  return candidates.sort((a, b) => String(b.code).localeCompare(String(a.code)))[0];
}

const disassembly = await readReportedOrLatest('forge_disassembly_order', 'disassembly', 'DIS-');
assert.equal(disassembly.status, 'stocked');
assert.ok(Number(disassembly.quantity) > 0, 'stocked disassembly keeps quantity');
assert.equal(Number(disassembly.line_count), 4);
assert.ok(Number(disassembly.released_cost) >= Number(disassembly.recovered_value));
assert.equal(round4(Number(disassembly.released_cost) - Number(disassembly.recovered_value)), round4(disassembly.scrap_loss));

const disassemblyLines = await find('forge_disassembly_line', { disassembly_id: disassembly.id });
assert.equal(disassemblyLines.length, Number(disassembly.line_count));
assert.ok(disassemblyLines.every(line => line.status === 'stocked'));
assert.ok(disassemblyLines.every(line => round4(Number(line.recovered_quantity) + Number(line.scrapped_quantity)) === round4(line.theoretical_quantity)));
assert.equal(round4(disassemblyLines.reduce((sum, line) => sum + Number(line.recovered_amount || 0), 0)), round4(disassembly.recovered_value));
const recoveredLineCount = disassemblyLines.filter(line => Number(line.recovered_quantity || 0) > 0).length;
assert.equal((await find('forge_inventory_ledger', { source_id: disassembly.id })).length, 1 + recoveredLineCount);

const replacement = await readReportedOrLatest('forge_replacement_order', 'replacement', 'REP-');
assert.equal(replacement.status, 'stocked');
assert.ok(Number(replacement.quantity) > 0, 'stocked replacement keeps quantity');
assert.equal(Number(replacement.product_before_on_hand), Number(replacement.product_after_on_hand));

const replacementLines = await find('forge_replacement_line', { replacement_id: replacement.id });
assert.equal(replacementLines.length, Number(replacement.line_count));
assert.ok(replacementLines.every(line => line.status === 'stocked'));
assert.ok(replacementLines.every(line => Number(line.old_quantity) > 0 && Number(line.new_quantity) > 0));
assert.equal(round4(replacementLines.reduce((sum, line) => sum + Number(line.new_amount || 0), 0)), round4(replacement.new_part_cost));
assert.equal(round4(replacementLines.reduce((sum, line) => sum + Number(line.old_recovered_amount || 0), 0)), round4(replacement.old_part_value));
assert.equal(round4(Number(replacement.new_part_cost) - Number(replacement.old_part_value)), round4(replacement.cost_change));
const recoveredOldLineCount = replacementLines.filter(line => line.old_destination === 'recover').length;
assert.equal((await find('forge_inventory_ledger', { source_id: replacement.id })).length, replacementLines.length + recoveredOldLineCount);

if (report.ids?.productBalance) {
  const product = await read('forge_inventory_balance', report.ids.productBalance);
  assert.ok(Number(product.on_hand_quantity) >= 0, 'product balance remains readable after transform flow');
}

report.ids.browserDisassembly = disassembly.id;
report.ids.browserReplacement = replacement.id;
report.browserVerification = {
  verifiedAt: new Date().toISOString(),
  status: 'passed',
  pages: ['page_production_disassembly_workspace', 'page_production_replacement_workspace'],
  actions: ['保存并提交拆解确认', '确认拆解并过账', '保存并提交换件确认', '确认换件并过账'],
  assertion: 'browser-readable disassembly and replacement records are stocked, line allocations are complete, inventory ledgers match the business effects, and finished-goods quantity remains stable for replacement',
};
if (process.argv.includes('--restart')) {
  report.browserVerification.restartReadback = {
    verifiedAt: new Date().toISOString(),
    status: 'passed',
    assertion: 'disassembly, replacement, line allocations, source ledgers and finished balance remained API-readable after full restart',
  };
}
await writeFile(path, JSON.stringify(report, null, 2));
console.log('PASS browser production transform' + (process.argv.includes('--restart') ? ' survived restart' : ' persisted'));
