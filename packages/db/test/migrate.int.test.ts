import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentSchemaVersion, isSchemaInRange, runMigrations, runSeed } from '../src';
import { startPostgres } from './pg';

/** Uji integrasi: migrasi dari nol + seed 2× pada PG 14 (versi minimum target). */
describe('migrasi 0001 di PostgreSQL 14', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await startPostgres();
    pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 2 });
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('migrate idempoten + schema_migration tercatat', async () => {
    await runMigrations(pool);
    await runMigrations(pool);
    const v = await currentSchemaVersion(pool);
    expect(v).toBe('0001');
    expect(isSchemaInRange(v, '0001', '0001')).toBe(true);
    expect(isSchemaInRange(v, '0002', '0005')).toBe(false);
  });

  it('seed idempoten: 2 user, 2 role, 4 menu', async () => {
    await runSeed(pool);
    await runSeed(pool);
    const n = async (t: string) =>
      (await pool.query<{ n: number }>(`SELECT count(*)::int n FROM ${t}`)).rows[0]!.n;
    expect(await n('app_user')).toBe(2);
    expect(await n('role')).toBe(2);
    expect(await n('menu')).toBe(4);
  });

  it('audit_log append-only (trigger)', async () => {
    await pool.query(`INSERT INTO audit_log(entity, action) VALUES ('test', 'X')`);
    await expect(pool.query(`UPDATE audit_log SET action = 'Y'`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
  });
});
