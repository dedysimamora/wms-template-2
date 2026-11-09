import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runMigrations, runSeed } from '@wms/db';
import { loadEnv } from '@wms/config';
import { createContainer, type Container } from '../src';
import { startPostgres } from '../../db/test/pg';

export type TestDb = { pg: StartedPostgreSqlContainer; c: Container; stop: () => Promise<void> };

/** DB segar per suite: PG14 + migrasi + seed (Testcontainers → butuh Docker berjalan). */
export async function startTestDb(overrides: Record<string, string> = {}): Promise<TestDb> {
  const container = await startPostgres();
  const url = container.getConnectionUri();
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await runMigrations(admin);
  await runSeed(admin);
  await admin.end();
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    SESSION_SECRET: 'test-session-test-session-test-session-1',
    ...overrides,
  });
  const c = createContainer(env, 'wms-test');
  return {
    pg: container,
    c,
    stop: async () => {
      await c.pool.end();
      await container.stop();
    },
  };
}

/**
 * Harness konkurensi: jalankan N aksi benar-benar paralel. Setiap aksi menunggu gerbang yang
 * sama lalu dilepas bersamaan; hasil dikumpulkan sebagai 'OK' atau 'CODE/REASON' (terurut).
 */
export async function race<T>(n: number, action: (i: number) => Promise<T>): Promise<string[]> {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const runs = Array.from({ length: n }, (_, i) =>
    gate
      .then(() => action(i))
      .then(
        () => 'OK',
        (e: { code?: string; reason?: string; message?: string }) =>
          e.code ? `${e.code}/${e.reason ?? ''}` : `ERR ${e.message}`,
      ),
  );
  open();
  return (await Promise.all(runs)).sort();
}
