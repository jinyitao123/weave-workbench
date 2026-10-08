import type { PluginContext } from '@objectstack/core';
import type { IApprovalService, IDataDriver, IHttpRequest, IObjectQLEngine, IStorageService, ISecurityService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { lockBusinessRow } from './business-transaction.js';
import { EmployeeNativeActions, businessRow, type BusinessRow, type EmployeeAction } from './employee-business-native.js';
import { businessActionPolicy } from './business-action-policy.js';
import { canonicalJSON, digest, nativeEmployee, nonempty, service, SYSTEM_READ, TaskConnectionFailure } from './native-task-auth.js';
import { readOwnedOriginal, OwnedOriginalFailure } from './workbench-owned-material.plugin.js';
import { nativeActionConfirmationSupported, nativeActionRequiresConfirmation } from './native-action-confirmation.js';
import { businessRecordVersion } from './business-record-version.js';
import { withEmployeeBusinessBinding } from './employee-business-binding.js';
import { CREATION_ACTIONS, CREATION_REFERENCES, employeeCreationActions, normalizeReferenceIds, validateCreationLineItems, validateCreationSelection, creationCode, type ReferenceIds, type LineItem } from './employee-business-creation.js';

const CONTEXT = 'forge_employee_business_context';
const OPERATION = 'forge_employee_business_operation';
const OBJECTS = new Set(['forge_sales_lead', 'forge_customer', 'forge_project', 'forge_quotation', 'forge_sales_contract', 'forge_sales_order', 'forge_customer_prepayment']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
type Employee = Awaited<ReturnType<typeof nativeEmployee>>;
type Source = { kind: 'record' | 'business_notification' | 'approval'; reference?: string };
interface RecordActionContext {
  version: '1'; contextId: string; contextVersion: string; recordVersion: string; expiresAt: string; readOnly: true;
  record: { objectName: string; recordId: string; label: string }; source: Source; actions: EmployeeAction[];
}
interface CreationActionContext {
  version: '1'; contextId: string; contextVersion: string; expiresAt: string; readOnly: true;
  objectName: string; objectLabel: string; source: { kind: 'creation' }; actions: EmployeeAction[];
  /** Private context storage only; the public response keeps selection in Host. */
  referenceIds?: ReferenceIds;
}
type ActionContext = RecordActionContext | CreationActionContext;
function isCreation(context: ActionContext): context is CreationActionContext { return context.source.kind === 'creation'; }
interface ExecuteRequest {
  version: '1'; contextId: string; contextVersion: string; opKey: string;
  employeeMessage: { sessionId: string; messageId: string; sha256: string };
  action_ref: number; values: Record<string, string | number | boolean>;
  lineItems?: LineItem[];
  file?: { parameter: string; fileId: string; name: string; mediaType: string; bytes: number; sha256: string } | null;
}
interface Operation {
  version: '1'; operationId: string; contextId: string; requestDigest: string;
  status: 'in_progress' | 'succeeded' | 'failed' | 'unknown'; repeated: boolean; updatedAt: string;
  noEffect?: boolean; code?: string; summary?: string;
  recordReferences?: RecordActionContext['record'][];
}

function fail(status: number, code: string, message: string): never { throw new TaskConnectionFailure(status, code, message); }
function keys(row: BusinessRow, allowed: string[]): void {
  if (Object.keys(row).some(key => !allowed.includes(key))) fail(400, 'EMPLOYEE_ACTION_INPUT_INVALID', '业务动作包含未声明输入');
}
function id(value: unknown): string {
  const result = nonempty(value); if (!result) fail(400, 'EMPLOYEE_ACTION_INPUT_INVALID', '业务来源无效'); return result;
}
function json(row: BusinessRow, key: string): BusinessRow {
  try { const result = businessRow(JSON.parse(String(row[key]))); if (result) return result; } catch { /* refuse corrupt state */ }
  return fail(503, 'EMPLOYEE_ACTION_STATE_INVALID', '业务办理记录暂不可核验');
}
function parseRequest(value: unknown): ExecuteRequest {
  const input = businessRow(value); if (!input) fail(400, 'EMPLOYEE_ACTION_INPUT_INVALID', '业务动作输入无效');
  keys(input, ['version', 'contextId', 'contextVersion', 'opKey', 'employeeMessage', 'action_ref', 'values', 'file', 'lineItems']);
  const message = businessRow(input.employeeMessage), values = businessRow(input.values);
  if (input.version !== '1' || !UUID.test(String(input.contextId)) || !UUID.test(String(input.opKey)) || !SHA.test(String(input.contextVersion))
    || !Number.isInteger(input.action_ref) || Number(input.action_ref) < 1 || Number(input.action_ref) > 64 || !message || !values) {
    fail(400, 'EMPLOYEE_ACTION_INPUT_INVALID', '业务动作输入无效');
  }
  keys(message, ['sessionId', 'messageId', 'sha256']); id(message.sessionId); id(message.messageId);
  if (!SHA.test(String(message.sha256)) || Object.keys(values).length > 32
    || Object.entries(values).some(([key, v]) => !/^[a-z][a-z0-9_]{0,127}$/.test(key)
      || !['string', 'number', 'boolean'].includes(typeof v) || typeof v === 'number' && !Number.isFinite(v)
      || typeof v === 'string' && (v.length > 4000 || v.includes('\0')))) fail(400, 'EMPLOYEE_ACTION_INPUT_INVALID', '业务参数无效');
  if (input.file != null) {
    const file = businessRow(input.file); if (!file) fail(400, 'EMPLOYEE_ACTION_INPUT_INVALID', '材料绑定无效');
    keys(file, ['parameter', 'fileId', 'name', 'mediaType', 'bytes', 'sha256']);
    if (!nonempty(file.parameter) || !nonempty(file.fileId) || !nonempty(file.name, 255) || !nonempty(file.mediaType, 160)
      || !SHA.test(String(file.sha256)) || !Number.isSafeInteger(file.bytes) || Number(file.bytes) < 1 || Number(file.bytes) > 2 * 1024 * 1024) fail(400, 'EMPLOYEE_ACTION_INPUT_INVALID', '材料绑定无效');
  }
  if ('lineItems' in input && (!Array.isArray(input.lineItems) || input.lineItems.length < 1 || input.lineItems.length > 100)) fail(400, 'EMPLOYEE_ACTION_INPUT_INVALID', '报价明细数量无效');
  return input as unknown as ExecuteRequest;
}

export class EmployeeBusinessService {
  readonly engine: IObjectQLEngine;
  constructor(readonly context: PluginContext) { this.engine = service(context, 'objectql'); }

  async catalog(request: IHttpRequest): Promise<BusinessRow> {
    const employee = await nativeEmployee(this.context, request), native = new EmployeeNativeActions(this.context, employee.actor);
    const developer = employee.actor.permissions?.includes('weave_team_developer') || employee.actor.permissions?.includes('admin_full_access');
    const actions = developer ? await native.developerDefinitions() : await native.bridge.listActions(), capabilities: BusinessRow[] = [];
    for (const action of actions) {
      if (typeof action.objectName !== 'string' || typeof action.name !== 'string') continue;
      const creation = CREATION_ACTIONS[action.objectName] === action.name;
      const policy = businessActionPolicy(action.objectName, action.name);
      const capability: BusinessRow = { id: `forge:action:${action.objectName}.${action.name}`, name: String(action.label ?? action.name).slice(0, 80),
        description: String(action.description ?? action.label ?? action.name).slice(0, 240), ...policy, resourceType: action.objectName,
        objectName: action.objectName, actionName: action.name, requiresRecord: creation ? false : action.requiresRecord !== false,
        requiresEmployeeIntent: policy.effect === 'write', status: 'available' };
      try {
        const metadata = await native.metadata(action.objectName), declaration = (metadata.actions as BusinessRow[] | undefined)?.find(a => a.name === action.name);
        if (!declaration) throw new Error('能力声明缺失');
        capability.requiresConfirmation = nativeActionRequiresConfirmation(declaration);
        if (capability.requiresConfirmation && !nativeActionConfirmationSupported()) throw new Error('原生协议不支持动作确认');
        const exposedDeclaration = creation ? { ...declaration, params: (declaration.params as BusinessRow[] ?? []).filter(param => !['code', 'lines_json'].includes(String(param.name ?? param.field))) } : declaration;
        capability.params = (await native.parameters(action.objectName, exposedDeclaration, metadata, true)).map(p => ({
          name: p.name, label: p.label, type: p.type === 'date' ? 'string' : p.type, required: p.required, ...(p.multiple ? { multiple: true } : {}),
          ...(p.description ? { description: p.description.slice(0, 240) } : {}),
          ...(p.enum?.every(v => typeof v === 'string') ? { enum: p.enum } : {}),
        }));
      } catch { capability.status = 'unavailable'; capability.unavailableReason = '当前输入定义尚不能安全办理'; }
      capabilities.push(capability);
    }
    return { version: '1', provider: { id: 'forge', name: 'Forge', status: 'available' }, capabilities, refreshedAt: new Date().toISOString() };
  }

  private system(employee: Employee): ExecutionContext { return { ...SYSTEM_READ, userId: employee.userId, tenantId: employee.organizationId }; }
  private async requireObjectRead(employee: Employee, objectName: string): Promise<void> {
    const security = service<ISecurityService>(this.context, 'security');
    if (!security.canReadObject) fail(503, 'EMPLOYEE_ACTION_PERMISSION_UNAVAILABLE', '当前员工权限不可可靠核对');
    if (!await security.canReadObject(objectName, employee.actor)) fail(403, 'EMPLOYEE_ACTION_RECORD_FORBIDDEN', '当前员工无权读取该业务记录');
  }

  async verifySource(employee: Employee, objectName: string, recordId: string, source: Source): Promise<void> {
    if (source.kind === 'record') return;
    if (!source.reference) fail(400, 'EMPLOYEE_ACTION_SOURCE_INVALID', '业务来源不完整');
    if (source.kind === 'approval') {
      const approvals = service<IApprovalService>(this.context, 'approvals');
      const request = await approvals.getRequest(source.reference, employee.actor);
      if (!request || request.object_name !== objectName || request.record_id !== recordId) fail(404, 'EMPLOYEE_ACTION_SOURCE_NOT_FOUND', '当前来源不可读取');
      return;
    }
    const inbox = await this.engine.findOne('sys_inbox_message', { where: { notification_id: source.reference, user_id: employee.userId, organization_id: employee.organizationId } }, { context: this.system(employee) });
    const notice = inbox ? await this.engine.findOne('sys_notification', { where: { id: source.reference, organization_id: employee.organizationId } }, { context: this.system(employee) }) : null;
    if (!notice || notice.source_object !== objectName || notice.source_id !== recordId || notice.topic !== inbox?.topic) fail(404, 'EMPLOYEE_ACTION_SOURCE_NOT_FOUND', '当前来源不可读取');
  }

  async recordVersion(objectName: string, recordId: string, employee: Employee, context = this.system(employee)): Promise<string> {
    return businessRecordVersion(this.engine, objectName, recordId, employee.organizationId, context);
  }

  async readContext(request: IHttpRequest): Promise<ActionContext> {
    const employee = await nativeEmployee(this.context, request), query = request.query ?? {};
    if (query.sourceKind === 'creation') return this.readCreationContext(employee, query);
    keys(query, ['objectName', 'recordId', 'sourceKind', 'sourceRef']);
    const objectName = id(query.objectName), recordId = id(query.recordId);
    if (!OBJECTS.has(objectName)) fail(404, 'EMPLOYEE_ACTION_RECORD_NOT_FOUND', '当前业务记录不可办理');
    await this.requireObjectRead(employee, objectName);
    const kind = query.sourceKind ?? 'record';
    if (!['record', 'business_notification', 'approval'].includes(String(kind)) || kind === 'record' && query.sourceRef != null) fail(400, 'EMPLOYEE_ACTION_SOURCE_INVALID', '业务来源无效');
    const source: Source = { kind: kind as Source['kind'], ...(kind !== 'record' ? { reference: id(query.sourceRef) } : {}) };
    const native = new EmployeeNativeActions(this.context, employee.actor);
    const record = businessRow(await native.bridge.get(objectName, recordId));
    if (!record || record.id !== recordId || record.organization_id != null && record.organization_id !== employee.organizationId) fail(404, 'EMPLOYEE_ACTION_RECORD_NOT_FOUND', '当前业务记录不可读取');
    await this.verifySource(employee, objectName, recordId, source);
    const actions = await native.employeeActions(objectName, record), recordVersion = await this.recordVersion(objectName, recordId, employee);
    const binding = { userId: employee.userId, organizationId: employee.organizationId, objectName, recordId, recordVersion, source, actions };
    const context: RecordActionContext = { version: '1', contextId: crypto.randomUUID(), contextVersion: await digest(canonicalJSON(binding)), recordVersion,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), readOnly: true,
      record: { objectName, recordId, label: String(record.name || record.code || '当前业务记录').slice(0, 300) }, source, actions };
    await this.engine.insert(CONTEXT, { id: context.contextId, name: context.record.label, user_id: employee.userId, organization_id: employee.organizationId,
      object_name: objectName, record_id: recordId, context_version: context.contextVersion, context_json: JSON.stringify(context), expires_at: context.expiresAt }, { context: this.system(employee) });
    return context;
  }

  private async readCreationContext(employee: Employee, query: BusinessRow): Promise<CreationActionContext> {
    keys(query, ['objectName', 'sourceKind', 'referenceIds']);
    const objectName = id(query.objectName);
    if (!Object.hasOwn(CREATION_ACTIONS, objectName)) fail(404, 'EMPLOYEE_ACTION_RECORD_NOT_FOUND', '当前对象没有本人创建入口');
    await this.requireObjectRead(employee, objectName);
    const referenceIds = normalizeReferenceIds(query.referenceIds, objectName);
    const native = new EmployeeNativeActions(this.context, employee.actor), actions = await employeeCreationActions(native, objectName, referenceIds);
    const context: CreationActionContext = { version: '1', contextId: crypto.randomUUID(),
      contextVersion: await digest(canonicalJSON({ userId: employee.userId, organizationId: employee.organizationId, objectName, actions, referenceIds: referenceIds ?? null })),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), readOnly: true, source: { kind: 'creation' },
      objectName, objectLabel: objectName === 'forge_sales_lead' ? '销售线索' : '销售报价', actions };
    await this.engine.insert(CONTEXT, { id: context.contextId, name: context.objectLabel, user_id: employee.userId, organization_id: employee.organizationId,
      object_name: objectName, context_version: context.contextVersion, context_json: JSON.stringify({ ...context, ...(referenceIds ? { referenceIds } : {}) }), expires_at: context.expiresAt }, { context: this.system(employee) });
    return context;
  }

  private async operationRow(employee: Employee, key: string, context = this.system(employee)): Promise<BusinessRow | null> {
    return await this.engine.findOne(OPERATION, { where: { operation_key: key, user_id: employee.userId, organization_id: employee.organizationId } }, { context }) as BusinessRow | null;
  }

  async readOperation(request: IHttpRequest): Promise<Operation> {
    const employee = await nativeEmployee(this.context, request), key = id(request.params?.id);
    if (!UUID.test(key)) fail(404, 'EMPLOYEE_ACTION_OPERATION_NOT_FOUND', '该办理结果不可读取');
    const row = await this.operationRow(employee, key);
    if (!row) fail(404, 'EMPLOYEE_ACTION_OPERATION_NOT_FOUND', '该办理结果尚不可确认');
    return { ...json(row, 'result_json'), repeated: true } as unknown as Operation;
  }

  private validateValues(action: EmployeeAction, input: ExecuteRequest): BusinessRow {
    const params: BusinessRow = {};
    for (const key of Object.keys(input.values)) if (!action.parameters.some(p => p.name === key && p.type !== 'file')) fail(400, 'EMPLOYEE_ACTION_PARAMETER_INVALID', '业务参数未声明或属于平台绑定');
    for (const p of action.parameters) {
      if (p.type === 'file') {
        if (input.file?.parameter === p.name) params[p.name] = input.file.fileId;
        else if (p.required) fail(422, 'EMPLOYEE_ACTION_FILE_REQUIRED', '请本轮选择该动作所需原件');
        continue;
      }
      const v = input.values[p.name];
      if (v === undefined) { if (p.required) fail(422, 'EMPLOYEE_ACTION_PARAMETER_REQUIRED', `请填写${p.label}`); continue; }
      if (typeof v !== (p.type === 'date' ? 'string' : p.type) || p.enum && !p.enum.includes(v)
        || typeof v === 'number' && (p.minimum !== undefined && v < p.minimum || p.maximum !== undefined && v > p.maximum)
        || typeof v === 'string' && (p.maxLength !== undefined && v.length > p.maxLength || p.required && !v.trim())) fail(422, 'EMPLOYEE_ACTION_PARAMETER_INVALID', `${p.label}不符合动作要求`);
      if (p.type === 'date' && (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v + 'T00:00:00Z')) || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v)) fail(422, 'EMPLOYEE_ACTION_DATE_INVALID', '请填写有效的日历日期');
      params[p.name] = v;
    }
    if (input.file && !action.parameters.some(p => p.type === 'file' && p.name === input.file!.parameter)) fail(400, 'EMPLOYEE_ACTION_FILE_INVALID', '动作未声明本轮材料参数');
    return params;
  }

  private driver(objectName: string): IDataDriver {
    const engine = this.engine;
    if (!engine.getDriverForObject || !engine.getDriverByName || !engine.getDefaultDriverName) fail(503, 'EMPLOYEE_ACTION_TRANSACTION_UNAVAILABLE', '当前数据源无法保证办理事务');
    const defaultName = engine.getDefaultDriverName();
    if (!defaultName) fail(503, 'EMPLOYEE_ACTION_TRANSACTION_UNAVAILABLE', '默认业务数据源不可确认');
    const driver = engine.getDriverForObject(objectName), root = engine.getDriverByName(defaultName);
    if (!driver || driver !== root || driver !== engine.getDriverForObject(OPERATION) || !driver.execute) fail(503, 'EMPLOYEE_ACTION_TRANSACTION_UNAVAILABLE', '当前数据源无法保证同一办理事务');
    return driver;
  }

  async execute(request: IHttpRequest): Promise<Operation> {
    const employee = await nativeEmployee(this.context, request), input = parseRequest(request.body);
    const requestDigest = await digest(canonicalJSON({ ...input, file: input.file ?? null }));
    try { return await this.executeBound(request, employee, input, requestDigest); }
    catch (error) {
      if (!(error instanceof TaskConnectionFailure)) throw error;
      const existing = await this.operationRow(employee, input.opKey);
      if (existing) {
        if (existing.request_digest !== requestDigest) throw error;
        return { ...json(existing, 'result_json'), repeated: true } as unknown as Operation;
      }
      // executeBound must reserve the key before invoking native code. A
      // guarded failure with no reservation is authoritative no-effect.
      const operation: Operation = { version: '1', operationId: input.opKey, contextId: input.contextId, requestDigest,
        status: 'failed', repeated: false, noEffect: true, code: error.code, summary: error.message, updatedAt: new Date().toISOString() };
      try {
        await this.engine.insert(OPERATION, { id: crypto.randomUUID(), name: '业务办理未执行', operation_key: input.opKey,
          user_id: employee.userId, organization_id: employee.organizationId, context_id: input.contextId, request_digest: requestDigest,
          status: operation.status, result_json: JSON.stringify(operation), requested_at: operation.updatedAt, observed_at: operation.updatedAt }, { context: this.system(employee) });
      } catch (saveError) {
        const raced = await this.operationRow(employee, input.opKey);
        if (!raced || raced.request_digest !== requestDigest) throw saveError;
        return { ...json(raced, 'result_json'), repeated: true } as unknown as Operation;
      }
      return operation;
    }
  }

  private async executeBound(request: IHttpRequest, employee: Employee, input: ExecuteRequest, requestDigest: string): Promise<Operation> {
    const prior = await this.operationRow(employee, input.opKey);
    if (prior) {
      if (prior.request_digest !== requestDigest) fail(409, 'EMPLOYEE_ACTION_KEY_CONFLICT', '同一办理请求不能更换输入');
      return { ...json(prior, 'result_json'), repeated: true } as unknown as Operation;
    }
    const stored = await this.engine.findOne(CONTEXT, { where: { id: input.contextId, user_id: employee.userId, organization_id: employee.organizationId } }, { context: this.system(employee) });
    if (!stored || stored.context_version !== input.contextVersion || !Number.isFinite(Date.parse(String(stored.expires_at))) || Date.parse(String(stored.expires_at)) <= Date.now()) fail(409, 'EMPLOYEE_ACTION_CONTEXT_CHANGED', '业务上下文已变化，请重新打开');
    const bound = json(stored, 'context_json') as unknown as ActionContext;
    const action = bound.actions.find(a => a.action_ref === input.action_ref);
    if (!action) fail(400, 'EMPLOYEE_ACTION_REFERENCE_INVALID', '当前动作引用无效');
    const creation = isCreation(bound) ? bound : undefined, recordContext = isCreation(bound) ? undefined : bound;
    const objectName = creation?.objectName ?? recordContext!.record.objectName, recordId = recordContext?.record.recordId;
    const params = this.validateValues(action, input);
    if (creation) for (const [key, value] of Object.entries(params)) {
      if (CREATION_REFERENCES[key] && !action.parameters.find(parameter => parameter.name === key)?.enum?.includes(value as string)) {
        fail(409, 'EMPLOYEE_ACTION_REFERENCE_SELECTION_REQUIRED', '请先查找并选择准确业务引用后再办理');
      }
    }
    if (input.lineItems !== undefined && (!creation || objectName !== 'forge_quotation')) fail(400, 'EMPLOYEE_ACTION_PARAMETER_INVALID', '此动作不接受报价明细');
    const lineItems = creation && objectName === 'forge_quotation' ? validateCreationLineItems(input.lineItems, action.lineItems) : undefined;
    if (creation && (input.file || action.requiresRecord !== false)) fail(400, 'EMPLOYEE_ACTION_INPUT_INVALID', '创建动作上下文无效');
    const unresolved = await this.engine.findOne(OPERATION, { where: { user_id: employee.userId, organization_id: employee.organizationId,
      object_name: objectName, record_id: recordId ?? null, status: { $in: ['in_progress', 'unknown'] } } }, { context: this.system(employee) });
    if (unresolved) fail(409, 'EMPLOYEE_ACTION_UNRESOLVED', '已有办理结果待核对，请沿原请求查询，不能更换请求重新办理');
    await this.requireObjectRead(employee, objectName);
    const native = new EmployeeNativeActions(this.context, employee.actor);
    const visible = recordId ? businessRow(await native.bridge.get(objectName, recordId)) : undefined;
    if (recordContext && (!visible || visible.id !== recordId)) fail(404, 'EMPLOYEE_ACTION_RECORD_NOT_FOUND', '当前业务记录不可读取');
    if (recordContext) await this.verifySource(employee, objectName, recordId!, recordContext.source);
    const currentAction = (creation ? await employeeCreationActions(native, objectName, creation.referenceIds) : await native.employeeActions(objectName, visible)).find(a => a.capabilityId === action.capabilityId);
    if (!currentAction || currentAction.declarationVersion !== action.declarationVersion) fail(409, 'EMPLOYEE_ACTION_CONTEXT_CHANGED', '动作定义或权限已变化');
    if (creation) await validateCreationSelection(native, objectName, params);
    if (input.file) {
      let original;
      try { original = await readOwnedOriginal(this.engine, service<IStorageService>(this.context, 'storage'), employee.actor, input.file.fileId, input.file.sha256); } catch (error) {
        if (error instanceof OwnedOriginalFailure) fail(error.status, error.code, '本轮材料已失效或与固定原件不一致');
        throw error;
      }
      if (original.name !== input.file.name || original.mediaType !== input.file.mediaType || original.bytes.byteLength !== input.file.bytes) fail(409, 'EMPLOYEE_ACTION_FILE_CHANGED', '本轮原件与固定材料不一致');
    }
    this.driver(objectName);
    const rowId = crypto.randomUUID();
    let operation: Operation = { version: '1', operationId: input.opKey, contextId: input.contextId, requestDigest,
      status: 'in_progress', repeated: false, noEffect: false, updatedAt: new Date().toISOString() };
    try {
      await this.engine.insert(OPERATION, { id: rowId, name: action.label, operation_key: input.opKey, user_id: employee.userId, organization_id: employee.organizationId,
        context_id: input.contextId, request_digest: requestDigest, object_name: objectName, ...(recordId ? { record_id: recordId } : {}),
        action_name: action.capabilityId, status: operation.status, result_json: JSON.stringify(operation), requested_at: operation.updatedAt, observed_at: operation.updatedAt }, { context: this.system(employee) });
    } catch (error) {
      const raced = await this.operationRow(employee, input.opKey);
      if (!raced) throw error;
      if (raced.request_digest !== requestDigest) fail(409, 'EMPLOYEE_ACTION_KEY_CONFLICT', '同一办理请求不能更换输入');
      return { ...json(raced, 'result_json'), repeated: true } as unknown as Operation;
    }
    let nativeInvoked = false;
    try {
      await this.engine.transaction(async transaction => {
        // Lock the contract before an order/prepayment on every entry path.
        const initial = recordId ? await this.engine.findOne(objectName, { where: { id: recordId, organization_id: employee.organizationId } }, { context: transaction }) : null;
        if (objectName !== 'forge_sales_contract' && nonempty(initial?.contract_id)) await lockBusinessRow(this.engine, 'forge_sales_contract', String(initial!.contract_id), employee.organizationId, transaction);
        await lockBusinessRow(this.engine, creation ? CONTEXT : objectName, creation ? input.contextId : recordId!, employee.organizationId, transaction);
        // The fast preflight runs before reservation. Another key may have
        // reached native dispatch while this one waited for the record lock.
        // An in-progress receipt is already uncertain; do not wait for its
        // catch/recovery path to label it unknown before refusing a replay.
        const competing = await this.engine.findOne(OPERATION, { where: { user_id: employee.userId, organization_id: employee.organizationId,
          object_name: objectName, record_id: recordId ?? null, operation_key: { $ne: input.opKey }, status: { $in: ['in_progress', 'unknown'] } } }, { context: transaction });
        if (competing) fail(409, 'EMPLOYEE_ACTION_UNRESOLVED', '已有办理结果待核对，请沿原请求查询，不能更换请求重新办理');
        if (recordContext && await this.recordVersion(objectName, recordId!, employee, transaction) !== recordContext.recordVersion) fail(409, 'EMPLOYEE_ACTION_CONTEXT_CHANGED', '当前业务记录已变化');
        const live = await nativeEmployee(this.context, request);
        const transactional = new EmployeeNativeActions(this.context, { ...live.actor, transaction: transaction.transaction });
        const current = (creation ? await employeeCreationActions(transactional, objectName, creation.referenceIds)
          : await transactional.employeeActions(objectName, businessRow(await transactional.bridge.get(objectName, recordId!)))).find(a => a.capabilityId === action.capabilityId);
        if (!current || current.declarationVersion !== action.declarationVersion) fail(409, 'EMPLOYEE_ACTION_CONTEXT_CHANGED', '动作权限或定义已变化');
        if (creation) await validateCreationSelection(transactional, objectName, params);
        if (Date.parse(String(stored.expires_at)) <= Date.now()) fail(409, 'EMPLOYEE_ACTION_CONTEXT_CHANGED', '本次办理上下文已过期，请重新打开');
        const actionName = action.capabilityId.slice(action.capabilityId.lastIndexOf('.') + 1);
        const code = creation ? creationCode(objectName) : undefined;
        const nativeParams = lineItems ? { ...params, code, lines_json: JSON.stringify(lineItems) } : params;
        const result = await withEmployeeBusinessBinding({ userId: employee.userId, organizationId: employee.organizationId,
          objectName, ...(recordId ? { recordId, recordVersion: recordContext!.recordVersion } : { creationCode: code }), actionName, expiresAt: String(stored.expires_at), operationKey: input.opKey, requestDigest,
          ...(input.file ? { file: input.file } : {}) },
        () => transactional.runBoundAction(actionName, { objectName, ...(recordId ? { recordId } : {}), params: nativeParams }, () => { nativeInvoked = true; }));
        const raw = businessRow(result);
        if (raw?.ok !== true || raw.action !== actionName || raw.objectName !== objectName || (creation ? raw.recordId != null : raw.recordId !== recordId)) throw new Error('原生动作未返回准确成功包络');
        const resultRecord = businessRow(raw.result);
        const newId = nonempty(resultRecord?.id);
        if (!newId || !creation && !['customer_create_project', 'quotation_convert_to_contract', 'contract_convert_to_sales_order', 'contract_register_customer_prepayment'].includes(actionName) && newId !== recordId) throw new Error('原生业务回执缺少准确记录引用');
        if (actionName === 'quotation_convert_to_contract' && (objectName !== 'forge_quotation' || resultRecord?.quotation_id !== recordId || newId === recordId)) throw new Error('报价转换回执未绑定准确来源');
        if (actionName === 'customer_create_project' && (objectName !== 'forge_customer' || resultRecord?.customer_id !== recordId
          || resultRecord?.approved_order_id !== input.values.approved_order_id || newId === recordId)) throw new Error('项目立项回执未绑定准确客户与订单');
        const reference = creation ? { objectName, recordId: newId, label: String(resultRecord?.name || resultRecord?.code || creation.objectLabel) }
          : actionName === 'customer_create_project'
          ? { objectName: 'forge_project', recordId: newId, label: String(input.values.name || '项目') }
          : newId && newId !== recordId && actionName === 'contract_convert_to_sales_order'
          ? { objectName: 'forge_sales_order', recordId: newId, label: String(input.values.name || input.values.code || '销售订单') }
          : actionName === 'contract_register_customer_prepayment'
            ? { objectName: 'forge_customer_prepayment', recordId: newId!, label: '合同预收款 ' + String(input.values.code || '') }
            : actionName === 'quotation_convert_to_contract'
              ? { objectName: 'forge_sales_contract', recordId: newId!, label: String(input.values.name || input.values.code || '销售合同') } : recordContext!.record;
        if (creation) {
          const created = businessRow(await transactional.bridge.get(objectName, newId, ['id', 'name', 'code', 'owner_id', 'responsible_id', 'organization_id', 'status']));
          if (!created || created.organization_id !== employee.organizationId || created.owner_id !== employee.userId || created.responsible_id !== employee.userId
            || created.code !== code || created.status !== (objectName === 'forge_sales_lead' ? 'new' : 'draft')) throw new Error('创建结果缺少准确的本人业务记录');
          reference.label = `${String(created.name)}（${String(created.code)}）`.slice(0, 300);
        }
        if (actionName === 'quotation_convert_to_contract') {
          const converted = await this.engine.findOne('forge_sales_contract', { where: { id: newId, quotation_id: recordId, quotation_source_type: 'formal_conversion', organization_id: employee.organizationId } }, { context: transaction });
          const receipt = await this.engine.findOne('forge_quotation_contract_conversion', { where: { quotation_id: recordId, contract_id: newId, converted_by: employee.userId, organization_id: employee.organizationId } }, { context: transaction });
          if (!converted || !receipt) throw new Error('报价转换目标缺少权威业务绑定');
          reference.label = String(converted.name || converted.code || '销售合同').slice(0, 300);
        }
        if (actionName === 'customer_create_project') {
          const project = await this.engine.findOne('forge_project', { where: { id: newId, customer_id: recordId, source_order_id: input.values.approved_order_id,
            owner_id: employee.userId, organization_id: employee.organizationId }, fields: ['id', 'name', 'code', 'manager_id', 'status', 'creation_request_signature'] }, { context: transaction });
          const member = project ? await this.engine.findOne('forge_project_member', { where: { project_id: newId, user_id: project.manager_id,
            member_duty: 'manager', active: true, organization_id: employee.organizationId } }, { context: transaction }) : null;
          if (!project || !member || !project.creation_request_signature) throw new Error('项目立项目标缺少准确权威绑定');
          reference.label = String(project.name || project.code || '项目').slice(0, 300);
        }
        operation = { ...operation, status: 'succeeded', updatedAt: new Date().toISOString(), summary: `${action.label}已办理`,
          recordReferences: actionName === 'quotation_convert_to_contract' ? [recordContext!.record, reference] : [reference] };
        await this.engine.update(OPERATION, { id: rowId, status: operation.status, result_json: JSON.stringify(operation), observed_at: operation.updatedAt }, { context: transaction });
      }, this.system(employee), { require: true });
      return operation;
    } catch (error) {
      const saved = await this.operationRow(employee, input.opKey);
      if (saved?.status === 'succeeded') return json(saved, 'result_json') as unknown as Operation;
      // A rollback error, process interruption or unreadable result is not
      // evidence of no effect. Only a guarded rejection before native dispatch
      // may be presented as a known failure; all other results stay unknown.
      const guarded = !nativeInvoked && error instanceof TaskConnectionFailure;
      operation = { version: '1', operationId: input.opKey, contextId: input.contextId, requestDigest,
        status: guarded ? 'failed' : 'unknown', repeated: false, noEffect: guarded,
        code: guarded ? (error as TaskConnectionFailure).code : 'EMPLOYEE_ACTION_RESULT_UNKNOWN', summary: guarded ? (error as Error).message : '办理结果待核对，请沿原请求查询', updatedAt: new Date().toISOString() };
      await this.engine.update(OPERATION, { id: rowId, status: operation.status, result_json: JSON.stringify(operation), observed_at: operation.updatedAt }, { context: this.system(employee) });
      return operation;
    }
  }
}
