import { definePermissionSet } from '@objectstack/spec';

/** Allow quote owners to use the controlled single-line price adjustment action. */
export const salesQuotationAdjustmentPermission = definePermissionSet({
  name: 'sales_quotation_adjustment_operator',
  label: '销售报价调整',
  description: '允许报价负责人通过受控动作调整本人草稿报价的一行含税单价并重算金额。',
  systemPermissions: ['sales_quotation_adjust'],
  rowLevelSecurity: [
    {
      name: 'responsible_quotation_read',
      object: 'forge_quotation',
      operation: 'select',
      using: 'responsible_id == current_user.id',
    },
  ],
  objects: {
    forge_quotation: { allowRead: true, viewAllRecords: true },
    forge_quotation_line: { allowRead: true, readScope: 'own' },
  },
});
