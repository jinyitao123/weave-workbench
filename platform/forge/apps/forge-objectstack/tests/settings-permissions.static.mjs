import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const nav = JSON.parse(await readFile(new URL('../src/apps/application-navigation.json', import.meta.url), 'utf8'));
const permissions = await readFile(new URL('../src/permissions/application-settings.permission.ts', import.meta.url), 'utf8');
const salesPermissions = await readFile(new URL('../src/permissions/sales-contract.permission.ts', import.meta.url), 'utf8');
const settingsObjects = await readFile(new URL('../src/objects/business-setting.object.ts', import.meta.url), 'utf8');
const salesObjects = await readFile(new URL('../src/objects/sales.object.ts', import.meta.url), 'utf8');
const pageOwnership = await readFile(new URL('../src/apps/page-ownership.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../src/apps/settings-migration.ts', import.meta.url), 'utf8');
const reportSettingsObject = await readFile(new URL('../src/objects/report-settings.object.ts', import.meta.url), 'utf8');
const reportConsumer = await readFile(new URL('../src/pages/management-profit-report.page.ts', import.meta.url), 'utf8');

const settingsGroups = {
  supply_chain: ['material_settings', 'inventory_settings'],
  sales: ['customer_settings', 'sales_contract_settings'],
  production: ['drawing_settings', 'production_settings', 'subcontract_settings'],
  project: ['project_business_settings'],
  administration: ['administration_settings', 'other_settings', 'hr_settings'],
  finance: ['settlement_condition_settings', 'finance_settings'],
  reports: [],
};
const managerCapabilities = {
  supply_chain: 'forge_supply_chain_settings_manage',
  sales: 'forge_sales_settings_manage',
  production: 'forge_production_settings_manage',
  project: 'forge_project_settings_manage',
  administration: 'forge_administration_settings_manage',
  finance: 'forge_finance_settings_manage',
};

function walk(items, visit) {
  for (const item of items ?? []) {
    visit(item);
    walk(item.children, visit);
  }
}

for (const application of nav.applications) {
  const key = application.key;
  const items = application.definition.areas.flatMap((area) => area.navigation);
  const byId = new Map();
  walk(items, (item) => {
    const entries = byId.get(item.id) ?? [];
    entries.push(item);
    byId.set(item.id, entries);
  });
  for (const groupId of settingsGroups[key] ?? []) {
    assert.ok(byId.get(groupId)?.some((item) => item.type === 'group' && item.requiredPermissions?.includes(managerCapabilities[key])), `${key}/${groupId} must be hidden without its exact settings capability`);
  }
  assert.ok(byId.get('document_printing')?.some((item) => item.type === 'group' && item.requiredPermissions?.includes('forge_print_settings_manage')), `${key} printing settings must use the shared print capability`);
}

const dictionaryGrantSets = [
  ['forge_material_category', 'forge_supply_chain_reference_reader'],
  ['forge_supplier_category', 'forge_supply_chain_reference_reader'],
  ['forge_supplier_level', 'forge_supply_chain_reference_reader'],
  ['forge_customer_category', 'sales_contract_operator'],
  ['forge_customer_level', 'sales_contract_operator'],
  ['forge_payment_condition', 'forge_production_reference_reader'],
  ['forge_quotation_type', 'sales_contract_operator'],
  ['forge_quotation_issuer', 'sales_contract_operator'],
  ['forge_warehouse_type', 'forge_supply_chain_reference_reader'],
];
for (const [objectName, permissionSetName] of dictionaryGrantSets) {
  assert.ok(permissions.includes(`    ${objectName}: orgRead,`) || salesPermissions.includes(`    ${objectName}: readOrganizationReferenceData,`), `${objectName} must have a named, organization-scoped read set`);
  assert.ok(permissions.includes(`name: '${permissionSetName}'`) || salesPermissions.includes(`name: '${permissionSetName}'`), `${permissionSetName} must be registered as the reader`);
}
assert.ok(permissions.includes('forge_unit: orgRead,'), 'unit read remains limited to the supply-chain reference set');
assert.ok(permissions.includes('forge_payment_condition: orgRead,'), 'production reads finance-owned payment conditions through an explicit read-only set');
assert.equal(settingsObjects.match(/sharingModel: 'private'/g)?.length, 4, 'all four maintenance-only shared settings objects require an explicit permission set');

const scopedStore = permissions.slice(permissions.indexOf('function scopedSettingsManager'), permissions.indexOf('export const supplyChainReferenceReaderPermission'));
assert.ok(scopedStore.includes('using: `scope =='), 'shared business settings reads must be filtered by app scope');
assert.ok(scopedStore.includes('check: `scope =='), 'shared business settings writes must be filtered by app scope');
assert.ok(!scopedStore.includes('viewAllRecords') && !scopedStore.includes('modifyAllRecords'), 'app settings must not bypass row-level scope');
for (const capability of Object.values(managerCapabilities)) assert.ok(permissions.includes(capability));

const followUpBlock = permissions.slice(permissions.indexOf('export const salesCustomerFollowUpOperatorPermission'), permissions.indexOf('export const productionSettingsManagerPermission'));
assert.ok(salesObjects.includes("customer_id: reference('forge_customer', '客户')"), 'sales follow-up must be a real customer-related record');
assert.ok(followUpBlock.includes('forge_sales_follow_up: {') && followUpBlock.includes('allowCreate: true') && followUpBlock.includes("readScope: 'own'"), 'the customer-related follow-up grant must only create/read the caller-owned child records');
assert.ok(!followUpBlock.includes('forge_contact:') && !followUpBlock.includes('forge_accounts_receivable:') && !followUpBlock.includes('forge_bom:'), 'no other customer related-list child gains create permission');
assert.ok(!followUpBlock.includes('forge_customer: orgManage'), 'the follow-up grant cannot create or edit customer master records');

assert.ok(pageOwnership.includes("page_onboarding_center: 'initialization guidance belongs to native Setup'"));
assert.ok(!nav.applications.some((application) => JSON.stringify(application.definition).includes('page_company_entities')),
  'the retired onboarding destination must not appear in any registered app navigation');

const reportApplication = nav.applications.find((application) => application.key === 'reports');
const reportTemplateNav = reportApplication.definition.areas.flatMap((area) => area.navigation).flatMap((item) => item.children ?? []).find((item) => item.id === 'report_templates');
assert.equal(reportTemplateNav?.type, 'object');
assert.equal(reportTemplateNav?.objectName, 'forge_report_template');
assert.deepEqual(reportTemplateNav?.requiredPermissions, ['forge_reports_settings_manage']);
assert.ok(reportSettingsObject.includes("name: 'forge_report_template'"));
assert.ok(reportSettingsObject.includes("fields: ['report_key'], unique: 'organization'"), 'one organization-owned default template per supported report');
assert.ok(reportSettingsObject.includes('default_period') && reportSettingsObject.includes('default_dimension') && reportSettingsObject.includes('default_currency') && reportSettingsObject.includes('default_amount_unit'));
assert.ok(reportConsumer.includes("'forge_report_template'"), 'management profit report must read the persisted default template');
for (const field of ['default_period', 'default_dimension', 'default_compare_basis', 'default_currency', 'default_amount_unit']) {
  assert.ok(reportConsumer.includes(`template.${field}`), `report must apply ${field} to its initial query controls`);
}
assert.ok(!reportSettingsObject.includes('forge_management_profit_report_version'), 'template settings must not duplicate report output snapshots');

const consumerRequirements = [...migration.matchAll(/\{\s*objectName: '([^']+)', owningApplication: '([^']+)', recordScope: 'org',\s*permissionSetNames: \[([^\]]*)\],\s*consumers: \[([^\]]*)\],\s*\}/gs)].map((match) => ({
  objectName: match[1],
  application: match[2],
  permissionSetNames: [...match[3].matchAll(/'([^']+)'/g)].map((entry) => entry[1]),
  consumers: [...match[4].matchAll(/'([^']+)'/g)].map((entry) => entry[1]),
}));
assert.ok(consumerRequirements.length >= 18, 'the source must document the actual settings consumer read paths');
assert.ok(permissions.includes("const orgRead = {\n  allowRead: true,\n  readScope: 'org'"));
assert.ok(permissions.includes("const orgManage = {\n  allowCreate: true,\n  allowRead: true"));
assert.ok(salesPermissions.includes("const readOrganizationReferenceData = {\n  allowRead: true,\n  readScope: 'org'"));
for (const requirement of consumerRequirements) {
  assert.ok(requirement.permissionSetNames.length > 0, `${requirement.objectName} has no declared reader set`);
  assert.ok(requirement.consumers.length > 0, `${requirement.objectName} has no recorded consumer`);
  for (const consumer of requirement.consumers) {
    await readFile(new URL('../' + consumer, import.meta.url), 'utf8');
  }
  for (const permissionSetName of requirement.permissionSetNames) {
    let matched = false;
    for (const source of [permissions, salesPermissions]) {
      const marker = `name: '${permissionSetName}'`;
      const start = source.indexOf(marker);
      if (start < 0) continue;
      const end = source.indexOf('});', start);
      const block = source.slice(start, end < 0 ? undefined : end);
      if (new RegExp(`${requirement.objectName}:\\s*(?:orgRead|orgManage|readOrganizationReferenceData)`).test(block)) {
        matched = true;
        break;
      }
    }
    assert.ok(matched, `${permissionSetName} must explicitly read ${requirement.objectName} for ${requirement.application}`);
  }
}

console.log('Settings access is app-scoped; reader sets, report defaults, customer follow-up creation, and retired onboarding navigation are covered.');
