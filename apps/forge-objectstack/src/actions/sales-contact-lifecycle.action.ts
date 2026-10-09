import { defineAction } from '@objectstack/spec';

/** Contact eligibility also requires native access to its customer. */
export const SalesContactCanMaintain = defineAction({
  name: 'sales_contact_can_maintain',
  label: '读取联系人维护状态',
  objectName: 'forge_contact',
  locations: [],
  requiredPermissions: ['sales_crm_maintain'],
  refreshAfter: false,
  params: [],
  target: 'forgeReadContactMaintainability',
});
