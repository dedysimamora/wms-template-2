import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ATURAN MIGRASI (docs/migration-wms-baseline.md §2.1):
 *  - PRA-RILIS (belum ada instalasi klien): cukup satu migrasi 0001_baseline; perubahan schema
 *    langsung menimpa 0001, DB dev cukup `pnpm db:reset`.
 *  - SEJAK RILIS PERTAMA: checksum migrasi yang dirilis dicatat di meta/checksums.json → BEKU;
 *    perubahan berikutnya WAJIB migrasi baru (0002, …).
 *  - Setiap migrasi diakhiri INSERT INTO schema_migration dengan versinya (dibaca /api/ready).
 */
const dir = path.resolve(__dirname, '../migrations');
const read = (p: string) => readFileSync(path.join(dir, p), 'utf8');
const journal = JSON.parse(read('meta/_journal.json')) as {
  entries: { idx: number; tag: string }[];
};
const checksums = JSON.parse(read('meta/checksums.json')) as Record<string, string>;
const tags = journal.entries.map((e) => e.tag);
const released = Object.keys(checksums);

describe('migrasi forward-only', () => {
  it('journal berurutan: idx 0..n, prefix 0001..n', () => {
    journal.entries.forEach((e, i) => {
      expect(e.idx).toBe(i);
      expect(e.tag.slice(0, 4)).toBe(String(i + 1).padStart(4, '0'));
    });
  });

  it('setiap migrasi diakhiri INSERT INTO schema_migration dengan versinya', () => {
    for (const tag of tags) {
      const sql = read(`${tag}.sql`).trimEnd();
      expect(sql, tag).toMatch(
        new RegExp(
          `INSERT INTO schema_migration\\(version, description\\) VALUES \\('${tag.slice(0, 4)}',.*\\);$`,
        ),
      );
    }
  });

  it('migrasi yang sudah DIRILIS tidak berubah (checksum)', () => {
    for (const [tag, sum] of Object.entries(checksums)) {
      expect(tags, `${tag} tercatat rilis tapi tidak ada di journal`).toContain(tag);
      const actual = createHash('sha256')
        .update(read(`${tag}.sql`))
        .digest('hex');
      expect(actual, `${tag} DIUBAH setelah rilis — buat migrasi baru, jangan edit yang lama`).toBe(
        sum,
      );
    }
    expect([...released].sort()).toEqual(tags.slice(0, released.length));
  });
});
