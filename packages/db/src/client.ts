import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type DbOptions = {
  connectionString: string;
  max?: number;
  lockTimeoutMs?: number;
  statementTimeoutMs?: number;
  applicationName?: string;
};

/** Pool dengan lock_timeout & statement_timeout (behavioral A-5, ADR-003 action item 3). */
export function createPool(o: DbOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: o.connectionString,
    max: o.max ?? 10,
    application_name: o.applicationName ?? 'wms',
    options: `-c lock_timeout=${o.lockTimeoutMs ?? 4000} -c statement_timeout=${o.statementTimeoutMs ?? 15000} -c TimeZone=UTC`,
  });
  // NUMERIC dikembalikan sebagai string oleh pg (default) → dipertahankan (qty = string desimal).
  return pool;
}

export type Db = NodePgDatabase<typeof schema>;

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema, casing: 'snake_case' });
}
