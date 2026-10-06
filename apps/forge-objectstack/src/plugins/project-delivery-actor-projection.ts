import type { ISecurityService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { TaskConnectionFailure } from './native-task-auth.js';

type Row = Record<string, unknown>;
export interface ProjectScopeReader {
  get(object: string, id: string, fields?: string[]): Promise<unknown>;
  query(object: string, query: Row): Promise<unknown>;
}
export interface ProjectScopeSourceRefs { orderId: string; contractId: string; quotationId?: string | null }
const row = (value: unknown): Row | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined;
const unavailable = (): never => { throw new TaskConnectionFailure(503, 'PROJECT_SCOPE_PERMISSION_UNAVAILABLE', '项目范围字段权限暂不可可靠核对'); };
const forbidden = (): never => { throw new TaskConnectionFailure(403, 'PROJECT_SCOPE_FIELDS_FORBIDDEN', '当前员工无法完整读取本项目必需的交付范围'); };
export const PROJECT_SCOPE_REQUIRED_FIELDS = {
  forge_sales_order: ['code', 'customer_id', 'contract_id', 'quotation_id', 'status'],
  forge_sales_contract: ['code', 'customer_id', 'quotation_id', 'status', 'signed_on', 'signed_evidence_attachment'],
  forge_quotation: ['code', 'customer_id', 'status', 'pricing_version', 'accepted_pricing_version', 'customer_acceptance_evidence_attachment'],
  forge_sales_order_line: ['order_id', 'contract_line_id', 'quotation_line_id', 'name', 'line_type', 'quantity', 'taxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal'],
  forge_sales_contract_line: ['contract_id', 'quotation_line_id', 'name', 'line_type', 'quantity_limit', 'taxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal'],
  forge_quotation_line: ['quotation_id', 'name', 'line_type', 'quantity', 'taxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal'],
} as const;

/** Never fall back to the trusted body-runner's rows. Undefined is the native
 * service's "no answer" result, not an all-readable projection. Null is not a
 * declared answer either. Even allowed columns must exist in actor-native data. */
export async function projectScopeFields(security: ISecurityService, actor: ExecutionContext, object: keyof typeof PROJECT_SCOPE_REQUIRED_FIELDS): Promise<string[]> {
  if (actor.isSystem || !security.getReadableFields || !security.canReadObject) return unavailable();
  let fields: unknown, admission: boolean;
  try { [fields, admission] = await Promise.all([security.getReadableFields(object, actor), security.canReadObject(object, actor)]); }
  catch { return unavailable(); }
  if (typeof admission !== 'boolean') return unavailable();
  if (!admission) return forbidden();
  if (!Array.isArray(fields) || fields.some(value => typeof value !== 'string') || new Set(fields).size !== fields.length) return unavailable();
  if (!PROJECT_SCOPE_REQUIRED_FIELDS[object].every(field => fields.includes(field))) return forbidden();
  return fields;
}

export async function readProjectActorSource(reader: ProjectScopeReader, security: ISecurityService, actor: ExecutionContext, customerId: string, refs: ProjectScopeSourceRefs) {
  const objects: Array<keyof typeof PROJECT_SCOPE_REQUIRED_FIELDS> = ['forge_sales_order', 'forge_sales_contract', 'forge_sales_order_line', 'forge_sales_contract_line',
    ...(refs.quotationId ? ['forge_quotation', 'forge_quotation_line'] as const : [])];
  const fieldSets = new Map(await Promise.all(objects.map(async object => [object, await projectScopeFields(security, actor, object)] as const)));
  const get = async (object: keyof typeof PROJECT_SCOPE_REQUIRED_FIELDS, id: string): Promise<Row> => {
    let value: unknown;
    try { value = await reader.get(object, id, ['id', ...fieldSets.get(object)!]); } catch { return forbidden(); }
    const valueRow = row(value);
    if (!valueRow || valueRow.id !== id) return forbidden();
    return valueRow;
  };
  const rows = async (object: keyof typeof PROJECT_SCOPE_REQUIRED_FIELDS, field: string, id: string): Promise<Row[]> => {
    let value: unknown;
    try { value = await reader.query(object, { where: { [field]: id, organization_id: actor.tenantId }, fields: ['id', ...fieldSets.get(object)!], limit: 101,
      orderBy: [{ field: 'id', order: 'asc' }] }); } catch { return forbidden(); }
    const result = row(value), values = result?.records;
    if (!Array.isArray(values) || !values.length || values.length > 100 || result?.total != null && (!Number.isSafeInteger(result.total) || result.total !== values.length)) return forbidden();
    if (values.some(value => !row(value) || typeof row(value)!.id !== 'string' || row(value)![field] !== id) || new Set(values.map(value => row(value)!.id)).size !== values.length) return forbidden();
    return values as Row[];
  };
  const [order, contract] = await Promise.all([get('forge_sales_order', refs.orderId), get('forge_sales_contract', refs.contractId)]);
  if (order.customer_id !== customerId || contract.customer_id !== customerId || order.contract_id !== contract.id
    || typeof order.code !== 'string' || !order.code.trim() || typeof contract.code !== 'string' || !contract.code.trim() || typeof order.status !== 'string'
    || contract.status !== 'active' || !contract.signed_on || !contract.signed_evidence_attachment
    || (order.quotation_id ?? null) !== (refs.quotationId ?? null) || (contract.quotation_id ?? null) !== (refs.quotationId ?? null)) return forbidden();
  const [orderLines, contractLines] = await Promise.all([rows('forge_sales_order_line', 'order_id', refs.orderId), rows('forge_sales_contract_line', 'contract_id', refs.contractId)]);
  const quotation = refs.quotationId ? await get('forge_quotation', refs.quotationId) : undefined;
  const quotationLines = refs.quotationId ? await rows('forge_quotation_line', 'quotation_id', refs.quotationId) : [];
  if (quotation && (quotation.customer_id !== customerId || typeof quotation.code !== 'string' || !quotation.code.trim() || quotation.status !== 'accepted'
    || !quotation.customer_acceptance_evidence_attachment || quotation.pricing_version == null || quotation.accepted_pricing_version == null
    || !Number.isSafeInteger(Number(quotation.pricing_version)) || Number(quotation.accepted_pricing_version) !== Number(quotation.pricing_version))) return forbidden();
  const numeric = (value: unknown, positive = false) => value != null && (typeof value === 'number' || typeof value === 'string' && !!value.trim())
    && Number.isFinite(Number(value)) && (positive ? Number(value) > 0 : Number(value) >= 0);
  for (const [lines, quantityField] of [[orderLines, 'quantity'], [contractLines, 'quantity_limit'], [quotationLines, 'quantity']] as const) {
    if (lines.some(line => typeof line.name !== 'string' || !line.name.trim() || !['material', 'service'].includes(String(line.line_type))
      || !numeric(line[quantityField], true) || !['taxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal'].every(field => numeric(line[field])))) return forbidden();
  }
  for (const line of orderLines) {
    const original = contractLines.find(value => value.id === line.contract_line_id);
    if (!original) return forbidden();
    if (quotation && (!line.quotation_line_id || original.quotation_line_id !== line.quotation_line_id
      || !quotationLines.some(value => value.id === line.quotation_line_id))) return forbidden();
  }
  return { order, contract, quotation, orderLines, contractLines, quotationLines, fieldSets };
}

export async function projectActorScope(reader: ProjectScopeReader, security: ISecurityService, actor: ExecutionContext, customerId: string, binding: Row,
  trustedScope: Row): Promise<Row> {
  if (!Array.isArray(binding.links) || !Array.isArray(binding.rows) || !Array.isArray(trustedScope.warnings)) return unavailable();
  const sources: Row[] = [], lines: Row[] = [];
  for (const value of binding.links) {
    const link = row(value); if (!link || typeof link.order_id !== 'string' || typeof link.contract_id !== 'string') return forbidden();
    const data = await readProjectActorSource(reader, security, actor, customerId, { orderId: link.order_id, contractId: link.contract_id, quotationId: typeof link.quotation_id === 'string' ? link.quotation_id : null });
    const source: Row = { contract_code: data.contract.code, order_code: data.order.code, order_status: data.order.status, source_version_valid: data.quotation ? true : null,
      ...(data.quotation ? { quotation_code: data.quotation.code, accepted_pricing_version: Number(data.quotation.accepted_pricing_version) } : {}) };
    sources.push(source);
    const expected = binding.rows.filter(value => row(value)?.order_id === data.order.id);
    if (expected.length !== data.orderLines.length || new Set(expected.map(value => row(value)?.order_line_id)).size !== expected.length) return forbidden();
    for (let position = 0; position < data.orderLines.length; position++) {
      const line = data.orderLines[position], trace = row(expected.find(value => row(value)?.order_line_id === line.id));
      const original = data.contractLines.find(value => value.id === line.contract_line_id), quoted = data.quotationLines.find(value => value.id === line.quotation_line_id);
      if (!trace || trace.contract_line_id !== original?.id || trace.quotation_line_id !== (quoted?.id ?? null) || !original || data.quotation && !quoted) return forbidden();
      const projected: Row = { line_key: String(data.order.code) + ':' + String(position + 1).padStart(3, '0'),
        ...source, name: line.name, line_type: line.line_type, quantity: Number(line.quantity), contract_quantity: Number(original.quantity_limit),
        taxed_unit_price: Number(line.taxed_unit_price), tax_rate: Number(line.tax_rate), taxed_subtotal: Number(line.taxed_subtotal),
        ...(quoted ? { quote_quantity: Number(quoted.quantity) } : {}), trace_consistent: trace.trace_consistent === true,
        trace_issues: trace.trace_consistent === true ? [] : ['当前原生来源明细未通过一致性核对'] };
      for (const field of ['item_code', 'model', 'specification', 'unit_name']) if (data.fieldSets.get('forge_sales_order_line')!.includes(field) && typeof line[field] === 'string') projected[field] = line[field];
      const rate = Number(line.tax_rate) / 100;
      projected.tax_amount = rate > 0 ? Math.round((Number(line.taxed_subtotal) * rate / (1 + rate) + Number.EPSILON) * 10000) / 10000 : 0;
      lines.push(projected);
    }
  }
  return { sources, lines, warnings: trustedScope.warnings.length ? ['当前原生项目来源未通过完整核对'] : [] };
}
