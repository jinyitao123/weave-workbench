import type { Plugin, PluginContext } from '@objectstack/core';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import type { ActionHandlerContext } from '@objectstack/spec/ui';
import { SalesCustomerCanMaintain } from '../actions/sales-customer-maintenance.action.js';
import { SalesContactCanMaintain } from '../actions/sales-contact-lifecycle.action.js';
import { businessRow, EmployeeNativeActions, type BusinessRow } from './employee-business-native.js';
import { currentNativeActor, nonempty, TaskConnectionFailure } from './native-task-auth.js';

type Handler = ActionHandlerContext & { recordLoadDenied?: boolean };
const referenceId = (value: unknown) => nonempty(value) ?? nonempty(businessRow(value)?.id) ?? nonempty(businessRow(value)?.value);

async function maintainability(context: PluginContext, action: Handler, object: 'forge_customer' | 'forge_contact') {
  const userId = nonempty(action.user?.id), organizationId = nonempty(action.session?.organizationId);
  const recordId = nonempty(action.record?.id);
  if (action.recordLoadDenied === true || !userId || action.session?.userId !== userId || !organizationId || !recordId
    || action.params?.recordId && action.params.recordId !== recordId) {
    throw new TaskConnectionFailure(403, 'CRM_SOURCE_UNREADABLE', '当前员工或业务资料不可确认');
  }
  const actor = await currentNativeActor(context, userId, organizationId);
  if (!actor.systemPermissions?.includes('sales_crm_maintain')) {
    throw new TaskConnectionFailure(403, 'CRM_MAINTENANCE_FORBIDDEN', '当前员工无维护资格查询权限');
  }
  // Metadata Action ctx.api is trusted in SDK 17.5. Reuse the ordinary
  // native bridge instead, including the contact's second-hop customer read.
  const { bridge } = new EmployeeNativeActions(context, actor);
  const owned = (row: BusinessRow | undefined) => Boolean(row
    && referenceId(row.organization_id) === organizationId
    && referenceId(row.owner_id) === userId && referenceId(row.responsible_id) === userId);
  const row = businessRow(await bridge.get(object, recordId));
  if (!row || row.id !== recordId || !owned(row)) return { can_maintain: false };
  if (object === 'forge_customer') return { can_maintain: true };
  const customerId = referenceId(row.customer_id);
  if (!customerId) return { can_maintain: false };
  // Await native reads in order: the SDK's execution context carries the
  // per-object read scope. Missing or FLS-hidden ownership fails closed.
  const customer = businessRow(await bridge.get('forge_customer', customerId));
  return { can_maintain: Boolean(customer?.id === customerId && owned(customer)) };
}

export class SalesCrmMaintenanceReadPlugin implements Plugin {
  name = 'com.inoforge.forge.sales-crm-maintenance-read';
  version = '1.0.0';
  type = 'standard' as const;

  init(): void {}

  start(context: PluginContext): void {
    context.hook('kernel:ready', () => {
      const engine = context.getService<IObjectQLEngine>('objectql');
      engine.registerAction('forge_customer', SalesCustomerCanMaintain.target!, action => maintainability(context, action, 'forge_customer'), this.name);
      engine.registerAction('forge_contact', SalesContactCanMaintain.target!, action => maintainability(context, action, 'forge_contact'), this.name);
    });
  }
}
