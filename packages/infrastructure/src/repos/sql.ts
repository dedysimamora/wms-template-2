import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from './tx';

/** Jalankan SQL mentah (drizzle `sql`) → baris bertipe. Untuk query yang sulit di query builder. */
export async function rows<T>(tx: Tx, q: SQL): Promise<T[]> {
  const res = await tx.execute(q);
  return res.rows as T[];
}

/** Timestamp (string/Date) → Date. */
export const ts = (v: string | Date | null | undefined): Date | null =>
  v == null ? null : v instanceof Date ? v : new Date(v);

/** Timestamp → ISO string (atau null). */
export const iso = (v: string | Date | null | undefined) => ts(v)?.toISOString() ?? null;

export const where = (conds: SQL[]) =>
  conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

/** Pola ILIKE aman: `%`, `_`, `\` di input pengguna di-escape. */
export const likeEscape = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

export const uuidArray = (ids: string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`;
