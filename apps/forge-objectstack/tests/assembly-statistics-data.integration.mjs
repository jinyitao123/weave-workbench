import assert from 'node:assert/strict';
import { connect } from '../scripts/api-client.mjs';

const endpoint = process.env.FORGE_URL || 'http://localhost:3001';
const api = await connect(endpoint);
const request = (path, method = 'GET', body) => api.request(path, method, body);
const records = value => value.records || value.data?.records || value.data || [];
const resultOf = response => response.value?.result ?? response.value?.data?.result ?? response.value?.data ?? response.value;
async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '2000' });
  const response = await request(`/data/${object}?${query}`);
  assert.equal(response.status, 200, `${object}: ${JSON.stringify(response.value)}`);
  return records(response.value).filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
}
async function read(object, id) {
  const response = await request(`/data/${object}/${id}`);
  assert.equal(response.status, 200, `${object}/${id}: ${JSON.stringify(response.value)}`);
  return response.value.record;
}
async function invoke(object, action, id, params = {}) {
  const response = await request(`/actions/${object}/${action}/${id}`, 'POST', { params });
  assert.equal(response.status, 200, `${action}: ${JSON.stringify(response.value)}`);
  return resultOf(response);
}

const warehouse = (await find('forge_warehouse'))[0];
const bom = (await find('forge_bom', { code: 'BOM-RM-CAB-800-V1' }))[0];
assert.ok(warehouse, '组装统计验收需要仓库');
assert.ok(bom, '组装统计验收需要标准 BOM');
let activeBom = bom;
if (activeBom.status === 'draft') {
  await invoke('forge_bom', 'bom_submit_review', activeBom.id);
  await invoke('forge_bom', 'bom_review', activeBom.id, { decision: 'approve', comment: '审计走查：结构、数量与成本已核对' });
  activeBom = await read('forge_bom', activeBom.id);
}
assert.equal(activeBom.status, 'active');
const nodes = (await find('forge_bom_node', { bom_id: activeBom.id })).filter(row => row.parent_id && row.sku_id);
assert.equal(nodes.length, 4);

async function ensureAssembly(remarks, quantity, plannedCompletionOn) {
  let order = (await find('forge_assembly_order', { remarks }))[0];
  if (!order) {
    const created = await invoke('forge_bom', 'bom_create_assembly', activeBom.id, {
      mode: 'release', planned_quantity: quantity, warehouse_id: warehouse.id,
      planned_completion_on: plannedCompletionOn, remarks,
    });
    order = await read('forge_assembly_order', created.id);
  }
  return order;
}

let completedAssembly = await ensureAssembly('审计走查组装统计：完整生产链', 1, '2026-09-25');
if (completedAssembly.status === 'waiting_pick') {
  let issue = (await find('forge_production_material_document', { assembly_id: completedAssembly.id, document_type: 'issue' }))[0];
  if (!issue) {
    const created = await invoke('forge_assembly_order', 'assembly_create_material_document', completedAssembly.id, {
      document_type: 'issue', handled_on: '2026-09-21', remarks: '审计走查组装统计：按 BOM 领料',
    });
    issue = await read('forge_production_material_document', created.id);
  }
  if (issue.status === 'pending_approval') await invoke('forge_production_material_document', 'production_material_document_confirm', issue.id, { approval_note: '审计走查：BOM、数量与库存已核对' });
  completedAssembly = await read('forge_assembly_order', completedAssembly.id);
}
if (completedAssembly.status === 'assembling') {
  const assemblyLines = await find('forge_assembly_material_line', { assembly_id: completedAssembly.id });
  const supplyLine = assemblyLines.find(row => row.item_code === 'RM-HMI-700') || assemblyLines[0];
  let supply = (await find('forge_production_material_document', { assembly_id: completedAssembly.id, document_type: 'supply' }))[0];
  if (!supply) {
    const created = await invoke('forge_assembly_order', 'assembly_create_material_document', completedAssembly.id, {
      document_type: 'supply', handled_on: '2026-09-21',
      lines_json: JSON.stringify([{ assembly_line_id: supplyLine.id, quantity: 1 }]),
      remarks: '审计走查组装统计：装配调试补料',
    });
    supply = await read('forge_production_material_document', created.id);
  }
  if (supply.status === 'pending_approval') await invoke('forge_production_material_document', 'production_material_document_confirm', supply.id, { approval_note: '审计走查：补料原因与库存已核对' });
  let materialReturn = (await find('forge_production_material_document', { assembly_id: completedAssembly.id, document_type: 'return' }))[0];
  if (!materialReturn) {
    const created = await invoke('forge_assembly_order', 'assembly_create_material_document', completedAssembly.id, {
      document_type: 'return', handled_on: '2026-09-21',
      lines_json: JSON.stringify([{ assembly_line_id: supplyLine.id, quantity: 1 }]),
      remarks: '审计走查组装统计：调试余料退库',
    });
    materialReturn = await read('forge_production_material_document', created.id);
  }
  if (materialReturn.status === 'pending_approval') await invoke('forge_production_material_document', 'production_material_document_confirm', materialReturn.id, { approval_note: '审计走查：退料未超过净领用' });
  completedAssembly = await read('forge_assembly_order', completedAssembly.id);
  const remaining = Number(completedAssembly.planned_quantity || 0) - Number(completedAssembly.qualified_quantity || 0) - Number(completedAssembly.rejected_quantity || 0);
  if (remaining > 0) await invoke('forge_assembly_order', 'assembly_register_inbound', completedAssembly.id, {
    qualified_quantity: remaining, rejected_quantity: 0, inbound_on: '2026-09-21',
    batch_number: 'ASM-STATS-20260921', remarks: '审计走查组装统计：合格品入库',
  });
  completedAssembly = await read('forge_assembly_order', completedAssembly.id);
  if (completedAssembly.status === 'assembling') await invoke('forge_assembly_order', 'assembly_complete', completedAssembly.id, { completion_note: '审计走查：计划数量已全部入库并确认完工' });
}
completedAssembly = await read('forge_assembly_order', completedAssembly.id);
assert.equal(completedAssembly.status, 'completed');

const waitingAssembly = await ensureAssembly('审计走查组装统计：待领料压力数据', 2, '2026-09-30');
assert.equal(waitingAssembly.status, 'waiting_pick');

let disassembly = (await find('forge_disassembly_order', { remarks: '审计走查组装统计：拆解回收分析' }))[0];
if (!disassembly) {
  const lines = nodes.map(node => ({ bom_node_id: node.id, recovered_quantity: Number(node.quantity || 0), scrapped_quantity: 0 }));
  const created = await invoke('forge_bom', 'bom_create_disassembly', activeBom.id, {
    mode: 'submit', quantity: 1, warehouse_id: warehouse.id, handled_on: '2026-09-21',
    reason: '审计走查拆解回收', lines_json: JSON.stringify(lines), remarks: '审计走查组装统计：拆解回收分析',
  });
  disassembly = await read('forge_disassembly_order', created.id);
}
if (disassembly.status === 'pending_approval') await invoke('forge_disassembly_order', 'disassembly_confirm', disassembly.id, { approval_note: '审计走查：成品、回收数量与库存已核对' });
disassembly = await read('forge_disassembly_order', disassembly.id);
assert.equal(disassembly.status, 'stocked');

let replacement = (await find('forge_replacement_order', { remarks: '审计走查组装统计：换件时效分析' }))[0];
if (!replacement) {
  const oldNode = nodes.find(node => node.sku_id);
  const alternativeSku = (await find('forge_material_sku')).find(row => row.id !== oldNode.sku_id && row.material_id !== activeBom.material_id);
  assert.ok(alternativeSku, '换件统计验收需要不同的新件规格');
  const created = await invoke('forge_bom', 'bom_create_replacement', activeBom.id, {
    mode: 'submit', quantity: 1, warehouse_id: warehouse.id, handled_on: '2026-09-21', reason: '审计走查故障换件',
    lines_json: JSON.stringify([{ old_bom_node_id: oldNode.id, old_quantity: 1, old_destination: 'recover', new_sku_id: alternativeSku.id, new_quantity: 1 }]),
    remarks: '审计走查组装统计：换件时效分析',
  });
  replacement = await read('forge_replacement_order', created.id);
}
if (replacement.status === 'pending_approval') await invoke('forge_replacement_order', 'replacement_confirm', replacement.id, { approval_note: '审计走查：新旧件与库存已核对' });
replacement = await read('forge_replacement_order', replacement.id);
assert.equal(replacement.status, 'stocked');

const assemblies = await find('forge_assembly_order');
const documents = await find('forge_production_material_document');
const inbounds = await find('forge_production_inbound');
console.log(JSON.stringify({
  suite: 'assembly-statistics-data', endpoint, bom: { id: activeBom.id, status: activeBom.status }, warehouse: warehouse.name,
  completedAssembly: { id: completedAssembly.id, code: completedAssembly.code, status: completedAssembly.status, plannedQuantity: completedAssembly.planned_quantity, inboundQuantity: completedAssembly.inbound_quantity },
  waitingAssembly: { id: waitingAssembly.id, code: waitingAssembly.code, status: waitingAssembly.status, plannedQuantity: waitingAssembly.planned_quantity },
  counts: { assemblies: assemblies.length, documents: documents.length, inbounds: inbounds.length, disassemblies: (await find('forge_disassembly_order')).length, replacements: (await find('forge_replacement_order')).length },
  disassembly: { id: disassembly.id, code: disassembly.code, status: disassembly.status, recoveredValue: disassembly.recovered_value },
  replacement: { id: replacement.id, code: replacement.code, status: replacement.status, costChange: replacement.cost_change },
}, null, 2));
