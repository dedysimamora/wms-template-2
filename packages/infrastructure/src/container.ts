import { loadEnv, type Env } from '@wms/config';
import { createDb, createPool, type Db } from '@wms/db';
import type { AuthDeps, Clock, UserAdminDeps } from '@wms/application';
import type pg from 'pg';
import { createLogger, type Logger } from './logger';
import { Argon2Hasher, JoseTokenService } from './security';
import { DrizzleUnitOfWork } from './uow';

export type Container = {
  env: Env;
  pool: pg.Pool;
  db: Db;
  clock: Clock;
  uow: DrizzleUnitOfWork;
  auth: AuthDeps;
  userAdmin: UserAdminDeps;
  tokens: JoseTokenService;
  logger: Logger;
};

/** Composition root (ADR-002): satu tempat merakit adapter → dipakai apps/web & test. */
export function createContainer(env: Env = loadEnv(), name = 'wms'): Container {
  const pool = createPool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    lockTimeoutMs: env.DB_LOCK_TIMEOUT_MS,
    statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
    applicationName: name,
  });
  const db = createDb(pool);
  const clock: Clock = { now: () => new Date() };
  const uow = new DrizzleUnitOfWork(db);
  const tokens = new JoseTokenService(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS);
  const hasher = new Argon2Hasher();
  return {
    env,
    pool,
    db,
    clock,
    uow,
    tokens,
    logger: createLogger(env.LOG_LEVEL, name),
    auth: {
      uow,
      clock,
      tokens,
      hasher,
      refreshTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
      graceSeconds: env.REFRESH_REUSE_GRACE_SECONDS,
    },
    userAdmin: { uow, clock, hasher },
  };
}
