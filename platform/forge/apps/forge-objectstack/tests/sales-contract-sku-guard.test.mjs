import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { QuickJSScriptRunner, hookBodyRunnerFactory } from '@objectstack/runtime';
import { Field, ObjectSchema } from '@objectstack/spec/data';
import { SalesContractLineSkuGuard } from '../src/hooks/sales-contract.hook.ts';

function simpleObject(name, fields) {
  return ObjectSchema.create({
    name,
    label: name,
    sharingModel: 'public_read',
    fields,
    enable: { apiEnabled: true },
  });
}

const objects = [
  simpleObject('forge_material_sku', {
    code: Field.text({ label: 'SKU' }),
    material_id: Field.text({ label: 'Material' }),
    enabled: Field.boolean({ label: 'Enabled', defaultValue: true }),
    organization_id: Field.text({ label: 'Organization' }),
  }),
  simpleObject('forge_material', {
    unit_id: Field.text({ label: 'Unit' }),
    status: Field.text({ label: 'Status' }),
    organization_id: Field.text({ label: 'Organization' }),
  }),
  simpleObject('forge_unit', {
    status: Field.text({ label: 'Status' }),
    organization_id: Field.text({ label: 'Organization' }),
  }),
  simpleObject('forge_sales_contract_line', {
    name: Field.text({ label: 'Line name', required: true }),
    sku_id: Field.text({ label: 'SKU', required: true }),
  }),
];

test('ObjectStack 17.3 beforeInsert rejects disabled, cross-organization, and unscoped contract SKUs', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forge-contract-sku-hook-'));
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(directory, 'objectstack.sqlite') },
    useNullAsDefault: true,
  });
  const engine = new ObjectQL();
  const runner = new QuickJSScriptRunner();
  for (const object of objects) engine.registerObject(object);
  engine.registerDriver(driver, true);
  await engine.init();
  await driver.initObjects(objects);
  const binding = bindHooksToEngine(engine, [SalesContractLineSkuGuard], {
    packageId: 'forge-sales-contract-sku-test',
    bodyRunner: hookBodyRunnerFactory(runner, { ql: engine, appId: 'forge-sales-contract-sku-test' }),
    strict: true,
  });
  assert.equal(binding.registered, 1, 'the pinned ObjectQL runtime registered the sandboxed beforeInsert hook');

  t.after(async () => {
    await runner.dispose();
    await driver.disconnect();
    rmSync(directory, { recursive: true, force: true });
  });

  const systemContext = { isSystem: true, positions: [], permissions: [] };
  const salesContext = {
    userId: 'sales-user', tenantId: 'org-sales', organizationId: 'org-sales',
    positions: [], permissions: [], systemPermissions: [],
  };
  const insertFixture = (object, values) => engine.insert(object, values, { context: systemContext });
  const insertLine = (id, skuId, context = salesContext) => engine.insert('forge_sales_contract_line', {
    id, name: '合同物料', sku_id: skuId,
  }, { context });

  await insertFixture('forge_unit', { id: 'unit-sales', status: 'active', organization_id: 'org-sales' });
  await insertFixture('forge_material', { id: 'material-sales', unit_id: 'unit-sales', status: 'active', organization_id: 'org-sales' });
  await insertFixture('forge_material_sku', { id: 'sku-enabled', material_id: 'material-sales', enabled: true, organization_id: 'org-sales' });
  await insertFixture('forge_material_sku', { id: 'sku-disabled', material_id: 'material-sales', enabled: false, organization_id: 'org-sales' });
  await insertFixture('forge_material_sku', { id: 'sku-other-org', material_id: 'material-sales', enabled: true, organization_id: 'org-other' });

  const saved = await insertLine('line-enabled', 'sku-enabled');
  assert.equal(saved.id, 'line-enabled', 'same-organization enabled SKU can be saved through ObjectQL');

  await assert.rejects(insertLine('line-disabled', 'sku-disabled'), /已停用/);
  await assert.rejects(insertLine('line-cross-org', 'sku-other-org'), /不属于当前组织/);
  await assert.rejects(insertLine('line-unscoped', 'sku-enabled', {
    userId: 'sales-user', positions: [], permissions: [], systemPermissions: [],
  }), /无法确认当前销售组织/);

  const savedLines = await engine.find('forge_sales_contract_line', { where: {}, context: systemContext });
  assert.deepEqual(savedLines.map((line) => line.id), ['line-enabled'], 'rejected writes leave no contract line behind');
});
