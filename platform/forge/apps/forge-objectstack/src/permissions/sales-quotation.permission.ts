import { definePermissionSet } from '@objectstack/spec';

const organizationRead = { allowRead: true, readScope: 'org' as const };
const ownRead = { allowRead: true, readScope: 'own' as const };
export const salesQuotationCostFieldMask = {
  'forge_material_sku.cost_price': { readable: false },
  'forge_quotation.cost_total': { readable: false },
  'forge_quotation_line.cost_price': { readable: false },
  'forge_quotation_price_adjustment_receipt.cost_total': { readable: false },
} as const;

/** Let sales employees create and maintain their own draft quotes through Forge domain actions. */
export const salesQuotationDraftPermission = definePermissionSet({
  name: 'sales_quotation_draft_operator',
  label: '销售报价草稿办理',
  description: '创建本人负责的销售报价草稿、读取组织内报价所需客户与目录资料，并通过受控动作调整本人草稿明细。',
  systemPermissions: ['sales_quotation_draft_create', 'sales_quotation_adjust'],
  fields: salesQuotationCostFieldMask,
  objects: {
    forge_quotation: { allowRead: true, readScope: 'own' },
    forge_quotation_line: { allowRead: true, readScope: 'own' },
    forge_customer: ownRead,
    forge_contact: ownRead,
    forge_quotation_type: organizationRead,
    forge_quotation_issuer: organizationRead,
    forge_material_sku: organizationRead,
    forge_material: organizationRead,
    forge_unit: organizationRead,
  },
});

/** Allow quote owners to use the controlled single-line price adjustment action. */
export const salesQuotationAdjustmentPermission = definePermissionSet({
  name: 'sales_quotation_adjustment_operator',
  label: '销售报价调整',
  description: '允许报价负责人通过受控动作调整本人草稿报价的一行含税单价并重算金额。',
  systemPermissions: ['sales_quotation_adjust'],
  fields: salesQuotationCostFieldMask,
  rowLevelSecurity: [
    {
      name: 'responsible_quotation_read',
      object: 'forge_quotation',
      operation: 'select',
      using: 'responsible_id == current_user.id',
    },
  ],
  objects: {
    forge_quotation: { allowRead: true, readScope: 'own' },
    forge_quotation_line: { allowRead: true, readScope: 'own' },
  },
});
