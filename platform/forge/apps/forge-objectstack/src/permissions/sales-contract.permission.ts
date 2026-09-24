import { definePermissionSet } from '@objectstack/spec';
import { salesQuotationCostFieldMask } from './sales-quotation.permission.js';

const readReferenceData = {
  allowRead: true,
  readScope: 'org' as const,
};

const readOrganizationReferenceData = {
  allowRead: true,
  readScope: 'org' as const,
};
const readOwnRecords = {
  allowRead: true,
  readScope: 'own' as const,
};

/**
 * Lets a salesperson prepare and submit contracts they own while keeping
 * shared customer, material and contract dictionaries read-only.
 */
export const salesContractOperatorPermission = definePermissionSet({
  name: 'sales_contract_operator',
  label: '销售合同办理',
  description: '允许销售员工新建、修改并提交自己负责的销售合同。',
  systemPermissions: ['sales_contract_operator'],
  fields: salesQuotationCostFieldMask,
  objects: {
    forge_sales_contract: {
      allowCreate: true,
      allowRead: true,
      allowEdit: true,
      readScope: 'own',
      writeScope: 'own',
    },
    forge_sales_contract_line: {
      allowCreate: true,
      allowRead: true,
      allowEdit: true,
      readScope: 'own',
      writeScope: 'own',
    },
    forge_customer: readOwnRecords,
    forge_customer_category: readOrganizationReferenceData,
    forge_customer_level: readOrganizationReferenceData,
    forge_contact: readOwnRecords,
    forge_contract_type: readReferenceData,
    forge_quotation: readOwnRecords,
    forge_quotation_line: readOwnRecords,
    forge_quotation_type: readOrganizationReferenceData,
    forge_quotation_issuer: readOrganizationReferenceData,
    forge_material_sku: readReferenceData,
    forge_material: readReferenceData,
    forge_material_category: readOrganizationReferenceData,
    forge_unit: readOrganizationReferenceData,
    forge_fund_account: readReferenceData,
    forge_product_bundle: readReferenceData,
    forge_product_bundle_line: readReferenceData,
  },
});

/**
 * Reviewers receive records through the native approval inbox. They can read
 * the submitted contract and its inherited details but cannot edit it.
 */
export const salesContractReviewerPermission = definePermissionSet({
  name: 'sales_contract_reviewer',
  label: '销售合同复核',
  description: '允许合同复核岗查看待复核合同及物料明细。',
  fields: salesQuotationCostFieldMask,
  objects: {
    forge_sales_contract: readOwnRecords,
    forge_sales_contract_line: readOwnRecords,
    forge_customer: readOwnRecords,
    forge_contact: readOwnRecords,
    forge_contract_type: readOrganizationReferenceData,
    forge_quotation: readOwnRecords,
    forge_quotation_line: readOwnRecords,
    forge_material_sku: readOrganizationReferenceData,
    forge_material: readOrganizationReferenceData,
    forge_unit: readOrganizationReferenceData,
  },
});
