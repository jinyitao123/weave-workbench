import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { prepareContractPrepaymentSchema } from '../scripts/sales-order-preflight.mjs';

test('contract prepayment upgrade preserves legacy order links and is repeatable', { skip: process.env.FORGE_SALES_ORDER_PG_TEST !== '1' }, async t => {
  const database = 'forge_order_preflight_' + randomUUID().replaceAll('-', ''), port = Number(process.env.FORGE_SALES_ORDER_PG_PORT || 55439);
  const admin = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
  await admin.connect(); await admin.query(`CREATE DATABASE "${database}"`);
  const url = `postgres://postgres@127.0.0.1:${port}/${database}`, db = new Client({ connectionString: url });
  await db.connect();
  t.after(async () => { await db.end(); await admin.query(`DROP DATABASE "${database}"`); await admin.end(); });
  assert.deepEqual(await prepareContractPrepaymentSchema(url), { changed: false });
  for (const table of ['forge_customer_prepayment', 'forge_customer_refund']) {
    await db.query(`CREATE TABLE ${table} (id text PRIMARY KEY, order_id text NOT NULL, amount numeric NOT NULL)`);
    await db.query(`INSERT INTO ${table} VALUES ('legacy','existing-order',6000)`);
  }
  assert.deepEqual(await prepareContractPrepaymentSchema(url), { changed: true });
  assert.deepEqual(await prepareContractPrepaymentSchema(url), { changed: false });
  for (const table of ['forge_customer_prepayment', 'forge_customer_refund']) {
    assert.deepEqual((await db.query(`SELECT * FROM ${table}`)).rows, [{ id: 'legacy', order_id: 'existing-order', amount: '6000' }]);
    await db.query(`INSERT INTO ${table} VALUES ('contract-before-order',null,6000)`);
  }
});
