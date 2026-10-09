import { randomInt } from 'node:crypto';
import type { ActionHandlerContext } from '@objectstack/spec/ui';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { EmployeeNativeActions, EmployeeAction, EmployeeParameter, BusinessRow } from './employee-business-native.js';
import { businessRow } from './employee-business-native.js';
import { employeeBusinessBinding } from './employee-business-binding.js';
import { businessContext, lockBusinessRow } from './business-transaction.js';
import { canonicalJSON, digest, nonempty, TaskConnectionFailure } from './native-task-auth.js';
import { businessRecordVersion } from './business-record-version.js';
import { moneyValue } from './sales-order-readiness.js';

export const LEAD_CREATE_TARGET = 'forgeCreateEmployeeSalesLead';
export const CONTRACT_DRAFT_TERMS_TARGET = 'forgeUpdateContractDraftPaymentTerm';
export const CREATION_ACTIONS: Readonly<Record<string, string>> = {
  forge_sales_lead: 'sales_lead_create', forge_quotation: 'sales_quotation_draft_create',
};
export const CREATION_REFERENCES: Readonly<Record<string, string>> = {
  customer_id: 'forge_customer', contact_id: 'forge_contact', opportunity_id: 'forge_sales_opportunity',
  quotation_type_id: 'forge_quotation_type', issuer_id: 'forge_quotation_issuer', sku_id: 'forge_material_sku',
};
export type ReferenceIds = Record<string, string[]>;
export type LineItem = Record<string, string | number>;
export interface LineItemsDeclaration { minItems: number; maxItems: number; fields: EmployeeParameter[] }
const LINE_KEYS = ['line_type', 'name', 'sku_id', 'quantity', 'taxed_unit_price', 'tax_rate', 'discount_rate', 'remarks'];
function fail(code: string, message: string, status = 422): never { throw new TaskConnectionFailure(status, code, message); }

export function normalizeReferenceIds(raw: unknown, objectName: string): ReferenceIds | undefined {
  if (raw == null) return undefined;
  if (objectName !== 'forge_quotation') fail('EMPLOYEE_ACTION_INPUT_INVALID', '该创建动作不接受记录引用', 400);
  let value: unknown = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { fail('EMPLOYEE_ACTION_INPUT_INVALID', '记录选择格式无效', 400); } }
  const input = businessRow(value);
  if (!input || !Object.keys(input).length || Object.keys(input).some(key => !Object.hasOwn(CREATION_REFERENCES, key))) fail('EMPLOYEE_ACTION_INPUT_INVALID', '记录选择包含未声明字段', 400);
  const result: ReferenceIds = {};
  for (const key of Object.keys(input).sort()) {
    const ids = input[key];
    if (!Array.isArray(ids) || !ids.length || ids.length > (key === 'sku_id' ? 100 : 1)
      || ids.some(id => typeof id !== 'string' || !nonempty(id, 128) || id !== id.trim()) || new Set(ids).size !== ids.length) {
      fail('EMPLOYEE_ACTION_INPUT_INVALID', '记录选择必须是完整且不重复的准确引用', 400);
    }
    result[key] = [...ids].sort() as string[];
  }
  return result;
}

/** Reference reads stay in the native employee bridge: no system lookup fallback. */
async function referenceOptions(native: EmployeeNativeActions, key: string, selected?: string[]): Promise<Array<{ value: string; label: string }>> {
  const objectName = CREATION_REFERENCES[key], org = String(native.actor.tenantId), actor = String(native.actor.userId);
  const read = async (object: string, id: string, fields: string[]) => {
    try { return businessRow(await native.bridge.get(object, id, fields)); }
    catch (error) {
      const refused = businessRow(error);
      if (refused?.code === 'RECORD_NOT_FOUND' || refused?.status === 403 || refused?.status === 404) return undefined;
      throw error;
    }
  };
  const own = ['customer_id', 'contact_id', 'opportunity_id'].includes(key);
  const fields = ['id', 'name', 'organization_id', ...(own ? ['owner_id'] : []),
    ...(key === 'quotation_type_id' ? ['status'] : []), ...(key === 'opportunity_id' ? ['customer_id', 'responsible_id'] : []),
    ...(key === 'contact_id' ? ['customer_id', 'employment_status'] : []), ...(key === 'sku_id' ? ['code', 'material_id', 'enabled'] : [])];
  let rows: BusinessRow[];
  if (selected) {
    rows = [];
    for (const id of selected) {
      const row = await read(objectName, id, fields);
      if (!row || row.id !== id) fail('EMPLOYEE_ACTION_REFERENCE_FORBIDDEN', '所选记录已不可读取，请重新选择', 403);
      rows.push(row);
    }
  } else {
    const where: BusinessRow = { organization_id: org, ...(own ? { owner_id: actor } : {}),
      ...(key === 'quotation_type_id' ? { status: 'active' } : {}), ...(key === 'contact_id' ? { employment_status: 'active' } : {}),
      ...(key === 'sku_id' ? { enabled: true } : {}) };
    const response = businessRow(await native.bridge.query(objectName, { where, fields, orderBy: [{ field: 'id', order: 'asc' }], limit: 101 }));
    if (!response || !Array.isArray(response.records)) fail('EMPLOYEE_ACTION_LOOKUP_UNAVAILABLE', '当前业务引用不可完整读取', 503);
    rows = response.records.map(row => businessRow(row)!);
    if (rows.length > 100 || response.hasMore === true || response.total != null && Number(response.total) > rows.length) {
      fail('EMPLOYEE_ACTION_REFERENCE_SELECTION_REQUIRED', '可选记录超过本次展示范围，请先查找并选择准确记录', 409);
    }
  }
  const options: Array<{ value: string; label: string }> = [];
  for (const row of rows) {
    if (!row || row.organization_id !== org || own && row.owner_id !== actor || !nonempty(row.id) || !nonempty(row.name, 160)
      || key === 'quotation_type_id' && row.status !== 'active' || key === 'contact_id' && row.employment_status !== 'active'
      || key === 'opportunity_id' && row.responsible_id !== actor || key === 'sku_id' && row.enabled === false) {
      fail('EMPLOYEE_ACTION_REFERENCE_FORBIDDEN', '业务引用的归属或启用状态不可确认', 403);
    }
    let label = String(row.name);
    if (key === 'sku_id') {
      const material = await read('forge_material', String(row.material_id), ['id', 'name', 'organization_id', 'status', 'unit_id']);
      const unit = material?.unit_id ? await read('forge_unit', String(material.unit_id), ['id', 'name', 'organization_id', 'status']) : undefined;
      if (!material || material.organization_id !== org || material.status !== 'active' || !nonempty(material.name, 255)
        || !unit || unit.organization_id !== org || unit.status !== 'active' || !nonempty(unit.name, 255)) {
        if (!selected) continue;
        fail('EMPLOYEE_ACTION_REFERENCE_FORBIDDEN', '物料规格及计量单位不可用', 403);
      }
      label = `${String(material.name)} · ${label}${nonempty(row.code) ? '（' + String(row.code) + '）' : ''}`;
    }
    if (label.length > 160) fail('EMPLOYEE_ACTION_LOOKUP_UNAVAILABLE', '当前引用名称无法完整显示，请先核对业务资料', 503);
    options.push({ value: String(row.id), label });
  }
  if (new Set(options.map(option => option.value)).size !== options.length || new Set(options.map(option => option.label)).size !== options.length) {
    fail('EMPLOYEE_ACTION_REFERENCE_SELECTION_REQUIRED', '存在无法唯一核对的记录名称，请先查找并选择准确记录', 409);
  }
  return options;
}

export async function employeeCreationActions(native: EmployeeNativeActions, objectName: string, references?: ReferenceIds): Promise<EmployeeAction[]> {
  const name = Object.hasOwn(CREATION_ACTIONS, objectName) ? CREATION_ACTIONS[objectName] : undefined;
  if (!name) fail('EMPLOYEE_ACTION_INPUT_INVALID', '当前对象没有本人创建动作', 400);
  const available = (await native.bridge.listActions()).find(action => action.objectName === objectName && action.name === name);
  if (!available) fail('EMPLOYEE_ACTION_RECORD_FORBIDDEN', '当前员工没有这项业务创建权限', 403);
  if (available.requiresRecord !== false) fail('EMPLOYEE_ACTION_METADATA_UNAVAILABLE', '创建动作的原生范围不可核验', 503);
  const metadata = await native.metadata(objectName), definition = (metadata.actions as BusinessRow[]).find(action => action.name === name);
  if (!definition) fail('EMPLOYEE_ACTION_METADATA_UNAVAILABLE', '创建动作声明不可核验', 503);
  const parameters = await native.parameters(objectName, { ...definition,
    params: (definition.params as BusinessRow[]).filter(param => !['code', 'lines_json'].includes(String(param.name ?? param.field))) }, metadata);
  let lineItems: LineItemsDeclaration | undefined;
  const options = async (key: string, parameter: EmployeeParameter) => {
    if (!parameter.required && await native.canReadObject(CREATION_REFERENCES[key]) === false) {
      if (references?.[key]) fail('EMPLOYEE_ACTION_REFERENCE_FORBIDDEN', '当前员工无权读取所选业务引用', 403);
      parameter.description = '当前员工无权读取该可选引用，本次不可填写。';
      return [];
    }
    try { return await referenceOptions(native, key, references?.[key]); }
    catch (error) {
      if (!parameter.required && !references?.[key] && error instanceof TaskConnectionFailure && error.code === 'EMPLOYEE_ACTION_REFERENCE_SELECTION_REQUIRED') {
        parameter.description = '本次不能完整展示该可选引用；如需填写，请先通过只读查找选择准确记录后重新读取创建动作。';
        return [];
      }
      throw error;
    }
  };
  if (objectName === 'forge_quotation') {
    for (const parameter of parameters) {
      if (['quotation_date', 'valid_until'].includes(parameter.name)) parameter.type = 'date';
      if (CREATION_REFERENCES[parameter.name]) {
        const choices = await options(parameter.name, parameter);
        if (choices.length) { parameter.enumLabels = choices; parameter.enum = choices.map(option => option.value); }
        else parameter.description ??= '当前没有已核验的可选引用；如需填写，请先查找并选择准确记录。';
      }
    }
    const skuField: EmployeeParameter = { name: 'sku_id', label: '物料规格', type: 'string', required: false };
    const skuOptions = await options('sku_id', skuField);
    lineItems = { minItems: 1, maxItems: 100, fields: [
      { name: 'line_type', label: '明细类型', type: 'string', required: true, enum: ['material', 'service'], enumLabels: [{ value: 'material', label: '物料' }, { value: 'service', label: '服务项目' }] },
      { name: 'name', label: '服务名称', type: 'string', required: false, maxLength: 255 },
      { ...skuField, ...(skuOptions.length ? { enum: skuOptions.map(option => option.value), enumLabels: skuOptions }
        : { description: skuField.description ?? '当前没有已核验的物料规格；物料行须先查找选择规格，服务行不需要规格。' }) },
      { name: 'quantity', label: '数量', type: 'number', required: true, minimum: 0.0001, maximum: 1e9 },
      { name: 'taxed_unit_price', label: '含税单价', type: 'number', required: true, minimum: 0, maximum: 1e12 },
      { name: 'tax_rate', label: '税率', type: 'number', required: true, minimum: 0, maximum: 100 },
      { name: 'discount_rate', label: '折扣率', type: 'number', required: true, minimum: 0, maximum: 100 },
      { name: 'remarks', label: '备注', type: 'string', required: false, maxLength: 4000 },
    ] };
  }
  const declaration = { definition, parameters, ...(lineItems ? { lineItems } : {}), referenceIds: references ?? null };
  return [{ action_ref: 1, capabilityId: `forge:action:${objectName}.${name}`, declarationVersion: await digest(canonicalJSON(declaration)),
    label: String(definition.label), description: String(businessRow(definition.ai)?.description || definition.label), effect: 'write', executionMode: 'employee_only',
    requiresRecord: false, parameters, ...(lineItems ? { lineItems } : {}) }];
}

export function validateCreationLineItems(value: unknown, declaration?: LineItemsDeclaration): LineItem[] {
  if (!declaration || !Array.isArray(value) || value.length < declaration.minItems || value.length > declaration.maxItems) fail('EMPLOYEE_ACTION_PARAMETER_INVALID', '请提供完整的物料与服务明细');
  return value.map((raw, index) => {
    const row = businessRow(raw);
    if (!row || Object.keys(row).some(key => !LINE_KEYS.includes(key))) fail('EMPLOYEE_ACTION_PARAMETER_INVALID', '报价明细包含未声明字段');
    const result: LineItem = {};
    for (const field of declaration.fields) {
      const current = row[field.name];
      if (current === undefined) { if (field.required) fail('EMPLOYEE_ACTION_PARAMETER_REQUIRED', `请填写第${index + 1}行${field.label}`); continue; }
      if (typeof current !== field.type || field.enum && !field.enum.includes(current as string | number | boolean)
        || field.name === 'sku_id' && !field.enum?.includes(current as string)
        || field.name === 'name' && typeof current === 'string' && !current.trim()
        || typeof current === 'number' && (!Number.isFinite(current) || Math.round((current + Number.EPSILON) * 10000) / 10000 !== current || field.minimum != null && current < field.minimum || field.maximum != null && current > field.maximum)
        || typeof current === 'string' && (current.includes('\0') || current.length > (field.maxLength ?? 4000))) fail('EMPLOYEE_ACTION_PARAMETER_INVALID', `第${index + 1}行${field.label}无效`);
      result[field.name] = typeof current === 'string' ? current.trim() : current as number;
    }
    if (result.line_type === 'material' ? !result.sku_id : !result.name || 'sku_id' in row) fail('EMPLOYEE_ACTION_PARAMETER_INVALID', '物料必须选择准确规格；服务必须填写名称且不关联SKU');
    return result;
  });
}

/** Reject ordinary input/reference mistakes before native dispatch reserves an
 * uncertain result; the original quotation transaction repeats its own checks. */
export async function validateCreationSelection(native: EmployeeNativeActions, objectName: string, values: BusinessRow): Promise<void> {
  if (objectName === 'forge_sales_lead') {
    const amount = values.estimated_amount;
    if (amount != null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1e12 || Math.round((amount + Number.EPSILON) * 10000) / 10000 !== amount)) {
      fail('EMPLOYEE_ACTION_PARAMETER_INVALID', '销售内部估算须为有效非负金额，最多四位小数');
    }
    return;
  }
  if (String(values.valid_until) < String(values.quotation_date)) fail('EMPLOYEE_ACTION_PARAMETER_INVALID', '有效期至不得早于报价日期');
  for (const key of ['contact_id', 'opportunity_id']) {
    if (!values[key]) continue;
    const row = businessRow(await native.bridge.get(CREATION_REFERENCES[key], String(values[key])));
    if (!row || row.organization_id !== native.actor.tenantId || row.owner_id !== native.actor.userId || row.customer_id !== values.customer_id
      || key === 'opportunity_id' && row.responsible_id !== native.actor.userId || key === 'contact_id' && row.employment_status !== 'active') {
      fail('EMPLOYEE_ACTION_REFERENCE_FORBIDDEN', '联系人或来源商机必须属于所选客户和当前员工', 403);
    }
  }
}

/** Business-facing numbers use date/time plus a short numeric collision suffix,
 * never the operation UUID or a record identifier. */
export function creationCode(objectName: string): string {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
  return `${objectName === 'forge_sales_lead' ? 'XS' : 'QT'}-${stamp.slice(0, 8)}-${stamp.slice(8)}-${String(randomInt(10000)).padStart(4, '0')}`;
}

type Handler = ActionHandlerContext<BusinessRow> & { recordLoadDenied?: boolean; recordId?: string };
function caller(ctx: Handler, actionName: string) {
  const bound = employeeBusinessBinding(), userId = nonempty(ctx.user?.id), organizationId = nonempty(ctx.session?.organizationId);
  if (!bound || !userId || ctx.session?.userId !== userId || bound.userId !== userId || !organizationId || bound.organizationId !== organizationId
    || bound.actionName !== actionName || !Number.isFinite(Date.parse(bound.expiresAt)) || Date.parse(bound.expiresAt) <= Date.now() || ctx.recordLoadDenied) fail('EMPLOYEE_ACTION_CONTEXT_CHANGED', '请从本人当前业务上下文办理', 409);
  return { bound, userId, organizationId };
}

export async function createEmployeeLead(engine: IObjectQLEngine, ctx: Handler): Promise<BusinessRow> {
  const { bound, userId, organizationId } = caller(ctx, 'sales_lead_create');
  if (bound.objectName !== 'forge_sales_lead' || bound.recordId != null || !bound.creationCode || ctx.recordId || ctx.params.recordId != null
    || ctx.params.objectName !== 'forge_sales_lead' || ctx.record && Object.keys(ctx.record).length) fail('EMPLOYEE_ACTION_INPUT_INVALID', '新建线索不能借用已有记录', 400);
  const input = ctx.params;
  if (Object.keys(input).some(key => !['name', 'company_name', 'source', 'estimated_amount', 'contact_name', 'phone', 'remarks', 'recordId', 'objectName'].includes(key))) fail('EMPLOYEE_ACTION_PARAMETER_INVALID', '线索输入包含未声明字段');
  const readText = (name: string, required = false, max = 255): string | null => {
    const value = input[name];
    if (value == null || value === '') { if (required) fail('EMPLOYEE_ACTION_PARAMETER_REQUIRED', '请填写线索名称与公司名称'); return null; }
    if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) fail('EMPLOYEE_ACTION_PARAMETER_INVALID', '线索文字内容无效');
    return value.trim();
  };
  const record = { name: readText('name', true), company_name: readText('company_name', true), code: bound.creationCode,
    source: readText('source'), contact_name: readText('contact_name'), phone: readText('phone'), remarks: readText('remarks', false, 4000),
    estimated_amount: input.estimated_amount == null ? null : moneyValue(input.estimated_amount, '销售内部估算'),
    owner_id: userId, responsible_id: userId, organization_id: organizationId, status: 'new' };
  return engine.transaction(async transaction => {
    const created = await engine.insert('forge_sales_lead', record, { context: transaction });
    return { id: created.id, name: record.name, code: record.code, status: 'new' };
  }, businessContext(userId, organizationId), { require: true });
}

export async function updateContractDraftPaymentTerm(engine: IObjectQLEngine, ctx: Handler): Promise<BusinessRow> {
  const { bound, userId, organizationId } = caller(ctx, 'contract_draft_payment_term_update');
  const id = nonempty(ctx.record?.id), term = nonempty(ctx.params.payment_term, 255);
  if (!id || bound.recordId !== id || bound.objectName !== 'forge_sales_contract' || ctx.params.objectName !== 'forge_sales_contract' || ctx.params.recordId !== id
    || !term || Object.keys(ctx.params).some(key => !['payment_term', 'recordId', 'objectName'].includes(key))) fail('EMPLOYEE_ACTION_PARAMETER_INVALID', '请为当前合同提供明确付款条款');
  return engine.transaction(async transaction => {
    await lockBusinessRow(engine, 'forge_sales_contract', id, organizationId, transaction);
    const contract = await engine.findOne('forge_sales_contract', { where: { id, organization_id: organizationId } }, { context: transaction });
    const approval = await engine.findOne('sys_approval_request', { where: { object_name: 'forge_sales_contract', record_id: id, organization_id: organizationId } }, { context: transaction });
    if (!contract || contract.owner_id !== userId || contract.responsible_id !== userId || contract.status !== 'draft' || contract.signed_on || contract.signed_evidence_attachment || approval) {
      fail('EMPLOYEE_ACTION_RECORD_FORBIDDEN', '仅本人尚未进入审批的合同草稿可以补充付款条款', 403);
    }
    if (await businessRecordVersion(engine, 'forge_sales_contract', id, organizationId, transaction) !== bound.recordVersion) fail('EMPLOYEE_ACTION_CONTEXT_CHANGED', '合同内容已变化，请重新核对', 409);
    const changed = await engine.update('forge_sales_contract', { payment_term: term }, { multi: true, where: { id, organization_id: organizationId,
      owner_id: userId, responsible_id: userId, status: 'draft' }, context: transaction });
    if (changed !== 1) fail('EMPLOYEE_ACTION_CONTEXT_CHANGED', '合同状态已变化，条款未保存', 409);
    return { id, status: 'draft', payment_term: term };
  }, businessContext(userId, organizationId), { require: true });
}
