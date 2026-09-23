import { defineForgeApplicationPackage } from '../package.js';
import { administrationSettingsManagerPermission } from '../../permissions/application-settings.permission.js';

export const administrationApplication = defineForgeApplicationPackage('administration', [
  administrationSettingsManagerPermission,
]);
