import { definePermissionSet } from '@objectstack/spec';

const orgRead = {
  allowRead: true,
  readScope: 'org' as const,
};

const orgManage = {
  allowCreate: true,
  allowRead: true,
  allowEdit: true,
  allowDelete: true,
  readScope: 'org' as const,
  writeScope: 'org' as const,
};

function scopedSettingsManager(
  name: string,
  label: string,
  scope: string,
  capability: string,
) {
  return definePermissionSet({
    name,
    label,
    description: `仅维护 ${scope} 范围的 Forge 业务设置；赋权由 ObjectStack Setup 管理。`,
    systemPermissions: [capability],
    objects: {
      forge_business_setting_option: orgManage,
    },
    rowLevelSecurity: [{
      name: `${scope}_setting_scope`,
      object: 'forge_business_setting_option',
      operation: 'all',
      using: `scope == '${scope}'`,
      check: `scope == '${scope}'`,
    }],
  });
}

export const supplyChainReferenceReaderPermission = definePermissionSet({
  name: 'forge_supply_chain_reference_reader',
  label: '供应链业务字典只读',
  description: '为供应链业务办理读取组织内物料、供应商、单位和仓库类型字典。',
  objects: {
    forge_material_category: orgRead,
    forge_unit: orgRead,
    forge_supplier_category: orgRead,
    forge_supplier_level: orgRead,
    forge_warehouse_type: orgRead,
    forge_inventory_business_setting: orgRead,
    forge_other_inbound_type: orgRead,
  },
});

export const salesReferenceReaderPermission = definePermissionSet({
  name: 'forge_sales_reference_reader',
  label: '销售基础设置只读',
  description: '销售录入读取组织内客户分类、报价类型、报价主体和销售引用字典；不授予维护权限。',
  objects: {
    forge_customer_category: orgRead,
    forge_customer_level: orgRead,
    forge_quotation_type: orgRead,
    forge_quotation_issuer: orgRead,
    forge_contract_type: orgRead,
    forge_material_category: orgRead,
    forge_unit: orgRead,
  },
});

export const productionReferenceReaderPermission = definePermissionSet({
  name: 'forge_production_reference_reader',
  label: '生产业务引用只读',
  description: '生产前置检查和委外办理只读供应链仓库类型及财务维护的付款条件。',
  objects: {
    forge_warehouse_type: orgRead,
    forge_inventory_business_setting: orgRead,
    forge_other_inbound_type: orgRead,
    forge_unit: orgRead,
    forge_payment_condition: orgRead,
    forge_production_disassembly_reason: orgRead,
    forge_production_replacement_reason: orgRead,
    forge_drawing_business_setting: orgRead,
    forge_subcontract_business_setting: orgRead,
    forge_subcontract_policy: orgRead,
  },
});

export const projectReferenceReaderPermission = definePermissionSet({
  name: 'forge_project_reference_reader',
  label: '项目类型只读',
  description: '项目立项和项目工作区只读组织内项目类型；类型维护权限单独授予项目设置管理员。',
  objects: {
    forge_project_type: orgRead,
  },
});

export const supplyChainSettingsManagerPermission = definePermissionSet({
  name: 'forge_supply_chain_settings_manager',
  label: '供应链业务设置维护',
  description: '维护供应链应用拥有的物料、供应商和库存类型配置。',
  systemPermissions: ['forge_supply_chain_settings_manage'],
  objects: {
    forge_material_sku: orgManage,
    forge_material_category: orgManage,
    forge_unit: orgManage,
    forge_supplier_category: orgManage,
    forge_supplier_level: orgManage,
    forge_warehouse_type: orgManage,
    forge_inventory_business_setting: orgManage,
    forge_other_inbound_type: orgManage,
  },
});

export const salesSettingsManagerPermission = definePermissionSet({
  name: 'forge_sales_settings_manager',
  label: '销售业务设置维护',
  description: '维护销售应用拥有的客户、报价和合同类型配置。',
  systemPermissions: ['forge_sales_settings_manage'],
  objects: {
    forge_customer_category: orgManage,
    forge_customer_level: orgManage,
    forge_quotation_type: orgManage,
    forge_quotation_issuer: orgManage,
    forge_contract_type: orgManage,
  },
});

export const salesCustomerFollowUpOperatorPermission = definePermissionSet({
  name: 'forge_sales_customer_follow_up_operator',
  label: '客户跟进记录办理',
  description: '在组织内可读客户并创建、读取本人负责的客户跟进记录；不授予客户或其他相关记录写权限。',
  systemPermissions: ['forge_sales_customer_follow_up'],
  objects: {
    forge_customer: orgRead,
    forge_sales_follow_up: {
      allowCreate: true,
      allowRead: true,
      readScope: 'own',
    },
  },
});

export const productionSettingsManagerPermission = definePermissionSet({
  name: 'forge_production_settings_manager',
  label: '生产业务设置维护',
  description: '维护生产、图纸和委外办理实际使用的原因、字典与控制规则。',
  systemPermissions: ['forge_production_settings_manage'],
  objects: {
    forge_production_disassembly_reason: orgManage,
    forge_production_replacement_reason: orgManage,
    forge_drawing_business_setting: orgManage,
    forge_subcontract_business_setting: orgManage,
    forge_subcontract_policy: orgManage,
  },
});

export const projectSettingsManagerPermission = definePermissionSet({
  name: 'forge_project_settings_manager',
  label: '项目业务设置维护',
  description: '维护项目类型和项目应用范围内的业务设置项。',
  systemPermissions: ['forge_project_settings_manage'],
  objects: {
    forge_project_type: orgManage,
    forge_business_setting_option: orgManage,
  },
  rowLevelSecurity: [{
    name: 'project_setting_scope',
    object: 'forge_business_setting_option',
    operation: 'all',
    using: "scope == 'project'",
    check: "scope == 'project'",
  }],
});

export const administrationSettingsManagerPermission = definePermissionSet({
  name: 'forge_administration_settings_manager',
  label: '行政业务设置维护',
  description: '维护行政、人事及其他设置；不授予平台账号、组织或审批配置权限。',
  systemPermissions: ['forge_administration_settings_manage'],
  objects: {
    forge_business_setting_option: orgManage,
    forge_meeting_room: orgManage,
    forge_hr_salary_item: orgManage,
    forge_hr_leave_config: orgManage,
  },
  rowLevelSecurity: [
    'administration',
    'other',
    'hr',
  ].map((scope) => ({
    name: `${scope}_setting_scope`,
    object: 'forge_business_setting_option',
    operation: 'all' as const,
    using: `scope == '${scope}'`,
    check: `scope == '${scope}'`,
  })),
});

export const financeSettingsManagerPermission = definePermissionSet({
  name: 'forge_finance_settings_manager',
  label: '财务业务设置维护',
  description: '维护财务范围的付款条件和费用类别。',
  systemPermissions: ['forge_finance_settings_manage'],
  objects: {
    forge_payment_condition: orgManage,
    forge_business_setting_option: orgManage,
  },
  rowLevelSecurity: [{
    name: 'finance_setting_scope',
    object: 'forge_business_setting_option',
    operation: 'all',
    using: "scope == 'finance'",
    check: "scope == 'finance'",
  }],
});

export const reportsDefaultTemplateReaderPermission = definePermissionSet({
  name: 'forge_reports_default_template_reader',
  label: '报表默认口径只读',
  description: '报表使用者只读本组织各报表的默认模板；不允许创建或修改模板。',
  objects: {
    forge_report_template: orgRead,
  },
});

export const reportsSettingsManagerPermission = definePermissionSet({
  name: 'forge_reports_settings_manager',
  label: '报表模板与默认口径维护',
  description: '为当前支持的报表维护组织级默认模板，不修改报表输出版本或业务原单。',
  systemPermissions: ['forge_reports_settings_manage'],
  objects: {
    forge_report_template: orgManage,
  },
});

/**
 * Printing templates remain one shared configuration store. The page is
 * linked from each App, while this single capability and RLS policy guard its
 * `print` rows.
 */
export const documentPrintingSettingsManagerPermission = scopedSettingsManager(
  'forge_document_printing_settings_manager',
  '单据打印设置维护',
  'print',
  'forge_print_settings_manage',
);
