import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from '@objectstack/driver-sql';
import { NotificationDelivery } from '@objectstack/service-messaging';

const columns = ['claimed_at', 'next_attempt_at', 'last_attempted_at'];
const migration = new URL('./schema/notification-lease-precision.sql', import.meta.url);

// One-shot deployment initialization, before the serving process or messaging
// workers start. The table definition remains owned by the pinned native plugin.
export async function prepareNotificationLeases(databaseUrl) {
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    throw Object.assign(new Error('PostgreSQL is required for the deployment preflight.'), { code: 'FORGE_DATABASE_REQUIRED' });
  }
  const driver = new SqlDriver({ client: 'pg', connection: databaseUrl, pool: { min: 0, max: 1 } });
  try {
    await driver.connect();
    const table = await driver.execute("SELECT to_regclass('sys_notification_delivery') AS name");
    if (!table.rows[0]?.name) await driver.syncSchema(NotificationDelivery.name, NotificationDelivery);
    const inspect = async () => (await driver.execute(`SELECT column_name, data_type
      FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name='sys_notification_delivery'
      AND column_name IN ('claimed_at','next_attempt_at','last_attempted_at')`)).rows;
    const before = await inspect();
    if (before.length !== columns.length || before.some(row => !['real', 'double precision'].includes(row.data_type))) {
      throw Object.assign(new Error('Unexpected notification lease schema.'), { code: 'FORGE_LEASE_SCHEMA_UNSUPPORTED' });
    }
    const changed = before.some(row => row.data_type === 'real');
    if (changed) await driver.execute(await readFile(migration, 'utf8'));
    const after = await inspect();
    if (after.length !== columns.length || after.some(row => row.data_type !== 'double precision')) {
      throw Object.assign(new Error('Notification lease precision verification failed.'), { code: 'FORGE_LEASE_SCHEMA_INVALID' });
    }
    return { changed, columns: after.map(row => row.column_name).sort() };
  } finally {
    await driver.disconnect();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await prepareNotificationLeases(process.env.OS_DATABASE_URL);
    console.log(`Forge notification lease schema ${result.changed ? 'migrated and verified' : 'verified'}.`);
  } catch (error) {
    // Do not print a connection URL, driver stack, or SQL containing credentials.
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'PREFLIGHT_FAILED';
    console.error(`Forge notification lease preflight failed (${code}); application was not started.`);
    process.exitCode = 1;
  }
}
