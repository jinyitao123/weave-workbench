import { defineForgeApplicationPackage } from '../package.js';
import {
  productionReferenceReaderPermission,
  productionSettingsManagerPermission,
} from '../../permissions/application-settings.permission.js';
import { productionOperatorPermission, productionReviewerPermission } from '../../permissions/otc-role.permission.js';

export const productionApplication = defineForgeApplicationPackage('production', [
  productionReferenceReaderPermission,
  productionSettingsManagerPermission,
  productionOperatorPermission,
  productionReviewerPermission,
]);
