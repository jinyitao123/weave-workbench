import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { numericColumnFor } from '@objectstack/spec/data';

/** Operator migration for legacy Forge columns after installing the fixed driver. */
export async function prepareNumericValueColumns(databaseUrl) {
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new Error('PostgreSQL is required for numeric column migration.');
  const target = numericColumnFor('currency');
  if (target?.kind !== 'exact' || target.precision !== 65 || target.scale !== 30) throw new Error('The locked platform does not declare the expected numeric storage.');
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query(await readFile(new URL('./schema/numeric-value-columns.sql', import.meta.url), 'utf8'));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await client.end(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await prepareNumericValueColumns(process.env.OS_DATABASE_URL);
    console.log('Forge legacy numeric columns verified against the locked platform storage.');
  } catch {
    console.error('Forge numeric migration failed; database transaction was rolled back and application was not started.');
    process.exitCode = 1;
  }
}
