import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ProductionShortageCreatePurchaseRequest,
  PurchaseTodoPoolApply,
  PurchaseTodoPoolRead,
} from '../src/actions/production-procurement-handoff.action.ts';
import { ProductionShortageWorkspacePage } from '../src/pages/production-assembly-workspace.page.ts';
import { PurchaseTodoPoolStandalonePage } from '../src/pages/purchase-todo-pool.page.ts';

function executable(action) {
  return new Function('ctx', `return (async () => { ${action.body.source} })()`);
}

function memoryApi(seed = {}) {
  const tables = new Map(Object.entries(seed).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]));
  const writes = [];
  let nextId = 1;
  const api = {
    object(name) {
      if (!tables.has(name)) tables.set(name, []);
      const rows = tables.get(name);
      return {
        async find({ where = {} } = {}) {
          return rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
        },
        async findOne({ where = {} } = {}) {
          return rows.find(row => Object.entries(where).every(([key, value]) => row[key] === value)) || null;
        },
        async insert(row) {
          const saved = { ...row, id: `test-${nextId++}`, organization_id: row.organization_id || 'org-a' };
          rows.push(saved);
          writes.push({ type: 'insert', object: name, row: saved });
          return saved;
        },
        async update(row) {
          const index = rows.findIndex(item => item.id === row.id);
          if (index < 0) throw new Error(`missing ${name}/${row.id}`);
          rows[index] = { ...rows[index], ...row };
          writes.push({ type: 'update', object: name, row: rows[index] });
          return rows[index];
        },
      };
    },
    async transaction(run) { return run(); },
  };
  return { api, tables, writes };
}

function productionFixture(overrides = {}) {
  return memoryApi({
    forge_assembly_material_line: [{ id: 'asm-line-1', assembly_id: 'asm-1', sku_id: 'sku-1', material_id: 'material-1', item_code: 'MAT-1', name: '支架', model: 'M1', specification: 'S1', unit_name: '件', unit_cost: 12, shortage_quantity: 3 }],
    forge_assembly_order: [{ id: 'asm-1', code: 'ASM-2026-0001', status: 'waiting_pick', owner_id: 'prod-1', responsible_id: 'prod-1', organization_id: 'org-a', planned_completion_on: '2026-10-10' }],
    forge_material_sku: [{ id: 'sku-1', material_id: 'material-1', enabled: true, organization_id: 'org-a', cost_price: 12, name: 'S1' }],
    forge_material: [{ id: 'material-1', code: 'MAT-1', name: '支架', model: 'M1', status: 'active', organization_id: 'org-a' }],
    forge_purchase_request: [],
    forge_purchase_request_line: [],
    ...overrides,
  });
}

test('production shortage action creates an actor-owned request and lines in one transaction', async () => {
  const { api, tables } = productionFixture();
  const result = await executable(ProductionShortageCreatePurchaseRequest)({
    session: { userId: 'prod-1', organizationId: 'org-a' },
    input: { source_line_ids_json: JSON.stringify(['asm-line-1']) },
    api,
  });
  const request = tables.get('forge_purchase_request')[0];
  const line = tables.get('forge_purchase_request_line')[0];
  assert.equal(result.status, 'draft');
  assert.equal(request.owner_id, 'prod-1');
  assert.equal(request.responsible_id, 'prod-1');
  assert.equal(line.request_id, request.id);
  assert.equal(line.quantity, 3);
  assert.match(request.remarks, /ASM-2026-0001/);
});

test('production shortage action rejects another employee and stale shortages before writing', async () => {
  const otherOwner = productionFixture();
  await assert.rejects(executable(ProductionShortageCreatePurchaseRequest)({
    session: { userId: 'prod-2', organizationId: 'org-a' },
    input: { source_line_ids_json: JSON.stringify(['asm-line-1']) },
    api: otherOwner.api,
  }), /本人负责/);
  assert.equal(otherOwner.writes.length, 0);

  const stale = productionFixture({
    forge_assembly_material_line: [{ id: 'asm-line-1', assembly_id: 'asm-1', sku_id: 'sku-1', material_id: 'material-1', shortage_quantity: 0 }],
  });
  await assert.rejects(executable(ProductionShortageCreatePurchaseRequest)({
    session: { userId: 'prod-1', organizationId: 'org-a' },
    input: { source_line_ids_json: JSON.stringify(['asm-line-1']) },
    api: stale.api,
  }), /数量发生变化/);
  assert.equal(stale.writes.length, 0);
});

function procurementFixture(pendingOverrides = {}) {
  const pending = { id: 'todo-1', organization_id: 'org-a', responsible_id: 'prod-1', applicant_id: 'prod-1', request_id: 'request-1', request_line_id: 'request-line-1', code: 'POOL-1', name: '支架', item_code: 'MAT-1', model: 'M1', specification: 'S1', unit_name: '件', requested_quantity: 4, locked_quantity: 0, ordered_quantity: 0, remaining_quantity: 4, status: 'ready', ...pendingOverrides };
  return memoryApi({
    forge_purchase_pending_item: [pending],
    forge_purchase_request: [{ id: 'request-1', organization_id: 'org-a', owner_id: 'prod-1', responsible_id: 'prod-1', submitted_by: 'prod-1', status: 'approved', code: 'PR-2026-0001', name: '生产缺料申请', currency: 'cny' }],
    forge_purchase_request_line: [{ id: 'request-line-1', organization_id: 'org-a', request_id: 'request-1', sku_id: 'sku-1', name: '支架', item_code: 'MAT-1', model: 'M1', specification: 'S1', unit_name: '件', quantity: 4, taxed_unit_price: 25, tax_rate: 13 }],
    forge_supplier: [{ id: 'supplier-1', organization_id: 'org-a', name: '合格供应商', status: 'active', approval_status: 'approved' }],
    forge_warehouse: [{ id: 'warehouse-1', organization_id: 'org-a', name: '成品仓' }],
    forge_material_sku: [{ id: 'sku-1', organization_id: 'org-a', material_id: 'material-1', enabled: true, name: 'S1' }],
    forge_material: [{ id: 'material-1', organization_id: 'org-a', code: 'MAT-1', name: '支架', model: 'M1', status: 'active', unit_name: '件' }],
    forge_purchase_order: [],
    forge_purchase_order_line: [],
  });
}

test('purchase todo action lets a buyer process the approved role queue and claims the todo atomically', async () => {
  const { api, tables } = procurementFixture();
  const result = await executable(PurchaseTodoPoolApply)({
    session: { userId: 'buyer-1', organizationId: 'org-a' },
    input: { operation: 'order', item_ids_json: JSON.stringify(['todo-1']), supplier_id: 'supplier-1', warehouse_id: 'warehouse-1', expected_arrival_on: '2026-10-20', payment_term: '到货后30天', payment_method: 'bank_transfer' },
    api,
  });
  assert.equal(result.status, 'draft');
  assert.equal(tables.get('forge_purchase_order').length, 1);
  assert.equal(tables.get('forge_purchase_order_line').length, 1);
  assert.equal(tables.get('forge_purchase_order_line')[0].quantity, 4);
  assert.equal(tables.get('forge_purchase_pending_item')[0].status, 'ordered');
  assert.equal(tables.get('forge_purchase_pending_item')[0].remaining_quantity, 0);
  assert.equal(tables.get('forge_purchase_pending_item')[0].responsible_id, 'buyer-1');
});

test('a buyer can order a todo after claiming it by assigning a supplier', async () => {
  const { api, tables } = procurementFixture();
  const session = { userId: 'buyer-1', organizationId: 'org-a' };
  await executable(PurchaseTodoPoolApply)({
    session,
    input: { operation: 'assign', item_ids_json: JSON.stringify(['todo-1']), supplier_id: 'supplier-1' },
    api,
  });
  assert.equal(tables.get('forge_purchase_pending_item')[0].owner_id, 'buyer-1');
  assert.equal(tables.get('forge_purchase_pending_item')[0].responsible_id, 'buyer-1');
  const result = await executable(PurchaseTodoPoolApply)({
    session,
    input: { operation: 'order', item_ids_json: JSON.stringify(['todo-1']), supplier_id: 'supplier-1', warehouse_id: 'warehouse-1', expected_arrival_on: '2026-10-20', payment_term: '到货后30天', payment_method: 'bank_transfer' },
    api,
  });
  assert.equal(result.status, 'draft');
  assert.equal(tables.get('forge_purchase_pending_item')[0].status, 'ordered');
});

test('purchase todo read returns the organization queue and excludes other organizations', async () => {
  const { api } = memoryApi({
    forge_purchase_pending_item: [
      { id: 'mine', organization_id: 'org-a', responsible_id: 'buyer-1', status: 'ready' },
      { id: 'other-user', organization_id: 'org-a', responsible_id: 'buyer-2', status: 'ready' },
      { id: 'other-org', organization_id: 'org-b', responsible_id: 'buyer-1', status: 'ready' },
    ],
  });
  const result = await executable(PurchaseTodoPoolRead)({
    session: { userId: 'buyer-1', organizationId: 'org-a' },
    input: {},
    api,
  });
  assert.equal(result.actor_id, 'buyer-1');
  assert.deepEqual(result.records.map(row => row.id), ['mine', 'other-user']);
});

test('purchase todo action rejects a todo detached from its source request and stale quantities', async () => {
  const foreign = procurementFixture({ applicant_id: 'other-applicant' });
  await assert.rejects(executable(PurchaseTodoPoolApply)({
    session: { userId: 'buyer-1', organizationId: 'org-a' },
    input: { operation: 'order', item_ids_json: JSON.stringify(['todo-1']), supplier_id: 'supplier-1', warehouse_id: 'warehouse-1', expected_arrival_on: '2026-10-20', payment_term: '到货后30天', payment_method: 'bank_transfer' },
    api: foreign.api,
  }), /来源申请归属不匹配/);
  assert.equal(foreign.writes.length, 0);

  const stale = procurementFixture({ remaining_quantity: 3 });
  await assert.rejects(executable(PurchaseTodoPoolApply)({
    session: { userId: 'buyer-1', organizationId: 'org-a' },
    input: { operation: 'order', item_ids_json: JSON.stringify(['todo-1']), supplier_id: 'supplier-1', warehouse_id: 'warehouse-1', expected_arrival_on: '2026-10-20', payment_term: '到货后30天', payment_method: 'bank_transfer' },
    api: stale.api,
  }), /数量与来源申请不一致/);
  assert.equal(stale.tables.get('forge_purchase_order').length, 0);
});

test('pages preserve their normal entry and no longer write procurement business records directly', async () => {
  const production = ProductionShortageWorkspacePage.source;
  const todo = PurchaseTodoPoolStandalonePage.source;
  assert.match(production, /production_shortage_create_purchase_request/);
  assert.doesNotMatch(production, /request\('\/data\/forge_purchase_request/);
  assert.doesNotMatch(production, /find\('sys_user'\)/);
  assert.match(todo, /purchase_todo_pool_read/);
  assert.match(todo, /purchase_todo_pool_apply/);
  assert.doesNotMatch(todo, /request\('\/data\/forge_purchase_(?:pending_item|order|order_line)[^,]*',\{method:'(?:POST|PATCH|DELETE)'/);
  assert.ok((await readFile(new URL('../src/pages/purchase-todo-pool.page.ts', import.meta.url), 'utf8')).includes('page_purchase_todo_pool'));
});

test('all new actions are capability-gated by the correct business role', () => {
  assert.deepEqual(ProductionShortageCreatePurchaseRequest.requiredPermissions, ['forge_production_operator']);
  assert.deepEqual(PurchaseTodoPoolRead.requiredPermissions, ['forge_procurement_operator']);
  assert.deepEqual(PurchaseTodoPoolApply.requiredPermissions, ['forge_procurement_operator']);
});
