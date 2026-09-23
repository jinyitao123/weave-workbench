import { defineStack, ObjectStackDefinitionSchema } from '@objectstack/spec';
import { AppPlugin } from '@objectstack/runtime';
import { forgeApplicationDefinitions } from './navigation.js';
import { pagesForApplication } from './page-ownership.js';
import type { ForgeApplicationKey } from './settings-migration.js';

const packageIdentity: Record<ForgeApplicationKey, {
  id: string;
  namespace: string;
  name: string;
}> = {
  supply_chain: {
    id: 'com.inoforge.forge.supply-chain',
    namespace: 'forge_supply_chain',
    name: 'Forge 供应链',
  },
  sales: {
    id: 'com.inoforge.forge.sales',
    namespace: 'forge_sales',
    name: 'Forge 销售',
  },
  production: {
    id: 'com.inoforge.forge.production',
    namespace: 'forge_production',
    name: 'Forge 生产',
  },
  project: {
    id: 'com.inoforge.forge.project',
    namespace: 'forge_project',
    name: 'Forge 项目',
  },
  administration: {
    id: 'com.inoforge.forge.administration',
    namespace: 'forge_administration',
    name: 'Forge 行政',
  },
  finance: {
    id: 'com.inoforge.forge.finance',
    namespace: 'forge_finance',
    name: 'Forge 财务',
  },
  reports: {
    id: 'com.inoforge.forge.reports',
    namespace: 'forge_reports',
    name: 'Forge 报表',
  },
};

export type ForgeApplicationPackage = ReturnType<typeof defineStack>;

/**
 * Each package registers its own App and Page definitions. Canonical business
 * objects, data, Actions and Flows stay in the existing forge package. The
 * app navigation therefore contains deliberate cross-package object/Page
 * references, which the composed CLI artifact validates as a whole.
 */
export function defineForgeApplicationPackage(
  application: ForgeApplicationKey,
  permissions: any[] = [],
) {
  const identity = packageIdentity[application];
  const app = forgeApplicationDefinitions[application];
  const input = {
    manifest: {
      id: identity.id,
      namespace: identity.namespace,
      version: '0.1.0',
      type: 'app' as const,
      name: identity.name,
      engines: { protocol: '>=17.3.0 <18' },
    },
    apps: [app],
    pages: pagesForApplication(application),
    permissions,
  };

  if (input.apps.length !== 1) throw new Error('An application package must register exactly one App');

  // defineStack's strict cross-reference pass is package-local. The canonical
  // object definitions and some shared Page references are in sibling
  // AppPlugins, so validate the package schema here and let the official CLI
  // validate the complete composed package set.
  const normalized = defineStack(input, { strict: false });
  const packageStack = ObjectStackDefinitionSchema.parse(normalized);

  return {
    key: application,
    stack: packageStack,
    plugin: new AppPlugin(packageStack),
  };
}
