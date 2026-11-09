# M4 Visibility & Admin — Desain Implementasi · WMS Baseline

**Bagaimana milestone M4 (Stock Adjustment, in-transit & transit loss, Handling Units, Traceability, Reports + export, Audit Log, Users/Roles/Access, API key & Integration Events, Configuration, sisa Master Data, Dashboard) direalisasikan di kode · pelengkap test-delivery §12**

Versi: 1.0 · 13 Oktober 2026 (rancangan 0.1 → dikonfirmasi 0.2 → diimplementasi 1.0 pada hari yang sama)

> Dokumen ini **tidak** mengulang aturan bisnis. Sumbernya tetap behavioral §5.4/§5.8/§6.5, API §3/§8–§11, configuration §1, auth-session §2–§4, requirements FR-INV-3..5, FR-MD-3/4/7/10/11, FR-CFG-1..3, FR-RPT-1..3, FR-ADM-1..8, UC-05 (AC-05.1–05.4). Isinya: celah yang harus ditutup sebelum coding (**G20–G34**), peta komponen, alur data, keputusan baru (behavioral **D-32..D-38**, implementasi **I-40..I-56**) beserta trade-off, rencana pembuktian, dan urutan pengerjaan.
>
> **Status: M4 selesai (13-10-2026).** Empat keputusan §5.3 yang mengubah perilaku tertulis disetujui pemilik produk sebelum coding; sisanya (D-35..D-38) adalah pengetatan yang menutup celah keamanan/integritas. D-32..D-38 sudah disalin ke behavioral v1.4, API v1.6, handheld v1.3, configuration & auth-session v1.2 (§6). Satu hal yang baru terlihat saat implementasi dicatat sebagai I-56 (§5.2). Bukti di §8.

---

## 1. Kebutuhan & Cakupan

### 1.1 Fungsional (M4) — status: semua ✅ (bukti §8)

| Item | Sumber | Inti | Modal dari M0–M3 |
|---|---|---|---|
| Stock Adjustment (+/−, hitungan fisik) | FR-INV-5, UC-05, behavioral §5.8, API §8.4, handheld §7.8 | Operasi instan `ADJ_GAIN`/`ADJ_LOSS` ke/dari `INV-ADJUST`, reason wajib, tak menyentuh RESERVED | Pola operasi instan QA (M2), optype & lokasi sudah di seed |
| Transit loss + laporan in-transit | behavioral §5.4, API §10, M2 revisit #5 | `ADJ_LOSS` dari `IN-TRANSIT` terikat dispatch; sisa per dispatch | `inTransitOutstanding` (D-21) |
| Handling Units | FR-INV-3, API §8.2 | Daftar + isi nested (pallet → karton → serial), lokasi dari quant | — |
| Traceability lookup & report | FR-INV-4, FR-RPT-3, NFR-CMP-3, API §8.3/§10 | Auto-deteksi Serial/Carton/LPN/Batch; genealogi, posisi kini, asal, tujuan, jejak ledger | `CodeRepository.resolve`, ledger ber-`hu_id`/`serial_id` |
| Stock & Movement report | FR-RPT-1/2 | Snapshot agregat; ledger keyset + filter tanggal (zona waktu gudang) | `idx_move_movedat` |
| Export async csv/xlsx | FR-RPT-1, NFR-PERF-5, API §10 | `report_job` → worker → unduh ber-auth, kedaluwarsa | Tabel `report_job`, kerangka worker |
| Audit Log | FR-ADM-5, API §11.4 | Gabungan `audit_log` + jejak operasi, keyset, read-only | Semua use-case tulis sudah mengisi `audit_log` |
| Users, Roles, Access Control | FR-ADM-1..3, API §11.1–11.3, auth-session §2–3 | CRUD + aksi (lock, reset, cabut sesi, set role), matriks role × menu | `Argon2Hasher`, `revokeAllForUser` |
| API key & Integration Events | FR-ADM-8, API §11.5, M1 revisit #8 | Terbit (mentah sekali) / cabut key; pantau & retry outbox | `authenticateApiKey`, worker outbox |
| App Settings & Operation Types | FR-CFG-1..3, API §9, configuration §1 | PATCH tervalidasi per katalog + audit; kelola optype turunan | `SettingsRepository.all()` |
| Master sisa: Reason Codes, UOM, Sites & Warehouses, Batches | FR-MD-3/4/7/10/11, API §3.2/3.3/3.6/3.7 | CRUD + soft-delete/tolak bila terpakai | Lookup `GET` sudah ada (M1/M2) |
| Dashboard | spesifikasi §9 #1 | KPI operasional minimal (§5.1 D-38b) | — |
| Handheld adjustment | handheld §7.8 | `/hh/adjustment`: scan bin → unit/produk → hitung → reason → tahan-konfirmasi | `ScanField`, `HoldToConfirm`, `/lookup/code` |

Setelah M4 tidak ada lagi halaman placeholder (`[...slug]` hanya menjaga rute tak terdaftar).

### 1.2 Non-fungsional yang mengikat

| NFR | Konsekuensi desain M4 |
|---|---|
| MS-1 / D-2 (quant = ledger) | Adjustment satu-satunya jalur tulis stok baru; memakai protokol A-5 penuh dan menutup suite dengan invarian D-2/D-2b |
| MS-4, NFR-CMP-2, BR-17 | Setiap use-case tulis admin/config/master menulis `audit_log` di ⟦TX⟧ yang sama; diuji per endpoint |
| NFR-SEC (deny-by-default, FR-ADM-4) | Semua endpoint baru lewat `authorize`; matriks RBAC diuji per menu × peran; pengaman admin terakhir (D-35) |
| NFR-PERF-5 | Semua export async; laporan ledger/audit memakai keyset (tanpa `count(*)`) |
| NFR-SEC-7 | Audit & ledger hanya dibaca; tidak ada endpoint ubah/hapus |

### 1.3 Batasan

Tech stack terkunci (ADR); satu dependensi baru yang sudah disebut ADR: `exceljs` di `apps/worker`. **Tanpa perubahan schema & seed** — tetap v1.6 (I-55). Di luar M4: cycle count terjadwal (SC-4), export Audit Log, PDF, notifikasi email job, penyimpanan objek (S3) untuk file export, gateway callback ERP (M5), index tambahan untuk audit operasi (revisit), e-signature (fase 2).

## 2. Celah Desain yang Ditemukan

| # | Celah | Dampak bila dibiarkan | Keputusan |
|---|---|---|---|
| G20 | Body adjustment memakai ID internal & hanya `delta`; handheld §7.8 menyebut "hitungan fisik atau delta" | Operator menghitung selisih sendiri; handheld tak bisa memakai hasil scan | **D-32** |
| G21 | Identitas unit saat adjustment (HU, serial) tak terdefinisi: status HU/serial, `stock_move.hu_id` | HU kosong tetap INTACT; serial hilang tetap ACTIVE; trace putus | **D-32** |
| G22 | Batas `NEGATIVE_STOCK` vs `UNIT_RESERVED` tak presisi | Pesan salah → operator membatalkan operasi yang tak perlu | **D-32** |
| G23 | `ADJ_LOSS` dari IN-TRANSIT tak terhubung ke dispatch; kepemilikan IN-TRANSIT dihitung dari ledger (D-21) | Sisa dispatch tetap tampil & bisa di-receive walau stoknya sudah dihapus → start gagal selamanya | **D-33** |
| G24 | Laporan in-transit tak punya menu RBAC | Endpoint tanpa penjaga yang jelas | **I-44** |
| G25 | "`audit_log` digabung view jejak stok" tak mendefinisikan bentuk, volume, maupun kunci keyset | Satu baris per `stock_move` membanjiri audit (ribuan serial per operasi) | **D-34** |
| G26 | auth-session §3 menjanjikan guard mengecek `app_user.status`; kode hanya memverifikasi JWT | User yang dinonaktifkan tetap bisa bertransaksi sampai access token habis (≤ 15 mnt) | **D-35** |
| G27 | Tak ada pengaman "administrator terakhir"; aksi terhadap diri sendiri tak dibatasi | Instalasi terkunci dari UI admin (pemulihan hanya lewat SQL) | **D-35** |
| G28 | Reset password: siapa yang menentukan password baru tak tertulis; pembuatan service account tak punya endpoint | Admin tak bisa menerbitkan API key tanpa SQL | **D-35** |
| G29 | Aturan "flag dengan data → 409" tak dirinci per flag; format kode tak divalidasi | `ref_no_format` tanpa `{seq}` → nomor dokumen duplikat; flag mati dengan stok aktif | **D-36** |
| G30 | Operation type turunan: beberapa jalur mengikat kode baseline (`OUT_DELIVERY`, `INT_*`, `ADJ_*`); schema tak punya "tipe induk" | Tipe turunan yang dibuat bebas tak bisa dieksekusi atau melompati aturan | **D-37** |
| G31 | Traceability lookup (API §8.3) dan report (API §10) tumpang-tindih; `batch_no` tak unik lintas produk | Dua implementasi berbeda untuk jawaban yang sama | **D-38a** |
| G32 | Export: lokasi file, masa berlaku, hak unduh, konsistensi snapshot, injeksi formula CSV tak ditetapkan | File bocor antar-user; angka tak konsisten; sel berbahaya di Excel | **I-46..I-49** |
| G33 | KPI dashboard belum ditetapkan | Halaman tetap placeholder | **D-38b** |
| G34 | Menu Sites tersembunyi saat `enable_multi_site=false`, padahal `warehouse.timezone` wajib diatur (FR-MD-11) | Zona waktu gudang tunggal hanya bisa diubah lewat SQL | **I-53** |

## 3. Arsitektur (yang dibangun)

```
 Handheld /hh                              Desktop (protected)
  /hh/adjustment (scan bin → unit/produk    Inventory: Handling Units · Traceability · Stock Adjustment
   → hitung/delta → reason → tahan)         Master: UOM · Sites & Warehouses · Batches · Reason Codes
                                            Config: Operation Types · App Settings
                                            Reports: Stock (+tab In-Transit) · Movement · Traceability (+Export)
                                            Admin: Users · Roles · Access · Audit Log · Integration · Dashboard
        └───────────────┬─────────────────────────────┘
                        ▼  apps/web /api/v1 (authed → CSRF → zod → [idempotent(uow)] → use-case)
                        │  /inventory/adjustment[/preview] · /inventory/handling-units[/{code}] · /inventory/trace/*
                        │  /reports/{stock|movement|traceability|in-transit} · /reports/{report}/export · /reports/jobs[/{id}[/download]]
                        │  /admin/{users*,roles*,menus,access/matrix,audit,api-keys*,integration-events*}
                        │  /config/{settings*,operation-types*} · /master/{uom,sites,warehouses,batches,reason-codes}* · /dashboard/summary
                        ▼
  packages/application   adjustment (preview, execute, transit loss) · units · trace · reports (+export job) ·
                         admin-users · admin-access · audit · integration · config · master-extra · dashboard
  packages/domain        adjustmentVerdict (delta/hitung, batas error) · settings (katalog + validasi) ·
                         BASELINE_OPERATION_TYPES · csvCell (anti formula) — semuanya murni
  packages/infrastructure repos/admin (user, role, matriks, api key, outbox) · repos/reporting (stock, movement,
                         trace, in-transit, audit feed, dashboard, report_job) · repos/master-extra · settings.update
  apps/worker            reportJobs: klaim SKIP LOCKED → executeReportJob → FileReportSink (csv / exceljs stream) ;
                         housekeeping: hapus file kedaluwarsa
                        ▼
  PostgreSQL (schema v1.6, tak berubah)
```

## 4. Alur Data Kritis

### 4.1 Stock Adjustment (D-32, ⟦TX⟧ instan ber-`Idempotency-Key`)

```
POST /inventory/adjustment {location_code?, unit_code?, sku?, batch_no?, status?, delta | counted_qty, reason_code, note?, warehouse_id?}
RBAC create pada inventory_adjustment → reason aktif ber-applies_to ADJUST (else 422 MISSING_REASON)
→ sasaran (tanpa lock): unit_code (HU: quant milik HU itu sendiri · serial) ATAU lokasi + SKU (+ batch bila produk ber-batch → MISSING_BATCH)
→ 🔒adv(product) → FOR UPDATE quant pada identitas (lokasi, produk, batch, hu, serial), semua status
→ free     := quant berstatus `status`
   reserved := Σ reservasi ACTIVE pada quant RESERVED identitas itu yang source_status = `status`
   on_hand  := free + reserved;  counted_qty → delta := counted − on_hand;  delta = 0 → 422 NO_CHANGE
→ delta > 0 (ADJ_GAIN): bin fisik usable gudang (INVALID_BIN); serial: on_hand = 0 ∧ delta = 1; HU: harus sudah berisi di lokasi itu
     UPSERT quant += delta; stock_move INV-ADJUST → lokasi (to_status = status, hu = HU, reason); serial → ACTIVE
→ delta < 0 (ADJ_LOSS): |delta| ≤ free → kurangi;  free < |delta| ≤ on_hand → 409 UNIT_RESERVED;  > on_hand → 422 NEGATIVE_STOCK
     stock_move lokasi → INV-ADJUST (from_status = status, hu = HU bila habis utuh — D-30); HU habis → EMPTY (karton lepas dari pallet);
     serial → CONSUMED
→ operation DONE (ADJ-YYYY-nnnnn) + line + outbox ADJUSTMENT_POSTED → 201 {operation, on_hand_before, delta, on_hand_after, moves[]}
POST /inventory/adjustment/preview  — body sama tanpa reason; tanpa lock & tanpa tulis → {target, free, reserved, on_hand, delta, on_hand_after}
GET  /inventory/adjustment          — riwayat = baris ledger optype ber-menu inventory_adjustment (keyset)
```

### 4.2 Transit loss (D-33)

```
POST /inventory/adjustment {dispatch_id, reason_code, [sku, batch_no?, unit_code?, delta<0 | counted_qty]}
🔒 dispatch (INT_INTERSITE, DONE, bukan receive) → sisa := inTransitOutstanding(dispatch)  (D-21)
tanpa sasaran  → hapus SEMUA sisa dispatch (satu operasi, satu line per baris sisa)
dengan sasaran → satu baris sisa (produk, batch, unit); |delta| ≤ sisa baris itu (else 422 NEGATIVE_STOCK)
→ 🔒adv(product) → FOR UPDATE quant di IN-TRANSIT; bagian yang sedang direservasi receive aktif → 409 UNIT_RESERVED
→ ADJ_LOSS DONE dengan parent_operation_id = dispatch, warehouse = gudang tujuan dispatch
   ⇒ rumus D-21 (Σ ke IN-TRANSIT oleh dispatch − Σ dari IN-TRANSIT oleh anak DONE) turun otomatis
```

### 4.3 Laporan & export (I-44..I-49)

```
GET /reports/stock        agregat quant per (produk, gudang, lokasi, batch, status) + roll-up UOM; offset
GET /reports/movement     stock_move DESC (moved_at, id) keyset; from/to = tanggal kalender pada zona waktu gudang (P-7)
GET /reports/in-transit   dispatch DONE ber-sisa > 0: gudang asal/tujuan, umur (hari), baris sisa, receive anak, loss
GET /reports/traceability ?code= | ?batch_id=   → DTO yang sama dengan /inventory/trace/* (D-38a)
POST /reports/{report}/export {params, format} → validasi params + RBAC view menu laporan → report_job QUEUED → 202 {job_id}
worker (tiap 5 dtk): klaim 1 job (UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)) → RUNNING
   → ⟦TX REPEATABLE READ, READ ONLY⟧ authorize ulang pemohon → halaman demi halaman → FileReportSink
   → DONE {file_path, finished_at, expires_at = +24 jam} | FAILED {error}
GET /reports/jobs/{id} → status (+download_url bila DONE & belum kedaluwarsa) — hanya pemohon
GET /reports/jobs/{id}/download → stream file (Content-Disposition) — hanya pemohon; kedaluwarsa → 404
```

### 4.4 Administrasi (D-35)

```
POST /admin/users            username unik (CODE_TAKEN); manusia: password sementara (kebijakan auth §2) + must_change_password;
                             is_service: tanpa password yang bisa dipakai login
POST …/{id}/reset-password   {new_password} → hash baru + must_change_password + cabut semua sesi
POST …/{id}/lock|deactivate  status LOCKED|INACTIVE + cabut semua sesi; terhadap diri sendiri → 409 SELF_ACTION
POST …/{id}/unlock|activate  status ACTIVE, failed_login_count = 0, locked_until = NULL
PUT  …/{id}/roles            ganti daftar role (multi-role)
PUT  /admin/access/matrix    upsert role_menu_access satu role; menu tak dikenal → 400 UNKNOWN_MENU
DELETE /admin/roles/{id}     masih dipakai user → 409 IN_USE
setelah tiap perubahan di atas: bila tak ada lagi user manusia ACTIVE yang punya edit pada admin_users DAN admin_access
                             → ROLLBACK 409 LAST_ADMIN
guard tiap request: role_menu_access hanya dihitung untuk app_user.status = ACTIVE (deny seketika, tanpa cache)
```

## 5. Keputusan Baru

### 5.1 Behavioral (masuk behavioral §2)

| ID | Keputusan | Alasan |
|---|---|---|
| **D-32** | **Adjustment = satu sasaran per request, dipilih lewat kode.** Sasaran: `unit_code` (serial, atau HU = quant milik HU itu sendiri) **atau** `location_code` + `sku` (+ `batch_no` bila batch efektif). Nilai: `delta` bertanda **atau** `counted_qty` (hitungan fisik). *On-hand sasaran* per status = quant berstatus itu + reservasi ACTIVE ber-`source_status` itu (barang ter-reservasi tetap ada di rak). `counted_qty` → `delta = counted − on_hand`, dihitung di bawah lock; selisih 0 → `422 NO_CHANGE`. Loss hanya mengambil bagian bebas: `|delta| ≤ free` sukses; `free < |delta| ≤ on_hand` → `409 UNIT_RESERVED`; `|delta| > on_hand` → `422 NEGATIVE_STOCK`. Gain: bin fisik usable gudang, status = `status` (default AVAILABLE). Identitas unit: gain ke HU → `stock_move.hu_id` = HU (D-19); loss mengikuti D-30 (HU habis utuh → `hu_id` = HU, status `EMPTY`, karton lepas dari pallet; sebagian → `NULL`); serial selalu qty 1: loss → `CONSUMED`, gain hanya untuk serial tanpa stok → `ACTIVE`. Reason wajib ber-`applies_to = ADJUST`. Produk `track_level=ITEM` → qty bulat (`FRACTIONAL_CONTENT`). Outbox `ADJUSTMENT_POSTED` ditulis di ⟦TX⟧ yang sama. | Selector kode sama dengan M2 (I-14) sehingga handheld cukup scan. Hitungan fisik menghilangkan salah hitung selisih; lock menutup celah baca-lalu-tulis. Batas error memberi tahu operator apakah stok kurang atau hanya tertahan operasi lain. |
| **D-33** | **Transit loss terikat dispatch.** `dispatch_id` pada request adjustment memaksa lokasi `IN-TRANSIT`, hanya loss, qty ≤ sisa baris dispatch (D-21); tanpa sasaran = hapus seluruh sisa. Operasi `ADJ_LOSS` menyimpan `parent_operation_id = dispatch` sehingga rumus D-21 menurunkan sisa dispatch secara otomatis. Bagian yang direservasi receive aktif → `409 UNIT_RESERVED`. Adjustment biasa menolak lokasi sistem (`INVALID_BIN`). | IN-TRANSIT global dan quant lepasnya bercampur antar-dispatch; tanpa tautan, sisa "hantu" tetap bisa di-receive. Memakai kolom yang sudah ada (tanpa perubahan schema). |
| **D-34** | **Audit feed = `audit_log` ∪ peristiwa operasi**, bukan baris ledger. Peristiwa operasi diturunkan saat baca: `CREATE` (`created_by/at`), `APPROVE` (`approved_by/at`), `CANCEL` (`cancelled_by/at`), `CONFIRM` (`confirmed_at`, pelaku = `stock_move.user_id`, ringkasan jumlah baris & qty). Kunci keyset `(at, key)` dengan `key = sumber:id[:aksi]`. Rincian per unit = Movement report (tautan dari baris). | Menjawab "siapa, apa, kapan" tanpa membanjiri audit dengan ribuan baris serial; ledger tetap satu-satunya sumber rincian stok. |
| **D-35** | **Pengaman administrasi.** (a) Hak akses hanya dihitung untuk user `ACTIVE` — lock/deactivate berlaku pada request berikutnya, selain mencabut semua refresh token. (b) *Administrator terakhir*: perubahan apa pun (status user, role user, matriks, hapus role) yang menyisakan nol user manusia ACTIVE ber-hak edit `admin_users` **dan** `admin_access` ditolak `409 LAST_ADMIN`. (c) Lock/deactivate terhadap diri sendiri → `409 SELF_ACTION`. (d) Reset password: admin mengisi password sementara (kebijakan auth §2), `must_change_password = true`, semua sesi dicabut. (e) Service account dibuat lewat `POST /admin/users {is_service: true}`; API key hanya untuk user `is_service` ACTIVE; nilai mentah (`wms_…`) ditampilkan sekali, disimpan SHA-256. (f) `role.code` tak bisa diubah setelah dibuat. | Merealisasikan auth-session §3–4 dan mencegah instalasi terkunci dari UI. |
| **D-36** | **Validasi setting = katalog bertipe** (configuration §1) sebagai fungsi murni: boolean, enum (`fefo_policy`, `label_dpi`), integer berentang, URL kosong/http(s), pola kode. `ref_no_format` wajib memuat `{TYPE}`, `{YYYY}`, `{seq}`; `lpn_code_format`/`serial_code_format` wajib `{seq}` dan tak boleh saling identik. Mematikan flag yang datanya masih ada → `409 LOCKED_AFTER_STOCK`: `enable_batch` (quant ber-batch), `enable_serial` (quant ber-serial), `enable_lpn` (pallet INTACT), `enable_quarantine` (quant QUARANTINE), `enable_multi_site` (> 1 site atau stok di IN-TRANSIT). Dependensi: `qa_on_receipt=true` butuh `enable_quarantine`; mematikan `enable_quarantine` butuh `qa_on_receipt=false` (`422 SETTING_DEPENDENCY`). Key di luar katalog → `404`. | Satu sumber aturan untuk API, UI (jenis kontrol), dan tes. Pola tanpa `{seq}`/`{YYYY}` menghasilkan kode duplikat karena counter di-scope per tahun. |
| **D-37** | **Operation type turunan = salinan tipe baseline yang jalurnya menerima `operation_type_code`**: keluarga receipt (`menu_code = inbound_receipts`) dan scrap/issue (`outbound_scrap`). `POST /config/operation-types {code, name, template_code, require_reason?, require_approval?}` menyalin direction, lokasi default, status, dan menu dari template. Yang bisa diubah: `name`, `require_reason`, `is_active`; `require_approval` hanya keluarga scrap/issue (otomatis `approve_menu_code = outbound_scrap_approval`); `allowed_from_status` hanya sebelum dipakai transaksi. Tipe baseline (15 kode seed) tak bisa dihapus, hanya dinonaktifkan; turunan: terpakai → nonaktif, belum terpakai → hapus. | Tipe lain terikat kode di use-case (pick list, transfer, QA, carton break, adjustment); membuat turunannya tanpa "tipe induk" di schema menghasilkan tipe yang tak bisa dieksekusi. |
| **D-38** | **(a) Satu mesin trace untuk lookup & report.** `GET /inventory/trace/{code}` (menu `inventory_trace`) dan `GET /reports/traceability?code=` (menu `reports_traceability`) memanggil use-case yang sama. Deteksi: serial → HU → `batch_no` (cocok > 1 produk → `matches[]` untuk dipilih). Isi: identitas + genealogi (serial → karton asal → pallet), posisi kini (quant), asal (move dari endpoint + PO/partner), tujuan (move ke endpoint + SO/customer), dan jejak ledger kronologis (maks 200; lengkapnya lewat export). **(b) Dashboard** = hitungan operasional gudang default user: tugas terbuka per modul, menunggu approval, SKU per status stok, batch kedaluwarsa / ≤ 30 hari, dispatch in-transit ber-sisa, order terbuka, dan (bagi pemegang `admin_integration`) outbox PENDING/FAILED/DEAD. | Satu jawaban untuk satu pertanyaan (NFR-CMP-3). KPI dipilih dari data yang sudah ada, tanpa tabel agregat. |

### 5.2 Implementasi

| # | Keputusan | Alasan | Trade-off / biaya |
|---|---|---|---|
| I-40 | `executeAdjustment` memakai ulang `takeQuant`/`putQuant`/`insertMoves`/`huTotals`; batas error & delta dihitung fungsi murni `adjustmentVerdict` (domain) | Aturan D-32 diuji tanpa DB | Satu fungsi kecil tambahan di domain |
| I-41 | Preview tanpa lock; eksekusi mode hitung menghitung ulang delta di bawah lock | Preview hanya informasi; kebenaran di ⟦TX⟧ | Angka preview bisa basi sesaat (respons eksekusi memuat `on_hand_before`) |
| I-42 | Gain produk ber-serial tanpa `unit_code` menghasilkan quant lepas (tanpa S/N baru) | Sama dengan carton break tanpa `generate_serials`; penerbitan + cetak label S/N adalah alur receipt (D-14) | Barang temuan ber-serial sebaiknya di-receipt ulang; tercatat di revisit |
| I-43 | Riwayat adjustment = query movement difilter `menu_code = inventory_adjustment` | Tanpa DTO/penyimpanan baru; delta = baris ledger | Tampil per baris ledger, bukan per dokumen |
| I-44 | Laporan in-transit di bawah hak view `reports_stock` (tab di Stock Report); tombol "Catat kehilangan" bagi pemegang create `inventory_adjustment` | Tanpa menu/seed baru (dikonfirmasi §5.3) | Satu page memuat dua laporan |
| I-45 | Keyset cursor = base64url(`moved_at` mikrodetik teks dari PG + `id`); `per_page + 1` untuk mendeteksi halaman berikut | Presisi `timestamptz` > `Date` JS | Cursor buram bagi klien |
| I-46 | Sink file di `apps/worker` (`FileReportSink`: CSV manual + `exceljs` stream); application hanya mengenal port `ReportSink` | Web tak membundel exceljs; boundary ADR-002 terjaga | Worker & web harus berbagi `REPORT_STORAGE_DIR` (host/volume sama) |
| I-47 | Export berjalan dalam ⟦TX⟧ `REPEATABLE READ, READ ONLY` | Halaman-halaman export melihat satu snapshot | Transaksi baca panjang (menahan vacuum) selama export |
| I-48 | Sel CSV/XLSX yang diawali `= + - @` (tab/CR) diberi awalan `'`; qty ditulis sebagai teks desimal | Mencegah injeksi formula dari data master (nama partner, catatan) | Pengguna Excel perlu mengonversi kolom qty bila ingin menjumlah |
| I-49 | File export hanya bisa diunduh pemohon; nama file acak (`job_id`); kedaluwarsa `REPORT_TTL_HOURS` (24) lalu dihapus housekeeping; job `RUNNING` > 30 mnt → `FAILED`; batas `REPORT_MAX_ROWS` (1.000.000; xlsx 500.000) | Laporan memuat data sensitif | Export besar harus dipersempit filternya |
| I-50 | Kunci & hash API key dibuat adapter HTTP (`node:crypto`), use-case menerima `{prefix, hash}` | Application tetap tanpa dependensi kripto | Pembangkitan key tak teruji di lapisan application |
| I-51 | `PUT /admin/access/matrix` = upsert entri yang dikirim; `audit_log` mencatat hanya entri yang berubah | Payload audit ringkas | Menghapus hak = kirim baris all-false |
| I-52 | Retry outbox: `FAILED/DEAD → PENDING`, `attempts = 0`, `next_retry_at = NULL` + audit | Retry manual harus mendapat jatah percobaan penuh | Riwayat jumlah percobaan lama hanya ada di audit |
| I-53 | Endpoint tulis `/master/sites*` & `/master/warehouses*` tunduk flag `enable_multi_site` (404 bila mati), **kecuali** `PATCH /master/warehouses/{id}` (nama, zona waktu) yang cukup hak edit `config_settings` atau `master_sites`; App Settings menampilkan zona waktu gudang | FR-MD-11 harus bisa dipenuhi instalasi satu gudang | Satu endpoint dengan dua pintu RBAC |
| I-54 | Master tanpa kolom soft-delete (UOM, site, warehouse, batch): `DELETE` ditolak `409 IN_USE` bila dirujuk; reason code: terpakai → `is_active=false`, belum → hapus | FK `RESTRICT` adalah jaring terakhir, bukan pesan error | Cek keterpakaian = beberapa `EXISTS` per hapus |
| I-55 | Tanpa perubahan schema & seed; lima reason baru di katalog: `NO_CHANGE`, `LAST_ADMIN`, `SELF_ACTION`, `IN_USE`, `SETTING_DEPENDENCY` | Semua tabel M4 sudah ada sejak v1.5 | Peristiwa operasi di audit feed tanpa index waktu (revisit) |
| I-56 | Transit loss selalu mencatat `stock_move.hu_id` = HU baris sisa, juga saat sebagian | Rumus D-21 mengelompokkan sisa per (produk, batch, hu, serial) — ditemukan saat menulis uji: move ber-`hu_id` NULL tak mengurangi baris ber-HU | Menyimpang dari D-30 khusus di IN-TRANSIT; receive sebagian isi HU (M2) masih punya celah yang sama → revisit #9 |
| I-57 | FK `23503` dipetakan ke `409 IN_USE` di UnitOfWork | Jaring terakhir bila cek keterpakaian (I-54) terlewat oleh rujukan baru | Pesan generik, tanpa nama tabel perujuk |

### 5.3 Keputusan yang mengubah perilaku tertulis (dikonfirmasi 13-10-2026)

| Keputusan | Yang berubah dari dokumen sekarang | Alternatif yang ditolak |
|---|---|---|
| Cakupan | M4 memuat semua sisa menu: Handling Units, UOM, Sites & Warehouses, Batches, Reason Codes, API key + Integration Events, Dashboard KPI minimal | Menunda ke milestone tambahan sebelum onboarding klien |
| D-32 | Body adjustment memakai kode + `delta` **atau** `counted_qty`, ada endpoint preview (API §8.4 hanya mengenal ID + `delta`) | Delta saja |
| D-33 / I-44 | Transit loss wajib menyebut dispatch; laporan in-transit = tab Stock Report (hak `reports_stock`) | Menu baru `reports_in_transit` (ubah seed/katalog/matriks) |
| I-46 | Export CSV + XLSX; `exceljs` di worker; file di direktori lokal | CSV saja (menyimpang dari FR-RPT-1) |
| D-37 | `POST /config/operation-types` memakai `template_code` (API §9.1 menulis `direction` + `menu_code` bebas) | CRUD bebas (tipe tak tereksekusi) |

## 6. Perubahan Kontrak (sudah diterapkan)

| Dokumen | Perubahan |
|---|---|
| Schema / seed | Tidak ada (tetap v1.6); `ddl-validation` tetap 48 skenario |
| Behavioral 1.4 | D-32..D-38; §5.8 ditulis ulang (sasaran, mode hitung, batas error, identitas unit); §5.4 transit loss terikat dispatch; §6.5 `NO_CHANGE`; **CC-13** (dua loss paralel pada quant yang sama → Σ loss ≤ on-hand, tak pernah negatif) |
| API 1.6 | §8.2–8.4 (body & respons baru, preview), §9 (`template_code`, bentuk setting), §10 (query, cursor, `/reports/jobs`, download), §11 (body user/role/key, `LAST_ADMIN`, bentuk audit feed), §3 (CRUD UOM/sites/warehouses/batches/reason codes), `/dashboard/summary`, lima reason baru |
| Handheld 1.3 | §7.8 alur `/hh/adjustment` |
| Configuration 1.2 | Aturan data & dependensi per flag (D-36); env `REPORT_STORAGE_DIR`, `REPORT_TTL_HOURS`, `REPORT_MAX_ROWS` |
| Auth-session 1.2 | §3 guard status tanpa cache; `LAST_ADMIN`/`SELF_ACTION`; reset password oleh admin |
| ERP integration | `ADJUSTMENT_POSTED` selalu ditulis; bentuk payload |
| Test-delivery | CC-13; `scripts/smoke-m4.sh` di runbook |
| CLAUDE.md / README | Status M4, perintah smoke, peta dokumen & kode |

## 7. Skala & Keandalan

- **Adjustment:** satu advisory lock produk + `FOR UPDATE` satu identitas quant; antre hanya dengan operasi lain pada SKU yang sama.
- **Laporan:** movement & audit keyset di atas `idx_move_movedat` / `idx_audit_at`; tanpa `count(*)`. Stock report mengagregasi `quant` (jumlah baris = stok aktif, bukan histori).
- **Export:** worker memproses satu job per tick per proses; multi-worker aman (`SKIP LOCKED`). Kegagalan → `FAILED` + pesan; file parsial dihapus.
- **Audit operasi:** cabang peristiwa operasi memindai `operation` berfilter waktu tanpa index khusus — memadai sampai ± 10⁶ operasi; setelah itu tambah index (revisit #2).
- **Observabilitas:** dashboard menampilkan outbox DEAD & dispatch in-transit tertua; D-2/D-2b dijalankan di akhir suite integrasi & smoke M4.

## 8. Pembuktian (gate)

| Lapisan | Isi | Perintah |
|---|---|---|
| Domain | **101 tes** (+11): `adjustmentVerdict` (delta, hitungan fisik, tiga batas error, qty bulat, serial), katalog setting (20 key, tiap tipe, pola kode, dependensi), 15 optype baseline, `safeCell`/`csvLine` | `pnpm test` |
| Integrasi (PG14 nyata) | **43 skenario M4** (`visibility.int.test.ts`): **AC-05.1–05.3** + preview, mode hitung, `UNIT_RESERVED` (hitungan mencakup reservasi), HU sebagian/utuh/pallet-berisi-karton, serial (CONSUMED/ACTIVE/`DUPLICATE_SERIAL`), batch/bin/status, RBAC & idempotensi, **CC-13**; transit loss (sisa turun, `parent_operation_id`, reservasi receive → `UNIT_RESERVED`, habis → `NO_LINES`); Handling Units; trace serial hasil carton break (genealogi), trace batch dengan tujuan customer dari SO, `matches`; stock report, movement keyset tanpa duplikat + filter tanggal ber-zona-waktu; export csv/xlsx end-to-end lewat `FileReportSinkFactory` (job → file → hak pemohon → kedaluwarsa), job gagal + injeksi formula; users (password sementara, lock/deactivate seketika, `SELF_ACTION`, reset), `LAST_ADMIN` (role, matriks), role & matriks (`UNKNOWN_MENU`, audit hanya yang berubah), API key (terbit → dipakai → cabut), retry outbox; audit feed (dua sumber, keyset, filter); dashboard; settings (validasi, data, dependensi, audit); operation type (turunan dipakai receipt, baseline terlindung); master (reason, UOM, batch, site/gudang + I-53); **matriks RBAC 13 menu M4 × 5 peran**; **D-2 & D-2b** di akhir suite. Suite M0 (14), M1 (24), M2 (22), M3 (31) tetap hijau → total 134 | `pnpm test:integration` |
| HTTP end-to-end | **163 cek** `scripts/smoke-m4.sh`: user baru login + wajib ganti password, `LAST_ADMIN`/`SELF_ACTION`, matriks, service account + API key (pakai → cabut → 401), setting (validasi, audit, dependensi, zona waktu gudang), optype turunan dipakai receipt, master, adjustment (Idempotency-Key wajib, preview, gain, loss, hitung, batch, LPN → EMPTY), HU, trace, laporan + keyset, **export csv/xlsx diselesaikan worker lalu diunduh** (hanya pemohon), transit loss (dispatch → loss sebagian → hapus sisa → `NO_LINES`), audit feed, retry outbox, dashboard, **access token lama ditolak seketika saat user dikunci**, 23 halaman ber-guard, D-2. Smoke M0 (31), M1 (48), M2 (63), M3 (81) tetap hijau | `bash scripts/smoke-m4.sh` (DB segar + worker; `PSQL=…` untuk DB selain compose) |
| Gate statis | format, lint, type-check, build (40 berkas route API baru + 3 diperluas; 19 halaman: 18 baru + Dashboard) | `pnpm format:check` · `pnpm lint` · `pnpm type-check` · `pnpm build` |

Tampilan halaman diverifikasi lewat HTTP 200 (SSR) + build + pemeriksaan kelengkapan kunci i18n, **belum** lewat uji visual/e2e browser (Playwright = gate rilis, test-delivery §11). Use-case admin/config/master diuji di lapisan integrasi (bukan unit ber-fake).

## 9. Urutan Pengerjaan (semua irisan selesai)

| # | Irisan | Menutup |
|---|---|---|
| 1 | Fondasi: kontrak, port, fungsi domain, guard status user | D-35a, D-36, I-55 |
| 2 | Adjustment + transit loss + laporan in-transit | FR-INV-5, UC-05, D-32, D-33, CC-13 |
| 3 | Handling Units, Traceability, Stock/Movement report, export + worker | FR-INV-3/4, FR-RPT-1..3, D-38a, I-45..I-49 |
| 4 | Admin: users, roles, matriks, audit, API key, integration events | FR-ADM-1..3/5/8, D-34, D-35 |
| 5 | Config (settings, operation types) + master sisa | FR-CFG-1..3, FR-MD-3/4/7/10/11, D-36, D-37 |
| 6 | Dashboard, halaman desktop & handheld, i18n | D-38b, handheld §7.8 |
| 7 | Uji integrasi, `smoke-m4.sh`, sinkron dokumen | §6, §8 |

## 10. Revisit Saat Sistem Tumbuh

1. **Gain ber-serial dengan penerbitan S/N + label** (I-42).
2. **Index waktu pada `operation`** (`created_at`, `confirmed_at`) untuk audit feed (I-55).
3. **Export Audit Log** & notifikasi (email/push) saat job selesai.
4. **Penyimpanan objek** untuk file export bila web & worker tak berbagi disk (I-46).
5. **Cycle count terjadwal** (SC-4) di atas mode hitung D-32: dokumen hitung multi-baris + approval selisih.
6. **Approval adjustment** di atas ambang nilai/qty.
7. **Operation type turunan untuk transfer/QA** — butuh kolom "tipe induk" (D-37).
8. **Riwayat `parent_hu_id`** agar trace pallet memuat karton yang sudah dilepas, dan jejak HU yang memuat pengambilan sebagian (move ber-`hu_id` NULL per D-30 kini hanya tampak di trace batch / Movement) (D-38a).
9. **Kunci D-21 untuk pengambilan sebagian isi HU di IN-TRANSIT** — receive parsial sebuah HU (M2) mencatat `hu_id` NULL sehingga baris ber-HU tak berkurang (I-56 hanya menutup jalur transit loss).
10. **Urutan dalam satu ⟦TX⟧** — baris ledger satu operasi ber-`moved_at` sama; urutan antar-baris di trace mengikuti `id` (acak). Tambah nomor urut bila kronologi intra-operasi dibutuhkan.
11. **UOM seed bisa dihapus selama belum dipakai** — instalasi baru sebaiknya membuat produk sebelum merapikan UOM; pertimbangkan flag "sistem" bila sering terjadi.

---

## Ringkasan Keputusan (M4)

1. Adjustment = operasi instan satu sasaran yang dipilih lewat kode; menerima `delta` atau hitungan fisik; loss hanya mengambil stok bebas dengan batas error `UNIT_RESERVED`/`NEGATIVE_STOCK` yang presisi; identitas unit mengikuti D-19/D-30 (D-32).
2. Transit loss terikat dispatch lewat `parent_operation_id`, sehingga sisa in-transit (D-21) turun otomatis; laporan in-transit berada di Stock Report (D-33, I-44).
3. Audit feed = `audit_log` ∪ peristiwa operasi turunan, keyset; rincian stok tetap di ledger (D-34).
4. Hak akses hanya untuk user ACTIVE (deny seketika); pengaman administrator terakhir & aksi-diri; reset password oleh admin; service account + API key mentah-sekali (D-35).
5. Setting divalidasi katalog bertipe; flag tak bisa dimatikan selama datanya ada; pola kode wajib memuat placeholder pembeda (D-36).
6. Operation type turunan hanya dari keluarga receipt & scrap/issue via `template_code`; tipe baseline tak bisa dihapus (D-37).
7. Satu mesin trace untuk lookup & report; dashboard = hitungan operasional tanpa tabel agregat (D-38).
8. Export async lewat `report_job` → worker → file lokal ber-TTL, hanya pemohon yang mengunduh; snapshot `REPEATABLE READ`; sel diamankan dari injeksi formula (I-46..I-49).
9. Tanpa perubahan schema & seed; lima reason baru di katalog (I-55).
10. Bukti: 101 tes domain, 43 uji integrasi M4 (AC-05.1–05.3, CC-13, matriks RBAC menu M4, D-2/D-2b; M0–M3 tetap hijau → 134), smoke HTTP 163 cek termasuk export lewat worker; gate format, lint, type-check, build hijau.
