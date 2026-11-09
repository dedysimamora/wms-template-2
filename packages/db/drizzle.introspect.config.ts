import { defineConfig } from 'drizzle-kit';
// Introspeksi DB hasil 0001_baseline → .introspect/schema.ts (lalu disalin ke src/schema.ts).
export default defineConfig({
  dialect: 'postgresql',
  out: './.introspect',
  introspect: { casing: 'camel' },
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  tablesFilter: ['!schema_migration'],
});
