import { defineForgeApplicationPackage } from '../package.js';
import { financeSettingsManagerPermission } from '../../permissions/application-settings.permission.js';
import { financeReceivablesOperatorPermission, financeReviewerPermission } from '../../permissions/otc-role.permission.js';

export const financeApplication = defineForgeApplicationPackage('finance', [
  financeSettingsManagerPermission,
  financeReceivablesOperatorPermission,
  financeReviewerPermission,
]);
