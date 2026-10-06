import type { PluginContext } from '@objectstack/core';
import type { IObjectQLEngine, ISharingService, ISecurityService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { ActionHandlerContext } from '@objectstack/spec/ui';
import { businessContext, businessDriver, lockBusinessRow } from './business-transaction.js';
import { businessRecordVersion } from './business-record-version.js';
import { employeeBusinessBinding, type EmployeeBusinessBinding } from './employee-business-binding.js';
import { EmployeeNativeActions, businessRow } from './employee-business-native.js';
import { canonicalJSON, currentNativeActor, digest, nonempty, TaskConnectionFailure } from './native-task-auth.js';
import { calendarDate, moneyValue, roundedMoney } from './sales-order-readiness.js';
import { projectDeliveryScopeBody } from './project-delivery-scope-body.js';
import { approvedProjectOrder, projectRows, qualifiedProjectManagers, validProjectManagerMember, type ProjectRow } from './project-order-readiness.js';

export const PROJECT_CREATE_TARGET = 'forgeCreateCustomerProject';
export const PROJECT_LINK_TARGET = 'forgeLinkProjectOrder';
export const PROJECT_START_TARGET = 'forgeStartProject';
type Handler = ActionHandlerContext<ProjectRow> & { recordLoadDenied?: boolean };
type Caller = { userId: string; organizationId: string; recordId: string; objectName: string };
const denied = (message: string): never => { throw new TaskConnectionFailure(403, 'PROJECT_ACTION_FORBIDDEN', message); };
const changed = (message: string): never => { throw new TaskConnectionFailure(409, 'EMPLOYEE_ACTION_CONTEXT_CHANGED', message); };
function caller(ctx: Handler, objectName: string): Caller {
  const userId = nonempty(ctx.user?.id), organizationId = nonempty(ctx.session?.organizationId), recordId = nonempty(ctx.record?.id);
  if (ctx.recordLoadDenied === true || !userId || ctx.session?.userId !== userId || !organizationId || !recordId
    || ctx.record.organization_id !== organizationId || ctx.params.recordId && ctx.params.recordId !== recordId) denied('当前员工、组织或项目来源不可确认');
  return { userId: userId!, organizationId: organizationId!, recordId: recordId!, objectName };
}
function text(value: unknown, label: string, limit = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\x00-\x1f\x7f]/.test(value)) throw new Error('请填写有效的' + label);
  return value.trim();
}
async function nativeCaller(context: PluginContext, who: Caller, transaction: ExecutionContext, permissions: string[]) {
  const actor = await currentNativeActor(context, who.userId, who.organizationId);
  const held = new Set([...(actor.permissions ?? []), ...((actor as ProjectRow).systemPermissions as string[] ?? [])]);
  if (!permissions.every(permission => held.has(permission))) denied('当前员工已无对应项目业务权限');
  return new EmployeeNativeActions(context, { ...actor, transaction: transaction.transaction });
}
async function visible(native: EmployeeNativeActions, object: string, id: string, who: Caller): Promise<ProjectRow> {
  const row = businessRow(await native.bridge.get(object, id));
  if (!row || row.id !== id || row.organization_id != null && row.organization_id !== who.organizationId) denied('当前员工不能读取准确业务来源');
  return row!;
}
async function get(engine: IObjectQLEngine, object: string, id: string, who: Caller, transaction: ExecutionContext) {
  const row = await engine.findOne(object, { where: { id, organization_id: who.organizationId } }, { context: transaction });
  if (!row) denied('相关业务来源不存在或不属于当前组织');
  return row!;
}
export function assertProjectOperationBinding(bound: Readonly<EmployeeBusinessBinding>, who: Caller, action: string, operation: ProjectRow | null,
  currentVersion: string, now = Date.now()): void {
  if (bound.userId !== who.userId || bound.organizationId !== who.organizationId || bound.objectName !== who.objectName || bound.recordId !== who.recordId
    || bound.actionName !== action || bound.recordVersion !== currentVersion || !Number.isFinite(Date.parse(bound.expiresAt)) || Date.parse(bound.expiresAt) <= now
    || !operation || operation.operation_key !== bound.operationKey || operation.user_id !== who.userId || operation.organization_id !== who.organizationId
    || operation.object_name !== who.objectName || operation.record_id !== who.recordId || operation.status !== 'in_progress'
    || operation.action_name !== 'forge:action:' + who.objectName + '.' + action || operation.request_digest !== bound.requestDigest) changed('本次项目办理操作与可信授权不一致');
}
async function boundVersion(engine: IObjectQLEngine, who: Caller, transaction: ExecutionContext, action: string) {
  const bound = employeeBusinessBinding();
  if (bound) {
    const operation = await engine.findOne('forge_employee_business_operation', { where: { operation_key: bound.operationKey,
      user_id: who.userId, organization_id: who.organizationId, object_name: who.objectName, record_id: who.recordId },
    fields: ['status','action_name','request_digest','operation_key','user_id','organization_id','object_name','record_id'] }, { context: transaction });
    assertProjectOperationBinding(bound,who,action,operation,await businessRecordVersion(engine,who.objectName,who.recordId,who.organizationId,transaction));
  }
  const unresolved = await engine.findOne('forge_employee_business_operation', { where: { user_id: who.userId, organization_id: who.organizationId,
    object_name: who.objectName, record_id: who.recordId, status: bound ? 'unknown' : { $in: ['in_progress', 'unknown'] },
    ...(bound ? { operation_key: { $ne: bound.operationKey } } : {}) } }, { context: transaction });
  if (unresolved) throw new TaskConnectionFailure(409, 'EMPLOYEE_ACTION_UNRESOLVED', '原项目办理结果尚未确定，请沿原请求查询');
}
async function visibleSource(native: EmployeeNativeActions, source: Awaited<ReturnType<typeof approvedProjectOrder>>, who: Caller) {
  await visible(native, 'forge_sales_order', String(source.order.id), who);
  await visible(native, 'forge_sales_contract', String(source.contract.id), who);
  if (source.quotation) await visible(native, 'forge_quotation', String(source.quotation.id), who);
  for (const [object, field, recordId, expected] of [
    ['forge_sales_order_line', 'order_id', source.order.id, source.orderLines],
    ['forge_sales_contract_line', 'contract_id', source.contract.id, source.contractLines],
    ...(source.quotation ? [['forge_quotation_line', 'quotation_id', source.quotation.id, source.quotationLines]] : []),
  ] as Array<[string, string, unknown, ProjectRow[]]>) {
    const read = businessRow(await native.bridge.query(object, { where: { [field]: recordId, organization_id: who.organizationId }, fields: ['id'], limit: 1001 }));
    if (!Array.isArray(read?.records) || read.records.length !== expected.length || read.total != null && Number(read.total) !== expected.length
      || read.records.some(row => !expected.some(item => item.id === businessRow(row)?.id))) denied('当前员工无法完整读取准确来源明细');
  }
}

export const PROJECT_READ_TARGET = 'forgeReadProjectDeliveryScope';
export async function readProjectDeliveryScope(context: PluginContext, engine: IObjectQLEngine, ctx: Handler, transaction?: ExecutionContext) {
  const who = caller(ctx, 'forge_project'), execution = transaction ?? businessContext(who.userId, who.organizationId);
  const native = await nativeCaller(context, who, execution, ['forge_project_operator']);
  await visible(native, 'forge_project', who.recordId, who);
  const factory = (engine as IObjectQLEngine & { getDefaultActionRunner?: () => ((definition: ProjectRow) => ((input: Handler) => Promise<unknown>) | undefined) }).getDefaultActionRunner?.();
  const run = factory?.({ name: 'project_read_delivery_scope', objectName: 'forge_project', body: projectDeliveryScopeBody });
  if (!run) throw new TaskConnectionFailure(503, 'PROJECT_SOURCE_READER_UNAVAILABLE', '现有原生项目范围读取服务不可用');
  const result = businessRow(await run(ctx));
  if (!result) throw new TaskConnectionFailure(503, 'PROJECT_SOURCE_READER_UNAVAILABLE', '原生项目范围未返回可靠结果');
  const { _server_binding, ...scope } = result;
  const binding = businessRow(_server_binding) ?? denied('原生项目关联读取缺少准确绑定');
  const links = Array.isArray(binding.links) ? binding.links : denied('原生项目关联读取格式无效');
  if (!binding || binding.project_id !== who.recordId || !Array.isArray(links) || links.length > 100) denied('原生项目关联读取缺少准确绑定');
  if (links.length) await visible(native, 'forge_customer', String(ctx.record.customer_id), who);
  for (const value of links) {
    const link = businessRow(value) ?? denied('项目读取来源不完整');
    if (!link?.contract_id || !link.order_id) denied('项目读取来源不完整');
    const contract = await visible(native, 'forge_sales_contract', String(link.contract_id), who);
    const order = await visible(native, 'forge_sales_order', String(link.order_id), who);
    if (contract.customer_id !== ctx.record.customer_id || order.customer_id !== ctx.record.customer_id || order.contract_id !== contract.id) denied('当前项目读取来源已变化');
    if (contract.quotation_id) await visible(native, 'forge_quotation', String(contract.quotation_id), who);
    for (const [object, field, id] of [['forge_sales_contract_line','contract_id',contract.id], ['forge_sales_order_line','order_id',order.id],
      ...(contract.quotation_id ? [['forge_quotation_line','quotation_id',contract.quotation_id]] : [])]) {
      const read = businessRow(await native.bridge.query(String(object), {where:{[String(field)]:id,organization_id:who.organizationId},fields:['id'],limit:101}));
      if (!Array.isArray(read?.records) || read.records.length > 100 || read.total != null && Number(read.total) > 100) denied('当前项目来源行不可完整读取');
      if (object === 'forge_sales_order_line' && Array.isArray(scope.lines)
        && scope.lines.filter(value => businessRow(value)?.order_code === order.code).length !== (read?.records as unknown[]).length) denied('项目交付范围缺少完整原生明细');
    }
  }
  const security = context.getService<ISecurityService>('security'), actor = native.actor;
  if (!security.getReadableFields) throw new TaskConnectionFailure(503,'PROJECT_SOURCE_READER_UNAVAILABLE','项目字段权限不可可靠核对');
  const [orderFields,contractFields,quoteFields] = await Promise.all(['forge_sales_order_line','forge_sales_contract_line','forge_quotation_line'].map(object=>security.getReadableFields!(object,actor)));
  const permitted = (fields: string[] | null | undefined, name: string) => fields == null || fields.includes(name);
  if (Array.isArray(scope.lines)) for (const value of scope.lines) {
    const line = businessRow(value); if (!line) denied('项目交付行格式无效');
    for (const field of ['name','line_type','item_code','model','specification','unit_name','quantity','taxed_unit_price','tax_rate','taxed_subtotal']) {
      if (!permitted(orderFields,field)) {delete line![field];line!.trace_consistent=false;line!.trace_issues=['当前员工字段权限不足，明细不可完整核对'];}
    }
    if (!permitted(orderFields,'tax_rate')||!permitted(orderFields,'taxed_subtotal')) delete line!.tax_amount;
    if (!permitted(contractFields,'quantity_limit')) delete line!.contract_quantity;
    if (!permitted(quoteFields,'quantity')) delete line!.quote_quantity;
  }
  return { scope, binding };
}

/** The existing native create/link/start actions share these handlers with the
 * employee bridge. The manager is an explicit native-user choice, never a team
 * assignment, and the order is an exact source, never a contract-wide query. */
export async function createCustomerProject(context: PluginContext, engine: IObjectQLEngine, ctx: Handler) {
  const who = caller(ctx, 'forge_customer'), name = text(ctx.params.name, '项目名称', 255), typeId = text(ctx.params.type_id, '项目类型');
  const managerId = text(ctx.params.manager_id, '项目负责人'), orderId = text(ctx.params.approved_order_id, '已批准销售订单');
  const startsOn = calendarDate(ctx.params.planned_start_on, '计划开始日期'), endsOn = calendarDate(ctx.params.planned_end_on, '计划结束日期');
  const priority = text(ctx.params.priority, '优先级');
  if (!['high', 'medium', 'low'].includes(priority) || endsOn < startsOn) throw new Error('项目优先级或计划日期无效');
  const optionalAmount = (field: string, label: string) => ctx.params[field] == null ? null : moneyValue(ctx.params[field], label);
  const expectedRevenue = optionalAmount('expected_revenue', '预计营收'), budget = optionalAmount('budget_amount', '预算金额');
  const description = ctx.params.description == null ? null : text(ctx.params.description, '项目描述', 4000);
  businessDriver(engine, ['forge_customer', 'forge_project', 'forge_project_member', 'forge_project_sales_link', 'forge_sales_order', 'forge_sales_order_line', 'forge_sales_contract', 'forge_sales_contract_line', 'sys_record_share']);
  return engine.transaction(async transaction => {
    await lockBusinessRow(engine, 'forge_customer', who.recordId, who.organizationId, transaction);
    const native = await nativeCaller(context, who, transaction, ['forge_project_operator']);
    await visible(native, 'forge_customer', who.recordId, who);
    const customer = await get(engine, 'forge_customer', who.recordId, who, transaction);
    if (customer.owner_id !== who.userId) denied('仅客户负责人本人可办理本客户订单立项');
    const visibleOrder = await visible(native, 'forge_sales_order', orderId, who);
    await visible(native, 'forge_sales_contract', String(visibleOrder.contract_id || ''), who);
    const source = await approvedProjectOrder(engine, who.recordId, orderId, transaction, true);
    await visibleSource(native, source, who);
    await lockBusinessRow(engine, 'forge_project_type', typeId, who.organizationId, transaction);
    const type = await visible(native, 'forge_project_type', typeId, who);
    if (type.active !== true) throw new Error('项目类型不存在或已停用');
    if (!(await qualifiedProjectManagers(engine, who.organizationId, transaction)).includes(managerId)) denied('项目负责人须为同组织有效项目经理并具项目办理资格');
    const manager = await visible(native, 'sys_user', managerId, who);
    await boundVersion(engine, who, transaction, 'customer_create_project');
    const signature = await digest(canonicalJSON({ actor: who.userId, customer: who.recordId, name, typeId, managerId, orderId, startsOn, endsOn,
      priority, expectedRevenue, budget, description, sourceVersion: source.version }));
    const prior = await engine.find('forge_project', { where: { organization_id: who.organizationId, customer_id: who.recordId, owner_id: who.userId,
      creation_request_signature: signature }, limit: 2 }, { context: transaction });
    if (prior.length > 1) changed('立项原回执存在歧义，请保留原结果核对');
    if (prior.length) {
      await visible(native, 'forge_project', String(prior[0].id), who);
      if (prior[0].source_order_id !== orderId || prior[0].source_order_version !== source.version) changed('原立项来源已变化，请查询原回执');
      return { id: prior[0].id, customer_id: who.recordId, approved_order_id: orderId, status: 'pending', member_count: 1, repeated: true };
    }
    const projectId = crypto.randomUUID();
    await engine.insert('forge_project', { id: projectId, organization_id: who.organizationId, owner_id: who.userId,
      name, type_id: typeId, customer_id: who.recordId, customer_name_snapshot: customer.name, manager_id: managerId,
      manager_name_snapshot: manager.display_name || manager.name || manager.username, priority, planned_start_on: startsOn, planned_end_on: endsOn,
      expected_revenue: expectedRevenue, budget_amount: budget, total_cost: null, progress: 0, status: 'pending', description,
      source_order_id: orderId, source_order_version: source.version, creation_request_signature: signature }, { context: transaction });
    await engine.insert('forge_project_member', { name: '项目经理', membership_key: projectId + ':' + managerId,
      project_id: projectId, user_id: managerId, member_duty: 'manager', active: true, organization_id: who.organizationId, remarks: '立项时自动加入' }, { context: transaction });
    if (!await validProjectManagerMember(engine, await get(engine, 'forge_project', projectId, who, transaction), transaction)) throw new Error('项目经理成员关系未准确持久化，立项已回滚');
    return { id: projectId, customer_id: who.recordId, approved_order_id: orderId, status: 'pending', member_count: 1 };
  }, businessContext(who.userId, who.organizationId), { require: true });
}

export async function linkProjectOrder(context: PluginContext, engine: IObjectQLEngine, sharing: ISharingService, ctx: Handler,
  synchronize: (projectId: string, transaction: ExecutionContext) => Promise<void>) {
  const who = caller(ctx, 'forge_project'), orderId = text(ctx.params.approved_order_id, '已批准销售订单'), contractId = text(ctx.params.contract_id, '销售合同');
  businessDriver(engine, ['forge_project', 'forge_project_member', 'forge_project_sales_link', 'forge_sales_contract', 'forge_sales_order', 'forge_sales_order_line', 'forge_sales_contract_line', 'sys_record_share']);
  return engine.transaction(async transaction => {
    await lockBusinessRow(engine, 'forge_project', who.recordId, who.organizationId, transaction);
    const native = await nativeCaller(context, who, transaction, ['forge_project_operator', 'sales_contract_operator']);
    await visible(native, 'forge_project', who.recordId, who);
    const project = await get(engine, 'forge_project', who.recordId, who, transaction);
    if (project.owner_id !== who.userId && project.manager_id !== who.userId || project.status !== 'pending') denied('仅当前待执行项目的所有者或经理可以关联准确来源');
    if (project.source_order_id && project.source_order_id !== orderId) changed('所选订单与本次立项来源不一致');
    await visible(native, 'forge_customer', String(project.customer_id), who);
    await lockBusinessRow(engine, 'forge_customer', String(project.customer_id), who.organizationId, transaction);
    await visible(native, 'forge_sales_order', orderId, who); await visible(native, 'forge_sales_contract', contractId, who);
    const source = await approvedProjectOrder(engine, String(project.customer_id), orderId, transaction, true);
    if (source.contract.id !== contractId || project.source_order_version && project.source_order_version !== source.version) changed('立项冻结订单或所选合同已变化');
    await visibleSource(native, source, who);
    if (!await validProjectManagerMember(engine, project, transaction, true)) denied('当前项目经理或有效成员关系不可确认');
    const links = await projectRows(engine, 'forge_project_sales_link', { project_id: who.recordId, organization_id: who.organizationId }, transaction, true);
    if (links.some(link => link.order_id !== orderId || link.contract_id !== contractId) || links.length > 1) changed('项目已关联其他订单，不能自动合并来源');
    await boundVersion(engine, who, transaction, 'project_link_contract');
    const type = await get(engine, 'forge_contract_type', String(source.contract.contract_type_id), who, transaction);
    const repeated = links.length === 1;
    if (!repeated) await engine.insert('forge_project_sales_link', { name: String(source.order.code || source.order.name), link_key: who.recordId + ':' + orderId,
      project_id: who.recordId, contract_id: contractId, order_id: orderId, organization_id: who.organizationId,
      contract_code_snapshot: source.contract.code, contract_type_snapshot: type.name, signed_on_snapshot: source.contract.signed_on,
      order_code_snapshot: source.order.code, order_status_snapshot: source.order.status, order_amount: source.order.total_amount,
      invoice_amount: source.order.invoice_amount || 0, collected_amount: source.order.collected_amount || 0 }, { context: transaction });
    const updated = await engine.update('forge_project', { source_order_id: orderId, source_order_version: source.version,
      contract_amount: roundedMoney(Number(source.order.total_amount)), invoice_amount: Number(source.order.invoice_amount || 0), collected_amount: Number(source.order.collected_amount || 0) },
    { multi: true, where: { id: who.recordId, organization_id: who.organizationId, owner_id: project.owner_id, manager_id: project.manager_id, status: 'pending' }, context: transaction });
    if (updated !== 1) changed('项目来源或经理已变化，关联已回滚');
    // Native Sharing is part of this same domain transaction; failure cannot
    // leave a usable link without its intended read-only handoff.
    void sharing;
    await synchronize(who.recordId, transaction);
    return { id: who.recordId, contract_id: contractId, approved_order_id: orderId, order_count: 1, repeated };
  }, businessContext(who.userId, who.organizationId), { require: true });
}

export async function startProject(context: PluginContext, engine: IObjectQLEngine, ctx: Handler) {
  const who = caller(ctx, 'forge_project');
  businessDriver(engine, ['forge_project', 'forge_project_member', 'forge_project_sales_link', 'forge_sales_contract', 'forge_sales_order', 'forge_sales_contract_line', 'forge_sales_order_line']);
  return engine.transaction(async transaction => {
    await lockBusinessRow(engine, 'forge_project', who.recordId, who.organizationId, transaction);
    const native = await nativeCaller(context, who, transaction, ['forge_project_manager', 'forge_project_operator']);
    await visible(native, 'forge_project', who.recordId, who);
    const project = await get(engine, 'forge_project', who.recordId, who, transaction);
    if (project.manager_id !== who.userId || project.status !== 'pending') denied('仅当前项目经理本人可以启动待执行项目');
    if (!await validProjectManagerMember(engine, project, transaction, true)) denied('项目经理须保持同组织有效任职及经理成员关系');
    const links = await projectRows(engine, 'forge_project_sales_link', { project_id: who.recordId, organization_id: who.organizationId }, transaction, true);
    if (links.length !== 1 || !project.source_order_id || links[0].order_id !== project.source_order_id) changed('本项目缺少唯一准确的已关联订单');
    await visible(native, 'forge_customer', String(project.customer_id), who);
    await lockBusinessRow(engine, 'forge_customer', String(project.customer_id), who.organizationId, transaction);
    await visible(native, 'forge_sales_order', String(links[0].order_id), who);
    await visible(native, 'forge_sales_contract', String(links[0].contract_id), who);
    const source = await approvedProjectOrder(engine, String(project.customer_id), String(links[0].order_id), transaction, true);
    if (source.contract.id !== links[0].contract_id || source.version !== project.source_order_version) changed('项目交付来源与关联冻结版本不一致');
    await visibleSource(native, source, who);
    // The manager's supported native reader is the existing record-bound
    // delivery-scope Action. Raw link IDs retain their original project-position
    // RLS; reading this exact controlled scope never grants arbitrary link CRUD.
    const read = await readProjectDeliveryScope(context, engine, { ...ctx, record: project }, transaction);
    const scope = read.scope, rows = scope.lines, sources = scope.sources, binding = read.binding, boundLinks = binding?.links;
    if (binding?.project_id !== who.recordId || binding.source_order_id !== source.order.id || binding.source_order_version !== source.version
      || !Array.isArray(boundLinks) || boundLinks.length !== 1 || businessRow(boundLinks[0])?.link_id !== links[0].id
      || businessRow(boundLinks[0])?.contract_id !== source.contract.id || businessRow(boundLinks[0])?.order_id !== source.order.id
      || !Array.isArray(rows) || rows.length !== source.orderLines.length || !Array.isArray(sources) || sources.length !== 1
      || businessRow(sources[0])?.order_code !== source.order.code || businessRow(sources[0])?.contract_code !== source.contract.code
      || rows.some(row => businessRow(row)?.trace_consistent !== true) || !Array.isArray(scope.warnings) || scope.warnings.length) denied('当前原生项目读取入口无法完整核对准确交付来源');
    await boundVersion(engine, who, transaction, 'project_start');
    const updated = await engine.update('forge_project', { status: 'in_progress' }, { multi: true, where: { id: who.recordId,
      organization_id: who.organizationId, manager_id: who.userId, status: 'pending', source_order_id: project.source_order_id, source_order_version: project.source_order_version }, context: transaction });
    if (updated !== 1) changed('项目状态、来源或经理已变化，启动未生效');
    const started = await get(engine, 'forge_project', who.recordId, who, transaction);
    if (started.status !== 'in_progress' || !started.actual_start_on) throw new Error('原生项目开始日期或状态未持久化，启动已回滚');
    return { id: who.recordId, status: 'in_progress', actual_start_on: started.actual_start_on };
  }, businessContext(who.userId, who.organizationId), { require: true });
}
