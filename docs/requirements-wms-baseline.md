# Requirements & Non-Functional Specification — WMS Baseline

**Dokumen requirements · pelengkap Spesifikasi Sistem WMS Baseline v1.3**

Versi: 1.1 · 24 September 2026 · Pembaruan: sinkronisasi hasil audit desain (menuAccess, approval via menu + anti self-approval, adjustment/QA sebagai operasi, FEFO ack, OQ-6 direvisi ke override per-submenu, BR-18..BR-24, AC tambahan).

---

## Cara memakai dokumen ini

Dokumen ini adalah **sumber kebenaran requirement** — menjawab *untuk siapa*, *apa yang harus bisa dilakukan*, dan *sekencang apa* sistem harus berjalan. Dokumen desain lain divalidasi terhadap dokumen ini:

- **Spesifikasi Sistem** (`spesifikasi-wms-baseline.md`) → *bagaimana* requirement dipenuhi secara struktur.
- **Schema** (`schema-wms-baseline.sql`) & **API** (`api-design-wms-baseline.md`) → realisasi teknisnya.

Setiap item diberi **ID stabil** (`FR-*`, `NFR-*`, `BR-*`, `UC-*`, `AS-*`, `OQ-*`) agar bisa dirujuk di test, commit, dan diskusi. **Item bertanda `[TODO]` menunggu keputusan Anda** — nilai di sebelahnya hanya saran awal, bukan keputusan final.

Status requirement: **MUST** (wajib fase 1), **SHOULD** (diharapkan), **COULD** (opsional), **WON'T** (di luar fase 1, dicatat agar tidak lupa).

---

## Daftar Isi

1. [Ringkasan Produk & Tujuan](#1-ringkasan-produk--tujuan)
2. [Glossary (Ubiquitous Language)](#2-glossary-ubiquitous-language)
3. [Aktor & Persona](#3-aktor--persona)
4. [Ruang Lingkup & Fase](#4-ruang-lingkup--fase)
5. [Functional Requirements — Ringkasan per Modul](#5-functional-requirements--ringkasan-per-modul)
6. [Use Case Detail (alur inti)](#6-use-case-detail-alur-inti)
7. [Katalog Business Rule](#7-katalog-business-rule)
8. [Non-Functional Requirements (NFR)](#8-non-functional-requirements-nfr)
9. [Asumsi](#9-asumsi)
10. [Constraint](#10-constraint)
11. [Requirement Traceability Matrix](#11-requirement-traceability-matrix)
12. [Open Questions (butuh keputusan)](#12-open-questions-butuh-keputusan)

---

## 1. Ringkasan Produk & Tujuan

WMS baseline: **satu basis kode**, di-deploy per klien (single-tenant), dikonfigurasi menjadi WMS spesifik industri lewat feature flag + master data. Tujuan requirement fase 1:

- **G-1** — Mengelola siklus stok penuh: inbound (receipt+putaway), internal (transfer, inter-site, carton break, quarantine), outbound (picking, delivery, scrap/issue) dengan traceability utuh.
- **G-2** — Menjaga **integritas stok** di bawah operasi konkuren (tanpa oversell, tanpa double-post).
- **G-3** — Menyediakan **traceability & audit** memadai untuk industri teregulasi (mis. farmasi).
- **G-4** — Dapat dikonfigurasi ke minimal 3 profil industri (farmasi, retail, F&B) **tanpa ubah kode**.
- **G-5** — Operasional lewat **handheld scanner** yang memandu operator langkah demi langkah.

**Metrik sukses (definisi "selesai & benar"):**

| ID | Metrik | Target |
|---|---|---|
| MS-1 | Selisih stok fisik vs sistem setelah UAT | 0 pada skenario uji terkontrol |
| MS-2 | Oversell / double-post pada uji konkurensi | 0 kejadian |
| MS-3 | Instalasi profil baru (farmasi→retail) | tanpa perubahan kode, hanya konfigurasi |
| MS-4 | Jejak audit untuk tiap perubahan stok & config | 100% ter-log |

---

## 2. Glossary (Ubiquitous Language)

Istilah kanonik — dipakai konsisten di kode, UI, dan dokumen. Hindari sinonim.

| Istilah | Definisi |
|---|---|
| **Quant** | Snapshot on-hand: satu baris stok per kombinasi unik (produk, lokasi, status, batch, HU, serial). Sumber kebenaran stok saat ini. |
| **Stock Move** | Baris ledger append-only; catatan historis satu perpindahan stok. Immutable. |
| **Operation** | Dokumen/header satu proses gudang (receipt, transfer, pick, dll.). Punya lifecycle Draft→Ready→In progress→Done/Cancelled. |
| **Operation Type** | Jenis operasi (data, bukan kode) yang terikat 1 dari 3 `direction` (INCOMING/INTERNAL/OUTGOING). |
| **Direction** | Arah efek stok: INCOMING (+), INTERNAL (netral), OUTGOING (−). |
| **UOM** | Unit of Measure (Pcs, Box, Carton, Pallet). |
| **Base UOM** | Satuan terkecil produk tempat semua qty disimpan (quant, ledger, reservation). |
| **Track Level** | Kedalaman traceability produk: `ITEM` (sampai serial item) atau `CARTON`. |
| **HU / Handling Unit** | Wadah fisik ber-identitas: PALLET (LPN) atau CARTON (Carton S/N). |
| **LPN** | License Plate Number — kode unik pallet. |
| **Pack S/N** | Serial number tingkat item (hanya bila `track_level=ITEM`). |
| **Batch / Lot** | Kelompok produksi dengan `batch_no`, `mfg_date`, `expiry_date`. |
| **Putaway** | Pemindahan barang dari dock/staging ke bin penyimpanan. |
| **Picking** | Pengambilan stok untuk memenuhi Sales Order. |
| **Carton Break** | Operasi Internal memecah 1 karton menjadi N item lepas (konversi, bukan pengurangan). |
| **Reservation** | Penguncian stok (AVAILABLE→RESERVED) milik satu operasi, tercatat di `stock_reservation`. |
| **FEFO** | First-Expired-First-Out — saran ambil batch kedaluwarsa terdekat lebih dulu. |
| **Virtual/System Location** | Lokasi non-fisik global (supplier, customer, production, scrap, in-transit, transform) untuk menjaga ledger balance. |
| **Bin** | Lokasi fisik terkecil penyimpanan (mis. A-01-03-02). |
| **Site** | Pabrik/lokasi geografis; menampung banyak warehouse. |
| **Feature Flag** | Setting boolean/kebijakan di `app_setting` yang menyalakan/mematikan fitur per instalasi. |
| **Baseline** | Basis kode generik yang di-install per klien lalu dikonfigurasi. |

---

## 3. Aktor & Persona

| ID | Aktor | Peran & tujuan | Antarmuka utama |
|---|---|---|---|
| AC-1 | **Operator Gudang** | Eksekusi inbound/internal/outbound via scan; ingin panduan langkah jelas & cepat, minim ketik. | Handheld scanner |
| AC-2 | **Supervisor** | Jalankan & pantau semua operasi + laporan; approve bila perlu; tanpa akses config/admin. | Desktop/web |
| AC-3 | **Inventory Controller** | Kelola master data & penyesuaian stok; jaga akurasi. | Desktop/web |
| AC-4 | **Auditor** | Read-only seluruh modul untuk audit/compliance. | Desktop/web |
| AC-5 | **Super Admin** | Akses penuh; konfigurasi instalasi, user, RBAC. | Desktop/web |
| AC-6 | **Sistem ERP** (aktor non-manusia) | Kirim PO & SO ke WMS; terima update status/pengiriman. | API integrasi |
| AC-7 | **Admin Instalasi/Implementor** (internal vendor) | Setup awal per klien: seed, atur flag, isi master data awal. | Skrip + web |

---

## 4. Ruang Lingkup & Fase

### 4.1 In-scope (Fase 1 — MUST)

Semua modul di `spesifikasi-wms-baseline.md` §9: Dashboard, Inbound (PO, Receipt, Putaway), Internal (Transfer, Inter-site, Carton Break, Quarantine), Outbound (SO, Picking, Delivery, Scrap/Issue), Inventory (Stock, HU, Trace, Adjustment), Master Data, Configuration, Reports, Administration (+ Audit Log).

### 4.2 Ditunda (Fase 2 — WON'T fase 1, tercatat)

| ID | Item | Alasan tunda |
|---|---|---|
| SC-1 | **Repack/Consolidate** (item lepas → karton lagi) | Kebalikan carton break; belum prioritas. |
| SC-2 | **Permission aksi khusus** (void, dsb.) via tabel `permission`/`role_permission` | Fase 1: approve scrap = menu `outbound_scrap_approval`, override FEFO = reason wajib. Struktur kompatibel. |
| SC-3 | **Wave picking / batch picking** (gabung banyak SO) | Optimasi lanjutan. |
| SC-4 | **Cycle counting terjadwal** | Adjustment manual cukup untuk fase 1. |
| SC-5 | **Kapasitas bin terukur** (jumlah HU / volume / berat) | OQ-1: fase 1 tidak memvalidasi kapasitas. |
| SC-6 | **Multi-bahasa UI penuh** | [TODO: konfirmasi kebutuhan]. |
| SC-7 | **Serialisasi GS1 (SSCC/GS1) & e-signature** | OQ-4/OQ-8: fase 1 pakai kode internal configurable. |
| SC-8 | **Retur ke supplier** (operation type OUTGOING khusus) | OQ-10: tangani via scrap/adjustment dulu. |
| SC-9 | **Alokasi stok terencana** (booking saat SO masuk) | OQ-11: fase 1 pakai first-start + urut delivery_date. |
| SC-10 | **Handheld offline queue** | OQ-7: fase 1 online-only. |

### 4.3 Out-of-scope (WON'T, bukan tanggung jawab WMS)

- Manajemen pembelian/penjualan (milik ERP) — WMS hanya menerima PO/SO.
- Akunting, harga, pajak, faktur.
- Transport Management (rute pengiriman, ongkir).
- Multi-tenant SaaS (arsitektur single-tenant per deployment, sesuai spec §2).

---

## 5. Functional Requirements — Ringkasan per Modul

Notasi: **M**=MUST, **S**=SHOULD, **C**=COULD.

### 5.1 Autentikasi & Sesi

| ID | Requirement | Prio |
|---|---|---|
| FR-AUTH-1 | User login via username+password; sukses → access token (JWT) + refresh token. | M |
| FR-AUTH-2 | Access token kadaluarsa → tukar via refresh token tanpa login ulang. | M |
| FR-AUTH-3 | Logout mencabut refresh token. | M |
| FR-AUTH-4 | `GET /auth/me` mengembalikan profil + role + **peta akses `menuAccess` (menu.code → CRUD)** ter-filter feature flag; struktur menu ada di katalog FE. | M |
| FR-AUTH-5 | Password disimpan sebagai hash (bcrypt/argon2), tidak pernah plaintext. | M |
| FR-AUTH-6 | Gagal login berturut melebihi ambang → akun `LOCKED`. Ambang = `login_max_failed_attempts` (default 5), kunci `lockout_minutes` (default 15). | S |
| FR-AUTH-7 | Password wajib diganti saat login pertama (akun seed). | S |

### 5.2 Master Data (CRUD + validasi)

| ID | Requirement | Prio |
|---|---|---|
| FR-MD-1 | CRUD Product termasuk flag per-produk & setting `track_level`. `sku` unik. | M |
| FR-MD-2 | CRUD packaging per produk (level_seq unik, qty_in_base>0); konsistensi konversi UOM. | M |
| FR-MD-3 | CRUD UOM. | M |
| FR-MD-4 | CRUD Site & Warehouse (menu muncul bila `enable_multi_site`). | M |
| FR-MD-5 | CRUD Location dengan hierarki `parent_id`; lokasi sistem read-only, tak bisa dihapus. | M |
| FR-MD-6 | CRUD Partner (customer/supplier). | M |
| FR-MD-7 | CRUD Batch (menu muncul bila `enable_batch`); DELETE hanya bila belum dipakai stok. | M |
| FR-MD-8 | Hapus master = soft-delete (status INACTIVE) bila ada histori; hard-delete diblok FK. | M |
| FR-MD-9 | Produk wajib punya packaging base (qty 1); `track_level=ITEM` wajib `qty_in_base` bulat. Flag batch/expiry/serial & `track_level` terkunci setelah ada stok. | M |
| FR-MD-10 | CRUD Reason Code (`applies_to`: SCRAP/ISSUE/ADJUST/QA/FEFO_OVERRIDE). | M |
| FR-MD-11 | Warehouse punya `timezone` (IANA); dasar "hari ini" untuk expiry/ref_no/tugas harian. | M |

### 5.3 Inbound

| ID | Requirement | Prio |
|---|---|---|
| FR-IN-1 | Terima PO dari ERP (idempoten pada `erp_ref`). | M |
| FR-IN-2 | Buat Receipt (dari PO/produksi/retur); sumber = lokasi virtual sesuai operation type. | M |
| FR-IN-3 | Scan produk/S/N/Carton sesuai `track_level`; tolak S/N duplikat. | M |
| FR-IN-4 | Validasi qty terima ≤ qty PO × (1+toleransi) per line (bila dari PO). | M |
| FR-IN-5 | Submit receipt → generate HU/LPN & S/N berstatus PENDING, cetak label (ZPL via print service / PDF); cancel → VOID. | M |
| FR-IN-6 | Putaway: scan LPN → scan bin STOCK; validasi tipe & `is_usable`. (Kapasitas tidak divalidasi fase 1 — OQ-1.) | M |
| FR-IN-7 | Confirm → quant baru (Available atau Quarantine bila `enable_quarantine` + kebijakan QA). | M |
| FR-IN-8 | Barang masuk mewarisi batch/expiry (bila flag aktif). | M |

### 5.4 Internal

| ID | Requirement | Prio |
|---|---|---|
| FR-INT-1 | Bin-to-bin transfer 1 langkah (dalam 1 warehouse); validasi bin ≠ source, tipe & usable (tanpa cek kapasitas fase 1). | M |
| FR-INT-2 | Inter-site transfer 2 langkah via `IN_TRANSIT`; operasi receive menaut dispatch. | M |
| FR-INT-3 | Carton Break (bila `enable_carton_break` & produk `track_level=ITEM`): preview isi → eksekusi. | M |
| FR-INT-4 | Carton Break: karton→BROKEN, lahir N item Available, lineage `origin_hu_id` utuh, ledger via `VIRTUAL_TRANSFORM`. | M |
| FR-INT-5 | Quarantine hold/release/reject & mark damaged (bila `enable_quarantine`) sebagai operasi instan; perubahan status tercatat di ledger. | M |

### 5.5 Outbound

| ID | Requirement | Prio |
|---|---|---|
| FR-OUT-1 | Terima SO dari ERP (idempoten pada `erp_ref`). | M |
| FR-OUT-2 | Generate pick list = operation OUTGOING; saran batch (FEFO bila aktif), lokasi, HU. | M |
| FR-OUT-3 | Start → reserve stok (tulis `stock_reservation`); FEFO/expiry divalidasi ulang. | M |
| FR-OUT-4 | Picking mode: full pallet / full carton / loose item; scan bin+unit sesuai saran. | M |
| FR-OUT-5 | FEFO salah batch → `block` (tolak) atau `warn` (wajib acknowledgement + reason, tercatat per line) sesuai `fefo_policy`. | M |
| FR-OUT-6 | Expiry: tolak expired; tolak bila sisa umur < `partner.min_shelf_life_days` (fallback `default_min_shelf_life_days`). | M |
| FR-OUT-7 | Picking + delivery = satu operasi: scan staging → loading dock → confirm (hak menu Deliveries) → stok ke `VIRTUAL_CUSTOMER`. | M |
| FR-OUT-8 | Partial: hanya unit terpilih keluar; reservasi sisa di-release. | M |
| FR-OUT-9 | Scrap/Issue butuh `reason_code`; butuh approval bila `operation_type.require_approval`; approver = hak edit menu Scrap Approval **dan ≠ pembuat**. | M |
| FR-OUT-10 | Satu SO dapat dipenuhi beberapa operasi (backorder) via `qty_delivered`. | M |
| FR-OUT-11 | Cetak surat jalan/packing list. | S |

### 5.6 Inventory

| ID | Requirement | Prio |
|---|---|---|
| FR-INV-1 | Stock on Hand: quant per produk/lokasi/batch/status + filter. | M |
| FR-INV-2 | Roll-up tampilan multi-level UOM dari base (mis. 250 Pcs → 2 Carton 50 Pcs). | M |
| FR-INV-3 | Handling Units: lihat isi nested (pallet→karton→serial). | M |
| FR-INV-4 | Traceability lookup by Serial/Carton/LPN/Batch (auto-deteksi jenis). | M |
| FR-INV-5 | Stock Adjustment manual (+/−) dengan `reason_code` sebagai operasi instan `ADJ_GAIN`/`ADJ_LOSS` (via lokasi `INVENTORY_ADJUST`); tak boleh menyentuh qty Reserved. | M |

### 5.7 Configuration

| ID | Requirement | Prio |
|---|---|---|
| FR-CFG-1 | CRUD Operation Type; `direction` wajib 1 dari 3 baseline, tak bisa diubah setelah dipakai transaksi. | M |
| FR-CFG-2 | Baca/ubah `app_setting`; perubahan flag berlaku runtime (mempengaruhi menu & validasi). | M |
| FR-CFG-3 | Perubahan setting tercatat di `audit_log` + `updated_by`. | M |

### 5.8 Reports

| ID | Requirement | Prio |
|---|---|---|
| FR-RPT-1 | Stock report (per produk/lokasi/batch/status); export csv/xlsx **async** (job + unduh). | M |
| FR-RPT-2 | Movement/ledger report dari `stock_move` + filter tanggal. | M |
| FR-RPT-3 | Traceability report Pack→Carton→LPN→Customer. | M |

### 5.9 Administration & RBAC

| ID | Requirement | Prio |
|---|---|---|
| FR-ADM-1 | Kelola User (tanpa hard-delete: activate/deactivate); reset password; lock/unlock; set multi-role; cabut sesi. | M |
| FR-ADM-2 | CRUD Role. | M |
| FR-ADM-3 | Kelola matriks RBAC (role × menu × 4 CRUD flag); deny-by-default. | M |
| FR-ADM-4 | **Backend wajib validasi ulang tiap request** terhadap `role_menu_access` (bukan sekadar sembunyikan tombol); endpoint generik operasi dicek terhadap menu milik operation type. | M |
| FR-ADM-5 | Audit Log read-only: gabungan jejak stok + `audit_log` non-stok. | M |
| FR-ADM-6 | Menu induk muncul otomatis bila ≥1 submenu `can_view=true`. | M |
| FR-ADM-7 | Menu ber-flag disembunyikan total bila fiturnya mati. | M |
| FR-ADM-8 | Kelola API key (buat/cabut) & pantau outbox integrasi (retry DEAD). | M |
| FR-OPS-1 | Handheld meng-claim tugas; tugas milik operator lain terkunci; supervisor dapat melepas klaim. | M |

---

## 6. Use Case Detail (alur inti)

Format acceptance criteria: **Given / When / Then** (siap jadi test case). Hanya alur berisiko tinggi yang didetailkan; CRUD standar cukup di §5.

### UC-01 — Receipt dari PO + Putaway (INCOMING)

**Aktor:** Operator · **Prasyarat:** PO sudah masuk dari ERP; operation type INCOMING; flag terkait diketahui.

**Alur utama:**
1. Operator buat Receipt menaut PO.
2. Scan Carton/Pack S/N per unit sesuai `track_level`.
3. Submit → sistem generate LPN (bila `enable_lpn`) → cetak label.
4. Putaway: scan LPN → scan bin STOCK tujuan.
5. Confirm → operasi Done.

**Acceptance criteria:**
- **AC-01.1** — *Given* line PO qty 1000 & toleransi 0%, *When* operator scan total 1001, *Then* sistem tolak `422 BUSINESS_RULE` (over-receipt).
- **AC-01.2** — *Given* S/N "SN-1" sudah terdaftar (di operasi ini atau global, termasuk VOID), *When* discan lagi, *Then* tolak `409 CONFLICT/DUPLICATE_SERIAL`.
- **AC-01.3** — *Given* produk `use_expiry=true`, *When* submit tanpa expiry, *Then* tolak `422`.
- **AC-01.4** — *Given* confirm sukses, *Then* muncul quant baru di bin (status Available atau Quarantine bila QA aktif), stok bertambah, `stock_move` `VIRTUAL_SUPPLIER→bin` tertulis, `purchase_order_line.qty_received` naik.
- **AC-01.5** — *Given* bin tujuan bertipe bukan STOCK atau `is_usable=false`, *When* scan bin, *Then* tolak `422`.
- **AC-01.6** — *Given* confirm gagal di tengah (mis. DB error), *Then* tidak ada quant/ledger sebagian tertulis (rollback penuh).
- **AC-01.7** — *Given* receipt sudah submit (LPN tercetak), *When* dibatalkan, *Then* HU & S/N → VOID, tidak ada quant/ledger, kode tidak diterbitkan ulang.

### UC-02 — Picking dengan Reservasi & FEFO (OUTGOING)

**Aktor:** Operator · **Prasyarat:** SO masuk; pick list ter-generate; `enable_fefo` diketahui.

**Alur utama:**
1. Start (Ready→In progress) → stok di-reserve.
2. Eksekusi per baris: scan bin → scan unit (full/partial/loose).
3. Move ke staging → loading dock → confirm.

**Acceptance criteria:**
- **AC-02.1 (konkurensi)** — *Given* 100 pcs Available & dua operasi start bersamaan masing-masing butuh 70, *When* keduanya reserve, *Then* hanya satu berhasil penuh; sisanya gagal/parsial sesuai stok — **tidak boleh** total reserved > 100.
- **AC-02.2** — *Given* reserve sukses, *Then* quant AVAILABLE dipecah, baris RESERVED lahir, `stock_reservation` tertulis per line (operation_line_id, quant_id, atribut, qty), `sales_order_line.qty_reserved` naik.
- **AC-02.3 (FEFO block)** — *Given* `fefo_policy=block` & operator scan batch lebih baru dari saran, *When* scan, *Then* tolak `422`.
- **AC-02.4 (FEFO warn)** — *Given* `fefo_policy=warn`, *When* scan batch non-saran tanpa reason, *Then* `422 FEFO_ACK_REQUIRED`; *When* dikirim ulang dengan reason FEFO_OVERRIDE, *Then* diterima + reason & pelaku tercatat di line.
- **AC-02.5 (expiry)** — *Given* batch expired, *When* scan, *Then* tolak `422` apa pun `fefo_policy`.
- **AC-02.6 (cancel)** — *Given* operasi In progress lalu cancel, *Then* semua `stock_reservation` operasi itu → RELEASED, qty kembali **persis** ke AVAILABLE, `qty_reserved` turun.
- **AC-02.7 (confirm)** — *Given* confirm delivery, *Then* quant RESERVED dikonsumsi ke `VIRTUAL_CUSTOMER`, `stock_reservation`→CONSUMED, `qty_delivered` naik, `stock_move` `bin→VIRTUAL_CUSTOMER` tertulis.
- **AC-02.8 (partial)** — *Given* butuh 250 tapi hanya 200 dipick, *Then* 200 keluar, reservasi sisa 50 di-release, SO tetap terbuka untuk operasi lanjutan.
- **AC-02.9 (double-confirm)** — *Given* confirm dipanggil dua kali balapan, *Then* panggilan kedua `409 INVALID_TRANSITION`; ledger tidak ganda.
- **AC-02.10 (SKU ganda)** — *Given* SO dengan 2 baris SKU sama dari bin yang sama, *When* start lalu confirm, *Then* 2 reservasi (per line) terbentuk dan confirm sukses tanpa FK error; `qty_delivered` tiap baris SO tepat.
- **AC-02.11 (RBAC optype)** — *Given* user hanya punya edit `inbound_putaway`, *When* `POST /operations/{id}/confirm` pada OUT_DELIVERY, *Then* `403`.
- **AC-02.12 (approval)** — *Given* OUT_SCRAP dibuat user X, *When* X meng-approve, *Then* `403 SELF_APPROVAL`; user Y dengan hak Scrap Approval berhasil.

### UC-03 — Carton Break (INTERNAL)

**Acceptance criteria:**
- **AC-03.1** — *Given* produk `track_level=CARTON`, *When* carton break, *Then* tolak `422` (hanya ITEM).
- **AC-03.2** — *Given* HU bukan CARTON atau status ≠ INTACT, *Then* tolak `422`.
- **AC-03.3** — *Given* karton dengan quant 100 base & Available, *When* eksekusi, *Then* operasi `INT_CARTON_BREAK` DONE, HU→BROKEN, quant karton dikonsumsi, lahir 100 item Available di bin sama, `origin_hu_id` menunjuk karton, total base UOM tetap — walau packaging produk saat ini sudah diubah.
- **AC-03.4** — *Then* ledger = 1 konsumsi (`bin→VIRTUAL_TRANSFORM`) + produksi (`VIRTUAL_TRANSFORM→bin`, satu per serial atau satu baris qty N); tidak ada move `from=to`.
- **AC-03.5** — *Given* `generate_serials=true`, *Then* Pack S/N tergenerate unik (tolak duplikat).

### UC-04 — Inter-Site Transfer (INTERNAL, 2 langkah)

**Acceptance criteria:**
- **AC-04.1** — *Given* dispatch dari Gudang A confirm, *Then* stok pindah ke `IN_TRANSIT` (global), tidak lagi Available di A.
- **AC-04.2** — *Given* barang di IN_TRANSIT, *When* receive di Gudang B confirm, *Then* stok masuk bin B Available; operasi receive menaut dispatch via `parent_operation_id`.
- **AC-04.3** — *Then* batch/expiry/S/N/LPN ikut tanpa berubah; total stok netral.
- **AC-04.4** — *Given* dispatch ke Gudang B, *When* receive dibuat di Gudang C, *Then* `409 WRONG_WAREHOUSE`; *Given* receive parsial, *Then* sisa tetap IN_TRANSIT.

### UC-05 — Stock Adjustment

**Acceptance criteria:**
- **AC-05.1** — *Given* adjustment −5 tanpa `reason_code`, *Then* tolak `422`.
- **AC-05.2** — *Given* adjustment −5 melebihi qty tersedia, *Then* tolak `422`/`409` (tak boleh negatif).
- **AC-05.3** — *Given* adjustment valid, *Then* operasi `ADJ_GAIN`/`ADJ_LOSS` DONE, `stock_move` ke/dari `INVENTORY_ADJUST` dengan pelaku & reason, quant ter-update; invarian quant = ledger tetap terpenuhi.
- **AC-05.4** — *Given* quant di-hold (Quarantine) in-place, *Then* satu `stock_move` bin→bin dengan `from_status=AVAILABLE`, `to_status=QUARANTINE`.

---

## 7. Katalog Business Rule

Aturan domain lintas-fitur, dirujuk oleh use case & test.

| ID | Rule | Ditegakkan di |
|---|---|---|
| BR-1 | Semua qty inventory (quant/move/reservation) dalam **base UOM**. | App + komentar schema |
| BR-2 | Stok berubah **hanya** saat operasi mencapai Done (confirm atomik). | State machine |
| BR-3 | Reservasi terjadi saat Ready→In progress, bukan Done. | State machine |
| BR-4 | `stock_move` & `audit_log` **immutable** (no update/delete). | Trigger DB + revoke |
| BR-5 | Deny-by-default: tak ada baris `role_menu_access` = tak ada akses. | Middleware |
| BR-6 | Carton Break hanya produk `track_level=ITEM` & flag aktif. | App |
| BR-7 | Inter-site (from/to beda warehouse) wajib via IN_TRANSIT 2 langkah. | App |
| BR-8 | FEFO/expiry check saat OUTGOING sesuai flag; FEFO divalidasi ulang saat reserve. | App |
| BR-9 | Over-receipt: qty terima ≤ qty PO × (1+toleransi). | App |
| BR-10 | Setiap `stock_move` harus berpindah lokasi **atau** berpindah status (`from ≠ to` OR `from_status ≠ to_status`). | CHECK DB |
| BR-11 | Quant qty=0 dihapus (bukan disimpan). | App |
| BR-12 | Transisi status ilegal ditolak; transisi ber-lock (anti double-post). | App + FOR UPDATE |
| BR-13 | Lokasi sistem global (warehouse_id NULL, is_system=true). | CHECK DB |
| BR-14 | Sumber kebenaran lokasi = quant; HU.location cache; serial tanpa lokasi. | App |
| BR-15 | Menu ber-flag disembunyikan total bila fitur mati. | App (`/auth/me`) |
| BR-16 | Satu produk = satu `sale_uom`. | App |
| BR-17 | Aksi tulis admin/config wajib menulis `audit_log` di transaksi sama. | App |
| BR-18 | Semua perubahan stok lewat `operation` Done (termasuk adjustment, QA, carton break); `stock_move.operation_id` NOT NULL. | Schema + App |
| BR-19 | Approver ≠ pembuat operasi (segregation of duties). | CHECK DB + App |
| BR-20 | Reservasi per line; Σ(`qty_reserved` + `qty_delivered`) ≤ qty SO line; qty_received ≤ qty PO × (1+toleransi) di bawah lock baris order. | CHECK DB + App |
| BR-21 | Line operasi hanya diedit saat DRAFT; hapus line ber-reservasi ditolak. | App + FK RESTRICT |
| BR-22 | User & master data ber-histori tidak di-hard-delete (soft-delete). | FK RESTRICT |
| BR-23 | Scan & transisi dari handheld wajib `Idempotency-Key`. | App |
| BR-24 | Tanggal (expiry, ref_no tahunan, "hari ini") dievaluasi pada `warehouse.timezone`. | App |

---

## 8. Non-Functional Requirements (NFR)

> **Isi/koreksi nilai `[TODO]`.** Nilai di sebelahnya adalah **saran awal** berbasis WMS gudang tunggal skala menengah — sesuaikan dengan realita klien terbesar Anda.

### 8.1 Skala & Kapasitas

| ID | NFR | Target (saran awal) |
|---|---|---|
| NFR-CAP-1 | Jumlah SKU/produk aktif | 20.000 |
| NFR-CAP-2 | Jumlah lokasi/bin per warehouse | 3.000 |
| NFR-CAP-3 | Site & warehouse per instalasi | ≤3 site, ≤5 warehouse |
| NFR-CAP-4 | User handheld konkuren per gudang | 10 - 20 |
| NFR-CAP-5 | Transaksi (`stock_move` baris) / hari | 35.000 |
| NFR-CAP-6 | Pertumbuhan ledger / tahun | 9.000.000 |
| NFR-CAP-7 | Baris quant aktif | 100.000 |

### 8.2 Performa & Latensi

| ID | NFR | Target (saran awal) |
|---|---|---|
| NFR-PERF-1 | Respons scan handheld (p95) | ≤ 300 ms |
| NFR-PERF-2 | Confirm operasi atomik (p95) | ≤ 1 s |
| NFR-PERF-3 | List/stock query berpaginasi (p95) | ≤ 800 ms |
| NFR-PERF-4 | Generate pick list (p95) | ≤ 2 s |
| NFR-PERF-5 | Report/export besar | async + notifikasi bila > 20 s |
| NFR-PERF-6 | Throughput scan puncak | 10 scan/detik |

### 8.3 Ketersediaan & Keandalan

| ID | NFR | Target (saran awal) |
|---|---|---|
| NFR-AVL-1 | Ketersediaan jam operasional | 99.5% |
| NFR-AVL-2 | Model deployment | Single-tenant; on-prem / VPS / cloud per klien |
| NFR-AVL-3 | Perilaku handheld saat jaringan putus | **Online-only: blok total** (OQ-7). Offline queue = fase 2. |
| NFR-AVL-4 | Konsistensi data | Kuat (ACID, transaksi ber-lock) — bukan eventual |

### 8.4 Backup, Recovery & Retensi

| ID | NFR | Target (saran awal) |
|---|---|---|
| NFR-BKP-1 | RPO (kehilangan data maks) | WAL archiving / PITR |
| NFR-BKP-2 | RTO (waktu pulih) | ≤ 4 jam |
| NFR-BKP-3 | Retensi ledger & audit | farmasi ≥ 5–10 tahun (regulasi); non-farmasi ≥ 2 tahun |
| NFR-BKP-4 | Backup terjadwal + uji restore | harian, uji restore bulanan |

### 8.5 Keamanan

| ID | NFR | Target |
|---|---|---|
| NFR-SEC-1 | Password hash bcrypt/argon2; tak pernah plaintext. | MUST |
| NFR-SEC-2 | Transport TLS. | MUST |
| NFR-SEC-3 | RBAC ditegakkan server-side tiap request. | MUST |
| NFR-SEC-4 | Data sensitif tak masuk URL/query string. | MUST |
| NFR-SEC-5 | Masa hidup access token / refresh | access 15 mnt / refresh 7 hari; dikelola di env (auth-session §1) |
| NFR-SEC-6 | Kebijakan lockout & password | Terkunci di auth-session §2: min 10 char, argon2id/bcrypt-12, lockout 5×/15 mnt |
| NFR-SEC-7 | Audit trail tak bisa dimanipulasi (immutable). | MUST |
| NFR-SEC-8 | Enkripsi at-rest DB | Per kebutuhan klien/regulasi |

### 8.6 Compliance & Auditability

| ID | NFR | Target |
|---|---|---|
| NFR-CMP-1 | Setiap perubahan stok tercatat pelaku+waktu (ledger). | MUST |
| NFR-CMP-2 | Setiap perubahan config/RBAC/user tercatat (`audit_log`). | MUST |
| NFR-CMP-3 | Traceability penuh Pack→Carton→LPN→Batch→Customer. | MUST |
| NFR-CMP-4 | Regulasi: farmasi termasuk target → audit trail ketat, quarantine, expiry/FEFO, serialisasi tersedia fase 1 (flag-gated). GS1 & e-signature = fase 2. | MUST (OQ-8) |

### 8.7 Usability (khusus handheld)

| ID | NFR | Target |
|---|---|---|
| NFR-USE-1 | Alur scan memandu langkah berikut (`next_expected`). | MUST |
| NFR-USE-2 | Input utama = scan; ketik manual minimal. | MUST |
| NFR-USE-3 | Pesan error jelas & actionable di layar kecil. | MUST |
| NFR-USE-4 | Dapat dioperasikan dengan sarung tangan / satu tangan | MUST — target perangkat rugged Android (Handheld PWA §1); target sentuh ≥56px, aksi utama 64px |
| NFR-USE-5 | Aksesibilitas UI | MUST — WCAG 2.1 AA (gate kontras CI per brand); handheld tema high-contrast ≥7:1; status tak hanya warna |

### 8.8 Maintainability & Portability

| ID | NFR | Target |
|---|---|---|
| NFR-MNT-1 | Perbedaan antar-klien lewat config, bukan cabang kode. | MUST |
| NFR-MNT-2 | Migrasi schema **terversi, berurutan, forward-only**; tiap instalasi mencatat versi (`schema_migration`); upgrade saat maintenance. Tool = **drizzle-kit** (ADR-003). | MUST (OQ-9) |
| NFR-MNT-3 | Seed idempoten (aman dijalankan ulang). | MUST (sudah) |
| NFR-MNT-4 | Observability: log terstruktur (pino, ADR-006), health/ready, alert outbox DEAD & integritas D-2. Metrik/tracing (Prometheus) = revisit. | SHOULD |
| NFR-MNT-5 | DB target PostgreSQL 14+. | MUST (sudah) |

---

## 9. Asumsi

| ID | Asumsi |
|---|---|
| AS-1 | PO & SO berasal dari ERP eksternal; WMS tidak membuatnya dari nol. |
| AS-2 | Satu instalasi melayani satu perusahaan (single-tenant), DB terpisah. |
| AS-3 | Operator memakai handheld dengan kamera/laser scanner & koneksi ke server. |
| AS-4 | Label dicetak ke printer Zebra (ZPL) atau setara. |
| AS-5 | Jam operasi gudang [TODO: 1/2/3 shift?] mempengaruhi target availability & window backup. |
| AS-6 | Koneksi jaringan gudang umumnya stabil (LAN/WiFi internal). |
| AS-7 | Konversi UOM per produk bersifat statis (tidak berubah di tengah transaksi). |

---

## 10. Constraint

| ID | Constraint |
|---|---|
| CO-1 | Arsitektur single-tenant per deployment (bukan multi-tenant). |
| CO-2 | Tanpa `tenant_id` di schema. |
| CO-3 | PostgreSQL 14+. |
| CO-4 | Operation type = data (3 direction baseline), bukan kode per proses. |
| CO-5 | Tim & timeline: [TODO: isi ukuran tim & target rilis]. |
| CO-6 | Anggaran infrastruktur per klien: [TODO]. |

---

## 11. Requirement Traceability Matrix

Peta requirement → desain → uji. (Diisi bertahap; contoh baris kunci.)

| FR/UC | Spesifikasi §| Schema (tabel) | API (endpoint) | State machine | Test (AC) |
|---|---|---|---|---|---|
| UC-01 Receipt+Putaway | §10.2 | purchase_order(_line), operation(_line), quant, stock_move, handling_unit | `/inbound/orders`, `/inbound/receipts`, `/operations/{id}/scan\|confirm` | SM#1 | AC-01.1–01.6 |
| UC-02 Picking | §10.7 | sales_order(_line), stock_reservation, quant, stock_move | `/outbound/*`, `/operations/{id}/start\|scan\|confirm\|cancel` | SM#1, SM#2 | AC-02.1–02.9 |
| UC-03 Carton Break | §10.5 | handling_unit, serial, quant, stock_move | `/internal/carton-break*` | SM#2 | AC-03.1–03.5 |
| UC-04 Inter-Site | §10.4 | operation(parent_operation_id), quant, stock_move | `/internal/transfers*` | SM#1 | AC-04.1–04.3 |
| UC-05 Adjustment | §10.9 | operation (ADJ_*), quant, stock_move | `/inventory/adjustment` | SM#1, SM#2 | AC-05.1–05.4 |
| FR-ADM-3/4 RBAC | §7 | role_menu_access, operation_type.*_menu_code | `/admin/access*`, semua request | — | AC-02.11, AC-02.12 + test matriks RBAC optype × aksi (test-delivery §6) |

---

## 12. Keputusan atas Open Questions (RESOLVED)

Semua 11 open question ditutup pada 23 September 2026. Keputusan di bawah bersifat **mengikat** dan sudah dipropagasi ke spec/schema/seed di mana relevan.

| ID | Pertanyaan | **Keputusan** | Dampak / realisasi |
|---|---|---|---|
| OQ-1 | Validasi kapasitas bin | **Tidak divalidasi fase 1** — hanya cek tipe STOCK & `is_usable`. | FR-IN-6/FR-INT-1 disesuaikan; kapasitas terukur = fase 2 (SC-5). |
| OQ-2 | Sumber shelf-life minimum | **Per partner + default global.** `partner.min_shelf_life_days` (nullable); fallback `app_setting.default_min_shelf_life_days`. | FR-OUT-6, AC-02.5; kolom baru di schema + seed setting. |
| OQ-3 | Format `ref_no` | **`{TYPE}-{YYYY}-{seq}`** reset tahunan (mis. RCV-2026-00001). | Digenerate app; pola di `app_setting.ref_no_format`. |
| OQ-4 | Format LPN/S/N | **Prefix + sekuensial ber-padding, configurable** (`lpn_code_format`/`serial_code_format`). GS1 = fase 2 lewat flag bila serialisasi ekspor diperlukan. | FR-IN-5; setting sudah ada di seed. |
| OQ-5 | Integrasi ERP | **ERP push ke WMS (REST) + WMS callback status pengiriman (webhook).** Idempoten pada `erp_ref`; ERP pakai service account/API key. | Seluruh Inbound/Outbound; detail kontrak = Tahap 3. |
| OQ-6 | Granularitas RBAC | **Direvisi 24-09-2026:** grant per-modul **+ override per-submenu** di seed (ERP hanya PO/SO; order manual read-only; Scrap Approval = menu sendiri). Permission granular (void, dsb.) tetap fase 2 (SC-2). | Seed v1.4 §8; schema `operation_type.*_menu_code`. |
| OQ-7 | Handheld offline | **Online-only (blok total saat putus).** Offline queue = fase 2. | NFR-AVL-3. |
| OQ-8 | Target industri | **Keempatnya** (farmasi, retail, F&B, manufaktur). Karena farmasi termasuk, serialisasi + audit ketat + quarantine + FEFO **wajib tersedia fase 1**, tetap flag-gated agar non-farmasi bisa mematikannya. | §4, NFR-CMP; GS1 tetap fase 2. |
| OQ-9 | Migrasi lintas-instalasi | **Migrasi terversi & forward-only + tabel pelacak versi per instalasi.** Tool = **drizzle-kit** (ADR-003). | NFR-MNT-2. |
| OQ-10 | Retur ke supplier | **Tidak dibuat fase 1.** Tangani via Scrap/adjustment; tambah operation type OUTGOING bila diminta klien. | Tanpa perubahan; dicatat sebagai calon fase 2. |
| OQ-11 | Prioritas stok antar-SO | **First-start + urut `delivery_date`.** Reservasi milik operasi yang start lebih dulu; pick list diurutkan tanggal kirim sebagai panduan. Alokasi terencana = fase 2. | FR-OUT-3; tanpa perubahan schema. |

---

## Ringkasan Keputusan yang Terkunci (requirement)

1. Fase 1 = seluruh modul baseline; Repack, permission aksi khusus, wave picking, cycle count = fase 2.
2. Metrik sukses: 0 selisih stok terkontrol, 0 oversell/double-post, ganti profil tanpa kode, 100% audit.
3. Konsistensi data **kuat** (ACID), bukan eventual — tercermin di target NFR.
4. **11 Open Question sudah ditutup** (§12) & **angka NFR §8 terisi**. Sisa keputusan bisnis (non-blocking): enkripsi at-rest (NFR-SEC-8), RPO/retensi (NFR-BKP-1/3), serta info tim/anggaran/shift (§9-10).
5. Glossary §2 adalah bahasa resmi produk — dipakai di kode, UI, dan seluruh dokumen.
6. Integrasi ERP: ERP push (REST) + WMS callback, idempoten `erp_ref`. Handheld online-only. Migrasi schema terversi. Semua industri jadi target (farmasi mendorong compliance fase 1, flag-gated).
