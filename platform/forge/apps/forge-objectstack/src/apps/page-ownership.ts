import * as pageExports from '../pages/index.js';
import { flattenApplicationNavigation, forgeApplicationDefinitions } from './navigation.js';
import type { ForgeApplicationKey } from './settings-migration.js';

type PageExport = (typeof pageExports)[keyof typeof pageExports];
type PageDefinition = Extract<PageExport, { name: string }>;

const unlinkedPageOwners: Record<string, ForgeApplicationKey> = {
  page_production_data_tasks: 'production',
  page_sales_order_create: 'sales',
  page_sales_contract_create: 'sales',
  page_counterparty_reconciliation: 'finance',
  page_project_plan_workspace: 'project',
  page_project_plan_risemap: 'project',
  page_subcontract_orders: 'production',
  page_subcontract_ncr_workspace: 'production',
};

const sharedPageOwners: Record<string, ForgeApplicationKey> = {
  // The shared print editor is registered once. Each business app links to
  // that definition while retaining its own settings navigation entry.
  page_print_business_config: 'finance',
};

const sourcePages = Object.values(pageExports).filter(
  (value): value is PageDefinition =>
    Boolean(value)
    && typeof value === 'object'
    && typeof (value as PageDefinition).name === 'string',
);

/**
 * These four shared-workspace pages, seven gap placeholders and three
 * recovery diagnostics have no active business navigation or internal Page consumer.
 * Their destinations or retirement reasons are recorded here; none is
 * registered in the Runtime.
 */
export const excludedPageDefinitions: Record<string, string> = {
  page_workbench: 'shared employee entry now belongs to GooeyPi',
  page_workspace_ai: 'AI assistant entry now belongs to GooeyPi',
  page_onboarding_center: 'initialization guidance belongs to native Setup',
  page_todo_management: 'personal work belongs to GooeyPi and the native inbox',
  page_workspace_recovery_status: 'old shared-workspace diagnostic with no business application target',
  page_administration_recovery_status: 'recovery diagnostic has no navigation or internal consumer',
  page_subcontract_reconciliation_recovery_status: 'recovery diagnostic has no navigation or internal consumer',
  page_administration_gap: 'gap placeholder has no navigation or business consumer',
  page_finance_gap: 'gap placeholder has no navigation or business consumer',
  page_production_gap: 'gap placeholder has no navigation or business consumer',
  page_reports_gap: 'gap placeholder has no navigation or business consumer',
  page_sales_gap: 'gap placeholder has no navigation or business consumer',
  page_supply_chain_gap: 'gap placeholder has no navigation or business consumer',
  page_system_gap: 'former settings placeholder; no active application navigation target',
};

const excludedPageNames = new Set(Object.keys(excludedPageDefinitions));
const pages = sourcePages.filter((page) => !excludedPageNames.has(page.name));

const pagesByName = new Map<string, PageDefinition>();
for (const page of pages) {
  if (pagesByName.has(page.name)) throw new Error('Duplicate Page definition: ' + page.name);
  pagesByName.set(page.name, page);
}

const referencesByPage = new Map<string, Set<ForgeApplicationKey>>();
for (const entry of flattenApplicationNavigation()) {
  if (entry.type !== 'page' || typeof entry.target !== 'string') continue;
  const owners = referencesByPage.get(entry.target) ?? new Set<ForgeApplicationKey>();
  owners.add(entry.application);
  referencesByPage.set(entry.target, owners);
}

for (const pageName of excludedPageNames) {
  if (!sourcePages.some((page) => page.name === pageName)) {
    throw new Error('Excluded Page definition is missing from source: ' + pageName);
  }
  if (referencesByPage.has(pageName)) {
    throw new Error('Excluded Page is still used by app navigation: ' + pageName);
  }
}

const pageOwnerByName = new Map<string, ForgeApplicationKey>();
for (const page of pages) {
  const references = [...(referencesByPage.get(page.name) ?? [])];
  const owner = references.length === 1
    ? references[0]
    : references.length > 1
      ? sharedPageOwners[page.name]
      : unlinkedPageOwners[page.name];
  if (!owner) throw new Error('Page has no explicit app owner: ' + page.name);
  pageOwnerByName.set(page.name, owner);
}

for (const [pageName] of referencesByPage) {
  if (!pagesByName.has(pageName)) throw new Error('Navigation references an unregistered Page: ' + pageName);
}

export const forgePageOwnerByName = Object.fromEntries(pageOwnerByName);

export const forgePageNamesByApplication: Record<ForgeApplicationKey, string[]> =
  Object.fromEntries(
    (Object.keys(forgeApplicationDefinitions) as ForgeApplicationKey[]).map((application) => [
      application,
      pages.filter((page) => pageOwnerByName.get(page.name) === application).map((page) => page.name).sort(),
    ]),
  ) as Record<ForgeApplicationKey, string[]>;

export function pagesForApplication(application: ForgeApplicationKey): PageDefinition[] {
  return pages.filter((page) => pageOwnerByName.get(page.name) === application);
}

export const forgePageDefinitionCount = pages.length;
export const forgeSourcePageDefinitionCount = sourcePages.length;
