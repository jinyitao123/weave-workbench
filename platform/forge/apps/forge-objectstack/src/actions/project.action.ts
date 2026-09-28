import { defineAction } from '@objectstack/spec';

const locations = ['record_header', 'record_more'] as const;

export const CustomerCreateProject = defineAction({
  name: 'customer_create_project', label: '项目立项', objectName: 'forge_customer', icon: 'briefcase-business',
  locations: [...locations], order: 60, refreshAfter: true,
  requiredPermissions: ['forge_project_operator'],
  description: '建立项目并把指定负责人加入项目团队。合同和订单可在立项后关联。', successMessage: '项目已立项',
  params: [
    { field: 'name', objectOverride: 'forge_project', required: true }, { field: 'type_id', objectOverride: 'forge_project', required: true },
    { field: 'priority', objectOverride: 'forge_project', required: true, defaultValue: 'medium' },
    { field: 'planned_start_on', objectOverride: 'forge_project', required: true }, { field: 'planned_end_on', objectOverride: 'forge_project', required: true },
    { field: 'expected_revenue', objectOverride: 'forge_project' }, { field: 'budget_amount', objectOverride: 'forge_project' },
    { field: 'manager_id', objectOverride: 'forge_project', required: true }, { field: 'description', objectOverride: 'forge_project' },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.project/forge_project/record/${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const customerId = ctx.recordId || (ctx.record && ctx.record.id); const customer = ctx.record;
if (ctx.recordLoadDenied === true || !customerId || !customer) throw new Error('当前客户不存在或不可访问');
const actor = ctx.session && ctx.session.userId;
if (!actor) throw new Error('无法识别当前立项人');
if (!ctx.input.name || !ctx.input.type_id || !ctx.input.manager_id || !ctx.input.planned_start_on || !ctx.input.planned_end_on) throw new Error('项目名称、类型、负责人和计划日期均为必填');
if (ctx.input.planned_end_on < ctx.input.planned_start_on) throw new Error('计划结束日期不得早于计划开始日期');
const type = await ctx.api.object('forge_project_type').findOne({ where: { id: ctx.input.type_id } });
if (!type || type.active === false) throw new Error('项目类型不存在或已停用');
const manager = await ctx.api.object('sys_user').findOne({ where: { id: ctx.input.manager_id } });
if (!manager) throw new Error('项目负责人不存在或不可访问');
return await ctx.api.transaction(async () => {
  const created = await ctx.api.object('forge_project').insert({
    name: ctx.input.name, type_id: ctx.input.type_id, customer_id: customerId,
    owner_id: actor,
    customer_name_snapshot: customer.name, manager_id: ctx.input.manager_id,
    manager_name_snapshot: manager.display_name || manager.name || manager.username || null,
    priority: ctx.input.priority || 'medium', planned_start_on: ctx.input.planned_start_on, planned_end_on: ctx.input.planned_end_on,
    expected_revenue: Number(ctx.input.expected_revenue || 0), budget_amount: Number(ctx.input.budget_amount || 0),
    contract_amount: 0, invoice_amount: 0, collected_amount: 0, total_cost: 0, progress: 0, status: 'pending',
    description: ctx.input.description || null,
  });
  const projectId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
  if (!projectId) throw new Error('项目创建后未返回记录ID');
  await ctx.api.object('forge_project_member').insert({ name: '项目经理', membership_key: projectId + ':' + ctx.input.manager_id,
    project_id: projectId, user_id: ctx.input.manager_id, member_duty: 'manager', joined_on: new Date().toISOString().slice(0, 10), active: true,
    remarks: '立项时自动加入' });
  return { id: projectId, status: 'pending', member_count: 1 };
});
` },
});

export const ProjectRefreshCustomerSnapshot = defineAction({
  name: 'project_refresh_customer_snapshot', label: '补齐客户名称快照', objectName: 'forge_project', icon: 'building-2',
  locations: [...locations], order: 5, refreshAfter: true,
  requiredPermissions: ['forge_project_operator', 'sales_contract_operator'],
  visible: `record.customer_name_snapshot == null && record.created_by == current_user.id`,
  description: '仅由项目创建人同步其本人有权读取的关联客户名称到项目快照，不改变客户档案或读取权限。',
  confirmText: '将关联客户的名称写入本项目快照，让项目团队在项目页查看客户名称？客户档案和客户权限不会改变。',
  successMessage: '项目客户名称已补齐',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const project = ctx.record;
const actor = ctx.session && ctx.session.userId;
if (ctx.recordLoadDenied === true || !id || !project) throw new Error('当前项目不存在或不可访问');
if (!actor || project.created_by !== actor) throw new Error('仅项目创建人可以补齐客户名称快照');
if (String(project.customer_name_snapshot || '').trim()) return { id, status: 'unchanged' };
const customer = await ctx.api.object('forge_customer').findOne({
  where: { id: project.customer_id }, fields: ['id', 'name', 'owner_id'],
});
if (!customer || String(customer.owner_id || '') !== String(actor)) throw new Error('当前账号无法读取此项目关联客户');
const customerName = String(customer.name || '').trim();
if (!customerName) throw new Error('关联客户没有可用于项目快照的名称');
await ctx.api.object('forge_project').update({ id, customer_name_snapshot: customerName });
return { id, status: 'updated' };
` },
});

export const ProjectReadDeliveryScope = defineAction({
  name: 'project_read_delivery_scope', label: '读取项目物料与服务范围', objectName: 'forge_project', icon: 'list-checks',
  locations: [...locations], order: 6,
  requiredPermissions: ['forge_project_operator'],
  description: '仅从当前可读项目已关联的有效合同和订单读取物料/服务明细，不读取同客户的其他单据。',
  successMessage: '项目物料与服务范围已读取',
  body: { language: 'js', capabilities: ['api.read'], source: `
const projectId = ctx.recordId || (ctx.record && ctx.record.id); const project = ctx.record;
if (ctx.recordLoadDenied === true || !projectId || !project) throw new Error('当前项目不存在或不可访问');
const eligibleOrderStatuses = ['approved', 'active', 'partially_shipped', 'shipped', 'completed'];
const round4 = value => Math.round((Number(value || 0) + Number.EPSILON) * 10000) / 10000;
const sameNumber = (left, right) => Math.abs(Number(left || 0) - Number(right || 0)) < 0.0001;
const scope = { sources: [], lines: [], warnings: [] };
const links = await ctx.api.object('forge_project_sales_link').find({
  where: { project_id: projectId },
  fields: ['id', 'project_id', 'contract_id', 'order_id', 'contract_code_snapshot', 'order_code_snapshot'],
});
for (const link of links) {
  if (!link.contract_id || !link.order_id) {
    scope.warnings.push('项目关联记录缺少合同或订单来源');
    continue;
  }
  const [contract, order] = await Promise.all([
    ctx.api.object('forge_sales_contract').findOne({ where: { id: link.contract_id }, fields: ['id', 'code', 'customer_id', 'quotation_id', 'status', 'signed_on', 'signed_evidence_attachment'] }),
    ctx.api.object('forge_sales_order').findOne({ where: { id: link.order_id }, fields: ['id', 'code', 'customer_id', 'contract_id', 'quotation_id', 'status'] }),
  ]);
  if (!contract || !order || contract.customer_id !== project.customer_id || order.customer_id !== project.customer_id || order.contract_id !== contract.id) {
    scope.warnings.push('项目关联的合同、订单与客户来源不一致');
    continue;
  }
  if (contract.status !== 'active' || !contract.signed_on || !contract.signed_evidence_attachment) {
    scope.warnings.push('已关联合同缺少有效审批状态或客户签署凭证');
    continue;
  }
  if (!eligibleOrderStatuses.includes(order.status)) {
    scope.warnings.push('已关联订单当前状态不在项目交付范围内');
    continue;
  }
  const quotationId = contract.quotation_id || order.quotation_id;
  const quotation = quotationId ? await ctx.api.object('forge_quotation').findOne({
    where: { id: quotationId }, fields: ['id', 'code', 'customer_id', 'status', 'pricing_version', 'accepted_pricing_version', 'customer_acceptance_evidence_attachment'],
  }) : null;
  const [contractLines, orderLines, quotationLines] = await Promise.all([
    ctx.api.object('forge_sales_contract_line').find({ where: { contract_id: contract.id }, fields: ['id', 'name', 'line_type', 'quotation_line_id', 'sku_id', 'item_code', 'model', 'specification', 'unit_name', 'quantity_limit', 'taxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal'] }),
    ctx.api.object('forge_sales_order_line').find({ where: { order_id: order.id }, fields: ['id', 'name', 'line_type', 'contract_line_id', 'quotation_line_id', 'sku_id', 'item_code', 'model', 'specification', 'unit_name', 'quantity', 'taxed_unit_price', 'untaxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal'] }),
    quotation ? ctx.api.object('forge_quotation_line').find({ where: { quotation_id: quotation.id }, fields: ['id', 'quotation_id', 'name', 'line_type', 'sku_id', 'item_code', 'model', 'specification', 'unit_name', 'quantity', 'taxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal'] }) : Promise.resolve([]),
  ]);
  const quotationRequired = Boolean(contract.quotation_id || order.quotation_id || contractLines.some(line => line.quotation_line_id) || orderLines.some(line => line.quotation_line_id));
  const quotationVersionValid = quotationRequired
    ? Boolean(quotation && contract.quotation_id === quotation.id && order.quotation_id === quotation.id && quotation.customer_id === project.customer_id && quotation.status === 'accepted' && quotation.customer_acceptance_evidence_attachment && Number(quotation.accepted_pricing_version) === Number(quotation.pricing_version || 0))
    : true;
  if (quotationRequired && !quotationVersionValid) scope.warnings.push('订单来源报价或客户接受核价版本未通过核对');
  const contractById = new Map(contractLines.map(line => [line.id, line]));
  const quotationById = new Map(quotationLines.map(line => [line.id, line]));
  const source = { quotation_code: quotation?.code || '', accepted_pricing_version: quotation?.accepted_pricing_version ?? null, contract_code: contract.code || link.contract_code_snapshot || '', order_code: order.code || link.order_code_snapshot || '', order_status: order.status, source_version_valid: quotationRequired ? quotationVersionValid : null };
  scope.sources.push(source);
  if (!orderLines.length) scope.warnings.push('已关联订单没有可读的物料或服务明细');
  for (let index = 0; index < orderLines.length; index++) {
    const orderLine = orderLines[index];
    const contractLine = contractById.get(orderLine.contract_line_id);
    const quotationLineId = orderLine.quotation_line_id || contractLine?.quotation_line_id;
    const quotationLine = quotationById.get(quotationLineId);
    const issues = [];
    if (!contractLine) issues.push('未找到来源合同明细');
    if (quotationRequired && !quotationLine) issues.push('未找到原报价明细');
    if (quotationRequired && !quotationVersionValid) issues.push('报价接受核价版本未通过核对');
    if (contractLine) {
      if (quotationRequired && quotationLine && (contractLine.quotation_line_id !== quotationLine.id || quotationLine.quotation_id !== quotation.id || orderLine.quotation_line_id !== quotationLine.id)) issues.push('报价、合同与订单行来源关系不一致');
      if (contractLine.line_type !== orderLine.line_type || contractLine.name !== orderLine.name || (quotationLine && (quotationLine.line_type !== contractLine.line_type || quotationLine.name !== contractLine.name))) issues.push('报价、合同与订单行类型或名称不一致');
      if ((quotationLine && !sameNumber(quotationLine.quantity, contractLine.quantity_limit)) || !(Number(orderLine.quantity || 0) > 0) || Number(orderLine.quantity || 0) > Number(contractLine.quantity_limit || 0) + 0.0001) issues.push('报价、合同与订单数量不一致');
      if (!sameNumber(contractLine.taxed_unit_price, orderLine.taxed_unit_price) || !sameNumber(contractLine.tax_rate, orderLine.tax_rate) || !sameNumber(contractLine.discount_rate, orderLine.discount_rate) || (quotationLine && (!sameNumber(quotationLine.taxed_unit_price, contractLine.taxed_unit_price) || !sameNumber(quotationLine.tax_rate, contractLine.tax_rate) || !sameNumber(quotationLine.discount_rate, contractLine.discount_rate)))) issues.push('报价、合同与订单价税不一致');
      const expectedOrderSubtotal = Number(contractLine.quantity_limit) > 0 ? round4(Number(contractLine.taxed_subtotal) * Number(orderLine.quantity) / Number(contractLine.quantity_limit)) : null;
      if (expectedOrderSubtotal === null || !sameNumber(expectedOrderSubtotal, orderLine.taxed_subtotal) || (quotationLine && !sameNumber(quotationLine.taxed_subtotal, contractLine.taxed_subtotal))) issues.push('报价、合同与订单含税小计不一致');
      if (orderLine.line_type === 'service' && (contractLine.sku_id || orderLine.sku_id || (quotationLine && quotationLine.sku_id))) issues.push('服务项目不应关联物料规格');
      if (orderLine.line_type === 'material' && (!contractLine.sku_id || !orderLine.sku_id || (quotationLine && !quotationLine.sku_id))) issues.push('物料行缺少物料规格');
    }
    const taxRate = Number(orderLine.tax_rate || 0) / 100;
    scope.lines.push({
      line_key: (source.order_code || source.contract_code || 'order') + ':' + String(index + 1).padStart(3, '0'),
      quotation_code: source.quotation_code, accepted_pricing_version: source.accepted_pricing_version,
      contract_code: source.contract_code, order_code: source.order_code,
      line_type: orderLine.line_type, name: orderLine.name, item_code: orderLine.item_code || '', model: orderLine.model || '', specification: orderLine.specification || '', unit_name: orderLine.unit_name || '',
      quote_quantity: quotationLine?.quantity ?? null, contract_quantity: contractLine?.quantity_limit ?? null, quantity: Number(orderLine.quantity || 0),
      taxed_unit_price: Number(orderLine.taxed_unit_price || 0), tax_rate: Number(orderLine.tax_rate || 0), taxed_subtotal: Number(orderLine.taxed_subtotal || 0),
      tax_amount: taxRate > 0 ? round4(Number(orderLine.taxed_subtotal || 0) * taxRate / (1 + taxRate)) : 0,
      trace_consistent: issues.length === 0, trace_issues: issues,
    });
  }
}
return scope;
` },
});

export const ProjectStart = defineAction({
  name: 'project_start', label: '开始执行', objectName: 'forge_project', icon: 'play',
  locations: [...locations], order: 10, visible: `record.status == 'pending'`, refreshAfter: true,
  requiredPermissions: ['forge_project_manager'],
  confirmText: '开始执行后，项目基本信息应作为立项基线保留；计划、任务和团队可继续维护。是否继续？', successMessage: '项目已开始执行',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const project = ctx.record;
if (ctx.recordLoadDenied === true || !id || !project) throw new Error('当前项目不存在或不可访问');
if (project.status !== 'pending') throw new Error('仅待执行项目可以开始执行');
const managers = await ctx.api.object('forge_project_member').find({ where: { project_id: id, member_duty: 'manager', active: true } });
if (!managers.length || !managers.some(item => item.user_id === project.manager_id)) throw new Error('项目经理必须是有效团队成员');
const actualStart = new Date().toISOString().slice(0, 10);
await ctx.api.object('forge_project').update({ id, status: 'in_progress', actual_start_on: actualStart });
return { id, status: 'in_progress', actual_start_on: actualStart };
` },
});

export const ProjectLinkContract = defineAction({
  name: 'project_link_contract', label: '关联合同及订单', objectName: 'forge_project', icon: 'link',
  locations: [...locations], order: 20, visible: `record.status != 'settled' && record.status != 'archived' && record.status != 'terminated'`, refreshAfter: true,
  requiredPermissions: ['forge_project_operator', 'sales_contract_operator'],
  description: '关联销售合同，并自动带入合同下全部非草稿、未取消订单。', successMessage: '合同和订单已关联',
  params: [{ field: 'contract_id', objectOverride: 'forge_project_sales_link', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write', 'api.transaction'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const project = ctx.record;
if (ctx.recordLoadDenied === true || !id || !project) throw new Error('当前项目不存在或不可访问');
return await ctx.api.transaction(async () => {
const currentProject = await ctx.api.object('forge_project').findOne({ where: { id } });
if (!currentProject) throw new Error('当前项目不存在或不可访问');
const contract = await ctx.api.object('forge_sales_contract').findOne({ where: { id: ctx.input.contract_id } });
if (!contract || contract.customer_id !== currentProject.customer_id) throw new Error('所选合同必须属于项目客户');
if (contract.status !== 'active' || !contract.signed_on || !contract.signed_evidence_attachment) throw new Error('所选合同必须已完成内部审批并归档客户签署凭证');
const contractType = contract.contract_type_id ? await ctx.api.object('forge_contract_type').findOne({ where: { id: contract.contract_type_id } }) : null;
const orders = await ctx.api.object('forge_sales_order').find({ where: { contract_id: contract.id } });
const eligible = orders.filter(order => ['approved', 'active', 'partially_shipped', 'shipped', 'completed'].includes(order.status));
if (!eligible.length) throw new Error('合同下没有可关联的非草稿订单');
const round2 = value => Math.round((value + Number.EPSILON) * 100) / 100;
  for (const order of eligible) {
    const key = id + ':' + order.id;
    const existing = await ctx.api.object('forge_project_sales_link').findOne({ where: { link_key: key } });
    const collected = round2(Number(order.collected_amount || 0));
    const values = { name: (contract.code || contract.name) + ' / ' + (order.code || order.name), link_key: key, project_id: id,
      contract_id: contract.id, order_id: order.id, contract_code_snapshot: contract.code || '',
      contract_type_snapshot: contractType?.name || '', signed_on_snapshot: contract.signed_on,
      order_code_snapshot: order.code || '', order_status_snapshot: order.status,
      order_amount: Number(order.total_amount || 0), invoice_amount: Number(order.invoiced_amount || 0), collected_amount: collected,
      remarks: '关联已签署合同后带入有效订单' };
    if (existing) await ctx.api.object('forge_project_sales_link').update({ id: existing.id, ...values });
    else await ctx.api.object('forge_project_sales_link').insert(values);
  }
  const links = await ctx.api.object('forge_project_sales_link').find({ where: { project_id: id } });
  const eligibleIds = new Set(eligible.map(order => order.id));
  const currentLinks = links.filter(item => eligibleIds.has(item.order_id));
  const contractAmount = round2(currentLinks.reduce((sum, item) => sum + Number(item.order_amount || 0), 0));
  const invoiceAmount = round2(currentLinks.reduce((sum, item) => sum + Number(item.invoice_amount || 0), 0));
  const collectedAmount = round2(currentLinks.reduce((sum, item) => sum + Number(item.collected_amount || 0), 0));
  await ctx.api.object('forge_project').update({ id, contract_amount: contractAmount, invoice_amount: invoiceAmount, collected_amount: collectedAmount });
  return { id, contract_id: contract.id, order_count: currentLinks.length, contract_amount: contractAmount, invoice_amount: invoiceAmount, collected_amount: collectedAmount };
});
` },
});

export const ProjectPause = defineAction({
  name: 'project_pause', label: '暂停', objectName: 'forge_project', icon: 'pause',
  locations: [...locations], order: 30, visible: `record.status == 'in_progress'`, refreshAfter: true,
  requiredPermissions: ['forge_project_manager'],
  description: '暂停后项目仍保留现有计划和记录，但停止按进行中状态推进。请填写暂停原因并确认。',
  params: [{ field: 'pause_reason', objectOverride: 'forge_project', required: true }], successMessage: '项目已暂停',
  body: { language: 'js', capabilities: ['api.write'], source: `const id=ctx.recordId||(ctx.record&&ctx.record.id); if(!id||!ctx.record||ctx.record.status!=='in_progress') throw new Error('仅进行中项目可以暂停'); await ctx.api.object('forge_project').update({id,status:'paused',pause_reason:ctx.input.pause_reason}); return {id,status:'paused'};` },
});

export const ProjectResume = defineAction({
  name: 'project_resume', label: '恢复执行', objectName: 'forge_project', icon: 'play',
  locations: [...locations], order: 10, visible: `record.status == 'paused'`, refreshAfter: true, confirmText: '确认恢复项目执行？', successMessage: '项目已恢复执行',
  requiredPermissions: ['forge_project_manager'],
  body: { language: 'js', capabilities: ['api.write'], source: `const id=ctx.recordId||(ctx.record&&ctx.record.id); if(!id||!ctx.record||ctx.record.status!=='paused') throw new Error('仅已暂停项目可以恢复执行'); await ctx.api.object('forge_project').update({id,status:'in_progress'}); return {id,status:'in_progress'};` },
});

export const ProjectTerminate = defineAction({
  name: 'project_terminate', label: '终止', objectName: 'forge_project', icon: 'octagon-x',
  locations: [...locations], order: 90, visible: `record.status == 'pending' || record.status == 'in_progress' || record.status == 'paused'`, refreshAfter: true,
  requiredPermissions: ['forge_project_manager'],
  description: '终止后项目不能继续按正常执行流程推进，现有计划、任务和业务记录将保留用于追溯。请填写终止原因并确认。',
  params: [{ field: 'termination_reason', objectOverride: 'forge_project', required: true }], successMessage: '项目已终止',
  body: { language: 'js', capabilities: ['api.write'], source: `const id=ctx.recordId||(ctx.record&&ctx.record.id); if(!id||!ctx.record||!['pending','in_progress','paused'].includes(ctx.record.status)) throw new Error('当前项目不能终止'); await ctx.api.object('forge_project').update({id,status:'terminated',termination_reason:ctx.input.termination_reason}); return {id,status:'terminated'};` },
});

export const ProjectCreateManualPlan = defineAction({
  name: 'project_create_manual_plan', label: '手工创建计划', objectName: 'forge_project', icon: 'calendar-plus',
  requiredPermissions: ['forge_project_manager'],
  locations: [...locations], order: 40, visible: `record.status == 'in_progress' || record.status == 'paused'`, refreshAfter: true,
  description: '从一个阶段开始建立项目计划，也可以在后续从项目配置中心套用可用模板。', successMessage: '项目计划和首个阶段已创建',
  params: [
    { field: 'phase_name', objectOverride: 'forge_project_work_item', required: true },
    { field: 'owner_id', objectOverride: 'forge_project_work_item' },
    { field: 'planned_start_on', objectOverride: 'forge_project_work_item', required: true },
    { field: 'planned_end_on', objectOverride: 'forge_project_work_item', required: true },
    { field: 'weight', objectOverride: 'forge_project_work_item', defaultValue: 20 },
    { field: 'critical_path', objectOverride: 'forge_project_work_item', defaultValue: false },
    { field: 'planned_deliverable', objectOverride: 'forge_project_work_item' },
  ],
  onSuccess: { navigate: '/_console/apps/com.inoforge.forge.project/forge_project_plan/record/${result.id}' },
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const projectId = ctx.recordId || (ctx.record && ctx.record.id); const project = ctx.record;
if (ctx.recordLoadDenied === true || !projectId || !project) throw new Error('当前项目不存在或不可访问');
if (!['in_progress','paused'].includes(project.status)) throw new Error('仅进行中或已暂停项目可以创建计划');
if (!ctx.input.phase_name || !ctx.input.planned_start_on || !ctx.input.planned_end_on) throw new Error('首个阶段和计划日期均为必填');
if (ctx.input.planned_end_on < ctx.input.planned_start_on) throw new Error('计划结束日期不得早于计划开始日期');
const existing = await ctx.api.object('forge_project_plan').find({ where: { project_id: projectId, status: 'active' } });
if (existing.length) throw new Error('当前项目已经存在执行中的计划');
const start = Date.parse(ctx.input.planned_start_on), end = Date.parse(ctx.input.planned_end_on);
const duration = Math.floor((end - start) / 86400000);
let planId = null, phaseId = null;
try {
  const plan = await ctx.api.object('forge_project_plan').insert({ name: project.name + '计划 V1', plan_key: projectId + ':R1', project_id: projectId,
    source: 'manual', revision: 1, planned_start_on: ctx.input.planned_start_on, planned_end_on: ctx.input.planned_end_on,
    status: 'active', item_count: 1, progress: 0, remarks: '从首个阶段手工创建' });
  planId = typeof plan === 'string' ? plan : plan && (plan.id || (plan.record && plan.record.id));
  if (!planId) throw new Error('项目计划创建后未返回记录ID');
  const phase = await ctx.api.object('forge_project_work_item').insert({ name: ctx.input.phase_name, item_key: planId + ':1', project_id: projectId,
    plan_id: planId, item_type: 'phase', owner_id: ctx.input.owner_id || project.manager_id || null,
    planned_start_on: ctx.input.planned_start_on, planned_end_on: ctx.input.planned_end_on, duration_days: duration,
    weight: Number(ctx.input.weight == null ? 20 : ctx.input.weight), critical_path: ctx.input.critical_path === true,
    planned_deliverable: ctx.input.planned_deliverable || null, status: 'pending', progress: 0, sort_order: 10 });
  phaseId = typeof phase === 'string' ? phase : phase && (phase.id || (phase.record && phase.record.id));
  if (!phaseId) throw new Error('首个阶段创建后未返回记录ID');
} catch (error) {
  if (planId) await ctx.api.object('forge_project_plan').delete({ where: { id: planId } });
  throw error;
}
return { id: planId, project_id: projectId, phase_id: phaseId, source: 'manual', item_count: 1 };
` },
});

export const ProjectPlanAddWorkItem = defineAction({
  name: 'project_plan_add_work_item', label: '新增阶段/里程碑/任务', objectName: 'forge_project_plan', icon: 'list-plus',
  requiredPermissions: ['forge_project_manager'],
  locations: [...locations], order: 10, visible: `record.status == 'active'`, refreshAfter: true,
  description: '按 RISEMAP 计划页字段添加阶段、里程碑或任务。', successMessage: '计划工作项已添加',
  params: [
    { field: 'item_type', objectOverride: 'forge_project_work_item', required: true },
    { field: 'name', objectOverride: 'forge_project_work_item', required: true },
    { field: 'parent_id', objectOverride: 'forge_project_work_item' }, { field: 'owner_id', objectOverride: 'forge_project_work_item' },
    { field: 'planned_start_on', objectOverride: 'forge_project_work_item', required: true },
    { field: 'planned_end_on', objectOverride: 'forge_project_work_item', required: true },
    { field: 'predecessor_ids', objectOverride: 'forge_project_work_item', multiple: true },
    { field: 'weight', objectOverride: 'forge_project_work_item', defaultValue: 20 },
    { field: 'critical_path', objectOverride: 'forge_project_work_item', defaultValue: false },
    { field: 'planned_deliverable', objectOverride: 'forge_project_work_item' },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const planId = ctx.recordId || (ctx.record && ctx.record.id); const plan = ctx.record;
if (ctx.recordLoadDenied === true || !planId || !plan) throw new Error('当前项目计划不存在或不可访问');
if (plan.status !== 'active') throw new Error('仅执行中的计划可以添加工作项');
if (!['phase','milestone','task'].includes(ctx.input.item_type)) throw new Error('工作项类型必须是阶段、里程碑或任务');
if (!ctx.input.name || !ctx.input.planned_start_on || !ctx.input.planned_end_on) throw new Error('名称和计划日期均为必填');
if (ctx.input.planned_end_on < ctx.input.planned_start_on) throw new Error('计划结束日期不得早于计划开始日期');
if (ctx.input.item_type === 'phase' && ctx.input.parent_id) throw new Error('阶段必须是顶层工作项');
if (ctx.input.parent_id) {
  const parent = await ctx.api.object('forge_project_work_item').findOne({ where: { id: ctx.input.parent_id } });
  if (!parent || parent.plan_id !== planId || parent.item_type !== 'phase') throw new Error('所属阶段必须来自当前计划');
}
const predecessorIds = Array.isArray(ctx.input.predecessor_ids) ? ctx.input.predecessor_ids : (ctx.input.predecessor_ids ? [ctx.input.predecessor_ids] : []);
for (const predecessorId of predecessorIds) {
  const predecessor = await ctx.api.object('forge_project_work_item').findOne({ where: { id: predecessorId } });
  if (!predecessor || predecessor.plan_id !== planId || predecessor.item_type === 'phase') throw new Error('前置任务必须是当前计划中的任务或里程碑');
}
const duplicates = await ctx.api.object('forge_project_work_item').find({ where: { plan_id: planId, name: ctx.input.name } });
if (duplicates.length) throw new Error('当前计划已存在同名工作项');
const items = await ctx.api.object('forge_project_work_item').find({ where: { plan_id: planId } });
const start = Date.parse(ctx.input.planned_start_on), end = Date.parse(ctx.input.planned_end_on);
const duration = Math.floor((end - start) / 86400000);
let itemId = null;
try {
  const created = await ctx.api.object('forge_project_work_item').insert({ name: ctx.input.name, item_key: planId + ':' + (items.length + 1),
    project_id: plan.project_id, plan_id: planId, item_type: ctx.input.item_type, parent_id: ctx.input.parent_id || null,
    owner_id: ctx.input.owner_id || null, planned_start_on: ctx.input.planned_start_on, planned_end_on: ctx.input.planned_end_on,
    duration_days: duration, predecessor_ids: predecessorIds, weight: Number(ctx.input.weight == null ? 20 : ctx.input.weight),
    critical_path: ctx.input.critical_path === true, planned_deliverable: ctx.input.planned_deliverable || null,
    status: 'pending', progress: 0, sort_order: (items.length + 1) * 10 });
  itemId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
  if (!itemId) throw new Error('计划工作项创建后未返回记录ID');
  const leafProgress = items.filter(item => item.item_type !== 'phase').map(item => Number(item.progress || 0));
  if (ctx.input.item_type !== 'phase') leafProgress.push(0);
  const planProgress = leafProgress.length ? Math.round(leafProgress.reduce((sum, value) => sum + value, 0) / leafProgress.length) : 0;
  await ctx.api.object('forge_project_plan').update({ id: planId, item_count: items.length + 1, progress: planProgress });
  await ctx.api.object('forge_project').update({ id: plan.project_id, progress: planProgress });
} catch (error) {
  if (itemId) await ctx.api.object('forge_project_work_item').delete({ where: { id: itemId } });
  throw error;
}
return { id: itemId, plan_id: planId, item_type: ctx.input.item_type, item_count: items.length + 1 };
` },
});

export const ProjectWorkItemDelete = defineAction({
  name: 'project_work_item_delete', label: '删除工作项', objectName: 'forge_project_work_item', icon: 'trash-2',
  requiredPermissions: ['forge_project_manager'],
  locations: [...locations], order: 90, visible: `record.status != 'completed'`, refreshAfter: true,
  confirmText: '删除后无法恢复。阶段下仍有任务或里程碑时必须先处理下级工作项。确认删除？', successMessage: '计划工作项已删除',
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const item = ctx.record;
if (ctx.recordLoadDenied === true || !id || !item) throw new Error('当前工作项不存在或不可访问');
if (item.status === 'completed') throw new Error('已完成工作项不能删除');
const children = await ctx.api.object('forge_project_work_item').find({ where: { parent_id: id } });
if (children.length) throw new Error('当前阶段仍有任务或里程碑，请先处理下级工作项');
const reports = await ctx.api.object('forge_project_daily_report').find({ where: { work_item_id: id } });
if (reports.length) throw new Error('当前工作项已有日报记录，不能删除');
const siblings = await ctx.api.object('forge_project_work_item').find({ where: { plan_id: item.plan_id } });
for (const sibling of siblings) {
  const predecessors = Array.isArray(sibling.predecessor_ids) ? sibling.predecessor_ids : [];
  if (predecessors.includes(id)) throw new Error('当前工作项仍被其他任务设为前置任务，不能删除');
}
await ctx.api.object('forge_project_work_item').delete({ where: { id } });
const remaining = siblings.filter(sibling => sibling.id !== id), leafValues = remaining.filter(sibling => sibling.item_type !== 'phase').map(sibling => Number(sibling.progress || 0));
const planProgress = leafValues.length ? Math.round(leafValues.reduce((sum, value) => sum + value, 0) / leafValues.length) : 0;
await ctx.api.object('forge_project_plan').update({ id: item.plan_id, item_count: remaining.length, progress: planProgress });
await ctx.api.object('forge_project').update({ id: item.project_id, progress: planProgress });
return { id, plan_id: item.plan_id, deleted: true, item_count: remaining.length, plan_progress: planProgress };
` },
});

export const ProjectWorkItemUpdateProgress = defineAction({
  name: 'project_work_item_update_progress', label: '更新进度', objectName: 'forge_project_work_item', icon: 'gauge',
  requiredPermissions: ['forge_project_work_member'],
  locations: [...locations], order: 10, visible: `record.item_type != 'phase'`, refreshAfter: true,
  description: '更新完成度、状态和实际日期，并回算计划与项目进度；尚未开始的新增工作项不立即拉低阶段进度。', successMessage: '工作项进度已更新',
  params: [
    { field: 'progress', objectOverride: 'forge_project_work_item', required: true },
    { field: 'status', objectOverride: 'forge_project_work_item' },
    { field: 'actual_start_on', objectOverride: 'forge_project_work_item' },
    { field: 'actual_end_on', objectOverride: 'forge_project_work_item' },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const id = ctx.recordId || (ctx.record && ctx.record.id); const item = ctx.record;
if (ctx.recordLoadDenied === true || !id || !item) throw new Error('当前工作项不存在或不可访问');
if (item.item_type === 'phase') throw new Error('阶段进度由下级任务和里程碑自动汇总');
const progress = Number(ctx.input.progress);
if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error('完成度必须在 0 到 100 之间');
const today = new Date().toISOString().slice(0, 10);
let status = ctx.input.status || (progress === 0 ? 'pending' : (progress === 100 ? 'completed' : 'in_progress'));
if (!['pending','in_progress','completed','delayed','cancelled'].includes(status)) throw new Error('工作项状态不合法');
if (status === 'completed' && progress !== 100) throw new Error('已完成工作项的完成度必须是 100');
if (status === 'pending' && progress !== 0) throw new Error('未开始工作项的完成度必须是 0');
let actualStart = ctx.input.actual_start_on || item.actual_start_on || null;
let actualEnd = ctx.input.actual_end_on || item.actual_end_on || null;
if (progress > 0 && !actualStart) actualStart = today;
if (status === 'completed' && !actualEnd) actualEnd = today;
if (actualEnd && !actualStart) throw new Error('填写实际完成日期前必须先有实际开始日期');
if (actualStart && actualEnd && actualEnd < actualStart) throw new Error('实际完成日期不得早于实际开始日期');
await ctx.api.object('forge_project_work_item').update({ id, progress, status, actual_start_on: actualStart, actual_end_on: actualEnd });
let phaseProgress = null;
if (item.parent_id) {
  const children = await ctx.api.object('forge_project_work_item').find({ where: { parent_id: item.parent_id } });
  const values = children.filter(child => child.item_type !== 'phase').map(child => child.id === id ? { progress, status } : { progress: Number(child.progress || 0), status: child.status }).filter(child => !(child.status === 'pending' && child.progress === 0)).map(child => child.progress);
  phaseProgress = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  await ctx.api.object('forge_project_work_item').update({ id: item.parent_id, progress: phaseProgress });
}
const planItems = await ctx.api.object('forge_project_work_item').find({ where: { plan_id: item.plan_id } });
const leafValues = planItems.filter(candidate => candidate.item_type !== 'phase').map(candidate => candidate.id === id ? progress : Number(candidate.progress || 0));
const planProgress = leafValues.length ? Math.round(leafValues.reduce((sum, value) => sum + value, 0) / leafValues.length) : 0;
await ctx.api.object('forge_project_plan').update({ id: item.plan_id, progress: planProgress });
const project = await ctx.api.object('forge_project').findOne({ where: { id: item.project_id } });
if (project) await ctx.api.object('forge_project').update({ id: project.id, progress: planProgress });
return { id, progress, status, actual_start_on: actualStart, actual_end_on: actualEnd, phase_progress: phaseProgress, plan_progress: planProgress };
` },
});

export const ProjectPlanSubmitDailyReport = defineAction({
  name: 'project_plan_submit_daily_report', label: '提交日报', objectName: 'forge_project_plan', icon: 'notebook-pen',
  requiredPermissions: ['forge_project_manager'],
  locations: [...locations], order: 20, visible: `record.status == 'active'`, refreshAfter: true,
  description: '提交进度页中已观察到的日报字段。附件字段保留页面提示的 20MB 边界。', successMessage: '项目日报已提交',
  params: [
    { field: 'work_item_id', objectOverride: 'forge_project_daily_report', required: true },
    { field: 'reporter_id', objectOverride: 'forge_project_daily_report', required: true },
    { field: 'report_on', objectOverride: 'forge_project_daily_report', required: true },
    { field: 'completed_today', objectOverride: 'forge_project_daily_report', required: true },
    { field: 'completion_percent', objectOverride: 'forge_project_daily_report', required: true },
    { field: 'blockage', objectOverride: 'forge_project_daily_report' }, { field: 'assistance_needed', objectOverride: 'forge_project_daily_report' },
    { field: 'expected_finish_changed', objectOverride: 'forge_project_daily_report', defaultValue: false },
    { field: 'expected_finish_on', objectOverride: 'forge_project_daily_report' }, { field: 'attachment', objectOverride: 'forge_project_daily_report' },
  ],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const planId = ctx.recordId || (ctx.record && ctx.record.id); const plan = ctx.record;
if (ctx.recordLoadDenied === true || !planId || !plan) throw new Error('当前项目计划不存在或不可访问');
if (plan.status !== 'active') throw new Error('仅执行中的计划可以提交日报');
if (!ctx.input.completed_today || !String(ctx.input.completed_today).trim()) throw new Error('今日完成内容为必填');
const item = await ctx.api.object('forge_project_work_item').findOne({ where: { id: ctx.input.work_item_id } });
if (!item || item.plan_id !== planId || item.item_type === 'phase') throw new Error('日报工作项必须是当前计划中的任务或里程碑');
const progress = Number(ctx.input.completion_percent);
if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error('完成度必须在 0 到 100 之间');
const changed = ctx.input.expected_finish_changed === true;
if (changed && !ctx.input.expected_finish_on) throw new Error('预计完成日期变化时必须填写调整后的日期');
const reportOn = ctx.input.report_on || new Date().toISOString().slice(0, 10);
const created = await ctx.api.object('forge_project_daily_report').insert({
  name: reportOn + ' ' + item.name + ' 日报', report_key: planId + ':' + item.id + ':' + reportOn + ':' + Date.now(),
  project_id: plan.project_id, plan_id: planId, work_item_id: item.id, reporter_id: ctx.input.reporter_id, report_on: reportOn,
  completed_today: String(ctx.input.completed_today).trim(), completion_percent: progress,
  blockage: ctx.input.blockage || null, assistance_needed: ctx.input.assistance_needed || null,
  expected_finish_changed: changed, expected_finish_on: changed ? ctx.input.expected_finish_on : null,
  attachment: ctx.input.attachment || null,
});
const reportId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
if (!reportId) throw new Error('日报创建后未返回记录ID');
return { id: reportId, plan_id: planId, work_item_id: item.id, report_on: reportOn, completion_percent: progress };
` },
});

export const ProjectPlanSaveAsTemplate = defineAction({
  name: 'project_plan_save_as_template', label: '保存为计划模板', objectName: 'forge_project_plan', icon: 'copy-check',
  requiredPermissions: ['forge_project_manager'],
  locations: [...locations], order: 80, visible: `record.status == 'active'`, refreshAfter: true,
  description: '把当前计划的阶段、里程碑和任务保存为可复用模板。', successMessage: '计划模板已保存',
  params: [{ field: 'template_name', objectOverride: 'forge_project_plan_template', required: true }, { field: 'category', objectOverride: 'forge_project_plan_template', defaultValue: 'custom' }],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const planId = ctx.recordId || (ctx.record && ctx.record.id); const plan = ctx.record;
if (!planId || !plan || plan.status !== 'active') throw new Error('仅执行中的项目计划可以保存为模板');
const name = String(ctx.input.template_name || '').trim(); if (!name) throw new Error('模板名称不能为空');
const items = await ctx.api.object('forge_project_work_item').find({ where: { plan_id: planId } });
if (!items.length) throw new Error('当前计划没有可保存的阶段或工作项');
const structure = items.map(x => ({ source_id:x.id, item_type:x.item_type, name:x.name, parent_id:x.parent_id || null, planned_start_on:x.planned_start_on, planned_end_on:x.planned_end_on, duration_days:x.duration_days || 0, weight:Number(x.weight || 0), critical_path:x.critical_path === true, planned_deliverable:x.planned_deliverable || null, sort_order:Number(x.sort_order || 0) }));
const created = await ctx.api.object('forge_project_plan_template').insert({ name, template_key: planId + ':T' + Date.now(), category: ctx.input.category || 'custom', source_plan_id: planId, source_project_id: plan.project_id, structure_json: JSON.stringify(structure), item_count: structure.length, status: 'active', remarks: '由项目计划保存' });
const id = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id));
return { id, name, item_count: structure.length, source_plan_id: planId };
` },
});

export const ProjectPlanApplyTemplate = defineAction({
  name: 'project_plan_apply_template', label: '套用计划模板', objectName: 'forge_project_plan', icon: 'copy-plus',
  requiredPermissions: ['forge_project_manager'],
  locations: [...locations], order: 70, visible: `record.status == 'active'`, refreshAfter: true,
  description: '将模板中的阶段、里程碑和任务复制到当前执行计划。', successMessage: '计划模板已套用',
  params: [{ field: 'template_id', objectOverride: 'forge_project_plan_template', required: true }],
  body: { language: 'js', capabilities: ['api.read', 'api.write'], source: `
const planId = ctx.recordId || (ctx.record && ctx.record.id); const plan = ctx.record;
if (!planId || !plan || plan.status !== 'active') throw new Error('仅执行中的项目计划可以套用模板');
const templateId = ctx.input.template_id; if (!templateId) throw new Error('请选择计划模板');
const template = await ctx.api.object('forge_project_plan_template').findOne({ where: { id: templateId, status: 'active' } });
if (!template) throw new Error('计划模板不存在或已归档');
const existing = await ctx.api.object('forge_project_work_item').find({ where: { plan_id: planId } });
if (existing.length) throw new Error('当前计划已有工作项，请使用空计划套用模板');
let structure; try { structure = JSON.parse(template.structure_json || '[]'); } catch { throw new Error('模板结构损坏，无法套用'); }
if (!Array.isArray(structure) || !structure.length) throw new Error('模板没有可套用的工作项');
const idMap = {}; let order = 10;
for (const item of structure) {
  const parent = item.parent_id ? idMap[item.parent_id] || null : null;
  const created = await ctx.api.object('forge_project_work_item').insert({ name:item.name, item_key:planId+':'+order, project_id:plan.project_id, plan_id:planId, item_type:item.item_type, parent_id:parent, owner_id:null, planned_start_on:item.planned_start_on, planned_end_on:item.planned_end_on, duration_days:Number(item.duration_days || 0), weight:Number(item.weight || 0), critical_path:item.critical_path === true, planned_deliverable:item.planned_deliverable || null, status:'pending', progress:0, sort_order:order });
  const createdId = typeof created === 'string' ? created : created && (created.id || (created.record && created.record.id)); if (!createdId) throw new Error('模板工作项创建失败'); idMap[item.source_id] = createdId; order += 10;
}
await ctx.api.object('forge_project_plan').update({ id: planId, source:'custom_template', item_count:structure.length, progress:0 });
return { id:planId, template_id:templateId, item_count:structure.length, source:'custom_template' };
` },
});
