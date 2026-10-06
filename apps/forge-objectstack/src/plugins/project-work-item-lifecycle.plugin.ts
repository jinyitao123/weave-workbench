import { isGrantActive, isRowActive, type Plugin, type PluginContext } from '@objectstack/core';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { HookContext } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';

const PACKAGE_ID = 'com.inoforge.forge.project-work-item-lifecycle';
const WORK_ITEM = 'forge_project_work_item';
const PLAN = 'forge_project_plan';
const PROJECT = 'forge_project';
const MEMBER = 'forge_project_member';
const ASSIGNMENT = 'forge_project_member_position_assignment';
const TASK_TYPES = 'forge_business_setting_option';
const PRIORITIES = new Set(['urgent', 'high', 'medium', 'low']);
const MAX_PLAN_ITEMS = 5000;
const projectionTransactions = new WeakSet<object>();

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function systemContext(hook: HookContext): ExecutionContext {
  const userId = text(hook.session?.userId || hook.user?.id);
  const organizationId = text(hook.session?.organizationId || hook.user?.organizationId);
  return {
    isSystem: true,
    ...(userId ? { userId } : {}),
    ...(organizationId ? { tenantId: organizationId } : {}),
    ...(hook.transaction !== undefined ? { transaction: hook.transaction } : {}),
    ...(hook.id ? { traceId: hook.id } : {}),
  } as ExecutionContext;
}

function isoDate(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const instant = new Date(date + 'T00:00:00.000Z');
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === date ? date : '';
}

function positiveDaySpan(start: string, end: string): number {
  return Math.floor((Date.parse(end + 'T00:00:00.000Z') - Date.parse(start + 'T00:00:00.000Z')) / 86_400_000);
}

function parsePermissionNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(text).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function hookData(hook: HookContext): Row {
  const input = asRow(hook.input);
  return asRow(input.data);
}

function hookScope(hook: HookContext): Row {
  const dispatch = asRow(hook.dispatch);
  const scope = asRow(dispatch.scope);
  if (Object.keys(scope).length === 0 && dispatch.scope !== scope) dispatch.scope = scope;
  return scope;
}

function versionWhere(record: Row): Row {
  const updatedAt = text(record.updated_at);
  const timestamp = Date.parse(updatedAt);
  if (!updatedAt || !Number.isFinite(timestamp)) throw new Error('项目计划读取版本无效，请刷新后重试');
  return { updated_at: { $gte: new Date(timestamp).toISOString(), $lt: new Date(timestamp + 1).toISOString() } };
}

async function nativeTaskCapable(engine: IObjectQLEngine, positionId: string, organizationId: string, context: ExecutionContext): Promise<boolean> {
  const links = await engine.find('sys_position_permission_set', {
    where: { position_id: positionId }, fields: ['permission_set_id'], limit: 1000,
  }, { context });
  const permissionSetIds = [...new Set(links.map(link => text(link.permission_set_id)).filter(Boolean))];
  if (!permissionSetIds.length) return false;
  // Native PermissionSets are global metadata; the active organization-scoped position link is the boundary.
  const sets = await engine.find('sys_permission_set', {
    where: { id: { $in: permissionSetIds }, active: true },
    fields: ['id', 'active', 'system_permissions'], limit: 1000,
  }, { context });
  return sets.some(set => isRowActive(set) && parsePermissionNames(set.system_permissions).includes('forge_project_work_member'));
}

async function resolveTaskOwnerAssignment(
  engine: IObjectQLEngine,
  projectId: string,
  organizationId: string,
  member: Row,
  requestedId: string,
  context: ExecutionContext,
): Promise<string> {
  const userId = text(member.user_id);
  const user = await engine.findOne('sys_user', {
    where: { id: userId, banned: { $ne: true } },
    fields: ['id', 'banned'],
  }, { context });
  if (!user || user.banned === true) throw new Error('任务负责人账号不可用');
  let assignment: Row | null = null;
  if (requestedId) {
    assignment = await engine.findOne(ASSIGNMENT, {
      where: { id: requestedId, organization_id: organizationId, project_id: projectId, member_id: member.id, active: true },
      fields: ['id', 'position_id', 'active'],
    }, { context });
  } else {
    const defaults = await engine.find(ASSIGNMENT, {
      where: { organization_id: organizationId, project_id: projectId, member_id: member.id, active: true, is_default: true },
      fields: ['id', 'position_id', 'active'], limit: 3,
    }, { context });
    if (defaults.length > 1) throw new Error('该项目成员有多个默认岗位，请先在团队编辑器中核对');
    assignment = defaults[0] || null;
  }
  if (!assignment || assignment.active !== true) throw new Error('负责人没有有效的项目岗位');
  const positionId = text(assignment.position_id);
  const position = await engine.findOne('sys_position', {
    where: { id: positionId, organization_id: organizationId, active: true },
    fields: ['id', 'name', 'active'],
  }, { context });
  if (!position || position.active === false || !text(position.name)) throw new Error('所选组织岗位已停用');
  const appointments = await engine.find('sys_user_position', {
    where: { user_id: userId, organization_id: organizationId, position: position.name },
    fields: ['user_id', 'organization_id', 'position', 'valid_from', 'valid_until'], limit: 500,
  }, { context });
  const appointed = appointments.some(row =>
    text(row.user_id) === userId && text(row.organization_id) === organizationId
    && text(row.position) === text(position.name) && isGrantActive(row, Date.now()),
  );
  if (!appointed) throw new Error('该成员已不再持有所选组织岗位');
  if (!await nativeTaskCapable(engine, positionId, organizationId, context)) throw new Error('该岗位没有项目执行权限');
  return text(assignment.id);
}

async function validateAndNormalizeWorkItem(engine: IObjectQLEngine, hook: HookContext): Promise<void> {
  const values = hookData(hook);
  const actor = text(hook.session?.userId || hook.user?.id);
  const organizationId = text(hook.session?.organizationId || hook.user?.organizationId);
  if (!actor || !organizationId) throw new Error('项目工作项创建缺少当前员工或组织上下文');
  if (hook.transaction == null) throw new Error('项目工作项创建必须在数据库事务中执行');
  if (values.organization_id != null && text(values.organization_id) !== organizationId) throw new Error('项目工作项不能跨组织创建');

  const projectId = text(values.project_id);
  const planId = text(values.plan_id);
  if (!projectId || !planId) throw new Error('工作项必须关联当前项目和执行计划');
  const context = systemContext(hook);
  const [project, plan] = await Promise.all([
    engine.findOne(PROJECT, { where: { id: projectId, organization_id: organizationId }, fields: ['id', 'organization_id'] }, { context }),
    engine.findOne(PLAN, { where: { id: planId, project_id: projectId, organization_id: organizationId }, fields: ['id', 'project_id', 'organization_id', 'status'] }, { context }),
  ]);
  if (!project || text(project.organization_id) !== organizationId) throw new Error('所属项目不存在或不属于当前组织');
  if (!plan || text(plan.project_id) !== projectId || text(plan.organization_id) !== organizationId) throw new Error('项目计划不存在或不属于当前项目组织');
  if (plan.status !== 'active') throw new Error('仅执行中的计划可以添加工作项');

  const name = text(values.name);
  const itemType = text(values.item_type || 'task');
  if (!name) throw new Error('工作项名称不能为空');
  if (!['phase', 'milestone', 'task'].includes(itemType)) throw new Error('工作项类型必须是阶段、里程碑或任务');
  const plannedStart = isoDate(values.planned_start_on);
  const plannedEnd = isoDate(values.planned_end_on);
  if (!plannedStart || !plannedEnd) throw new Error('计划开始和结束日期必须是有效日期');
  if (plannedEnd < plannedStart) throw new Error('计划结束日期不得早于计划开始日期');

  const parentId = text(values.parent_id);
  if (itemType === 'phase' && parentId) throw new Error('阶段必须是顶层工作项');
  if (parentId) {
    const parent = await engine.findOne(WORK_ITEM, {
      where: { id: parentId, plan_id: planId, project_id: projectId, organization_id: organizationId },
      fields: ['id', 'item_type'],
    }, { context });
    if (!parent || parent.item_type !== 'phase') throw new Error('所属阶段必须来自当前计划');
  }

  const predecessorInput = values.predecessor_ids;
  const predecessorIds = Array.isArray(predecessorInput) ? predecessorInput.map(text).filter(Boolean) : text(predecessorInput) ? [text(predecessorInput)] : [];
  if (predecessorIds.length) {
    const predecessors = await engine.find(WORK_ITEM, {
      where: { id: { $in: predecessorIds }, plan_id: planId, project_id: projectId, organization_id: organizationId },
      fields: ['id', 'item_type'], limit: predecessorIds.length + 1,
    }, { context });
    if (predecessors.length !== predecessorIds.length || predecessors.some(row => row.item_type === 'phase')) {
      throw new Error('前置任务必须是当前计划中的任务或里程碑');
    }
  }

  const dispatch = asRow(hook.dispatch);
  const scope = hookScope(hook);
  const planStates = asRow(scope.projectWorkItemPlanStates);
  if (scope.projectWorkItemPlanStates !== planStates) scope.projectWorkItemPlanStates = planStates;
  let planState = asRow(planStates[planId]);
  if (typeof planState.nextSequence !== 'number' || typeof planState.nextSortOrder !== 'number' || !(planState.names instanceof Set)) {
    const existing = await engine.find(WORK_ITEM, {
      where: { plan_id: planId, project_id: projectId, organization_id: organizationId },
      fields: ['id', 'name', 'item_key', 'sort_order'], orderBy: [{ field: 'id', order: 'asc' }], limit: MAX_PLAN_ITEMS + 1,
    }, { context });
    if (existing.length > MAX_PLAN_ITEMS) throw new Error('当前计划工作项超过安全上限，暂不能导入');
    const maxSequence = existing.reduce((max, row) => {
      const key = text(row.item_key);
      const prefix = planId + ':';
      const suffix = key.startsWith(prefix) ? Number(key.slice(prefix.length)) : 0;
      return Number.isSafeInteger(suffix) ? Math.max(max, suffix) : max;
    }, 0);
    const maxSortOrder = existing.reduce((max, row) => Math.max(max, Number(row.sort_order) || 0), 0);
    planState = {
      nextSequence: maxSequence,
      nextSortOrder: maxSortOrder,
      names: new Set(existing.map(row => text(row.name)).filter(Boolean)),
    };
    planStates[planId] = planState;
  }
  const names = planState.names as Set<string>;
  if (names.has(name)) throw new Error('当前计划已存在同名工作项');

  let ownerId = text(values.owner_id);
  let ownerPositionAssignmentId = '';
  let taskTypeId = '';
  let priority: string | null = null;
  let estimatedHours: number | null = null;
  if (itemType === 'task') {
    if (!ownerId) throw new Error('任务负责人必须选择当前项目有效成员');
    const taskType = text(values.task_type);
    const option = taskType ? await engine.findOne(TASK_TYPES, {
      where: { id: taskType, organization_id: organizationId, scope: 'project', setting_type: 'task_type', enabled: true },
      fields: ['id', 'organization_id', 'scope', 'setting_type', 'enabled'],
    }, { context }) : null;
    if (!option || option.enabled === false || text(option.organization_id) !== organizationId) throw new Error('任务类别不存在或已停用，请刷新后重试');
    const priorityValue = text(values.priority) || 'medium';
    if (!PRIORITIES.has(priorityValue)) throw new Error('任务优先级不合法');
    priority = priorityValue;
    estimatedHours = values.estimated_hours == null || values.estimated_hours === '' ? 8 : Number(values.estimated_hours);
    if (!Number.isFinite(estimatedHours) || estimatedHours < 0) throw new Error('预估工时必须是大于或等于零的有效数字');
    taskTypeId = text(option.id);
  }

  if (ownerId) {
    const member = await engine.findOne(MEMBER, {
      where: { project_id: projectId, organization_id: organizationId, user_id: ownerId, active: true },
      fields: ['id', 'user_id', 'member_duty', 'active', 'organization_id'],
    }, { context });
    if (!member || member.active !== true || !['manager', 'member'].includes(String(member.member_duty))) {
      throw new Error('负责人必须是当前项目组织内的有效成员');
    }
    if (itemType === 'task') {
      ownerPositionAssignmentId = await resolveTaskOwnerAssignment(engine, projectId, organizationId, member, text(values.owner_position_assignment_id), context);
    }
  } else if (itemType === 'task') {
    throw new Error('任务负责人必须选择当前项目有效成员');
  }

  if (dispatch.mode === 'per-row' && itemType !== 'task') {
    throw new Error('批量导入仅支持新建任务');
  }

  const durationDays = positiveDaySpan(plannedStart, plannedEnd);
  const sequence = Number(planState.nextSequence) + 1;
  if (sequence > MAX_PLAN_ITEMS) throw new Error('当前计划工作项达到安全上限，暂不能继续创建');
  const sortOrder = Number(planState.nextSortOrder) + 10;
  Object.assign(values, {
    name,
    organization_id: organizationId,
    project_id: projectId,
    plan_id: planId,
    item_type: itemType,
    parent_id: parentId || null,
    owner_id: ownerId || null,
    owner_position_assignment_id: ownerPositionAssignmentId || null,
    planned_start_on: plannedStart,
    planned_end_on: plannedEnd,
    duration_days: durationDays,
    predecessor_ids: predecessorIds,
    weight: Number.isFinite(Number(values.weight)) ? Number(values.weight) : 20,
    critical_path: values.critical_path === true,
    planned_deliverable: text(values.planned_deliverable) || null,
    task_type: taskTypeId || null,
    priority,
    estimated_hours: estimatedHours,
    status: 'pending',
    progress: 0,
    actual_start_on: null,
    actual_end_on: null,
    item_key: planId + ':' + sequence,
    sort_order: sortOrder,
  });
  names.add(name);
  planState.nextSequence = sequence;
  planState.nextSortOrder = sortOrder;
}

async function refreshPlanSummary(engine: IObjectQLEngine, hook: HookContext): Promise<void> {
  const event = String(hook.event || '');
  const currentRows = event === 'afterDelete' ? [] : Array.isArray(hook.result) ? hook.result.map(asRow) : [asRow(hook.result)];
  const previousRows = hook.previous ? [asRow(hook.previous)] : [];
  const affectedRows = [...previousRows, ...currentRows].filter(row => text(row.id));
  if (!affectedRows.length) throw new Error('项目工作项变更后缺少记录上下文，无法刷新汇总');
  const context = systemContext(hook);
  const scope = hookScope(hook);
  const summaries = asRow(scope.projectWorkItemSummaries);
  if (scope.projectWorkItemSummaries !== summaries) scope.projectWorkItemSummaries = summaries;
  const processedPlans = summaries.processedPlans instanceof Set ? summaries.processedPlans as Set<string> : new Set<string>();
  const processedPhases = summaries.processedPhases instanceof Set ? summaries.processedPhases as Set<string> : new Set<string>();
  summaries.processedPlans = processedPlans;
  summaries.processedPhases = processedPhases;

  const changedRows = new Map<string, Row>();
  for (const row of affectedRows) {
    const key = [row.id, row.organization_id, row.project_id, row.plan_id, row.parent_id].map(text).join('\u0000');
    changedRows.set(key, row);
  }
  for (const row of changedRows.values()) {
    const parentId = text(row.parent_id);
    const planId = text(row.plan_id), projectId = text(row.project_id), organizationId = text(row.organization_id);
    if (parentId && !processedPhases.has(parentId)) {
      await refreshPhaseSummary(engine, hook, parentId, projectId, organizationId);
      processedPhases.add(parentId);
    }
    if (planId && projectId && organizationId) {
      const planKey = organizationId + '\u0000' + projectId + '\u0000' + planId;
      if (!processedPlans.has(planKey)) {
        await refreshPlanSummaryForScope(engine, hook, planId, projectId, organizationId);
        processedPlans.add(planKey);
      }
    }
  }
}

async function refreshPhaseSummary(engine: IObjectQLEngine, hook: HookContext, phaseId: string, projectId: string, organizationId: string): Promise<void> {
  const context = systemContext(hook);
  const [phase, children] = await Promise.all([
    engine.findOne(WORK_ITEM, { where: { id: phaseId, project_id: projectId, organization_id: organizationId, item_type: 'phase' }, fields: ['id', 'project_id', 'organization_id', 'updated_at', 'progress', 'status', 'actual_start_on', 'actual_end_on'] }, { context }),
    engine.find(WORK_ITEM, { where: { parent_id: phaseId, project_id: projectId, organization_id: organizationId }, fields: ['id', 'item_type', 'progress', 'status', 'actual_start_on', 'actual_end_on'], orderBy: [{ field: 'id', order: 'asc' }], limit: MAX_PLAN_ITEMS + 1 }, { context }),
  ]);
  if (!phase) throw new Error('所属阶段不存在或已变化，不能更新项目汇总');
  if (children.length > MAX_PLAN_ITEMS) throw new Error('阶段下工作项超过安全上限，无法刷新阶段汇总');
  const activeChildren = children.filter(row => row.item_type !== 'phase' && row.status !== 'cancelled');
  const phaseProgress = activeChildren.length
    ? Math.round(activeChildren.reduce((sum, row) => sum + Number(row.progress || 0), 0) / activeChildren.length)
    : 0;
  const phaseStatus = !activeChildren.length || activeChildren.every(row => row.status === 'pending') ? 'pending'
    : activeChildren.every(row => row.status === 'completed') ? 'completed'
      : activeChildren.some(row => row.status === 'delayed') ? 'delayed'
        : 'in_progress';
  const actualStarts = activeChildren.map(row => isoDate(row.actual_start_on)).filter(Boolean).sort();
  const actualEnds = phaseStatus === 'completed' ? activeChildren.map(row => isoDate(row.actual_end_on)).filter(Boolean).sort() : [];
  const actualStart = actualStarts[0] || null;
  const actualEnd = actualEnds.length ? actualEnds[actualEnds.length - 1] : null;
  if (Number(phase.progress || 0) === phaseProgress && text(phase.status) === phaseStatus
      && (isoDate(phase.actual_start_on) || null) === actualStart && (isoDate(phase.actual_end_on) || null) === actualEnd) return;

  const tx = hook.transaction;
  const marker = tx && typeof tx === 'object' ? tx as object : undefined;
  if (marker) projectionTransactions.add(marker);
  try {
    const changed = await engine.update(WORK_ITEM, {
      progress: phaseProgress, status: phaseStatus, actual_start_on: actualStart, actual_end_on: actualEnd,
    }, { multi: true, where: { id: phaseId, project_id: projectId, organization_id: organizationId, ...versionWhere(phase) }, context });
    if (changed !== 1) throw new Error('所属阶段已被修改，请重新读取后重试');
  } finally {
    if (marker) projectionTransactions.delete(marker);
  }
}

async function refreshPlanSummaryForScope(engine: IObjectQLEngine, hook: HookContext, planId: string, projectId: string, organizationId: string): Promise<void> {
  const context = systemContext(hook);
  const [plan, project, items] = await Promise.all([
    engine.findOne(PLAN, { where: { id: planId, project_id: projectId, organization_id: organizationId }, fields: ['id', 'project_id', 'organization_id', 'updated_at', 'item_count', 'progress'] }, { context }),
    engine.findOne(PROJECT, { where: { id: projectId, organization_id: organizationId }, fields: ['id', 'organization_id', 'updated_at', 'progress'] }, { context }),
    engine.find(WORK_ITEM, { where: { plan_id: planId, project_id: projectId, organization_id: organizationId }, fields: ['id', 'item_type', 'progress', 'status'], orderBy: [{ field: 'id', order: 'asc' }], limit: MAX_PLAN_ITEMS + 1 }, { context }),
  ]);
  if (!plan || !project || text(plan.project_id) !== projectId || text(project.organization_id) !== organizationId) {
    throw new Error('项目工作项变更后，所属项目或计划已变化');
  }
  if (items.length > MAX_PLAN_ITEMS) throw new Error('当前计划工作项超过安全上限，无法刷新计划汇总');
  const leafValues = items.filter(item => item.item_type !== 'phase' && item.status !== 'cancelled').map(item => Number(item.progress || 0));
  const planProgress = leafValues.length ? Math.round(leafValues.reduce((sum, value) => sum + value, 0) / leafValues.length) : 0;
  if (Number(plan.item_count || 0) !== items.length || Number(plan.progress || 0) !== planProgress) {
    const changedPlan = await engine.update(PLAN, { item_count: items.length, progress: planProgress }, {
      multi: true, where: { id: planId, project_id: projectId, organization_id: organizationId, ...versionWhere(plan) }, context,
    });
    if (changedPlan !== 1) throw new Error('项目计划已被修改，请重新读取后重试');
  }
  if (Number(project.progress || 0) !== planProgress) {
    const changedProject = await engine.update(PROJECT, { progress: planProgress }, {
      multi: true, where: { id: projectId, organization_id: organizationId, ...versionWhere(project) }, context,
    });
    if (changedProject !== 1) throw new Error('所属项目已被修改，请重新读取后重试');
  }
}

async function requireWorkItemTransaction(hook: HookContext, operation: string): Promise<void> {
  if (hook.transaction == null) throw new Error('项目工作项' + operation + '必须在数据库事务中执行');
}

async function validateWorkItemUpdate(hook: HookContext): Promise<void> {
  await requireWorkItemTransaction(hook, '更新');
  const previous = asRow(hook.previous);
  const organizationId = text(hook.session?.organizationId || hook.user?.organizationId);
  if (!text(previous.id) || !organizationId || text(previous.organization_id) !== organizationId) {
    throw new Error('项目工作项更新缺少有效记录或当前组织上下文');
  }
}

async function validateWorkItemDelete(hook: HookContext): Promise<void> {
  await requireWorkItemTransaction(hook, '删除');
  const previous = asRow(hook.previous);
  const organizationId = text(hook.session?.organizationId || hook.user?.organizationId);
  if (!text(previous.id) || !organizationId || text(previous.organization_id) !== organizationId) {
    throw new Error('项目工作项删除缺少有效记录或当前组织上下文');
  }
}

async function refreshWorkItemSummary(engine: IObjectQLEngine, hook: HookContext): Promise<void> {
  const transaction = hook.transaction;
  if (transaction && typeof transaction === 'object' && projectionTransactions.has(transaction as object)) return;
  await refreshPlanSummary(engine, hook);
}

export class ProjectWorkItemLifecyclePlugin implements Plugin {
  name = PACKAGE_ID;
  version = '1.0.0';
  type = 'standard' as const;

  init(ctx: PluginContext): void {
    ctx.hook('kernel:ready', () => {
      const engine = ctx.getService<IObjectQLEngine>('objectql');
      engine.registerMiddleware(async (operation, next) => {
        const writeOperation = ['insert', 'update', 'delete'].includes(text(operation.operation));
        if (text(operation.object) !== WORK_ITEM || !writeOperation || asRow(operation.context).transaction != null) {
          return next();
        }
        const originalContext = operation.context;
        await engine.transaction(async transactionContext => {
          if (transactionContext?.transaction == null) throw new Error('项目工作项变更必须在可回滚事务中执行');
          operation.context = transactionContext;
          try {
            await next();
          } finally {
            operation.context = originalContext;
          }
        }, originalContext, { require: true });
      }, { object: WORK_ITEM });
      engine.registerHook('beforeInsert', hook => validateAndNormalizeWorkItem(engine, hook), {
        object: WORK_ITEM, priority: 200, packageId: PACKAGE_ID,
      });
      engine.registerHook('afterInsert', hook => refreshWorkItemSummary(engine, hook), {
        object: WORK_ITEM, priority: 200, packageId: PACKAGE_ID,
      });
      engine.registerHook('beforeUpdate', hook => validateWorkItemUpdate(hook), {
        object: WORK_ITEM, priority: 200, packageId: PACKAGE_ID,
      });
      engine.registerHook('afterUpdate', hook => refreshWorkItemSummary(engine, hook), {
        object: WORK_ITEM, priority: 200, packageId: PACKAGE_ID,
      });
      engine.registerHook('beforeDelete', hook => validateWorkItemDelete(hook), {
        object: WORK_ITEM, priority: 200, packageId: PACKAGE_ID,
      });
      engine.registerHook('afterDelete', hook => refreshWorkItemSummary(engine, hook), {
        object: WORK_ITEM, priority: 200, packageId: PACKAGE_ID,
      });
      ctx.logger.info('Project WorkItem insert/update/delete lifecycle hooks registered');
    });
  }
}
