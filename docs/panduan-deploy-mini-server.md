# Panduan Deploy — Mini Server (Docker) + Cloudflare Tunnel

**Memasang WMS Baseline untuk uji coba di satu mini server yang sudah menjalankan Docker dan `cloudflared`, lalu membukanya ke internet lewat Cloudflare Tunnel.**

Versi: 1.0 · 16 Oktober 2026

> Topik: langkah demi langkah dari server kosong (Docker sudah ada) sampai WMS bisa dibuka di `https://wms.domainanda.com`. Setelah selesai, lanjut ke [`panduan-uji-coba-wms.md`](panduan-uji-coba-wms.md). Prosedur produksi resmi tetap [`operations-runbook-wms-baseline.md`](operations-runbook-wms-baseline.md); panduan ini adalah versi praktis untuk satu mesin uji coba.

---

## 1. Gambaran Hasil Akhir

```
 Internet ──HTTPS──► Cloudflare ──tunnel──► cloudflared (di mini server)
                                                │
                    ┌───────────────────────────┼──────────────── jaringan Docker "wms-net" ─┐
                    │                           ▼                                             │
                    │   web (Next.js :3482) ◄── wms.domainanda.com                            │
                    │      │  UI desktop + handheld /hh + REST API /api/v1                    │
                    │      ▼                                                                  │
                    │   postgres:14 ◄── worker (outbox → ERP, export laporan, cek harian)     │
                    │                          │ POST callback bertanda tangan HMAC           │
                    │                          ▼                                              │
                    │   erp-sim (:4482) ◄── erp-sim.domainanda.com (opsional, dashboard)      │
                    └─────────────────────────────────────────────────────────────────────────┘
```

| Service | Isi | Dibuka ke internet? |
|---|---|---|
| `postgres` | Database (volume `wms_pgdata`) | Tidak |
| `web` | UI + API WMS, port `127.0.0.1:3482` | **Ya**, lewat tunnel |
| `worker` | Pengirim callback ke ERP, export laporan, housekeeping, cek integritas harian | Tidak |
| `erp-sim` | ERP tiruan: menerima callback WMS + dashboard, port `127.0.0.1:4482` | Opsional (berpassword) |
| `migrate` | Sekali jalan: buat tabel + data awal | — |

Semua berkas ada di folder [`deploy/`](../deploy): `docker-compose.yml`, `wms.env.example`, `erp-simulator/`, `postman/`.

## 2. Prasyarat

| # | Kebutuhan | Cek |
|---|---|---|
| 1 | Docker Engine ≥ 24 + plugin Compose v2 | `docker version` dan `docker compose version` |
| 2 | RAM ≥ 4 GB (build Next.js butuh ±2–3 GB sesaat); disk kosong ≥ 10 GB | `free -h`, `df -h` |
| 3 | `git` (atau `rsync` dari laptop) | `git --version` |
| 4 | Domain sudah di Cloudflare + tunnel `cloudflared` sudah jalan | Zero Trust → Networks → Tunnels: status **HEALTHY** |
| 5 | Arsitektur CPU x86_64 **atau** arm64 (keduanya didukung image Node/Postgres) | `uname -m` |

> RAM kurang dari 4 GB? Tambah swap sementara (`sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`) atau bangun image di laptop (§9.2).

## 3. Ambil Kode ke Server

Pilih salah satu.

**A. git clone** (server punya akses ke repo GitHub — deploy key / token):

```bash
git clone git@github.com:dedysimamora/wms-template.git ~/wms
```

**B. rsync dari laptop** (repo privat, server tanpa akses GitHub) — jalankan di laptop:

```bash
rsync -az --delete --exclude node_modules --exclude .next --exclude .turbo --exclude .git ./ user@mini-server:~/wms/
```

Lalu masuk ke folder di server:

```bash
cd ~/wms
```

> Folder `deploy/` dan dokumen ini harus ikut ter-commit/tersalin. Bila memakai opsi A, commit & push dulu perubahan lokal.

## 4. Isi File Rahasia `deploy/wms.env`

```bash
cp deploy/wms.env.example deploy/wms.env
```

Buat nilai acak untuk setiap rahasia (jalankan 5×, satu untuk tiap baris di bawah):

```bash
openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-40
```

Buka `deploy/wms.env` dan ganti semua nilai berawalan `GANTI_`:

| Variabel | Isi | Catatan |
|---|---|---|
| `POSTGRES_PASSWORD` | acak | Hanya dipakai di dalam jaringan Docker |
| `JWT_SECRET`, `SESSION_SECRET` | acak, **berbeda**, ≥ 32 karakter | Mengganti nanti = semua user logout |
| `ERP_CALLBACK_SECRET` | acak, ≥ 16 karakter | Kunci tanda tangan HMAC callback; dipakai juga oleh `erp-sim` untuk memverifikasi. Simpan — dibutuhkan Postman folder 60 |
| `ERP_SIM_UI_PASSWORD` | acak | Login dashboard ERP simulator (user `erp`) |
| `WMS_PORT` | `3482` | Port web (host **dan** container). Sengaja bukan 3000 agar tak bentrok dengan aplikasi lain |
| `ERP_SIM_PORT` | `4482` | Port ERP simulator (host dan container) |

Pastikan kedua port belum dipakai: `sudo ss -ltnp | grep -E ':3482|:4482'` harus kosong. Bila terpakai, pilih nomor lain (mis. `3591`/`4591`) — lalu **ganti juga** port di `ERP_CALLBACK_URL` dan di semua URL `localhost:3482`/`4482` pada panduan ini.

Biarkan `ERP_CALLBACK_URL=http://erp-sim:4482/erp/callback` — worker mengirim callback ke simulator lewat jaringan Docker internal, bukan lewat internet.

```bash
chmod 600 deploy/wms.env
```

## 5. Build, Migrasi, Jalankan

Agar perintah pendek, buat alias untuk sesi terminal ini:

```bash
alias wms='docker compose -f deploy/docker-compose.yml --env-file deploy/wms.env'
```

**5.1 Build image** (5–15 menit pertama kali; berikutnya cepat karena cache):

```bash
wms build
```

Hasil: image `wms-web:local` dan `wms-worker:local` (`docker images | grep wms`).

**5.2 Buat database + data awal** (sekali; aman diulang):

```bash
wms --profile ops run --rm migrate
```

Harus berakhir dengan `seed selesai (idempoten)`. Pesan `../../.env not found` normal (konfigurasi datang dari env Docker).

**5.3 Jalankan semua service:**

```bash
wms up -d
```

**5.4 Periksa:**

```bash
wms ps
curl -s localhost:3482/api/health
curl -s localhost:3482/api/ready
wms logs worker --tail 20
```

| Pemeriksaan | Hasil yang benar |
|---|---|
| `wms ps` | `postgres` healthy, `web` healthy, `worker` & `erp-sim` Up. Kolom port `web` berbunyi `3000/tcp, 127.0.0.1:3482->3482/tcp` — `3000/tcp` hanya metadata image, **tidak** memakai port 3000 di host |
| `/api/health` | `{"status":"ok",…}` |
| `/api/ready` | `{"status":"ready","schema":"0001",…}` (bukan `schema_mismatch`) |
| log worker | baris `worker berjalan` dengan `"erp":{"configured":true,"host":"erp-sim:4482","signed":true…}` |
| log erp-sim (`wms logs erp-sim`) | `erp-sim mendengar di :4482 (signed=true, ui_auth=true…)` |

## 6. Hubungkan ke Cloudflare Tunnel

### 6.1 Tentukan alamat service yang dipakai cloudflared

| Cara cloudflared berjalan | Cek | URL service untuk WMS | URL service untuk ERP simulator |
|---|---|---|---|
| Service di host (apt/systemd) | `systemctl status cloudflared` | `http://localhost:3482` | `http://localhost:4482` |
| Container dengan `network_mode: host` | `docker inspect -f '{{.HostConfig.NetworkMode}}' <container-cloudflared>` → `host` | `http://localhost:3482` | `http://localhost:4482` |
| Container di jaringan bridge biasa | perintah di atas → nama jaringan lain | `http://wms-web:3482` | `http://wms-erp-sim:4482` |

Untuk baris ketiga, sambungkan container cloudflared ke jaringan WMS (sekali; bertahan selama container tidak dibuat ulang):

```bash
docker network connect wms-net <nama-container-cloudflared>
```

> Bila cloudflared dibuat dari docker-compose lain, tambahkan `wms-net` sebagai jaringan `external: true` di compose itu agar sambungan permanen.

### 6.2 Tambah Public Hostname

**Tunnel dikelola dari dashboard (paling umum):** Cloudflare Zero Trust → Networks → Tunnels → pilih tunnel → **Public Hostname** → *Add a public hostname*:

| Subdomain | Domain | Type | URL |
|---|---|---|---|
| `wms` | `domainanda.com` | HTTP | `localhost:3482` *(atau `wms-web:3482`)* |
| `erp-sim` *(opsional)* | `domainanda.com` | HTTP | `localhost:4482` *(atau `wms-erp-sim:4482`)* |

Jangan isi "HTTP Host Header" — biarkan cloudflared meneruskan host asli (`wms.domainanda.com`); WMS memakainya untuk pemeriksaan CSRF.

**Tunnel dikelola lewat `config.yml` lokal:** tambahkan ke `ingress` (sebelum aturan `http_status:404`), lalu restart cloudflared:

```yaml
ingress:
  - hostname: wms.domainanda.com
    service: http://localhost:3482
  - hostname: erp-sim.domainanda.com
    service: http://localhost:4482
  - service: http_status:404
```

### 6.3 Pengaturan Cloudflare yang penting

| Pengaturan | Nilai | Alasan |
|---|---|---|
| SSL/TLS → Edge Certificates → **Always Use HTTPS** | On | Cookie login WMS ber-flag `Secure`; lewat `http://` login akan gagal/berputar |
| Speed → **Rocket Loader** | Off | Menyuntik ulang JavaScript dan dapat merusak aplikasi Next.js |
| Security → **Bot Fight Mode** | Off, atau buat aturan WAF *Skip* untuk path `/api/v1/*` | Bila aktif, request Postman/ERP bisa dijawab halaman tantangan Cloudflare (HTML 403) alih-alih JSON |
| (Opsional) Zero Trust → Access → Application untuk `erp-sim.domainanda.com` | Allow email Anda | Lapisan tambahan di depan dashboard simulator. Catatan: Postman folder 50/60 lalu butuh service token Access |

### 6.4 Uji dari luar

```bash
curl -s https://wms.domainanda.com/api/ready
```

Buka `https://wms.domainanda.com` di browser → halaman **Masuk**. Buka `https://erp-sim.domainanda.com` → diminta user/password (`erp` / `ERP_SIM_UI_PASSWORD`).

## 7. Langkah Pertama Setelah Online (WAJIB)

WMS kini bisa diakses siapa pun yang tahu URL-nya. Segera:

1. Login `admin` / `ChangeMe123!` → sistem memaksa **Ganti password** → pakai password kuat (≥ 10 karakter, huruf + angka). Setelah ganti, Anda diminta login ulang.
2. Jangan membagikan URL sebelum langkah 1 selesai. Login gagal 5× mengunci akun 15 menit (bisa diubah di App Settings).
3. Lanjutkan ke [`panduan-uji-coba-wms.md`](panduan-uji-coba-wms.md).

## 8. Operasi Harian

| Kebutuhan | Perintah (dari folder repo, alias `wms` aktif) |
|---|---|
| Status | `wms ps` |
| Log web / worker / simulator | `wms logs -f web` · `wms logs -f worker` · `wms logs -f erp-sim` |
| Cek integritas stok (invarian quant ⇔ ledger) | `wms run --rm worker pnpm db:integrity` → harus `→ OK` |
| Backup terverifikasi | `BACKUP_DIR=~/wms-backups PG_DOCKER=wms-postgres-1 bash scripts/backup.sh` |
| Uji restore backup (ke DB sementara, produksi tak disentuh) | `KEEP_DRILL_DB=1 PG_DOCKER=wms-postgres-1 bash scripts/restore-drill.sh ~/wms-backups/<arsip>.dump` *(butuh `node` di host)*, lalu cek invarian di DB hasil restore: `wms run --rm -e DATABASE_URL=postgres://wms:<POSTGRES_PASSWORD>@postgres:5432/wms_restore_drill worker pnpm db:integrity`, lalu hapus: `docker exec wms-postgres-1 psql -U wms -d postgres -c 'DROP DATABASE wms_restore_drill'` |
| Restart setelah mengubah `wms.env` | `wms up -d` (compose membuat ulang container yang env-nya berubah) |
| Berhenti (data tetap) | `wms down` |
| Backup harian otomatis | `crontab -e` → `30 1 * * * cd ~/wms && BACKUP_DIR=~/wms-backups PG_DOCKER=wms-postgres-1 bash scripts/backup.sh >> ~/wms-backups/backup.log 2>&1` |

**Update ke versi kode terbaru:**

```bash
cd ~/wms && git pull                                      # atau rsync ulang dari laptop
BACKUP_DIR=~/wms-backups PG_DOCKER=wms-postgres-1 bash scripts/backup.sh
wms build
wms --profile ops run --rm migrate
wms up -d
curl -s localhost:3482/api/ready
```

> Selama masa pra-rilis, perubahan schema menimpa migrasi `0001` (lihat `migration-wms-baseline.md`). Bila `/api/ready` menjawab `schema_mismatch` setelah update, cara paling sederhana di mesin uji coba adalah mengulang dari nol (§8.1).

### 8.1 Mengulang uji coba dari nol

⚠️ **Menghapus seluruh data WMS dan riwayat simulator** (volume `pgdata`, `reports`, `erpsim`):

```bash
wms down -v
wms --profile ops run --rm migrate
wms up -d
```

Password admin kembali `ChangeMe123!`; ulangi §7.

## 9. Pemecahan Masalah

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| `wms build` mati di tengah (`Killed`, exit 137) | RAM habis saat build Next.js | Tambah swap (§2) atau build di laptop (§9.2) |
| `/api/ready` → `503 schema_mismatch` | Langkah migrate terlewat | `wms --profile ops run --rm migrate` lalu `wms restart web worker` |
| Container `worker` restart terus | Sama: schema belum ada, atau env salah | `wms logs worker` — baca baris `fatal` |
| Browser: 502 / "Bad gateway" dari Cloudflare | URL service tunnel salah atau container web mati | Cek §6.1; `curl localhost:3482/api/health` di server |
| Membuka domain langsung dilempar ke `http://0.0.0.0:3482/login…` (ERR_CONNECTION_REFUSED) | Bug versi lama: redirect sesi memakai alamat bind container. Diperbaiki di `apps/web/src/app/api/v1/auth/refresh/route.ts` (Location relatif) | Tarik kode terbaru → `wms build` → `wms up -d` |
| Login berhasil tapi kembali ke halaman login | Diakses lewat `http://`, atau lewat IP LAN | Selalu buka `https://wms.domainanda.com`; aktifkan Always Use HTTPS |
| Simpan/aksi apa pun → "Origin tidak sah (CSRF)" | Public hostname memakai "HTTP Host Header" khusus | Kosongkan pengaturan Host Header di tunnel |
| Postman mendapat HTML, bukan JSON | Bot Fight Mode / tantangan Cloudflare | §6.3 |
| Callback tetap "Antre" (PENDING) | `ERP_CALLBACK_URL` kosong, worker mati | Dashboard WMS → Administrasi → Integrasi: baris "Gateway aktif → erp-sim:4482"; `wms logs worker` |
| Callback "Gagal" `HTTP 401` | `ERP_CALLBACK_SECRET` berbeda antara WMS & simulator, atau mode simulator 401 | Samakan rahasia (satu file env dipakai keduanya), set mode simulator ke Normal |
| Export laporan tak pernah selesai | Worker mati | `wms ps`, `wms logs worker` |
| Kamera handheld tidak bisa dibuka | Halaman bukan HTTPS / izin kamera ditolak | Buka lewat domain tunnel; izinkan kamera di browser HP |

### 9.2 Build di laptop, kirim image ke server

Jika server terlalu kecil untuk build. Di laptop (sesuaikan platform server: `linux/amd64` atau `linux/arm64`):

```bash
docker buildx build --platform linux/amd64 --target web --build-arg BRAND_ID=default -t wms-web:local --load .
```

```bash
docker buildx build --platform linux/amd64 --target worker -t wms-worker:local --load .
```

```bash
docker save wms-web:local wms-worker:local | gzip | ssh user@mini-server 'gunzip | docker load'
```

Di server, lewati `wms build` dan langsung ke §5.2. (Folder repo tetap dibutuhkan di server untuk `deploy/` dan `scripts/`.)

---

## Ringkasan Keputusan (deploy uji coba)

1. Satu `docker compose` (`deploy/docker-compose.yml`) membangun image dari source dan menjalankan postgres + web + worker + ERP simulator; urutan sama dengan runbook (build → migrate → up → health/ready).
2. Hanya `web` (dan opsional dashboard `erp-sim`) yang dibuka ke internet, lewat Cloudflare Tunnel; port host terikat `127.0.0.1`, TLS diterminasi Cloudflare, "Always Use HTTPS" wajib karena cookie `Secure`.
3. Callback WMS → ERP dikirim worker ke `erp-sim` lewat jaringan Docker internal, bertanda tangan HMAC dengan rahasia yang sama di kedua sisi; mengganti ke ERP sungguhan cukup mengubah `ERP_CALLBACK_URL` + rahasia.
4. Rahasia di `deploy/wms.env` (diabaikan git & konteks build Docker); password admin seed wajib diganti sebelum URL dibagikan.
