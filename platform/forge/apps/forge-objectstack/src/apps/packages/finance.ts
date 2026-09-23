import { defineForgeApplicationPackage } from '../package.js';
import { financeSettingsManagerPermission } from '../../permissions/application-settings.permission.js';

export const financeApplication = defineForgeApplicationPackage('finance', [
  financeSettingsManagerPermission,
]);
