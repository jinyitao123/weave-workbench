import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { SqlDriver } from '@objectstack/driver-sql';
import { NotificationDelivery } from '@objectstack/service-messaging';
import { prepareNotificationLeases } from '../notification-lease-preflight.mjs';

const databaseUrl = process.env.FORGE_NOTIFICATION_TEST_DATABASE_URL;
test('native PostgreSQL initialization preserves precise claims and repairs legacy leases', { skip: !databaseUrl }, async () => {
  const target = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
  assert.match(target.pathname, /^\/forge_lease_preflight_[a-z0-9_]+$/);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('DROP TABLE IF EXISTS sys_notification_delivery');
    const fresh = await prepareNotificationLeases(databaseUrl);
    assert.equal(fresh.changed, true);
    const native = new SqlDriver({ client: 'pg', connection: databaseUrl });
    try {
      await native.connect();
      await native.syncSchema(NotificationDelivery.name, NotificationDelivery);
    } finally {
      await native.disconnect();
    }
    const types = (await client.query("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='sys_notification_delivery' AND column_name IN ('claimed_at','next_attempt_at','last_attempted_at')")).rows;
    assert.equal(types.length, 3);
    assert.ok(types.every(row => row.data_type === 'double precision'), 'native serving schema sync must not narrow the migrated columns');
    const precise = 1790232345678;
    await client.query(`INSERT INTO sys_notification_delivery
      (id,notification_id,recipient_id,channel,status,claimed_by,claimed_at,attempts)
      VALUES ('active','notice','employee','inbox','in_flight','worker',$1,2),
             ('done','notice2','employee','inbox','success',NULL,NULL,1)`, [precise]);
    assert.equal((await prepareNotificationLeases(databaseUrl)).changed, false);
    const current = (await client.query("SELECT status,claimed_at,attempts FROM sys_notification_delivery WHERE id='active'")).rows[0];
    assert.deepEqual(current, { status: 'in_flight', claimed_at: precise, attempts: 2 });
    const ack = await client.query("UPDATE sys_notification_delivery SET status='success' WHERE id='active' AND claimed_at=$1 AND claimed_by='worker' AND status='in_flight'", [precise]);
    assert.equal(ack.rowCount, 1, 'an epoch-ms claim must match its original exact acknowledgement');

    await client.query(`ALTER TABLE sys_notification_delivery
      ALTER COLUMN claimed_at TYPE real,
      ALTER COLUMN next_attempt_at TYPE real,
      ALTER COLUMN last_attempted_at TYPE real`);
    await client.query("UPDATE sys_notification_delivery SET status='in_flight',claimed_at=$1,claimed_by='old-worker' WHERE id='active'", [precise]);
    assert.equal((await prepareNotificationLeases(databaseUrl)).changed, true);
    const repaired = (await client.query("SELECT status,claimed_at,claimed_by,attempts,next_attempt_at FROM sys_notification_delivery WHERE id='active'")).rows[0];
    assert.deepEqual(repaired, { status: 'pending', claimed_at: null, claimed_by: null, attempts: 2, next_attempt_at: 0 });
    assert.equal((await client.query("SELECT status FROM sys_notification_delivery WHERE id='done'")).rows[0].status, 'success');

    await client.query('ALTER TABLE sys_notification_delivery ALTER COLUMN claimed_at TYPE text');
    await assert.rejects(prepareNotificationLeases(databaseUrl), { code: 'FORGE_LEASE_SCHEMA_UNSUPPORTED' });
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
