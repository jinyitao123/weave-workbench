import { defineForgeApplicationPackage } from '../package.js';
import {
  productionReferenceReaderPermission,
  productionSettingsManagerPermission,
} from '../../permissions/application-settings.permission.js';

export const productionApplication = defineForgeApplicationPackage('production', [
  productionReferenceReaderPermission,
  productionSettingsManagerPermission,
]);
