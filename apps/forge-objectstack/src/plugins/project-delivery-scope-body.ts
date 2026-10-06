// Single existing native read algorithm. Public handlers strip the internal binding.
export const projectDeliveryScopeBody = { language: 'js', capabilities: ['api.read'], source: `
const projectId = ctx.recordId || (ctx.record && ctx.record.id); const project = ctx.record;
if (ctx.recordLoadDenied === true || !projectId || !project) throw new Error('当前项目不存在或不可访问');
const eligibleOrderStatuses = ['approved', 'active', 'partially_shipped', 'shipped', 'completed'];
const round4 = value => Math.round((Number(value || 0) + Number.EPSILON) * 10000) / 10000;
const sameNumber = (left, right) => Math.abs(Number(left || 0) - Number(right || 0)) < 0.0001;
const scope = { sources: [], lines: [], warnings: [] };
const bounded = rows => { if (!Array.isArray(rows) || rows.length > 100) throw new Error('当前项目来源明细无法完整读取'); return rows; };
const links = bounded(await ctx.api.object('forge_project_sales_link').find({
  where: { project_id: projectId },
  fields: ['id', 'project_id', 'contract_id', 'order_id', 'contract_code_snapshot', 'order_code_snapshot'],
  limit: 101, orderBy: [{ field: 'id', order: 'asc' }],
}));
scope._server_binding = { rows: [], project_id: projectId, source_order_id: project.source_order_id, source_order_version: project.source_order_version, links: links.map(link => ({ link_id: link.id, contract_id: link.contract_id, order_id: link.order_id })) };
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
  scope._server_binding.links.find(item => item.link_id === link.id).quotation_id = quotationId || null;
  const quotation = quotationId ? await ctx.api.object('forge_quotation').findOne({
    where: { id: quotationId }, fields: ['id', 'code', 'customer_id', 'status', 'pricing_version', 'accepted_pricing_version', 'customer_acceptance_evidence_attachment'],
  }) : null;
  const [contractLines, orderLines, quotationLines] = await Promise.all([
    ctx.api.object('forge_sales_contract_line').find({ limit: 101, orderBy: [{ field: 'id', order: 'asc' }], where: { contract_id: contract.id }, fields: ['id', 'name', 'line_type', 'quotation_line_id', 'sku_id', 'item_code', 'model', 'specification', 'unit_name', 'quantity_limit', 'taxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal'] }),
    ctx.api.object('forge_sales_order_line').find({ limit: 101, orderBy: [{ field: 'id', order: 'asc' }], where: { order_id: order.id }, fields: ['id', 'name', 'line_type', 'contract_line_id', 'quotation_line_id', 'sku_id', 'item_code', 'model', 'specification', 'unit_name', 'quantity', 'taxed_unit_price', 'untaxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal'] }),
    quotation ? ctx.api.object('forge_quotation_line').find({ limit: 101, orderBy: [{ field: 'id', order: 'asc' }], where: { quotation_id: quotation.id }, fields: ['id', 'quotation_id', 'name', 'line_type', 'sku_id', 'item_code', 'model', 'specification', 'unit_name', 'quantity', 'taxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal'] }) : Promise.resolve([]),
  ]);
  bounded(contractLines); bounded(orderLines); bounded(quotationLines);
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
    if (['quantity', 'taxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal'].some(field => orderLine[field] == null)) issues.push('本员工所需明细字段不可完整读取');
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
    scope._server_binding.rows.push({ order_id: order.id, order_line_id: orderLine.id, contract_line_id: contractLine?.id || null, quotation_line_id: quotationLine?.id || null, trace_consistent: issues.length === 0 });
    const taxRate = Number(orderLine.tax_rate || 0) / 100;
    scope.lines.push({
      line_key: (source.order_code || source.contract_code || 'order') + ':' + String(index + 1).padStart(3, '0'),
      quotation_code: source.quotation_code, accepted_pricing_version: source.accepted_pricing_version,
      contract_code: source.contract_code, order_code: source.order_code,
      line_type: orderLine.line_type, name: orderLine.name, item_code: orderLine.item_code || '', model: orderLine.model || '', specification: orderLine.specification || '', unit_name: orderLine.unit_name || '',
      quote_quantity: quotationLine?.quantity ?? null, contract_quantity: contractLine?.quantity_limit ?? null,
      ...(orderLine.quantity != null ? { quantity: Number(orderLine.quantity) } : {}),
      ...(orderLine.taxed_unit_price != null ? { taxed_unit_price: Number(orderLine.taxed_unit_price) } : {}),
      ...(orderLine.tax_rate != null ? { tax_rate: Number(orderLine.tax_rate) } : {}),
      ...(orderLine.taxed_subtotal != null ? { taxed_subtotal: Number(orderLine.taxed_subtotal) } : {}),
      ...(orderLine.tax_rate != null && orderLine.taxed_subtotal != null ? { tax_amount: taxRate > 0 ? round4(Number(orderLine.taxed_subtotal) * taxRate / (1 + taxRate)) : 0 } : {}),
      trace_consistent: issues.length === 0, trace_issues: issues,
    });
  }
}
return scope;
` } as const;
