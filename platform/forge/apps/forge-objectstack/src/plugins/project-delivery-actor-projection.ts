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
type ScopeObject = keyof typeof PROJECT_SCOPE_REQUIRED_FIELDS;
export interface ProjectScopeDiagnostic {
  event: 'project-scope-check-failed';
  stage: 'field-service' | 'object-admission' | 'header-read' | 'row-query-count' | 'source-match' | 'line-fields' | 'trace-match';
  object: ScopeObject | 'forge_project';
  fields: string[];
  code: 403 | 503;
}
export type ProjectScopeDiagnose = (diagnostic: ProjectScopeDiagnostic) => void;
const close = (diagnose: ProjectScopeDiagnose | undefined, code: 403 | 503, stage: ProjectScopeDiagnostic['stage'],
  object: ProjectScopeDiagnostic['object'], fields: readonly string[] = []): never => {
  // All arguments are static protocol names, never values from native rows or
  // errors. Diagnostics cannot change the public permission failure.
  try { diagnose?.({ event: 'project-scope-check-failed', stage, object, fields: [...fields], code }); } catch { /* logger unavailable */ }
  return code === 503 ? unavailable() : forbidden();
};

/** Never fall back to the trusted body-runner's rows. Undefined is the native
 * service's "no answer" result, not an all-readable projection. Null is not a
 * declared answer either. Even allowed columns must exist in actor-native data. */
export async function projectScopeFields(security: ISecurityService, actor: ExecutionContext, object: ScopeObject, diagnose?: ProjectScopeDiagnose): Promise<string[]> {
  if (actor.isSystem || !security.getReadableFields || !security.canReadObject) return close(diagnose, 503, 'field-service', object);
  let fields: unknown, admission: boolean;
  [fields, admission] = await Promise.all([
    Promise.resolve().then(() => security.getReadableFields!(object, actor)).catch(() => close(diagnose, 503, 'field-service', object)),
    Promise.resolve().then(() => security.canReadObject!(object, actor)).catch(() => close(diagnose, 503, 'object-admission', object)),
  ]);
  if (typeof admission !== 'boolean') return close(diagnose, 503, 'object-admission', object);
  if (!admission) return close(diagnose, 403, 'object-admission', object);
  if (!Array.isArray(fields) || fields.some(value => typeof value !== 'string') || new Set(fields).size !== fields.length) return close(diagnose, 503, 'field-service', object);
  const missing = PROJECT_SCOPE_REQUIRED_FIELDS[object].filter(field => !fields.includes(field));
  if (missing.length) return close(diagnose, 403, 'field-service', object, missing);
  return fields;
}

export async function readProjectActorSource(reader: ProjectScopeReader, security: ISecurityService, actor: ExecutionContext, customerId: string, refs: ProjectScopeSourceRefs, diagnose?: ProjectScopeDiagnose) {
  const objects: ScopeObject[] = ['forge_sales_order', 'forge_sales_contract', 'forge_sales_order_line', 'forge_sales_contract_line',
    ...(refs.quotationId ? ['forge_quotation', 'forge_quotation_line'] as const : [])];
  const fieldSets = new Map(await Promise.all(objects.map(async object => [object, await projectScopeFields(security, actor, object, diagnose)] as const)));
  const get = async (object: ScopeObject, id: string): Promise<Row> => {
    let value: unknown;
    try { value = await reader.get(object, id, ['id', ...fieldSets.get(object)!]); } catch { return close(diagnose, 403, 'header-read', object); }
    const valueRow = row(value);
    if (!valueRow || valueRow.id !== id) return close(diagnose, 403, 'header-read', object, ['id']);
    return valueRow;
  };
  const rows = async (object: ScopeObject, field: string, id: string): Promise<Row[]> => {
    let value: unknown;
    try { value = await reader.query(object, { where: { [field]: id, organization_id: actor.tenantId }, fields: ['id', ...fieldSets.get(object)!], limit: 101,
      orderBy: [{ field: 'id', order: 'asc' }] }); } catch { return close(diagnose, 403, 'row-query-count', object); }
    const result = row(value), values = result?.records;
    if (!Array.isArray(values) || !values.length || values.length > 100 || result?.total != null && (!Number.isSafeInteger(result.total) || result.total !== values.length)) return close(diagnose, 403, 'row-query-count', object);
    if (values.some(value => !row(value) || typeof row(value)!.id !== 'string' || row(value)![field] !== id) || new Set(values.map(value => row(value)!.id)).size !== values.length) return close(diagnose, 403, 'row-query-count', object, ['id', field]);
    return values as Row[];
  };
  // The native 17.5 bridge reuses its actor context and the security
  // middleware stamps object-specific __readScope on it. These reads must not
  // overlap: a contract's own scope must not replace an order's native scope.
  const order = await get('forge_sales_order', refs.orderId), contract = await get('forge_sales_contract', refs.contractId);
  const match = (object: ScopeObject, checks: Array<[string, boolean]>) => {
    const invalid = checks.filter(([, valid]) => !valid).map(([field]) => field);
    if (invalid.length) close(diagnose, 403, 'source-match', object, invalid);
  };
  match('forge_sales_order', [['customer_id', order.customer_id === customerId], ['contract_id', order.contract_id === contract.id],
    ['code', typeof order.code === 'string' && !!order.code.trim()], ['status', typeof order.status === 'string'],
    ['quotation_id', (order.quotation_id ?? null) === (refs.quotationId ?? null)]]);
  match('forge_sales_contract', [['customer_id', contract.customer_id === customerId], ['code', typeof contract.code === 'string' && !!contract.code.trim()],
    ['status', contract.status === 'active'], ['signed_on', !!contract.signed_on], ['signed_evidence_attachment', !!contract.signed_evidence_attachment],
    ['quotation_id', (contract.quotation_id ?? null) === (refs.quotationId ?? null)]]);
  const orderLines = await rows('forge_sales_order_line', 'order_id', refs.orderId), contractLines = await rows('forge_sales_contract_line', 'contract_id', refs.contractId);
  const quotation = refs.quotationId ? await get('forge_quotation', refs.quotationId) : undefined;
  const quotationLines = refs.quotationId ? await rows('forge_quotation_line', 'quotation_id', refs.quotationId) : [];
  if (quotation) match('forge_quotation', [['customer_id', quotation.customer_id === customerId], ['code', typeof quotation.code === 'string' && !!quotation.code.trim()],
    ['status', quotation.status === 'accepted'], ['customer_acceptance_evidence_attachment', !!quotation.customer_acceptance_evidence_attachment],
    ['pricing_version', quotation.pricing_version != null && Number.isSafeInteger(Number(quotation.pricing_version))],
    ['accepted_pricing_version', quotation.accepted_pricing_version != null && Number(quotation.accepted_pricing_version) === Number(quotation.pricing_version)]]);
  const numeric = (value: unknown, positive = false) => value != null && (typeof value === 'number' || typeof value === 'string' && !!value.trim())
    && Number.isFinite(Number(value)) && (positive ? Number(value) > 0 : Number(value) >= 0);
  for (const [object, lines, quantityField] of [['forge_sales_order_line', orderLines, 'quantity'], ['forge_sales_contract_line', contractLines, 'quantity_limit'], ['forge_quotation_line', quotationLines, 'quantity']] as const) {
    for (const line of lines) {
      const invalid = [typeof line.name !== 'string' || !line.name.trim() ? 'name' : '', !['material', 'service'].includes(String(line.line_type)) ? 'line_type' : '',
        !numeric(line[quantityField], true) ? quantityField : '', ...['taxed_unit_price', 'tax_rate', 'discount_rate', 'taxed_subtotal'].filter(field => !numeric(line[field]))].filter(Boolean);
      if (invalid.length) return close(diagnose, 403, 'line-fields', object, invalid);
    }
  }
  for (const line of orderLines) {
    const original = contractLines.find(value => value.id === line.contract_line_id);
    if (!original) return close(diagnose, 403, 'trace-match', 'forge_sales_order_line', ['contract_line_id']);
    if (quotation && (!line.quotation_line_id || original.quotation_line_id !== line.quotation_line_id
      || !quotationLines.some(value => value.id === line.quotation_line_id))) return close(diagnose, 403, 'trace-match', 'forge_sales_order_line', ['quotation_line_id']);
  }
  return { order, contract, quotation, orderLines, contractLines, quotationLines, fieldSets };
}

export async function projectActorScope(reader: ProjectScopeReader, security: ISecurityService, actor: ExecutionContext, customerId: string, binding: Row,
  trustedScope: Row, diagnose?: ProjectScopeDiagnose): Promise<Row> {
  if (!Array.isArray(binding.links) || !Array.isArray(binding.rows) || !Array.isArray(trustedScope.warnings)) return close(diagnose, 503, 'trace-match', 'forge_project');
  const sources: Row[] = [], lines: Row[] = [];
  for (const value of binding.links) {
    const link = row(value); if (!link || typeof link.order_id !== 'string' || typeof link.contract_id !== 'string') return close(diagnose, 403, 'trace-match', 'forge_project', ['order_id', 'contract_id']);
    const data = await readProjectActorSource(reader, security, actor, customerId, { orderId: link.order_id, contractId: link.contract_id, quotationId: typeof link.quotation_id === 'string' ? link.quotation_id : null }, diagnose);
    const source: Row = { contract_code: data.contract.code, order_code: data.order.code, order_status: data.order.status, source_version_valid: data.quotation ? true : null,
      ...(data.quotation ? { quotation_code: data.quotation.code, accepted_pricing_version: Number(data.quotation.accepted_pricing_version) } : {}) };
    sources.push(source);
    const expected = binding.rows.filter(value => row(value)?.order_id === data.order.id);
    if (expected.length !== data.orderLines.length || new Set(expected.map(value => row(value)?.order_line_id)).size !== expected.length) return close(diagnose, 403, 'trace-match', 'forge_sales_order_line', ['id']);
    for (let position = 0; position < data.orderLines.length; position++) {
      const line = data.orderLines[position], trace = row(expected.find(value => row(value)?.order_line_id === line.id));
      const original = data.contractLines.find(value => value.id === line.contract_line_id), quoted = data.quotationLines.find(value => value.id === line.quotation_line_id);
      if (!trace || trace.contract_line_id !== original?.id || trace.quotation_line_id !== (quoted?.id ?? null) || !original || data.quotation && !quoted) return close(diagnose, 403, 'trace-match', 'forge_sales_order_line', ['contract_line_id', 'quotation_line_id']);
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
