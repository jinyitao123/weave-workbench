import { defineForgeApplicationPackage } from '../package.js';
import {
  reportsDefaultTemplateReaderPermission,
  reportsSettingsManagerPermission,
} from '../../permissions/application-settings.permission.js';

export const reportsApplication = defineForgeApplicationPackage('reports', [
  reportsDefaultTemplateReaderPermission,
  reportsSettingsManagerPermission,
]);
