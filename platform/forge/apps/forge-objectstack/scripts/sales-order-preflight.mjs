import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const tables = ['forge_customer_prepayment', 'forge_customer_refund'];

/** Contract prepayments precede an order. This additive upgrade only loosens
 * their old order reference; business rows, amounts and links stay intact. */
export async function prepareContractPrepaymentSchema(databaseUrl) {
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new Error('PostgreSQL is required for this preflight');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    let changed = false;
    for (const table of tables) {
      const result = await client.query(`SELECT data_type,is_nullable FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name=$1 AND column_name='order_id'`, [table]);
      const column = result.rows[0];
      if (!column) continue; // Current metadata creates nullable references on fresh installations.
      if (!['text', 'character varying'].includes(column.data_type)) throw new Error('Unsupported contract prepayment order reference');
      if (column.is_nullable === 'NO') {
        await client.query(`ALTER TABLE ${table} ALTER COLUMN order_id DROP NOT NULL`);
        changed = true;
      }
      const verified = await client.query(`SELECT is_nullable FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name=$1 AND column_name='order_id'`, [table]);
      if (verified.rows[0]?.is_nullable !== 'YES') throw new Error('Contract prepayment reference migration was not applied');
    }
    await client.query('COMMIT');
    return { changed };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await client.end(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await prepareContractPrepaymentSchema(process.env.OS_DATABASE_URL);
    console.log(`Forge contract prepayment schema ${result.changed ? 'migrated and verified' : 'verified'}.`);
  } catch {
    console.error('Forge contract prepayment schema preflight failed; application was not started.');
    process.exitCode = 1;
  }
}
