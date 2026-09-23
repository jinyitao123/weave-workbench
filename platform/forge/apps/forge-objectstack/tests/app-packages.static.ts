import assert from 'node:assert/strict';
import hostConfig from '../objectstack.config.js';
import { sharedForgeCoreBundle } from '../src/apps/shared-core.js';
import { forgeApplicationPackages } from '../src/apps/index.js';
import {
  flattenApplicationNavigation,
  flattenNavigation,
  forgeApplicationDefinitions,
} from '../src/apps/navigation.js';
import {
  forgePageDefinitionCount,
  forgePageNamesByApplication,
  forgePageOwnerByName,
  forgeSourcePageDefinitionCount,
  excludedPageDefinitions,
} from '../src/apps/page-ownership.js';
import {
  applicationSettingAdditions,
  settingConsumerReadRequirements,
  settingMigrations,
  workspaceNavigationMigrations,
  type ForgeApplicationKey,
} from '../src/apps/settings-migration.js';
import navigationBaseline from './fixtures/forge-app-navigation.baseline.json';

function values<T>(collection: unknown): T[] {
  if (Array.isArray(collection)) return collection as T[];
  if (collection && typeof collection === 'object') return Object.values(collection) as T[];
  return [];
}

const expectedBusinessApps = [
  'supply_chain',
  'sales',
  'production',
  'project',
  'administration',
  'finance',
  'reports',
] as const;

assert.equal(
  navigationBaseline.sourceCommit,
  '8200b958397a5dee63f1b98cda73db2a851f1b3b',
  'the migration source must stay pinned to the reviewed legacy package',
);
assert.equal(settingMigrations.length, 27);
assert.equal(forgeApplicationPackages.length, expectedBusinessApps.length);
assert.equal(hostConfig.manifest, undefined, 'the top-level host config must not become a visible Forge App');
assert.equal(values(hostConfig.objects).length, 0, 'the host config must not duplicate shared objects');
assert.equal(values(hostConfig.apps).length, 0);
assert.equal(values(hostConfig.pages).length, 0);
assert.equal(values(hostConfig.actions).length, 0, 'the host config must not duplicate shared Actions');
const registeredAppBundles = values<{ bundle?: { manifest?: { id?: string; type?: string }; apps?: unknown[]; pages?: unknown[] } }>(hostConfig.plugins)
  .map((plugin) => plugin.bundle)
  .filter((bundle): bundle is NonNullable<typeof bundle> => Boolean(bundle?.manifest));
const coreBundle = registeredAppBundles.find((bundle) => bundle.manifest?.id === 'forge');
assert.equal(coreBundle?.manifest?.type, 'plugin');
assert.equal(values(coreBundle?.apps).length, 0, 'the shared capability bundle must not expose an eighth App');
assert.equal(values(coreBundle?.pages).length, 0, 'the shared capability bundle must not register unused Pages');
assert.equal(
  registeredAppBundles.filter((bundle) => bundle.manifest?.type === 'app').length,
  expectedBusinessApps.length,
);
assert.equal(sharedForgeCoreBundle.manifest?.id, 'forge');
assert.equal(sharedForgeCoreBundle.manifest?.type, 'plugin');
assert.equal(
  values<{ name: string }>(coreBundle?.objects).filter((object) => object.name === 'forge_report_template').length,
  1,
  'the shared forge package must be the unique owner of the report template object',
);

const packageByKey = new Map(
  forgeApplicationPackages.map((applicationPackage) => [applicationPackage.key, applicationPackage]),
);
const permissionSetsByName = new Map(
  registeredAppBundles.flatMap((bundle) =>
    values<{ name: string; objects?: Record<string, { allowRead?: boolean; readScope?: string }> }>(bundle.permissions)
      .map((permission) => [permission.name, permission] as const),
  ),
);
assert.deepEqual(
  [...packageByKey.keys()].sort(),
  [...expectedBusinessApps].sort(),
  'the runtime composition must register the seven business AppPlugins',
);

const packageIds = new Set<string>();
const packageNamespaces = new Set<string>();
const businessPageNames = new Set<string>();
for (const application of expectedBusinessApps) {
  const applicationPackage = packageByKey.get(application);
  assert.ok(applicationPackage, 'missing package ' + application);
  const { stack, plugin } = applicationPackage;

  assert.equal(stack.manifest?.type, 'app');
  assert.ok(stack.manifest?.id);
  assert.ok(stack.manifest?.namespace);
  assert.equal(packageIds.has(stack.manifest.id), false, 'duplicate package id ' + stack.manifest.id);
  assert.equal(packageNamespaces.has(stack.manifest.namespace), false, 'duplicate package namespace ' + stack.manifest.namespace);
  packageIds.add(stack.manifest.id);
  packageNamespaces.add(stack.manifest.namespace);
  assert.equal(values(stack.apps).length, 1, application + ' must contain exactly one App');
  assert.equal(plugin.name, 'plugin.app.' + stack.manifest.id);
  const landingItem = forgeApplicationDefinitions[application].areas?.[0]?.navigation?.[0];
  assert.equal(landingItem?.type, 'page', application + ' must lead with its role-relevant landing Page');
  if (landingItem?.type === 'page') {
    assert.equal(forgePageOwnerByName[landingItem.pageName], application);
  }

  assert.equal(values(stack.objects).length, 0, application + ' must reference the existing forge objects');
  assert.equal(values(stack.data).length, 0, application + ' must not copy business records or seeds');
  assert.equal(values(stack.actions).length, 0, application + ' must use actions registered by forge');
  assert.equal(values(stack.hooks).length, 0, application + ' must use hooks registered by forge');
  assert.equal(values(stack.flows).length, 0, application + ' must use flows registered by forge');

  for (const page of values<{ name: string }>(stack.pages)) {
    assert.equal(businessPageNames.has(page.name), false, 'duplicate business Page owner ' + page.name);
    businessPageNames.add(page.name);
    assert.equal(forgePageOwnerByName[page.name], application, 'wrong Page owner for ' + page.name);
  }
}

for (const requirement of settingConsumerReadRequirements) {
  assert.ok(requirement.consumers.length > 0, requirement.objectName + ' must identify real read consumers');
  for (const permissionSetName of requirement.permissionSetNames) {
    const permissionSet = permissionSetsByName.get(permissionSetName);
    assert.ok(permissionSet, permissionSetName + ' must be registered in a runtime bundle');
    const grant = permissionSet.objects?.[requirement.objectName];
    assert.equal(grant?.allowRead, true, permissionSetName + ' must explicitly read ' + requirement.objectName);
    assert.equal(grant?.readScope, requirement.recordScope, permissionSetName + ' must keep ' + requirement.objectName + ' within ' + requirement.recordScope);
  }
}
assert.equal(applicationSettingAdditions.length, 1);
assert.equal(applicationSettingAdditions[0].id, 'report_templates');
assert.deepEqual(applicationSettingAdditions[0].targetApplications, ['reports']);

assert.equal(
  businessPageNames.size,
  forgePageDefinitionCount,
  'the seven business packages must register each active Page exactly once',
);
for (const application of expectedBusinessApps) {
  const pageNames = forgePageNamesByApplication[application];
  for (const pageName of pageNames) assert.ok(businessPageNames.has(pageName));
}

assert.equal(
  forgeSourcePageDefinitionCount - forgePageDefinitionCount,
  Object.keys(excludedPageDefinitions).length,
  'every unregistered source Page needs one explicit disposition',
);

const oldLeaves = navigationBaseline.leaves;
const newLeaves = flattenApplicationNavigation();
const settingById = new Map(settingMigrations.map((setting) => [setting.id, setting]));
const workspaceMigrationById = new Map(workspaceNavigationMigrations.map((migration) => [migration.id, migration]));
const sourceAreaOwner: Record<string, ForgeApplicationKey> = {
  supply_chain: 'supply_chain',
  sales: 'sales',
  production: 'production',
  project: 'project',
  administration: 'administration',
  finance: 'finance',
  reports: 'reports',
};

for (const leaf of oldLeaves) {
  if (leaf.areaId === 'workspace') {
    const migration = workspaceMigrationById.get(leaf.id);
    assert.ok(migration, 'shared work entry ' + leaf.id + ' needs an explicit native destination');
    assert.equal(migration.nativeTarget.route, null, 'do not invent a UI path for a native destination');
    assert.equal(
      newLeaves.some((entry) => entry.id === leaf.id),
      false,
      'shared employee work entry ' + leaf.id + ' must stay outside Forge business apps',
    );
    continue;
  }
  if (leaf.areaId === 'business_settings') {
    const migration = settingById.get(leaf.id);
    assert.ok(migration, 'business setting ' + leaf.id + ' needs an explicit disposition');
    if (migration.resolution === 'moved') {
      assert.ok(migration.targetApplications.length > 0, leaf.id + ' has no application owner');
      for (const application of migration.targetApplications) {
        const moved = newLeaves.find((entry) => entry.application === application && entry.id === leaf.id);
        assert.ok(moved, leaf.id + ' was dropped from ' + application);
        assert.equal(moved.target, leaf.target, leaf.id + ' changed its native target');
      }
    } else {
      assert.equal(migration.targetApplications.length, 0);
      assert.equal(
        newLeaves.some((entry) => entry.id === leaf.id),
        false,
        leaf.id + ' is deferred and must not render as a usable business setting',
      );
    }
    continue;
  }

  const application = sourceAreaOwner[leaf.areaId];
  assert.ok(application, 'unmapped source area ' + leaf.areaId);
  const moved = newLeaves.find((entry) => entry.application === application && entry.id === leaf.id);
  assert.ok(moved, 'navigation entry ' + leaf.id + ' was dropped from ' + application);
  assert.equal(moved.target, leaf.target, 'navigation entry ' + leaf.id + ' changed its target');
}

for (const application of expectedBusinessApps) {
  const itemIds = newLeaves.filter((entry) => entry.application === application).map((entry) => entry.id);
  assert.equal(new Set(itemIds).size, itemIds.length, application + ' has duplicate navigation ids');
}

const rootObjects = values<{ name: string }>(sharedForgeCoreBundle.objects);
const rootObjectNames = new Set(rootObjects.map((object) => object.name));
assert.equal(rootObjectNames.size, rootObjects.length, 'the forge package must register each business object once');
const rootActions = values<{ objectName?: string; name: string }>(sharedForgeCoreBundle.actions);
const rootActionKeys = rootActions.map((action) => (action.objectName ?? '') + '.' + action.name);
assert.equal(new Set(rootActionKeys).size, rootActionKeys.length, 'the forge package must register each Action once');
const rootSeedObjects = values<{ object: string }>(sharedForgeCoreBundle.data).map((seed) => seed.object);
assert.equal(new Set(rootSeedObjects).size, rootSeedObjects.length, 'the forge package must seed each object once');
for (const entry of newLeaves.filter((item) => item.type === 'object')) {
  assert.ok(rootObjectNames.has(entry.target), 'cross-package object link ' + entry.id + ' has no canonical object');
}

const salesPackage = packageByKey.get('sales')!;
const salesPages = values<{ name: string; source?: string }>(salesPackage.stack.pages);
const salesPageNames = new Set(salesPages.map((page) => page.name));
assert.ok(salesPageNames.has('page_sales_contract_workspace'));
assert.ok(salesPageNames.has('page_sales_contract_create'));
const salesContractPage = salesPages.find((page) => page.name === 'page_sales_contract_create');
assert.ok(salesContractPage?.source?.includes('/actions/forge_sales_contract/contract_submit/'));
assert.ok(rootActions.some(
  (action) => action.objectName === 'forge_sales_contract' && action.name === 'contract_submit',
), 'the sales Page must resolve its Action from the canonical forge package');

const salesPermissionSets = values<{
  name: string;
  objects?: Record<string, { allowRead?: boolean; viewAllRecords?: boolean; allowCreate?: boolean; allowEdit?: boolean }>;
}>(salesPackage.stack.permissions);
assert.deepEqual(
  salesPermissionSets.map((permission) => permission.name).sort(),
  ['sales_contract_operator', 'sales_contract_reviewer'],
);
const originalSettingsLeaves = oldLeaves.filter((leaf) => leaf.sourceArea === 'business_settings');
for (const migration of settingMigrations.filter((setting) => setting.accessFinding)) {
  const original = originalSettingsLeaves.find((item) => item.id === migration.id);
  assert.equal(original?.type, 'object', migration.id + ' access status must identify an object setting');
  if (original?.type !== 'object' || typeof original.target !== 'string') continue;
  const declaredReadGrants = salesPermissionSets.filter((permission) => {
    const grant = permission.objects?.[original.target];
    return grant?.allowRead || grant?.viewAllRecords;
  });
  if (migration.accessFinding === 'no_declared_read_grant') {
    assert.equal(declaredReadGrants.length, 0, original.target + ' must not receive an invented read grant');
  } else {
    assert.ok(declaredReadGrants.length > 0, original.target + ' should retain only its existing sales-set grants');
  }
}
assert.deepEqual(
  values<{ name: string }>(sharedForgeCoreBundle.permissions).map((permission) => permission.name),
  ['weave_team_developer'],
);
for (const migration of settingMigrations.filter((setting) => setting.accessFinding)) {
  assert.ok(migration.label);
  assert.ok(migration.targetApplications.length > 0);
}
for (const migration of settingMigrations.filter((setting) => setting.resolution === 'native_setup')) {
  assert.equal(migration.nativeTarget?.appName, 'setup');
  assert.equal(migration.nativeTarget?.route, null);
}

console.log(JSON.stringify({
  result: 'pass',
  runtimeAppPlugins: forgeApplicationPackages.length,
  businessPageOwners: businessPageNames.size,
  unregisteredPages: Object.keys(excludedPageDefinitions),
  sourceNavigationLeaves: oldLeaves.length,
  targetNavigationLeaves: newLeaves.length,
  workspaceDestinations: workspaceNavigationMigrations.map((migration) => ({
    id: migration.id,
    surface: migration.nativeTarget.surface,
    capability: migration.nativeTarget.capability,
  })),
  settingDispositions: settingMigrations.reduce<Record<string, number>>((counts, setting) => {
    counts[setting.resolution] = (counts[setting.resolution] ?? 0) + 1;
    return counts;
  }, {}),
  crossPackageAction: 'forge_sales_contract.contract_submit',
}));
