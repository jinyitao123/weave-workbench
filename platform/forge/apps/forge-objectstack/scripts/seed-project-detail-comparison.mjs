import { connect } from './api-client.mjs';

const api = await connect(process.env.FORGE_URL || 'http://localhost:3001');
const projectCode = process.env.PROJECT_CODE || 'PRJ-2026-002';

async function list(object) {
  const response = await api.request(`/data/${object}?$top=500`);
  if (response.status !== 200) throw new Error(`${object} 查询失败：${JSON.stringify(response.value)}`);
  return response.value.records || [];
}
async function one(object, match) { return (await list(object)).find(row => Object.entries(match).every(([key, value]) => row[key] === value)); }
async function create(object, values) {
  const response = await api.request(`/data/${object}`, 'POST', values);
  if (response.status !== 201) throw new Error(`${object} 创建失败：${JSON.stringify(response.value)}`);
  return response.value.id || response.value.record?.id;
}
async function update(object, id, values) {
  const response = await api.request(`/data/${object}/${id}`, 'PATCH', values);
  if (response.status !== 200) throw new Error(`${object} 更新失败：${JSON.stringify(response.value)}`);
}
async function remove(object, id) {
  const response = await api.request(`/data/${object}/${id}`, 'DELETE');
  if (![200, 204].includes(response.status)) throw new Error(`${object} 删除失败：${JSON.stringify(response.value)}`);
}
async function invoke(object, action, id, params = {}) {
  const response = await api.request(`/actions/${object}/${action}/${id}`, 'POST', { params });
  if (response.status !== 200) throw new Error(`${action} 执行失败：${JSON.stringify(response.value)}`);
  return response.value.result || response.value.data?.result || response.value.data || response.value;
}

const project = await one('forge_project', { code: projectCode });
if (!project) throw new Error(`未找到项目 ${projectCode}`);
const userId = project.manager_id;
if (Number(project.budget_amount || 0) !== 0) await update('forge_project', project.id, { budget_amount: 0 });
const contractCode = 'SC-OEM-20260909-001';
let contract = await one('forge_sales_contract', { code: contractCode });
let order;
if (!contract) {
  const contractType = (await list('forge_contract_type'))[0];
  const sku = (await list('forge_material_sku'))[0];
  const contractId = await create('forge_sales_contract', {
    name: '800型柔性线控制柜设备销售框架合同', code: contractCode, contract_type_id: contractType.id,
    customer_id: project.customer_id, project_name: project.name, signed_on: '2026-09-09', starts_on: '2026-09-09', ends_on: '2026-12-31',
    responsible_id: userId, total_amount: 243200, revenue_trigger: 'shipment', payment_term: '验收后30天', delivery_cycle_days: 90, warranty_months: 12,
  });
  contract = { id: contractId, code: contractCode };
  const lineId = await create('forge_sales_contract_line', { name: '800型柔性线控制柜', contract_id: contractId, sku_id: sku.id, item_code: sku.code || 'CAB-800', model: 'CAB-800', specification: '项目定制', unit_name: '台', quantity_limit: 2, ordered_quantity: 0, taxed_unit_price: 121600, tax_rate: 13, discount_rate: 0, taxed_subtotal: 243200 });
  await invoke('forge_sales_contract', 'contract_submit', contractId);
  await invoke('forge_sales_contract', 'contract_approve', contractId);
  const orderId = await create('forge_sales_order', { name: '800型柔性线控制柜项目订单', code: 'SO-OEM-20260909-001', source_type: 'contract', customer_id: project.customer_id, contract_id: contractId, project_name: project.name, planned_delivery_on: '2026-12-20', responsible_id: userId, payment_term: '验收后30天', payment_method: 'bank_transfer', revenue_trigger: 'manual', total_amount: 243200, delivery_address: '项目现场', delivery_contact: '项目联系人' });
  await create('forge_sales_order_line', { name: '800型柔性线控制柜', order_id: orderId, contract_line_id: lineId, sku_id: sku.id, item_code: sku.code || 'CAB-800', model: 'CAB-800', specification: '项目定制', unit_name: '台', quantity: 2, shipped_quantity: 0, invoiced_quantity: 0, taxed_unit_price: 121600, untaxed_unit_price: 107610.62, tax_rate: 13, discount_rate: 0, taxed_subtotal: 243200, planned_delivery_on: '2026-12-20' });
  await invoke('forge_sales_order', 'sales_order_submit', orderId);
  await invoke('forge_sales_order', 'sales_order_approve', orderId);
  order = { id: orderId };
} else order = await one('forge_sales_order', { contract_id: contract.id });
if (!(await one('forge_project_sales_link', { project_id: project.id, order_id: order.id }))) await invoke('forge_project', 'project_link_contract', project.id, { contract_id: contract.id });

const comparisonPurchaseOrder = await one('forge_purchase_order', { code: 'PO-2026-0003' });
if (comparisonPurchaseOrder && comparisonPurchaseOrder.project_id !== project.id) {
  await update('forge_purchase_order', comparisonPurchaseOrder.id, { project_id: project.id, total_amount: 19040, payment_term: '到货验收合格后30天付款', payable_trigger: 'inbound', order_on: '2026-09-21' });
} else if (comparisonPurchaseOrder) {
  await update('forge_purchase_order', comparisonPurchaseOrder.id, { total_amount: 19040, payment_term: '到货验收合格后30天付款', payable_trigger: 'inbound', order_on: '2026-09-21' });
} else if (!comparisonPurchaseOrder) {
  const supplier = (await list('forge_supplier')).find(row => row.name === '南京锐联电气技术有限公司') || (await list('forge_supplier'))[0];
  await create('forge_purchase_order', { name: '项目电气件采购单', code: 'PO-2026-0003', supplier_id: supplier.id, source_type: 'project', project_id: project.id, expected_arrival_on: '2026-10-15', order_on: '2026-09-21', payment_term: '到货验收合格后30天付款', payment_method: 'bank_transfer', currency: 'cny', exchange_rate: 1, payable_trigger: 'inbound', responsible_id: userId, line_count: 1, total_quantity: 4, total_amount: 19040, status: 'partially_arrived' });
}

let exactBom = await one('forge_bom', { code: 'BOM-AUDIT-800-EXACT' });
if (exactBom && !(await list('forge_bom_node')).some(row => row.bom_id === exactBom.id)) {
  await remove('forge_bom', exactBom.id);
  exactBom = null;
}
if (!exactBom) {
  const sourceProject = await one('forge_project', { code: 'PRJ-2026-001' });
  const sourceBom = sourceProject && await one('forge_bom', { project_id: sourceProject.id });
  const category = (await list('forge_material_category'))[0], unit = (await list('forge_unit'))[0];
  const components = [];
  for (const [index, cost] of [5000, 4000, 3000, 2442.48].entries()) {
    const code = `AUDIT-BOM-${index + 1}`;
    let material = await one('forge_material', { code });
    if (!material) material = { id: await create('forge_material', { name: `对照物料${index + 1}`, code, model: `AUDIT-${index + 1}`, category_id: category.id, unit_id: unit.id, property: 'raw_material', source_type: 'purchased', status: 'active', responsible_id: userId }) };
    let sku = await one('forge_material_sku', { code: `${code}-SKU` });
    if (!sku) sku = { id: await create('forge_material_sku', { name: `对照规格${index + 1}`, code: `${code}-SKU`, material_id: material.id, sale_price: cost, cost_price: cost, enabled: true }) };
    components.push(sku.id);
  }
  const bomId = await create('forge_bom', { name: '800型柔性线控制柜总成', code: 'BOM-AUDIT-800-EXACT', product_name: '800型柔性线控制柜', material_id: sourceBom.material_id, bom_type: 'project', version: 'V1.0', family_key: project.id + '-exact', source_bom_id: sourceBom.id, project_id: project.id, customer_id: project.customer_id, tax_rate: 0, change_note: '同材料截图对照', remarks: 'RISEMAP 项目详情 BOM 对照材料' });
  const rootId = await create('forge_bom_node', { name: '800型柔性线控制柜总成', bom_id: bomId, node_type: 'root', quantity: 1, loss_rate: 0, is_key_part: false, is_leaf: false, sort_order: 0, remarks: '同材料截图对照' });
  for (const [index, skuId] of components.entries()) await create('forge_bom_node', { name: `对照物料${index + 1}`, bom_id: bomId, parent_id: rootId, sku_id: skuId, node_type: 'material', quantity: 1, loss_rate: 0, is_key_part: true, is_leaf: true, sort_order: index + 1, remarks: '同材料截图对照' });
  await invoke('forge_bom', 'bom_submit_review', bomId);
  await invoke('forge_bom', 'bom_review', bomId, { decision: 'approve', comment: '同材料截图对照评审' });
  exactBom = { id: bomId };
}

if (!(await one('forge_bom', { code: 'BOM-AUDIT-800-EXACT2' }))) {
  const adjusted = [5650, 4520, 3390, 2760.0024], skuIds = [];
  for (const [index, cost] of adjusted.entries()) {
    const sku = await one('forge_material_sku', { code: `AUDIT-BOM-${index + 1}-SKU` });
    await update('forge_material_sku', sku.id, { cost_price: cost, sale_price: cost });
    skuIds.push(sku.id);
  }
  const sourceProject = await one('forge_project', { code: 'PRJ-2026-001' }), sourceBom = await one('forge_bom', { project_id: sourceProject.id });
  const bomId = await create('forge_bom', { name: '800型柔性线控制柜总成', code: 'BOM-AUDIT-800-EXACT2', product_name: '800型柔性线控制柜', material_id: sourceBom.material_id, bom_type: 'project', version: 'V1.0', family_key: project.id + '-exact2', source_bom_id: sourceBom.id, project_id: project.id, customer_id: project.customer_id, tax_rate: 13, change_note: '同材料截图对照精确成本', remarks: 'RISEMAP 项目详情 BOM 对照材料' });
  const rootId = await create('forge_bom_node', { name: '800型柔性线控制柜总成', bom_id: bomId, node_type: 'root', quantity: 1, loss_rate: 0, is_key_part: false, is_leaf: false, sort_order: 0 });
  for (const [index, skuId] of skuIds.entries()) await create('forge_bom_node', { name: `对照物料${index + 1}`, bom_id: bomId, parent_id: rootId, sku_id: skuId, node_type: 'material', quantity: 1, loss_rate: 0, is_key_part: true, is_leaf: true, sort_order: index + 1 });
  await invoke('forge_bom', 'bom_submit_review', bomId);
  await invoke('forge_bom', 'bom_review', bomId, { decision: 'approve', comment: '同材料截图对照评审' });
}

if (!(await one('forge_bom', { project_id: project.id }))) {
  const sourceProject = await one('forge_project', { code: 'PRJ-2026-001' });
  const sourceBom = sourceProject && await one('forge_bom', { project_id: sourceProject.id });
  if (sourceBom) {
    const bomId = await create('forge_bom', { name: '800型柔性线控制柜总成', code: 'BOM-AUDIT-800', product_name: '800型柔性线控制柜', material_id: sourceBom.material_id, bom_type: 'project', version: 'V1.0', family_key: project.id, source_bom_id: sourceBom.id, project_id: project.id, customer_id: project.customer_id, tax_rate: sourceBom.tax_rate || 13, change_note: '同材料截图对照', remarks: 'RISEMAP 项目详情 BOM 对照材料' });
    const nodes = (await list('forge_bom_node')).filter(row => row.bom_id === sourceBom.id);
    const copied = new Map();
    for (const source of nodes.sort((a, b) => Number(Boolean(a.parent_id)) - Number(Boolean(b.parent_id)))) {
      const nodeId = await create('forge_bom_node', { name: source.name, bom_id: bomId, parent_id: source.parent_id ? copied.get(source.parent_id) : null, sku_id: source.sku_id || null, node_type: source.node_type, quantity: source.quantity, position: source.position || null, loss_rate: source.loss_rate || 0, is_key_part: source.is_key_part === true, is_leaf: source.is_leaf !== false, sort_order: source.sort_order || 0, remarks: '同材料截图对照' });
      copied.set(source.id, nodeId);
    }
    await invoke('forge_bom', 'bom_submit_review', bomId);
    await invoke('forge_bom', 'bom_review', bomId, { decision: 'approve', comment: '同材料截图对照评审' });
  }
}

console.log(JSON.stringify({ project: project.id, contract: contract.id, order: order.id, plan: 'kept empty for same-material comparison' }, null, 2));
