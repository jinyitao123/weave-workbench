import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { createServicePageHarness, serviceButton, serviceNodes, serviceText } from './service-page-react-harness.mjs';
import { expandViewContainer, PageSchema, ViewItemSchema } from '@objectstack/spec/ui';
import {
  ServiceAnalysisPage,
  ServiceConfigPage,
  ServiceDispatchPage,
  ServiceOrderCreatePage,
  ServiceOrdersPage,
  ServiceQuotationsPage,
  ServiceSettlementsPage,
  ServiceWorkspacePage,
  WarrantyManagementPage,
} from '../src/pages/sales-service-workspace.page.ts';
import { RepairPoolPage, ServicePartRequestsPage } from '../src/pages/sales-service-aftercare.page.ts';
import {
  ServiceConfigItem,
  ServiceOrder,
  ServiceQuotation,
  ServiceSettlement,
  WarrantyCard,
} from '../src/objects/sales.object.ts';
import { RepairRequest, ServicePartRequest, ServicePartRequestEvent, WarrantyCardEvent } from '../src/objects/service-aftercare.object.ts';
import { ServiceOrderCreate, ServiceOrderEngineerAccept } from '../src/actions/sales.action.ts';
import { ServiceRepairRequestCreate } from '../src/actions/service-aftercare.action.ts';
import { serviceManagerPermission, serviceOperatorPermission, warehouseOperatorPermission } from '../src/permissions/otc-role.permission.ts';
import {
  ServiceConfigViews,
  ServiceOrderViews,
  RepairRequestViews,
  ServiceQuotationViews,
  ServiceSettlementViews,
  ServicePartRequestEventViews,
  ServicePartRequestViews,
  WarrantyCardEventViews,
  WarrantyCardViews,
} from '../src/views/service-workspace.view.ts';

function DocumentWorkspace() {}
const serviceWorkspaceGlobals = { DocumentWorkspace };

const pages = [
  ServiceOrdersPage,
  ServiceOrderCreatePage,
  ServiceQuotationsPage,
  ServiceSettlementsPage,
  ServiceWorkspacePage,
  ServiceDispatchPage,
  ServiceAnalysisPage,
  WarrantyManagementPage,
  ServiceConfigPage,
  RepairPoolPage,
  ServicePartRequestsPage,
];

test('service page replacements keep the existing app page identities and parse as React source', () => {
  assert.deepEqual(pages.map(page => page.name), [
    'page_service_orders',
    'page_service_order_create',
    'page_service_quotations',
    'page_service_settlements',
    'page_service_workspace',
    'page_service_dispatch',
    'page_service_analysis',
    'page_warranty_management',
    'page_service_config',
    'page_repair_pool',
    'page_service_part_requests',
  ]);

  for (const page of pages) {
    PageSchema.parse(page);
    assert.equal(page.kind, 'react');
    assert.ok(page.source.length > 0, `${page.name} has a React page source`);
    const result = ts.transpileModule(page.source, {
      fileName: `${page.name}.tsx`,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
    });
    assert.deepEqual(result.diagnostics, [], `${page.name} contains invalid embedded JSX`);
  }
});

test('registered service pages export and render a default React module component', () => {
  for (const page of pages) {
    const harness = createServicePageHarness(page, page === ServiceOrderCreatePage ? { globals: { DocumentWorkspace: function DocumentWorkspace() {} } } : {});
    assert.equal(harness.usesDefaultExport, true, `${page.name} exposes the default component consumed by the ObjectStack source loader`);
    assert.ok(harness.render(), `${page.name} performs its initial React render from the module default export`);
  }
});

test('service-order list opens the registered standalone create page for managers', async () => {
  const harness = createServicePageHarness(ServiceOrdersPage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    records: { forge_service_order: [] },
  });
  const tree = await harness.flushEffects();
  const toolbar = serviceNodes(tree, node => node.type === 'WorkspaceToolbar')[0];
  assert.equal(toolbar.props.primaryAction.type, 'a');
  assert.equal(toolbar.props.primaryAction.props.href, '/_console/apps/com.inoforge.forge.sales/page_service_order_create');
  assert.equal(serviceNodes(tree, node => node.type === 'CompositeDialog' && node.props.title === '新建服务工单').length, 0, 'creation no longer opens a modal inside the list page');
  assert.equal(ServiceOrderCreatePage.name, 'page_service_order_create');
  assert.equal(ServiceOrderCreatePage.label, '新建服务工单');
  assert.equal(ServiceOrderCreatePage.description, '填写客户、来源订单与工单信息。');
  assert.notEqual(ServiceOrder.fields.sales_order_id.required, true, 'page-only required metadata does not change historical storage nullability');
  assert.match(ServiceOrderCreate.body.source, /!draft\.customer_id\|\|!draft\.sales_order_id/, 'the existing native Action rejects missing customer or source sales order');
});

test('service views query formal objects and every declared column exists on its model', () => {
  const entries = [
    [ServiceOrderViews, ServiceOrder],
    [ServiceQuotationViews, ServiceQuotation],
    [ServiceSettlementViews, ServiceSettlement],
    [WarrantyCardViews, WarrantyCard],
    [ServiceConfigViews, ServiceConfigItem],
    [RepairRequestViews, RepairRequest],
    [ServicePartRequestViews, ServicePartRequest],
    [ServicePartRequestEventViews, ServicePartRequestEvent],
    [WarrantyCardEventViews, WarrantyCardEvent],
  ];

  for (const [view, object] of entries) {
    assert.deepEqual(view.list.data, { provider: 'object', object: object.name });
    assert.equal(view.list.pagination.pageSize, object.name.endsWith('_event') ? 10 : 20);
    const expanded = expandViewContainer(object.name, view);
    assert.ok(expanded.some(item => item.viewKind === 'list'), `${object.name} expands a list view`);
    for (const item of expanded) ViewItemSchema.parse(item);
    const declared = new Set(Object.keys(object.fields));
    const columns = view.list.columns.map(column => typeof column === 'string' ? column : column.field);
    for (const field of columns) assert.ok(declared.has(field), `${object.name}.${field} is declared`);
    for (const section of view.form.sections) {
      for (const item of section.fields) {
        const field = typeof item === 'string' ? item : item.field;
        assert.ok(declared.has(field), `${object.name}.${field} is declared in ${section.name}`);
      }
    }
  }
});

test('repair pool and part-request pages use formal server-backed objects without fixture rows', () => {
  for (const [page, object] of [[RepairPoolPage, RepairRequest], [ServicePartRequestsPage, ServicePartRequest]]) {
    PageSchema.parse(page);
    assert.equal(page.kind, 'react');
    assert.match(page.source, new RegExp(object.name));
    const result = ts.transpileModule(page.source, {
      fileName: `${page.name}.tsx`,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
    });
    assert.deepEqual(result.diagnostics, [], `${page.name} contains valid embedded JSX`);
    assert.match(page.source, /provider|ListView/);
    assert.doesNotMatch(page.source, /fixtureRows|fakeRows|mockRows/);
  }
});

test('new after-sales codes are native autonumbers and execution histories inherit parent access', () => {
  assert.deepEqual([RepairRequest.fields.code.type, RepairRequest.fields.code.autonumberFormat, RepairRequest.fields.code.unique], ['autonumber', 'RP-{YYYYMMDD}-{0000}', 'global']);
  assert.deepEqual([ServicePartRequest.fields.code.type, ServicePartRequest.fields.code.autonumberFormat, ServicePartRequest.fields.code.unique], ['autonumber', 'SP-{YYYYMMDD}-{0000}', 'global']);
  assert.equal(ServicePartRequestEvent.sharingModel, 'controlled_by_parent');
  assert.equal(WarrantyCardEvent.sharingModel, 'controlled_by_parent');
});

test('normal service-operator page event submits a report through its declared Action and reads it back', async () => {
  const records={forge_repair_request:[]},formValues={source:'一般报修',impact:'单机停机',site:'苏州现场',product_name:'测试设备',product_sn:'SN-EVENT-1',problem:'通信异常',customer_id:null,contact_name:'值班人员',contact_phone:'13800001001',remarks:'事件回归'};
  const harness=createServicePageHarness(RepairPoolPage,{
    permissions:serviceOperatorPermission.systemPermissions,
    records,
    formValues,
    onAction:async({path,body})=>{
      assert.equal(path,'/actions/forge_repair_request/service_repair_request_create');
      const draft=JSON.parse(body.params.draft_json);
      const record={id:'repair-event-1',code:'RP-EVENT-1',name:draft.problem,status:'pending',...draft};
      records.forge_repair_request.push(record);
      return{id:record.id,code:record.code,status:record.status,repeated:false};
    },
  });
  let tree=await harness.flushEffects();
  const create=serviceButton(tree,'新增报修');
  assert.ok(create,'the normal service operator sees the report action; access='+JSON.stringify(harness.states[0])+' calls='+JSON.stringify(harness.calls.map(call=>call.path)));
  create.props.onClick();
  tree=harness.render();
  const form=harness.forms.at(-1);
  assert.equal(form.objectName,'forge_repair_request');
  assert.equal(form.mode,'create');
  assert.equal(form.formType,'simple');
  assert.equal(typeof form.submitHandler,'function');
  assert.equal(typeof form.onControllerReady,'function');
  const submit=serviceButton(tree,'提交报修');
  assert.ok(submit,'the composed dialog renders its submitted event');
  await submit.props.onClick();
  tree=harness.render();
  assert.ok(harness.calls.some(call=>call.method==='GET'&&call.path==='/data/forge_repair_request/repair-event-1'),'the source event independently reads the created report');
  assert.equal(records.forge_repair_request[0].status,'pending');
  assert.ok(harness.states.some(value=>value&&value.tone==='success'&&String(value.text).includes('已保存')),'the successful event displays its read-back result: '+JSON.stringify({states:harness.states,changes:harness.stateChanges,calls:harness.calls}));
  assert.equal(ServiceRepairRequestCreate.objectName,'forge_repair_request');
  assert.deepEqual(ServiceRepairRequestCreate.requiredPermissions,serviceOperatorPermission.systemPermissions);
});

test('service workspace event sends the assigned-order record id to the declared operator Action', async () => {
  const actor='service-page-actor',record={id:'service-order-event-1',code:'WO-EVENT-1',name:'接单事件',status:'pending_receive',engineer_id:actor,owner_id:actor,responsible_id:actor,revision:3,updated_at:'2026-10-04T02:00:00.000Z'};
  const records={forge_service_order:[record]};
  const harness=createServicePageHarness(ServiceWorkspacePage,{
    globals:serviceWorkspaceGlobals,
    permissions:serviceOperatorPermission.systemPermissions,
    users:{id:actor},records,
    onAction:async({path})=>{
      if(path==='/actions/global/organization_business_date_query')return {business_date:'2026-10-05'};
      assert.equal(path,'/actions/forge_service_order/service_order_engineer_accept/service-order-event-1');
      record.status='in_progress';record.revision=4;
      return{id:record.id,status:record.status};
    },
  });
  let tree=await harness.flushEffects();
  serviceNodes(tree,node=>node.type==='StatusTabs'&&node.props['aria-label']==='接单中心工作范围')[0].props.onValueChange('my-orders');
  tree=await harness.flushEffects();
  const row=serviceButton(tree,'WO-EVENT-1');
  assert.ok(row,'the assigned service order appears in the operator workspace list; access='+JSON.stringify(harness.states[0])+' calls='+JSON.stringify(harness.calls.map(call=>call.path)));
  row.props.onClick();
  await new Promise(resolve=>setTimeout(resolve,0));
  tree=harness.render();
  const detailAction=serviceButton(tree,'接单');
  assert.ok(detailAction,'an assigned operator can open the receive action; access='+JSON.stringify(harness.states[0])+' selected='+JSON.stringify(harness.states[5])+' rowProps='+JSON.stringify(row.props,Object.keys(row.props))+' calls='+JSON.stringify(harness.calls.map(call=>call.path)));
  detailAction.props.onClick();
  tree=harness.render();
  const dialogs=serviceNodes(tree,node=>node.type==='CompositeDialog');
  const confirm=serviceButton(dialogs.at(-1),'接单');
  assert.ok(confirm,'the action confirmation is rendered in the public dialog footer');
  await confirm.props.onClick();
  harness.render();
  assert.equal(record.status,'in_progress');
  assert.ok(harness.calls.some(call=>call.method==='GET'&&call.path==='/data/forge_service_order/service-order-event-1'));
  assert.equal(ServiceOrderEngineerAccept.objectName,'forge_service_order');
  assert.deepEqual(ServiceOrderEngineerAccept.requiredPermissions,serviceOperatorPermission.systemPermissions);

  const managerHarness=createServicePageHarness(ServiceWorkspacePage,{
    globals:serviceWorkspaceGlobals,
    permissions:serviceManagerPermission.systemPermissions,manager:true,users:{id:actor},records:{forge_service_order:[{...record,status:'pending_receive',revision:5}]},
  });
  tree=await managerHarness.flushEffects();
  serviceNodes(tree,node=>node.type==='StatusTabs'&&node.props['aria-label']==='接单中心工作范围')[0].props.onValueChange('my-orders');
  tree=await managerHarness.flushEffects();
  serviceButton(tree,'WO-EVENT-1')?.props.onClick();
  await new Promise(resolve=>setTimeout(resolve,0));
  tree=managerHarness.render();
  assert.equal(serviceButton(tree,'接单'),undefined,'the service-manager Action role does not imply service-operator authority');
  assert.equal(warehouseOperatorPermission.systemPermissions.includes('forge_warehouse_operator'),true);
});

test('part-request actions follow the normal actor capabilities declared by native Action permissions', async () => {
  const part={id:'service-part-event-1',code:'SP-EVENT-1',name:'备件事件',status:'open',execution_status:'pending_outbound',revision:1,requested_quantity:2,issued_quantity:0,received_quantity:0,used_quantity:0,returned_quantity:0};
  const records={forge_service_part_request:[part]};
  async function detailFor(permissions,manager=false){
    const harness=createServicePageHarness(ServicePartRequestsPage,{permissions,manager,records});
    let tree=await harness.flushEffects();
    serviceButton(tree,'SP-EVENT-1')?.props.onClick();
    await new Promise(resolve=>setImmediate(resolve));
    return{harness,tree:harness.render()};
  }
  const warehouse=await detailFor(warehouseOperatorPermission.systemPermissions);
  assert.ok(serviceButton(warehouse.tree,'执行出库'),'warehouse operator sees the declared outbound action; states='+JSON.stringify(warehouse.harness.states.map(value=>value&&typeof value==='object'?Object.keys(value):value))+' calls='+JSON.stringify(warehouse.harness.calls.map(call=>call.path)));
  assert.equal(serviceButton(warehouse.tree,'新建备件工单'),undefined,'warehouse operator cannot create a service request');
  const operator=await detailFor(serviceOperatorPermission.systemPermissions);
  assert.equal(serviceButton(operator.tree,'执行出库'),undefined,'service operator cannot run a warehouse-only outbound action');
  assert.ok(serviceButton(operator.tree,'新建备件工单'),'service operator can create a service request');
  const manager=await detailFor(serviceManagerPermission.systemPermissions,true);
  assert.equal(serviceButton(manager.tree,'执行出库'),undefined,'service manager does not inherit the warehouse Action');
  assert.ok(serviceButton(manager.tree,'标记异常'),'service manager sees the manager-only exception action');
});

test('service orders use shared page controls without changing status-filter queries or the dispatch route', async () => {
  const harness = createServicePageHarness(ServiceOrdersPage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    records: { forge_service_order: [] },
  });
  let tree = await harness.flushEffects();
  const header = serviceNodes(tree, node => node.type === 'WorkspaceHeader')[0];
  assert.equal(header.props.variant, 'workspace');
  assert.equal(header.props.title, '服务工单');
  assert.equal(JSON.stringify(header.props.breadcrumbItems.map(item => item.label)), JSON.stringify(['销售管理', '服务管理', '服务工单']));

  const toolbar = serviceNodes(tree, node => node.type === 'WorkspaceToolbar')[0];
  assert.ok(toolbar, 'the order page composes the shared toolbar');
  assert.equal(JSON.stringify(toolbar.props.primaryAction.props.children), JSON.stringify(['新建服务工单']));
  assert.equal(toolbar.props.auxiliaryActions.props.href, '/_console/apps/com.inoforge.forge.sales/page_service_dispatch');
  assert.equal(JSON.stringify(toolbar.props.auxiliaryActions.props.children[0].props.children), JSON.stringify(['下一步操作']));
  assert.equal(JSON.stringify(toolbar.props.auxiliaryActions.props.children[1].props.children), JSON.stringify(['派工中心']));

  const tabs = serviceNodes(tree, node => node.type === 'StatusTabs')[0];
  assert.equal(JSON.stringify(tabs.props.items.map(item => item.value)), JSON.stringify(['all', 'pending_acceptance', 'pending_dispatch', 'pending_receive', 'in_progress', 'completed']));
  tabs.props.onValueChange('pending_dispatch');
  tree = harness.render();
  assert.equal(JSON.stringify(serviceNodes(tree, node => node.type === 'ListView')[0].props.filters), JSON.stringify(['status', '=', 'pending_dispatch']));
  tabs.props.onValueChange('all');
  tree = harness.render();
  assert.equal(serviceNodes(tree, node => node.type === 'ListView')[0].props.filters, undefined);
});

test('dispatch keeps its pending-dispatch ListView while exposing its real dispatch workspaces', async () => {
  const harness = createServicePageHarness(ServiceDispatchPage, {
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    records: { forge_service_order: [] },
  });
  const tree = await harness.flushEffects();
  const header = serviceNodes(tree, node => node.type === 'WorkspaceHeader')[0];
  assert.equal(header.props.variant, 'workspace');
  assert.equal(header.props.title, '派工中心');
  const toolbar = serviceNodes(tree, node => node.type === 'WorkspaceToolbar')[0];
  assert.equal(toolbar.props.auxiliaryActions.props.href, '/_console/apps/com.inoforge.forge.sales/page_service_orders');
  const dispatchTabs = serviceNodes(tree, node => node.type === 'StatusTabs')[0];
  assert.ok(dispatchTabs, 'dispatch workspaces use the public tab controls');
  assert.equal(dispatchTabs.props.items.length, 4);
  assert.equal(JSON.stringify(serviceNodes(tree, node => node.type === 'ListView')[0].props.filters), JSON.stringify(['status', '=', 'pending_dispatch']));
});

test('service workspace related documents follow current assigned service-order engineers', async () => {
  const actor = 'service-workspace-actor';
  const serviceOrder = { id:'service-workspace-order', engineer_id:actor, owner_id:'old-manager', responsible_id:'old-responsible', status:'completed' };
  const harness = createServicePageHarness(ServiceWorkspacePage, {
    globals:serviceWorkspaceGlobals,
    manager: true,
    permissions: serviceManagerPermission.systemPermissions,
    users: { id: actor },
    records: { forge_service_order: [serviceOrder], forge_service_quotation: [], forge_service_settlement: [] },
    onAction: async ({path}) => path === '/actions/global/organization_business_date_query' ? {business_date:'2026-10-05'} : {},
  });
  let tree = await harness.flushEffects();
  const header = serviceNodes(tree, node => node.type === 'WorkspaceHeader')[0];
  assert.equal(header.props.variant, 'workspace');
  assert.equal(header.props.title, '接单中心');
  const toolbar = serviceNodes(tree, node => node.type === 'WorkspaceToolbar')[0];
  const tabs = serviceNodes(tree, node => node.type === 'StatusTabs' && node.props['aria-label'] === '接单中心工作范围')[0];
  assert.equal(toolbar.props.filters, tabs);
  assert.equal(tabs.props.value,'today');
  assert.ok(tabs.props.items.some(item => item.value === 'my-orders'));
  tabs.props.onValueChange('my-quotations');
  tree = await harness.flushEffects();
  const quotationList = serviceNodes(tree, node => node.type === 'ListView')[0];
  assert.equal(quotationList.props.data.object, 'forge_service_quotation');
  assert.equal(JSON.stringify(quotationList.props.filters), JSON.stringify(['service_order_id', 'in', ['service-workspace-order']]));
  assert.equal(quotationList.props.userActions.refresh, false);
  assert.equal(serviceButton(tree, '刷新'), undefined, 'the quotation section has no extra visible refresh button');
  tabs.props.onValueChange('my-settlements');
  tree = await harness.flushEffects();
  const settlementList = serviceNodes(tree, node => node.type === 'ListView')[0];
  assert.equal(settlementList.props.data.object, 'forge_service_settlement');
  assert.equal(JSON.stringify(settlementList.props.filters), JSON.stringify(['service_order_id', 'in', ['service-workspace-order']]));
  assert.equal(settlementList.props.userActions.refresh, false);
  assert.equal(serviceButton(tree, '刷新'), undefined, 'the settlement section has no extra visible refresh button');
  tabs.props.onValueChange('my-orders');
  tree = await harness.flushEffects();
  const personalList = serviceNodes(tree, node => node.type === 'ListView')[0];
  assert.ok(personalList);
  assert.ok(JSON.stringify(personalList.props.filters).includes(actor));
  assert.ok(JSON.stringify(personalList.props.filters).includes('engineer_id'));
});
