import { z } from 'zod';

/** Environment tervalidasi (rahasia & TTL di env, BUKAN app_setting — auth-session §1). */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET minimal 32 karakter'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET minimal 32 karakter'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).default(30),
  DB_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  /** Rentang versi schema_migration yang didukung app (dibaca /api/ready — migration §4). */
  SCHEMA_MIN_VERSION: z.string().default('0001'),
  SCHEMA_MAX_VERSION: z.string().default('0001'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Konfigurasi environment tidak valid — ${issues}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}
