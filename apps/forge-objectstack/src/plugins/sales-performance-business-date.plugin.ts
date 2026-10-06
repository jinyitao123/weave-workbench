import type { Plugin, PluginContext } from '@objectstack/core';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { organizationBusinessContext } from './project-business-date.plugin.js';

type ActionContext = {
  user?: { id?: string; organizationId?: string };
  session?: { userId?: string; organizationId?: string };
};

/** Read-only global adapter for the shared full-IANA organization business-date projection. */
export class OrganizationBusinessDateQueryPlugin implements Plugin {
  name = 'com.inoforge.forge.organization-business-date-query';
  version = '1.0.0';
  type = 'standard' as const;
  requiresServices = ['objectql'];

  init(): void {}

  start(context: PluginContext): void {
    const engine = context.getService<IObjectQLEngine>('objectql');
    engine.registerAction('global', 'organization_business_date_query', async (raw: unknown) => {
      const action = raw && typeof raw === 'object' ? raw as ActionContext : {};
      const userId = String(action.user?.id || action.session?.userId || '').trim();
      const organizationId = String(action.user?.organizationId || action.session?.organizationId || '').trim();
      if (!userId || !organizationId) throw new Error('无法确认当前组织，不能读取组织业务日期');
      return organizationBusinessContext(engine, {
        isSystem: true, userId, tenantId: organizationId,
      } as ExecutionContext);
    }, this.name);
  }
}
