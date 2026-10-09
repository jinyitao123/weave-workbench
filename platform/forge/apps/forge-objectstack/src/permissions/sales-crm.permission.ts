import { definePermissionSet } from '@objectstack/spec';

/** Invocation eligibility only; ordinary object, record and field grants still apply. */
export const salesCrmMaintenancePermission = definePermissionSet({
  name: 'sales_crm_maintenance_operator',
  label: '客户与联系人维护资格查询',
  description: '读取本人客户与联系人的维护资格；不授予业务对象读写或字段权限。',
  systemPermissions: ['sales_crm_maintain'],
  objects: {},
});
