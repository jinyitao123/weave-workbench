import { definePermissionSet } from '@objectstack/spec';
import { salesQuotationCostFieldMask } from './sales-quotation.permission.js';

const organizationRead = { allowRead: true, readScope: 'org' as const };
const ownOrderWrite = {
  allowCreate: true,
  allowRead: true,
  allowEdit: true,
  readScope: 'own' as const,
  writeScope: 'own' as const,
};

/** A dedicated order clerk can prepare own orders from signed, active contracts. */
export const salesOrderOperatorPermission = definePermissionSet({
  name: 'sales_order_operator',
  label: '销售订单经办',
  description: '商务经办人仅维护本人销售订单；只能读取已审批并签署的同组织合同及订单所需客户资料，不授予订单审批或库存发货权限。',
  systemPermissions: ['sales_order_operator'],
  fields: salesQuotationCostFieldMask,
  objects: {
    forge_sales_order: ownOrderWrite,
    forge_sales_order_line: { allowCreate: true, allowRead: true, readScope: 'org' as const },
    forge_sales_contract: organizationRead,
    forge_sales_contract_line: organizationRead,
    forge_customer: organizationRead,
    forge_contact: organizationRead,
    sys_user: organizationRead,
  },
  rowLevelSecurity: [{
    name: 'signed_active_contracts_only',
    object: 'forge_sales_contract',
    operation: 'select',
    using: "status == 'active' && signed_on != null && signed_evidence_attachment != null",
  }],
});

/** Kept separate from order entry so an order creator cannot approve their own order. */
export const salesOrderReviewerPermission = definePermissionSet({
  name: 'sales_order_reviewer',
  label: '销售订单审批',
  description: '独立订单审批岗；不与销售订单经办岗默认合并。',
  systemPermissions: ['sales_order_reviewer'],
  objects: {
    forge_sales_order: { allowRead: true, allowEdit: true, readScope: 'org' as const, writeScope: 'org' as const },
    forge_sales_order_line: organizationRead,
    forge_sales_contract: organizationRead,
    forge_sales_contract_line: organizationRead,
    forge_customer: organizationRead,
  },
});

/** Warehouse shipment actions remain a separate capability from order entry. */
export const salesOrderFulfillmentPermission = definePermissionSet({
  name: 'sales_order_fulfillment_operator',
  label: '销售订单发货办理',
  description: '仓储发货岗位从已审批订单安排实物发货；服务项目不在库存或发货单内。',
  systemPermissions: ['sales_order_fulfillment_operator'],
  objects: {
    forge_sales_order: organizationRead,
    forge_sales_order_line: organizationRead,
    forge_sales_shipment: { allowCreate: true, allowRead: true, allowEdit: true, readScope: 'org' as const, writeScope: 'org' as const },
    forge_sales_shipment_line: { allowCreate: true, allowRead: true, allowEdit: true, readScope: 'org' as const, writeScope: 'org' as const },
    forge_sales_outbound: { allowCreate: true, allowRead: true, allowEdit: true, readScope: 'org' as const, writeScope: 'org' as const },
    forge_inventory_balance: { allowRead: true, allowEdit: true, readScope: 'org' as const, writeScope: 'org' as const },
    forge_inventory_ledger: { allowCreate: true, allowRead: true, readScope: 'org' as const, writeScope: 'org' as const },
  },
});
