# Levytech WMS (v2) — Project Guide

> **Untuk AI/agen:** repo ini adalah **boilerplate** untuk menulis ulang WMS secara bertahap, halaman demi
> halaman, oleh pemilik proyek yang ingin memahami seluruh kode. Saat ini isinya HANYA fondasi:
> config monorepo, auth + sesi, RBAC, design system, deploy, dan dua halaman contoh (`/sample/items`,
> `/admin/users`). **Fitur WMS belum ada** — jangan menambahkannya kecuali diminta, dan saat diminta,
> kerjakan satu halaman/fitur per langkah mengikuti checklist "Cara menambah halaman baru" di `README.md`.
> Utamakan kode yang mudah dibaca & dijelaskan; ikuti pola file contoh `sample-items` di tiap lapisan.

## Sumber acuan

- `README.md` — cara menjalankan, peta kode, alur request, checklist menambah halaman, deploy.
- `docs/` — **spesifikasi TARGET** WMS lengkap (dari implementasi sebelumnya di repo `wms-template`).
  Muat hanya file yang relevan dengan tugas (peta di bawah). Bagian yang membahas implementasi lama
  (m1–m5, `panduan-deploy-mini-server.md`, `panduan-uji-coba-wms.md`, worker, ERP simulator, smoke M0–M5)
  menggambarkan kode yang **belum ada** di repo ini — pakai sebagai referensi saat menulis ulang.
- Repo lama `../wms-template` = "kunci jawaban" implementasi lengkap untuk dibandingkan.

| Topik                                    | File                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Domain, ERD, RBAC, state machine, menu   | `docs/spesifikasi-wms-baseline.md`                                                                              |
| Requirements, glossary kanonik (§2)      | `docs/requirements-wms-baseline.md`                                                                             |
| Algoritma & sequence per operasi         | `docs/behavioral-spec-wms-baseline.md`                                                                          |
| Skema target lengkap (DDL) & seed        | `docs/schema-wms-baseline.sql`, `docs/seed-wms-baseline.sql`                                                    |
| REST API (envelope, error, RBAC)         | `docs/api-design-wms-baseline.md`                                                                               |
| Auth & sesi                              | `docs/auth-session-wms-baseline.md`                                                                             |
| Frontend (tema, menu, guard, sesi)       | `docs/frontend-design-wms-baseline.md`                                                                          |
| Migrasi forward-only                     | `docs/migration-wms-baseline.md`                                                                                |
| ADR tech stack                           | `docs/adr-tech-stack-wms-baseline.md`                                                                           |
| Handheld, flow steps, label, ERP, config | `docs/handheld-pwa-…`, `docs/flow-steps-…`, `docs/labeling-…`, `docs/erp-integration-…`, `docs/configuration-…` |

## Tech stack (terkunci)

Next.js 16 App Router fullstack (standalone) · TypeScript · PostgreSQL 14+ · Drizzle ORM (migrasi SQL
forward-only, `schema.ts` hasil introspeksi) · pnpm + Turborepo · zod · jose + argon2 · pino · Vitest +
Testcontainers · next-intl · next-themes · TanStack Query · react-hook-form · Tailwind 4.

## Peta kode & aturan lapisan

| Paket                     | Isi                                                                | Aturan                                                     |
| ------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `packages/domain`         | RBAC bitmask, `DomainError(code, reason)`                          | Tanpa dependensi                                           |
| `packages/contracts`      | zod schema + DTO, katalog `ERROR_REASONS`                          | Hanya zod                                                  |
| `packages/application`    | Port (interface repo) + use-case                                   | Hanya domain + contracts (lint)                            |
| `packages/infrastructure` | Repo Drizzle, UnitOfWork, argon2/jose, `createContainer`           | —                                                          |
| `packages/db`             | `migrations/0001_baseline.sql`, `seed/seed.sql`, `src/schema.ts`   | SQL = sumber kebenaran; schema.ts digenerate               |
| `apps/web`                | Next.js adapter (pages, `/api/v1`, features, design system)        | Tiap `page.tsx` terlindung wajib `requirePageAccess` (tes) |
| `deploy/`                 | `docker-compose.yml` (postgres → migrate → web), `wms.env.example` | `deploy/*.env` tak di-commit                               |

Perintah: `pnpm dev` · `pnpm test` · `pnpm test:integration` (Docker) · `pnpm lint` · `pnpm type-check` ·
`pnpm build` · `pnpm db:up` (Postgres dev :5433) · `pnpm db:reset` · `bash scripts/smoke.sh` · `pnpm quality`.

## Invarian (wajib dipertahankan)

1. **RBAC deny-by-default, ditegakkan server-side di setiap use-case** (`authorize(r, actor, menuCode, aksi)`
   di dalam `uow.run`), hanya untuk user ACTIVE. UI menyembunyikan tombol hanya sebagai kenyamanan.
2. **Menu = katalog statis FE** (`app.config.ts`) == `menu.code` di seed (dijaga `test/menu-sync.test.ts`);
   `menu.code` = route dengan `/`,`-` → `_`. Guard RBAC di tiap `page.tsx`, bukan di layout.
3. **Satu aksi = satu transaksi** (`uow.run`); audit_log ditulis di transaksi yang sama; `audit_log` immutable.
4. **Use-case tidak tahu HTTP/Next/Drizzle**; route handler tidak berisi aturan bisnis.
5. **Error** = `DomainError(code, reason)` → adapter HTTP memetakan ke status + envelope; reason baru
   = tambah di `ERROR_REASONS` + `errors.<reason>` di messages.
6. **Migrasi forward-only**: pra-rilis boleh menimpa `0001`; setelah rilis pertama, beku (checksum) → `0002…`.
   Setelah mengubah SQL: `pnpm db:reset` + regenerasi `schema.ts` (lihat README).
7. **Waktu disimpan UTC**; rahasia & TTL di env (bukan DB); branding di `apps/web/brands/` (bukan DB).
8. Invarian stok WMS (quant + ledger, confirm atomik, protokol lock, base UOM, dll.) ada di
   `docs/` dan `../wms-template/CLAUDE.md` — terapkan saat fitur stok mulai ditulis ulang.

## Konvensi

- Bahasa dokumen & komentar: Indonesia. ID stabil dari docs (`FR-*`, `BR-*`, `AC-*`, `D-*`, …) dipakai bila relevan.
- Seed user: `admin` (ADMIN) & `staff` (STAFF), password awal `ChangeMe123!` (wajib ganti).
- Dev server Postgres di port **5433** (repo lama memakai 5432).
