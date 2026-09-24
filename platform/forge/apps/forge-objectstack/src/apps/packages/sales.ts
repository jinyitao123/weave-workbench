import { salesContractOperatorPermission, salesContractReviewerPermission } from '../../permissions/sales-contract.permission.js';
import { salesLeadConversionPermission, salesLeadOwnerPermission } from '../../permissions/sales-lead-conversion.permission.js';
import { salesQuotationAdjustmentPermission } from '../../permissions/sales-quotation.permission.js';
import {
  salesReferenceReaderPermission,
  salesCustomerFollowUpOperatorPermission,
  salesSettingsManagerPermission,
} from '../../permissions/application-settings.permission.js';
import { defineForgeApplicationPackage } from '../package.js';

export const salesApplication = defineForgeApplicationPackage('sales', [
  salesContractOperatorPermission,
  salesContractReviewerPermission,
  salesLeadOwnerPermission,
  salesLeadConversionPermission,
  salesQuotationAdjustmentPermission,
  salesReferenceReaderPermission,
  salesCustomerFollowUpOperatorPermission,
  salesSettingsManagerPermission,
]);
