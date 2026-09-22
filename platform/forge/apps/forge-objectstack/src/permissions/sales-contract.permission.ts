import { definePermissionSet } from '@objectstack/spec';

const readReferenceData = {
  allowRead: true,
  viewAllRecords: true,
};

/**
 * Lets a salesperson prepare and submit contracts they own while keeping
 * shared customer, material and contract dictionaries read-only.
 */
export const salesContractOperatorPermission = definePermissionSet({
  name: 'sales_contract_operator',
  label: '销售合同办理',
  description: '允许销售员工新建、修改并提交自己负责的销售合同。',
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
    forge_customer: readReferenceData,
    forge_contact: readReferenceData,
    forge_contract_type: readReferenceData,
    forge_quotation: readReferenceData,
    forge_quotation_line: readReferenceData,
    forge_material_sku: readReferenceData,
    forge_material: readReferenceData,
    forge_unit: readReferenceData,
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
  objects: {
    forge_sales_contract: readReferenceData,
    forge_sales_contract_line: readReferenceData,
    forge_customer: readReferenceData,
    forge_contact: readReferenceData,
    forge_contract_type: readReferenceData,
    forge_quotation: readReferenceData,
    forge_quotation_line: readReferenceData,
    forge_material_sku: readReferenceData,
    forge_material: readReferenceData,
    forge_unit: readReferenceData,
  },
});
