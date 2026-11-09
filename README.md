# Levytech WMS — Boilerplate

Kerangka dasar untuk menulis ulang WMS **halaman demi halaman**. Isinya hanya fondasi:
konfigurasi monorepo, backend berlapis (Clean/Hexagonal), database + migrasi, **auth (login, sesi,
refresh token, ganti password, lockout)**, **RBAC per menu & per aksi**, design system, dan deploy
Docker. Fitur WMS (inbound, stok, picking, dst.) **belum ada** — ditulis ulang di atas pola ini.

Ada dua halaman contoh:

| Halaman         | Menu (`menu.code`) | ADMIN                   | STAFF                                  | Fungsinya sebagai acuan                                    |
| --------------- | ------------------ | ----------------------- | -------------------------------------- | ---------------------------------------------------------- |
| `/sample/items` | `sample_items`     | lihat/tambah/ubah/hapus | lihat/tambah/ubah (**tanpa hapus**)    | **Pola CRUD lengkap** — salin ini untuk halaman baru       |
| `/admin/users`  | `admin_users`      | penuh                   | **tidak bisa** (→ /forbidden, API 403) | Kelola user, role, reset password, nonaktifkan, cabut sesi |

User awal (seed): `admin` dan `staff`, password awal keduanya **`ChangeMe123!`** — wajib diganti
saat login pertama.

## Stack

Next.js 16 (App Router, fullstack, `output: standalone`) · TypeScript · PostgreSQL 14+ · Drizzle ORM ·
pnpm + Turborepo · zod · jose + argon2 · TanStack Query · react-hook-form · next-intl · next-themes ·
Tailwind 4 · Vitest + Testcontainers. Alasan pilihan: `docs/adr-tech-stack-wms-baseline.md`.

## Menjalankan di laptop

Butuh: Node 22.15+, pnpm 10, Docker (untuk Postgres & uji integrasi).

```bash
pnpm install
cp .env.example .env          # sekali saja
pnpm db:up                    # Postgres dev di localhost:5433
pnpm db:reset                 # migrate + seed (DB dev dihapus & dibuat ulang)
pnpm dev                      # http://localhost:3000
```

| Perintah                                             | Fungsi                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm test`                                          | Unit test (domain, use-case dgn repo palsu, sinkron menu, guard page)   |
| `pnpm test:integration`                              | Uji dengan Postgres sungguhan (Testcontainers — Docker harus jalan)     |
| `pnpm lint` · `pnpm type-check` · `pnpm format`      | Kualitas kode                                                           |
| `pnpm build`                                         | Build produksi (standalone)                                             |
| `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:reset` | Database                                                                |
| `bash scripts/smoke.sh`                              | Uji HTTP end-to-end auth + RBAC ke server yang berjalan (DB seed segar) |
| `pnpm quality`                                       | format + lint + type-check + test + build sekaligus                     |

## Peta kode

```
apps/web                      Next.js = adapter (UI + HTTP). Tidak berisi aturan bisnis.
  src/app/(public)            login, change-password
  src/app/(protected)         halaman ber-sesi; SETIAP page.tsx wajib requirePageAccess('<menu>')
  src/app/api/v1              route handler: validasi zod → panggil use-case → envelope JSON
  src/features/<fitur>        komponen client + services (panggilan API) per fitur
  src/components              design system (ui/, blocks/, layout/)
  src/config/app.config.ts    katalog menu FE (harus sama dengan menu di seed — dijaga tes)
  src/server                  guard halaman, sesi (cookie), wrapper `authed()`, CSRF
  src/proxy.ts                cek token ringan + auto-refresh + paksa ganti password
  brands/<id>                 logo & warna per klien (BRAND_ID saat build); `default` = Levytech WMS (teal)
packages/domain               aturan murni tanpa dependensi (RBAC bitmask, DomainError)
packages/contracts            schema zod + DTO (dipakai server & form FE)
packages/application          PORT (interface repo) + USE-CASE (authorize → aturan → tulis → audit)
packages/infrastructure       adapter Drizzle (repos/), UnitOfWork (transaksi), argon2/jose, container
packages/db                   migrations/*.sql (sumber kebenaran), seed/seed.sql, schema.ts (hasil introspeksi)
packages/config               validasi environment (zod)
deploy/                       docker-compose produksi satu server + contoh env
docs/                         SPESIFIKASI TARGET WMS lengkap (desain dari versi sebelumnya) — acuan menulis ulang
```

Aturan dependensi (ditegakkan ESLint): `domain` ← `contracts` ← `application` ← `infrastructure` ← `apps/web`.
Use-case tidak boleh mengimpor Next/Drizzle/pg — hanya port.

## Alur satu request (contoh: staff menghapus item)

```
Browser ──DELETE /api/v1/sample/items/{id}──▶ route.ts
  authed(): cookie access_token valid? CSRF cocok? (else 401/403)
  └─▶ deleteSampleItem(uow, userId, id)            ← packages/application
        uow.run(tx):  authorize(r, user, 'sample_items', 'delete')  → STAFF tak punya → 403 FORBIDDEN
                      lock baris → delete → audit_log                 (satu transaksi)
  ◀── { success:false, error:{ code:'FORBIDDEN', ... } }  (status 403)
```

Tombol "Hapus" juga tidak dirender untuk staff (`canDelete` dari page.tsx), tapi itu hanya
kenyamanan — **penegakan sebenarnya selalu di server**.

## Auth & sesi (ringkas)

- **Login** → access token JWT (15 mnt, cookie httpOnly) + refresh token (7 hari, cookie path
  `/api/v1/auth`, disimpan sebagai hash) + cookie `user_session` (menu & role terenkripsi, untuk UI).
- **Refresh rotasi one-time-use**: token lama dipakai ulang di luar grace 30 dtk → seluruh sesi
  (family) dicabut. Access token habis saat navigasi → `proxy.ts` mengarahkan ke `/api/v1/auth/refresh`.
- **Lockout**: 5× gagal → terkunci 15 menit (`app_setting`). Pesan gagal identik (anti-enumerasi).
- **Wajib ganti password** saat login pertama / setelah reset admin — API lain diblok (403).
- **Nonaktifkan user** → hak hilang seketika + semua refresh token dicabut.
- **CSRF**: same-origin + double-submit token (`x-csrf-token`) untuk semua mutasi.
- **Pengaman**: tidak bisa menonaktifkan diri sendiri; perubahan yang menyisakan nol admin ditolak (`LAST_ADMIN`).

Detail desain: `docs/auth-session-wms-baseline.md`, `docs/frontend-design-wms-baseline.md` §5–7.

## Cara menambah halaman baru (checklist)

Contoh: halaman **Master UOM** di `/master/uom` → `menu.code` = `master_uom`
(konvensi: route tanpa `/` awal, `/` dan `-` → `_`). Salin dari file contoh `sample-items` di tiap langkah.

**Database**

1. `packages/db/migrations/0001_baseline.sql` — tambah tabel (pra-rilis: edit 0001; setelah rilis
   pertama: buat `0002_*.sql` baru + entri di `meta/_journal.json`).
2. `packages/db/seed/seed.sql` — tambah menu (`master` induk + `master_uom`) dan hak di matriks RBAC.
3. `pnpm db:reset`, lalu regenerasi `schema.ts`: `pnpm --filter @wms/db introspect` → salin
   `packages/db/.introspect/schema.ts` ke `packages/db/src/schema.ts` (pertahankan 2 baris komentar
   di atas), hapus folder `.introspect`.

**Backend**

4. `packages/contracts/src/<fitur>.ts` — schema zod create/update/query + tipe DTO; export di `index.ts`.
5. `packages/application/src/ports/index.ts` — interface repository + daftarkan di `Repos`.
6. `packages/application/src/use-cases/<fitur>.ts` — tiap aksi: `uow.run` → `authorize(menu, aksi)`
   → aturan bisnis (`DomainError`) → tulis → `audit.log`. Export di `src/index.ts`.
7. `packages/infrastructure/src/repos/<fitur>.ts` — implementasi Drizzle; daftarkan di `uow.ts`.
8. Tes: unit di `packages/application/test` (repo palsu di `fakes.ts`) dan/atau integrasi di
   `packages/infrastructure/test/*.int.test.ts`.

**Frontend**

9. `apps/web/src/app/api/v1/<route>/route.ts` — `authed()` + `parseQuery/parseBody` + use-case.
10. `apps/web/src/config/app.config.ts` — tambah `leaf('/master/uom')` (dan grup induk + ikon bila baru).
11. `apps/web/src/messages/{id,en}.json` — `nav.master`, `nav.master_uom`, teks fitur, `errors.<REASON>` baru.
12. `apps/web/src/features/<fitur>/` — `services/` (API + query keys) + `components/` (list/form).
13. `apps/web/src/app/(protected)/master/uom/page.tsx` — `requirePageAccess('master_uom')` + hak per aksi.
14. `pnpm quality` (tes `menu-sync` gagal bila katalog FE ≠ seed atau page lupa memanggil guard).

Tips: menu yang sudah terdaftar di katalog tapi page-nya belum dibuat otomatis menampilkan
"Belum tersedia" (tetap dijaga RBAC) — jadi Anda bisa menambah menu dulu, halaman menyusul.

## Deploy (satu server, Docker Compose)

```bash
git clone <repo> wms && cd wms
cp deploy/wms.env.example deploy/wms.env   # isi password DB & 2 rahasia acak (openssl rand ...)
docker compose -f deploy/docker-compose.yml --env-file deploy/wms.env up -d --build
```

- Urutan otomatis: `postgres` sehat → `migrate` (migrasi + seed idempoten, lalu keluar) → `web`.
- Web hanya terbuka di `127.0.0.1:3000` — publikasikan lewat reverse proxy ber-HTTPS
  (Caddy/nginx/Cloudflare Tunnel). Cookie sesi bertanda `Secure` → **butuh HTTPS**.
  Uji cepat di LAN tanpa HTTPS: set `WMS_BIND=0.0.0.0` dan `COOKIE_SECURE=false` (jangan di produksi).
- Cek: `curl localhost:3000/api/health` dan `/api/ready` (DB + versi schema).
- **Segera login sebagai `admin` & `staff` dan ganti password**; nonaktifkan `staff` bila tak dipakai.
- Upgrade: `git pull` lalu ulangi perintah `up -d --build` (migrasi jalan otomatis).
- Image siap-registry dibangun CI saat tag `v*` (`.github/workflows/release.yml`): target `web` & `migrate`.

## Database & migrasi

- `migrations/*.sql` = sumber kebenaran (forward-only). Setiap file diakhiri
  `INSERT INTO schema_migration(...)`; `/api/ready` memeriksa versi ada di rentang
  `SCHEMA_MIN_VERSION..SCHEMA_MAX_VERSION`.
- **Pra-rilis** (belum ada instalasi klien): cukup ubah `0001_baseline.sql` lalu `pnpm db:reset`.
- **Sejak rilis pertama**: catat checksum `0001` di `meta/checksums.json` (tes memastikan tak berubah)
  dan semua perubahan berikutnya = migrasi baru. Detail: `docs/migration-wms-baseline.md`.
- `audit_log` append-only (trigger menolak UPDATE/DELETE). User tidak pernah di-DELETE — nonaktifkan.
