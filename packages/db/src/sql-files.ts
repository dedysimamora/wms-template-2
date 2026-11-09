import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { SEED_DIR } from './migrate';

/** Buang meta-command psql (\set, \pset) agar skrip bisa dijalankan lewat driver pg. */
export function stripPsqlMeta(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('\\'))
    .join('\n');
}

/** Jalankan seed/seed.sql (idempoten). */
export async function runSeed(pool: pg.Pool): Promise<void> {
  const sql = await readFile(path.join(SEED_DIR, 'seed.sql'), 'utf8');
  await pool.query(stripPsqlMeta(sql));
}
