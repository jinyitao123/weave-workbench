import type { Plugin, PluginContext } from '@objectstack/core';
import type { IObjectQLEngine, ISharingService } from '@objectstack/spec/contracts';
import type { HookContext } from '@objectstack/spec/data';
import { businessContext } from './business-transaction.js';
import { businessRow, EmployeeNativeActions } from './employee-business-native.js';
import { currentNativeActor } from './native-task-auth.js';
import { approvedProjectOrder } from './project-order-readiness.js';
import { PROJECT_CREATE_TARGET, PROJECT_LINK_TARGET, PROJECT_START_TARGET, PROJECT_READ_TARGET, readProjectDeliveryScope, createCustomerProject, linkProjectOrder, startProject } from './project-order-domain.js';
import { synchronizeProjectOrderShares } from './project-order-sharing.js';

export class ProjectOrderBusinessPlugin implements Plugin {
  name = 'com.inoforge.forge.project-order-business'; version = '1.0.0'; type = 'standard' as const;
  dependencies = ['com.objectstack.service.sharing'];
  init(): void {}
  start(context: PluginContext): void {
    context.hook('kernel:ready', () => {
      const engine = context.getService<IObjectQLEngine>('objectql'), sharing = context.getService<ISharingService>('sharing');
      engine.registerAction('forge_customer', PROJECT_CREATE_TARGET, action => createCustomerProject(context, engine, action), this.name);
      engine.registerAction('forge_project', PROJECT_LINK_TARGET, action => linkProjectOrder(context, engine, sharing, action,
        (projectId, transaction) => synchronizeProjectOrderShares(engine, sharing, transaction, projectId)), this.name);
      engine.registerAction('forge_project', PROJECT_START_TARGET, action => startProject(context, engine, action), this.name);
      engine.registerAction('forge_project', PROJECT_READ_TARGET, async action => (await readProjectDeliveryScope(context, engine, action)).scope, this.name);
      const scope = (hook: HookContext) => ({ ...businessContext(String(hook.session?.userId || hook.user?.id || ''),
        String(hook.session?.organizationId || hook.user?.organizationId || businessRow(hook.previous)?.organization_id || '')),
        ...(hook.transaction !== undefined ? { transaction: hook.transaction } : {}) });
      const synchronize = async (hook: HookContext) => {
        const input = businessRow(hook.input) ?? {}, patch = businessRow(input.data) ?? input, previous = businessRow(hook.previous) ?? {}, result = businessRow(hook.result) ?? {};
        const projectId = String(patch.project_id || previous.project_id || result.project_id || patch.id || previous.id || result.id || '');
        await synchronizeProjectOrderShares(engine, sharing, scope(hook), projectId);
      };
      for (const object of ['forge_project_member', 'forge_project_sales_link']) {
        for (const event of ['afterInsert', 'afterUpdate', 'afterDelete']) engine.registerHook(event, synchronize, { object, priority: 175, packageId: this.name });
      }
      engine.registerHook('afterUpdate', async hook => {
        const input = businessRow(hook.input) ?? {}, patch = businessRow(input.data) ?? input;
        if (['manager_id', 'manager_transfer_target_id', 'source_order_id', 'source_order_version', 'status'].some(field => field in patch)) await synchronize(hook);
      }, { object: 'forge_project', priority: 175, packageId: this.name });
      // A record-level sharing projection is never permission to attach an
      // unreadable source via ordinary CRUD. Retain the same native admission.
      for (const event of ['beforeInsert', 'beforeUpdate']) engine.registerHook(event, async hook => {
        const input = businessRow(hook.input) ?? {}, patch = businessRow(input.data) ?? input, record = { ...businessRow(hook.previous), ...patch };
        const transaction = scope(hook), actor = await currentNativeActor(context, String(transaction.userId), String(transaction.tenantId));
        const native = new EmployeeNativeActions(context, { ...actor, ...(hook.transaction !== undefined ? { transaction: hook.transaction } : {}) });
        const project = businessRow(await native.bridge.get('forge_project', String(record.project_id)));
        if (!project || project.owner_id !== actor.userId && project.manager_id !== actor.userId || project.status !== 'pending') throw new Error('FORBIDDEN: 项目来源只能由待执行项目当前经办人准确关联');
        for (const [object, id] of [['forge_customer', project.customer_id], ['forge_sales_contract', record.contract_id], ['forge_sales_order', record.order_id]])
          if (businessRow(await native.bridge.get(String(object), String(id)))?.id !== id) throw new Error('FORBIDDEN: 项目来源尚无原生读取授权');
        const source = await approvedProjectOrder(engine, String(project.customer_id), String(record.order_id), transaction);
        if (source.contract.id !== record.contract_id || project.source_order_id && project.source_order_id !== source.order.id) throw new Error('项目来源与本次立项不一致');
      }, { object: 'forge_project_sales_link', priority: 115, packageId: this.name });
    });
  }
}
