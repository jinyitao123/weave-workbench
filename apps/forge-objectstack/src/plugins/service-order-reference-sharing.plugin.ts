import type { Plugin, PluginContext } from '@objectstack/core';
import type { IObjectQLEngine, ISharingService, RecordShare } from '@objectstack/spec/contracts';
import type { HookContext } from '@objectstack/spec/data';
import type { ExecutionContext as KernelExecutionContext } from '@objectstack/spec/kernel';
import { sharingInTransaction } from './native-sharing-transaction.js';

const PACKAGE_ID = 'com.inoforge.forge.service-order-reference-sharing';
const SERVICE_ORDER = 'forge_service_order';
const SERVICE_POSITION = 'after_sales_operator';
const SHARE_SOURCE = 'team';
const SHARE_SOURCE_ID = 'forge_service_order_assignment';
const PAGE_SIZE = 200;
const ACTIVE_ASSIGNMENT_STATUSES = new Set(['pending_receive', 'in_progress', 'completed']);
const REFERENCE_FIELDS = [
  { object: 'forge_customer', field: 'customer_id' },
  { object: 'forge_contact', field: 'contact_id' },
  { object: 'forge_sales_order', field: 'sales_order_id' },
  { object: 'forge_sales_contract', field: 'contract_id' },
] as const;

type Row = Record<string, unknown>;
type ReferenceObjectName = typeof REFERENCE_FIELDS[number]['object'];
type ReferenceShare = { object: ReferenceObjectName; recordId: string; recipientId: string };

function asRow(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function systemContext(hook?: HookContext, tenantFallback?: string): KernelExecutionContext {
  const userId = text(hook?.session?.userId || hook?.user?.id);
  const tenantId = text(hook?.session?.organizationId || hook?.user?.organizationId || tenantFallback);
  return {
    isSystem: true,
    ...(userId ? { userId } : {}),
    ...(text(hook?.session?.actor) ? { actor: text(hook?.session?.actor) } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(hook?.transaction !== undefined ? { transaction: hook.transaction } : {}),
    ...(hook?.id ? { traceId: hook.id } : {}),
  } as KernelExecutionContext;
}

function tenantSystemContext(hook: HookContext | undefined, organizationId: string): KernelExecutionContext {
  return { ...systemContext(hook, organizationId), tenantId: organizationId } as KernelExecutionContext;
}

function nextRecord(hook: HookContext): Row {
  const input = asRow(hook.input);
  return {
    ...asRow(hook.previous),
    ...asRow(input.data),
    ...asRow(hook.result),
    ...(input.id != null ? { id: input.id } : {}),
  };
}

function effectiveNow(assignment: Row, now = Date.now()): boolean {
  const from = assignment.valid_from ? Date.parse(String(assignment.valid_from)) : Number.NEGATIVE_INFINITY;
  const until = assignment.valid_until ? Date.parse(String(assignment.valid_until)) : Number.POSITIVE_INFINITY;
  return !Number.isNaN(from) && !Number.isNaN(until) && from <= now && now < until;
}

function pairKey(reference: { object: string; recordId: string; recipientId: string }): string {
  return `${reference.object}\u0000${reference.recordId}\u0000${reference.recipientId}`;
}

function grantKey(share: Row): string {
  return pairKey({
    object: text(share.object_name),
    recordId: text(share.record_id),
    recipientId: text(share.recipient_id),
  });
}

export class ServiceOrderReferenceSharingPlugin implements Plugin {
  name = PACKAGE_ID;
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.service.sharing'];

  init(): void {}

  start(ctx: PluginContext): void {
    // SharingServicePlugin publishes its native service at kernel:ready.
    ctx.hook('kernel:ready', () => {
      const engine = ctx.getService<IObjectQLEngine>('objectql');
      const sharing = ctx.getService<ISharingService>('sharing');
      const bind = (event: string, object: string, handler: (hook: HookContext) => Promise<void>) => {
        engine.registerHook(event, handler, { object, priority: 150, packageId: PACKAGE_ID });
      };
      bind('afterInsert', SERVICE_ORDER, hook => this.onServiceOrderChange(engine, sharing, hook, 'insert'));
      bind('afterUpdate', SERVICE_ORDER, hook => this.onServiceOrderChange(engine, sharing, hook, 'update'));
      bind('afterDelete', SERVICE_ORDER, hook => this.onServiceOrderChange(engine, sharing, hook, 'delete'));
      bind('afterInsert', 'sys_organization', async hook => {
        const organizationId = text(nextRecord(hook).id);
        if (organizationId) await this.reconcileOrganizations(engine, sharing, [organizationId]);
      });
      for (const object of ['sys_user_position', 'sys_position', 'sys_member', 'sys_user']) {
        bind('afterInsert', object, hook => this.onIdentityChange(engine, sharing, hook, object));
        bind('afterUpdate', object, hook => this.onIdentityChange(engine, sharing, hook, object));
        bind('afterDelete', object, hook => this.onIdentityChange(engine, sharing, hook, object));
      }
      for (const event of ['afterInsert', 'afterUpdate', 'afterDelete']) {
        bind(event, 'sys_record_share', hook => this.onExternalShareChange(engine, sharing, hook));
      }
    });

    // Covers records that already existed before this plugin installed its hooks.
    ctx.hook('kernel:bootstrapped', async () => {
      const engine = ctx.getService<IObjectQLEngine>('objectql');
      const sharing = ctx.getService<ISharingService>('sharing');
      await this.reconcileAll(engine, sharing);
    });
  }

  private async onServiceOrderChange(
    engine: IObjectQLEngine,
    sharing: ISharingService,
    hook: HookContext,
    event: 'insert' | 'update' | 'delete',
  ): Promise<void> {
    const previous = asRow(hook.previous);
    const candidate = event === 'delete' ? previous : nextRecord(hook);
    if (event === 'update' && !this.assignmentChanged(previous, candidate)) return;
    const current = event === 'delete'
      ? null
      : await this.readServiceOrder(engine, hook, candidate);
    const affected = new Map<string, { userId: string; organizationId: string }>();
    for (const row of [previous, current].filter(Boolean) as Row[]) {
      const userId = text(row.engineer_id);
      const organizationId = text(row.organization_id);
      if (!userId || !organizationId) continue;
      affected.set(`${organizationId}\u0000${userId}`, { userId, organizationId });
    }
    for (const identity of affected.values()) {
      await this.reconcilePerson(engine, sharing, systemContext(hook, identity.organizationId), identity.userId, identity.organizationId);
    }
  }

  private assignmentChanged(previous: Row, next: Row): boolean {
    if (!text(previous.id)) return true;
    return previous.engineer_id !== next.engineer_id
      || previous.status !== next.status
      || REFERENCE_FIELDS.some(({ field }) => previous[field] !== next[field]);
  }

  private async readServiceOrder(engine: IObjectQLEngine, hook: HookContext, candidate: Row): Promise<Row | null> {
    const id = text(candidate.id || asRow(hook.input).id);
    if (!id) throw new Error('服务工单变更缺少记录标识，无法同步关联记录权限');
    const row = await engine.findOne(SERVICE_ORDER, {
      where: { id },
      fields: ['id', 'organization_id', 'engineer_id', 'status', ...REFERENCE_FIELDS.map(({ field }) => field)],
    }, { context: systemContext(hook) });
    if (!row) throw new Error('服务工单写入后无法读取有效状态，拒绝同步关联记录权限');
    return row as Row;
  }

  private async onIdentityChange(
    engine: IObjectQLEngine,
    sharing: ISharingService,
    hook: HookContext,
    object: string,
  ): Promise<void> {
    const previous = asRow(hook.previous);
    const next = hook.event === 'afterDelete' ? {} : nextRecord(hook);
    const userIds = new Set<string>();
    const organizationIds = new Set<string>();
    for (const row of [previous, next]) {
      const organizationId = text(row.organization_id);
      if (organizationId) organizationIds.add(organizationId);
      if (object === 'sys_user') {
        const userId = text(row.id || row.user_id);
        if (userId) userIds.add(userId);
      } else {
        const userId = text(row.user_id);
        if (userId) userIds.add(userId);
      }
    }

    if (object === 'sys_position') {
      const tokens = new Set<string>();
      for (const row of [previous, next]) {
        const name = text(row.name);
        if (name === SERVICE_POSITION) tokens.add(name);
        if (name === SERVICE_POSITION && text(row.id)) tokens.add(text(row.id));
      }
      if (!tokens.size) return;
      for (const organizationId of organizationIds) {
        const context = systemContext(hook, organizationId);
        for (const token of tokens) {
          const assignments = await this.findAll(engine, 'sys_user_position', {
            organization_id: organizationId,
            position: token,
          }, context, ['user_id']);
          for (const row of assignments) if (text(row.user_id)) userIds.add(text(row.user_id));
        }
      }
    }

    if (object === 'sys_user') {
      const knownOrganizations = await this.listOrganizationIds(engine);
      for (const organizationId of knownOrganizations) {
        const context = tenantSystemContext(hook, organizationId);
        for (const userId of userIds) {
          const orders = await this.findAll(engine, SERVICE_ORDER, {
            organization_id: organizationId,
            engineer_id: userId,
          }, context, ['organization_id']);
          if (orders.length) organizationIds.add(organizationId);
        }
      }
    }

    for (const organizationId of organizationIds) {
      const context = systemContext(hook, organizationId);
      for (const userId of userIds) {
        await this.reconcilePerson(engine, sharing, context, userId, organizationId);
      }
    }
  }

  private async eligibleEngineer(
    engine: IObjectQLEngine,
    context: KernelExecutionContext,
    userId: string,
    organizationId: string,
  ): Promise<boolean> {
    const positions = await this.findAll(engine, 'sys_position', {
      organization_id: organizationId,
      name: SERVICE_POSITION,
    }, context, ['id', 'name', 'active']);
    const activePositions = positions.filter(row => row.active !== false);
    if (!activePositions.length) return false;
    const keys = new Set(activePositions.flatMap(row => [text(row.id), text(row.name)]).filter(Boolean));
    const assignments = await this.findAll(engine, 'sys_user_position', {
      organization_id: organizationId,
      user_id: userId,
    }, context, ['position', 'valid_from', 'valid_until']);
    if (!assignments.some(row => keys.has(text(row.position)) && effectiveNow(row))) return false;
    const [members, users] = await Promise.all([
      this.findAll(engine, 'sys_member', { organization_id: organizationId, user_id: userId }, context, ['role']),
      this.findAll(engine, 'sys_user', { id: userId }, context, ['id', 'banned']),
    ]);
    return members.some(row => row.role === 'member') && users.some(row => row.banned !== true);
  }

  private async reconcilePerson(
    engine: IObjectQLEngine,
    sharing: ISharingService,
    context: KernelExecutionContext,
    userId: string,
    organizationId: string,
  ): Promise<void> {
    if (context.tenantId && context.tenantId !== organizationId) {
      throw new Error('服务工单组织与分享租户上下文不匹配，拒绝同步关联记录权限');
    }
    sharing = sharingInTransaction(engine, sharing, context);
    const assignedOrders = await this.findAll(engine, SERVICE_ORDER, {
      organization_id: organizationId,
      engineer_id: userId,
    }, context, ['id', 'organization_id', 'engineer_id', 'status', ...REFERENCE_FIELDS.map(({ field }) => field)]);
    const eligible = await this.eligibleEngineer(engine, context, userId, organizationId);
    const desired = new Map<string, ReferenceShare>();
    if (eligible) {
      for (const order of assignedOrders) {
        if (!ACTIVE_ASSIGNMENT_STATUSES.has(text(order.status))) continue;
        if (text(order.organization_id) !== organizationId || text(order.engineer_id) !== userId) continue;
        for (const { object, field } of REFERENCE_FIELDS) {
          const recordId = text(order[field]);
          if (!recordId) continue;
          const reference = { object, recordId, recipientId: userId };
          desired.set(pairKey(reference), reference);
        }
      }
    }

    const existing = await this.findAll(engine, 'sys_record_share', {
      organization_id: organizationId,
      recipient_type: 'user',
      recipient_id: userId,
      source: SHARE_SOURCE,
      source_id: SHARE_SOURCE_ID,
    }, context, ['id', 'object_name', 'record_id', 'recipient_id', 'source', 'source_id']);
    const referenceObjects = new Set<string>(REFERENCE_FIELDS.map(({ object }) => object));
    const current = existing.filter(row => referenceObjects.has(text(row.object_name)));
    const currentKeys = new Set(current.map(grantKey));

    for (const reference of desired.values()) {
      if (currentKeys.has(pairKey(reference))) continue;
      const attached = await sharing.listShares(reference.object, reference.recordId, context);
      const competingTeamShare = attached.some(share =>
        share.recipient_type === 'user'
        && text(share.recipient_id) === userId
        && share.source === SHARE_SOURCE
        && text(share.source_id) !== SHARE_SOURCE_ID);
      if (competingTeamShare) continue;
      await sharing.grant({
        object: reference.object,
        recordId: reference.recordId,
        recipientType: 'user',
        recipientId: userId,
        accessLevel: 'read',
        source: SHARE_SOURCE,
        sourceId: SHARE_SOURCE_ID,
        reason: '读取指派服务工单关联记录',
      }, context);
    }

    const desiredKeys = new Set(desired.keys());
    for (const row of current) {
      const key = grantKey(row);
      if (desiredKeys.has(key)) continue;
      const object = text(row.object_name);
      const recordId = text(row.record_id);
      const shareId = text(row.id);
      if (!object || !recordId || !shareId) throw new Error('服务关联分享记录不完整，拒绝撤销范围不明的权限');
      await sharing.revoke(shareId, context, { object, recordId });
    }
  }

  private async onExternalShareChange(engine: IObjectQLEngine, sharing: ISharingService, hook: HookContext): Promise<void> {
    const previous = asRow(hook.previous);
    const next = hook.event === 'afterDelete' ? {} : nextRecord(hook);
    const referenceObjects = new Set<string>(REFERENCE_FIELDS.map(({ object }) => object));
    const people = new Map<string, { userId: string; organizationId: string }>();
    for (const row of [previous, next]) {
      if (row.source !== SHARE_SOURCE || text(row.source_id) === SHARE_SOURCE_ID) continue;
      if (text(row.recipient_type) !== 'user' || !referenceObjects.has(text(row.object_name))) continue;
      const userId = text(row.recipient_id);
      const organizationId = text(row.organization_id);
      if (userId && organizationId) people.set(`${organizationId}\u0000${userId}`, { userId, organizationId });
    }
    for (const { userId, organizationId } of people.values()) {
      await this.reconcilePerson(engine, sharing, systemContext(hook, organizationId), userId, organizationId);
    }
  }

  private async listOrganizationIds(engine: IObjectQLEngine): Promise<string[]> {
    // Mirrors the native SharingService seed pass: enumerate only the platform organization directory under system context.
    const rows = await this.findAll(engine, 'sys_organization', {}, systemContext(), ['id']);
    const organizationIds = [...new Set(rows.map(row => text(row.id)).filter(Boolean))];
    // A fresh single-tenant runtime has no organization until the first human
    // account becomes platform admin; keep registration reachable during bootstrap.
    return organizationIds;
  }

  private async reconcileAll(engine: IObjectQLEngine, sharing: ISharingService): Promise<void> {
    await this.reconcileOrganizations(engine, sharing, await this.listOrganizationIds(engine));
  }

  private async reconcileOrganizations(engine: IObjectQLEngine, sharing: ISharingService, organizationIds: string[]): Promise<void> {
    for (const organizationId of organizationIds) {
      const context = systemContext(undefined, organizationId);
      const assigned = await this.findAll(engine, SERVICE_ORDER, { organization_id: organizationId }, context, ['engineer_id']);
      const existing = await this.findAll(engine, 'sys_record_share', {
        organization_id: organizationId,
        source: SHARE_SOURCE,
        source_id: SHARE_SOURCE_ID,
      }, context, ['recipient_id']);
      const people = new Set([...assigned.map(row => text(row.engineer_id)), ...existing.map(row => text(row.recipient_id))].filter(Boolean));
      for (const userId of people) await this.reconcilePerson(engine, sharing, context, userId, organizationId);
    }
  }

  private async findAll(
    engine: IObjectQLEngine,
    object: string,
    where: Record<string, unknown>,
    context: KernelExecutionContext,
    fields: string[],
  ): Promise<Row[]> {
    const rows: Row[] = [];
    let offset = 0;
    while (true) {
      const page = await engine.find(object, { where, fields, limit: PAGE_SIZE, offset }, { context });
      const current = Array.isArray(page) ? page as Row[] : [];
      rows.push(...current);
      if (current.length < PAGE_SIZE) return rows;
      offset += current.length;
    }
  }
}
