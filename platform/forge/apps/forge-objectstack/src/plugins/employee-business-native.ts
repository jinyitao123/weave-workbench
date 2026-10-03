import type { PluginContext } from '@objectstack/core';
import { HttpDispatcher } from '@objectstack/runtime';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import { businessActionPolicy } from './business-action-policy.js';
import { canonicalJSON, digest, TaskConnectionFailure } from './native-task-auth.js';
import { recalledOrderApproval } from './sales-order-readiness.js';
import { businessContext } from './business-transaction.js';

export type BusinessRow = Record<string, unknown>;
export interface EmployeeParameter {
  name: string; label: string; type: 'string' | 'number' | 'boolean' | 'date' | 'file'; required: boolean;
  description?: string; enum?: Array<string | number | boolean>; minimum?: number; maximum?: number; maxLength?: number;
  enumLabels?: Array<{ value: string | number | boolean; label: string }>;
}
export interface EmployeeAction {
  action_ref: number; capabilityId: string; declarationVersion: string; label: string; description: string;
  effect: 'read' | 'write'; executionMode: 'employee_only'; parameters: EmployeeParameter[];
}
export interface NativeEmployeeBridge {
  listObjects(): Promise<BusinessRow[]>; listActions(): Promise<BusinessRow[]>;
  get(object: string, id: string, fields?: string[]): Promise<unknown>;
  query(object: string, query: BusinessRow): Promise<unknown>;
  runAction(name: string, input: BusinessRow): Promise<unknown>;
}

export function businessRow(value: unknown): BusinessRow | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as BusinessRow : undefined;
}

export class EmployeeNativeActions {
  readonly bridge: NativeEmployeeBridge;
  private readonly sdk: HttpDispatcher;
  constructor(private readonly context: PluginContext, readonly actor: ExecutionContext) {
    this.sdk = new HttpDispatcher(context.getKernel() as ConstructorParameters<typeof HttpDispatcher>[0]);
    this.bridge = this.sdk.buildMcpBridge({ request: { method: 'POST', url: '/api/v1/mcp', headers: {} }, executionContext: actor }) as NativeEmployeeBridge;
  }

  async metadata(objectName: string): Promise<BusinessRow> {
    const response = await this.sdk.handleMetadata(`objects/${encodeURIComponent(objectName)}`,
      { request: { method: 'GET', url: '/api/v1/mcp', headers: {} }, executionContext: this.actor }, 'GET');
    const envelope = businessRow(response.response?.body), item = businessRow(businessRow(envelope?.data)?.item);
    if (response.response?.status !== 200 || envelope?.success !== true || item?.name !== objectName) {
      throw new TaskConnectionFailure(503, 'EMPLOYEE_ACTION_METADATA_UNAVAILABLE', '当前动作定义不可读取');
    }
    return item;
  }

  async developerDefinitions(): Promise<BusinessRow[]> {
    const response = await this.sdk.handleMetadata('actions',
      { request: { method: 'GET', url: '/api/v1/meta/actions', headers: {} }, executionContext: this.actor }, 'GET');
    const envelope = businessRow(response.response?.body), body = businessRow(envelope?.data);
    if (response.response?.status !== 200 || envelope?.success !== true || !Array.isArray(body?.items)) {
      throw new TaskConnectionFailure(503, 'EMPLOYEE_ACTION_METADATA_UNAVAILABLE', '业务动作定义暂不可完整读取');
    }
    return body.items.filter((value): value is BusinessRow => !!businessRow(value) && businessRow(businessRow(value)?.ai)?.exposed === true);
  }

  async parameters(objectName: string, definition: BusinessRow, metadata: BusinessRow, catalog = false): Promise<Array<EmployeeParameter & { multiple?: boolean }>> {
    if (definition.params != null && !Array.isArray(definition.params)) throw new Error('动作输入声明无效');
    const parameters: Array<EmployeeParameter & { multiple?: boolean }> = [];
    for (const raw of definition.params as BusinessRow[] ?? []) {
      let field: BusinessRow | undefined;
      if (typeof raw.field === 'string') {
        const source = raw.objectOverride && raw.objectOverride !== objectName
          ? await this.metadata(String(raw.objectOverride)) : metadata;
        field = businessRow(businessRow(source.fields)?.[raw.field]);
        if (!field) throw new Error('动作引用字段不可读取');
      }
      const name = String(raw.name ?? raw.field ?? '');
      if (!/^[a-z][a-z0-9_]{0,127}$/.test(name) || parameters.some(p => p.name === name)) throw new Error('动作参数名称无效');
      const type = String(raw.type ?? field?.type ?? '');
      const mapped: EmployeeParameter['type'] | undefined =
        ['text', 'textarea', 'markdown', 'select', 'status', 'lookup', 'user', 'email', 'url', 'phone', 'string'].includes(type) ? 'string'
          : ['number', 'currency', 'percent', 'integer'].includes(type) ? 'number'
            : ['boolean', 'checkbox'].includes(type) ? 'boolean' : type === 'date' ? 'date' : type === 'file' ? 'file' : undefined;
      if (!mapped || !catalog && (raw.multiple ?? field?.multiple) === true) throw new Error('当前个人办理入口不支持该输入类型');
      const options = raw.options ?? field?.options;
      const values = Array.isArray(options) ? options.map(item => businessRow(item)?.value ?? item) : undefined;
      if (values && (values.length > 100 || new Set(values.map(v => JSON.stringify(v))).size !== values.length || values.some(v => !['string', 'number', 'boolean'].includes(typeof v) || typeof v === 'number' && !Number.isFinite(v)))) throw new Error('动作选项不可核验');
      const p: EmployeeParameter & { multiple?: boolean } = { name, label: String(raw.label ?? field?.label ?? name).slice(0, 160), type: mapped, required: Boolean(raw.required ?? field?.required) };
      if (catalog && (raw.multiple ?? field?.multiple) === true) p.multiple = true;
      const description = raw.description ?? field?.description;
      if (typeof description === 'string' && description) p.description = description.slice(0, 1000);
      if (values?.length) p.enum = values as EmployeeParameter['enum'];
      if (Array.isArray(options) && options.length && options.some(option => businessRow(option)?.label != null)) {
        if (options.some(option => typeof businessRow(option)?.label !== 'string' || !String(businessRow(option)!.label).trim() || String(businessRow(option)!.label).length > 160)) throw new Error('动作选项标签必须完整且可核验');
        p.enumLabels = options.map(option => ({ value: businessRow(option)!.value as string | number | boolean, label: String(businessRow(option)!.label) }));
      }
      if (!catalog && name === 'account_id' && type === 'lookup' && field?.reference === 'forge_fund_account') {
        const result = businessRow(await this.bridge.query('forge_fund_account', {
          where: { status: 'active' }, fields: ['id', 'name', 'code'], limit: 101, orderBy: [{ field: 'id', order: 'asc' }],
        }));
        const records = result?.records;
        if (!Array.isArray(records) || !records.length || records.length > 100 || Number(result?.total || records.length) > 100) throw new Error('可用公司账户无法完整读取');
        p.enumLabels = records.map(value => {
          const account = businessRow(value);
          if (typeof account?.id !== 'string' || typeof account.name !== 'string' || !account.name.trim() || account.name.length > 160) throw new Error('公司账户缺少可读名称');
          return { value: account.id, label: account.name };
        });
        p.enum = p.enumLabels.map(option => option.value);
      }
      const min = raw.min ?? field?.min, max = raw.max ?? field?.max, maxLength = raw.maxLength ?? field?.maxLength;
      if (typeof min === 'number' && Number.isFinite(min)) p.minimum = min;
      if (typeof max === 'number' && Number.isFinite(max)) p.maximum = max;
      if (mapped === 'string') p.maxLength = typeof maxLength === 'number' ? Math.min(maxLength, 4000) : 4000;
      parameters.push(p);
    }
    if (parameters.length > 32 || !catalog && parameters.filter(p => p.type === 'file').length > 1) throw new Error('动作输入超过本批支持范围');
    return parameters;
  }

  async employeeActions(objectName: string, record?: BusinessRow): Promise<EmployeeAction[]> {
    let relevantRecord = record;
    if (objectName === 'forge_sales_order' && record?.status === 'pending_approval' && record.responsible_id === this.actor.userId &&
      !['approved', 'rejected'].includes(String(record.approval_outcome)) && this.actor.tenantId &&
      await recalledOrderApproval(this.context.getService<IObjectQLEngine>('objectql'), record, businessContext(this.actor.userId!, this.actor.tenantId))) {
      relevantRecord = { ...record, approval_outcome: 'recalled' };
    }
    const native = (await this.bridge.listActions()).filter(a => a.objectName === objectName
      && businessActionPolicy(objectName, String(a.name)).executionMode === 'employee_only'
      // Native approval decisions retain their existing version-bound route.
      && !String(a.name).includes('approval_mcp_') && !String(a.name).startsWith('approval_work_item_'));
    const metadata = await this.metadata(objectName), definitions = metadata.actions as BusinessRow[] | undefined;
    const result: EmployeeAction[] = [];
    for (const action of native) {
      if (relevantRecord && !employeeActionRelevant(String(action.name), relevantRecord, this.actor.userId)) continue;
      const definition = definitions?.find(d => d.name === action.name);
      if (!definition) throw new TaskConnectionFailure(503, 'EMPLOYEE_ACTION_METADATA_UNAVAILABLE', '当前动作声明不可核验');
      const parameters = await this.parameters(objectName, definition, metadata);
      const policy = businessActionPolicy(objectName, String(action.name));
      result.push({ action_ref: result.length + 1, capabilityId: `forge:action:${objectName}.${String(action.name)}`,
        declarationVersion: await digest(canonicalJSON({ definition, parameters, policy })),
        label: String(definition.label ?? action.label ?? action.name).slice(0, 160),
        description: String(definition.description ?? businessRow(definition.ai)?.description ?? definition.label ?? action.name).slice(0, 1000),
        effect: policy.effect, executionMode: 'employee_only', parameters });
    }
    if (result.length > 64) throw new TaskConnectionFailure(503, 'EMPLOYEE_ACTION_METADATA_UNAVAILABLE', '当前动作目录超过支持范围');
    return result;
  }
}

// Selected domain actions have business prerequisites in addition to their
// native permissions; execution still revalidates every rule transactionally.
function employeeActionRelevant(name: string, row: BusinessRow, actor?: string): boolean {
  switch (name) {
    case 'contract_set_order_conditions': return row.status === 'active' && !row.signed_on && row.responsible_id === actor;
    case 'contract_register_signature': return row.status === 'active' && !row.signed_on && row.responsible_id !== actor && ['none', 'prepayment'].includes(String(row.order_payment_requirement));
    case 'contract_convert_to_sales_order':
    case 'contract_register_customer_prepayment': return row.status === 'active' && !!row.signed_on && !!row.signed_evidence_attachment;
    case 'sales_order_apply_completed_approval': return row.status === 'pending_approval' && row.responsible_id === actor && ['approved', 'rejected', 'recalled'].includes(String(row.approval_outcome));
    case 'sales_order_submit': return row.status === 'draft' && row.responsible_id === actor;
    case 'customer_prepayment_confirm': return row.status === 'pending_confirmation' && row.registered_by !== actor && (!row.confirmation_reviewer_id || row.confirmation_reviewer_id === actor);
    default: return false;
  }
}
