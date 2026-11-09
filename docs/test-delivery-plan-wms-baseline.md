# Test & Delivery Plan — WMS Baseline

**Strategi pengujian & rencana pengiriman · pelengkap seluruh dokumen desain (lihat CLAUDE.md untuk peta topik)**

Versi: 1.2 · 13 Oktober 2026 · Pembaruan 1.2 (M5, `m5-integration-hardening-wms-baseline.md`): gateway ERP & rekonsiliasi teruji, uji beban terukur (§8), e2e Playwright (`apps/e2e`), smoke M5, `db:integrity`, backup/restore drill, artefak Docker, CI penuh. Sebelumnya 1.1 · 24 September 2026: CC-7..CC-11, matriks RBAC per operation type, uji idempotensi/ledger status, gate kontras & sinkron menu, penamaan migrasi drizzle.

> Dua bagian: **A. Test Strategy** (bagaimana kita membuktikan sistem benar) dan **B. Delivery Plan** (bagaimana kita mengirim & meng-upgrade tiap instalasi klien). Semua kriteria uji berasal dari ID yang sudah ada: `AC-*`, `CC-*`, `BR-*`, `MS-*`, `NFR-*`, `SM#1/SM#2`.

---

## Daftar Isi

**A. Test Strategy** — [1](#1-filosofi--piramida-uji) · [2](#2-lapisan-uji-vs-arsitektur) · [3](#3-uji-konkurensi-kritis) · [4](#4-matriks-uji-rbac) · [5](#5-cakupan-domain--business-rule) · [6](#6-contract--integrasi-erp) · [7](#7-uji-frontend--handheld) · [8](#8-uji-non-fungsional) · [9](#9-data-uji--fixtures) · [10](#10-target-coverage--gate-ci) · [11](#11-uat)
**B. Delivery Plan** — [12](#12-cakupan-mvp--milestone) · [13](#13-definition-of-done) · [14](#14-environment) · [15](#15-cicd-pipeline) · [16](#16-versioning--rilis) · [17](#17-runbook-deploy-per-instalasi) · [18](#18-rollback--recovery) · [19](#19-observability--verifikasi-pasca-deploy) · [20](#20-onboarding-klien-baru)

---

# A. Test Strategy

## 1. Filosofi & Piramida Uji

Prinsip: **uji terberat di lapisan termurah, uji integrasi di titik paling berisiko** (stok & konkurensi). Karena integritas stok adalah metrik sukses utama (MS-1/MS-2), uji konkurensi & domain diprioritaskan di atas uji UI.

```
        e2e (Playwright)              ← sedikit: alur kritis end-to-end
     API / route handler tests        ← kontrak HTTP + RBAC per endpoint
  integration (Postgres nyata)        ← BANYAK di sini: locking, reservasi, confirm atomik
unit domain + use-case (port palsu)   ← TERBANYAK: aturan bisnis, state machine, konversi UOM
```
- **Domain & use-case** (packages/domain, application): unit test murni dengan port palsu — cepat, tanpa DB.
- **Infrastructure** (repository Drizzle, locking): integrasi dengan **Postgres nyata** (Testcontainers) — di sinilah oversell/deadlock ditangkap.
- **FE**: komponen (Vitest + Testing Library) + a11y (axe) + e2e alur.

## 2. Lapisan Uji vs Arsitektur

| Lapisan (ADR-002/005) | Jenis uji | Alat | Contoh |
|---|---|---|---|
| `packages/domain` | Unit murni | Vitest | entity invariants, value object, state machine SM#1/SM#2 |
| `packages/application` (use-case) | Unit (port palsu) | Vitest + fake repo | ReserveStock, ConfirmDelivery, CartonBreak orkestrasi |
| `packages/infrastructure` (Drizzle) | Integrasi | Vitest + **Testcontainers Postgres** | repo FOR UPDATE, ON CONFLICT, uq_quant_combo, trigger immutability |
| `apps/web/app/api` (route handler) | API/kontrak | Vitest + supertest-like / MSW | status code, RBAC per endpoint, envelope error §1.2 |
| `apps/worker` | Integrasi | Vitest + Postgres | outbox retry, cron lockout cleanup |
| `apps/web` (UI) | Komponen + a11y | Vitest + Testing Library + vitest-axe | dynamic menu, guard, scan field |
| Lintas | e2e | Playwright | receipt→putaway, pick→delivery |

## 3. Uji Konkurensi (kritis)

Realisasi CC-1..CC-12 (Behavioral §7) sebagai **integration test dengan transaksi paralel nyata** (Testcontainers). Ini pembuktian MS-2 ("0 oversell/double-post").

| ID | Skenario | Cara uji | Assert |
|---|---|---|---|
| CC-1 | 2 reserve rebutan stok 100 (butuh 70+70) | 2 promise `start` paralel | Σ RESERVED ≤ 100; 1 gagal `INSUFFICIENT_STOCK`; quant ≥ 0 |
| CC-2 | double-confirm | 2 `confirm` paralel op sama | 1 DONE, 1 `INVALID_TRANSITION`; `stock_move` 1× |
| CC-3 | 2 transfer beda dest dari 1 quant | 2 `confirm` paralel | total pindah ≤ tersedia; sisa `INSUFFICIENT_STOCK` |
| CC-4 | cancel lalu start baru | cancel A ‖ start B | stok kembali persis; tak double-count |
| CC-5 | optimistic lock | 2 `ready` dengan `If-Match` versi sama | 1 sukses, 1 `VERSION_CONFLICT` |
| CC-6 | deadlock probe | 2 op reserve produk {X,Y} urutan line beda | tak ada deadlock (A-5 advisory lock urut product_id) |
| CC-7 | over-receipt balapan | 2 receipt (60+60) PO line 100 `confirm` paralel | 1 sukses, 1 `OVER_RECEIPT`; `qty_received`=60 |
| CC-8 | over-allocation SO | 2 pick list (100+100) SO line 100 `start` paralel | 1 sukses, 1 `SO_OVER_ALLOCATION`; `qty_reserved`=100 |
| CC-9 | scan idempoten | scan sama 2× paralel, `Idempotency-Key` sama | 1 line; respons kedua identik / `IN_PROGRESS` |
| CC-10 | line SKU ganda | 1 op, 2 line SKU & bin sama → start → confirm | 2 reservasi; confirm sukses tanpa FK error |
| CC-11 | refresh paralel | 2 `refresh` token sama dalam grace window | keduanya sesi valid; family tidak dicabut |
| CC-12 | swap ‖ start (M3) | A scan LPN pengganti ‖ B `start` yang akan mereservasi pallet itu | tepat satu memegang tiap pallet; Σ RESERVED ≤ on-hand; D-2b utuh |

Teknik: buka N koneksi, jalankan transaksi bersamaan dengan barrier (mis. `Promise.all` + delay terkontrol atau `pg_advisory_lock` sebagai sinkronisasi), verifikasi invarian D-2 (`Σ quant = Σ move.to − Σ move.from` untuk lokasi non-endpoint) setelah selesai.

## 4. Matriks Uji RBAC

Buktikan FR-ADM-3/4 & BR-5 (deny-by-default, backend re-validasi).

- **Per role × modul × aksi:** untuk tiap role seed (Super Admin, Supervisor, Operator, Inventory Controller, Auditor, ERP_INTEGRATION) uji tiap endpoint → harapkan 200 (diizinkan) atau 403 (ditolak) sesuai matriks seed (`seed §8`, termasuk override per-submenu).
- **Per operation type × aksi generik:** untuk tiap optype seed × (`start`, `scan`, `confirm`, `approve`, `cancel`) uji bahwa menu yang dicek = `menu_code`/`confirm_menu_code`/`approve_menu_code` (API §1.4) — mis. hak `inbound_putaway` saja tidak bisa confirm OUT_DELIVERY.
- **Segregation of duties:** pembuat OUT_SCRAP tak bisa approve (`403 SELF_APPROVAL`); Operator tak punya menu Scrap Approval.
- **Deny-by-default:** role tanpa baris `role_menu_access` untuk suatu menu → 403.
- **Backend otoritatif:** panggil endpoint mutasi **langsung** (lewati UI) dengan token yang tak berhak → tetap 403 (bukan hanya tombol disembunyikan).
- **Feature-flag hiding:** flag mati → menu tak ada di `menuAccess` login; endpoint terkait → 403/404.
- **ERP_INTEGRATION:** hanya `inbound_orders`/`outbound_orders` (view/create/edit); receipts, picking, scrap, dan semua endpoint UI → 403.

Bentuk: tabel parametrik `(role, method, path) → expectedStatus` dijalankan sebagai satu suite.

## 5. Cakupan Domain & Business Rule

Tiap BR & transisi state machine punya test eksplisit:

| Area | Uji |
|---|---|
| SM#1 (operasi) | tiap transisi sah lolos; transisi ilegal → error; terminal (DONE/CANCELLED) tak bisa transisi |
| SM#2 (quant) | Available↔Reserved, →Quarantine/Damaged, konsumsi saat Done |
| BR-1 UOM base | qty tersimpan base; scan carton→base benar (A-6a) |
| BR-2/BR-3 | stok berubah hanya saat Done; reserve saat start |
| BR-4 immutability | UPDATE/DELETE `stock_move`/`audit_log` → exception (trigger) |
| BR-6 carton break | tolak non-ITEM/HU bukan CARTON; N item lahir; VIRTUAL_TRANSFORM balance |
| BR-8 FEFO/expiry | warn vs block; expired ditolak; shelf-life partner |
| BR-9 over-receipt | qty > PO×(1+toleransi) ditolak |
| BR-10 | `stock_move` from≠to OR from_status≠to_status; QA in-place tercatat |
| BR-18..24 | semua perubahan stok ber-operation (operation_id NOT NULL); approver ≠ pembuat; alokasi SO/PO di bawah lock; edit line hanya DRAFT; soft-delete (DELETE user → ditolak); idempotensi; timezone warehouse (expiry di batas tengah malam WIB/WITA/WIT) |
| Ledger status | invarian D-2 per status (Σ quant per status = ledger `to_status` − `from_status`) |
| BR-11 | quant qty=0 dihapus |
| Reservasi | A-2 split per line, A-3 release presisi (termasuk setelah quant RESERVED terhapus), A-4 consume; partial release saat line close; swap batch |
| UOM roll-up | A-6c contoh berhitung (250→{Carton:2,Pcs:50}) |
| AC-01..05 | tiap acceptance criteria use case = satu test |

## 6. Contract & Integrasi ERP

- **Skema zod bersama** (`packages/contracts`): uji bahwa schema memvalidasi payload valid & menolak invalid; FE & BE pakai schema sama (satu sumber → cegah drift).
- **Ingest idempoten:** kirim PO/SO dengan `erp_ref` sama 2× → tidak duplikat (200, resource sama); isi beda + ref sama → 409.
- **Outbox:** confirm menulis `integration_event(PENDING)` dalam transaksi; worker mengirim → SENT; simulasi kegagalan → retry/backoff → DEAD setelah N; uji tak ada callback ganda saat retry (idempoten di sisi ERP via event id).
- **Mapping:** `partner_ref`/`sku` tak dikenal → 422 (UNKNOWN_*).
- **Realisasi (M5):** `packages/infrastructure/test/integration.int.test.ts` — ERP = server HTTP lokal: tanda tangan HMAC, retry/backoff → DEAD, urutan per order, ERP tak melayani, 3 dispatcher paralel tepat-satu-kali, retry massal, rekonsiliasi.

## 7. Uji Frontend & Handheld

| Area | Uji |
|---|---|
| Theming | build per `BRAND_ID` menerapkan token & aset `brands/<id>` (visual Playwright) |
| Gate kontras | `test:contrast` per brand × mode (light/dark/hc): pasangan wajib ≥ 4.5:1 / 3:1; hc ≥ 7:1 |
| Sinkron menu | kunci `NAV` FE == `menu.code` seed; `HH_ROUTE_MENU` hanya menunjuk kode yang ada |
| Design system | tiap komponen blocks (frontend §4.4) punya test state wajib + axe; lint `no-literal-colors` & `require-page-guard` |
| Menu dinamis | `buildAuthorizedNavigation(map)` dari `menuAccess` berbeda → sidebar berbeda; grup kosong hilang; deny-by-default |
| Auth guard | tanpa sesi → redirect /login; tanpa akses rute → forbidden **juga saat soft navigation** (guard per page); aksi non-view butuh permission |
| Session | refresh rotasi di middleware; reuse dalam grace window → sesi tetap; di luar grace → cabut family; single-flight; logout mencabut |
| Scan (handheld) | `useScanner` wedge (prefix/suffix & heuristik jeda, fokus di field qty) & kamera (mock); antrean serial; retry mempertahankan `Idempotency-Key` |
| Flow engine | `next_expected.step` (enum lengkap) memandu langkah; error menahan langkah; `FEFO_ACK_REQUIRED` → ReasonPicker |
| Online-only | fetch `/api` gagal → banner + aksi terkunci |
| A11y | axe: kontras, target sentuh, fokus, label |

## 8. Uji Non-Fungsional

| NFR | Uji |
|---|---|
| NFR-PERF-1 (scan p95 ≤300ms) | `scripts/load/seed-scale.sh` (20.000 SKU, 3.000 bin, 100.000 quant, 1 juta baris ledger) + `scripts/load/run.mjs` (18 operator virtual + 2 pembaca, 10 scan/dtk lalu fase puncak); hasil 13-10-2026 di m5 §8.1: p95 55 ms |
| NFR-PERF-2/3/6 | runner yang sama: confirm p95 47 ms, list p95 258 ms, puncak 196 scan/dtk; `--enforce` menjadikannya gate |
| NFR-PERF-4 (pick list ≤2s) | kelas `picklist` pada runner beban (p95 24 ms) |
| NFR-CAP-* | uji dengan volume data mendekati target (SKU/lokasi/quant) |
| NFR-MNT-2 (migrasi) | jalankan seluruh migrasi dari nol + dari versi sebelumnya di CI; `schema_migration` benar |
| NFR-BKP (backup/restore) | `scripts/backup.sh` (arsip terverifikasi + manifest) → `scripts/restore-drill.sh` (pulih ke DB sementara: checksum, versi schema, jumlah baris, `db:integrity`); drill bulanan (runbook operasi §4) |
| NFR-SEC | `pnpm audit --prod --audit-level high` (gate CI), header keamanan (+HSTS, COOP), uji authz negatif (§4) |

## 9. Data Uji & Fixtures

- **Seed** (`seed-wms-baseline.sql`) sebagai baseline instalasi & dasar test integrasi.
- **Paritas skema** (migration §2.1): katalog hasil semua migrasi ⇔ `docs/schema` kumulatif, checksum migrasi yang sudah dirilis, uji jalur upgrade (aktif sejak ada ≥2 migrasi).
- **Validasi DDL** (`ddl-validation-wms-baseline.sql`): 45 skenario (aman di DB berisi data) constraint/trigger/invarian (termasuk query rekonsiliasi D-2/D-2b) — dijalankan di CI terhadap DB hasil migrasi (PG 14 & versi terbaru); query D-2 dipakai ulang job integritas nightly (§19).
- **Factory/builder** untuk entitas (product, quant, operation) agar test ringkas & deterministik.
- **Testcontainers Postgres** per suite integrasi (skema Drizzle di-migrate segar); rollback/truncate antar-test.
- **MSW** untuk mock HTTP di uji FE.
- Data mendekati profil industri (farmasi: batch/expiry/serial; retail: minimal) untuk uji konfigurasi (MS-3).

## 10. Target Coverage & Gate CI

| Lapisan | Target coverage | Gate |
|---|---|---|
| `domain` + `application` | tinggi (mis. ≥ 90%) | wajib lulus |
| `infrastructure` (path kritis stok) | jalur locking/reservasi/confirm 100% ada test | wajib |
| API route (RBAC/kontrak) | tiap endpoint punya uji izin + happy/`error` | wajib |
| FE komponen kritis | menu/guard/scan tercakup | wajib |
| e2e | alur receipt→putaway, pick→delivery hijau | wajib sebelum rilis |

Gate `quality` (seperti referensi): `format:check → lint → type-check → test:coverage → build → audit`. **Uji konkurensi (CC-1..13), matriks RBAC (role & optype), gate kontras & sinkron menu wajib hijau** sebelum tag rilis.

## 11. UAT

- Skrip UAT diturunkan dari **acceptance criteria** (Requirements §6 AC-*) + alur handheld (§7 handheld doc).
- **UAT integritas stok (MS-1):** skenario terkontrol (terima N, transfer, pick, kirim) → stok fisik vs sistem **nol selisih**.
- **UAT konfigurasi (MS-3):** pasang profil farmasi lalu retail dari basis kode sama → verifikasi menu/flag berubah tanpa ubah kode.
- Tanda tangan UAT per modul sebelum go-live klien.
- Skrip lengkap (skenario per modul, MS-1, MS-3, lembar tanda tangan): `docs/uat-wms-baseline.md`.

---

# B. Delivery Plan

## 12. Cakupan MVP & Milestone

Ruang lingkup = seluruh modul fase 1 (Requirements §4.1); fase 2 = `SC-1..SC-10`. Pengiriman dilakukan **inkremental & selalu dapat di-deploy**, dimulai dari *walking skeleton* yang membuktikan seluruh tumpukan.

| Milestone | Isi | Tujuan pembuktian |
|---|---|---|
| **M0 — Walking skeleton** | Monorepo + Next.js + Drizzle + migrasi/seed + auth/session/RBAC + 1 master (Products) + CI + deploy staging + harness uji konkurensi | Seluruh stack & pipeline jalan end-to-end |
| **M1 — Inbound** | PO ingest, Receipt, Putaway, generate/print LPN, Stock on Hand + handheld receipt/putaway | Barang bisa masuk & terlihat |
| **M2 — Internal** | Bin-to-bin, Inter-site (IN_TRANSIT), Carton Break, Quarantine | Pergerakan internal & transformasi |
| **M3 — Outbound (inti kritis)** | SO ingest, generate pick list, Picking (reserve/FEFO), Delivery, Scrap/Issue + handheld picking | Reservasi & konkurensi (CC-1..13) terbukti |
| **M4 — Visibility & admin** | Reports (+export async), Traceability, Adjustment (+transit loss), Handling Units, Audit Log, Users/Roles/Access UI, API key & outbox, Config, master sisa (UOM, Sites, Batches, Reason Codes), Dashboard, Branding (hardcoded) | Kelola & telusur; tak ada lagi halaman placeholder |
| **M5 — Integrasi & hardening** | ERP outbox callback, rekonsiliasi, cek integritas, uji beban, e2e browser, artefak rilis, backup/restore, profil industri; skrip UAT & runbook operasi (pelaksanaan UAT & onboarding klien pertama = bersama klien) | Siap produksi |

Tiap milestone: lolos gate CI + uji lapisannya + deploy staging.

## 13. Definition of Done (per fitur)

Sebuah fitur "selesai" bila: kode + test (unit/integration/RBAC) hijau · validasi zod (FE+BE satu schema) · RBAC ditegakkan server · error dipetakan (§1.2) · i18n `id` lengkap · a11y dasar · dokumentasi/route terdaftar di katalog menu · di-review (boundary lint lolos) · demo di staging.

## 14. Environment

| Env | Untuk | Data |
|---|---|---|
| **dev** | lokal per developer | seed + factory |
| **staging** | UAT & demo | data uji mirip produksi |
| **prod (per klien)** | satu instalasi/klien (single-tenant) | data klien; brand hardcoded pada build klien |

Rahasia (JWT key, DB cred, callback ERP) via env/secret per environment (auth-session §1), bukan repo.

## 15. CI/CD Pipeline

Monorepo Turborepo — task ber-cache:
```
CI (tiap PR):  install → format → lint → type-check → test (unit, kontrak, kontras, sinkron menu, paritas) → audit
               → integration (Testcontainers: CC-1..13, matriks RBAC, suite M1–M5) → ddl validation (PG14 & latest)
               → build → smoke M0–M5 (web + worker + ERP tiruan) → db:integrity → e2e (Playwright)
CD (tag rilis): build artefak (next standalone + worker) → publish image (Dockerfile)
               → deploy staging → e2e → (approval) → paket rilis per klien
```
- Konkurensi & RBAC matrix = gate wajib.
- Build menghasilkan **artefak per klien** (`BRAND_ID=<klien>` memilih `brands/<klien>` — Frontend §3.2).

## 16. Versioning & Rilis

- **SemVer aplikasi** (`app`), dan **versi schema** (`schema_migration`, `{nnnn}` = prefix file migrasi drizzle).
- Aplikasi menyatakan rentang schema didukung; start-up **fail-fast** bila di luar rentang (migration §4).
- Changelog + catatan migrasi per rilis. Migrasi **forward-only**.

## 17. Runbook Deploy per Instalasi

Merealisasikan migration §3 (single-tenant, downtime singkat dapat diterima):
```
1. Umumkan maintenance window ke klien.
2. Backup DB; VERIFIKASI backup sukses (NFR-BKP).
3. Tarik artefak rilis (image/bundle) versi target.
4. Jalankan migrasi (drizzle-kit) — semua versi > terpasang; tercatat di schema_migration.
5. Deploy app (next start) + worker; reverse proxy reload.
6. Health check: GET /api/health (proses) & /api/ready (DB+migrasi OK).
7. Smoke test: login → 1 receipt → putaway → 1 pick → delivery (manual di produksi; skrip `scripts/smoke-m0.sh` … `smoke-m5.sh` hanya untuk DB segar di CI/staging — `smoke-m4.sh`/`smoke-m5.sh` butuh worker, `smoke-m5.sh` juga `ERP_CALLBACK_URL` ke ERP tiruan).
8. Verifikasi integritas: `pnpm db:integrity` (invarian D-2/D-2b, quant ≤ 0) harus `OK`.
9. Buka kembali akses; pantau log/error 30–60 mnt.
```

## 18. Rollback & Recovery

- **Pemicu rollback:** health/ready gagal, smoke test gagal, lonjakan error rate, atau uji integritas D-2 timpang.
- **Cara:** forward-only → **restore backup** (RTO sesuai NFR-BKP) + deploy versi app sebelumnya; perbaiki, rilis maju. Tidak ada down-migration otomatis.
- Perubahan destruktif memakai **expand → migrate → contract** lintas rilis agar rollback aman.
- Feature flag memisahkan "schema siap" dari "fitur menyala".

## 19. Observability & Verifikasi Pasca-deploy

- **Log terstruktur** (pino) — sertakan user_id, operation ref pada aksi stok.
- **Endpoint** `/api/health` (liveness) & `/api/ready` (DB reachable + schema version cocok).
- **Metrik/alert** (NFR-MNT-4, SHOULD): error rate, latensi scan p95, panjang antrian `integration_event` (DEAD > 0 → alert), kegagalan login.
- **Job integritas berkala:** worker tiap hari 02:30 — `checkIntegrity` (D-2/D-2b) + ringkasan rekonsiliasi → log ber-`alert` (`INTEGRITY_D2`, `OUTBOX_DEAD`, `RECONCILIATION`); tabel alert & tindakan di runbook operasi §6–§7.

## 20. Onboarding Klien Baru

Checklist (memakai Playbook configuration §2.3):
```
[ ] Siapkan build klien: `brands/<klien>/` (tokens.css, brand.ts, logo, ikon, override i18n) + gate kontras lolos — Frontend §3.2
[ ] Deploy schema + seed (profil default)
[ ] Sesuaikan app_setting sesuai industri (matriks configuration §2.1)
[ ] Isi master data: UOM/packaging, sites/warehouse (+timezone), locations (+cetak label bin), partners, reason codes, (batches)
[ ] Konfigurasi scanner handheld (prefix/suffix wedge) & print service label
[ ] Sesuaikan operation types & matriks RBAC (atau pakai 5 role template)
[ ] Buat service account + api_key ERP; set URL callback
[ ] Ganti password admin; buat user riil
[ ] Smoke test end-to-end + UAT integritas stok (MS-1) & konfigurasi (MS-3) — `docs/uat-wms-baseline.md`
[ ] Rilis pertama: bekukan baseline schema (checksum 0001 — migration §2.1)
[ ] Go-live + pantau
```

---

## Ringkasan Keputusan (test & delivery)

1. Prioritas uji: **domain/use-case (terbanyak) + integrasi konkurensi (Testcontainers)**; UI/e2e secukupnya untuk alur kritis.
2. **CC-1..13, matriks RBAC (role & optype), gate kontras & sinkron menu = gate CI wajib** — pembuktian MS-2, FR-ADM-4, NFR-USE-5.
3. Coverage tinggi di `domain`/`application`; path stok kritis 100% ber-test; gate `quality`.
4. Pengiriman **inkremental via milestone M0..M5**, mulai walking skeleton; M3 (outbound) titik pembuktian konkurensi.
5. **Forward-only migrasi**, fail-fast versi, deploy per instalasi dengan backup→migrate→smoke→verifikasi D-2; rollback = restore backup.
6. Observability: health/ready, log pino, alert outbox DEAD & integritas D-2 (job harian worker + `db:integrity`).
7. Onboarding klien = build brand + seed + konfigurasi industri + UAT (MS-1/MS-3).
