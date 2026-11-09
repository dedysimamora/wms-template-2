# M5 Integrasi & Hardening — Desain Implementasi · WMS Baseline

**Bagaimana milestone M5 (gateway callback ERP, rekonsiliasi, cek integritas, uji beban, e2e browser, artefak rilis, backup/restore, profil industri, UAT & onboarding) direalisasikan · pelengkap test-delivery §12**

Versi: 1.0 · 13 Oktober 2026

> Dokumen ini **tidak** mengulang aturan bisnis. Sumbernya tetap erp-integration §3/§6/§7, test-delivery §6–§11/§15–§20, requirements §8 (NFR-PERF/CAP/BKP/SEC/MNT, MS-1..4), configuration §2. Isinya: celah yang ditutup (**G35–G47**), peta komponen, alur data, keputusan baru (behavioral **D-39..D-41**, implementasi **I-58..I-69**) beserta trade-off, bukti, dan sisa pekerjaan yang butuh manusia/infrastruktur.
>
> **Status: bagian yang bisa dikerjakan di repo selesai (13-10-2026).** D-39..D-41 mengisi celah (tidak mengubah perilaku tertulis): erp-integration sudah menetapkan outbox, retry → DEAD, `X-Event-Id`, dan urutan per order — M5 menetapkan bentuk kawatnya. **Belum dilakukan** karena butuh orang/infrastruktur: pelaksanaan UAT bersama pengguna, deploy staging, onboarding klien nyata, dan pembekuan baseline (`checksums.json`) — semuanya punya skrip/runbook siap pakai (§9).

---

## 1. Kebutuhan & Cakupan

### 1.1 Fungsional & pembuktian — status

| Item | Sumber | Inti | Status |
|---|---|---|---|
| Gateway callback ERP | erp-integration §3/§6, test-delivery §6 | Worker mengirim `integration_event` ke URL ERP: tanda tangan, retry/backoff → DEAD, urutan per order, aman multi-worker | ✅ |
| Retry massal | erp-integration §7 (DEAD = intervensi manual) | Semua DEAD/FAILED → PENDING dalam satu aksi | ✅ |
| Rekonsiliasi | erp-integration §7 | Order terbuka lewat jatuh tempo + callback yang belum sampai; ringkasan harian | ✅ |
| Cek integritas D-2 | test-delivery §17 langkah 8, §19 | CLI `db:integrity` + job harian worker ber-alert | ✅ |
| Uji beban | test-delivery §8, NFR-PERF-1..4/6, NFR-CAP | Dataset skala NFR-CAP + operator virtual; p95 vs NFR | ✅ (mesin dev — ulangi di perangkat keras target) |
| e2e browser | test-delivery §7/§10 | Auth/guard, receipt → putaway, pick → delivery, Integration lewat UI nyata | ✅ |
| Artefak rilis | test-delivery §15 | `Dockerfile` (web per brand + worker/CLI), compose produksi, workflow rilis | ✅ (image dibangun lokal; publikasi saat tag) |
| Backup & uji restore | NFR-BKP-2/4, test-delivery §17–§18 | `backup.sh` terverifikasi + ber-manifest; `restore-drill.sh` membuktikan isi | ✅ |
| Profil industri | configuration §2.1, MS-3 | `apply-profile.sh` lewat API (validasi + audit tetap berlaku) | ✅ |
| Skrip UAT | test-delivery §11 | `docs/uat-wms-baseline.md` dari AC-* + alur handheld + MS-1/MS-3 | ✅ dokumen · ⏳ pelaksanaan |
| Runbook operasi & onboarding | test-delivery §17–§20 | `docs/operations-runbook-wms-baseline.md` | ✅ dokumen · ⏳ klien pertama |

### 1.2 Non-fungsional yang mengikat

| NFR | Konsekuensi desain M5 |
|---|---|
| Behavioral P-2 (I/O berat di luar ⟦TX⟧ stok) | Callback tak pernah dikirim di transaksi confirm; hanya baris outbox yang ditulis di sana. Kirim = proses worker terpisah |
| At-least-once (erp-integration §3) | Tak ada jalur yang menandai SENT tanpa jawaban 2xx; proses mati di tengah kirim → event dikirim ulang dengan `X-Event-Id` yang sama |
| NFR-SEC | Rahasia callback di env (bukan `app_setting`, bukan respons API); payload ditandatangani HMAC; redirect tak diikuti; gate `pnpm audit` |
| MS-1 / D-2 | Uji beban & smoke ditutup `db:integrity`; job harian mengulanginya di produksi |
| NFR-MNT-4 | Alert = baris log ber-kunci `alert` (`OUTBOX_DEAD`, `INTEGRITY_D2`, `RECONCILIATION`) — bisa ditangkap alat log apa pun |

### 1.3 Batasan

Tech stack terkunci (ADR). **Tanpa perubahan schema & seed** — tetap v1.6 (I-69). Dependensi baru hanya `@playwright/test` (devDependency `apps/e2e`, alat e2e yang sudah disebut test-delivery §1). Uji beban tanpa alat baru (skrip Node). Di luar M5: metrik/tracing Prometheus (NFR-MNT-4 "revisit"), penyimpanan objek untuk export, WAL/PITR (NFR-BKP-1 — keputusan bisnis terbuka), enkripsi at-rest (NFR-SEC-8), offline queue handheld (SC), fallback kamera ZXing.

## 2. Celah Desain yang Ditemukan

| # | Celah | Dampak bila dibiarkan | Keputusan |
|---|---|---|---|
| G35 | Kontrak kawat callback tak ditetapkan: skema auth, bentuk body, status mana yang "terkirim", timeout, redirect | Tiap instalasi berimprovisasi; ERP tak bisa memverifikasi asal pesan | **D-39** |
| G36 | "Urutan per order = `created_at`", padahal `created_at DEFAULT now()` = awal transaksi → `RECEIPT_CONFIRMED` dan `ORDER_STATUS_CHANGED` se-⟦TX⟧ bernilai kembar | Status order bisa tiba sebelum pengirimannya | **I-58** |
| G37 | Perilaku saat ERP mati tak dirinci: tiap event jatuh tempo memakan satu percobaan per putaran | Gangguan beberapa jam → ratusan event DEAD sekaligus; putaran worker tersandera timeout berantai | **D-40** |
| G38 | Retry hanya per event | Setelah gangguan, admin mengeklik ratusan kali; urutan per order rusak bila tak berurutan | **I-60** |
| G39 | Instalasi tanpa ERP / sebelum URL diisi: event PENDING menumpuk tanpa penjelasan di UI | Admin mengira worker rusak | **I-67** |
| G40 | "Laporan rekonsiliasi harian" tanpa definisi isi, menu, zona waktu | Fitur SHOULD tak pernah ada | **D-41** |
| G41 | Job integritas D-2 belum ada; query hanya hidup di tes/smoke; pool aplikasi ber-`statement_timeout` 15 dtk | Selisih stok tak terdeteksi sampai ada yang mengeluh; query besar terpotong | **I-61** |
| G42 | Uji beban: dataset & alat `[TODO]` | NFR-PERF/CAP tak pernah terukur | **I-62** |
| G43 | Tak ada e2e; halaman M3–M4 hanya diverifikasi HTTP 200 | Regresi UI (guard, scan, tahan-konfirmasi) lolos gate | **I-63** |
| G44 | Tak ada artefak rilis maupun prosedur backup/restore yang bisa dijalankan | Runbook §17 tak bisa dieksekusi; RTO tak terukur | **I-64, I-65** |
| G45 | Pergantian profil industri = belasan `PATCH` manual berurutan | Urutan salah → `SETTING_DEPENDENCY`; MS-3 tak terbukti | **I-66** |
| G46 | CI hanya menjalankan smoke M0–M1, tanpa worker | Regresi M2–M4 baru terlihat lokal | **§6** |
| G47 | Tiga advisory _high_ pada dependensi runtime (lewat `next`) | Celah diketahui ikut ke produksi | **I-68** |

## 3. Arsitektur (yang dibangun)

```
 Transaksi confirm (web)                         apps/worker (tiap 10 dtk)
  … efek stok … + r.outbox.add()   ─────►  integration_event(PENDING)
                                                   │ dispatchOutbox (packages/application)
                                                   ▼ ⟦TX per event⟧
                               claimNext: kepala antrean ref, jatuh tempo, FOR UPDATE SKIP LOCKED
                                                   │ ErpGateway.send  (port)
                                                   ▼
                              HttpErpGateway (packages/infrastructure): POST ERP_CALLBACK_URL
                                 X-Event-Id · X-Event-Type · X-WMS-Timestamp · X-WMS-Signature
                                                   │
                         2xx → SENT      non-2xx/timeout → FAILED(+backoff) │ ke-N → DEAD (log alert)
                                         429/502/503/504/jaringan → putaran berhenti (D-40)

 Desktop /admin/integration   Outbox (status gateway, retry, retry massal) · Rekonsiliasi · API key
 /api/v1/admin/integration-events[/retry|/{id}/retry] · /api/v1/admin/reconciliation
 worker 02:30 harian          dailyHealthCheck: checkIntegrity (D-2/D-2b) + ringkasan rekonsiliasi → log `alert`
 CLI                          pnpm db:integrity
```

| Paket | Tambahan M5 |
|---|---|
| `packages/domain` | `integration.ts`: backoff, `outboxFailure`, amplop body, teks tanda tangan, status "ERP tak melayani" — murni |
| `packages/contracts` | `integrationRetryAll`, `IntegrationGatewayDto`, kontrak rekonsiliasi |
| `packages/application` | Port `ErpGateway`, `OutboxRepository.claimNext/markSent/markFailed`; use-case `dispatchOutbox`, `reconciliation`, `retryIntegrationEvents` |
| `packages/infrastructure` | `HttpErpGateway`, `createErpGateway`, `erpGatewayStatus`; SQL klaim kepala antrean; query rekonsiliasi |
| `packages/db` | `checkIntegrity` + CLI `integrity` |
| `packages/config` | `ERP_CALLBACK_URL/SECRET/AUTH_HEADER/TIMEOUT_MS`, `OUTBOX_MAX_ATTEMPTS` |
| `apps/worker` | `pollOutbox` memakai use-case; `dailyHealthCheck` |
| `apps/web` | Halaman Integration bertab; 2 route baru; header HSTS + COOP |
| `apps/e2e` | Playwright: 3 spec, 9 uji |
| `scripts/` | `smoke-m5.sh`, `erp-stub.mjs`, `load/seed-scale.sh`, `load/run.mjs`, `backup.sh`, `restore-drill.sh`, `apply-profile.sh` |

## 4. Alur Data Kritis

### 4.1 Kirim callback (D-39/D-40)

```
worker tick → dispatchOutbox(limit 100):
  ulangi: ⟦TX⟧
     e := SELECT … FROM integration_event e
           WHERE status IN (PENDING, FAILED) AND (next_retry_at IS NULL OR next_retry_at <= now)
             AND NOT EXISTS (event lebih tua ber-(ref_table, ref_id) sama yang masih PENDING/FAILED)
           ORDER BY created_at, id LIMIT 1 FOR UPDATE OF e SKIP LOCKED
     tak ada → selesai
     POST url   body = {event_type, occurred_at, …payload}   timeout ERP_CALLBACK_TIMEOUT_MS, redirect: manual
     2xx        → SENT, attempts+1, last_error NULL
     selainnya  → attempts+1; attempts ≥ OUTBOX_MAX_ATTEMPTS ? DEAD : FAILED, next_retry_at = now + 30 dtk·2^(n−1) (maks 1 jam)
     jaringan / timeout / 429 / 502 / 503 / 504 → tandai seperti di atas LALU hentikan putaran
  ⟦/TX⟧
```

Baris terkunci selama HTTP: worker lain melewatinya (`SKIP LOCKED`) dan event berikutnya pada ref itu tak memenuhi syarat karena pendahulunya masih PENDING di mata mereka. Proses worker mati → lock lepas, status tak berubah → event dikirim ulang (at-least-once).

### 4.2 Verifikasi di sisi ERP (contoh: `scripts/erp-stub.mjs`)

```
ts  := header X-WMS-Timestamp (detik UNIX);  tolak bila |now − ts| > 300 dtk
sig := "sha256=" + hex(HMAC_SHA256(ERP_CALLBACK_SECRET, ts + "." + body_mentah))
bandingkan constant-time dengan X-WMS-Signature → beda: 401
X-Event-Id sudah pernah diproses → jawab 200 tanpa efek kedua
status lama (occurred_at < status terakhir yang tersimpan) → abaikan, jawab 200
```

### 4.3 Rekonsiliasi (D-41)

```
GET /admin/reconciliation?kind=&limit=   (RBAC view admin_integration)
today := hari kalender pada zona waktu gudang default pemohon (P-7)
OVERDUE_RECEIPT   PO OPEN/PARTIAL  ∧ expected_date < today
OVERDUE_DELIVERY  SO RECEIVED/PROCESSING/PARTIAL ∧ delivery_date < today
CALLBACK_DEAD     event DEAD        CALLBACK_FAILED  event FAILED
CALLBACK_STUCK    event PENDING lebih tua dari 15 menit (worker mati / gateway belum diisi)
→ baris: jenis, order (erp_ref, partner, status, jatuh tempo, hari telat, Σ terpenuhi / Σ dipesan) dan/atau event
→ meta.summary: jumlah per jenis (selalu menyeluruh, tak terpengaruh filter)
```

## 5. Keputusan Baru

### 5.1 Behavioral (masuk behavioral §2 v1.5; rincian kawat di erp-integration v1.2)

| ID | Keputusan | Alasan |
|---|---|---|
| **D-39** | **Kontrak kawat callback.** `POST ERP_CALLBACK_URL`, `Content-Type: application/json`. Body = payload event (erp-integration §6) ditambah `event_type` dan `occurred_at` (waktu event ditulis, UTC). Header: `X-Event-Id` (= `integration_event.id` = `event_id` di body), `X-Event-Type`, `X-WMS-Attempt` (percobaan ke-n), `X-WMS-Timestamp` (detik UNIX), `X-WMS-Signature: sha256=<hex HMAC-SHA256(ERP_CALLBACK_SECRET, "<timestamp>.<body mentah>")>` bila rahasia diisi, dan satu header statis opsional `ERP_CALLBACK_AUTH_HEADER`. **Hanya 2xx = terkirim.** Redirect tidak diikuti (3xx = gagal). Semua kegagalan dicoba ulang dengan backoff 30 dtk × 2^(n−1) (maks 1 jam); kegagalan ke-`OUTBOX_MAX_ATTEMPTS` (10 ≈ 3 jam) → `DEAD`. **Urutan:** event hanya dikirim bila tak ada event lebih tua ber-`(ref_table, ref_id)` sama yang masih `PENDING`/`FAILED`; `DEAD` melepas tahanan. | Tanda tangan atas timestamp + body membuktikan asal dan menutup replay; header statis menampung ERP yang hanya mengenal bearer token. Tak membedakan 4xx "permanen": 401/403 biasanya salah konfigurasi yang diperbaiki operator, dan mencoba ulang tidak berbahaya karena ERP dedupe pada `X-Event-Id`. |
| **D-40** | **ERP tak melayani menghentikan putaran.** Galat jaringan, timeout, atau `429/502/503/504` tetap menghitung satu percobaan untuk event itu, lalu putaran kirim berhenti; event lain tak disentuh sampai tick berikutnya. | Saat ERP mati, hanya satu event per tick (10 dtk) yang memakan percobaan, bukan seluruh antrean — gangguan singkat tak menghasilkan DEAD massal dan worker tak tersandera timeout berantai. |
| **D-41** | **Rekonsiliasi = lima jenis selisih** (§4.3) di tab halaman Integration (hak view `admin_integration`, tanpa menu/seed baru — pola m4 I-44). "Hari ini" = zona waktu gudang default pemohon. Order `DONE/CLOSED/CANCELLED` tak pernah dihitung telat. Worker menjalankan ringkasannya tiap hari (02:30 waktu server) bersama cek D-2 dan menulis log ber-`alert`. | Menjawab erp-integration §7 dengan data yang sudah ada: apa yang ERP harapkan sudah terjadi tetapi belum (order), dan apa yang sudah terjadi tetapi ERP belum tahu (callback). |

### 5.2 Implementasi

| # | Keputusan | Alasan | Trade-off / biaya |
|---|---|---|---|
| I-58 | `OutboxRepository.add` mengisi `created_at = clock_timestamp()` | `now()` = awal transaksi → event se-⟦TX⟧ kembar; urutan tulis harus terlihat. Antar-transaksi pada ref yang sama sudah berurutan karena keduanya mengunci baris order (A-5) | Kolom tak lagi berarti "awal transaksi"; tanpa perubahan schema (default DDL tetap `now()`) |
| I-59 | Satu ⟦TX⟧ per event, baris terkunci selama HTTP (≤ `ERP_CALLBACK_TIMEOUT_MS`, default 10 dtk) | Klaim tanpa status perantara (enum tak berubah); mati di tengah = otomatis dilepas | Satu koneksi pool worker tertahan selama kirim; retry manual atas event yang sedang dikirim menunggu lock (≤ 4 dtk → `LOCK_TIMEOUT`) |
| I-60 | `POST /admin/integration-events/retry {status: DEAD\|FAILED}` (default DEAD) → semuanya `PENDING`, `attempts = 0`; satu baris audit `RETRY_ALL` ber-jumlah | Pemulihan setelah gangguan panjang = satu aksi; karena klaim selalu mengambil kepala antrean tertua, urutan per ref pulih dengan sendirinya | Retry **tunggal** atas DEAD yang penerusnya sudah terkirim tetap tiba terlambat — ERP memakai `occurred_at` untuk membuang status basi |
| I-61 | `checkIntegrity(pool)` di `packages/db`: D-2 per (lokasi, produk, batch, serial, status), D-2b, quant ≤ 0; satu snapshot `REPEATABLE READ READ ONLY`, `statement_timeout` sendiri (10 mnt); dipakai CLI `db:integrity`, job harian, dan uji | Satu sumber query untuk runbook, alert, dan gate | Memindai seluruh ledger: 1,1 juta baris ≈ 1 dtk (§8); pada puluhan juta baris perlu jendela malam / tabel saldo |
| I-62 | Uji beban = `scripts/load/seed-scale.sh` (SQL `generate_series`: 20.000 SKU, 3.000 bin, 100.000 quant ber-ledger konsisten, 1 juta baris riwayat berpasangan nol) + `scripts/load/run.mjs` (Node murni: 18 operator virtual + 2 pembaca, laju tetap lalu fase puncak) | Tanpa alat baru; dataset tetap lolos D-2 sehingga cek integritas pasca-uji bermakna | Bukan alat beban umum; skenario ditulis tangan mengikuti `next_expected` |
| I-63 | e2e = paket `apps/e2e` (Playwright, Chromium). Handheld dijalankan _state-driven_: langkah dibaca dari `next_expected`, dijawab lewat UI (field scan + Enter, tombol, tahan-konfirmasi) | Mengikuti mesin langkah server sehingga tak rapuh terhadap perubahan teks/urutan | Butuh DB segar + server produksi berjalan (sama seperti smoke); spec berurutan, satu worker |
| I-64 | `Dockerfile` dua target: `web` (standalone, `BRAND_ID` build-arg, non-root, healthcheck) dan `worker` (repo + dependensi penuh; juga menjalankan `pnpm db:*`) | Runbook hanya butuh dua image; migrasi & integritas memakai image worker | Image worker besar (memuat devDependencies untuk `tsx`) |
| I-65 | `backup.sh`: `pg_dump -Fc`, verifikasi daftar isi, manifest (versi schema, jumlah baris tabel kunci, sha256), retensi. `restore-drill.sh`: pulihkan ke DB sementara → checksum, versi schema, jumlah ≥ manifest, trigger immutabilitas, `db:integrity` | "Backup terverifikasi" dan "uji restore" (NFR-BKP-4) menjadi perintah yang hasilnya lulus/gagal, sekaligus mengukur RTO | Backup logis saja; RPO = jarak antar-backup sampai WAL/PITR diputuskan (NFR-BKP-1) |
| I-66 | `apply-profile.sh <farmasi\|retail\|fnb\|manufaktur>` memanggil `PATCH /config/settings/*` & operation type dengan urutan aman-dependensi | Validasi D-36 (data, dependensi) dan audit tetap berlaku; MS-3 terbukti di smoke | Baris "➖" matriks tak disentuh; flag yang masih punya data ditolak dan dilaporkan |
| I-67 | `ERP_CALLBACK_URL` kosong → worker tak mengirim; event tetap `PENDING`; UI menampilkan peringatan dan host tujuan (tanpa rahasia) lewat `meta.gateway` | Instalasi tanpa ERP tetap sah; admin tahu sebabnya | Mengisi URL kemudian mengirim **seluruh** tumpukan lama — runbook §5 meminta keputusan sebelum menyalakan |
| I-68 | `next` 16.3.6 → 16.4.0 (dan `sharp`, `source-map-js` transitif); CI `pnpm audit --prod --audit-level high` | Menutup tiga advisory _high_; gate mencegah yang baru | Naik versi minor di ujung milestone — dibuktikan ulang oleh build, smoke M0–M5, dan e2e (§8) |
| I-69 | Tanpa perubahan schema & seed | Semua kebutuhan terpenuhi kolom yang ada (`integration_event` sejak v1.4) | Tak ada status "sedang dikirim" (lihat I-59) |

## 6. Perubahan Kontrak (sudah diterapkan)

| Dokumen | Perubahan |
|---|---|
| Schema / seed | Tidak ada (tetap v1.6); `ddl-validation` tetap 48 skenario |
| Behavioral 1.5 | D-39..D-41 di §2 + ringkasan |
| ERP integration 1.2 | §3 backoff & urutan dirinci; §6 kontrak kawat (D-39), contoh verifikasi; §7 rekonsiliasi (D-41) & retry massal |
| API 1.7 | §11.5 `meta.gateway`, `POST /admin/integration-events/retry`, `GET /admin/reconciliation` |
| Configuration 1.3 | Env `ERP_CALLBACK_*`, `OUTBOX_MAX_ATTEMPTS`; langkah profil lewat `apply-profile.sh` |
| Test-delivery 1.2 | M5 di tabel milestone; smoke M5, e2e, uji beban, `db:integrity`, backup/restore di runbook; CI penuh |
| Baru | `docs/uat-wms-baseline.md`, `docs/operations-runbook-wms-baseline.md` |
| CI | `ci.yml`: audit, smoke M0–M5 dengan worker + ERP tiruan, `db:integrity`, e2e; `release.yml`: image saat tag `v*` |
| CLAUDE.md / README | Status M5, perintah, peta dokumen & kode |

## 7. Skala & Keandalan

- **Throughput gateway:** berurutan per worker, **maks 100 event per tick 10 dtk ≈ 10 event/dtk per worker** (≈ 5 delivery/dtk, karena satu delivery = 2 event). Pada fase puncak uji beban event lahir ± 19/dtk — antrean menumpuk sementara lalu habis dalam beberapa tick; seluruh 876 event (438 delivery dari putaran percobaan + putaran utama) terkirim tanpa sisa. Butuh lebih → jalankan worker kedua (aman, `SKIP LOCKED`; urutan per ref tetap).
- **ERP lambat:** satu event menahan satu koneksi ≤ timeout; ERP mati → satu percobaan per tick (D-40).
- **Antrean:** `idx_intevent_status` untuk klaim, `idx_intevent_ref` untuk cek pendahulu. Event `SENT` tidak dihapus (revisit #2).
- **Integritas:** 1,1 juta baris ledger → 1 dtk. Linear terhadap ledger.
- **Observabilitas:** `alert: OUTBOX_DEAD` (saat terjadi & harian), `INTEGRITY_D2`, `RECONCILIATION`; dashboard menampilkan outbox PENDING/FAILED/DEAD.

## 8. Pembuktian (gate)

| Lapisan | Isi | Perintah |
|---|---|---|
| Domain | **105 tes** (+4): backoff & batas DEAD, amplop body, teks tanda tangan, status "tak melayani" | `pnpm test` |
| Integrasi (PG14 nyata + ERP HTTP lokal) | **13 skenario M5** (`integration.int.test.ts`): amplop + header + HMAC diverifikasi; tanpa rahasia / tanpa URL; FAILED → backoff 30/60 dtk → DEAD pada percobaan ke-N dengan `X-Event-Id` tetap; redirect & timeout; urutan per ref (penerus ditahan, ref lain jalan); DEAD melepas tahanan; dua event se-⟦TX⟧ berurutan (I-58); ERP 503 / koneksi ditolak → putaran berhenti, satu percobaan terpakai; **3 dispatcher paralel × 30 event → tepat satu kali, urutan utuh**; receipt PO nyata → `RECEIPT_CONFIRMED` lalu `ORDER_STATUS_CHANGED` ber-payload §6; retry massal + audit + RBAC; rekonsiliasi lima jenis + filter + RBAC; `checkIntegrity` sehat → dirusak → terdeteksi beserta contoh. Suite M0–M4 tetap hijau → total 147 | `pnpm test:integration` |
| HTTP end-to-end | **62 cek** `scripts/smoke-m5.sh`: worker mengirim ke ERP tiruan (tanda tangan valid, urutan, tanpa duplikat), ERP 500 → FAILED + penerus tertahan + backoff, retry manual, DEAD → retry massal, `meta.gateway` tanpa rahasia, rekonsiliasi (callback & order telat), RBAC (operator, API key), ERP menarik order, **MS-3: profil retail lalu farmasi mengubah menu & flag lewat konfigurasi saja**, D-2. Smoke M0–M4 tetap hijau | `bash scripts/smoke-m5.sh` (DB segar + web + worker ber-`ERP_CALLBACK_URL`) |
| e2e browser | **9 uji** Playwright: redirect tanpa sesi; login pertama wajib ganti password; `MUST_CHANGE_PASSWORD` di API; guard per page → `/forbidden`; handheld receipt (scan karton → qty → cetak label → LPN → bin → tahan-konfirmasi) → stok 200; handheld picking pallet utuh → staging → dock → confirm → stok 0; halaman Integration (status gateway, callback, tab Rekonsiliasi & API key) | `pnpm test:e2e` |
| Uji beban | Tabel di bawah | `scripts/load/seed-scale.sh` → `node scripts/load/run.mjs` |
| Backup / restore | 1,1 juta baris ledger: backup terverifikasi 4 dtk (81 MB); pulih + verifikasi + `db:integrity` 9 dtk | `scripts/backup.sh` · `scripts/restore-drill.sh` |
| Gate statis | format, lint, type-check, build, `pnpm audit --prod --audit-level high` | `pnpm quality` · `pnpm audit …` |

### 8.1 Hasil uji beban (13-10-2026)

Lingkungan: MacBook Pro M4 Pro (12 core, 24 GB), PostgreSQL 14 di Docker Desktop, web = build produksi standalone (1 proses), worker + ERP tiruan aktif. Dataset: 20.000 SKU, 3.005 bin, 100.000 quant, 1.099.618 baris ledger (499 MB). Beban: 10 operator inbound + 8 operator outbound + 2 pembaca laporan; 30% transaksi berebut 200 SKU "laris".

| Kelas request | NFR | Batas p95 | p50 | **p95** | p99 | maks | n | Hasil |
|---|---|---|---|---|---|---|---|---|
| Scan handheld (laju tetap 10,2/dtk × 120 dtk) | NFR-PERF-1 | 300 ms | 30 | **55 ms** | 67 | 89 | 1.222 | ✅ |
| Confirm atomik | NFR-PERF-2 | 1.000 ms | 26 | **47 ms** | 70 | 113 | 129 | ✅ |
| List/stock/laporan berpaginasi | NFR-PERF-3 | 800 ms | 51 | **258 ms** | 274 | 283 | 412 | ✅ |
| Generate pick list | NFR-PERF-4 | 2.000 ms | 14 | **24 ms** | 38 | 38 | 75 | ✅ |
| Reserve saat `start` (tanpa NFR) | — | — | 22 | 28 ms | 34 | 34 | 75 | — |
| Scan fase puncak (tanpa jeda, 20 dtk) | NFR-PERF-6 | ≥ 10 scan/dtk | 61 | 79 ms | 89 | 112 | 3.928 | ✅ **196 scan/dtk** |

Selama uji: 337 receipt dan 344 delivery selesai, **0 request gagal** (tak ada `LOCK_TIMEOUT`/deadlock), callback tiap delivery terkirim tepat satu kali dengan tanda tangan valid (876 event untuk 438 delivery, termasuk putaran percobaan 4 operator pada DB yang sama), dan `db:integrity` sesudahnya **0 selisih** (D-2, D-2b). Angka ini indikatif untuk perangkat keras dev; ulangi di server target sebelum go-live (runbook §6).

## 9. Yang Belum Dilakukan (butuh manusia / infrastruktur)

| Item | Yang sudah siap | Yang masih harus dilakukan |
|---|---|---|
| UAT (test-delivery §11) | `docs/uat-wms-baseline.md`: skenario per modul, MS-1, MS-3, lembar tanda tangan | Dijalankan pengguna gudang di staging; tanda tangan per modul |
| Deploy staging | `Dockerfile`, `docker-compose.prod.yml`, runbook §3 | Server/registry klien; reverse proxy ber-TLS |
| Onboarding klien pertama | Runbook §5, `apply-profile.sh`, `brands/<klien>` | Data master klien, brand, service account ERP, URL & rahasia callback |
| Pembekuan baseline | Aturan di migration §2.1 | Saat deploy klien pertama / tag `v1.0`: catat sha256 `0001_baseline` di `migrations/meta/checksums.json` — sejak itu perubahan schema = migrasi `0002…` |
| Uji beban di perangkat keras target | Skrip + ambang NFR | Jalankan di server produksi/staging |
| Keputusan bisnis terbuka | — | NFR-BKP-1 (WAL/PITR, RPO), NFR-BKP-3 (retensi), NFR-SEC-8 (enkripsi at-rest) |

## 10. Revisit Saat Sistem Tumbuh

1. **Status `SENDING` / lease** bila ERP sering lambat dan koneksi worker menjadi sempit (I-59).
2. **Retensi `integration_event` SENT** (mis. arsip > 180 hari) — kini tak pernah dihapus.
3. **Export rekonsiliasi** lewat `report_job` dan kiriman email harian.
4. **Tabel saldo ledger berkala** agar cek D-2 tak memindai seluruh ledger pada puluhan juta baris (I-61).
5. **Metrik Prometheus** (panjang antrean outbox, latensi scan) menggantikan alert berbasis log.
6. **Daftar event per instalasi** (`ERP_CALLBACK_EVENTS`) bila ERP tak ingin menerima `ADJUSTMENT_POSTED`.
7. **e2e handheld tambahan**: swap + ack FEFO, carton break, adjustment; uji visual per brand.
8. **Rotasi rahasia callback tanpa jeda** (dua kunci aktif bersamaan).

---

## Ringkasan Keputusan (M5)

1. Callback = `POST` JSON ber-`X-Event-Id` dengan tanda tangan HMAC atas `<timestamp>.<body>`; hanya 2xx yang terkirim; redirect tak diikuti; backoff 30 dtk × 2^(n−1) sampai DEAD pada percobaan ke-10 (D-39).
2. Urutan per order dijaga dengan hanya mengirim kepala antrean tiap ref; waktu tulis event memakai `clock_timestamp()` agar event se-transaksi tetap berurutan (D-39, I-58).
3. ERP tak melayani menghentikan putaran sehingga hanya satu event per tick yang memakan percobaan (D-40).
4. Satu transaksi per event dengan baris terkunci selama HTTP — aman multi-worker tanpa status baru (I-59); retry massal memulihkan antrean setelah gangguan (I-60).
5. Rekonsiliasi = order terbuka lewat jatuh tempo + callback mati/gagal/macet, di halaman Integration; ringkasannya dan cek D-2 dijalankan worker tiap hari sebagai log ber-`alert` (D-41, I-61).
6. Uji beban tanpa alat baru pada dataset skala NFR-CAP: seluruh NFR-PERF lolos dengan selisih lebar di mesin dev, 0 error, D-2 utuh (I-62).
7. e2e Playwright mengikuti `next_expected` lewat UI nyata; artefak rilis = dua image; backup ber-manifest dan uji restore yang membuktikan isi (I-63..I-65).
8. Profil industri dipasang lewat API sehingga validasi dan audit tetap berlaku — MS-3 terbukti di smoke (I-66).
9. Tanpa perubahan schema & seed; `next` dinaikkan untuk menutup advisory _high_ dan CI menjaga dengan `pnpm audit` (I-68, I-69).
10. UAT bersama pengguna, deploy staging, onboarding klien nyata, dan pembekuan baseline belum dilakukan — skrip dan runbook-nya tersedia (§9).
