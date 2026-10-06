import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { LiteKernel } from '@objectstack/core';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { actionBodyRunnerFactory, QuickJSScriptRunner } from '@objectstack/runtime';
import { AutomationServicePlugin, SysAutomationRun, SysFlowDispatch } from '@objectstack/service-automation';
import { ApprovalsServicePlugin, SysApprovalAction, SysApprovalApprover, SysApprovalRequest } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { securityObjects } from '@objectstack/plugin-security';
import { SalesGrossProfitReportQuery } from '../src/actions/sales-gross-profit.action.ts';
import { SalesPerformanceConfirmationSubmit, SalesPerformanceExportJobDownload, SalesPerformanceRebookExportCreate, SalesPerformanceRebookOptionsQuery, SalesPerformanceRebookSubmit, SalesPerformanceWorkspaceQuery } from '../src/actions/sales-performance.action.ts';
import { SalesPerformanceConfirmation, SalesPerformanceEntry, SalesPerformanceEntrySource, SalesPerformanceExportJob, SalesPerformanceRebook } from '../src/objects/sales-performance.object.ts';
import { SalesPerformanceConfirmationFlow, SalesPerformanceRebookFlow } from '../src/flows/sales-performance-approval.flow.ts';
import { SalesPerformanceApprovalFinalizationPlugin } from '../src/plugins/sales-performance-approval-finalization.plugin.ts';
import { OrganizationBusinessDateQueryPlugin } from '../src/plugins/sales-performance-business-date.plugin.ts';
import { createSalesPerformanceCalendarActionHandler } from '../src/plugins/sales-performance-calendar.plugin.ts';

const requireSecurityDependency = createRequire(import.meta.resolve('@objectstack/plugin-security'));
const platformObjects = requireSecurityDependency('@objectstack/platform-objects');

const organizationId = 'performance-test-org', managerId = 'performance-manager', sellerId = 'performance-seller', otherSellerId = 'performance-other-seller', financeReviewerId = 'performance-finance-reviewer';
const commonFields = [
  'name','display_name','username','code','organization_id','owner_id','responsible_id','user_id','role','banned','ban_expires','status','active','enabled',
  'manager_user_id','parent_business_unit_id','effective_from','effective_to','business_unit_id','function_in_business_unit','is_primary','key','value','scope','setting_type',
  'order_id','order_code','order_code_snapshot','contract_id','customer_id','customer_name','customer_name_snapshot','source_type','source_id','source_object','source_line_id','source_line_id','source_line_id','source_line_id','source_line_id','source_line_id','source_line_id',
  'shipment_id','order_line_id','sku_id','material_id','category_id','category_name','material_name','item_code','quantity','outbound_quantity','outbound_on',
  'direction','movement_type','amount','total_amount','net_amount','untaxed_amount','tax_amount','tax_rate','tax_basis','taxed_source_amount','taxed_subtotal','untaxed_unit_price','recognized_amount',
  'financial_period','recognition_id','recognition_line_id','recognition_on','bearing_type','document_status','fee_item','total_quantity','allocated_amount',
  'available_amount','remaining_amount','project_id','project_status','gross_profit','gross_margin_rate','cost_complete','submitted_at',
  'confirmed_at','reviewed_at','posted_at','approval_status','sort_order','description','settings','entry_id','entry_key','request_key','request_signature',
  'revision','progress','row_count','field_name','parent_code','option_value','type','team_name','team_name_snapshot','completed_at','completion_date',
];
const boolFields = new Set(['banned','active','enabled','is_primary','cost_complete']);
function genericObject(name) {
  const fields = Object.fromEntries(commonFields.map(field => [field, boolFields.has(field) ? Field.boolean({}) : Field.text({})]));
  fields.id = Field.text({ required: true });
  return ObjectSchema.create({ name, label: name, pluralLabel: name, nameField: 'name', sharingModel: 'public_read_write', fields, enable: { apiEnabled: true, apiMethods: ['get','list','create','update','delete','bulk'], trackHistory: false } });
}

const genericNames = [
  'forge_business_setting_option',
  'forge_customer','forge_sales_order','forge_sales_order_line','forge_revenue_recognition','forge_revenue_recognition_line',
  'forge_sales_outbound','forge_sales_shipment_line','forge_inventory_ledger','forge_sales_invoice','forge_sales_invoice_line',
  'forge_sales_additional_fee','forge_sales_return','forge_project_sales_link','forge_project_cost_entry','forge_sales_gross_profit_cost_allocation',
  'forge_material_sku','forge_material','forge_material_category','forge_collection_allocation',
];
const performanceObjects = [SalesPerformanceEntry, SalesPerformanceEntrySource, SalesPerformanceConfirmation, SalesPerformanceRebook, SalesPerformanceExportJob];
const nativeIdentityObjects = [platformObjects.SysOrganization, platformObjects.SysUser, platformObjects.SysMember, platformObjects.SysBusinessUnit, platformObjects.SysBusinessUnitMember, platformObjects.SysUserPreference];
const nativeSecurityNames = new Set(['sys_position','sys_permission_set','sys_position_permission_set','sys_user_position']);
const nativeSecurityObjects = securityObjects.filter(object => nativeSecurityNames.has(object.name));
const allObjects = [...genericNames.map(genericObject), ...nativeIdentityObjects, ...nativeSecurityObjects,
  SysApprovalRequest, SysApprovalAction, SysApprovalApprover, SysAutomationRun, SysFlowDispatch, ...performanceObjects];

async function harness(t) {
  const directory = await mkdtemp(join(tmpdir(), 'forge-sales-performance-'));
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(directory, 'performance.sqlite') }, useNullAsDefault: true });
  const engine = new ObjectQL();
  for (const object of allObjects) engine.registerObject(object);
  engine.registerDriver(driver, true);
  await engine.init();
  await driver.initObjects(allObjects.map(object => engine.getObject(object.name)));
  t.after(async () => { await driver.disconnect(); await rm(directory, { recursive: true, force: true }); });
  const system = { isSystem: true, userId: managerId, tenantId: organizationId, organizationId, permissions: ['sales_performance_read','sales_performance_confirm','sales_performance_rebook','forge_sales_gross_profit_read'] };
  await engine.insert('sys_organization', { id: organizationId, name: '业绩测试组织', slug: organizationId, timezone: 'Asia/Shanghai' }, { context: system });
  for (const [id, name] of [[managerId,'销售经理'],[sellerId,'业绩员工'],[otherSellerId,'同组员工'],[financeReviewerId,'财务复核员']]) {
    await engine.insert('sys_user', { id, name, email: id+'@example.invalid', banned: false }, { context: system });
    await engine.insert('sys_member', { id: 'membership-'+id, user_id: id, organization_id: organizationId, role: 'member' }, { context: system });
  }
  await engine.insert('sys_business_unit', { id: 'sales-bu', name: '销售一部', code: 'SBU-PERF-1', kind: 'department', organization_id: organizationId, manager_user_id: managerId, active: true }, { context: system });
  for (const id of [sellerId, otherSellerId]) await engine.insert('sys_business_unit_member', { id: 'bu-member-'+id, business_unit_id: 'sales-bu', user_id: id, function_in_business_unit: 'member', is_primary: true, effective_from: '2026-01-01T00:00:00.000Z' }, { context: system });
  await engine.insert('sys_business_unit_member', { id: 'bu-member-manager', business_unit_id: 'sales-bu', user_id: managerId, function_in_business_unit: 'lead', is_primary: true, effective_from: '2026-01-01T00:00:00.000Z' }, { context: system });
  await engine.insert('sys_business_unit_member', { id: 'bu-member-finance-reviewer', business_unit_id: 'sales-bu', user_id: financeReviewerId, function_in_business_unit: 'member', is_primary: true, effective_from: '2026-01-01T00:00:00.000Z' }, { context: system });
  await engine.insert('sys_position', { id: 'finance-reviewer-position', name: 'finance_reviewer', label: '财务复核岗', active: true }, { context: system });
  await engine.insert('sys_permission_set', { id: 'finance-reviewer-set', name: 'forge_finance_reviewer', label: '财务独立复核', active: true, system_permissions: JSON.stringify(['forge_finance_reviewer','forge_sales_gross_profit_read']), object_permissions: '{}', field_permissions: '{}', row_level_security: '[]', tab_permissions: '{}' }, { context: system });
  await engine.insert('sys_position_permission_set', { id: 'finance-reviewer-binding', position_id: 'finance-reviewer-position', permission_set_id: 'finance-reviewer-set' }, { context: system });
  await engine.insert('sys_user_position', { id: 'finance-reviewer-appointment', user_id: financeReviewerId, position: 'finance_reviewer', organization_id: organizationId, valid_from: '2026-01-01T00:00:00.000Z', valid_until: '2027-01-01T00:00:00.000Z' }, { context: system });
  await engine.insert('forge_customer', { id: 'customer-1', name: '测试客户', status: 'active', organization_id: organizationId }, { context: system });
  await engine.insert('forge_sales_order', { id: 'order-1', name: '测试订单', code: 'SO-PERF-1', organization_id: organizationId, customer_id: 'customer-1', status: 'completed', total_amount: 113, recognized_amount: 113, updated_at: '2026-10-03T00:00:00.000Z' }, { context: system });
  await engine.insert('forge_sales_order_line', { id: 'order-line-1', organization_id: organizationId, order_id: 'order-1', sku_id: 'sku-1', name: '测试物料', item_code: 'M-1', quantity: 1, taxed_subtotal: 113, untaxed_unit_price: 100, tax_rate: 13 }, { context: system });
  await engine.insert('forge_sales_outbound', { id: 'outbound-1', organization_id: organizationId, order_id: 'order-1', shipment_id: 'shipment-1', sku_id: 'sku-1', quantity: 1, outbound_on: '2026-10-02', status: 'outbounded' }, { context: system });
  await engine.insert('forge_sales_shipment_line', { id: 'shipment-line-1', organization_id: organizationId, shipment_id: 'shipment-1', order_id: 'order-1', order_line_id: 'order-line-1', sku_id: 'sku-1', quantity: 1, outbound_quantity: 1 }, { context: system });
  await engine.insert('forge_inventory_ledger', { id: 'ledger-1', organization_id: organizationId, code: 'IL-PERF-1', source_object: 'forge_sales_outbound', source_id: 'outbound-1', source_line_id: 'shipment-line-1', sku_id: 'sku-1', direction: 'outbound', movement_type: 'sales_outbound', quantity: 1, amount: 60 }, { context: system });
  await engine.insert('forge_revenue_recognition', { id: 'recognition-1', organization_id: organizationId, status: 'approved', source_type: 'sales_outbound', source_id: 'outbound-1', order_id: 'order-1', customer_id: 'customer-1', responsible_id: sellerId, recognition_on: '2026-10-03', financial_period: '2026-10', net_amount: 113, untaxed_amount: 100, tax_amount: 13, tax_basis: 'source_lines_reconciled' }, { context: system });
  await engine.insert('forge_revenue_recognition_line', { id: 'recognition-line-1', organization_id: organizationId, recognition_id: 'recognition-1', source_object: 'forge_sales_shipment_line', source_id: 'shipment-line-1', order_id: 'order-1', order_line_id: 'order-line-1', sku_id: 'sku-1', item_code: 'M-1', material_name: '测试物料', category_id: 'category-1', category_name: '物料', quantity: 1, taxed_source_amount: 113, untaxed_amount: 100, tax_amount: 13, tax_rate: 13, tax_basis: 'source_lines_reconciled' }, { context: system });
  await engine.insert('forge_material_sku', { id: 'sku-1', organization_id: organizationId, material_id: 'material-1' }, { context: system });
  await engine.insert('forge_material', { id: 'material-1', organization_id: organizationId, code: 'M-1', name: '测试物料', category_id: 'category-1' }, { context: system });
  await engine.insert('forge_material_category', { id: 'category-1', organization_id: organizationId, name: '物料' }, { context: system });
  await engine.insert('forge_business_setting_option', { id: 'reason-1', name: '项目协作分配', code: 'sales_rebook_1', scope: 'sales', setting_type: 'performance_allocation_reason', enabled: true, organization_id: organizationId, sort_order: 10 }, { context: system });
  async function run(action, input = {}, actor = managerId, permissions = system.permissions) {
    const context = { isSystem: true, userId: actor, tenantId: organizationId, organizationId, permissions };
    const calendarAction = ['sales_performance_workspace_query','sales_performance_rebook_export_create'].includes(action.name);
    const runner = calendarAction ? null : new QuickJSScriptRunner({ actionTimeoutMs: 30_000 });
    const handler = calendarAction ? createSalesPerformanceCalendarActionHandler(engine, action, { actionTimeoutMs: 30_000 }) : actionBodyRunnerFactory(runner, { ql: engine, appId: 'forge-sales-performance-test' })(action);
    try {
      return await handler({ object: action.objectName, params: { ...input }, session: { userId: actor, organizationId, timezone: 'Asia/Shanghai' }, user: { id: actor, organizationId, systemPermissions: permissions }, api: engine.createContext(context) });
    } finally { if (calendarAction) await handler.dispose(); else await runner.dispose(); }
  }
  return { engine, system, run };
}

async function nativeKernel(t, engine) {
  const kernel = new LiteKernel({ logger: { level: 'silent' } });
  const enginePlugin = {
    name: 'com.objectstack.engine.objectql', version: '1.0.0', type: 'standard',
    init(context) { context.registerService('objectql', engine); context.registerService('data', engine); context.registerService('manifest', { register() {} }); },
  };
  kernel.use(enginePlugin)
    .use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }))
    .use(new ApprovalsServicePlugin({ disableAutoHooks: true }))
    .use(new RecordChangeTriggerPlugin())
    .use(new SalesPerformanceApprovalFinalizationPlugin());
  await kernel.bootstrap();
  t.after(async () => { await kernel.shutdown(); });
  const automation = kernel.getService('automation'), approvals = kernel.getService('approvals');
  automation.registerFlow(SalesPerformanceConfirmationFlow.name, SalesPerformanceConfirmationFlow);
  automation.registerFlow(SalesPerformanceRebookFlow.name, SalesPerformanceRebookFlow);
  const reportRunner = new QuickJSScriptRunner({ actionTimeoutMs: 30_000 });
  const reportHandler = actionBodyRunnerFactory(reportRunner, { ql: engine, appId: 'forge-sales-performance-test' })(SalesGrossProfitReportQuery);
  engine.registerAction('forge_revenue_recognition', 'sales_gross_profit_report_query', reportHandler);
  t.after(async () => { await reportRunner.dispose(); });
  assert.ok(automation.getRegisteredNodeTypes().includes('forge_sales_performance_finalize'));
  return { automation, approvals };
}

test('official QuickJS action runner builds a scoped performance DTO and resolves same-BU Rebook options', async t => {
  const h = await harness(t);
  const dto = await h.run(SalesPerformanceWorkspaceQuery, { scope: 'team', tab: 'confirm', period: 'all', business_date: '2026-10-03', confirm_status: 'pending', page: 1, page_size: 10 });
  assert.equal(dto.rows.length, 1);
  assert.equal(dto.rows[0].order_code, 'SO-PERF-1');
  assert.equal(dto.rows[0].sales_person_id, sellerId);
  await h.engine.insert('forge_sales_performance_entry', { id: 'entry-1', name: 'SO-PERF-1 业绩', code: 'PE-20261003-0001', entry_key: 'order:order-1', entry_type: 'original_confirm', amount_direction: 'increase', order_id: 'order-1', order_code_snapshot: 'SO-PERF-1', customer_id: 'customer-1', customer_name_snapshot: '测试客户', source_recognition_amount: 113, recognition_on: '2026-10-03', order_amount: 113, performance_amount: 100, performance_ratio: 100, rebooked_amount: 0, rebook_reserved_amount: 0, revision: 0, sales_person_id: sellerId, sales_person_name_snapshot: '业绩员工', business_unit_id: 'sales-bu', team_name_snapshot: '销售一部', status: 'pending', cost_complete: false, tax_basis: 'source_lines_reconciled', organization_id: organizationId, responsible_id: sellerId }, { context: h.system });
  const options = await h.run(SalesPerformanceRebookOptionsQuery, { source_entry_id: 'entry-1' });
  assert.deepEqual(options.targets.map(row => row.id), [otherSellerId, financeReviewerId, managerId]);
  assert.deepEqual(options.reasons.map(row => row.id), ['reason-1']);
});

test('business-date action returns the date and timezone for only the authenticated organization', async t => {
  const h = await harness(t), plugin = new OrganizationBusinessDateQueryPlugin();
  plugin.start({ getService: name => name === 'objectql' ? h.engine : undefined });
  const foreignOrganizationId = 'performance-test-foreign-org';
  await h.engine.insert('sys_organization', { id: foreignOrganizationId, name: '隔离组织', slug: foreignOrganizationId, timezone: 'America/New_York' }, { context: h.system });
  const organizationReads = [], findOne = h.engine.findOne.bind(h.engine);
  let timezoneOverride = null;
  h.engine.findOne = async (object, query, options) => {
    if (object === 'sys_organization') organizationReads.push(query.where.id);
    const result = await findOne(object, query, options);
    if (object === 'sys_organization' && query.where.id === foreignOrganizationId && timezoneOverride) return { ...result, timezone: timezoneOverride };
    return result;
  };
  const result = await h.engine.executeAction('global', 'organization_business_date_query', {
    user: { id: managerId, organizationId }, session: { userId: managerId, organizationId },
    params: { organization_id: foreignOrganizationId, timezone: 'UTC' },
  });
  assert.match(result.business_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(result.timezone, 'Asia/Shanghai');
  assert.deepEqual(Object.keys(result).sort(), ['business_date', 'timezone']);
  assert.deepEqual(organizationReads, [organizationId], 'client-supplied organization and timezone do not affect the projection');

  const otherMembershipResult = await h.engine.executeAction('global', 'organization_business_date_query', {
    user: { id: managerId }, session: { userId: managerId, organizationId: foreignOrganizationId }, params: {},
  });
  assert.equal(otherMembershipResult.timezone, 'America/New_York');
  assert.deepEqual(organizationReads, [organizationId, foreignOrganizationId], 'a distinct authenticated organization reads only its own timezone');

  await assert.rejects(h.engine.executeAction('global', 'organization_business_date_query', { params: { organization_id: organizationId } }), /无法确认当前组织/);
  await assert.rejects(h.engine.executeAction('global', 'organization_business_date_query', { user: { id: managerId }, session: { userId: managerId }, params: {} }), /无法确认当前组织/);
  await assert.rejects(h.engine.executeAction('global', 'organization_business_date_query', {
    user: { id: managerId, organizationId: 'missing-performance-org' }, params: {},
  }), /无法读取组织业务时区/);
  timezoneOverride = 'invalid/zone';
  await assert.rejects(h.engine.executeAction('global', 'organization_business_date_query', {
    user: { id: managerId, organizationId: foreignOrganizationId }, params: {},
  }), /组织业务时区无效/);
});

test('official QuickJS source query and confirmation Action create a native pending approval only from audited income and complete cost', async t => {
  const h = await harness(t);
  const report = await h.run(SalesGrossProfitReportQuery, { order_id: 'order-1', business_date: '2026-10-03', period: 'year', dimension: 'order', page: 1, page_size: 100 }, managerId);
  assert.equal(report.single_order_scope, true);
  assert.equal(report.metrics.sales_revenue, 100);
  assert.equal(report.metrics.sales_cost, 60);
  assert.equal(report.metrics.gross_profit, 40);
  assert.ok(report.financial_source_signature);
  const result = await h.run(SalesPerformanceConfirmationSubmit, { order_id: 'order-1', business_date: '2026-10-03', request_key: 'performance-confirm-1', remarks: '已核对税基与成本' });
  assert.equal(result.status, 'pending_approval');
  assert.equal(result.performance_amount, 100);
  assert.equal(result.gross_profit, 40);
  const entry = await h.engine.findOne('forge_sales_performance_entry', { where: { id: result.entry_id } }, { context: h.system });
  const confirmation = await h.engine.findOne('forge_sales_performance_confirmation', { where: { id: result.id } }, { context: h.system });
  const sourceLines = await h.engine.find('forge_sales_performance_entry_source', { where: { entry_id: result.entry_id } }, { context: h.system });
  assert.equal(entry.status, 'pending');
  assert.equal(entry.performance_amount, 100);
  assert.equal(entry.gross_profit, null, 'awaiting native approval is not banked');
  assert.equal(confirmation.status, 'pending_approval');
  assert.equal(confirmation.cost_complete, true);
  assert.equal(sourceLines.length, 1);
  assert.equal(SalesPerformanceConfirmationSubmit.requiredPermissions.includes('forge_sales_gross_profit_read'), true);
});

test('official QuickJS Rebook Action reserves its immutable amount with revision CAS and rejects cross-BU recipients', async t => {
  const h = await harness(t);
  await h.engine.insert('forge_sales_performance_entry', { id: 'entry-1', name: 'SO-PERF-1 业绩', code: 'PE-20261003-0001', entry_key: 'order:order-1', entry_type: 'original_confirm', amount_direction: 'increase', order_id: 'order-1', order_code_snapshot: 'SO-PERF-1', customer_id: 'customer-1', customer_name_snapshot: '测试客户', source_recognition_amount: 113, recognition_on: '2026-10-03', order_amount: 113, performance_amount: 100, performance_ratio: 100, rebooked_amount: 0, rebook_reserved_amount: 0, revision: 0, sales_person_id: sellerId, sales_person_name_snapshot: '业绩员工', business_unit_id: 'sales-bu', team_name_snapshot: '销售一部', status: 'pending', cost_complete: false, tax_basis: 'source_lines_reconciled', organization_id: organizationId, responsible_id: sellerId }, { context: h.system });
  const request = await h.run(SalesPerformanceRebookSubmit, { source_entry_id: 'entry-1', target_person_id: otherSellerId, ratio: 25, reason_id: 'reason-1', request_key: 'performance-rebook-1', remarks: '同组协作' });
  assert.equal(request.status, 'pending_approval');
  assert.equal(request.amount, 25);
  const entry = await h.engine.findOne('forge_sales_performance_entry', { where: { id: 'entry-1' } }, { context: h.system });
  assert.equal(entry.rebook_reserved_amount, 25);
  assert.equal(entry.revision, 1);
  const row = await h.engine.findOne('forge_sales_performance_rebook', { where: { id: request.id } }, { context: h.system });
  assert.equal(row.status, 'pending_approval');
  await assert.rejects(h.run(SalesPerformanceRebookSubmit, { source_entry_id: 'entry-1', target_person_id: 'foreign-user', ratio: 10, reason_id: 'reason-1', request_key: 'cross-bu' }), /缺少当前组织有效原生业务单元/);
});

test('Rebook export is a completed, actor-scoped data artifact with native status and a protected download action', async t => {
  const h = await harness(t);
  await h.engine.insert('forge_sales_performance_rebook', { id: 'rebook-export-1', name: 'Rebook导出测试', request_key: 'seed-rebook-1', source_entry_id: 'entry-1', source_order_code: 'SO-PERF-1', source_person_id: sellerId, target_person_id: otherSellerId, business_unit_id: 'sales-bu', ratio: 25, amount: 25, reason_name_snapshot: '项目协作分配', status: 'approved', submitted_by: sellerId, submitted_at: '2026-10-03T01:00:00.000Z', responsible_id:sellerId, organization_id: organizationId }, { context: h.system });
  const created = await h.run(SalesPerformanceRebookExportCreate, { request_key: 'export-rebook-1', scope: 'team', period: 'all', business_date: '2026-10-03', year: 2026, search: '' });
  assert.equal(created.status, 'completed');
  assert.equal(created.row_count, 1);
  const saved = await h.engine.findOne('forge_sales_performance_export_job', { where: { id: created.id } }, { context: h.system });
  assert.equal(saved.status, 'completed');
  assert.equal(Number(saved.progress), 100);
  const download = await h.run(SalesPerformanceExportJobDownload, { job_id: created.id });
  assert.equal(download.status, 'completed');
  assert.match(download.result_content, /SO-PERF-1/);
  await assert.rejects(h.run(SalesPerformanceExportJobDownload, { job_id: created.id }, sellerId), /不存在、未完成或不属于当前员工/);
});

test('native Finance approval atomically posts a confirmed original entry from the same live source snapshot', async t => {
  const h = await harness(t), native = await nativeKernel(t, h.engine);
  const submitted = await h.run(SalesPerformanceConfirmationSubmit, { order_id: 'order-1', business_date: '2026-10-03', request_key: 'native-confirm-1', remarks: '原生审批闭环' });
  const reviewer = { userId: financeReviewerId, tenantId: organizationId, organizationId, positions: ['finance_reviewer'], permissions: ['forge_finance_reviewer'], systemPermissions: ['forge_sales_gross_profit_read'] };
  const rebook = await h.run(SalesPerformanceRebookSubmit, { source_entry_id: submitted.entry_id, target_person_id: otherSellerId, ratio: 25, reason_id: 'reason-1', request_key: 'native-rebook-1', remarks: '待原业绩确认后转记' });
  const rebookRequests = await h.engine.find('sys_approval_request', { where: { object_name: 'forge_sales_performance_rebook', record_id: rebook.id, status: 'pending' } }, { context: h.system });
  assert.equal(rebookRequests.length, 1);
  await native.approvals.decide(rebookRequests[0].id, { decision: 'approve', actorId: financeReviewerId, comment: '同意原业绩确认后转记' }, reviewer);
  const waitingRequest = await h.engine.findOne('forge_sales_performance_rebook', { where: { id: rebook.id } }, { context: h.system });
  const beforeConfirmationEntries = await h.engine.find('forge_sales_performance_entry', { where: { rebook_id: rebook.id } }, { context: h.system });
  assert.equal(waitingRequest.status, 'approved_waiting_source');
  assert.equal(beforeConfirmationEntries.length, 0, 'approved Rebook cannot enter the bank before original confirmation');
  const requests = await h.engine.find('sys_approval_request', { where: { object_name: 'forge_sales_performance_confirmation', record_id: submitted.id, status: 'pending' } }, { context: h.system });
  assert.equal(requests.length, 1);
  const decision = await native.approvals.decide(requests[0].id, { decision: 'approve', actorId: financeReviewerId, comment: '税基与成本已核对' }, reviewer);
  assert.equal(decision.resumed, true);
  const [entry, confirmation, approvalRequest, flowRun, postedRebook, rebookEntries] = await Promise.all([
    h.engine.findOne('forge_sales_performance_entry', { where: { id: submitted.entry_id } }, { context: h.system }),
    h.engine.findOne('forge_sales_performance_confirmation', { where: { id: submitted.id } }, { context: h.system }),
    h.engine.findOne('sys_approval_request', { where: { id: requests[0].id } }, { context: h.system }),
    native.automation.getRun(requests[0].flow_run_id),
    h.engine.findOne('forge_sales_performance_rebook', { where: { id: rebook.id } }, { context: h.system }),
    h.engine.find('forge_sales_performance_entry', { where: { rebook_id: rebook.id, status: 'confirmed' }, orderBy: [{ field: 'entry_type', order: 'asc' }] }, { context: h.system }),
  ]);
  assert.equal(approvalRequest.status, 'approved');
  assert.equal(flowRun.status, 'completed');
  assert.equal(confirmation.status, 'confirmed');
  assert.equal(entry.status, 'confirmed');
  assert.equal(Number(entry.performance_amount), 100);
  assert.equal(Number(entry.gross_profit), 40);
  assert.equal(entry.confirmed_by, financeReviewerId);
  assert.equal(postedRebook.status, 'approved');
  assert.deepEqual(rebookEntries.map(row => row.entry_type).sort(), ['rebook_in','rebook_out']);
  assert.equal(rebookEntries.reduce((sum, row) => sum + Number(row.performance_amount||0), 0), 50);
  assert.equal(Number(entry.rebooked_amount), 25);
  assert.equal(Number(entry.rebook_reserved_amount), 0);
  const sourceBank = await h.run(SalesPerformanceWorkspaceQuery, { scope: 'mine', tab: 'bank', period: 'all', business_date: '2026-10-03', page: 1, page_size: 10 }, sellerId, ['sales_performance_read']);
  const targetBank = await h.run(SalesPerformanceWorkspaceQuery, { scope: 'mine', tab: 'bank', period: 'all', business_date: '2026-10-03', page: 1, page_size: 10 }, otherSellerId, ['sales_performance_read']);
  assert.equal(sourceBank.summary.net_performance, 75);
  assert.equal(targetBank.summary.net_performance, 25);
});

test('source changes after native approval fail closed and the workspace distinguishes approved-but-unposted performance', async t => {
  const h = await harness(t), native = await nativeKernel(t, h.engine);
  const submitted = await h.run(SalesPerformanceConfirmationSubmit, { order_id: 'order-1', business_date: '2026-10-03', request_key: 'native-confirm-stale-1', remarks: '待审批后验证来源快照' });
  const requests = await h.engine.find('sys_approval_request', { where: { object_name: 'forge_sales_performance_confirmation', record_id: submitted.id, status: 'pending' } }, { context: h.system });
  assert.equal(requests.length, 1);
  await h.engine.update('forge_inventory_ledger', { id: 'ledger-1', amount: 55 }, { context: h.system });
  const reviewer = { userId: financeReviewerId, tenantId: organizationId, organizationId, positions: ['finance_reviewer'], permissions: ['forge_finance_reviewer'], systemPermissions: ['forge_sales_gross_profit_read'] };
  await assert.rejects(native.approvals.decide(requests[0].id, { decision: 'approve', actorId: financeReviewerId, comment: '来源金额更新后再核对' }, reviewer), /RESUME_FAILED/);
  const [entry, confirmation, request, bank] = await Promise.all([
    h.engine.findOne('forge_sales_performance_entry', { where: { id: submitted.entry_id } }, { context: h.system }),
    h.engine.findOne('forge_sales_performance_confirmation', { where: { id: submitted.id } }, { context: h.system }),
    h.engine.findOne('sys_approval_request', { where: { id: requests[0].id } }, { context: h.system }),
    h.run(SalesPerformanceWorkspaceQuery, { scope: 'mine', tab: 'bank', period: 'all', business_date: '2026-10-03', page: 1, page_size: 10 }, sellerId, ['sales_performance_read']),
  ]);
  assert.equal(request.status, 'approved');
  assert.equal(confirmation.status, 'pending_approval');
  assert.equal(confirmation.approval_status, 'approved');
  assert.equal(entry.status, 'pending');
  assert.equal(entry.gross_profit, null);
  assert.equal(bank.summary.net_performance, 0);
  assert.equal(bank.rows[0].approval_status, 'approved');
  assert.equal(bank.rows[0].entry_confirmation_status, 'pending_approval');
});
