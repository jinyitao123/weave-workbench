import { defineAction } from '@objectstack/spec';

/** The handler reads under the invoking employee's native permissions. */
export const SalesCustomerCanMaintain = defineAction({
  name: 'sales_customer_can_maintain',
  label: '读取客户维护状态',
  objectName: 'forge_customer',
  locations: [],
  requiredPermissions: ['sales_crm_maintain'],
  refreshAfter: false,
  params: [],
  target: 'forgeReadCustomerMaintainability',
});
