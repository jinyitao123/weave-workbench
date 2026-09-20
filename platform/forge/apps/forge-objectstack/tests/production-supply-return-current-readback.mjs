import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:4356';
const api = await connect(endpoint);
async function find(name, where = {}) {
  const q = new URLSearchParams({ $filter: JSON.stringify(where), $top: '1000' });
  const r = await api.request(`/data/${name}?${q}`);
  assert.equal(r.status, 200, name + ': ' + JSON.stringify(r.value));
  return (r.value.records || []).filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
}
async function read(name, id) {
  const r = await api.request(`/data/${name}/${id}`);
  assert.equal(r.status, 200, name + '/' + id + ': ' + JSON.stringify(r.value));
  return r.value.record;
}

const supplyId = process.env.SUPPLY_ID || '1k6de3VZGpmxUXEN';
const returnId = process.env.RETURN_ID || 'pvL1JOaNGF89Pw7W';
const supply = await read('forge_production_material_document', supplyId);
const returned = await read('forge_production_material_document', returnId);
assert.equal(supply.assembly_id, returned.assembly_id);
assert.equal(supply.document_type, 'supply');
assert.equal(returned.document_type, 'return');
assert.equal(supply.status, 'confirmed');
assert.equal(returned.status, 'confirmed');
assert.equal(Number(supply.total_quantity), 1);
assert.equal(Number(returned.total_quantity), 1);
assert.equal(Number(supply.total_amount), Number(returned.total_amount));

const supplyLines = await find('forge_production_material_document_line', { document_id: supply.id });
const returnLines = await find('forge_production_material_document_line', { document_id: returned.id });
assert.equal(supplyLines.length, 1);
assert.equal(returnLines.length, 1);
assert.equal(supplyLines[0].sku_id, returnLines[0].sku_id);

const supplyLedgers = await find('forge_inventory_ledger', { source_id: supply.id });
const returnLedgers = await find('forge_inventory_ledger', { source_id: returned.id });
assert.equal(supplyLedgers.length, 1);
assert.equal(returnLedgers.length, 1);
assert.equal(supplyLedgers[0].movement_type, 'production_supply');
assert.equal(supplyLedgers[0].direction, 'outbound');
assert.equal(returnLedgers[0].movement_type, 'production_return');
assert.equal(returnLedgers[0].direction, 'inbound');
assert.equal(Number(supplyLedgers[0].after_on_hand), Number(supplyLedgers[0].before_on_hand) - 1);
assert.equal(Number(returnLedgers[0].before_on_hand), Number(supplyLedgers[0].after_on_hand));
assert.equal(Number(returnLedgers[0].after_on_hand), Number(supplyLedgers[0].before_on_hand));

const assembly = await read('forge_assembly_order', supply.assembly_id);
const assemblyLines = await find('forge_assembly_material_line', { assembly_id: assembly.id });
const materialLine = assemblyLines.find((row) => row.sku_id === supplyLines[0].sku_id);
assert.ok(materialLine, '组装单缺少补退料对应物料');
assert.equal(Number(materialLine.supplied_quantity), 1);
assert.equal(Number(materialLine.returned_quantity), 1);
assert.equal(Number(materialLine.issued_quantity) + Number(materialLine.supplied_quantity) - Number(materialLine.returned_quantity), Number(materialLine.required_quantity));

const source = await readFile(new URL('../src/pages/production-material-workspace.page.ts', import.meta.url), 'utf8');
for (const text of ['确认后将按当前单据明细执行库存过账，并生成库存流水', '来源组装单', '物料、数量和审批意见已核对']) assert.ok(source.includes(text), text);
for (const forbidden of ['对象记录', '目标对象', '技术对象', '记录ID']) assert.ok(!source.includes(forbidden), '生产物料页面不应显示技术文案：' + forbidden);

const netQuantity = assemblyLines.reduce((sum, row) => sum + Number(row.issued_quantity || 0) + Number(row.supplied_quantity || 0) - Number(row.returned_quantity || 0), 0);
assert.equal(netQuantity, 10);
assert.equal(Math.round(Number(assembly.material_cost) * 100) / 100, 1015.56);

const report = {
  recordedAt: new Date().toISOString(),
  kind: 'production-supply-return-browser-readback',
  endpoint,
  database: process.env.FORGE_DB || '.objectstack/data/objectstack.db',
  ids: { assembly: assembly.id, supply: supply.id, returned: returned.id, sku: supplyLines[0].sku_id },
  documents: { supply: supply.code, returned: returned.code },
  inventory: {
    beforeSupply: Number(supplyLedgers[0].before_on_hand),
    afterSupply: Number(supplyLedgers[0].after_on_hand),
    afterReturn: Number(returnLedgers[0].after_on_hand),
  },
  assembly: { code: assembly.code, netQuantity, materialCost: Number(assembly.material_cost) },
  passed: true,
};
await mkdir('.objectstack/acceptance', { recursive: true });
await writeFile('.objectstack/acceptance/production-supply-return-current-report.json', JSON.stringify(report, null, 2));
console.log(`PASS ${supply.code} ${report.inventory.beforeSupply}→${report.inventory.afterSupply}, ${returned.code} ${report.inventory.afterSupply}→${report.inventory.afterReturn}; ${assembly.code} 净领用 ${report.assembly.netQuantity}`);
