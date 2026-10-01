import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [navigationText, settingsPermissions, salesContractPermissions, salesQuotationPermissions, settingsMigration, materialPage, contractPage, salesActions, submissionDomain, materialObject, contractLineHook] = await Promise.all([
  read('../src/apps/application-navigation.json'),
  read('../src/permissions/application-settings.permission.ts'),
  read('../src/permissions/sales-contract.permission.ts'),
  read('../src/permissions/sales-quotation.permission.ts'),
  read('../src/apps/settings-migration.ts'),
  read('../src/pages/material-workspace.page.ts'),
  read('../src/pages/sales-contract-create.page.ts'),
  read('../src/actions/sales.action.ts'),
  read('../src/plugins/contract-material-submission.ts'),
  read('../src/objects/material.object.ts'),
  read('../src/hooks/sales-contract.hook.ts'),
]);
const navigation = JSON.parse(navigationText);

function walk(items, visit) {
  for (const item of items ?? []) {
    visit(item);
    walk(item.children, visit);
  }
}

function navItem(applicationKey, itemId) {
  const application = navigation.applications.find((entry) => entry.key === applicationKey);
  assert.ok(application, `missing ${applicationKey} app navigation`);
  const items = application.definition.areas.flatMap((area) => area.navigation);
  let match;
  walk(items, (item) => {
    if (item.id === itemId) match = item;
  });
  assert.ok(match, `missing navigation item ${applicationKey}/${itemId}`);
  return match;
}

assert.deepEqual(navItem('supply_chain', 'materials').requiredPermissions, ['forge_supply_chain_settings_manage']);
assert.deepEqual(navItem('supply_chain', 'material_settings').requiredPermissions, ['forge_supply_chain_settings_manage']);
assert.deepEqual(navItem('supply_chain', 'material_skus').requiredPermissions, ['forge_supply_chain_settings_manage']);
assert.deepEqual(navItem('sales', 'sales_contracts').requiredPermissions, ['sales_contract_operator']);
assert.equal(navItem('sales', 'sales_pricing').requiredPermissions, undefined, 'sales pricing navigation stays outside this SKU administration change');
assert.ok(settingsPermissions.includes("name: 'forge_supply_chain_settings_manager'"));
assert.ok(settingsPermissions.includes("systemPermissions: ['forge_supply_chain_settings_manage']"));
assert.ok(settingsPermissions.includes('forge_material_sku: orgManage,'), 'only the existing supply-chain manager set owns SKU CRUD');

const operatorBlock = salesContractPermissions.slice(
  salesContractPermissions.indexOf("name: 'sales_contract_operator'"),
  salesContractPermissions.indexOf('export const salesContractReviewerPermission'),
);
assert.match(operatorBlock, /forge_sales_contract:[\s\S]*?readScope: 'own',[\s\S]*?writeScope: 'own'/);
assert.match(operatorBlock, /forge_sales_contract_line:[\s\S]*?readScope: 'own',[\s\S]*?writeScope: 'own'/);
assert.match(operatorBlock, /forge_material_sku: readReferenceData/);
assert.match(operatorBlock, /forge_material: readReferenceData/);
assert.match(operatorBlock, /forge_unit: readOrganizationReferenceData/);
assert.doesNotMatch(operatorBlock, /forge_material_sku:\s*\{\s*allow(Create|Edit|Delete): true/);
assert.doesNotMatch(operatorBlock, /forge_material:\s*\{\s*allow(Create|Edit|Delete): true/);

const quotationBlock = salesQuotationPermissions.slice(
  salesQuotationPermissions.indexOf("name: 'sales_quotation_draft_operator'"),
  salesQuotationPermissions.indexOf('export const salesQuotationAdjustmentPermission'),
);
assert.match(quotationBlock, /forge_material_sku: organizationRead/);
assert.match(quotationBlock, /forge_material: organizationRead/);
assert.doesNotMatch(quotationBlock, /forge_material_sku:\s*\{\s*allow(Create|Edit|Delete): true/);

assert.match(settingsMigration, /id: 'material_skus',[^\n]*permissionSetNames: \['forge_supply_chain_settings_manager', 'sales_contract_operator'\],[^\n]*assignmentState: 'requires_setup_assignment'/);
assert.match(materialPage, /request\('\/auth\/me\/permissions'\)/);
assert.match(materialPage, /canManage=systemPermissions\.includes\('forge_supply_chain_settings_manage'\)&&materialPermissions\.allowCreate===true&&materialPermissions\.allowEdit===true&&materialPermissions\.allowDelete===true/);
assert.match(materialPage, /state\.canManage&&<button[^>]*>新建物料<\/button>/);
assert.ok(materialPage.includes('{state.canManage&&<td><button className="fp-link-button" onClick={()=>openEdit(m)}>编辑</button>'));
assert.ok(materialPage.includes('<button className="fp-link-button" onClick={()=>askDelete(m)}>删除</button></td>}</tr>'));
assert.match(materialObject, /enabled: Field\.boolean\(\{ label: '启用', defaultValue: true \}\)/);

assert.match(contractPage, /selectableSkus=data\.skus\.filter/);
assert.match(contractPage, /item\.enabled!==false/);
assert.match(contractPage, /material\.status!=='inactive'/);
assert.match(contractPage, /unit\.status!=='inactive'/);
assert.match(contractPage, /selectableSkus\.map\(item=>/);
assert.match(contractPage, /sku=selectableSkus\.find\(item=>item\.code===code\)/);
assert.match(contractPage, /selectableSkus\.some\(sku=>sku\.id===line\.sku_id\)/);
assert.match(contractPage, /sourceLines\.some\(item=>item\.line_type==='material'&&\(!item\.sku_id\|\|!selectableSkus\.some\(sku=>sku\.id===item\.sku_id\)\)\)/);
assert.match(contractPage, /line\.line_type==='service'/);
assert.match(contractPage, /未导入任何物料/);
assert.match(contractPage, /bundleLines\.some\(item=>!selectableSkus\.some\(sku=>sku\.id===item\.sku_id\)\)/);

const contractSubmit = salesActions.slice(
  salesActions.indexOf('export const ContractSubmit = defineAction'),
  salesActions.indexOf('export const ContractSubmitMaterialPackage'),
);
const contractPackageSubmit = salesActions.slice(
  salesActions.indexOf('export const ContractSubmitMaterialPackage = defineAction'),
  salesActions.indexOf('export const ContractRegisterSignature'),
);
const contractDraftCreate = salesActions.slice(
  salesActions.indexOf("export const SalesContractDraftCreate = defineAction"),
  salesActions.indexOf('export const ContractSubmit = defineAction'),
);
assert.match(contractDraftCreate, /const contract = await ctx\.api\.object\('forge_sales_contract'\)\.insert\([\s\S]*?owner_id: actor,[\s\S]*?responsible_id: actor/);
assert.match(contractSubmit, /visible: false/);
assert.match(contractSubmit, /target: CONTRACT_SUBMISSION_RECEIPT_TARGET/);
assert.match(contractPackageSubmit, /name: 'contract_submit_material_package'/);
assert.match(contractPackageSubmit, /requiredPermissions: \['sales_contract_operator'\]/);
assert.match(contractPackageSubmit, /name: 'primary_file_id',[\s\S]*?type: 'file', required: true/);
assert.match(contractPackageSubmit, /name: 'material_file_ids',[\s\S]*?type: 'file', multiple: true, required: true/);
assert.match(contractPackageSubmit, /target: CONTRACT_MATERIAL_SUBMISSION_TARGET/);
assert.match(submissionDomain, /context\.recordLoadDenied === true/);
assert.match(submissionDomain, /actorId !== sessionActorId/);
assert.match(submissionDomain, /record\.responsible_id !== actorId/);
assert.match(submissionDomain, /record\.organization_id !== organizationId/);
assert.match(submissionDomain, /sku\.enabled === false/);
assert.match(submissionDomain, /material\.status === 'inactive'/);
assert.match(submissionDomain, /unit\.status === 'inactive'/);
assert.match(submissionDomain, /line\.line_type === 'service'[\s\S]*?服务明细必须有名称和数量/);
assert.match(contractLineHook, /lineType === 'service'[\s\S]*?服务项目不能关联物料规格[\s\S]*?if \(lineType !== 'material'\)/);

console.log('PASS sales contract navigation, own-record scope, SKU read/write boundary, and availability guards');
