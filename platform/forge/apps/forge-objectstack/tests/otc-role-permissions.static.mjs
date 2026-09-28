import assert from 'node:assert/strict';
import test from 'node:test';
import * as objects from '../src/objects/index.ts';
import { salesApplication } from '../src/apps/packages/sales.ts';
import { projectApplication } from '../src/apps/packages/project.ts';
import { supplyChainApplication } from '../src/apps/packages/supply-chain.ts';
import { productionApplication } from '../src/apps/packages/production.ts';
import { financeApplication } from '../src/apps/packages/finance.ts';
import { ContractRegisterSignature } from '../src/actions/sales.action.ts';
import * as procurementActions from '../src/actions/procurement.action.ts';
import * as productionActions from '../src/actions/production.action.ts';
import * as inventoryActions from '../src/actions/inventory.action.ts';
import * as financeActions from '../src/actions/finance.action.ts';
import * as supplierActions from '../src/actions/supplier.action.ts';
import * as bomActions from '../src/actions/bom.action.ts';
import * as allActions from '../src/actions/index.ts';
import { PurchaseRequestPage } from '../src/pages/purchase-request.page.ts';
import { PurchaseInspectionWorkspacePage } from '../src/pages/purchase-inspection-workspace.page.ts';
import { ProductionAssemblyWorkspacePage } from '../src/pages/production-assembly-workspace.page.ts';
import { ServiceOrdersPage } from '../src/pages/sales-crm-service-pages.page.ts';
import { SalesContractCreatePage } from '../src/pages/sales-contract-create.page.ts';
import { SupplierWorkspacePage } from '../src/pages/supplier-workspace.page.ts';
import { BomWorkspacePage } from '../src/pages/bom-workspace.page.ts';
import { SalesContractApprovalFlow, SalesContractLegalApprovalFlow } from '../src/flows/sales-contract-approval.flow.ts';
import { ProjectAttachmentAssignmentGuard, ProjectLogAssignmentGuard } from '../src/hooks/project-evidence.hook.ts';

const expected = new Set([
  'forge_solution_operator', 'forge_project_gate_reviewer', 'sales_contract_legal_reviewer',
  'contract_signature_registrar', 'forge_material_master_operator', 'forge_procurement_operator',
  'forge_production_operator', 'forge_warehouse_operator', 'forge_quality_inspector',
  'forge_delivery_operator', 'forge_finance_receivables_operator', 'forge_finance_reviewer',
  'forge_service_operator',
  'forge_procurement_reviewer', 'forge_production_reviewer', 'forge_warehouse_reviewer',
]);
const packages = [salesApplication, projectApplication, supplyChainApplication, productionApplication, financeApplication];
const declaredObjects = new Set(Object.values(objects).map(value => value?.name).filter(Boolean));
const registered = packages.flatMap(application => application.stack.permissions || []);
const roleSets = registered.filter(permission => expected.has(permission.name));

test('each OTC role permission ships once in a business application', () => {
  assert.equal(roleSets.length, expected.size);
  assert.deepEqual(new Set(roleSets.map(permission => permission.name)), expected);
});

test('readable OTC objects expose no ungated trusted business actions', () => {
  const readableObjects = new Set(roleSets.flatMap(permission => Object.keys(permission.objects || {})));
  for (const action of Object.values(allActions)) {
    if (!action?.name || !action?.objectName || !readableObjects.has(action.objectName)) continue;
    assert.ok(action.requiredPermissions?.length, `${action.name} is available on ${action.objectName} without a named capability`);
  }
});

test('purchase request page saves drafts through its bounded action', () => {
  const save = procurementActions.PurchaseRequestSaveDraft;
  assert.deepEqual(save.requiredPermissions, ['forge_procurement_operator']);
  assert.match(PurchaseRequestPage.source, /purchase_request_save_draft/);
  assert.match(PurchaseRequestPage.source, /p\?\.data\?\.result/);
  assert.doesNotMatch(PurchaseRequestPage.source, /method:'DELETE'/);
  assert.doesNotMatch(PurchaseRequestPage.source, /request\('\/data\/forge_purchase_request/);
});

test('purchase request draft action rejects editing another operator\'s request', async () => {
  const save = procurementActions.PurchaseRequestSaveDraft;
  const invoked = new Function('ctx', `return (async () => { ${save.body.source} })()`);
  const ctx = {
    recordId: 'request-a', record: { id: 'request-a' },
    session: { userId: 'operator-b', organizationId: 'org-a' },
    input: { draft_json: JSON.stringify({
      code: 'PR-TEST', name: '测试采购申请', purchase_reason: '业务需要', priority: 'medium',
      currency: 'cny', request_on: '2026-09-28', expected_arrival_on: '2026-09-29',
      lines: [{ entry_mode: 'manual', name: '测试物料', model: 'M1', category_name: '设备', unit_name: '台', quantity: 1 }],
    }) },
    api: { object: name => {
      assert.equal(name, 'forge_purchase_request');
      return { findOne: async () => ({ id: 'request-a', status: 'draft', responsible_id: 'operator-a' }) };
    } },
  };
  await assert.rejects(invoked(ctx), /仅采购申请经办人可修改本人草稿/);
});

test('trusted creations retain the acting employee as record owner for own-scope readback', () => {
  for (const action of [
    procurementActions.PurchaseRequestSaveDraft,
    procurementActions.PurchaseOrderCreate,
    procurementActions.PurchaseOrderCreateInbound,
    procurementActions.PendingInspectionCreateOrder,
    productionActions.BomCreateAssembly,
    financeActions.ReceivableRegisterCollection,
    allActions.ServiceOrderCreate,
  ]) {
    assert.ok(action, 'creation action is registered');
    assert.match(action.body.source, /owner_id\s*:\s*actor/, action.name);
  }
});

test('quality inspection page writes results through the assigned inspector action', async () => {
  const complete = procurementActions.PurchaseInspectionComplete;
  assert.deepEqual(complete.requiredPermissions, ['forge_quality_inspector']);
  assert.match(complete.body.source, /inspection\.inspector_id!==actor/);
  assert.match(PurchaseInspectionWorkspacePage.source, /items_json:/);
  assert.doesNotMatch(PurchaseInspectionWorkspacePage.source, /method:'PATCH'/);
});

test('production operator cannot bypass independent assembly release when creating an order', async () => {
  const create = productionActions.BomCreateAssembly;
  const invoke = new Function('ctx', `return (async () => { ${create.body.source} })()`);
  const ctx = {
    recordId: 'bom-a', record: { id: 'bom-a', status: 'active' },
    input: { mode: 'release', planned_quantity: 1, warehouse_id: 'warehouse-a' },
    session: { userId: 'operator-a' },
    api: { object: () => { throw new Error('release reached trusted data API'); } },
  };
  await assert.rejects(invoke(ctx), /下达由独立复核岗位办理/);
  assert.doesNotMatch(ProductionAssemblyWorkspacePage.source, /保存并下达/);
});

test('service orders are opened through the service capability with linked customer and order checks', () => {
  const create = allActions.ServiceOrderCreate;
  assert.deepEqual(create.requiredPermissions, ['forge_service_operator']);
  assert.match(create.body.source, /order\.customer_id!==customer\.id/);
  assert.match(ServiceOrdersPage.source, /service_order_create/);
  assert.doesNotMatch(ServiceOrdersPage.source, /request\('\/data\/forge_service_order'/);
});

test('supplier draft can be created by procurement without generic supplier writes', () => {
  const save = supplierActions.SupplierSaveDraft;
  assert.deepEqual(save.requiredPermissions, ['forge_procurement_operator']);
  assert.match(save.body.source, /owner_id:actor/);
  assert.match(SupplierWorkspacePage.source, /supplier_save_draft/);
  assert.doesNotMatch(SupplierWorkspacePage.source, /method:f\.id\?'PATCH':'POST'/);
  assert.match(supplierActions.SupplierSubmitApproval.body.source, /supplier\.owner_id!==actor/);
  assert.match(supplierActions.SupplierReview.body.source, /supplier\.owner_id===actor/);
});

test('BOM drafting creates a root and confines component edits to its author', async () => {
  assert.deepEqual(bomActions.BomDraftCreate.requiredPermissions, ['forge_production_operator']);
  assert.ok(bomActions.BomDraftCreate.body.capabilities.includes('api.transaction'));
  assert.match(bomActions.BomDraftCreate.body.source, /node_type:'root'/);
  assert.deepEqual(bomActions.BomAddComponent.requiredPermissions, ['forge_production_operator']);
  assert.match(BomWorkspacePage.source, /bom_draft_create/);
  assert.match(BomWorkspacePage.source, /添加物料/);
  assert.doesNotMatch(BomWorkspacePage.source, /ForgeApiResponse\(adapter,'\/data\/forge_bom',\{method:'POST'/);
  const invoke = new Function('ctx', `return (async () => { ${bomActions.BomAddComponent.body.source} })()`);
  await assert.rejects(invoke({
    recordId: 'bom-a', record: { id: 'bom-a', status: 'draft', owner_id: 'operator-a' },
    session: { userId: 'operator-b' }, input: { sku_id: 'sku-a', quantity: 1 },
    api: { object: () => { throw new Error('unexpected trusted write'); } },
  }), /仅BOM编制人可修改本人草稿/);
});

test('project evidence creation requires an actual project assignment', async () => {
  for (const guard of [ProjectAttachmentAssignmentGuard, ProjectLogAssignmentGuard]) {
    const invoke = new Function('ctx', `return (async () => { ${guard.body.source} })()`);
    const input = { project_id: 'project-a' };
    const ctx = {
      session: { userId: 'staff-a', organizationId: 'org-a' }, input,
      api: { object: name => ({
        findOne: async () => name === 'forge_project' ? { id: 'project-a', organization_id: 'org-a', manager_id: 'manager-a' } : null,
        find: async () => name === 'forge_project_member' ? [] : [],
      }) },
    };
    await assert.rejects(invoke(ctx), /仅项目负责人或有效成员/);
    ctx.api.object = name => ({
      findOne: async () => name === 'forge_project' ? { id: 'project-a', organization_id: 'org-a', manager_id: 'manager-a' } : null,
      find: async () => name === 'forge_project_member' ? [{ user_id: 'staff-a', active: true }] : [],
    });
    await invoke(ctx);
    assert.equal(input[guard.object === 'forge_project_log' ? 'author_id' : 'uploaded_by'], 'staff-a');
  }
});

test('OTC role grants are named, bounded and omit destructive or blanket access', () => {
  for (const permission of roleSets) {
    assert.ok(permission.systemPermissions?.includes(permission.name), permission.name);
    for (const [name, grant] of Object.entries(permission.objects || {})) {
      assert.ok(['sys_file', 'sys_user'].includes(name) || declaredObjects.has(name), `${permission.name}: unknown ${name}`);
      assert.notEqual(name, '*', permission.name);
      assert.equal(grant.allowDelete, false, `${permission.name}: delete ${name}`);
      assert.equal(grant.viewAllRecords, false, `${permission.name}: view all ${name}`);
      assert.equal(grant.modifyAllRecords, false, `${permission.name}: modify all ${name}`);
      const evidenceCreate = (permission.name === 'forge_solution_operator' && ['forge_project_attachment', 'forge_project_log'].includes(name))
        || (permission.name === 'forge_project_gate_reviewer' && name === 'forge_project_log');
      if (permission.name !== 'forge_material_master_operator' && !evidenceCreate) {
        assert.equal(grant.allowCreate, false, `${permission.name}: generic create ${name}`);
        assert.equal(grant.allowEdit, false, `${permission.name}: generic edit ${name}`);
      } else if (evidenceCreate) {
        assert.equal(grant.allowCreate, true, `${permission.name}: evidence create ${name}`);
        assert.equal(grant.allowEdit, false, `${permission.name}: evidence edit ${name}`);
      }
    }
  }
});

test('contract signature registration is a separate action, not a general contract edit grant', () => {
  const registrar = roleSets.find(permission => permission.name === 'contract_signature_registrar');
  assert.deepEqual(ContractRegisterSignature.requiredPermissions, ['contract_signature_registrar']);
  assert.equal(registrar.objects.forge_sales_contract.allowRead, true);
  assert.equal(registrar.objects.forge_sales_contract.allowEdit, false);
  assert.equal(registrar.objects.forge_sales_contract.allowCreate, false);
  assert.match(registrar.rowLevelSecurity[0].using, /signed_recorded_by == current_user\.id/);
  assert.match(ContractRegisterSignature.body.source, /current\.responsible_id === actor/);
});

test('nonstandard contracts route legal review while standard contracts retain two reviewers', () => {
  const standardStart = SalesContractApprovalFlow.nodes.find(node => node.id === 'start');
  const legalStart = SalesContractLegalApprovalFlow.nodes.find(node => node.id === 'start');
  const standardApproval = SalesContractApprovalFlow.nodes.find(node => node.id === 'contract_review');
  const legalApproval = SalesContractLegalApprovalFlow.nodes.find(node => node.id === 'contract_review');
  assert.match(standardStart.config.condition, /requires_legal_review != true/);
  assert.match(legalStart.config.condition, /requires_legal_review == true/);
  assert.equal(standardApproval.config.approvers.length, 2);
  assert.deepEqual(legalApproval.config.approvers.map(value => value.value), [
    'contract_delivery_reviewer', 'contract_commercial_reviewer', 'contract_legal_reviewer',
  ]);
  assert.match(allActions.ContractSubmit.body.source, /record\.requires_legal_review/);
  assert.match(allActions.ContractSubmitFrozenMaterial.body.source, /record\.requires_legal_review/);
  assert.match(SalesContractCreatePage.source, /非标条款需要法务复核/);
});

function signatureFixture(actor, overrides = {}) {
  const contract = {
    id: 'contract-a', status: 'active', responsible_id: 'sales-user',
    signed_on: null, signed_evidence_attachment: null, signed_evidence_note: null,
    ...overrides,
  };
  const updates = [];
  const ctx = {
    recordId: contract.id,
    record: contract,
    session: { userId: actor },
    input: {
      signed_on: '2026-09-28',
      signed_evidence_attachment: 'file-a',
      signed_evidence_note: '联调客户签署版',
    },
    api: {
      object(name) {
        if (name === 'sys_file') return { findOne: async () => ({ id: 'file-a', status: 'committed', owner_id: actor }) };
        if (name === 'forge_sales_contract') return {
          findOne: async () => contract,
          update: async patch => { updates.push(patch); return patch; },
        };
        throw new Error(`Unexpected object ${name}`);
      },
      transaction: async operation => operation(),
    },
  };
  const invoke = new Function('ctx', `return (async () => { ${ContractRegisterSignature.body.source} })()`);
  return { invoke: () => invoke(ctx), updates };
}

test('contract owner cannot register their own signature material', async () => {
  const fixture = signatureFixture('sales-user');
  await assert.rejects(fixture.invoke(), /合同负责人不能代替独立登记人/);
  assert.equal(fixture.updates.length, 0);
});

test('separate registrar records a committed owned file once', async () => {
  const fixture = signatureFixture('registrar-user');
  const result = await fixture.invoke();
  assert.equal(result.repeated, false);
  assert.equal(fixture.updates.length, 1);
  assert.equal(fixture.updates[0].signed_recorded_by, 'registrar-user');
  assert.equal(fixture.updates[0].signed_evidence_attachment, 'file-a');
});

test('independent approval actions require their reviewer capability and refuse self-review', () => {
  const actions = Object.values({ ...procurementActions, ...productionActions, ...inventoryActions, ...financeActions, ...supplierActions, ...bomActions });
  const checks = [
    ['purchase_request_approve', 'forge_procurement_reviewer', '采购申请经办人不能审核本人单据'],
    ['purchase_request_reject', 'forge_procurement_reviewer', '采购申请经办人不能审核本人单据'],
    ['purchase_order_approve', 'forge_procurement_reviewer', '采购订单经办人不能审核本人单据'],
    ['purchase_inbound_approve', 'forge_warehouse_reviewer', '入库经办人不能审核本人单据'],
    ['opening_inbound_approve', 'forge_warehouse_reviewer', '入库经办人不能审核本人单据'],
    ['assembly_release', 'forge_production_reviewer', '生产经办人不能下达本人组装单'],
    ['assembly_complete', 'forge_production_reviewer', '生产经办人不能确认本人组装单完工'],
    ['bom_review', 'forge_production_reviewer', 'BOM编制人不能复核本人版本'],
    ['collection_allocation_approve', 'forge_finance_reviewer', '收款登记人不能审核本人核销'],
    ['cash_receipt_approve_pending_allocations', 'forge_finance_reviewer', '收款登记人不能审核本人核销'],
  ];
  for (const [name, capability, refusal] of checks) {
    const action = actions.find(value => value?.name === name);
    assert.ok(action, name);
    assert.deepEqual(action.requiredPermissions, [capability], name);
    assert.ok(action.body.source.includes(refusal), name);
  }
});

test('self-review checks stop representative business actions before trusted writes', async () => {
  const actions = Object.values({ ...procurementActions, ...productionActions, ...inventoryActions, ...financeActions, ...bomActions });
  const cases = [
    ['purchase_request_approve', { status: 'pending_approval' }, { approval_comment: '核对完成' }, /采购申请经办人不能审核本人单据/],
    ['opening_inbound_approve', { status: 'pending_approval' }, { approval_note: '同意' }, /入库经办人不能审核本人单据/],
    ['assembly_release', { status: 'draft' }, { warehouse_id: 'warehouse-a' }, /生产经办人不能下达本人组装单/],
    ['collection_allocation_approve', { status: 'pending_review' }, {}, /收款登记人不能审核本人核销/],
    ['bom_review', { status: 'pending_review' }, { decision: 'approve', comment: '核对完成' }, /BOM编制人不能复核本人版本/],
  ];
  for (const [name, values, input, refusal] of cases) {
    const action = actions.find(value => value?.name === name);
    assert.ok(action, name);
    const record = { id: `${name}-a`, responsible_id: 'operator-a', created_by: 'operator-a', ...values };
    const ctx = {
      recordId: record.id, record, input, session: { userId: 'operator-a' },
      api: { object: () => { throw new Error(`${name} reached trusted data API before self-review guard`); } },
    };
    const invoke = new Function('ctx', `return (async () => { ${action.body.source} })()`);
    await assert.rejects(invoke(ctx), refusal, name);
  }
});
