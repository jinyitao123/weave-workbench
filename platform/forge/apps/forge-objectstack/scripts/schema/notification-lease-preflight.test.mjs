import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectQL } from '@objectstack/objectql/core';
import { NotificationDelivery, SqlNotificationOutbox } from '@objectstack/service-messaging';
import { numericColumnFor } from '@objectstack/spec/data';
import { prepareNotificationLeases } from '../notification-lease-preflight.mjs';

const databaseUrl = process.env.FORGE_NOTIFICATION_TEST_DATABASE_URL;
test('native PostgreSQL initialization preserves precise claims and repairs legacy leases', { skip: !databaseUrl }, async t => {
  const target = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
  assert.match(target.pathname, /^\/forge_lease_preflight_[a-z0-9_]+$/);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const precise = 1790232345678;
  const nativeType = numericColumnFor(NotificationDelivery.fields.claimed_at.type);
  assert.equal(nativeType.kind, 'exact');
  const inspect = async () => (await client.query(`SELECT column_name, data_type, numeric_precision, numeric_scale
    FROM information_schema.columns WHERE table_schema='public' AND table_name='sys_notification_delivery'
    AND column_name IN ('claimed_at','next_attempt_at','last_attempted_at') ORDER BY column_name`)).rows;
  const read = async id => (await client.query('SELECT id,status,claimed_at,claimed_by,attempts,next_attempt_at FROM sys_notification_delivery WHERE id=$1', [id])).rows[0];
  const nativeColumns = rows => {
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => row.data_type === 'numeric'
      && row.numeric_precision === nativeType.precision && row.numeric_scale === nativeType.scale));
  };
  const reset = async () => {
    await client.query('DROP TABLE IF EXISTS sys_notification_delivery');
    assert.equal((await prepareNotificationLeases(databaseUrl)).changed, false);
  };
  const withNative = async run => {
    const driver = new SqlDriver({ client: 'pg', connection: databaseUrl, pool: { min: 0, max: 1 } });
    const engine = new ObjectQL();
    engine.registerDriver(driver, true);
    engine.registerObject(NotificationDelivery);
    try {
      await engine.init();
      // Serving sync uses the registry's native system-field injection too.
      await driver.syncSchema(NotificationDelivery.name, engine.getObject(NotificationDelivery.name));
      return await run({ driver, engine, outbox: new SqlNotificationOutbox(engine, { partitionCount: 1 }) });
    } finally { await engine.destroy(); }
  };
  const claim = async suffix => withNative(async ({ outbox }) => {
    await outbox.enqueue({ notificationId: 'notice-' + suffix, recipientId: 'employee', channel: 'inbox', payload: { text: 'Lease fixture' } });
    const claims = await outbox.claim({ nodeId: 'worker', limit: 10, claimTtlMs: 60000, now: precise });
    assert.equal(claims.length, 1);
    assert.equal(claims[0].claimedAt, precise);
    return claims[0];
  });
  const acknowledge = async claimed => withNative(async ({ driver, engine, outbox }) => {
    const stored = await driver.findOne(NotificationDelivery.name, { where: { id: claimed.id } });
    assert.equal(typeof stored.claimed_at, 'number', 'registered native number metadata must normalize the PostgreSQL value');
    assert.equal(stored.claimed_at, claimed.claimedAt);
    await assert.rejects(outbox.ack({ ...claimed, claimedAt: claimed.claimedAt + 1 }, { success: true }), { code: 'DELIVERY_NOT_ELIGIBLE' });
    assert.equal((await read(claimed.id)).status, 'in_flight');
    await outbox.ack(claimed, { success: true });
    const completed = await engine.findOne(NotificationDelivery.name, { where: { id: claimed.id } });
    assert.equal(completed.status, 'success');
    assert.equal(completed.claimed_at, null);
    assert.equal(typeof completed.last_attempted_at, 'number');
    assert.equal(typeof completed.attempts, 'number');
    return completed;
  });
  try {
    assert.equal(Number((await client.query('SHOW server_version_num')).rows[0].server_version_num) / 10000 | 0, 16);
    await t.test('fresh native numeric columns survive process restart and acknowledge the original claim', async () => {
      await reset();
      nativeColumns(await inspect());
      const claimed = await claim('native');
      const before = await read(claimed.id);
      assert.equal(typeof before.claimed_at, 'string', 'raw node-postgres numeric is a string before native field presentation');
      const entry = fileURLToPath(new URL('../notification-lease-preflight.mjs', import.meta.url));
      const restarted = spawnSync(process.execPath, [entry], {
        env: { ...process.env, OS_DATABASE_URL: databaseUrl }, encoding: 'utf8',
      });
      assert.equal(restarted.status, 0, restarted.stderr);
      assert.match(restarted.stdout, /schema verified\./);
      assert.equal((await prepareNotificationLeases(databaseUrl)).changed, false);
      assert.deepEqual(await read(claimed.id), before, 'a valid in-flight claim must not be rewritten');
      assert.equal((await acknowledge(claimed)).attempts, 1);
      nativeColumns(await inspect());
    });

    await t.test('already precise double columns and in-flight claims remain unchanged', async () => {
      await reset();
      await client.query(`ALTER TABLE sys_notification_delivery
        ALTER COLUMN claimed_at TYPE double precision,
        ALTER COLUMN next_attempt_at TYPE double precision,
        ALTER COLUMN last_attempted_at TYPE double precision`);
      const claimed = await claim('double');
      const before = await read(claimed.id);
      assert.equal((await prepareNotificationLeases(databaseUrl)).changed, false);
      assert.deepEqual(await read(claimed.id), before);
      await acknowledge(claimed);
      assert.ok((await inspect()).every(row => row.data_type === 'double precision'), 'native sync must not retype an existing precise column');
    });

    await t.test('legacy real claims lose precision and are retired once without erasing attempts or completed deliveries', async () => {
      await reset();
      await client.query(`ALTER TABLE sys_notification_delivery
        ALTER COLUMN claimed_at TYPE real,
        ALTER COLUMN next_attempt_at TYPE real,
        ALTER COLUMN last_attempted_at TYPE real`);
      await client.query(`INSERT INTO sys_notification_delivery
        (id,notification_id,recipient_id,channel,status,claimed_by,claimed_at,attempts)
        VALUES ('active','notice','employee','inbox','in_flight','old-worker',$1,2),
               ('done','notice2','employee','inbox','success',NULL,NULL,1)`, [precise]);
      assert.notEqual((await read('active')).claimed_at, precise, 'the legacy REAL storage must expose the historical precision loss');
      const done = await read('done');
      assert.equal((await prepareNotificationLeases(databaseUrl)).changed, true);
      const repaired = await read('active');
      assert.deepEqual(repaired, { id: 'active', status: 'pending', claimed_at: null, claimed_by: null, attempts: '2.000000000000000000000000000000', next_attempt_at: 0 });
      assert.deepEqual(await read('done'), done);
      assert.ok((await inspect()).every(row => row.data_type === 'double precision'));
      assert.equal((await prepareNotificationLeases(databaseUrl)).changed, false);
      assert.deepEqual(await read('active'), repaired);
      const retried = await withNative(async ({ outbox }) => {
        const rows = await outbox.claim({ nodeId: 'new-worker', limit: 10, claimTtlMs: 60000, now: precise + 1 });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].claimedAt, precise + 1);
        return rows[0];
      });
      assert.equal((await acknowledge(retried)).attempts, 3);
    });

    await t.test('a mixed legacy retry column does not retire a precise active claim', async () => {
      await reset();
      const claimed = await claim('mixed');
      await client.query('ALTER TABLE sys_notification_delivery ALTER COLUMN next_attempt_at TYPE real');
      const before = await read(claimed.id);
      assert.equal((await prepareNotificationLeases(databaseUrl)).changed, true);
      assert.deepEqual(await read(claimed.id), before);
      const columns = await inspect();
      assert.equal(columns.find(row => row.column_name === 'next_attempt_at').data_type, 'double precision');
      assert.ok(columns.filter(row => row.column_name !== 'next_attempt_at').every(row => row.data_type === 'numeric'));
      assert.equal((await prepareNotificationLeases(databaseUrl)).changed, false);
      await acknowledge(claimed);
    });

    for (const badType of ['text', 'numeric(20,2)']) await t.test('unsupported ' + badType + ' rejects before migrating any other column or claim', async () => {
      await reset();
      const claimed = await claim('unsupported');
      await client.query(`ALTER TABLE sys_notification_delivery ALTER COLUMN claimed_at TYPE ${badType}, ALTER COLUMN next_attempt_at TYPE real`);
      const before = await read(claimed.id), columns = await inspect();
      await assert.rejects(prepareNotificationLeases(databaseUrl), { code: 'FORGE_LEASE_SCHEMA_UNSUPPORTED' });
      assert.deepEqual(await read(claimed.id), before);
      assert.deepEqual(await inspect(), columns);
    });

    await t.test('an incomplete native lease schema is rejected', async () => {
      await reset();
      await client.query('ALTER TABLE sys_notification_delivery DROP COLUMN last_attempted_at');
      await assert.rejects(prepareNotificationLeases(databaseUrl), { code: 'FORGE_LEASE_SCHEMA_UNSUPPORTED' });
    });
  } finally {
    await client.query('DROP TABLE IF EXISTS sys_notification_delivery');
    await client.end();
  }
});

test('a failed migration preflight prevents the serving command from running', () => {
  const directory = mkdtempSync(join(tmpdir(), 'forge-preflight-'));
  try {
    const marker = join(directory, 'started');
    const script = fileURLToPath(new URL('../start-with-migrations.sh', import.meta.url));
    const result = spawnSync('sh', [script, process.execPath, '-e', 'require("node:fs").writeFileSync(process.argv[1],"started")', marker], {
      env: { ...process.env, OS_DATABASE_URL: '', PATH: `${join(process.execPath, '..')}:${process.env.PATH}` },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(marker), false);
    assert.match(result.stderr, /application was not started/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
