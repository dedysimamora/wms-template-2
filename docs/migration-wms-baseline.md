# Schema Migration — WMS Baseline

**Strategi migrasi schema lintas-instalasi (forward-only, terversi, terlacak) · merealisasikan OQ-9**

Versi: 1.2 · 24 September 2026 · Pembaruan 1.2: aturan paritas docs↔migrasi (skema kumulatif, paritas katalog) + kebijakan pra-rilis (baseline `0001` ditimpa sampai rilis pertama, lalu beku via checksum). Pembaruan 1.1: rekonsiliasi drizzle-kit (penamaan & tabel pelacak) dengan `schema_migration`; objek non-tabel via custom migration; aturan enum.

> Topik: bagaimana upgrade schema disebar ke banyak deployment single-tenant independen. Tabel terkait: `schema_migration`. Tool: `drizzle-kit` (ADR-003). Prosedur deploy operasional lengkap di `test-delivery-plan-wms-baseline.md` §17–18.

---

## 1. Prinsip

- **Forward-only** di produksi: tidak ada "down migration". Kesalahan dipulihkan lewat backup + migrasi perbaikan maju.
- **Terlacak:** tiap instalasi punya tabel `schema_migration` (versi mana sudah diterapkan).
- **Idempoten pada level runner:** migrasi yang sudah tercatat tidak dijalankan ulang.
- **Seed ≠ migrasi:** `seed-*.sql` untuk instalasi baru (idempoten, `ON CONFLICT DO NOTHING`); perubahan struktur pada instalasi lama lewat migrasi.

## 2. Konvensi

- **Tool = `drizzle-kit`** (ADR-003), forward-only. Penamaan mengikuti drizzle: `packages/db/migrations/{nnnn}_{deskripsi}.sql` (mis. `0002_partner_min_shelf_life.sql`), urut naik, tak boleh diubah setelah rilis.
- **Dua tabel, dua peran:** `__drizzle_migrations` (milik drizzle) = pelacak eksekusi runner; `schema_migration` (milik WMS) = registri versi yang dibaca app/`/api/ready`. Setiap skrip migrasi **diakhiri** `INSERT INTO schema_migration(version, description) VALUES ('{nnnn}', '…');` — dijaga lint CI (skrip tanpa baris ini gagal).
- **Objek yang tak dimodelkan skema Drizzle** (fungsi & trigger `forbid_mutation`/`bump_version`/`set_updated_at`, unique index berbasis `COALESCE`, partial index, CHECK kompleks, `REVOKE`) ditulis sebagai **custom migration** (`drizzle-kit generate --custom`). Skema Drizzle = sumber kebenaran tabel/kolom/FK; custom migration = sumber kebenaran objek lain. `schema-wms-baseline.sql` adalah dokumentasi hasil gabungan keduanya, diverifikasi CI (`pg_dump --schema-only` DB hasil migrasi vs berkas ini).
- **Enum:** `ALTER TYPE … ADD VALUE` di skrip tersendiri (nilai baru tak bisa dipakai di transaksi yang sama).
- Satu migrasi = satu perubahan koheren; sertakan komentar tujuan.
- Baseline saat ini = `0001_baseline.sql` (setara schema v1.5). **Pra-rilis:** perubahan schema menimpa `0001`. **Pasca-rilis:** perubahan = `0002`, dst. (§2.1).

### 2.1 Aturan paritas docs ↔ migrasi (dijaga CI)

| Artefak | Peran | Penjaga |
|---|---|---|
| `docs/schema-wms-baseline.sql` | Skema **kumulatif**, yaitu keadaan terkini dan sumber kebenaran desain. Setiap perubahan ditulis di sini **dan** sebagai migrasi baru | `schema-parity.int.test.ts` |
| `packages/db/migrations/{nnnn}_*.sql` | Delta. **Pra-rilis:** hanya `0001_baseline` = `docs/schema` + registri, boleh ditimpa. **Pasca-rilis:** beku, koreksi = migrasi baru | `meta/checksums.json` (sha256, kosong sampai rilis), `parity.test.ts` |
| `packages/db/seed/seed.sql`, `seed/ddl-validation.sql` | Salinan byte-per-byte dari `docs/` | `parity.test.ts` |
| `packages/db/src/schema.ts` | Hasil introspeksi DB versi terakhir (`pnpm --filter @wms/db introspect`) | type-check |

- **Paritas katalog:** di PostgreSQL nyata, database hasil *semua migrasi* dan database hasil *`docs/schema`* harus punya tanda tangan katalog identik: kolom (tipe/null/default), definisi constraint, index, trigger, urutan label enum, dan hash fungsi. Urutan kolom dan nama objek yang di-generate otomatis diabaikan. Query-nya ada di `packages/db/src/catalog.ts`.
- **Jalur upgrade:** begitu ada ≥2 migrasi, CI membuat instalasi "lama" (migrasi pertama saja + seed + data), lalu memigrasikannya ke versi terakhir. Data harus utuh dan semua skenario validasi harus lulus. Pra-rilis tes ini dilewati karena hanya ada satu migrasi.

**Kebijakan pra-rilis → pasca-rilis:**

| Fase | Kondisi | Cara mengubah schema | Dampak DB dev |
|---|---|---|---|
| **Pra-rilis** (sekarang) | Belum ada instalasi klien; `checksums.json` kosong | Ubah `docs/schema`, lalu timpa `0001_baseline.sql` (= docs + baris registri). Versi schema tetap `0001` | Wajib `pnpm db:reset` (drizzle tidak menjalankan ulang 0001 yang sudah tercatat) |
| **Rilis pertama** (deploy klien pertama / tag v1.0) | — | Catat sha256 `0001_baseline` di `checksums.json`. Sejak itu `0001` beku | — |
| **Pasca-rilis** | `checksums.json` berisi | Migrasi baru `0002…` (expand → contract, §5); `0001` dilarang diubah (CI gagal) | Cukup `pnpm db:migrate` |
- **Checklist perubahan schema:**
  1. Ubah `docs/schema` dan naikkan versinya; header wajib menyebut migrasi terakhir (`migrasi {nnnn}_…`).
  2. Pra-rilis: timpa `0001_baseline.sql`. Pasca-rilis: tulis `migrations/{nnnn}_*.sql` yang diakhiri `INSERT INTO schema_migration` dan daftarkan di `_journal.json`.
  3. Saat rilis: catat checksum migrasi yang dirilis di `meta/checksums.json`.
  4. Tambahkan skenario ke `docs/ddl-validation` dan salin ke `seed/`.
  5. Jalankan `introspect` dan salin hasilnya ke `src/schema.ts`.
  6. Naikkan `SCHEMA_MIN/MAX_VERSION`.
- `ddl-validation` aman dijalankan di DB berisi data (fixture ber-prefiks `VAL-`, pernyataan dibatasi ke fixture, semua di-ROLLBACK). Rekonsiliasi D-2 sengaja memeriksa seluruh data.

## 3. Prosedur upgrade per instalasi

```
1. Umumkan maintenance window (WMS single-tenant; downtime singkat dapat diterima).
2. Backup DB (verifikasi backup sukses) — RPO sesuai NFR-BKP.
3. Jalankan runner migrasi: terapkan semua versi > versi terpasang, transaksional per skrip.
4. Runner mencatat tiap versi di schema_migration.
5. Deploy versi aplikasi yang kompatibel (lihat §4).
6. Smoke test kritis (login, receipt, pick, confirm).
7. Bila gagal di langkah 3: rollback via backup, perbaiki skrip, ulangi.
```

## 4. Kompatibilitas versi app ↔ schema

- Aplikasi menyatakan **rentang schema yang didukung** (mis. app 1.4 butuh schema ≥ `0002` ≤ `0005`; saat ini `0001`..`0001`).
- Saat start-up, app **memeriksa** `schema_migration` versi tertinggi; bila di luar rentang → tolak start (fail fast) dengan pesan jelas (endpoint `/api/ready` mencerminkan ini).
- Untuk zero-downtime (fase lanjut): terapkan migrasi **backward-compatible** dulu (tambah kolom nullable), deploy app, baru migrasi pembersih — pola expand/contract.

## 5. Rollback & recovery

- Produksi: **tidak** ada down-migration otomatis. Pemulihan = restore backup (RTO sesuai NFR-BKP) + migrasi maju perbaikan.
- Perubahan destruktif (drop kolom/tabel) memakai pola **expand → migrate data → contract** lintas beberapa rilis agar aman.
- Feature flag dipakai untuk memisahkan "schema siap" dari "fitur menyala".

## 6. Ringkas alur data versi

```
Instalasi baru  : drizzle migrate (0001_baseline … 000n) → seed → jalan
Instalasi lama  : drizzle migrate terapkan 000k..000n → schema_migration terisi → app kompatibel di-deploy
```

---

## Ringkasan Keputusan (migrasi)

1. Migrasi **forward-only, terversi (`{nnnn}_` ala drizzle)**; `__drizzle_migrations` = pelacak eksekusi, `schema_migration` = registri versi app (diisi tiap skrip); objek non-tabel via custom migration; tool = `drizzle-kit` (ADR-003).
2. App **fail-fast** bila schema di luar rentang; recovery via **restore backup** (bukan down-migration).
3. Perubahan destruktif via **expand → migrate → contract**.
