import { isGrantActive, isRowActive, type Plugin, type PluginContext } from '@objectstack/core';
import { buildContextForUser } from '@objectstack/plugin-security';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { HookContext } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { organizationBusinessDate } from './project-business-date.plugin.js';

const PACKAGE_ID = 'com.inoforge.forge.project-member-maintenance';
const PROJECT_OBJECT = 'forge_project';
const MEMBER_OBJECT = 'forge_project_member';
const OPERATOR_PERMISSION = 'forge_project_operator';

type Row = Record<string, unknown>;
type PermissionResolver = (reader: IObjectQLEngine, userId: string, now: number, organizationId: string) => Promise<unknown>;

type HandoffOperation = 'insert-new-manager' | 'promote-new-manager' | 'deactivate-old-manager';
interface ManagerHandoffPermit {
  operation: HandoffOperation;
  actorId: string;
  organizationId: string;
  projectId: string;
  oldManagerId: string;
  newManagerId: string;
  oldMemberId: string;
  newMemberId?: string;
}

// Only the trusted project afterUpdate hook can create these short-lived permits.
// They are bound to the exact live transaction and one relationship mutation.
const managerHandoffPermits = new WeakMap<object, ManagerHandoffPermit>();

function row(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function hookInputData(hook: HookContext): Row {
  const input = row(hook.input);
  return input.data && typeof input.data === 'object' ? row(input.data) : input;
}

function transactionHandle(hook: HookContext): object | null {
  const transaction = hook.transaction;
  return transaction && (typeof transaction === 'object' || typeof transaction === 'function') ? transaction as object : null;
}

function handoffPermit(hook: HookContext): ManagerHandoffPermit | undefined {
  const transaction = transactionHandle(hook);
  return transaction ? managerHandoffPermits.get(transaction) : undefined;
}

function scopeFor(hook: HookContext, organizationId: string): ExecutionContext {
  return {
    isSystem: true,
    userId: text(hook.session?.userId || hook.user?.id),
    tenantId: organizationId,
    ...(hook.transaction !== undefined ? { transaction: hook.transaction } : {}),
    ...(hook.id ? { traceId: hook.id } : {}),
  } as ExecutionContext;
}

function readInContext(engine: IObjectQLEngine, base: ExecutionContext, transaction?: unknown): IObjectQLEngine {
  return {
    find: (object: string, options: Record<string, unknown> = {}) => {
      const { context: requestedContext, ...query } = options;
      return engine.find(object, query, {
        context: {
          ...base,
          ...row(requestedContext),
          ...(transaction !== undefined ? { transaction } : {}),
        } as ExecutionContext,
      });
    },
  } as unknown as IObjectQLEngine;
}

async function defaultPermissionResolver(
  reader: IObjectQLEngine,
  userId: string,
  now: number,
  organizationId: string,
): Promise<unknown> {
  return buildContextForUser(reader, userId, now, organizationId);
}

async function activeOrganizationUser(
  engine: IObjectQLEngine,
  targetUserId: string,
  organizationId: string,
  context: ExecutionContext,
): Promise<Row> {
  const [user, membership] = await Promise.all([
    engine.findOne('sys_user', { where: { id: targetUserId } }, { context }),
    engine.findOne('sys_member', { where: { user_id: targetUserId, organization_id: organizationId } }, { context }),
  ]);
  const now = Date.now();
  if (!user || !isRowActive(user) || user.banned === true || !membership
    || !isRowActive(membership) || !isGrantActive(membership, now) || !windowIsActive(membership, now)) {
    throw new Error('项目成员必须是当前组织内有效账号');
  }
  return row(user);
}

async function projectManagerTarget(
  engine: IObjectQLEngine,
  targetUserId: string,
  organizationId: string,
  context: ExecutionContext,
  resolvePermissions: PermissionResolver = defaultPermissionResolver,
): Promise<Row> {
  const user = await activeOrganizationUser(engine, targetUserId, organizationId, context);
  const reader = readInContext(engine, context, context.transaction);
  const effective = row(await resolvePermissions(reader, targetUserId, Date.now(), organizationId));
  const permissions = new Set(Array.isArray(effective.systemPermissions) ? effective.systemPermissions.map(text) : []);
  if (!permissions.has('forge_project_manager')) throw new Error('新项目负责人必须具备项目经理执行权限');
  if (!permissions.has(OPERATOR_PERMISSION)) throw new Error('新项目负责人必须具备项目办理权限');
  return user;
}

async function stampProjectManagerSnapshot(engine: IObjectQLEngine, hook: HookContext): Promise<void> {
  const input = hookInputData(hook);
  const managerId = text(input.manager_id);
  if (!managerId) return;
  const organizationId = text(hook.session?.organizationId || hook.user?.organizationId);
  if (!organizationId) throw new Error('立项时无法确认项目负责人的组织');
  const manager = await activeOrganizationUser(engine, managerId, organizationId, scopeFor(hook, organizationId));
  input.manager_name_snapshot = text(manager.display_name || manager.name || manager.username) || '项目成员';
}

function exactVersionRange(value: unknown, expected: unknown): boolean {
  const range = row(value);
  const actualTime = expected instanceof Date ? expected.getTime() : Date.parse(text(expected));
  const lowerTime = range.$gte instanceof Date ? range.$gte.getTime() : Date.parse(text(range.$gte));
  const upperTime = range.$lt instanceof Date ? range.$lt.getTime() : Date.parse(text(range.$lt));
  return Number.isFinite(actualTime) && lowerTime === actualTime && upperTime === actualTime + 1;
}

async function validateProjectManagerChange(
  engine: IObjectQLEngine,
  hook: HookContext,
  resolvePermissions: PermissionResolver = defaultPermissionResolver,
): Promise<void> {
  const input = hookInputData(hook);
  const previous = row(hook.previous);
  const hasTransferTarget = Object.prototype.hasOwnProperty.call(input, 'manager_transfer_target_id');
  const submittedManagerId = text(input.manager_id);
  const oldManagerId = text(previous.manager_id);
  if (!hasTransferTarget) {
    if (submittedManagerId && submittedManagerId !== oldManagerId) {
      throw new Error('项目负责人只读，请使用“变更项目负责人”操作');
    }
    return;
  }
  if (submittedManagerId && submittedManagerId !== oldManagerId) throw new Error('项目负责人字段只读，请通过负责人交接目标办理');
  const nextManagerId = text(input.manager_transfer_target_id);
  if (!nextManagerId) throw new Error('项目负责人不能为空');
  if (nextManagerId === oldManagerId) {
    delete input.manager_transfer_target_id;
    return;
  }

  const envelope = row(hook.input);
  const projectId = text(envelope.id || previous.id);
  const actorId = text(hook.session?.userId || hook.user?.id);
  const organizationId = text(hook.session?.organizationId || hook.user?.organizationId);
  if (!projectId || !actorId || !organizationId || text(previous.organization_id) !== organizationId) {
    throw new Error('无法确认项目负责人交接的项目、操作人和组织');
  }
  if (text(previous.owner_id) !== actorId && oldManagerId !== actorId) {
    throw new Error('仅项目所有者或当前项目经理可以变更负责人');
  }

  const options = row(envelope.options);
  const where = row(options.where);
  if (options.multi !== true || text(where.id) !== projectId
    || text(where.organization_id) !== organizationId || text(where.manager_id) !== oldManagerId
    || !exactVersionRange(where.updated_at, previous.updated_at)) {
    throw new Error('项目负责人变更必须使用当前版本办理，请从“变更项目负责人”入口重新操作');
  }
  if (!transactionHandle(hook)) throw new Error('项目负责人交接必须在同一数据库事务中完成');

  const executionContext = scopeFor(hook, organizationId);
  const reader = readInContext(engine, executionContext, hook.transaction);
  const effective = row(await resolvePermissions(reader, actorId, Date.now(), organizationId));
  const systemPermissions = new Set(Array.isArray(effective.systemPermissions) ? effective.systemPermissions.map(text) : []);
  if (!systemPermissions.has(OPERATOR_PERMISSION)) throw new Error('当前账号没有项目负责人交接权限');

  const project = await engine.findOne(PROJECT_OBJECT, {
    where: { id: projectId, organization_id: organizationId },
    fields: ['id', 'organization_id', 'manager_id'],
  }, { context: executionContext });
  if (!project || text(project.manager_id) !== oldManagerId) throw new Error('项目负责人已变化，请刷新后重新办理');

  const managerRows = await engine.find(MEMBER_OBJECT, {
    where: { project_id: projectId, organization_id: organizationId, member_duty: 'manager', active: true },
    fields: ['id', 'project_id', 'organization_id', 'user_id', 'member_duty', 'active', 'membership_key'],
  }, { context: executionContext });
  if (managerRows.length !== 1 || text(managerRows[0].user_id) !== oldManagerId) {
    throw new Error('当前项目负责人关系不唯一或缺失，请先核对项目团队');
  }

  const target = await projectManagerTarget(engine, nextManagerId, organizationId, executionContext, resolvePermissions);
  input.manager_id = nextManagerId;
  input.manager_name_snapshot = text(target.display_name || target.name || target.username) || '项目成员';
  delete input.manager_transfer_target_id;
}

async function synchronizeProjectManagerMembership(
  engine: IObjectQLEngine,
  hook: HookContext,
  resolvePermissions: PermissionResolver = defaultPermissionResolver,
): Promise<void> {
  const input = hookInputData(hook);
  const previous = row(hook.previous);
  if (!Object.prototype.hasOwnProperty.call(input, 'manager_id')) return;
  const oldManagerId = text(previous.manager_id);
  const newManagerId = text(input.manager_id);
  if (!newManagerId || newManagerId === oldManagerId) return;

  const transaction = transactionHandle(hook);
  if (!transaction) throw new Error('项目负责人关系同步必须处于原始项目事务中');
  if (managerHandoffPermits.has(transaction)) throw new Error('项目负责人关系正在另一项交接中');
  const envelope = row(hook.input);
  const projectId = text(envelope.id || previous.id);
  const actorId = text(hook.session?.userId || hook.user?.id);
  const organizationId = text(hook.session?.organizationId || hook.user?.organizationId);
  if (!projectId || !oldManagerId || !actorId || !organizationId || text(previous.organization_id) !== organizationId) {
    throw new Error('无法确认项目负责人关系同步上下文');
  }

  const context = scopeFor(hook, organizationId);
  const project = await engine.findOne(PROJECT_OBJECT, {
    where: { id: projectId, organization_id: organizationId },
    fields: ['id', 'organization_id', 'owner_id', 'manager_id'],
  }, { context });
  if (!project || text(project.manager_id) !== newManagerId || text(project.organization_id) !== organizationId) {
    throw new Error('项目负责人字段未能读回，关系同步已中止');
  }

  const target = await projectManagerTarget(engine, newManagerId, organizationId, context, resolvePermissions);
  const members = {
    insert: (data: Record<string, unknown>) => engine.insert(MEMBER_OBJECT, data, { context }),
    update: (data: Record<string, unknown>, options: Record<string, unknown>) => engine.update(MEMBER_OBJECT, data, { ...options, context }),
  };
  const allManagers = await engine.find(MEMBER_OBJECT, {
    where: { project_id: projectId, organization_id: organizationId, member_duty: 'manager', active: true },
    fields: ['id', 'project_id', 'organization_id', 'user_id', 'member_duty', 'joined_on', 'active', 'membership_key', 'updated_at'],
  }, { context });
  const oldRows = allManagers.filter(candidate => text(candidate.user_id) === oldManagerId);
  if (allManagers.length !== 1 || oldRows.length !== 1) throw new Error('当前负责人关系不唯一或缺失，无法安全交接');
  const oldMember = oldRows[0];

  const nextRows = await engine.find(MEMBER_OBJECT, {
    where: { membership_key: projectId + ':' + newManagerId, organization_id: organizationId },
    fields: ['id', 'project_id', 'organization_id', 'user_id', 'member_duty', 'joined_on', 'active', 'membership_key', 'updated_at', 'remarks'],
  }, { context });
  if (nextRows.length > 1) throw new Error('新负责人已有重复项目成员关系，无法安全交接');
  const nextMember = nextRows[0];
  if (nextMember && (text(nextMember.project_id) !== projectId || text(nextMember.user_id) !== newManagerId
    || text(nextMember.organization_id) !== organizationId || text(nextMember.membership_key) !== projectId + ':' + newManagerId
    || !['member', 'manager'].includes(text(nextMember.member_duty)))) {
    throw new Error('新负责人项目成员关系标识不一致，无法安全交接');
  }

  const businessDate = await organizationBusinessDate(engine, context);
  const operation = async (permit: ManagerHandoffPermit, write: () => Promise<unknown>) => {
    managerHandoffPermits.set(transaction, permit);
    try { await write(); } finally { managerHandoffPermits.delete(transaction); }
  };
  const nextDisplayName = text(target.display_name || target.name || target.username) || '项目成员';
  if (nextMember) {
    if (!(nextMember.active === true && nextMember.member_duty === 'manager')) {
      const reactivate = nextMember.active !== true;
      await operation({
        operation: 'promote-new-manager', actorId, organizationId, projectId, oldManagerId, newManagerId,
        oldMemberId: text(oldMember.id), newMemberId: text(nextMember.id),
      }, async () => {
        const changed = await members.update({
          member_duty: 'manager',
          ...(reactivate ? { active: true, joined_on: businessDate } : {}),
          name: nextDisplayName,
        }, { multi: true, where: {
          id: nextMember.id, project_id: projectId, user_id: newManagerId,
          membership_key: projectId + ':' + newManagerId, organization_id: organizationId,
          active: nextMember.active === true, member_duty: nextMember.member_duty,
        } });
        if (changed !== 1) throw new Error('新负责人项目成员关系已变化，请刷新后重试');
      });
    }
  } else {
    await operation({
      operation: 'insert-new-manager', actorId, organizationId, projectId, oldManagerId, newManagerId,
      oldMemberId: text(oldMember.id),
    }, async () => {
      const created = await members.insert({
        name: nextDisplayName, membership_key: projectId + ':' + newManagerId, project_id: projectId,
        user_id: newManagerId, member_duty: 'manager', joined_on: businessDate,
        active: true, remarks: '项目负责人交接', organization_id: organizationId,
      });
      const createdId = typeof created === 'string' ? created : row(created).id || row(row(created).record).id;
      if (!createdId) throw new Error('新项目负责人关系创建后未返回记录标识');
    });
  }

  await operation({
    operation: 'deactivate-old-manager', actorId, organizationId, projectId, oldManagerId, newManagerId,
    oldMemberId: text(oldMember.id), newMemberId: text(nextMember?.id),
  }, async () => {
    const changed = await members.update({ active: false }, { multi: true, where: {
      id: oldMember.id, project_id: projectId, user_id: oldManagerId,
      membership_key: projectId + ':' + oldManagerId, organization_id: organizationId,
      active: true, member_duty: 'manager',
    } });
    if (changed !== 1) throw new Error('原项目负责人关系已变化，请刷新后重试');
  });

  const oldPositionAssignments = await engine.find('forge_project_member_position_assignment', {
    where: { project_id: projectId, member_id: oldMember.id, organization_id: organizationId, active: true },
    fields: ['id', 'project_id', 'member_id', 'organization_id', 'active', 'is_default', 'updated_at'],
    limit: 500,
  }, { context });
  for (const assignment of oldPositionAssignments) {
    const updatedAt = text(assignment.updated_at);
    const updatedAtTime = Date.parse(updatedAt);
    if (!Number.isFinite(updatedAtTime)) throw new Error('原负责人岗位分配版本无效');
    const changed = await engine.update('forge_project_member_position_assignment', {
      active: false, is_default: false, ended_at: new Date().toISOString(),
    }, { multi: true, where: {
      id: text(assignment.id), project_id: projectId, member_id: text(oldMember.id), organization_id: organizationId,
      active: true, updated_at: { $gte: new Date(updatedAtTime).toISOString(), $lt: new Date(updatedAtTime + 1).toISOString() },
    }, context });
    if (changed !== 1) throw new Error('原负责人岗位分配已变化，负责人交接已取消');
  }

  const activeManagers = await engine.find(MEMBER_OBJECT, {
    where: { project_id: projectId, organization_id: organizationId, member_duty: 'manager', active: true },
    fields: ['id', 'user_id'],
  }, { context });
  if (activeManagers.length !== 1 || text(activeManagers[0].user_id) !== newManagerId) {
    throw new Error('项目负责人关系同步后不一致，交接已撤销');
  }
}

async function assertManagerHandoffMemberMutation(
  engine: IObjectQLEngine,
  hook: HookContext,
  event: 'beforeInsert' | 'beforeUpdate' | 'beforeDelete',
  permit: ManagerHandoffPermit,
): Promise<void> {
  const input = hookInputData(hook);
  const previous = row(hook.previous);
  const actorId = text(hook.session?.userId || hook.user?.id);
  const organizationId = text(hook.session?.organizationId || hook.user?.organizationId);
  if (actorId !== permit.actorId || organizationId !== permit.organizationId) throw new Error('项目负责人交接上下文不匹配');
  if (event === 'beforeDelete') throw new Error('项目成员关系需停用保留记录，不能删除');

  const context = scopeFor(hook, permit.organizationId);
  const project = await engine.findOne(PROJECT_OBJECT, {
    where: { id: permit.projectId, organization_id: permit.organizationId },
    fields: ['id', 'organization_id', 'owner_id', 'manager_id'],
  }, { context });
  if (!project || text(project.manager_id) !== permit.newManagerId || text(project.organization_id) !== permit.organizationId) {
    throw new Error('项目负责人交接已变化，拒绝修改项目成员关系');
  }

  if (event === 'beforeInsert' && permit.operation === 'insert-new-manager') {
    if (text(input.project_id) !== permit.projectId || text(input.user_id) !== permit.newManagerId
      || text(input.member_duty || 'manager') !== 'manager' || input.active === false
      || text(input.organization_id || permit.organizationId) !== permit.organizationId) {
      throw new Error('项目负责人交接只允许新增当前项目的新负责人关系');
    }
    const target = await activeOrganizationUser(engine, permit.newManagerId, permit.organizationId, context);
    if (input.joined_on != null && !validDate(input.joined_on)) throw new Error('加入日期必须是有效日期');
    input.name = text(target.display_name || target.name || target.username) || '项目成员';
    input.membership_key = permit.projectId + ':' + permit.newManagerId;
    input.organization_id = permit.organizationId;
    input.member_duty = 'manager';
    input.active = true;
    return;
  }

  if (event !== 'beforeUpdate') throw new Error('项目负责人交接没有授权此类项目成员变更');
  if (permit.operation === 'promote-new-manager') {
    const allowed = new Set(['id', 'member_duty', 'active', 'joined_on', 'name']);
    if (text(previous.id) !== permit.newMemberId || text(previous.project_id) !== permit.projectId
      || text(previous.user_id) !== permit.newManagerId || !['member', 'manager'].includes(text(previous.member_duty))
      || Object.keys(input).some(key => !allowed.has(key))
      || input.member_duty !== 'manager' || input.active === false) {
      throw new Error('项目负责人交接只允许升任或重新启用指定新负责人关系');
    }
    if (input.joined_on != null && !validDate(input.joined_on)) throw new Error('加入日期必须是有效日期');
    const target = await activeOrganizationUser(engine, permit.newManagerId, permit.organizationId, context);
    if (input.name != null) input.name = text(target.display_name || target.name || target.username) || '项目成员';
    return;
  }

  if (permit.operation === 'deactivate-old-manager') {
    const allowed = new Set(['id', 'active']);
    if (text(previous.id) !== permit.oldMemberId || text(previous.project_id) !== permit.projectId
      || text(previous.user_id) !== permit.oldManagerId || previous.member_duty !== 'manager'
      || previous.active !== true || Object.keys(input).some(key => !allowed.has(key)) || input.active !== false) {
      throw new Error('项目负责人交接只允许停用指定原负责人关系');
    }
    return;
  }
  throw new Error('项目负责人交接没有授权此类项目成员变更');
}

function validDate(value: unknown): boolean {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function windowIsActive(grant: Row, now: number): boolean {
  const epoch = (value: unknown): number | undefined => {
    if (value == null || value === '') return undefined;
    if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') return Date.parse(value);
    return Number.NaN;
  };
  const from = epoch(grant.valid_from ?? grant.validFrom);
  const until = epoch(grant.valid_until ?? grant.validUntil);
  return !(from !== undefined && !(now >= from)) && !(until !== undefined && !(now < until));
}

async function identity(
  engine: IObjectQLEngine,
  hook: HookContext,
  targetUserId: string | undefined,
  resolvePermissions: PermissionResolver = defaultPermissionResolver,
): Promise<{
  actorId: string;
  organizationId: string;
  project: Row;
  target?: Row;
}> {
  const actorId = text(hook.session?.userId || hook.user?.id);
  const organizationId = text(hook.session?.organizationId || hook.user?.organizationId);
  if (!actorId || !organizationId) throw new Error('无法确认当前项目团队维护人和组织');
  const input = hookInputData(hook);
  const previous = row(hook.previous);
  const projectId = text(input.project_id || previous.project_id);
  if (!projectId) throw new Error('项目成员缺少所属项目');
  const context = scopeFor(hook, organizationId);
  const project = await engine.findOne(PROJECT_OBJECT, {
    where: { id: projectId, organization_id: organizationId },
    fields: ['id', 'owner_id', 'manager_id', 'organization_id'],
  }, { context });
  if (!project || text(project.organization_id) !== organizationId) throw new Error('项目不存在或不属于当前组织');
  if (text(project.owner_id) !== actorId && text(project.manager_id) !== actorId) {
    throw new Error('仅项目所有者或当前项目经理可以维护团队');
  }

  const reader = readInContext(engine, context, hook.transaction);
  const effective = row(await resolvePermissions(reader, actorId, Date.now(), organizationId));
  const systemPermissions = new Set(Array.isArray(effective.systemPermissions) ? effective.systemPermissions.map(text) : []);
  if (!systemPermissions.has(OPERATOR_PERMISSION)) throw new Error('当前账号没有项目团队维护权限');

  if (!targetUserId) return { actorId, organizationId, project };
  const now = Date.now();
  const [user, membership] = await Promise.all([
    engine.findOne('sys_user', { where: { id: targetUserId } }, { context }),
    engine.findOne('sys_member', { where: { user_id: targetUserId, organization_id: organizationId } }, { context }),
  ]);
  if (!user || !isRowActive(user) || user.banned === true || !membership || !isRowActive(membership) || !isGrantActive(membership, now) || !windowIsActive(membership, now)) {
    throw new Error('项目成员必须是当前组织内有效账号');
  }
  return { actorId, organizationId, project, target: user };
}

/** Shared guard for normal CRUD writes; the Actions apply the same rules with CAS and transactions. */
export async function assertProjectMemberMutation(
  engine: IObjectQLEngine,
  hook: HookContext,
  event: 'beforeInsert' | 'beforeUpdate' | 'beforeDelete',
  resolvePermissions: PermissionResolver = defaultPermissionResolver,
): Promise<void> {
  const permit = handoffPermit(hook);
  if (permit) return assertManagerHandoffMemberMutation(engine, hook, event, permit);

  const input = hookInputData(hook);
  const previous = row(hook.previous);
  const targetUserId = text(input.user_id || previous.user_id);
  const validateTarget = event === 'beforeInsert'
    || event === 'beforeUpdate' && input.active === true && previous.active !== true;
  const { organizationId, project, target } = await identity(engine, hook, validateTarget ? targetUserId : undefined, resolvePermissions);
  const projectId = text(project.id);
  const membershipKey = projectId + ':' + targetUserId;
  const duty = text(input.member_duty || previous.member_duty || 'member');
  const isCurrentManager = targetUserId === text(project.manager_id);

  if (event === 'beforeDelete') throw new Error('项目成员关系需停用保留记录，不能删除');
  if (event === 'beforeInsert') {
    if (!target || !targetUserId) throw new Error('项目成员必须是当前组织内有效账号');
    if (isCurrentManager) {
      if (duty !== 'manager') throw new Error('项目负责人不能作为普通成员重复加入');
    } else if (duty !== 'member') {
      throw new Error('普通项目成员不能被设置为项目经理');
    }
    if (input.active === false) throw new Error('新增项目成员必须是有效关系');
    if (!validDate(input.joined_on)) throw new Error('加入日期必须是有效日期');
    input.name = text(target.display_name || target.name || target.username) || '项目成员';
    input.membership_key = membershipKey;
    input.organization_id = organizationId;
    input.member_duty = duty;
    input.active = true;
    return;
  }

  const priorProjectId = text(previous.project_id);
  const priorUserId = text(previous.user_id);
  if (!priorProjectId || priorProjectId !== projectId || !priorUserId) throw new Error('项目成员关系不可转移到其他项目或账号');
  if ((input.project_id != null && text(input.project_id) !== priorProjectId)
    || (input.user_id != null && text(input.user_id) !== priorUserId)
    || (input.membership_key != null && text(input.membership_key) !== membershipKey)
    || (input.organization_id != null && text(input.organization_id) !== organizationId)) {
    throw new Error('项目成员所属项目、账号和关系标识不可修改');
  }
  if (input.member_duty != null && text(input.member_duty) !== text(previous.member_duty)) {
    throw new Error('项目成员角色不可直接变更');
  }
  if (isCurrentManager || previous.member_duty === 'manager') {
    if (input.active === false) throw new Error('不能移除当前项目负责人');
  } else if (text(previous.member_duty) !== 'member') {
    throw new Error('当前项目成员角色不可维护');
  }
  if (input.active != null && typeof input.active !== 'boolean') throw new Error('成员状态无效');
  if (input.joined_on != null && !validDate(input.joined_on)) throw new Error('加入日期必须是有效日期');
  if (input.active === true && previous.active !== true) {
    if (!target || !isRowActive(target) || target.banned === true) throw new Error('项目成员必须是当前组织内有效账号');
  }
  if (input.name != null) input.name = text(previous.name) || (target ? text(target.display_name || target.name || target.username) : '项目成员');
  if (input.membership_key != null) input.membership_key = membershipKey;
  if (input.organization_id != null) input.organization_id = organizationId;
}

export class ProjectMemberMaintenancePlugin implements Plugin {
  name = PACKAGE_ID;
  version = '1.0.0';
  type = 'standard' as const;

  constructor(private readonly resolvePermissions: PermissionResolver = defaultPermissionResolver) {}

  init(): void {}

  start(ctx: PluginContext): void {
    ctx.hook('kernel:ready', () => {
      const engine = ctx.getService<IObjectQLEngine>('objectql');
      const bind = (event: 'beforeInsert' | 'beforeUpdate' | 'beforeDelete') => {
        engine.registerHook(event, hook => assertProjectMemberMutation(engine, hook, event, this.resolvePermissions), {
          object: MEMBER_OBJECT,
          priority: 110,
          packageId: PACKAGE_ID,
        });
      };
      bind('beforeInsert');
      bind('beforeUpdate');
      bind('beforeDelete');
      engine.registerHook('beforeInsert', hook => stampProjectManagerSnapshot(engine, hook), {
        object: PROJECT_OBJECT,
        priority: 100,
        packageId: PACKAGE_ID,
      });
      engine.registerHook('beforeUpdate', hook => validateProjectManagerChange(engine, hook, this.resolvePermissions), {
        object: PROJECT_OBJECT,
        priority: 100,
        packageId: PACKAGE_ID,
      });
      engine.registerHook('afterUpdate', hook => synchronizeProjectManagerMembership(engine, hook, this.resolvePermissions), {
        object: PROJECT_OBJECT,
        priority: 100,
        packageId: PACKAGE_ID,
      });
    });
  }
}
