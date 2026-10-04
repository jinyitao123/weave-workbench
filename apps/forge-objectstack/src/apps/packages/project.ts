import { defineForgeApplicationPackage } from '../package.js';
import {
  projectReferenceReaderPermission,
  projectSettingsManagerPermission,
} from '../../permissions/application-settings.permission.js';
import { projectManagerPermission, projectOperatorPermission } from '../../permissions/project-operator.permission.js';
import { solutionOperatorPermission, projectGateReviewerPermission, deliveryOperatorPermission } from '../../permissions/otc-role.permission.js';

export const projectApplication = defineForgeApplicationPackage('project', [
  projectReferenceReaderPermission,
  projectSettingsManagerPermission,
  projectOperatorPermission,
  projectManagerPermission,
  solutionOperatorPermission,
  projectGateReviewerPermission,
  deliveryOperatorPermission,
]);
