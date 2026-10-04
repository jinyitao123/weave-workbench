import applicationNavigation from './application-navigation.json';
import { flattenNavigation, type ForgeApplicationNavigation, type ForgeNavigationItem } from './app-types.js';
import type { ForgeApplicationKey } from './settings-migration.js';

const navigation = applicationNavigation as ForgeApplicationNavigation;

if (navigation.applications.length !== 7) {
  throw new Error('Forge must register exactly seven business App definitions');
}

const applicationEntries = navigation.applications;
const applicationKeys = applicationEntries.map((entry) => entry.key);
const applicationNames = applicationEntries.map((entry) => entry.definition.name);
if (new Set(applicationKeys).size !== 7) throw new Error('Forge application keys must be unique');
if (new Set(applicationNames).size !== 7) throw new Error('Forge App names must be unique');

export const forgeApplicationDefinitions = Object.fromEntries(
  applicationEntries.map(({ key, definition }) => [key, definition]),
) as Record<ForgeApplicationKey, ForgeApplicationNavigation['applications'][number]['definition']>;

export function flattenApplicationNavigation() {
  return applicationEntries.flatMap(({ key: application, definition }) =>
    (definition.areas ?? []).flatMap((area) =>
      flattenNavigation(area.navigation ?? []).flatMap((item: ForgeNavigationItem) => {
        if (!item.id || item.type === 'separator') return [];
        return [{
          application,
          appName: definition.name,
          areaId: area.id,
          id: item.id,
          label: 'label' in item ? item.label : undefined,
          type: item.type,
          target: item.type === 'page'
            ? item.pageName
            : item.type === 'object'
              ? item.objectName
              : item.type === 'url'
                ? item.url
                : undefined,
        }];
      }),
    ),
  );
}

export { flattenNavigation };
