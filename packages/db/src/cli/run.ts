/* CLI db: migrate | seed | reset. Membaca DATABASE_URL dari env (.env root). */
import pg from 'pg';
import { currentSchemaVersion, runMigrations } from '../migrate';
import { runSeed } from '../sql-files';

const cmd = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL belum di-set (salin .env.example → .env)');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 2 });

async function main() {
  switch (cmd) {
    case 'migrate':
      await runMigrations(pool);
      console.log(`migrasi selesai — schema_migration = ${await currentSchemaVersion(pool)}`);
      break;
    case 'seed':
      await runSeed(pool);
      console.log('seed selesai (idempoten)');
      break;
    case 'reset':
      if (process.env.NODE_ENV === 'production') throw new Error('reset ditolak di production');
      await pool.query(
        'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
      );
      await runMigrations(pool);
      await runSeed(pool);
      console.log('reset selesai: migrate + seed');
      break;
    default:
      console.error('pakai: migrate | seed | reset');
      process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
