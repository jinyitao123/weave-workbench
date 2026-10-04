import { defineStack } from '@objectstack/spec';
import { AppPlugin } from '@objectstack/runtime';
import * as objects from '../objects/index.js';
import * as actions from '../actions/index.js';
import * as hooks from '../hooks/index.js';
import * as seedData from '../data/index.js';
import * as flows from '../flows/index.js';
import { documentPrintingSettingsManagerPermission } from '../permissions/application-settings.permission.js';
import { weaveTeamDeveloperPermission } from '../permissions/team-development.permission.js';

/**
 * The original forge package remains the single owner of business metadata
 * and seed records. It has no visible App or Page; the seven AppPlugins link
 * to these canonical objects and Actions through the same Runtime.
 */
export const sharedForgeCoreBundle = defineStack({
  manifest: {
    id: 'forge',
    namespace: 'forge',
    version: '0.1.0',
    type: 'plugin',
    name: 'Forge Shared Business Core',
    engines: { protocol: '>=17.3.0 <18' },
  },
  requires: ['automation', 'triggers', 'queue', 'approvals', 'messaging'],
  apps: [],
  pages: [],
  objects: Object.values(objects),
  data: Object.values(seedData),
  actions: Object.values(actions),
  hooks: Object.values(hooks),
  flows: Object.values(flows),
  permissions: [weaveTeamDeveloperPermission, documentPrintingSettingsManagerPermission],
});

export const sharedForgeCorePlugin = new AppPlugin(sharedForgeCoreBundle);
