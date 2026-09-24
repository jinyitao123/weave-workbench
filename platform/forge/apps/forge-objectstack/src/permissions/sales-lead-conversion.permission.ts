import { definePermissionSet } from '@objectstack/spec';

/** Let sales employees maintain their own lead facts without converting them. */
export const salesLeadOwnerPermission = definePermissionSet({
  name: 'sales_lead_owner',
  label: '销售线索办理',
  description: '创建并维护本人负责的销售线索；转化为商机需另授予转化权限。',
  objects: {
    forge_sales_lead: {
      allowCreate: true,
      allowRead: true,
      allowEdit: true,
      readScope: 'own',
      writeScope: 'own',
    },
  },
});

/** Server-side capability required by sales_lead_convert_to_opportunity. */
export const salesLeadConversionPermission = definePermissionSet({
  name: 'sales_lead_conversion_operator',
  label: '销售线索转化办理',
  description: '允许员工通过受控销售动作，将本人负责的有效线索转为客户和商机。',
  systemPermissions: ['sales_lead_convert'],
  objects: {
    forge_sales_lead: {
      allowRead: true,
      allowEdit: true,
      readScope: 'own',
      writeScope: 'own',
    },
    forge_customer: {
      allowCreate: true,
      allowRead: true,
      readScope: 'org',
      writeScope: 'own',
    },
    forge_customer_category: {
      allowRead: true,
      readScope: 'org',
    },
    forge_sales_opportunity: {
      allowCreate: true,
      allowRead: true,
      readScope: 'own',
      writeScope: 'own',
    },
  },
});
