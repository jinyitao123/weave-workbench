import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  PurchaseInquiryAddLine,
  PurchaseInquiryClose,
  PurchaseInquiryConvertToOrder,
  PurchaseInquiryCreateDraft,
  PurchaseInquiryInviteSupplier,
  PurchaseInquiryPublish,
  PurchaseInquiryRemoveLine,
  PurchaseInquirySaveQuote,
  PurchaseInquirySelectQuote,
  PurchaseInquiryWorkspaceRead,
} from '../src/actions/procurement.action.ts';

const actionMap = new Map([
  [PurchaseInquiryWorkspaceRead.name, PurchaseInquiryWorkspaceRead],
  [PurchaseInquiryCreateDraft.name, PurchaseInquiryCreateDraft],
  [PurchaseInquiryAddLine.name, PurchaseInquiryAddLine],
  [PurchaseInquiryRemoveLine.name, PurchaseInquiryRemoveLine],
  [PurchaseInquiryInviteSupplier.name, PurchaseInquiryInviteSupplier],
  [PurchaseInquiryPublish.name, PurchaseInquiryPublish],
  [PurchaseInquirySaveQuote.name, PurchaseInquirySaveQuote],
  [PurchaseInquirySelectQuote.name, PurchaseInquirySelectQuote],
  [PurchaseInquiryConvertToOrder.name, PurchaseInquiryConvertToOrder],
  [PurchaseInquiryClose.name, PurchaseInquiryClose],
]);

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function fixture() {
  return {
    sys_user: [{ id: 'buyer-1', name: '采购经办一' }],
    forge_project: [{ id: 'project-1', organization_id: 'org-1', name: '项目甲', manager_id: 'buyer-1' }],
    forge_supplier: [{ id: 'supplier-1', organization_id: 'org-1', name: '供应商甲', status: 'active', approval_status: 'approved' }],
    forge_material: [{ id: 'material-1', organization_id: 'org-1', name: '控制器', code: 'MAT-1', status: 'active', unit_name: '件' }],
    forge_material_sku: [{ id: 'sku-1', organization_id: 'org-1', name: '标准规格', code: 'SKU-1', material_id: 'material-1', enabled: true }],
    forge_warehouse: [{ id: 'warehouse-1', organization_id: 'org-1', name: '主仓' }],
    forge_purchase_request: [{ id: 'request-1', organization_id: 'org-1', code: 'PR-1', name: '申请一', status: 'approved', responsible_id: 'applicant-1', submitted_by: 'applicant-1', project_id: 'project-1' }],
    forge_purchase_request_line: [{ id: 'request-line-1', organization_id: 'org-1', request_id: 'request-1', name: '控制器', sku_id: 'sku-1', item_code: 'MAT-1', quantity: 10, unit_name: '件', expected_arrival_on: '2026-10-10' }],
    forge_purchase_pending_item: [{ id: 'pending-1', organization_id: 'org-1', code: 'POOL-1', request_id: 'request-1', request_line_id: 'request-line-1', request_code: 'PR-1', applicant_id: 'applicant-1', responsible_id: 'applicant-1', project_id: 'project-1', requested_quantity: 10, locked_quantity: 0, ordered_quantity: 0, remaining_quantity: 10, assigned_supplier_id: null, inquiry_id: null, status: 'ready' }],
    forge_sales_contract: [{ id: 'contract-1', organization_id: 'org-1', code: 'SC-1', name: '合同甲', status: 'active', project_id: 'project-1', total_amount: 999999 }],
    forge_sales_contract_line: [{ id: 'contract-line-1', organization_id: 'org-1', contract_id: 'contract-1', name: '控制器', sku_id: 'sku-1', item_code: 'MAT-1', quantity_limit: 10, taxed_unit_price: 99999 }],
    forge_purchase_inquiry: [],
    forge_purchase_inquiry_line: [],
    forge_purchase_inquiry_quote: [],
    forge_purchase_inquiry_quote_line: [],
    forge_purchase_order: [],
    forge_purchase_order_line: [],
    forge_purchase_order_approval_log: [],
  };
}

function context(store, { actor = 'buyer-1', organizationId = 'org-1', failUpdateObject = '' } = {}) {
  let nextId = 1;
  const object = name => ({
    find: async ({ where = {} } = {}) => (store[name] || []).filter(row => Object.entries(where).every(([key, value]) => row[key] === value)),
    findOne: async ({ where = {} } = {}) => (store[name] || []).find(row => Object.entries(where).every(([key, value]) => row[key] === value)) || null,
    insert: async values => {
      const row = { id: `made-${nextId++}`, organization_id: organizationId, created_by: actor, ...values };
      (store[name] ||= []).push(row);
      return { id: row.id };
    },
    update: async values => {
      if (failUpdateObject === name) throw new Error('injected update failure');
      const row = (store[name] || []).find(item => item.id === values.id);
      if (!row) throw new Error(`missing ${name} ${values.id}`);
      Object.assign(row, values);
      return row;
    },
    delete: async ({ where = {} } = {}) => {
      store[name] = (store[name] || []).filter(row => !Object.entries(where).every(([key, value]) => row[key] === value));
    },
  });
  return {
    session: { userId: actor, organizationId },
    user: { id: actor, organizationId },
    input: {},
    api: {
      object,
      transaction: async fn => {
        const snapshot = structuredClone(store);
        try { return await fn(); }
        catch (error) {
          for (const key of Object.keys(store)) delete store[key];
          Object.assign(store, snapshot);
          throw error;
        }
      },
    },
  };
}

async function invoke(action, ctx, payload = {}) {
  ctx.input = action === PurchaseInquiryWorkspaceRead ? {} : { payload_json: JSON.stringify(payload) };
  return new AsyncFunction('ctx', action.body.source)(ctx);
}

test('inquiry actions are gated to procurement operators and the page has no generic writes', async () => {
  for (const action of actionMap.values()) assert.deepEqual(action.requiredPermissions, ['forge_procurement_operator'], action.name);
  const page = await readFile(new URL('../src/pages/purchase-inquiry.page.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /request\(['"]\/data\/[^'"]+['"]\s*,\s*\{\s*method\s*:\s*['"](?:POST|PATCH|DELETE)['"]/s);
  for (const name of [...actionMap.keys()].filter(name => name !== PurchaseInquiryWorkspaceRead.name)) assert.match(page, new RegExp(`invokeAction\\('${name}'`));
  assert.match(page, /purchase_inquiry_workspace_read/);
});

test('unclaimed request todo is claimed by the acting purchaser, then converted exactly once', async () => {
  const store = fixture(), ctx = context(store);
  const read = await invoke(PurchaseInquiryWorkspaceRead, ctx);
  assert.equal(read.pendingItems[0].id, 'pending-1');
  assert.equal('total_amount' in read.contracts[0], false);
  assert.equal('taxed_unit_price' in read.contractLines[0], false);

  const inquiry = await invoke(PurchaseInquiryCreateDraft, ctx, {
    name: '申请一询价', code: 'RFQ-1', source_type: 'purchase_request', source_id: 'request-1',
    project_id: 'project-1', due_on: '2026-12-31', pending_ids: ['pending-1'],
  });
  assert.equal(inquiry.line_count, 1);
  assert.deepEqual(
    { owner_id: store.forge_purchase_pending_item[0].owner_id, responsible_id: store.forge_purchase_pending_item[0].responsible_id, inquiry_id: store.forge_purchase_pending_item[0].inquiry_id, status: store.forge_purchase_pending_item[0].status },
    { owner_id: 'buyer-1', responsible_id: 'buyer-1', inquiry_id: inquiry.id, status: 'inquiring' },
  );

  const invited = await invoke(PurchaseInquiryInviteSupplier, ctx, { inquiry_id: inquiry.id, supplier_id: 'supplier-1' });
  await invoke(PurchaseInquiryPublish, ctx, { inquiry_id: inquiry.id });
  await invoke(PurchaseInquirySaveQuote, ctx, {
    inquiry_id: inquiry.id, quote_id: invited.quote_id, lead_days: 7, valid_until: '2026-12-30', payment_term: '到货验收后付款',
    lines: [{ inquiry_line_id: store.forge_purchase_inquiry_line[0].id, taxed_unit_price: 100, tax_rate: 13 }],
  });
  await invoke(PurchaseInquirySelectQuote, ctx, { inquiry_id: inquiry.id, quote_id: invited.quote_id });
  const order = await invoke(PurchaseInquiryConvertToOrder, ctx, {
    inquiry_id: inquiry.id, quote_id: invited.quote_id, warehouse_id: 'warehouse-1', expected_arrival_on: '2026-10-10', payment_term: '到货验收后付款',
  });
  assert.equal(order.status, 'pending_approval');
  assert.deepEqual(
    { inquiry_status: store.forge_purchase_inquiry[0].status, order_id: store.forge_purchase_inquiry[0].converted_order_id, pending_status: store.forge_purchase_pending_item[0].status, pending_remaining: store.forge_purchase_pending_item[0].remaining_quantity, order_line_quantity: store.forge_purchase_order_line[0].quantity },
    { inquiry_status: 'converted', order_id: order.id, pending_status: 'ordered', pending_remaining: 0, order_line_quantity: 10 },
  );
  const repeated = await invoke(PurchaseInquiryConvertToOrder, ctx, { inquiry_id: inquiry.id, warehouse_id: 'warehouse-1', expected_arrival_on: '2026-10-10', payment_term: '到货验收后付款' });
  assert.equal(repeated.id, order.id);
  assert.equal(repeated.repeated, true);
  assert.equal(store.forge_purchase_order.length, 1);
});

test('unrelated project, another purchaser, and invalid source todo are rejected', async () => {
  const store = fixture(), ctx = context(store);
  store.forge_project.push({ id: 'project-2', organization_id: 'org-1', name: '他人项目', manager_id: 'buyer-2' });
  store.forge_sales_contract.push({ id: 'contract-2', organization_id: 'org-1', code: 'SC-2', name: '他人项目合同', status: 'active', project_id: 'project-2', total_amount: 888888 });
  store.forge_sales_contract_line.push({ id: 'contract-line-2', organization_id: 'org-1', contract_id: 'contract-2', name: '他人合同物料', sku_id: 'sku-1', quantity_limit: 4, taxed_unit_price: 77777 });
  const workspace = await invoke(PurchaseInquiryWorkspaceRead, ctx);
  assert.equal(workspace.contracts.some(row => row.id === 'contract-2'), false);
  await assert.rejects(() => invoke(PurchaseInquiryCreateDraft, ctx, {
    name: '越权项目询价', code: 'RFQ-X', source_type: 'manual', project_id: 'project-2', due_on: '2026-12-31',
  }), /本人负责/);
  await assert.rejects(() => invoke(PurchaseInquiryCreateDraft, ctx, {
    name: '越权合同询价', code: 'RFQ-C', source_type: 'sales_contract', source_id: 'contract-2', due_on: '2026-12-31',
  }), /本人负责项目或合法采购待办关联项目/);
  Object.assign(store.forge_purchase_pending_item[0], { owner_id: 'buyer-3', responsible_id: 'buyer-3', assigned_supplier_id: 'supplier-1', status: 'assigned' });
  await assert.rejects(() => invoke(PurchaseInquiryCreateDraft, context(store, { actor: 'buyer-2' }), {
    name: '错误来源询价', code: 'RFQ-Y', source_type: 'purchase_request', source_id: 'request-1', due_on: '2026-12-31', pending_ids: ['pending-1'],
  }), /采购待办已由其他经办人认领/);
  Object.assign(store.forge_purchase_pending_item[0], { owner_id: undefined, responsible_id: 'applicant-1', assigned_supplier_id: null, status: 'ready' });
  const inquiry = await invoke(PurchaseInquiryCreateDraft, ctx, {
    name: '申请一询价', code: 'RFQ-2', source_type: 'purchase_request', source_id: 'request-1', due_on: '2026-12-31', pending_ids: ['pending-1'],
  });
  await assert.rejects(() => invoke(PurchaseInquiryClose, context(store, { actor: 'buyer-2' }), { inquiry_id: inquiry.id }), /本人负责/);
});

test('project member may use a contract linked to the project without receiving its financial fields', async () => {
  const store = fixture(), ctx = context(store);
  store.forge_project.push({ id: 'project-member', organization_id: 'org-1', name: '成员项目', status: 'in_progress' });
  store.forge_project_member = [{ id: 'member-1', organization_id: 'org-1', project_id: 'project-member', user_id: 'buyer-1', active: true }];
  store.forge_sales_contract.push({ id: 'contract-member', organization_id: 'org-1', code: 'SC-M', name: '成员项目合同', status: 'active', total_amount: 999999 });
  store.forge_sales_contract_line.push({ id: 'contract-member-line', organization_id: 'org-1', contract_id: 'contract-member', name: '计划物料', sku_id: 'sku-1', quantity_limit: 5, taxed_unit_price: 99999 });
  store.forge_project_sales_link = [{ id: 'link-1', organization_id: 'org-1', project_id: 'project-member', contract_id: 'contract-member', order_id: 'order-1' }];
  const workspace = await invoke(PurchaseInquiryWorkspaceRead, ctx);
  const contract = workspace.contracts.find(row => row.id === 'contract-member');
  assert.equal(contract.project_id, 'project-member');
  assert.equal('total_amount' in contract, false);
  const inquiry = await invoke(PurchaseInquiryCreateDraft, ctx, {
    name: '成员项目询价', code: 'RFQ-M', source_type: 'sales_contract', source_id: 'contract-member', due_on: '2026-12-31',
  });
  assert.equal(store.forge_purchase_inquiry.find(row => row.id === inquiry.id).project_id, 'project-member');
  assert.equal(store.forge_purchase_inquiry_line[0].quantity, 5);
});

test('conversion rolls back order, lines, logs, todo, and inquiry when a write fails', async () => {
  const store = fixture(), ctx = context(store);
  const inquiry = await invoke(PurchaseInquiryCreateDraft, ctx, {
    name: '申请一询价', code: 'RFQ-3', source_type: 'purchase_request', source_id: 'request-1', due_on: '2026-12-31', pending_ids: ['pending-1'],
  });
  const invited = await invoke(PurchaseInquiryInviteSupplier, ctx, { inquiry_id: inquiry.id, supplier_id: 'supplier-1' });
  await invoke(PurchaseInquiryPublish, ctx, { inquiry_id: inquiry.id });
  await invoke(PurchaseInquirySaveQuote, ctx, {
    inquiry_id: inquiry.id, quote_id: invited.quote_id, lead_days: 7, valid_until: '2026-12-30', payment_term: '到货验收后付款',
    lines: [{ inquiry_line_id: store.forge_purchase_inquiry_line[0].id, taxed_unit_price: 100, tax_rate: 13 }],
  });
  await invoke(PurchaseInquirySelectQuote, ctx, { inquiry_id: inquiry.id, quote_id: invited.quote_id });
  const failing = context(store, { failUpdateObject: 'forge_purchase_pending_item' });
  await assert.rejects(() => invoke(PurchaseInquiryConvertToOrder, failing, {
    inquiry_id: inquiry.id, warehouse_id: 'warehouse-1', expected_arrival_on: '2026-10-10', payment_term: '到货验收后付款',
  }), /injected update failure/);
  assert.equal(store.forge_purchase_order.length, 0);
  assert.equal(store.forge_purchase_order_line.length, 0);
  assert.equal(store.forge_purchase_order_approval_log.length, 0);
  assert.equal(store.forge_purchase_inquiry[0].status, 'compared');
  assert.equal(store.forge_purchase_pending_item[0].status, 'inquiring');
});

test('manual line add/remove and close use the Action lifecycle and release the claimed todo', async () => {
  const store = fixture(), ctx = context(store);
  const inquiry = await invoke(PurchaseInquiryCreateDraft, ctx, {
    name: '申请一询价', code: 'RFQ-4', source_type: 'purchase_request', source_id: 'request-1', due_on: '2026-12-31', pending_ids: ['pending-1'],
  });
  const line = await invoke(PurchaseInquiryAddLine, ctx, {
    inquiry_id: inquiry.id, sku_id: 'sku-1', quantity: 2, required_on: '2026-10-10', remarks: '补充行',
  });
  assert.equal(line.line_count, 2);
  const addedLine = store.forge_purchase_inquiry_line.find(row => row.remarks === '补充行');
  await invoke(PurchaseInquiryRemoveLine, ctx, { inquiry_id: inquiry.id, line_id: addedLine.id });
  assert.equal(store.forge_purchase_inquiry.find(row => row.id === inquiry.id).line_count, 1);
  await invoke(PurchaseInquiryClose, ctx, { inquiry_id: inquiry.id });
  assert.equal(store.forge_purchase_inquiry.find(row => row.id === inquiry.id).status, 'closed');
  assert.deepEqual(
    { inquiry_id: store.forge_purchase_pending_item[0].inquiry_id, status: store.forge_purchase_pending_item[0].status, responsible_id: store.forge_purchase_pending_item[0].responsible_id },
    { inquiry_id: null, status: 'ready', responsible_id: 'buyer-1' },
  );
});
