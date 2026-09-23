import { defineForgeApplicationPackage } from '../package.js';
import {
  projectReferenceReaderPermission,
  projectSettingsManagerPermission,
} from '../../permissions/application-settings.permission.js';

export const projectApplication = defineForgeApplicationPackage('project', [
  projectReferenceReaderPermission,
  projectSettingsManagerPermission,
]);
