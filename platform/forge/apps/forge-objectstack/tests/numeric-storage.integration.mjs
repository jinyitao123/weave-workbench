import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { SqlDriver } from '@objectstack/driver-sql';
import { prepareNumericValueColumns } from '../scripts/numeric-value-preflight.mjs';

const databaseUrl = process.env.FORGE_NUMERIC_TEST_DATABASE_URL;
test('legacy floats are preserved, repeated migration is safe, and new driver writes preserve cents', { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  const schema = 'forge_numeric_probe_' + process.pid;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let driver;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', '-c search_path=' + schema);
    await client.query(`CREATE TABLE ${schema}.forge_quotation (id text PRIMARY KEY, total_amount real)`);
    await client.query(`INSERT INTO ${schema}.forge_quotation VALUES ('legacy',168000.01)`);
    const before = (await client.query(`SELECT total_amount::double precision AS value FROM ${schema}.forge_quotation`)).rows[0].value;
    assert.notEqual(before,168000.01,'control must reproduce the old storage loss');
    await prepareNumericValueColumns(url.href);
    await prepareNumericValueColumns(url.href);
    const stored = (await client.query(`SELECT total_amount::double precision AS value FROM ${schema}.forge_quotation`)).rows[0].value;
    assert.equal(stored,before,'migration preserves the actual old value instead of inventing lost cents');
    const type = (await client.query('SELECT data_type,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3',[schema,'forge_quotation','total_amount'])).rows[0];
    assert.deepEqual(type,{data_type:'numeric',numeric_precision:65,numeric_scale:30});
    driver = new SqlDriver({client:'pg',connection:url.href,pool:{min:0,max:1}});
    await driver.connect();
    await driver.initObjects([{name:'forge_quotation',fields:{total_amount:{type:'currency'}}}]);
    for(const value of [168000.01,1234567.89,0.01,33.3333]) {
      const record = await driver.create('forge_quotation',{total_amount:value});
      const rows = await driver.find('forge_quotation',{where:{id:record.id}});
      assert.equal(rows[0].total_amount,value);
    }
    await client.query(`CREATE TABLE ${schema}.forge_sales_contract (total_amount numeric(60,40))`);
    const exact = '12345678901234567890.010000000000000000000000000000';
    await client.query(`INSERT INTO ${schema}.forge_sales_contract VALUES ($1),(NULL)`, [exact]);
    await prepareNumericValueColumns(url.href);
    const converted = (await client.query(`SELECT total_amount::text AS value FROM ${schema}.forge_sales_contract WHERE total_amount IS NOT NULL`)).rows[0].value;
    assert.equal(converted,exact,'existing decimal columns widen without routing their values through floating point');
    await client.query(`ALTER TABLE ${schema}.forge_quotation ADD COLUMN subtotal real`);
    await client.query(`CREATE TABLE ${schema}.forge_quotation_line (taxed_unit_price real)`);
    await client.query(`INSERT INTO ${schema}.forge_quotation_line VALUES (1e-35)`);
    await assert.rejects(prepareNumericValueColumns(url.href), /NUMERIC_MIGRATION_VALUE_LOSS/);
    const rolledBack = (await client.query('SELECT data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3',[schema,'forge_quotation','subtotal'])).rows[0];
    assert.equal(rolledBack.data_type,'real','an unsafe later column must roll back an earlier successful ALTER');
    for (const value of ['NaN','Infinity','-Infinity','1e35']) {
      await client.query(`DELETE FROM ${schema}.forge_quotation_line`);
      await client.query(`INSERT INTO ${schema}.forge_quotation_line VALUES ($1)`, [value]);
      await assert.rejects(prepareNumericValueColumns(url.href), /NUMERIC_MIGRATION_NONFINITE_OR_OUT_OF_RANGE/);
      const type = (await client.query('SELECT data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3',[schema,'forge_quotation','subtotal'])).rows[0].data_type;
      assert.equal(type,'real','invalid numeric values must preserve the complete pre-migration schema');
    }
  } finally {
    if(driver)await driver.disconnect();
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    await client.end();
  }
});
