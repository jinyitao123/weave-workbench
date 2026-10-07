import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { QuickJSScriptRunner, actionBodyRunnerFactory } from '@objectstack/runtime';
import { ServicePartRequestOutbound, ServicePartRequestReturn } from '../src/actions/service-aftercare.action.ts';

const organizationId = 'parts-org';
const warehouseId = 'parts-warehouse';
const skuId = 'parts-sku';
const requestId = 'service-part-1';

const object = (name, fields, indexes = []) => ObjectSchema.create({
  name, label: name, sharingModel: 'private', fields, indexes, enable: { apiEnabled: true, trackHistory: true },
});

const schemas = [
  object('forge_material', {
    name: Field.text({ required: true }), organization_id: Field.text({}), status: Field.text({}),
  }),
  object('forge_material_sku', {
    name: Field.text({ required: true }), organization_id: Field.text({}), material_id: Field.text({}), enabled: Field.boolean({}),
  }),
  object('forge_warehouse', {
    name: Field.text({ required: true }), organization_id: Field.text({}),
  }),
  object('forge_service_part_request', {
    name: Field.text({ required: true }), code: Field.text({}), organization_id: Field.text({}),
    status: Field.text({}), execution_status: Field.text({}), revision: Field.number({}),
    warehouse_id: Field.text({}), sku_id: Field.text({}), requested_quantity: Field.number({}),
    issued_quantity: Field.number({}), received_quantity: Field.number({}), used_quantity: Field.number({}),
    returned_quantity: Field.number({}), inventory_issue_ledger_id: Field.text({}), last_event_at: Field.datetime({}),
  }),
  object('forge_service_part_request_event', {
    name: Field.text({ required: true }), request_id: Field.text({}), event_type: Field.text({}),
    event_key: Field.text({}), quantity: Field.number({}), from_status: Field.text({}), to_status: Field.text({}),
    inventory_ledger_id: Field.text({}), inventory_ledger_code: Field.text({}), comment: Field.textarea({}),
    occurred_at: Field.datetime({}), operator_id: Field.text({}), organization_id: Field.text({}),
  }, [{ fields: ['request_id', 'event_key'], unique: 'organization' }]),
  object('forge_inventory_balance', {
    name: Field.text({ required: true }), organization_id: Field.text({}), balance_key: Field.text({}),
    warehouse_id: Field.text({}), sku_id: Field.text({}), on_hand_quantity: Field.number({}),
    reserved_quantity: Field.number({}), available_quantity: Field.number({}), average_cost: Field.number({}),
    inventory_value: Field.number({}), last_movement_at: Field.datetime({}),
  }),
  object('forge_inventory_ledger', {
    name: Field.text({ required: true }), organization_id: Field.text({}), code: Field.text({}),
    warehouse_id: Field.text({}), sku_id: Field.text({}), direction: Field.text({}), movement_type: Field.text({}),
    quantity: Field.number({}), before_on_hand: Field.number({}), after_on_hand: Field.number({}),
    before_available: Field.number({}), after_available: Field.number({}), unit_cost: Field.number({}),
    amount: Field.number({}), occurred_at: Field.datetime({}), source_object: Field.text({}), source_id: Field.text({}),
    responsible_id: Field.text({}), remarks: Field.textarea({}),
  }),
];

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'forge-service-parts-'));
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(directory, 'parts.sqlite') }, useNullAsDefault: true });
  const engine = new ObjectQL();
  for (const schema of schemas) engine.registerObject(schema);
  engine.registerDriver(driver, true);
  await engine.init();
  await driver.initObjects(schemas.map(schema => engine.getObject(schema.name)));
  t.after(async () => { await driver.disconnect(); await rm(directory, { recursive: true, force: true }); });
  const system = { isSystem: true, userId: 'warehouse-user', tenantId: organizationId, permissions: ['forge_warehouse_operator'] };
  await engine.insert('forge_material', { id: 'parts-material', name: '电机备件', organization_id: organizationId, status: 'active' }, { context: system });
  await engine.insert('forge_material_sku', { id: skuId, name: '电机轴承', organization_id: organizationId, material_id: 'parts-material', enabled: true }, { context: system });
  await engine.insert('forge_warehouse', { id: warehouseId, name: '售后仓', organization_id: organizationId }, { context: system });
  await engine.insert('forge_service_part_request', {
    id: requestId, name: '更换电机轴承', code: 'SP-20261003-0001', organization_id: organizationId,
    status: 'open', execution_status: 'pending_outbound', revision: 1,
    warehouse_id: warehouseId, sku_id: skuId, requested_quantity: 3,
    issued_quantity: 0, received_quantity: 0, used_quantity: 0, returned_quantity: 0,
  }, { context: system });
  await engine.insert('forge_inventory_balance', {
    id: 'parts-balance', name: '售后仓电机轴承', organization_id: organizationId,
    balance_key: warehouseId + ':' + skuId, warehouse_id: warehouseId, sku_id: skuId,
    on_hand_quantity: 10, reserved_quantity: 1, available_quantity: 9,
    average_cost: 2, inventory_value: 20,
  }, { context: system });

  async function action(definition, params, actor = 'warehouse-user') {
    const context = { userId: actor, tenantId: organizationId, positions: [], permissions: ['forge_warehouse_operator'] };
    const record = await engine.findOne(definition.objectName, { where: { id: requestId } }, { context: { ...context, isSystem: true } });
    const runner = new QuickJSScriptRunner({ actionTimeoutMs: 10_000 });
    const handler = actionBodyRunnerFactory(runner, { ql: engine, appId: 'service-parts-test' })(definition);
    try {
      return await handler({
        object: definition.objectName, recordId: requestId, record, params,
        session: { userId: actor, organizationId }, user: { id: actor, organizationId },
        api: engine.createContext({ ...context, isSystem: true }),
      });
    } finally { await runner.dispose(); }
  }
  const read = (name, id) => engine.findOne(name, { where: { id } }, { context: system });
  return { engine, read, action };
}

test('QuickJS outbound and return update real 17.5 ObjectQL inventory balances and linked ledgers atomically', async t => {
  const h = await fixture(t);
  const issued = await h.action(ServicePartRequestOutbound, {
    quantity: 3, expected_revision: 1, idempotency_key: 'service-issue-1', note: '工单领用',
  });
  assert.equal(issued.execution_status, 'outbounded');
  assert.equal(issued.inventory_movement_quantity, 3);
  const [issuedRequest, issuedBalance, outboundLedger, outboundEvent] = await Promise.all([
    h.read('forge_service_part_request', requestId),
    h.read('forge_inventory_balance', 'parts-balance'),
    h.read('forge_inventory_ledger', issued.inventory_ledger_id),
    h.read('forge_service_part_request_event', issued.event_id),
  ]);
  assert.equal(issuedRequest.inventory_issue_ledger_id, issued.inventory_ledger_id);
  assert.equal(issuedBalance.on_hand_quantity, 7);
  assert.equal(issuedBalance.available_quantity, 6);
  assert.equal(issuedBalance.inventory_value, 14);
  assert.equal(outboundLedger.direction, 'outbound');
  assert.equal(outboundLedger.movement_type, 'other_outbound');
  assert.equal(outboundLedger.source_id, requestId);
  assert.equal(outboundEvent.inventory_ledger_code, outboundLedger.code);

  await h.engine.update('forge_service_part_request', {
    id: requestId, status: 'open', execution_status: 'received', revision: 2,
    received_quantity: 3, used_quantity: 1,
  }, { context: { isSystem: true, userId: 'warehouse-user', tenantId: organizationId } });
  const returned = await h.action(ServicePartRequestReturn, {
    quantity: 2, expected_revision: 2, idempotency_key: 'service-return-1', note: '未使用备件退库',
  });
  const [returnedRequest, returnedBalance, inboundLedger, returnEvent] = await Promise.all([
    h.read('forge_service_part_request', requestId),
    h.read('forge_inventory_balance', 'parts-balance'),
    h.read('forge_inventory_ledger', returned.inventory_ledger_id),
    h.read('forge_service_part_request_event', returned.event_id),
  ]);
  assert.equal(returnedRequest.execution_status, 'used');
  assert.equal(returnedBalance.on_hand_quantity, 9);
  assert.equal(returnedBalance.available_quantity, 8);
  assert.equal(inboundLedger.direction, 'inbound');
  assert.equal(inboundLedger.movement_type, 'other_inbound');
  assert.equal(inboundLedger.quantity, 2);
  assert.equal(returnEvent.inventory_ledger_code, inboundLedger.code);
});
