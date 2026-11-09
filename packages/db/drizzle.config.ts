import { defineConfig } from 'drizzle-kit';

/**
 * Skema Drizzle = sumber kebenaran tabel/kolom/FK (ADR-003). Objek non-tabel (trigger, fungsi,
 * index ekspresi/partial, CHECK kompleks) ditulis sebagai custom migration (migration §2).
 * Migrasi baru: `pnpm --filter @wms/db exec drizzle-kit generate --custom --name <nama>` lalu
 * akhiri skrip dengan INSERT INTO schema_migration.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  casing: 'snake_case',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
});
