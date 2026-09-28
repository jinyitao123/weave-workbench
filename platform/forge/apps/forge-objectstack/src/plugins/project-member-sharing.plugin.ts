import type { Plugin, PluginContext } from '@objectstack/core';
import type { IObjectQLEngine, ISharingService, RecordShare } from '@objectstack/spec/contracts';
import type { HookContext } from '@objectstack/spec/data';
import type { ExecutionContext as KernelExecutionContext } from '@objectstack/spec/kernel';

const PACKAGE_ID = 'com.inoforge.forge.project-member-sharing';
const PROJECT_OBJECT = 'forge_project';
const MEMBER_OBJECT = 'forge_project_member';
const EVIDENCE_OBJECTS = ['forge_project_attachment', 'forge_project_log'] as const;
const PAGE_SIZE = 200;

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function systemContext(hook: HookContext, tenantFallback?: string): KernelExecutionContext {
  const userId = text(hook.session?.userId || hook.user?.id);
  const tenantId = text(hook.session?.organizationId || hook.user?.organizationId || tenantFallback);
  return {
    isSystem: true,
    ...(userId ? { userId } : {}),
    ...(text(hook.session?.actor) ? { actor: text(hook.session?.actor) } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(hook.transaction !== undefined ? { transaction: hook.transaction } : {}),
    ...(hook.id ? { traceId: hook.id } : {}),
  } as KernelExecutionContext;
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

function shareMatchesMembership(share: RecordShare, member: Row): boolean {
  return share.source === 'team'
    && text(share.source_id) === text(member.id)
    && text(share.recipient_id) === text(member.user_id);
}

export class ProjectMemberSharingPlugin implements Plugin {
  name = PACKAGE_ID;
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.service.sharing'];

  init(): void {}

  start(ctx: PluginContext): void {
    // SharingServicePlugin publishes its service at kernel:ready, after all
    // plugins have started. Bind only once the native provider is available.
    ctx.hook('kernel:ready', () => {
      const engine = ctx.getService<IObjectQLEngine>('objectql');
      const sharing = ctx.getService<ISharingService>('sharing');
      const bind = (event: string, object: string, handler: (hook: HookContext) => Promise<void>) => {
        engine.registerHook(event, handler, { object, priority: 150, packageId: PACKAGE_ID });
      };

      bind('afterInsert', MEMBER_OBJECT, hook => this.onMemberInsert(engine, sharing, hook));
      bind('afterUpdate', MEMBER_OBJECT, hook => this.onMemberUpdate(engine, sharing, hook));
      bind('afterDelete', MEMBER_OBJECT, hook => this.onMemberDelete(engine, sharing, hook));
      for (const object of EVIDENCE_OBJECTS) {
        bind('afterInsert', object, hook => this.onEvidenceInsert(engine, sharing, hook, object));
      }
    });
  }

  private async onMemberInsert(engine: IObjectQLEngine, sharing: ISharingService, hook: HookContext): Promise<void> {
    const member = await this.readMember(engine, hook, nextRecord(hook));
    if (member.active === true) await this.grantMembership(engine, sharing, hook, member);
  }

  private async onMemberUpdate(engine: IObjectQLEngine, sharing: ISharingService, hook: HookContext): Promise<void> {
    const previous = asRow(hook.previous);
    const next = await this.readMember(engine, hook, nextRecord(hook));
    if (!text(previous.id) || !text(next.id)) throw new Error('项目成员变更缺少记录标识，无法同步项目分享');
    const sameAssignment = text(previous.project_id) === text(next.project_id)
      && text(previous.user_id) === text(next.user_id);
    if (previous.active === true && (next.active !== true || !sameAssignment)) {
      await this.revokeMembership(engine, sharing, hook, previous);
    }
    if (next.active === true && (previous.active !== true || !sameAssignment)) {
      await this.grantMembership(engine, sharing, hook, next);
    }
  }

  private async onMemberDelete(engine: IObjectQLEngine, sharing: ISharingService, hook: HookContext): Promise<void> {
    const previous = asRow(hook.previous);
    if (previous.active === true) await this.revokeMembership(engine, sharing, hook, previous);
  }

  private async readMember(engine: IObjectQLEngine, hook: HookContext, candidate: Row): Promise<Row> {
    const id = text(candidate.id || asRow(hook.input).id);
    if (!id) throw new Error('项目成员变更缺少记录标识，无法读取有效任职状态');
    const persisted = await engine.findOne(MEMBER_OBJECT, {
      where: { id },
      fields: ['id', 'project_id', 'user_id', 'active', 'organization_id'],
    }, { context: systemContext(hook) });
    if (!persisted) throw new Error('项目成员写入后无法读取有效状态，拒绝同步项目分享');
    return { ...candidate, ...persisted };
  }

  private async onEvidenceInsert(
    engine: IObjectQLEngine,
    sharing: ISharingService,
    hook: HookContext,
    evidenceObject: typeof EVIDENCE_OBJECTS[number],
  ): Promise<void> {
    const evidence = nextRecord(hook);
    const evidenceId = text(evidence.id);
    const projectId = text(evidence.project_id);
    if (!evidenceId || !projectId) throw new Error(`${evidenceObject} 缺少项目或记录标识，无法同步项目分享`);
    const scope = await this.projectScope(engine, hook, projectId);
    this.assertOrganization(evidence, scope.organizationId, evidenceObject);
    const members = await this.findAll(engine, MEMBER_OBJECT, {
      project_id: projectId,
      active: true,
    }, scope.context, ['id', 'project_id', 'user_id', 'active', 'organization_id']);
    for (const member of members) {
      if (member.active !== true || !text(member.id) || !text(member.user_id)) continue;
      this.assertOrganization(member, scope.organizationId, MEMBER_OBJECT);
      await this.grant(sharing, evidenceObject, evidenceId, member, scope.context);
      await this.grant(sharing, PROJECT_OBJECT, projectId, member, scope.context);
    }
  }

  private async grantMembership(
    engine: IObjectQLEngine,
    sharing: ISharingService,
    hook: HookContext,
    member: Row,
  ): Promise<void> {
    const projectId = text(member.project_id);
    if (!text(member.id) || !text(member.user_id) || !projectId) {
      throw new Error('有效项目成员缺少用户、项目或关系标识，无法授予项目分享');
    }
    const scope = await this.projectScope(engine, hook, projectId);
    this.assertOrganization(member, scope.organizationId, MEMBER_OBJECT);
    await this.grant(sharing, PROJECT_OBJECT, projectId, member, scope.context);
    for (const evidenceObject of EVIDENCE_OBJECTS) {
      const rows = await this.findAll(engine, evidenceObject, { project_id: projectId }, scope.context, ['id', 'project_id', 'organization_id']);
      for (const evidence of rows) {
        const evidenceId = text(evidence.id);
        if (!evidenceId) continue;
        this.assertOrganization(evidence, scope.organizationId, evidenceObject);
        await this.grant(sharing, evidenceObject, evidenceId, member, scope.context);
      }
    }
  }

  private async revokeMembership(
    engine: IObjectQLEngine,
    sharing: ISharingService,
    hook: HookContext,
    member: Row,
  ): Promise<void> {
    const projectId = text(member.project_id);
    if (!text(member.id) || !text(member.user_id) || !projectId) {
      throw new Error('被停用或移除的项目成员缺少用户、项目或关系标识，无法撤销项目分享');
    }
    const scope = await this.projectScope(engine, hook, projectId);
    this.assertOrganization(member, scope.organizationId, MEMBER_OBJECT);
    await this.revokeRecordShare(sharing, PROJECT_OBJECT, projectId, member, scope.context);
    for (const evidenceObject of EVIDENCE_OBJECTS) {
      const rows = await this.findAll(engine, evidenceObject, { project_id: projectId }, scope.context, ['id', 'project_id', 'organization_id']);
      for (const evidence of rows) {
        const evidenceId = text(evidence.id);
        if (!evidenceId) continue;
        this.assertOrganization(evidence, scope.organizationId, evidenceObject);
        await this.revokeRecordShare(sharing, evidenceObject, evidenceId, member, scope.context);
      }
    }
  }

  private async projectScope(
    engine: IObjectQLEngine,
    hook: HookContext,
    projectId: string,
  ): Promise<{ organizationId: string; context: KernelExecutionContext }> {
    const triggerContext = systemContext(hook);
    const project = await engine.findOne(PROJECT_OBJECT, {
      where: { id: projectId },
      fields: ['id', 'organization_id'],
    }, { context: triggerContext });
    if (!project || !text(project.organization_id)) throw new Error('项目不存在或缺少组织归属，无法同步项目分享');
    const organizationId = text(project.organization_id);
    if (triggerContext.tenantId && triggerContext.tenantId !== organizationId) {
      throw new Error('当前组织与项目组织不匹配，拒绝同步项目分享');
    }
    return {
      organizationId,
      context: triggerContext.tenantId ? triggerContext : { ...triggerContext, tenantId: organizationId },
    };
  }

  private assertOrganization(row: Row, organizationId: string, object: string): void {
    const rowOrganizationId = text(row.organization_id);
    if (rowOrganizationId && rowOrganizationId !== organizationId) {
      throw new Error(`${object} 与项目不属于同一组织，拒绝同步项目分享`);
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

  private async grant(
    sharing: ISharingService,
    object: string,
    recordId: string,
    member: Row,
    context: KernelExecutionContext,
  ): Promise<void> {
    await sharing.grant({
      object,
      recordId,
      recipientType: 'user',
      recipientId: text(member.user_id),
      accessLevel: 'read',
      source: 'team',
      sourceId: text(member.id),
      reason: '项目有效成员读取权限',
    }, context);
  }

  private async revokeRecordShare(
    sharing: ISharingService,
    object: string,
    recordId: string,
    member: Row,
    context: KernelExecutionContext,
  ): Promise<void> {
    const shares = await sharing.listShares(object, recordId, context);
    for (const share of shares) {
      if (!shareMatchesMembership(share, member)) continue;
      await sharing.revoke(share.id, context, { object, recordId });
    }
  }
}
