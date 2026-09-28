import { salesContractOperatorPermission, salesContractReviewerPermission } from '../../permissions/sales-contract.permission.js';
import { salesLeadConversionPermission, salesLeadOwnerPermission } from '../../permissions/sales-lead-conversion.permission.js';
import { salesQuotationAdjustmentPermission, salesQuotationDraftPermission, salesQuotationReviewerPermission } from '../../permissions/sales-quotation.permission.js';
import { salesOrderFulfillmentPermission, salesOrderOperatorPermission, salesOrderReviewerPermission } from '../../permissions/sales-order.permission.js';
import { contractLegalReviewerPermission, contractSignatureRegistrarPermission, serviceOperatorPermission } from '../../permissions/otc-role.permission.js';
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
  salesQuotationDraftPermission,
  salesQuotationReviewerPermission,
  salesOrderOperatorPermission,
  salesOrderReviewerPermission,
  salesOrderFulfillmentPermission,
  contractLegalReviewerPermission,
  contractSignatureRegistrarPermission,
  serviceOperatorPermission,
  salesReferenceReaderPermission,
  salesCustomerFollowUpOperatorPermission,
  salesSettingsManagerPermission,
]);
