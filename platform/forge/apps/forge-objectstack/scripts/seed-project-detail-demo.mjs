import { connect } from './api-client.mjs';

const api = await connect(process.env.FORGE_URL || 'http://localhost:3001');
const PROJECT_CODE = process.env.PROJECT_CODE || 'PRJ-2026-001';

async function find(object, where = {}) {
  const query = new URLSearchParams({ $filter: JSON.stringify(where), $top: '500' });
  const response = await api.request(`/data/${object}?${query}`);
  if (response.status !== 200) throw new Error(`${object} 查询失败：${JSON.stringify(response.value)}`);
  return (response.value.records || []).filter(record => Object.entries(where).every(([key, value]) => record[key] === value));
}

async function create(object, values) {
  const response = await api.request(`/data/${object}`, 'POST', values);
  if (response.status !== 201) throw new Error(`${object} 创建失败：${JSON.stringify(response.value)}`);
  return response.value.id || response.value.record?.id;
}

async function invoke(object, action, id, params = {}) {
  const response = await api.request(`/actions/${object}/${action}/${id}`, 'POST', { params });
  if (response.status !== 200) throw new Error(`${action} 执行失败：${JSON.stringify(response.value)}`);
  return response.value.result || response.value.data?.result || response.value.data || response.value;
}

async function one(object, where) {
  return (await find(object, where))[0];
}

const project = await one('forge_project', { code: PROJECT_CODE });
if (!project) throw new Error(`未找到项目 ${PROJECT_CODE}`);

let manager = await one('forge_project_member', { project_id: project.id, user_id: project.manager_id });
if (!manager) {
  await create('forge_project_member', {
    name: '项目经理 · Dev Admin', membership_key: `${project.id}:manager`, project_id: project.id,
    user_id: project.manager_id, member_duty: 'manager', joined_on: project.planned_start_on, active: true,
    remarks: '项目详情本地审计走查数据',
  });
}

if (project.status === 'pending') await invoke('forge_project', 'project_start', project.id);

let plan = await one('forge_project_plan', { project_id: project.id, status: 'active' });
if (!plan) {
  const created = await invoke('forge_project', 'project_create_manual_plan', project.id, {
    phase_name: '控制柜方案设计与交付', owner_id: project.manager_id,
    planned_start_on: project.planned_start_on, planned_end_on: project.planned_end_on,
    weight: 30, critical_path: true, planned_deliverable: '经确认的控制柜方案、BOM 与交付资料',
  });
  plan = (await find('forge_project_plan', { project_id: project.id })).find(item => item.id === created.id) || await one('forge_project_plan', { project_id: project.id });
}

const phase = (await find('forge_project_work_item', { plan_id: plan.id })).find(item => item.item_type === 'phase');
for (const task of [
  { name: '确认控制柜技术范围', start: '2026-09-10', end: '2026-09-18', weight: 20, deliverable: '技术范围确认单' },
  { name: '完成电气图纸与项目 BOM', start: '2026-09-19', end: '2026-10-15', weight: 35, deliverable: '受控图纸与项目 BOM' },
  { name: '装配调试并整理交付包', start: '2026-10-16', end: '2026-12-20', weight: 45, deliverable: '调试记录与交付资料包' },
]) {
  if (!(await one('forge_project_work_item', { plan_id: plan.id, name: task.name }))) {
    await invoke('forge_project_plan', 'project_plan_add_work_item', plan.id, {
      item_type: 'task', name: task.name, parent_id: phase.id, owner_id: project.manager_id,
      planned_start_on: task.start, planned_end_on: task.end, weight: task.weight,
      critical_path: true, planned_deliverable: task.deliverable, predecessor_ids: [],
    });
  }
}

let contract = await one('forge_sales_contract', { code: 'SC-PRJ-2026-001' });
let order;
if (!contract) {
  const contractType = (await find('forge_contract_type'))[0];
  const bom = await one('forge_bom', { project_id: project.id });
  const node = (await find('forge_bom_node', { bom_id: bom.id })).find(item => item.sku_id);
  contract = { id: await create('forge_sales_contract', {
    name: '800 型控制柜项目合同', code: 'SC-PRJ-2026-001', contract_type_id: contractType.id,
    customer_id: project.customer_id, project_name: project.name, signed_on: '2026-09-10', starts_on: '2026-09-10', ends_on: '2026-12-31',
    responsible_id: project.manager_id, total_amount: 243200, revenue_trigger: 'shipment', payment_term: '验收后 30 天',
    delivery_cycle_days: 90, warranty_months: 12, remarks: '项目详情本地审计走查合同',
  }) };
  const contractLineId = await create('forge_sales_contract_line', {
    name: '800 型控制柜', contract_id: contract.id, sku_id: node.sku_id, item_code: 'MAT-DL-CAB-800', model: 'CAB-800',
    specification: '标准柜体', unit_name: '台', quantity_limit: 2, ordered_quantity: 0,
    taxed_unit_price: 121600, tax_rate: 13, discount_rate: 0, taxed_subtotal: 243200,
  });
  await invoke('forge_sales_contract', 'contract_submit', contract.id);
  await invoke('forge_sales_contract', 'contract_approve', contract.id);
  order = { id: await create('forge_sales_order', {
    name: '800 型控制柜项目订单', code: 'SO-PRJ-2026-001', source_type: 'contract', customer_id: project.customer_id,
    contract_id: contract.id, project_name: project.name, planned_delivery_on: '2026-12-20', responsible_id: project.manager_id,
    payment_term: '验收后 30 天', payment_method: 'bank_transfer', revenue_trigger: 'manual',
    total_amount: 243200, delivery_address: '项目现场', delivery_contact: '项目联系人', remarks: '项目详情本地审计走查订单',
  }) };
  await create('forge_sales_order_line', {
    name: '800 型控制柜', order_id: order.id, contract_line_id: contractLineId, sku_id: node.sku_id,
    item_code: 'MAT-DL-CAB-800', model: 'CAB-800', specification: '标准柜体', unit_name: '台',
    quantity: 2, shipped_quantity: 0, invoiced_quantity: 0, taxed_unit_price: 121600,
    untaxed_unit_price: 107610.62, tax_rate: 13, discount_rate: 0, taxed_subtotal: 243200, planned_delivery_on: '2026-12-20',
  });
  await invoke('forge_sales_order', 'sales_order_submit', order.id);
  await invoke('forge_sales_order', 'sales_order_approve', order.id);
} else {
  order = await one('forge_sales_order', { contract_id: contract.id });
}

if (!(await one('forge_project_sales_link', { project_id: project.id, order_id: order.id }))) {
  await invoke('forge_project', 'project_link_contract', project.id, { contract_id: contract.id });
}

if (!(await one('forge_project_cost_entry', { code: 'PCOST-PRJ-2026-001' }))) {
  await create('forge_project_cost_entry', {
    name: '控制柜方案设计人工成本', code: 'PCOST-PRJ-2026-001', project_id: project.id, customer_id: project.customer_id,
    source_type: 'manual', cost_type: 'labor', source_id: 'PROJECT-DETAIL-AUDIT', occurred_on: '2026-09-21',
    total_amount: 12800, allocated_amount: 12800, remaining_amount: 0, status: 'allocated',
    responsible_id: project.manager_id, remarks: '项目详情本地审计走查成本',
  });
}

if (!(await one('forge_goodwill_order', { code: 'GW-PRJ-2026-001' }))) {
  await create('forge_goodwill_order', {
    name: '项目现场支持备件', code: 'GW-PRJ-2026-001', customer_id: project.customer_id,
    gift_type: 'onsite_support', reason: '项目交付现场调试备用', item_summary: '控制柜指示灯与接线端子',
    item_name: '现场支持备件包', quantity: 1, unit_name: '套', total_amount: 860,
    responsible_id: project.manager_id, remarks: '客户关联；尚无项目外键',
  });
}

let commissioning = await one('forge_commissioning_record', { code: 'COM-PRJ-2026-001' });
if (!commissioning) {
  const assembly = await one('forge_assembly_order', { code: 'ASM-DL-001' });
  commissioning = { id: await create('forge_commissioning_record', {
    name: '800 型控制柜集成调试', code: 'COM-PRJ-2026-001', project_id: project.id, assembly_id: assembly.id,
    equipment_code: 'CAB-800-01', site: '项目现场', commissioning_on: '2026-12-18', leader_id: project.manager_id,
    remarks: '项目详情本地审计走查调试记录',
  }) };
}

if (!(await one('forge_delivery_package', { code: 'DP-PRJ-2026-001' }))) {
  await create('forge_delivery_package', {
    name: '800 型控制柜 V1 交付包', code: 'DP-PRJ-2026-001', project_id: project.id,
    commissioning_id: commissioning.id, revision: 'V1.0', prepared_on: '2026-12-18', prepared_by: project.manager_id,
    remarks: '图纸、BOM、调试记录与操作维护资料',
  });
}

console.log(JSON.stringify({
  project: project.id, plan: plan.id, contract: contract.id, order: order.id,
  tabs: ['计划进度', '关联订单&合同', '项目成本', '项目BOM', '任务管理', '团队管理', '交付包', 'Goodwill'],
}, null, 2));
