# Runbook Operasi — WMS Baseline

**Deploy, backup & restore, pemantauan, penanganan gangguan, dan onboarding klien · merealisasikan test-delivery §17–§20, migration §3, NFR-BKP, NFR-MNT-4**

Versi: 1.0 · 13 Oktober 2026

> Topik: langkah yang **dijalankan orang** pada satu instalasi (single-tenant). Semua perintah ada di repo; contoh memakai Docker Compose (`docker-compose.prod.yml`) — instalasi tanpa Docker menjalankan perintah `pnpm`/`node` yang sama (README "Perintah").

---

## 1. Komponen & Konfigurasi

| Komponen | Artefak | Catatan |
|---|---|---|
| Web (UI + API) | image `web` (`Dockerfile --target web`, `BRAND_ID=<klien>`) | Di balik reverse proxy ber-TLS; health `/api/health`, readiness `/api/ready` |
| Worker | image `worker` | Outbox ERP (10 dtk), export laporan (5 dtk), housekeeping (per jam), cek harian (02:30). Boleh > 1 proses |
| CLI DB | image `worker` | `pnpm db:migrate \| db:seed \| db:validate \| db:integrity` |
| PostgreSQL 14+ | — | Satu database per instalasi |

Environment (rahasia di file env di luar repo — configuration §1):

| Variabel | Wajib | Isi |
|---|---|---|
| `DATABASE_URL` | ✔ | Koneksi PostgreSQL |
| `JWT_SECRET`, `SESSION_SECRET` | ✔ | ≥ 32 karakter acak, berbeda per instalasi |
| `SCHEMA_MIN_VERSION`, `SCHEMA_MAX_VERSION` | — | Rentang schema yang didukung build (default `0001`) |
| `REPORT_STORAGE_DIR` | ✔ produksi | Direktori/volume yang **sama** untuk web & worker |
| `ERP_CALLBACK_URL` | bila ERP menerima callback | `https://…`; kosong = event tetap PENDING |
| `ERP_CALLBACK_SECRET` | sangat disarankan | ≥ 16 karakter; kunci HMAC `X-WMS-Signature` |
| `ERP_CALLBACK_AUTH_HEADER` | — | `Authorization: Bearer …` bila ERP memintanya |
| `ERP_CALLBACK_TIMEOUT_MS`, `OUTBOX_MAX_ATTEMPTS` | — | Default 10000 / 10 |

Web **dan** worker harus menerima nilai `ERP_CALLBACK_*` yang sama (halaman Integration menampilkan konfigurasi proses web).

## 2. Membangun Artefak

```bash
docker build --target web    -t wms-web:<versi>-<klien> --build-arg BRAND_ID=<klien> .
docker build --target worker -t wms-worker:<versi> .
```

Tag `v*` di repositori menjalankan `.github/workflows/release.yml` yang menerbitkan kedua image ke GHCR. Gate sebelum tag: CI hijau (quality + audit, integrasi, validasi DDL, smoke M0–M5, e2e).

## 3. Deploy / Upgrade (maintenance window)

```
1. Umumkan jendela pemeliharaan; hentikan aktivitas handheld.
2. Backup + verifikasi:            PG_DOCKER=<container-pg> bash scripts/backup.sh
3. Tarik image versi target.
4. Migrasi + seed idempoten:       docker compose -f docker-compose.prod.yml --profile ops run --rm migrate
5. Jalankan web + worker:          docker compose -f docker-compose.prod.yml up -d web worker
6. Health:                         curl -f https://<host>/api/health && curl -f https://<host>/api/ready
7. Smoke manual: login → 1 receipt → putaway → 1 pick → delivery (atau skenario ★ UAT yang relevan).
8. Integritas:                     docker compose -f docker-compose.prod.yml run --rm worker pnpm db:integrity   → harus "OK"
9. Buka akses; pantau log 30–60 menit (alert §6).
```

`/api/ready` mengembalikan `schema_mismatch` bila langkah 4 terlewat — web & worker menolak bekerja di luar rentang schema (migration §4). Skrip `scripts/smoke-m0..m5.sh` **hanya untuk DB segar** (CI/staging), jangan di produksi.

## 4. Backup, Restore, Rollback

| Kegiatan | Perintah | Frekuensi (NFR-BKP-4) |
|---|---|---|
| Backup logis terverifikasi | `BACKUP_DIR=/var/backups/wms PG_DOCKER=<pg> bash scripts/backup.sh` | Harian (cron) + sebelum setiap deploy |
| Uji restore | `PG_DOCKER=<pg> DRILL_DATABASE_URL=postgres://…/wms_restore_drill bash scripts/restore-drill.sh <arsip>` | Bulanan |
| Salin arsip + manifest ke lokasi lain | alat klien (rsync/objek) | Harian |

- `backup.sh` gagal (exit ≠ 0) bila arsip tak terbaca atau tabel inti tak ada; berkas `.manifest.json` menyimpan sha256, versi schema, dan jumlah baris tabel kunci.
- `restore-drill.sh` memulihkan ke database **sementara**, memeriksa checksum, versi schema, jumlah baris ≥ manifest, trigger immutabilitas ledger, lalu `db:integrity`; waktunya adalah ukuran RTO (acuan mesin dev: 1,1 juta baris ledger pulih + terverifikasi dalam 9 detik).
- **Rollback rilis** (test-delivery §18): pemicu = health/ready gagal, smoke gagal, lonjakan error, atau `db:integrity` timpang. Cara: hentikan web + worker → `pg_restore` arsip pra-deploy ke database produksi (kosongkan dulu) → jalankan image versi sebelumnya → langkah 6–8 di §3. Tidak ada down-migration.
- RPO saat ini = jarak antar-backup. WAL archiving/PITR (NFR-BKP-1) dan retensi (NFR-BKP-3) = keputusan bisnis per klien yang masih terbuka.

## 5. Onboarding Klien Baru

```
[ ] Brand: apps/web/brands/<klien>/ (tokens.css, brand.ts, logo, ikon) → gate kontras lolos (pnpm test) → build BRAND_ID=<klien>
[ ] Infrastruktur: PostgreSQL 14+, file env (rahasia unik), volume laporan, reverse proxy TLS, cron backup
[ ] Schema + seed: langkah 4 §3
[ ] Ganti password admin (wajib pada login pertama)
[ ] Profil industri:  BASE=https://<host> ADMIN_USER=admin ADMIN_PASSWORD=… bash scripts/apply-profile.sh <farmasi|retail|fnb|manufaktur>
      lalu sesuaikan baris "➖" matriks (configuration §2.1) di App Settings
[ ] Zona waktu gudang (App Settings) — menentukan "hari ini" untuk kedaluwarsa, nomor dokumen, rekonsiliasi
[ ] Master data: UOM & packaging (+barcode), sites/warehouse, lokasi (+cetak label bin), partner, reason code, (batch)
[ ] Operation type turunan & matriks RBAC (atau lima peran template); pastikan ada approver scrap selain pembuat
[ ] User riil per peran
[ ] Integrasi ERP: service account + API key (Admin → Integrasi → API key; nilai mentah tampil sekali)
      set ERP_CALLBACK_URL + ERP_CALLBACK_SECRET di web & worker; ERP memverifikasi tanda tangan (erp-integration §6.1)
[ ] Handheld: prefix/suffix scanner, pasang PWA, uji cetak label
[ ] UAT (docs/uat-wms-baseline.md) termasuk MS-1 & MS-3 → tanda tangan
[ ] Uji beban di server ini:  bash scripts/load/seed-scale.sh && node scripts/load/run.mjs --base … --enforce   (di STAGING, DB sekali-pakai)
[ ] Go-live + pantau
```

**Menyalakan callback pada instalasi yang sudah berjalan.** Selama `ERP_CALLBACK_URL` kosong, semua event menumpuk `PENDING`. Saat URL diisi, worker mengirim **seluruh** tumpukan dari yang tertua. Putuskan dulu bersama tim ERP: (a) biarkan terkirim (ERP menerima riwayat lengkap), atau (b) tandai riwayat sebagai terkirim sebelum menyalakan — `UPDATE integration_event SET status = 'SENT' WHERE status = 'PENDING' AND created_at < '<waktu mulai integrasi>'` oleh DBA, dicatat di berita acara.

**Rilis pertama = pembekuan baseline** (migration §2.1). Pada deploy klien pertama / tag `v1.0`: catat sha256 `packages/db/migrations/0001_baseline.sql` di `packages/db/migrations/meta/checksums.json`. Sejak itu `0001` tak boleh diubah; perubahan schema = migrasi `0002…` dan CI menguji jalur upgrade.

## 6. Pemantauan & Alert

Log = JSON terstruktur (pino) di stdout web & worker. Tangkap baris ber-kunci `alert`:

| `alert` | Level | Sumber | Arti | Tindakan |
|---|---|---|---|---|
| `OUTBOX_DEAD` | error | worker (saat terjadi + harian) | Event gagal `OUTBOX_MAX_ATTEMPTS` kali | §7.1 |
| `INTEGRITY_D2` | error | worker harian 02:30 | quant ≠ ledger / pool RESERVED ≠ reservasi / quant ≤ 0 | §7.3 — **hentikan transaksi pada SKU terkait** |
| `RECONCILIATION` | warn | worker harian | Ada order lewat jatuh tempo / callback belum sampai | Buka Admin → Integrasi → Rekonsiliasi |

Tambahan yang layak dipantau: `/api/ready` ≠ 200; log worker `outbox: ERP tak melayani` berulang; `report job gagal`; kegagalan login beruntun; ukuran disk volume laporan & backup. Dashboard aplikasi menampilkan outbox PENDING/FAILED/DEAD bagi pemegang hak Integrasi.

## 7. Penanganan Gangguan

### 7.1 Callback ERP gagal / DEAD

1. Admin → Integrasi → Outbox: baca `last_error` (mis. `HTTP 401` = rahasia/token salah; `ERP tak terjangkau` = jaringan/ERP mati).
2. Perbaiki penyebab (konfigurasi env → restart web + worker; atau tunggu ERP pulih).
3. FAILED akan dicoba ulang sendiri (backoff sampai 1 jam). DEAD: tombol **Retry semua yang Mati** — antrean dikirim ulang dari yang tertua, urutan per order terjaga.
4. Pastikan tab Rekonsiliasi kembali kosong. ERP tak akan memproses ganda selama ia dedupe pada `X-Event-Id`.

### 7.2 Antrean PENDING tak bergerak ("Callback macet")

Worker tak berjalan, `ERP_CALLBACK_URL` kosong di worker, atau schema di luar rentang (worker berhenti saat start). Periksa log worker baris `worker berjalan` (memuat status gateway) dan `/api/ready`.

### 7.3 `db:integrity` timpang

1. Jalankan `pnpm db:integrity` manual — keluaran menyebut lokasi, SKU, batch/serial, status, angka ledger vs quant (maks 20 contoh).
2. Bekukan SKU terkait (hentikan operasi yang menyentuhnya).
3. Telusuri di Movement report/Traceability operasi terakhir pada kombinasi itu; periksa apakah ada perubahan data di luar aplikasi (akses SQL langsung adalah penyebab paling umum — ledger immutable, quant tidak).
4. Koreksi **hanya** lewat Stock Adjustment setelah hitung fisik (tercatat di ledger), bukan `UPDATE`. Laporkan sebagai insiden beserta keluaran langkah 1.

### 7.4 Export laporan gagal / file hilang

Web & worker tak berbagi `REPORT_STORAGE_DIR`, atau volume penuh. File kedaluwarsa setelah `REPORT_TTL_HOURS` — minta ulang export.

### 7.5 Admin terkunci

Sistem menolak perubahan yang menyisakan nol administrator (`LAST_ADMIN`). Bila tetap terjadi (mis. lupa password satu-satunya admin): reset oleh DBA dengan hash sementara dari instalasi lain + `must_change_password = true`, dicatat di berita acara.

## 8. Rotasi Rahasia

| Rahasia | Cara | Dampak |
|---|---|---|
| `JWT_SECRET` / `SESSION_SECRET` | Ganti env → restart web + worker | Semua sesi berakhir; user login ulang |
| `ERP_CALLBACK_SECRET` | Sepakati waktu dengan tim ERP → ganti di ERP & env → restart | Event yang dikirim di antara dua pergantian ditolak ERP (401) lalu dicoba ulang otomatis |
| API key ERP | Terbitkan key baru → pasang di ERP → cabut key lama | Tanpa jeda bila urutan diikuti |
| Password DB | Ganti di PostgreSQL + `DATABASE_URL` → restart | Jeda singkat |

---

## Ringkasan Keputusan (operasi)

1. Dua image (web per brand, worker + CLI) dan satu database per instalasi; rahasia hanya lewat env.
2. Deploy = backup terverifikasi → migrasi → jalankan → health/ready → smoke → `db:integrity`; rollback = restore backup + versi sebelumnya.
3. Backup harian ber-manifest dan uji restore bulanan yang membuktikan isi (checksum, jumlah baris, invarian D-2).
4. Alert = log ber-kunci `alert` (`OUTBOX_DEAD`, `INTEGRITY_D2`, `RECONCILIATION`) + readiness.
5. Onboarding = brand build + profil lewat `apply-profile.sh` + master data + integrasi ERP + UAT; menyalakan callback pada instalasi berjalan butuh keputusan atas tumpukan lama.
6. Rilis klien pertama membekukan baseline schema; sesudahnya setiap perubahan adalah migrasi baru.
