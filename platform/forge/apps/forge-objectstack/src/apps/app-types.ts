import type { NavigationItemInput, ObjectStackDefinitionInput } from '@objectstack/spec';
import type { ForgeApplicationKey } from './settings-migration.js';

type CollectionItem<Collection> =
  Collection extends readonly (infer Item)[]
    ? Item
    : Collection extends Record<string, infer Item>
      ? Item
      : never;

type AppInput = CollectionItem<NonNullable<ObjectStackDefinitionInput['apps']>>;

export type ForgeAppDefinition = {
  name: string;
  label: string;
  icon?: string;
  active?: boolean;
  isDefault?: boolean;
  areas?: NonNullable<AppInput['areas']>;
};

export type ForgeAppArea = NonNullable<AppInput['areas']>[number];
export type ForgeNavigationItem = NavigationItemInput;

export function flattenNavigation(items: ForgeNavigationItem[]): ForgeNavigationItem[] {
  return items.flatMap((item) =>
    item.type === 'group'
      ? flattenNavigation(item.children ?? [])
      : [item],
  );
}

export type ForgeApplicationNavigation = {
  applications: Array<{
    key: ForgeApplicationKey;
    definition: ForgeAppDefinition;
  }>;
};
