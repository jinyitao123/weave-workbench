import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { userInfo } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { actionBodyRunnerFactory, hookBodyRunnerFactory, QuickJSScriptRunner } from '@objectstack/runtime';
import * as priceObjects from '../src/objects/sales-pricing.object.ts';
import { MaterialSku } from '../src/objects/sales-pricing-sku.object.ts';
import { Material } from '../src/objects/material.object.ts';
import { SalesPriceDraftSave, SalesPriceSubmit } from '../src/actions/sales-pricing.action.ts';
import { SalesQuotationPriceResolve } from '../src/actions/sales-quotation-price.action.ts';
import { SalesApprovedPriceApply, SalesCatalogPriceRevision } from '../src/hooks/sales-pricing.hook.ts';
import { SalesPricingBusinessDatePlugin } from '../src/plugins/sales-pricing-business-date.plugin.ts';

const run = promisify(execFile);
const org = randomUUID(), actor = randomUUID(), reviewer = randomUUID();
const schema = (name, fields) => ObjectSchema.create({ name, fields:{owner_id:Field.text(),organization_id:Field.text(),...fields}, sharingModel: 'public_read_write' });
const objects = [Material, MaterialSku, ...Object.values(priceObjects),
  schema('sys_organization', { name: Field.text(), timezone: Field.text() }),
  schema('sys_member', { user_id: Field.text() }),
  schema('sys_user', { name: Field.text(), banned: Field.boolean(), ban_expires: Field.datetime() }),
  schema('sys_position', { name: Field.text(), active: Field.boolean() }),
  schema('sys_user_position', { user_id: Field.text(), position: Field.text(), valid_from: Field.datetime(), valid_until: Field.datetime() }),
  schema('forge_material_category', { name: Field.text() }), schema('forge_unit', { name: Field.text() }),
  schema('forge_customer', { name: Field.text(), responsible_id: Field.text() }),
];

test('portable price actions and approval effect use real PostgreSQL transactions and the native organization calendar', async t => {
  const database = 'forge_pricing_' + randomUUID().replaceAll('-', '').slice(0, 16);
  const pgPort = String(process.env.FORGE_PRICING_PG_PORT || 5432);
  await run('createdb', ['-h', '127.0.0.1', '-p', pgPort, database]);
  const connection = { host: '127.0.0.1', port: Number(pgPort), user: userInfo().username, database };
  let driver = new SqlDriver({ client: 'pg', connection });
  let engine = new ObjectQL();
  const runner = new QuickJSScriptRunner({ actionTimeoutMs: 30000, hookTimeoutMs: 30000 });
  let calendar;
  t.after(async () => {
    await calendar?.destroy(); await runner.dispose(); await driver.disconnect();
    await run('dropdb', ['-h', '127.0.0.1', '-p', pgPort, database]);
  });
  for (const object of objects) engine.registerObject(object);
  engine.registerDriver(driver, true); await engine.init(); await driver.initObjects(objects.map(object=>engine.getObject(object.name)));
  const system = { isSystem: true, userId: actor, tenantId: org, positions: [], permissions: ['sales_order_operator'] };
  const insert = (object, row) => engine.insert(object, { organization_id: org, owner_id: actor, ...row }, { context: system });
  await insert('sys_organization', { id: org, name: '价格测试组织', timezone: 'America/Los_Angeles' });
  await insert('sys_member', { user_id: actor }); await insert('sys_member', { user_id: reviewer });
  await insert('sys_user', { id: actor, name: '经办员工', banned: false });
  await insert('sys_user', { id: reviewer, name: '复核员工', banned: false });
  const position = await insert('sys_position', { name: 'sales_order_reviewer', active: true });
  await insert('sys_user_position', { user_id: reviewer, position: position.id });
  const category = await insert('forge_material_category', { name: '测试分类' }), unit = await insert('forge_unit', { name: '件' });
  const material = await insert('forge_material', { name: '部署价格材料', code: 'PRICING-MAT', model: 'TEST', category_id: category.id, unit_id: unit.id });
  const sku = await insert('forge_material_sku', { name: '标准规格', code: 'PRICING-SKU', material_id: material.id, sale_price: '100.0001' });
  const customer = await insert('forge_customer', { name: '部署价格客户', responsible_id: actor });
  const factory = actionBodyRunnerFactory(runner, { ql: engine, appId: 'com.inoforge.forge.sales' });
  for (const action of [SalesPriceDraftSave, SalesPriceSubmit, SalesQuotationPriceResolve]) engine.registerAction(action.objectName, action.name, factory(action), 'pricing-test');
  engine.bindHooks([SalesApprovedPriceApply,SalesCatalogPriceRevision], { packageId: 'pricing-test-hooks', bodyRunner: hookBodyRunnerFactory(runner, { ql: engine, appId: 'com.inoforge.forge.sales' }), strict: true });
  calendar = new SalesPricingBusinessDatePlugin();
  let ready;
  calendar.start({ getService: () => engine, hook: (_event, callback) => { ready = callback; } });
  await ready();
  const invoke = async (definition, params, recordId) => {
    const context = { user: { id: actor, organizationId: org }, session: { userId: actor, organizationId: org }, params, api: engine.createContext(system), ...(recordId ? { recordId, record: await engine.findOne(definition.objectName, { where: { id: recordId } }, { context: system }) } : {}) };
    return engine.executeAction(definition.objectName, definition.name, context);
  };
  const draft = { kind: 'adjustment', reason: '部署组件校验', lines: [{ sku_id: sku.id, quantity: '2.5000', proposed_price: '12.3456' }] };
  const saved = await invoke(SalesPriceDraftSave, { request_key: 'pg-draft', draft_json: JSON.stringify(draft) });
  assert.deepEqual(await invoke(SalesPriceDraftSave, { request_key: 'pg-draft', draft_json: JSON.stringify(draft) }), saved);
  const line = await engine.findOne('forge_sales_price_request_line', { where: { request_id: saved.id } }, { context: system });
  assert.equal(Number(line.original_price), 100.0001); assert.equal(Number(line.proposed_amount), 30.864);
  const submitted = await invoke(SalesPriceSubmit, { expected_revision: saved.revision }, saved.id);
  assert.equal(submitted.status, 'pending_approval');
  assert.equal((await engine.findOne('forge_sales_price_request', { where: { id: saved.id } }, { context: system })).review_owner_id, reviewer);
  // The native approval service is covered separately by the application chain.
  // This test controls the system outcome solely to exercise the real data hook.
  await engine.update('forge_sales_price_request', { status: 'approved', approval_status: 'approved' }, { where: { id: saved.id }, context: system });
  const effected=await engine.findOne('forge_sales_price_request',{where:{id:saved.id}},{context:system});assert.equal(effected.effect_status,'applied',effected.effect_message);
  assert.equal(Number((await engine.findOne('forge_material_sku', { where: { id: sku.id } }, { context: system })).sale_price), 12.3456);
  const history = await engine.find('forge_sales_price_history', { where: { request_id: saved.id } }, { context: system });
  assert.equal(history.length, 1); assert.equal(Number(history[0].price), 12.3456);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  assert.equal(String(history[0].valid_from).slice(0, 10), date);
  const priced = await invoke(SalesQuotationPriceResolve, { customer_id: customer.id, sku_id: sku.id,date });
  assert.equal(priced.price, 12.3456); assert.equal(priced.date, date);
  const foreignCustomer = await insert('forge_customer', { name: '其他员工客户', owner_id: reviewer, responsible_id: reviewer });
  await assert.rejects(invoke(SalesQuotationPriceResolve, { customer_id: foreignCustomer.id, sku_id: sku.id,date }), /本人可办理客户/);
  await calendar.destroy(); calendar = undefined; await driver.disconnect();
  driver = new SqlDriver({ client: 'pg', connection }); engine = new ObjectQL();
  for (const object of objects) engine.registerObject(object);
  engine.registerDriver(driver, true); await engine.init();
  assert.equal(Number((await engine.findOne('forge_material_sku', { where: { id: sku.id } }, { context: system })).sale_price), 12.3456);
  assert.equal((await engine.find('forge_sales_price_history', { where: { request_id: saved.id } }, { context: system })).length, 1);
});
