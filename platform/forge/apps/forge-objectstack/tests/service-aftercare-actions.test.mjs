import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceOrderComplete } from '../src/actions/sales.action.ts';
import {
  ServiceConfigUpdate,
  ServiceOrderAttachEvidence,
  WarrantyCardActivate,
} from '../src/actions/service-workspace.action.ts';
import {
  ServicePartRequestOutbound,
  ServicePartRequestReturn,
  ServiceRepairRequestConvertToOrder,
} from '../src/actions/service-aftercare.action.ts';

function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && ('$gte' in expected || '$lt' in expected)) {
      const value = Date.parse(String(actual || ''));
      return (!('$gte' in expected) || value >= Date.parse(expected.$gte)) && (!('$lt' in expected) || value < Date.parse(expected.$lt));
    }
    if (expected === null) return actual == null;
    return String(actual) === String(expected);
  });
}

function makeContext(tables, { objectName, recordId, input = {}, actor = 'engineer-1', organizationId = 'org-1' }) {
  let inserted = 0;
  const writes = [];
  const api = {
    object(name) {
      const rows = tables[name] || (tables[name] = []);
      return {
        async findOne({ where } = {}) { return rows.find(row => matches(row, where)) || null; },
        async find({ where } = {}) { return rows.filter(row => matches(row, where)); },
        async insert(value) {
          const row = { ...value, id: value.id || `${name}-${++inserted}` };
          rows.push(row);
          writes.push({ operation: 'insert', object: name, row });
          return { ...row };
        },
        async update(value, options = {}) {
          const targets = rows.filter(row => matches(row, options.where || (value.id ? { id: value.id } : {})));
          for (const row of targets) Object.assign(row, value);
          if (targets.length) writes.push({ operation: 'update', object: name, rows: targets });
          return targets.length;
        },
        async delete({ where } = {}) {
          const before = rows.length;
          tables[name] = rows.filter(row => !matches(row, where));
          const deleted = before - tables[name].length;
          if (deleted) writes.push({ operation: 'delete', object: name, deleted });
          return deleted;
        },
      };
    },
    async transaction(callback) { return callback(); },
  };
  const record = (tables[objectName] || []).find(row => String(row.id) === String(recordId)) || null;
  return {
    context: {
      recordId,
      record,
      input,
      recordLoadDenied: false,
      session: { userId: actor, organizationId },
      user: { id: actor, organizationId },
      api,
    },
    writes,
  };
}

async function execute(action, ctx) {
  return new Function('ctx', `return (async()=>{${action.body.source}\n})()`)(ctx);
}

const order = (extra = {}) => ({
  id: 'service-order-1', organization_id: 'org-1', status: 'in_progress',
  engineer_id: 'engineer-1', owner_id: 'engineer-1', responsible_id: 'engineer-1',
  updated_at: '2026-10-03T02:00:00.000Z', service_hours: null,
  onsite_evidence_attachments: [], ...extra,
});

test('service completion rejects a legacy evidence count and requires committed sys_file ownership on the order field', async () => {
  const legacyTables = { forge_service_order: [order({ onsite_evidence_count: 4 })], sys_file: [] };
  const legacy = makeContext(legacyTables, {
    objectName: 'forge_service_order', recordId: 'service-order-1',
    input: { service_hours: 1, treatment_record: '已更换接线端子', service_result: '恢复运行' },
  });
  await assert.rejects(execute(ServiceOrderComplete, legacy.context), /上传并关联至少一张现场处理图片/);
  assert.equal(legacy.writes.length, 0);

  const record = order({ onsite_evidence_attachments: ['file-1'] });
  const tables = {
    forge_service_order: [record],
    sys_file: [{ id: 'file-1', status: 'committed', owner_id: 'engineer-1', organization_id: 'org-1', mime_type: 'image/jpeg', ref_object: 'forge_service_order', ref_id: record.id, ref_field: 'onsite_evidence_attachments' }],
  };
  const valid = makeContext(tables, {
    objectName: 'forge_service_order', recordId: record.id,
    input: { service_hours: 1.5, treatment_record: '更换接线端子', service_result: '设备恢复运行' },
  });
  const result = await execute(ServiceOrderComplete, valid.context);
  assert.equal(result.status, 'completed');
  assert.deepEqual(record.onsite_evidence_attachments, ['file-1']);
  assert.equal(record.status, 'completed');
});

test('service evidence attachment rejects foreign-org files and stale order reads before version writes', async () => {
  const crossOrg = order();
  const denied = makeContext({
    forge_service_order: [crossOrg],
    sys_file: [{ id: 'file-other-org', status: 'committed', owner_id: 'engineer-1', organization_id: 'org-2', mime_type: 'image/png' }],
  }, { objectName: 'forge_service_order', recordId: crossOrg.id, input: { file_ids: JSON.stringify(['file-other-org']), expected_updated_at: crossOrg.updated_at } });
  await assert.rejects(execute(ServiceOrderAttachEvidence, denied.context), /不属于当前员工及组织/);
  assert.deepEqual(crossOrg.onsite_evidence_attachments, []);
  assert.equal(denied.writes.length, 0);

  const staleRecord = order();
  const stale = makeContext({
    forge_service_order: [staleRecord],
    sys_file: [{ id: 'file-own', status: 'committed', owner_id: 'engineer-1', organization_id: 'org-1', mime_type: 'image/png' }],
  }, { objectName: 'forge_service_order', recordId: staleRecord.id, input: { file_ids: JSON.stringify(['file-own']), expected_updated_at: '2026-10-03T01:00:00.000Z' } });
  await assert.rejects(execute(ServiceOrderAttachEvidence, stale.context), /已被其他操作修改/);
  assert.equal(stale.writes.length, 0);
});

test('warranty activation is organization-scoped, revision-checked and idempotently audited', async () => {
  const card = { id: 'warranty-1', organization_id: 'org-1', status: 'pending_activation', revision: 2, starts_on: null, ends_on: null };
  const tables = { forge_warranty_card: [card], forge_warranty_card_event: [] };
  const args = {
    objectName: 'forge_warranty_card', recordId: card.id,
    input: { starts_on: '2026-10-01', ends_on: '2027-10-01', expected_revision: 2, idempotency_key: 'activate-once' },
  };
  const { context, writes } = makeContext(tables, args);
  const result = await execute(WarrantyCardActivate, context);
  assert.equal(result.status, 'active');
  assert.equal(card.status, 'active');
  assert.equal(card.revision, 3);
  assert.equal(tables.forge_warranty_card_event.length, 1);
  assert.equal(tables.forge_warranty_card_event[0].event_type, 'activated');

  const retry = makeContext(tables, { ...args, input: { ...args.input, expected_revision: 2 } });
  const repeated = await execute(WarrantyCardActivate, retry.context);
  assert.equal(repeated.repeated, true);
  assert.equal(writes.filter(write => write.operation === 'insert').length, 1);
  const stale = makeContext({ forge_warranty_card: [{ ...card, status: 'pending_activation', revision: 4 }], forge_warranty_card_event: [] }, { ...args, input: { ...args.input, expected_revision: 2, idempotency_key: 'stale' } });
  await assert.rejects(execute(WarrantyCardActivate, stale.context), /已被其他操作修改/);
});

test('service configuration edits fail closed on stale revisions', async () => {
  const current = { id: 'config-1', organization_id: 'org-1', name: '检修', code: 'SVC-REPAIR', category: 'order_type', status: 'active', revision: 3 };
  const draft = { name: '现场检修', code: 'SVC-REPAIR', category: 'order_type', status: 'active', description: '上门检修', remarks: '' };
  const ok = makeContext({ forge_service_config_item: [current] }, { objectName: 'forge_service_config_item', recordId: current.id, input: { draft_json: JSON.stringify(draft), expected_revision: 3 } });
  const result = await execute(ServiceConfigUpdate, ok.context);
  assert.equal(result.name, '现场检修');
  assert.equal(current.revision, 4);

  const staleRow = { ...current, revision: 5 };
  const stale = makeContext({ forge_service_config_item: [staleRow] }, { objectName: 'forge_service_config_item', recordId: staleRow.id, input: { draft_json: JSON.stringify(draft), expected_revision: 4 } });
  await assert.rejects(execute(ServiceConfigUpdate, stale.context), /已被其他操作修改/);
  assert.equal(stale.writes.length, 0);
});

test('repair conversion creates an in-org service order and CAS-links the source report', async () => {
  const repair = { id: 'repair-1', organization_id: 'org-1', status: 'pending', revision: 1, code: 'RP-1', name: '电机异响', problem: '电机异响', product_name: '电机', source: '一般报修', contact_phone: '' };
  const customer = { id: 'customer-1', organization_id: 'org-1', name: '客户甲' };
  const tables = { forge_repair_request: [repair], forge_customer: [customer], forge_contact: [], forge_service_order: [] };
  const { context } = makeContext(tables, {
    objectName: 'forge_repair_request', recordId: repair.id,
    input: { customer_id: { id: customer.id }, service_mode: 'onsite', urgency: 'high', expected_revision: 1 },
    actor: 'service-manager',
  });
  const result = await execute(ServiceRepairRequestConvertToOrder, context);
  assert.equal(repair.status, 'converted');
  assert.equal(repair.service_order_id, result.service_order_id);
  assert.equal(tables.forge_service_order[0].customer_id, customer.id);
  assert.equal(tables.forge_service_order[0].repair_request_id, repair.id);
});

test('part outbound and return mutate inventory balance and create linked real ledger rows', async () => {
  const request = { id: 'part-1', organization_id: 'org-1', code: 'SP-1', status: 'open', execution_status: 'pending_outbound', revision: 1, warehouse_id: 'warehouse-1', sku_id: 'sku-1', requested_quantity: 3, issued_quantity: 0, received_quantity: 0, used_quantity: 0, returned_quantity: 0 };
  const balance = { id: 'balance-1', organization_id: 'org-1', balance_key: 'warehouse-1:sku-1', warehouse_id: 'warehouse-1', sku_id: 'sku-1', on_hand_quantity: 10, reserved_quantity: 1, available_quantity: 9, average_cost: 2, inventory_value: 20, updated_at: '2026-10-03T02:00:00.000Z' };
  const tables = {
    forge_service_part_request: [request], forge_service_part_request_event: [],
    forge_inventory_balance: [balance], forge_inventory_ledger: [],
    forge_material_sku: [{ id: 'sku-1', organization_id: 'org-1', material_id: 'material-1', enabled: true }],
    forge_material: [{ id: 'material-1', organization_id: 'org-1', status: 'active' }],
    forge_warehouse: [{ id: 'warehouse-1', organization_id: 'org-1' }],
  };
  const outbound = makeContext(tables, { objectName: 'forge_service_part_request', recordId: request.id, input: { quantity: 3, expected_revision: 1, idempotency_key: 'issue-1', note: '服务领用' }, actor: 'warehouse-1' });
  const issued = await execute(ServicePartRequestOutbound, outbound.context);
  assert.equal(issued.execution_status, 'outbounded');
  assert.equal(balance.on_hand_quantity, 7);
  assert.equal(balance.available_quantity, 6);
  assert.equal(balance.inventory_value, 14);
  assert.equal(tables.forge_inventory_ledger[0].direction, 'outbound');
  assert.equal(tables.forge_inventory_ledger[0].movement_type, 'other_outbound');
  assert.equal(tables.forge_inventory_ledger[0].source_id, request.id);
  assert.equal(request.inventory_issue_ledger_id, issued.inventory_ledger_id);

  const retry = makeContext(tables, { objectName: 'forge_service_part_request', recordId: request.id, input: { quantity: 3, expected_revision: 1, idempotency_key: 'issue-1', note: '服务领用' }, actor: 'warehouse-1' });
  assert.equal((await execute(ServicePartRequestOutbound, retry.context)).repeated, true);
  assert.equal(balance.on_hand_quantity, 7);
  assert.equal(tables.forge_inventory_ledger.length, 1);

  request.execution_status = 'received'; request.received_quantity = 3; request.used_quantity = 1; request.revision = 2;
  const returned = makeContext(tables, { objectName: 'forge_service_part_request', recordId: request.id, input: { quantity: 2, expected_revision: 2, idempotency_key: 'return-1', note: '剩余备件退库' }, actor: 'warehouse-1' });
  const result = await execute(ServicePartRequestReturn, returned.context);
  assert.equal(result.execution_status, 'used');
  assert.equal(balance.on_hand_quantity, 9);
  assert.equal(balance.available_quantity, 8);
  assert.equal(tables.forge_inventory_ledger[1].direction, 'inbound');
  assert.equal(tables.forge_inventory_ledger[1].movement_type, 'other_inbound');
  assert.equal(tables.forge_inventory_ledger[1].quantity, 2);
});
