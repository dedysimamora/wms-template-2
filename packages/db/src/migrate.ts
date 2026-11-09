import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations',
);
export const SEED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../seed');

/** Jalankan migrasi forward-only (pelacak eksekusi: drizzle.__drizzle_migrations). */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
}

/** Versi tertinggi di registri app (dibaca /api/ready — migration §4). */
export async function currentSchemaVersion(pool: pg.Pool): Promise<string | null> {
  const r = await pool.query<{ v: string | null }>(
    'SELECT max(version) AS v FROM schema_migration',
  );
  return r.rows[0]?.v ?? null;
}

export function isSchemaInRange(v: string | null, min: string, max: string): boolean {
  return v !== null && v >= min && v <= max;
}
