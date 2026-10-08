import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [page, action, permission, contractPermission, object] = await Promise.all([
  readFile(path.join(appDir, 'src/pages/sales-crm-service-pages.page.ts'), 'utf8'),
  readFile(path.join(appDir, 'src/actions/sales.action.ts'), 'utf8'),
  readFile(path.join(appDir, 'src/permissions/sales-quotation.permission.ts'), 'utf8'),
  readFile(path.join(appDir, 'src/permissions/sales-contract.permission.ts'), 'utf8'),
  readFile(path.join(appDir, 'src/objects/sales.object.ts'), 'utf8'),
]);
assert.match(page, /SalesQuotationsPage = \{[^\n]+source:salesQuotationsSource/);
assert.match(page, /onClick=\{openCreate\}>新建报价<\/button>/, 'The sales quote entry must be a working create button');
assert.match(page, /ForgeDateInput aria-label="报价日期"/);
assert.match(page, /ForgeDateInput aria-label="有效期至"/);
assert.match(page, /ForgeReadAllRecords\(adapter,'forge_sales_opportunity',\{label:'来源商机',fields:\['id','name','customer_id','owner_id','responsible_id'\]\}\)/, 'The picker must use authenticated, complete server paging for opportunities');
assert.match(page, /\[403,404\]\.includes\(error\?\.status\)/, 'An unreadable source collection must not block direct quotation entry');
assert.match(page, /x\.customer_id===form\?\.customer_id&&x\.owner_id===s\.currentUserId&&x\.responsible_id===s\.currentUserId/, 'The picker must narrow visible source options to the selected customer and current owner');
assert.match(page, /key==='customer_id'\?\{contact_id:'',opportunity_id:''\}/, 'Changing customer clears the previous source opportunity');
assert.match(page, /opportunity_id:form\.opportunity_id\|\|null/, 'The selected source id is sent through the existing draft action');
assert.match(page, /quote\.opportunity_name/, 'Quote details show the readable source snapshot without rendering its id');
assert.match(page, /lines_json:JSON\.stringify/);
assert.match(page, /openDetail\(created\.id\)/, 'Successful save must reopen the persisted quote');
assert.match(page, /quotation_adjust_line_price/, 'Draft detail must reuse the controlled line-price action');
assert.match(page, /成本分析不可用/, 'Unauthorized cost analysis must remain explicitly unavailable in quote details');
assert.doesNotMatch(page, /actions\/forge_quotation\/(?:submit|approve|send|convert)/, 'The draft surface must not start approval, customer sending, or order conversion');
assert.match(action, /name: 'sales_quotation_draft_create'[\s\S]*?requiredPermissions: \['sales_quotation_draft_create'\]/);
assert.match(action, /owner_id: actor, responsible_id: actor, status: 'draft'/);
assert.match(action, /where: \{ id: opportunityId, organization_id: organizationId \}/, 'The trusted draft action reads the source only inside the current organization');
assert.match(action, /opportunity\.customer_id !== customerId[\s\S]*?ownedByActor\(opportunity\)[\s\S]*?opportunity\.responsible_id \|\| ''\) !== actor/, 'The action binds the source to the customer and current opportunity owner');
assert.match(action, /opportunity_name: opportunity \? String\(opportunity\.name \|\| ''\)\.trim\(\) : null/, 'Only the server-read opportunity title is snapshotted');
assert.match(action, /quotation_id: quotationId, owner_id: actor/);
assert.match(action.slice(action.indexOf("name: 'sales_quotation_draft_create'"), action.indexOf('export const QuotationAdjustLinePrice')), /ai:\s*\{\s*exposed:\s*true/);
assert.match(permission, /name: 'sales_quotation_draft_operator'/);
assert.match(permission, /forge_quotation: \{ allowRead: true, readScope: 'own' \}/);
assert.match(permission, /forge_customer: ownRead/);
assert.match(permission, /forge_contact: ownRead/);
assert.match(permission, /'forge_material_sku\.cost_price': \{ readable: false \}/);
assert.match(permission, /'forge_quotation\.cost_total': \{ readable: false \}/);
assert.match(permission, /'forge_quotation_line\.cost_price': \{ readable: false \}/);
assert.match(permission, /'forge_quotation_price_adjustment_receipt\.cost_total': \{ readable: false \}/);
assert.equal((permission.match(/fields: salesQuotationCostFieldMask/g) || []).length, 3, 'Quote entry, review, and adjustment capabilities must keep costs masked');
assert.doesNotMatch(permission, /viewAllRecords|modifyAllRecords|allowCreate|allowEdit/);
assert.doesNotMatch(contractPermission, /viewAllRecords|modifyAllRecords/);
assert.match(contractPermission, /forge_quotation: readOwnRecords/);
assert.match(contractPermission, /forge_quotation_line: readOwnRecords/);
assert.equal((contractPermission.match(/fields: salesQuotationCostFieldMask/g) || []).length, 2, 'Contract operator and reviewer roles must keep quotation costs masked');
const draftAction = action.slice(action.indexOf("name: 'sales_quotation_draft_create'"), action.indexOf('export const QuotationAdjustLinePrice'));
assert.doesNotMatch(draftAction, /sku\.cost_price|cost_analysis_available/, 'Draft calculation must not read or report internal costs');
const recalculationAction = action.slice(action.indexOf("name: 'quotation_recalculate'"), action.indexOf('export const SalesQuotationDraftCreate'));
const priceAdjustmentAction = action.slice(action.indexOf("name: 'quotation_adjust_line_price'"), action.indexOf('export const QuotationSubmit'));
for (const [label, source] of [['recalculation', recalculationAction], ['price adjustment', priceAdjustmentAction]]) {
  assert.doesNotMatch(source, /cost_price|cost_analysis_available: true|cost_total: totals/, label+' action must not read or return cost values');
}
assert.match(object, /quotation_id: \{ \.\.\.reference\('forge_quotation', '报价单', true\), inlineEdit: true/);
assert.match(object, /opportunity_id: \{ \.\.\.reference\('forge_sales_opportunity', '来源商机'\), relatedList: true/);
assert.match(object, /indexes: \[\{ fields: \['opportunity_id'\] \}\]/, 'Source quote related-list reads have a foreign-key index');
console.log('PASS sales quote page, owned-draft capability, atomic draft action, and native relationship metadata are wired');
