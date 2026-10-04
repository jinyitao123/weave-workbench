import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from '@objectstack/driver-sql';

const tables = ['forge_sales_contract_line', 'forge_sales_order_line'];
const ownerRepairColumns = ['owner_id', 'created_by', 'responsible_id', 'status'];
const migration = new URL('./schema/sales-line-sku-nullability.sql', import.meta.url);

// Reconcile old physical sales-line constraints and repair draft ownership left
// blank by the earlier contract Action before own-scope reads become available.
export async function prepareSalesLineSkuNullability(databaseUrl) {
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    throw Object.assign(new Error('PostgreSQL is required for the deployment preflight.'), { code: 'FORGE_DATABASE_REQUIRED' });
  }

  const driver = new SqlDriver({ client: 'pg', connection: databaseUrl, pool: { min: 0, max: 1 } });
  try {
    await driver.connect();
    const before = [];
    for (const table of tables) {
      const result = await driver.execute(`SELECT data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = '${table}'
          AND column_name = 'sku_id'`);
      const column = result.rows[0];
      if (!column) continue; // Fresh installs get nullable columns from current metadata at app boot.
      if (!['character varying', 'text'].includes(column.data_type)) {
        throw Object.assign(new Error('Unexpected sales line SKU column type.'), { code: 'FORGE_SALES_LINE_SKU_SCHEMA_UNSUPPORTED' });
      }
      before.push({ table, nullable: column.is_nullable === 'YES' });
    }

    const contractColumns = await driver.execute(`SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'forge_sales_contract'
        AND column_name IN ('owner_id', 'created_by', 'responsible_id', 'status')`);
    const hasOwnerRepairSchema = ownerRepairColumns.every(column => contractColumns.rows.some(row => row.column_name === column));
    const ownerCandidates = hasOwnerRepairSchema
      ? await driver.execute(`SELECT COUNT(*) AS count
        FROM forge_sales_contract
        WHERE owner_id IS NULL
          AND status = 'draft'
          AND created_by = responsible_id
          AND responsible_id IS NOT NULL`)
      : { rows: [{ count: '0' }] };
    const unownedDraftsBefore = Number(ownerCandidates.rows[0]?.count || 0);
    const changed = before.some(row => !row.nullable) || unownedDraftsBefore > 0;
    if (changed) await driver.execute(await readFile(migration, 'utf8'));

    const verified = [];
    for (const { table } of before) {
      const result = await driver.execute(`SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = '${table}'
          AND column_name = 'sku_id'`);
      if (result.rows[0]?.is_nullable !== 'YES') {
        throw Object.assign(new Error('Sales line SKU nullability verification failed.'), { code: 'FORGE_SALES_LINE_SKU_SCHEMA_INVALID' });
      }
      verified.push(table);
    }

    if (hasOwnerRepairSchema) {
      const remaining = await driver.execute(`SELECT COUNT(*) AS count
        FROM forge_sales_contract
        WHERE owner_id IS NULL
          AND status = 'draft'
          AND created_by = responsible_id
          AND responsible_id IS NOT NULL`);
      if (Number(remaining.rows[0]?.count || 0) !== 0) {
        throw Object.assign(new Error('Sales contract draft owner repair verification failed.'), { code: 'FORGE_SALES_CONTRACT_OWNER_INVALID' });
      }
    }

    return { changed, tables: verified, repairedDraftOwners: unownedDraftsBefore };
  } finally {
    await driver.disconnect();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await prepareSalesLineSkuNullability(process.env.OS_DATABASE_URL);
    console.log(`Forge sales preflight ${result.changed ? 'migrated and verified' : 'verified'}.`);
  } catch (error) {
    // Do not print a connection URL, driver stack, or SQL containing credentials.
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'PREFLIGHT_FAILED';
    console.error(`Forge sales line SKU preflight failed (${code}); application was not started.`);
    process.exitCode = 1;
  }
}
