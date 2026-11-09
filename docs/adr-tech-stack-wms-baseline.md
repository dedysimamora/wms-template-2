# ADR — Tech Stack WMS Baseline

**Kumpulan Architecture Decision Record · pelengkap Spesifikasi v1.3, Requirements v1.1, Behavioral Spec v1.1**

> Revisi 24-09-2026 (tanpa mengubah keputusan): konvensi migrasi drizzle + custom migration (ADR-003), CC-1..CC-11, handheld di segmen `/hh`, guard per page (ADR-001).

Versi: 1.0 · 23 September 2026 · Deciders: Owner produk · Status keseluruhan: **Accepted**

> Setiap ADR berdiri sendiri (Context → Decision → Options → Trade-off → Consequences → Action). Keputusan di sini mengikat pilihan teknologi; keputusan domain/arsitektur data ada di dokumen lain.

## Indeks

| ADR | Judul | Status |
|---|---|---|
| ADR-001 | Arsitektur aplikasi: Next.js fullstack modular monolith | Accepted |
| ADR-002 | Struktur backend: Clean / Hexagonal Architecture | Accepted |
| ADR-003 | Persistence & data access: PostgreSQL + Drizzle ORM | Accepted |
| ADR-004 | Handheld: Progressive Web App (PWA) | Accepted |
| ADR-005 | Struktur repo: Monorepo (pnpm + Turborepo) | Accepted |
| ADR-006 | Runtime & library pendukung (default) | Accepted |

---

## ADR-001: Arsitektur aplikasi — Next.js fullstack modular monolith

**Status:** Accepted · **Date:** 2026-09-23

### Context
WMS single-tenant di-install di VPS/server milik tiap klien. Prioritas: **instalasi mudah, minim setup**, dan jalur jelas untuk memisah backend jadi service saat kebutuhan membesar. Beban kerja transaksional (locking, reservasi) berpusat di PostgreSQL; latensi didominasi DB, bukan bahasa app.

### Decision
Gunakan **Next.js (App Router) sebagai fullstack** — men-serve frontend (React) **dan** REST API (Route Handlers) dalam satu aplikasi, **self-hosted** (`next start` / output `standalone`, proses Node biasa di VPS — **bukan** serverless). Logika bisnis diisolasi di layer domain framework-agnostic (ADR-002), sehingga Next.js hanya berperan sebagai *delivery adapter*. Model ini adalah **modular monolith**: satu deployable sekarang, siap dipecah nanti.

### Options Considered

#### Opsi A: Next.js fullstack (dipilih)
| Dimensi | Penilaian |
|---|---|
| Kompleksitas | Rendah (satu app) |
| Biaya/ops | Rendah (satu proses + reverse proxy) |
| Skalabilitas | Cukup untuk single-tenant; ekstraksi via ADR-002 |
| Kemudahan install | **Sangat baik** (satu artefak) |

**Pros:** satu repo/build/deploy; share type FE↔BE; tanpa network hop; footprint ringan; paling cepat ship.
**Cons:** layer API adalah bagian terlemah Next.js; konvensi backend (DI, guard, interceptor) dirakit sendiri.

#### Opsi B: Next.js (FE) + NestJS/Fastify (BE) terpisah
| Dimensi | Penilaian |
|---|---|
| Kompleksitas | Sedang–tinggi (dua app) |
| Biaya/ops | Lebih tinggi (dua proses, dua config per instalasi) |
| Skalabilitas | Backend bisa scale independen |
| Kemudahan install | Lemah (melawan tujuan) |

**Pros:** struktur backend matang bawaan; pemisahan tegas.
**Cons:** dua deployable per instalasi single-tenant = beban support berlipat; potensi network hop; kurva belajar.

#### Opsi C: NestJS fullstack (serve build SPA)
**Pros:** backend-proper, primitif clean-arch bawaan.
**Cons:** kehilangan DX/SSR Next.js untuk UI kaya; jarang dipakai men-serve FE kompleks.

### Trade-off Analysis
Opsi B unggul di *fungsi backend bawaan* dan *scaling independen*, tapi keduanya bukan kebutuhan fase 1 dan **mengorbankan tujuan utama (instalasi mudah)**. Kesiapan-ekstraksi yang B tawarkan tetap didapat dari A **lewat Clean Architecture (ADR-002)** tanpa ongkos dua-app. Performa A setara/lebih baik (tanpa hop). Karena itu A dipilih; NestJS/Fastify menjadi **target ekstraksi**, bukan fondasi awal.

### Consequences
- (+) Instalasi = satu artefak; onboarding cepat; iterasi UI+API mulus.
- (−) Worker latar (outbox ERP, cron) **harus** proses terpisah (ADR-005 `apps/worker`) — Next.js request-driven.
- (−) Concern lintas (RBAC guard, audit interceptor, error envelope) dirakit sebagai util/middleware tipis, bukan primitif framework.
- Revisit bila: satu modul butuh scaling/deploy independen, atau tim backend membesar → ekstrak modul jadi service (NestJS/Fastify) memakai domain yang sama.

### Action Items
1. [ ] Setup Next.js App Router, output `standalone`, jalankan via `next start` di belakang reverse proxy (Nginx/Caddy).
2. [ ] Larang penggunaan Edge runtime untuk route handler stok (butuh Node + koneksi DB persisten).
3. [ ] Tetapkan pola guard RBAC (termasuk resolusi menu per operation type) & interceptor audit/idempotensi sebagai wrapper Route Handler; guard halaman dipanggil per `page.tsx` (frontend §6).

---

## ADR-002: Struktur backend — Clean / Hexagonal Architecture

**Status:** Accepted · **Date:** 2026-09-23

### Context
Owner ingin backend mudah dipisah jadi service/microservice saat membesar. Domain WMS kaya aturan (reservasi, locking, state machine, konfirmasi atomik) yang tidak boleh tercampur dengan detail HTTP/ORM.

### Decision
Terapkan **Clean/Hexagonal Architecture** dengan aturan dependensi searah:

```
        (paling dalam, tanpa dependensi framework)
  domain  ──►  entities, value objects, domain service, PORT (interface)
     ▲
 application ──► use-case (orkestrasi domain + port); mis. ReserveStock, ConfirmDelivery
     ▲
 infrastructure ──► ADAPTER: repository Drizzle, ERP client, label renderer, auth, doc_counter
     ▲
 delivery (apps/web route handler, apps/worker) ──► composition root: wiring & I/O
```

- **Aturan dependensi:** `domain` tak impor apa pun; `application` hanya impor `domain`; `infrastructure` mengimplementasi port dari `application/domain`; `web`/`worker` mem-*wire* semuanya. **Tidak ada** `import next/*` atau `drizzle` di `domain`/`application`.
- **Port utama:** `QuantRepository`, `StockMoveRepository`, `ReservationRepository`, `OperationRepository`, `UnitOfWork` (transaksi), `Clock`, `IdGenerator`, `ErpGateway`, `LabelRenderer`, `EventOutbox`.
- **Transaksi & locking (kritis):** use-case berjalan di dalam `UnitOfWork.withTransaction(tx => …)`; repository menerima `tx`. `FOR UPDATE`/advisory lock diekspresikan lewat method port (mis. `quantRepo.lockAvailableForUpdate(...)`), implementasinya di infrastructure (Drizzle). Domain tetap tak tahu SQL.

### Options Considered
| Opsi | Pros | Cons |
|---|---|---|
| **Clean/Hexagonal (dipilih)** | Domain murni & portabel; ekstraksi service = bungkus ulang; testable tanpa DB | Boilerplate port/adapter; disiplin tim |
| Layered klasik (controller→service→repo, tanpa port) | Lebih sedikit boilerplate | Domain tergantung ORM; ekstraksi & unit test lebih sulit |
| Transaction Script / logika di route handler | Cepat di awal | Tak terkelola untuk domain sekompleks WMS; mustahil dipecah |

### Trade-off Analysis
Boilerplate port/adapter adalah harga yang setara nilainya dengan tujuan owner (ekstraksi mulus + testability domain locking tanpa DB). Untuk sistem se-transaksional ini, disiplin arsitektur mengurangi risiko bug integritas.

### Consequences
- (+) Ekstraksi ke NestJS/Fastify = ganti composition root; use-case & domain tak berubah.
- (+) Use-case (ReserveStock dst.) diuji unit dengan port palsu; skenario konkurensi diuji integrasi (Behavioral §7).
- (−) Perlu konvensi & code review untuk menjaga aturan dependensi (lint boundary via `eslint-plugin-boundaries` / dependency-cruiser).

### Action Items
1. [ ] Definisikan port di `packages/application` sesuai daftar di atas.
2. [ ] Implementasi adapter Drizzle di `packages/infrastructure`.
3. [ ] Pasang lint boundary agar `domain`/`application` tak mengimpor framework/ORM.
4. [ ] Petakan tiap use-case ke algoritma Behavioral Spec (A-2 reserve, A-3 release, A-4 confirm, dst.).

---

## ADR-003: Persistence & data access — PostgreSQL + Drizzle ORM

**Status:** Accepted · **Date:** 2026-09-23

### Context
Schema (v1.4) sudah PostgreSQL 14+. Behavioral Spec bergantung berat pada `SELECT … FOR UPDATE`, `pg_advisory_xact_lock`, `ON CONFLICT`, partial unique index, dan transaksi multi-tabel. Data-access harus mengekspresikan semua itu **tanpa** workaround, sekaligus type-safe dan punya alat migrasi (OQ-9).

### Decision
Pakai **Drizzle ORM** (di layer infrastructure) di atas driver `pg`, dengan **`drizzle-kit`** sebagai alat migrasi terversi (menutup OQ-9: tool migrasi = drizzle-kit; pola forward-only tetap dari `migration-wms-baseline.md`).

### Options Considered
| Opsi | FOR UPDATE / advisory | Type-safety | Migrasi | Catatan |
|---|---|---|---|---|
| **Drizzle (dipilih)** | Natural (`.for('update')`, `sql\`\`` advisory) | Kuat | `drizzle-kit` (generate+migrate) | SQL-first, dekat SQL, ringan |
| Kysely | Natural | Kuat | kysely-migration | Query builder murni, lebih verbose |
| Prisma | Hanya via `$queryRaw` | Kuat | `prisma migrate` (matang) | Locking canggung untuk domain ini |
| Raw pg + repo | Natural | Manual | SQL polos | Boilerplate & type-safety dirakit |

### Trade-off Analysis
Drizzle menyeimbangkan kontrol SQL (penting untuk locking WMS) dengan type-safety & migrasi bawaan. Prisma unggul DX tapi lemah di locking eksplisit — risiko tinggi untuk sistem ini. Kysely setara secara kemampuan namun tanpa lapisan skema/relasi Drizzle.

### Consequences
- (+) `db.transaction(tx => …)`, `.for('update')`, `sql\`select pg_advisory_xact_lock(hashtext(${'p:'||productId}))\``, `.onConflictDoUpdate()` langsung tersedia untuk A-2/A-5/A-7.
- (+) Skema Drizzle dijadikan **satu sumber** yang menghasilkan migrasi; `schema_migration` (schema §16) dicatat runner.
- (−) Drizzle lebih muda dari Prisma; sebagian fitur relasi kurang matang → beberapa query kompleks ditulis dengan `sql`.
- Revisit: bila butuh read-replica/scaling baca → tambah koneksi read terpisah di adapter.

### Action Items
1. [ ] Definisikan skema Drizzle (tabel/kolom/FK) + **custom migration** untuk fungsi, trigger, index ekspresi/partial, CHECK kompleks, REVOKE; gabungannya = `0001_baseline` setara `schema-wms-baseline.sql` (v1.4).
2. [ ] Konfigurasi `drizzle-kit` (penamaan `{nnnn}_`, tabel pelacak `__drizzle_migrations`); tiap skrip menutup dengan `INSERT INTO schema_migration` (migration §2); CI membandingkan `pg_dump --schema-only` dengan berkas schema.
3. [ ] Bungkus pool `pg` dengan `lock_timeout` & `statement_timeout` wajar (Behavioral A-5).
4. [ ] Implementasi `UnitOfWork` (ADR-002) di atas `db.transaction`.

---

## ADR-004: Handheld — Progressive Web App (PWA)

**Status:** Accepted · **Date:** 2026-09-23

### Context
Operator bekerja via handheld scanner; keputusan mode = **online-only** (OQ-7). Prioritas kesederhanaan install. Perangkat handheld gudang umumnya Android.

### Decision
Handheld disajikan sebagai **PWA** dari aplikasi Next.js yang sama: responsif untuk layar kecil, installable (manifest + service worker untuk shell/asset — **bukan** untuk antre transaksi offline), scanning via **Web `BarcodeDetector` API** (dukungan baik di Android Chrome) dengan fallback pustaka (ZXing/Quagga) bila API tak tersedia; kamera via `getUserMedia`.

### Options Considered
| Opsi | Akses scanner | Install/build | Offline |
|---|---|---|---|
| **PWA (dipilih)** | Kamera Web API; laser-gun HID sebagai keyboard-wedge | Tanpa app store; satu build | Shell saja (online-only, sesuai OQ-7) |
| Capacitor (bungkus PWA) | Plugin scanner native lebih dalam | +build ringan | Bisa nanti |
| Native (RN/Flutter) | Terbaik | Codebase & build terpisah | Terbaik |

### Trade-off Analysis
PWA paling selaras dengan online-only + install sederhana + satu codebase. Laser-gun umumnya berperilaku *keyboard-wedge* (mengetik kode + Enter) → jalan mulus di PWA tanpa integrasi khusus. Bila nanti butuh kontrol scanner hardware yang dalam, **Capacitor** membungkus PWA yang sama (jalur upgrade murah) sebelum mempertimbangkan native.

### Consequences
- (+) Deploy handheld = buka URL; update instan; nol app store.
- (−) `BarcodeDetector` belum universal → sediakan fallback ZXing.
- (−) Fitur scanner/offline mendalam terbatas → mitigasi: Capacitor (fase 2, jalur sudah disiapkan).

### Action Items
1. [ ] Rancang UI handheld mobile-first yang dipandu `next_expected` (Behavioral A-4c).
2. [ ] Abstraksi input scan (kamera API + keyboard-wedge) di satu komponen.
3. [ ] Manifest + service worker (cache shell/asset saja; jangan cache mutasi stok).

---

## ADR-005: Struktur repo — Monorepo (pnpm + Turborepo)

**Status:** Accepted · **Date:** 2026-09-23

### Context
ADR-001/002 menuntut batas modul tegas (domain murni, worker terpisah, share type) dan jalur ekstraksi ke service. Butuh satu repo yang bisa membangun banyak artefak dengan cache build.

### Decision
**Monorepo** memakai **pnpm workspaces + Turborepo**. Struktur:

```
apps/
  web/         Next.js (route handler = controller/adapter, React UI, PWA)   ← delivery
  worker/      proses Node: outbox integration_event + cron (rekonsiliasi, bersih lockout)
packages/
  domain/          entities, value objects, domain service, PORT interfaces  (tanpa dep)
  application/     use-cases (ReserveStock, ConfirmDelivery, …) → dep: domain
  infrastructure/  adapter: repository Drizzle, ErpGateway, LabelRenderer, auth, doc_counter
  db/              skema Drizzle + migrasi (drizzle-kit) + schema_migration runner
  contracts/       DTO & skema zod (dipakai bersama web ↔ application)
  config/          util konfigurasi app_setting + env
```
Aturan dependensi (ADR-002) ditegakkan lewat lint boundary. `web` & `worker` = composition root yang mewiring `application` + `infrastructure`.

### Options Considered
| Opsi | Pros | Cons |
|---|---|---|
| **Monorepo (dipilih)** | Batas modul tegas; share type; build cache; ekstraksi paling mulus | Setup workspaces & tooling awal |
| Single app, folder berlapis | Paling sederhana sekarang | Batas modul mudah bocor; ekstraksi perlu refactor |

### Trade-off Analysis
Ongkos setup monorepo terbayar oleh tujuan owner: `domain`+`application` sebagai paket berarti "pisah jadi service" = pindahkan paket + composition root baru (NestJS/Fastify), tanpa membedah kode. Batas paket juga memaksa aturan dependensi Clean Architecture secara fisik.

### Consequences
- (+) Ekstraksi service: buat `apps/<svc>` yang mem-wire paket domain/application yang sama; `web` memanggilnya via adapter HTTP yang mengimplementasi port yang sama.
- (+) Turborepo cache mempercepat CI.
- (−) Kompleksitas tooling (versi pnpm, konfigurasi Turborepo, TS project references).

### Action Items
1. [ ] Inisiasi pnpm workspaces + Turborepo + TS project references.
2. [ ] Buat paket sesuai struktur; pasang dependency-cruiser/eslint-boundaries.
3. [ ] Pipeline: `build`, `test`, `lint`, `db:generate`, `db:migrate` sebagai task Turborepo.

---

## ADR-006: Runtime & library pendukung (default)

**Status:** Accepted (default, dapat dikoreksi) · **Date:** 2026-09-23

### Context
Detail library yang tidak diperdebatkan panjang tapi perlu dikunci agar tim tak bikin keputusan ad-hoc. Ini **default beropini**; ubah bila tim punya preferensi kuat.

### Decision (default terkunci)
| Area | Pilihan | Alasan singkat |
|---|---|---|
| Runtime | **Node.js LTS** (mis. 22.x) | Stabil, dukungan luas; hindari Bun/Deno untuk ekosistem produksi WMS |
| Bahasa | **TypeScript** (strict) | Type-safe end-to-end FE↔BE |
| Validasi | **zod** | Skema DTO di `contracts/`; validasi request & payload ERP |
| Auth JWT | **jose** (sign/verify) + **argon2** (hash password) | Standar, aman; argon2id > bcrypt (kompatibel dgn seed bcrypt saat migrasi) |
| Otorisasi | Guard RBAC kustom (cek `role_menu_access`) | Deny-by-default per request (FR-ADM-4) |
| Migrasi | **drizzle-kit** (forward-only) | Sejalan ADR-003 & OQ-9 |
| Worker/queue | Proses Node + polling `integration_event`; **cron** via `node-cron` (atau `@breejs`) | Sederhana; naik ke Redis/BullMQ bila volume besar (revisit) |
| Logging | **pino** (structured JSON) | Observability (NFR-MNT-4) |
| Testing | **Vitest** (unit) + **Testcontainers/pg** atau Postgres ephemeral (integrasi & uji konkurensi CC-1..CC-11) | Uji locking butuh Postgres nyata |
| Label | Render **ZPL** dari template (string) + kirim TCP 9100 / print service | `labeling-wms-baseline.md` |
| Reverse proxy | Nginx atau Caddy | TLS + serve `next start` |
| Reporting/export | Server-side CSV/XLSX (mis. `exceljs`); job berat → worker | NFR-PERF-5 async |

### Consequences
- (+) Keputusan mikro sudah baku → tim langsung membangun.
- (−) Beberapa pilihan (queue sederhana, argon2) perlu revisit saat skala/beban naik.
- Revisit: queue polling → BullMQ+Redis bila `integration_event` bervolume tinggi; tambah metrics (Prometheus) bila diperlukan.

### Action Items
1. [ ] Kunci versi Node LTS di `.nvmrc`/engines.
2. [ ] Setup zod schemas di `contracts/`, pino logger, vitest + Testcontainers.
3. [ ] Buat harness uji konkurensi (CC-1..CC-11) sebagai bagian CI.

---

## Ringkasan Stack (terkunci)

```
Frontend + Backend : Next.js (App Router) fullstack, self-hosted (next start), TypeScript
Arsitektur backend : Clean/Hexagonal — domain & application murni; Next.js = adapter
Database           : PostgreSQL 14+  ·  Data access: Drizzle ORM + drizzle-kit (migrasi forward-only)
Handheld           : PWA (BarcodeDetector + fallback ZXing; laser-gun keyboard-wedge)
Repo               : Monorepo pnpm + Turborepo (apps/web, apps/worker; packages/domain, application, infrastructure, db, contracts, config)
Pendukung          : Node LTS, zod, jose+argon2, pino, Vitest+Testcontainers, node-cron, ZPL
Target ekstraksi   : modul → service NestJS/Fastify memakai domain+application yang sama
```

### Yang akan direvisit seiring pertumbuhan
- Worker polling → BullMQ+Redis bila volume outbox/cron tinggi.
- Monolith → ekstraksi modul (mis. Inventory/Integration) jadi service saat butuh scaling/deploy independen.
- Tambah read-replica + koneksi baca bila query laporan membebani.
- Capacitor untuk handheld bila butuh scanner hardware mendalam / offline (fase 2).
- Observability lanjutan (metrics/tracing) saat SLA mengetat.
