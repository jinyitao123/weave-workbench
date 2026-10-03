import type { Plugin, PluginContext } from '@objectstack/core';
import type { IApprovalService, IObjectQLEngine, IStorageService } from '@objectstack/spec/contracts';
import type { HookContext } from '@objectstack/spec/data';
import { businessRow } from './employee-business-native.js';
import { businessContext } from './business-transaction.js';
import { effectivePositionUsers } from './business-position-resolution.js';
import {
  SIGNATURE_TARGET, ORDER_CONDITIONS_TARGET, CONTRACT_ORDER_TARGET, ORDER_SUBMIT_TARGET,
  CONTRACT_PREPAYMENT_TARGET, PREPAYMENT_CONFIRM_TARGET,
  registerContractSignature, setContractOrderConditions, createSalesOrder, submitSalesOrder,
  registerContractPrepayment, confirmCustomerPrepayment, applySalesOrderApproval, recoverSalesOrderApproval, requestCustomerPrepaymentRefund, ORDER_APPLY_APPROVAL_TARGET, PREPAYMENT_REFUND_TARGET,
} from './sales-order-domain.js';

export class SalesOrderBusinessPlugin implements Plugin {
  name = 'com.inocube.forge.sales-order-business';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies = ['com.objectstack.service.approvals'];
  init(): void {}
  start(ctx: PluginContext): void {
    const native = ctx.getService<IApprovalService>('approvals');
    const engine = ctx.getService<IObjectQLEngine>('objectql');
    const scopedRequest = async (id: string, context: Parameters<IApprovalService['getRequest']>[1]) => {
      if (!context.tenantId) throw new Error('FORBIDDEN: 审批事项必须限定当前组织');
      // Visibility projections may omit a valid pending request. Read its
      // immutable type from the authority, bounded to the authenticated tenant.
      const request = await engine.findOne('sys_approval_request', {
        where: { id, organization_id: context.tenantId },
      }, { context: { ...context, isSystem: true } });
      if (!request) throw new Error('NOT_FOUND: 当前组织的审批事项不存在');
      return request;
    };
    const requireNonOrderRequest = async (id: string, context: Parameters<IApprovalService['getRequest']>[1]) => {
      const request = await scopedRequest(id, context);
      if (request?.object_name === 'forge_sales_order') {
        throw new Error('VALIDATION_FAILED: 销售订单复核仅支持同意或拒绝，不支持转签或退回；请在原审批事项中办理');
      }
    };
    const reassign: IApprovalService['reassign'] = async (id, input, context) => {
      await requireNonOrderRequest(id, context);
      return native.reassign(id, input, context);
    };
    const sendBack: IApprovalService['sendBack'] = async (id, input, context) => {
      await requireNonOrderRequest(id, context);
      return native.sendBack(id, input, context);
    };
    const requestInfo: IApprovalService['requestInfo'] = async (id, input, context) => {
      await requireNonOrderRequest(id, context);
      return native.requestInfo(id, input, context);
    };
    const decide: IApprovalService['decide'] = async (id, input, context) => {
      const request = await scopedRequest(id, context);
      if (request?.object_name === 'forge_sales_order') {
        const organizationId = context.tenantId, actorId = context.userId;
        if (!organizationId || !actorId || request.organization_id !== organizationId || request.submitter_id === actorId) throw new Error('FORBIDDEN: 订单须由独立员工本人复核');
        const system = businessContext(actorId, organizationId);
        const order = await engine.findOne('forge_sales_order', { where: { id: request.record_id, organization_id: organizationId } }, { context: system });
        if (!order || order.submitted_by === actorId || order.review_owner_id !== actorId
          || !(await effectivePositionUsers(engine, organizationId, 'sales_order_reviewer', { context: system })).includes(actorId)) throw new Error('FORBIDDEN: 当前员工不是本订单有效复核人');
      }
      const result = await native.decide(id, input, context);
      if (request.object_name === 'forge_sales_order' && ['approved', 'rejected'].includes(String(result.request.status))) {
        // Normal REST and Workbench share the durable native decision. A lost
        // flow must not leave a successful decision with a pending order.
        try { await applySalesOrderApproval(engine, String(request.record_id), context.tenantId!); }
        catch { throw new Error('APPROVAL_ACTION_IN_DOUBT: 原生决定已保存，订单结果待核对，请从订单事项继续核对原结果'); }
      }
      return result;
    };
    ctx.replaceService('approvals', new Proxy(native, {
      get(target, property, receiver) {
        if (property === 'decide') return decide;
        if (property === 'reassign') return reassign;
        if (property === 'sendBack') return sendBack;
        if (property === 'requestInfo') return requestInfo;
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }));
    ctx.hook('kernel:ready', () => {
      const storage = ctx.getService<IStorageService>('storage');
      const owner = this.name;
      engine.registerAction('forge_sales_contract', SIGNATURE_TARGET, action => registerContractSignature(engine, storage, action), owner);
      engine.registerAction('forge_sales_contract', ORDER_CONDITIONS_TARGET, action => setContractOrderConditions(engine, action), owner);
      engine.registerAction('forge_sales_contract', CONTRACT_ORDER_TARGET, action => createSalesOrder(engine, action), owner);
      engine.registerAction('forge_sales_contract', CONTRACT_PREPAYMENT_TARGET, action => registerContractPrepayment(engine, storage, action), owner);
      engine.registerAction('forge_sales_order', ORDER_APPLY_APPROVAL_TARGET, action => recoverSalesOrderApproval(engine, action), owner);
      engine.registerAction('forge_customer_prepayment', PREPAYMENT_REFUND_TARGET, action => requestCustomerPrepaymentRefund(engine, action), owner);
      engine.registerAction('forge_sales_order', ORDER_SUBMIT_TARGET, action => submitSalesOrder(engine, action), owner);
      engine.registerAction('forge_customer_prepayment', PREPAYMENT_CONFIRM_TARGET, action => confirmCustomerPrepayment(engine, action), owner);
      engine.registerHook('afterUpdate', async (hook: HookContext) => {
        const input = businessRow(hook.input) ?? {}, change = businessRow(input.data) ?? input;
        // The approval flow first records its outcome. It must not write an
        // active status before the atomic domain update has succeeded.
        if (!['approved', 'rejected'].includes(String(change.approval_outcome))) return;
        const row = { ...businessRow(hook.previous), ...change, ...businessRow(hook.result) };
        if (row.status === 'active' && row.approval_outcome === 'approved' || row.status === 'cancelled' && row.approval_outcome === 'rejected') return;
        const recordId = String(row.id || input.id || ''), org = String(row.organization_id || hook.session?.organizationId || '');
        if (!recordId || !org) throw new Error('订单审批结果缺少准确业务来源');
        await applySalesOrderApproval(engine, recordId, org);
      }, { object: 'forge_sales_order', priority: 160, packageId: owner });
    });
  }
}
