import { defineForgeApplicationPackage } from '../package.js';
import {
  supplyChainReferenceReaderPermission,
  supplyChainSettingsManagerPermission,
} from '../../permissions/application-settings.permission.js';

export const supplyChainApplication = defineForgeApplicationPackage('supply_chain', [
  supplyChainReferenceReaderPermission,
  supplyChainSettingsManagerPermission,
]);
