import type { Plugin, PluginContext } from '@objectstack/core';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { actionBodyRunnerFactory, QuickJSScriptRunner } from '@objectstack/runtime';
import { SalesPriceDraftSave, SalesPriceSubmit, SalesPriceResolve } from '../actions/sales-pricing.action.js';
import { SalesQuotationPriceResolve } from '../actions/sales-quotation-price.action.js';
import { organizationBusinessDate } from './project-business-date.plugin.js';

const actions = [SalesPriceDraftSave, SalesPriceSubmit, SalesPriceResolve, SalesQuotationPriceResolve];
type ActionContext = { session?: Record<string, unknown>; user?: { id?: string; organizationId?: string }; [key: string]: unknown };

/** Supplies the existing native organization calendar to portable pricing bodies. */
export class SalesPricingBusinessDatePlugin implements Plugin {
  name = 'com.inoforge.forge.sales-pricing-business-date';
  version = '1.0.0';
  type = 'standard' as const;
  requiresServices = ['objectql'];
  private engine?: IObjectQLEngine;
  private runner?: QuickJSScriptRunner;
  init(): void {}

  start(context: PluginContext): void {
    const engine = context.getService<IObjectQLEngine>('objectql');
    this.engine = engine;
    context.hook('kernel:ready', () => {
      if (this.runner) return;
      this.runner = new QuickJSScriptRunner({ actionTimeoutMs: 30_000 });
      const factory = actionBodyRunnerFactory(this.runner, { ql: engine, appId: 'com.inoforge.forge.sales', logger: context.logger });
      for (const action of actions) {
        const body = factory(action);
        if (!body) throw new Error(`价格动作 ${action.name} 缺少可执行源码`);
        engine.registerAction(action.objectName!, action.name, async (raw: unknown) => {
          const ctx = raw as ActionContext;
          const userId = String(ctx.user?.id || ctx.session?.userId || '');
          const tenantId = String(ctx.user?.organizationId || ctx.session?.organizationId || '');
          if (!userId || !tenantId) throw new Error('无法确认组织业务日期的员工身份');
          const businessDate = await organizationBusinessDate(engine, { isSystem: true, userId, tenantId } as ExecutionContext);
          return body({ ...ctx, session: { ...ctx.session, businessDate } });
        }, this.name);
      }
      engine.registerHook('afterUpdate', async hook => {
        if (hook.previous?.status !== 'pending_approval' || hook.result?.status !== 'approved') return;
        const tenantId = String(hook.result?.organization_id || hook.previous?.organization_id || hook.session?.organizationId || hook.user?.organizationId || '');
        const businessDate = await organizationBusinessDate(engine, {
          isSystem: true, tenantId, userId: hook.session?.userId || hook.user?.id,
          ...(hook.transaction !== undefined ? { transaction: hook.transaction } : {}),
        } as ExecutionContext);
        hook.session = { ...hook.session, organizationId:tenantId,businessDate };
      }, { object: 'forge_sales_price_request', priority: 100, packageId: this.name });
    });
  }

  async destroy(): Promise<void> {
    this.engine?.removeActionsByPackage(this.name);
    this.engine?.unregisterHooksByPackage(this.name);
    await this.runner?.dispose();
    this.runner = undefined;
    this.engine = undefined;
  }
}
