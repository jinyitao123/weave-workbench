import { defineForgeApplicationPackage } from '../package.js';
import {
  supplyChainReferenceReaderPermission,
  supplyChainSettingsManagerPermission,
} from '../../permissions/application-settings.permission.js';
import { materialMasterOperatorPermission, procurementOperatorPermission, procurementReviewerPermission, warehouseOperatorPermission, warehouseReviewerPermission, qualityInspectorPermission } from '../../permissions/otc-role.permission.js';

export const supplyChainApplication = defineForgeApplicationPackage('supply_chain', [
  supplyChainReferenceReaderPermission,
  supplyChainSettingsManagerPermission,
  materialMasterOperatorPermission,
  procurementOperatorPermission,
  procurementReviewerPermission,
  warehouseOperatorPermission,
  warehouseReviewerPermission,
  qualityInspectorPermission,
]);
