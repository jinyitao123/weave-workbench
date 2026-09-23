export type ForgeApplicationKey =
  | 'supply_chain'
  | 'sales'
  | 'production'
  | 'project'
  | 'administration'
  | 'finance'
  | 'reports';

export type ForgeBusinessApplicationKey = ForgeApplicationKey;

export type SettingMigration = {
  id: string;
  label: string;
  targetApplications: ForgeApplicationKey[];
  resolution: 'moved' | 'native_setup' | 'pending_business_decision';
  accessFinding?: 'declared_in_sales_sets_only' | 'declared_in_application_sets' | 'no_declared_read_grant';
  permissionSetNames?: string[];
  assignmentState?: 'requires_setup_assignment';
  nativeTarget?: {
    appName: 'setup';
    capability: 'package_management' | 'service_subscriptions' | 'field_definitions';
    route: null;
  };
};

export type SettingConsumerReadRequirement = {
  objectName: string;
  owningApplication: ForgeApplicationKey;
  recordScope: 'org';
  permissionSetNames: string[];
  consumers: string[];
};

/**
 * Evidence-backed read path for settings-backed values. These sets are
 * declarations only; Setup must bind them to the relevant real business
 * positions before ordinary employees receive access.
 */
export const settingConsumerReadRequirements: SettingConsumerReadRequirement[] = [
  {
    objectName: 'forge_material_category', owningApplication: 'supply_chain', recordScope: 'org',
    permissionSetNames: ['forge_supply_chain_reference_reader', 'forge_supply_chain_settings_manager', 'forge_sales_reference_reader', 'sales_contract_operator'],
    consumers: ['src/pages/material-workspace.page.ts', 'src/pages/inventory-overview.page.ts', 'src/pages/inventory-statistics.page.ts', 'src/pages/product-trace.page.ts', 'src/pages/sales-order-create.page.ts', 'src/pages/sales-management-pages.page.ts'],
  },
  {
    objectName: 'forge_unit', owningApplication: 'supply_chain', recordScope: 'org',
    permissionSetNames: ['forge_supply_chain_reference_reader', 'forge_supply_chain_settings_manager', 'forge_sales_reference_reader', 'sales_contract_operator', 'forge_production_reference_reader'],
    consumers: ['src/pages/material-workspace.page.ts', 'src/pages/inventory-transfer.page.ts', 'src/pages/inventory-count.page.ts', 'src/pages/inventory-ledger.page.ts', 'src/pages/sales-contract-create.page.ts', 'src/pages/sales-order-create.page.ts', 'src/actions/production.action.ts', 'src/actions/shortage.action.ts'],
  },
  {
    objectName: 'forge_supplier_category', owningApplication: 'supply_chain', recordScope: 'org',
    permissionSetNames: ['forge_supply_chain_reference_reader', 'forge_supply_chain_settings_manager'],
    consumers: ['src/pages/supplier-workspace.page.ts'],
  },
  {
    objectName: 'forge_supplier_level', owningApplication: 'supply_chain', recordScope: 'org',
    permissionSetNames: ['forge_supply_chain_reference_reader', 'forge_supply_chain_settings_manager'],
    consumers: ['src/pages/supplier-workspace.page.ts'],
  },
  {
    objectName: 'forge_customer_category', owningApplication: 'sales', recordScope: 'org',
    permissionSetNames: ['forge_sales_reference_reader', 'forge_sales_settings_manager', 'sales_contract_operator'],
    consumers: ['src/pages/sales-customers.page.ts', 'src/pages/sales-management-pages.page.ts', 'src/actions/sales.action.ts'],
  },
  {
    objectName: 'forge_customer_level', owningApplication: 'sales', recordScope: 'org',
    permissionSetNames: ['forge_sales_reference_reader', 'forge_sales_settings_manager', 'sales_contract_operator'],
    consumers: ['src/pages/sales-customers.page.ts'],
  },
  {
    objectName: 'forge_quotation_type', owningApplication: 'sales', recordScope: 'org',
    permissionSetNames: ['forge_sales_reference_reader', 'forge_sales_settings_manager', 'sales_contract_operator'],
    consumers: ['src/pages/sales-crm-service-pages.page.ts', 'src/objects/sales.object.ts'],
  },
  {
    objectName: 'forge_quotation_issuer', owningApplication: 'sales', recordScope: 'org',
    permissionSetNames: ['forge_sales_reference_reader', 'forge_sales_settings_manager', 'sales_contract_operator'],
    consumers: ['src/pages/sales-crm-service-pages.page.ts', 'src/objects/sales.object.ts'],
  },
  {
    objectName: 'forge_warehouse_type', owningApplication: 'supply_chain', recordScope: 'org',
    permissionSetNames: ['forge_supply_chain_reference_reader', 'forge_supply_chain_settings_manager', 'forge_production_reference_reader'],
    consumers: ['src/pages/warehouse-workspace.page.ts', 'src/pages/production-prerequisites.page.ts'],
  },
  {
    objectName: 'forge_payment_condition', owningApplication: 'finance', recordScope: 'org',
    permissionSetNames: ['forge_finance_settings_manager', 'forge_production_reference_reader'],
    consumers: ['src/pages/subcontract-workspace.page.ts', 'src/pages/production-prerequisites.page.ts', 'src/actions/subcontract.action.ts'],
  },
  {
    objectName: 'forge_inventory_business_setting', owningApplication: 'supply_chain', recordScope: 'org',
    permissionSetNames: ['forge_supply_chain_settings_manager', 'forge_production_reference_reader'],
    consumers: ['src/pages/business-prerequisite-config.page.ts', 'src/pages/production-prerequisites.page.ts'],
  },
  {
    objectName: 'forge_other_inbound_type', owningApplication: 'supply_chain', recordScope: 'org',
    permissionSetNames: ['forge_supply_chain_reference_reader', 'forge_supply_chain_settings_manager', 'forge_production_reference_reader'],
    consumers: ['src/pages/other-inbound-workspace.page.ts', 'src/pages/all-inbounds.page.ts', 'src/pages/production-prerequisites.page.ts', 'src/actions/inventory.action.ts'],
  },
  {
    objectName: 'forge_production_disassembly_reason', owningApplication: 'production', recordScope: 'org',
    permissionSetNames: ['forge_production_settings_manager', 'forge_production_reference_reader'],
    consumers: ['src/pages/production-transform-workspace.page.ts', 'src/pages/production-prerequisites.page.ts', 'src/actions/production-transform.action.ts'],
  },
  {
    objectName: 'forge_production_replacement_reason', owningApplication: 'production', recordScope: 'org',
    permissionSetNames: ['forge_production_settings_manager', 'forge_production_reference_reader'],
    consumers: ['src/pages/production-transform-workspace.page.ts', 'src/pages/production-prerequisites.page.ts', 'src/actions/production-transform.action.ts'],
  },
  {
    objectName: 'forge_drawing_business_setting', owningApplication: 'production', recordScope: 'org',
    permissionSetNames: ['forge_production_settings_manager', 'forge_production_reference_reader'],
    consumers: ['src/pages/production-prerequisites.page.ts'],
  },
  {
    objectName: 'forge_subcontract_business_setting', owningApplication: 'production', recordScope: 'org',
    permissionSetNames: ['forge_production_settings_manager', 'forge_production_reference_reader'],
    consumers: ['src/pages/subcontract-pricing.page.ts', 'src/pages/subcontract-return.page.ts', 'src/pages/subcontract-workspace.page.ts', 'src/actions/subcontract-return.action.ts', 'src/actions/subcontract.action.ts'],
  },
  {
    objectName: 'forge_subcontract_policy', owningApplication: 'production', recordScope: 'org',
    permissionSetNames: ['forge_production_settings_manager', 'forge_production_reference_reader'],
    consumers: ['src/pages/production-prerequisites.page.ts', 'src/pages/subcontract-policy.page.ts', 'src/actions/subcontract.action.ts'],
  },
  {
    objectName: 'forge_project_type', owningApplication: 'project', recordScope: 'org',
    permissionSetNames: ['forge_project_reference_reader', 'forge_project_settings_manager'],
    consumers: ['src/pages/project-center.page.ts', 'src/actions/project.action.ts'],
  },
  {
    objectName: 'forge_report_template', owningApplication: 'reports', recordScope: 'org',
    permissionSetNames: ['forge_reports_default_template_reader', 'forge_reports_settings_manager'],
    consumers: ['src/pages/management-profit-report.page.ts'],
  },
];

const allBusinessApplications: ForgeBusinessApplicationKey[] = [
  'supply_chain',
  'sales',
  'production',
  'project',
  'administration',
  'finance',
  'reports',
];

export type WorkspaceNavigationMigration = {
  id: string;
  resolution: 'gooeypi' | 'native_setup' | 'native_inbox';
  nativeTarget: {
    surface: 'GooeyPi' | 'ObjectStack Setup' | 'ObjectStack native inbox';
    capability: string;
    route: null;
  };
};

export const workspaceNavigationMigrations: WorkspaceNavigationMigration[] = [
  { id: 'workspace_home', resolution: 'gooeypi', nativeTarget: { surface: 'GooeyPi', capability: 'employee_home', route: null } },
  { id: 'workspace_ai', resolution: 'gooeypi', nativeTarget: { surface: 'GooeyPi', capability: 'ai_assistant', route: null } },
  { id: 'workspace_guidance', resolution: 'native_setup', nativeTarget: { surface: 'ObjectStack Setup', capability: 'initialization_guidance', route: null } },
  { id: 'workspace_todo', resolution: 'native_inbox', nativeTarget: { surface: 'ObjectStack native inbox', capability: 'personal_inbox', route: null } },
];

/**
 * The authoritative disposition for the 27 leaves under the former shared
 * Business Settings area. The Setup routes remain null until the official
 * native target is resolved; no browser path is fabricated here.
 */
export const settingMigrations: SettingMigration[] = [
  { id: 'material_skus', label: '规格与价格', targetApplications: ['supply_chain'], resolution: 'moved', accessFinding: 'declared_in_application_sets', permissionSetNames: ['forge_supply_chain_settings_manager', 'sales_contract_operator'], assignmentState: 'requires_setup_assignment' },
  { id: 'material_categories', label: '物料分类', targetApplications: ['supply_chain'], resolution: 'moved', accessFinding: 'declared_in_application_sets', permissionSetNames: ['forge_supply_chain_reference_reader', 'forge_supply_chain_settings_manager', 'forge_sales_reference_reader', 'sales_contract_operator'], assignmentState: 'requires_setup_assignment' },
  { id: 'units', label: '计量单位', targetApplications: ['supply_chain'], resolution: 'moved', accessFinding: 'declared_in_application_sets', permissionSetNames: ['forge_supply_chain_reference_reader', 'forge_supply_chain_settings_manager', 'forge_sales_reference_reader', 'sales_contract_operator', 'forge_production_reference_reader'], assignmentState: 'requires_setup_assignment' },
  { id: 'supplier_categories', label: '供应商分类', targetApplications: ['supply_chain'], resolution: 'moved', accessFinding: 'declared_in_application_sets', permissionSetNames: ['forge_supply_chain_reference_reader', 'forge_supply_chain_settings_manager'], assignmentState: 'requires_setup_assignment' },
  { id: 'supplier_levels', label: '供应商级别', targetApplications: ['supply_chain'], resolution: 'moved', accessFinding: 'declared_in_application_sets', permissionSetNames: ['forge_supply_chain_reference_reader', 'forge_supply_chain_settings_manager'], assignmentState: 'requires_setup_assignment' },
  { id: 'customer_categories', label: '客户分类', targetApplications: ['sales'], resolution: 'moved', accessFinding: 'declared_in_application_sets', permissionSetNames: ['forge_sales_reference_reader', 'sales_contract_operator', 'forge_sales_settings_manager'], assignmentState: 'requires_setup_assignment' },
  { id: 'customer_levels', label: '客户级别', targetApplications: ['sales'], resolution: 'moved', accessFinding: 'declared_in_application_sets', permissionSetNames: ['forge_sales_reference_reader', 'sales_contract_operator', 'forge_sales_settings_manager'], assignmentState: 'requires_setup_assignment' },
  { id: 'payment_conditions', label: '付款条件', targetApplications: ['finance'], resolution: 'moved', accessFinding: 'declared_in_application_sets', permissionSetNames: ['forge_finance_settings_manager', 'forge_production_reference_reader'], assignmentState: 'requires_setup_assignment' },
  { id: 'quotation_types', label: '报价类型', targetApplications: ['sales'], resolution: 'moved', accessFinding: 'declared_in_application_sets', permissionSetNames: ['forge_sales_reference_reader', 'sales_contract_operator', 'forge_sales_settings_manager'], assignmentState: 'requires_setup_assignment' },
  { id: 'quotation_issuers', label: '报价主体', targetApplications: ['sales'], resolution: 'moved', accessFinding: 'declared_in_application_sets', permissionSetNames: ['forge_sales_reference_reader', 'sales_contract_operator', 'forge_sales_settings_manager'], assignmentState: 'requires_setup_assignment' },
  { id: 'contract_types', label: '合同类型', targetApplications: ['sales'], resolution: 'moved', accessFinding: 'declared_in_application_sets', permissionSetNames: ['forge_sales_reference_reader', 'sales_contract_operator', 'forge_sales_settings_manager'], assignmentState: 'requires_setup_assignment' },
  { id: 'warehouse_types', label: '仓库类型', targetApplications: ['supply_chain'], resolution: 'moved', accessFinding: 'declared_in_application_sets', permissionSetNames: ['forge_supply_chain_reference_reader', 'forge_supply_chain_settings_manager', 'forge_production_reference_reader'], assignmentState: 'requires_setup_assignment' },
  { id: 'inventory_business_config', label: '库存管理配置', targetApplications: ['supply_chain'], resolution: 'moved' },
  { id: 'project_business_config', label: '项目管理配置', targetApplications: ['project'], resolution: 'moved' },
  { id: 'finance_business_config', label: '付款方式与费用类别', targetApplications: ['finance'], resolution: 'moved' },
  { id: 'administration_business_config', label: '行政管理配置', targetApplications: ['administration'], resolution: 'moved' },
  { id: 'other_business_config', label: '其他配置', targetApplications: ['administration'], resolution: 'moved' },
  { id: 'hr_business_config', label: '人事配置', targetApplications: ['administration'], resolution: 'moved' },
  { id: 'drawing_business_config', label: '图纸配置', targetApplications: ['production'], resolution: 'moved' },
  { id: 'production_config', label: '生产配置', targetApplications: ['production'], resolution: 'moved' },
  { id: 'subcontract_business_config', label: '委外字典', targetApplications: ['production'], resolution: 'moved' },
  { id: 'subcontract_policy', label: '委外控制规则', targetApplications: ['production'], resolution: 'moved' },
  { id: 'document_printing', label: '单据打印', targetApplications: allBusinessApplications, resolution: 'moved' },
  {
    id: 'plugin_center_gap',
    label: '插件中心',
    targetApplications: [],
    resolution: 'native_setup',
    nativeTarget: { appName: 'setup', capability: 'package_management', route: null },
  },
  {
    id: 'service_subscription_gap',
    label: '服务订阅',
    targetApplications: [],
    resolution: 'native_setup',
    nativeTarget: { appName: 'setup', capability: 'service_subscriptions', route: null },
  },
  { id: 'promotion_rewards_gap', label: '推广奖励', targetApplications: [], resolution: 'pending_business_decision' },
  {
    id: 'field_management_gap',
    label: '字段管理',
    targetApplications: [],
    resolution: 'native_setup',
    nativeTarget: { appName: 'setup', capability: 'field_definitions', route: null },
  },
];

/** New report-app-owned capability, beyond the 27 migrated shared settings. */
export const applicationSettingAdditions: SettingMigration[] = [
  {
    id: 'report_templates',
    label: '报表模板与默认口径',
    targetApplications: ['reports'],
    resolution: 'moved',
    accessFinding: 'declared_in_application_sets',
    permissionSetNames: ['forge_reports_default_template_reader', 'forge_reports_settings_manager'],
    assignmentState: 'requires_setup_assignment',
  },
];
