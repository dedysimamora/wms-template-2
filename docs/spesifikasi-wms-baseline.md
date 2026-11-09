# Spesifikasi Sistem WMS Baseline

**Dokumen desain — Warehouse Management System (WMS) generik, single-tenant, multi-industri**

Versi: 1.3 · Disusun: 23 September 2026 · Diperbarui: 24 September 2026 · Pembaruan v1.3: koreksi audit desain — semua perubahan stok lewat operasi (adjustment/QA/carton break), status quant tercatat di ledger, reservasi per line, RBAC per operation type + menu Scrap Approval (anti self-approval), zona waktu per warehouse, klaim tugas, konvensi kode menu.

---

## Daftar Isi

1. [Ringkasan & Prinsip Produk](#1-ringkasan--prinsip-produk)
2. [Arsitektur Deployment](#2-arsitektur-deployment)
3. [Multi-level UOM](#3-multi-level-uom)
4. [Operation Type](#4-operation-type)
5. [Carton Break](#5-carton-break)
6. [Model Data / ERD](#6-model-data--erd)
7. [Access Control (User & RBAC)](#7-access-control-user--rbac)
8. [State Machine Status](#8-state-machine-status)
9. [Daftar Menu / Modul](#9-daftar-menu--modul)
10. [Alur Validasi per Operation Type](#10-alur-validasi-per-operation-type)
11. [Feature Flag & Konfigurasi Instalasi](#11-feature-flag--konfigurasi-instalasi)

---

## 1. Ringkasan & Prinsip Produk

Aplikasi ini adalah **WMS baseline** yang dibangun sekali sebagai satu basis kode, lalu dijual berulang ke banyak klien lintas industri (farmasi, retail, F&B, manufaktur). Inti desainnya bukan membangun fitur khusus satu industri, melainkan membangun **engine WMS generik yang dikonfigurasi menjadi WMS spesifik** lewat setting dan master data saat instalasi.

Prinsip utama:

- **Generic & industry-agnostic** — istilah dan alur tidak mengasumsikan satu industri tertentu. Farmasi hanyalah salah satu use case.
- **Configuration over customization** — perbedaan antar klien diselesaikan lewat konfigurasi (feature flag), bukan mengubah kode. Fitur seperti expiry, FEFO, batch, serialisasi, dan quarantine adalah flag yang bisa dinyalakan/dimatikan.
- **Single-tenant per deployment** — satu instalasi melayani satu perusahaan (lihat Bab 2).
- **Extensible** — 3 baseline operation type berfungsi sebagai template; klien bisa menurunkan operation type sendiri selama tetap mewarisi salah satu dari 3 arah dasar.

---

## 2. Arsitektur Deployment

Aplikasi ini adalah **single-tenant**, bukan multi-tenant SaaS.

- Satu instalasi = satu perusahaan. Aplikasi di-deploy terpisah di server masing-masing klien.
- Jika 5 perusahaan membeli aplikasi ini, ada 5 instalasi independen, masing-masing dengan database sendiri.
- Isolasi data antar perusahaan terjadi di level server/deployment, **bukan** di level aplikasi. Karena itu **tidak ada** entitas `tenant` maupun kolom `tenant_id` di database.
- "Baseline" berarti satu basis kode yang sama, di-install per klien, dan tiap instalasi "menjadi" WMS farmasi / retail / F&B lewat file konfigurasi + master data yang diisi saat setup.

**Konsekuensi penting: seeding awal.** Karena tiap deployment berdiri sendiri, perlu mekanisme *seed* konfigurasi awal (feature flag default, operation type baseline, UOM standar, role & menu, Super Admin) agar instalasi baru tidak mulai dari nol.

---

## 3. Multi-level UOM

Unit of Measure bersifat berjenjang dan **dapat dikonfigurasi per produk**.

Hierarki UOM:

```
Item / Pcs  →  (Inner / Box, opsional)  →  Carton (Kardus)  →  Pallet (LPN)
```

Aturan:

- Setiap produk memiliki setting `track_level` yang menentukan sedalam apa traceability & transaksi berlaku:
  - **`ITEM`** — traceability turun sampai item di dalam kardus (Pack S/N aktif).
  - **`CARTON`** — traceability berhenti di level kardus (tidak ada serialisasi item).
- **Satu produk hanya memiliki satu satuan jual** (`sale_uom`). Tidak ada produk dengan lebih dari satu satuan jual.
- Konversi antar level disimpan di `product_packaging` (mis. 1 karton = 100 item), dipakai untuk menghitung stok lintas level.
- Semua qty disimpan dalam **base UOM** produk; level di atasnya dihitung on-the-fly (roll-up) agar data stok selalu konsisten.
- **Invarian UOM (dikunci):** `quant`, `stock_move`, dan `stock_reservation` **selalu** menyimpan qty dalam base UOM. UOM hasil scan (mis. 1 Carton) hanya hidup di `operation_line` sebagai UOM transaksi, lalu **dikonversi ke base** sebelum menyentuh inventory. Kolom `uom_id` di `stock_move` adalah base UOM produk (denormalisasi baca), bukan UOM saat scan. Ini mencegah roll-up salah hitung.
- Serialisasi (Pack S/N, Carton S/N, LPN) menyesuaikan level yang aktif dan bersifat konfigurabel — klien non-farmasi bisa saja tidak membutuhkan serial per item.

---

## 4. Operation Type

Semua pergerakan stok dikendalikan oleh **Operation Type**, yang merupakan **data** (bukan hardcode). Setiap operation type terikat pada salah satu dari **3 arah baseline** (`direction`):

| Direction | Nama | Contoh Operation Type turunan | Efek Stok |
|---|---|---|---|
| **Incoming** | Barang Masuk | Receipt from Production, Receipt from Supplier (PO), Customer Return | + |
| **Internal** | Transfer Internal | Bin-to-Bin Transfer, Carton Break / Repack, Transfer to Quarantine | netral |
| **Outgoing** | Barang Keluar | Delivery / Customer Shipment (SO), Issue to Production, Scrap / Damage Out | − |

Klien dapat menambah atau menyembunyikan operation type turunan sesuai kebutuhan, selama tiap turunan tetap terikat pada satu `direction`. Arah inilah yang menentukan aturan validasi dan efek stoknya.

**Prinsip desain:** semua proses (putaway, transfer, picking, dsb.) mengikuti pola sama — *validasi header → scan sumber → scan tujuan → confirm → tulis ledger + update stok*. Yang membedakan hanya arah, aturan validasi, dan efek stok. Karena itu operation type cukup jadi data, bukan kode terpisah per proses.

---

## 5. Carton Break

Carton Break adalah kemampuan membuka satu kardus menjadi item-item lepas.

Keputusan desain:

- Diimplementasikan sebagai **operasi mandiri** (bukan otomatis di tengah picking). Petugas gudang memecah kardus kapan saja lewat menu Carton Break, dan item lepas menjadi stok siap pakai.
- Diklasifikasikan sebagai operation type di bawah **Internal** — kuantitas total tidak berubah, hanya representasi UOM-nya (ini konversi, bukan pengurangan stok).
- **Hanya berlaku untuk produk `track_level = ITEM`.** Produk yang berhenti di karton tidak dapat menjalankan operasi ini.

Mekanisme:

1. Scan Carton S/N → karton induk menjadi status **BROKEN**; quant karton (qty = N base) dikonsumsi seluruhnya dan karton tidak bisa dipakai lagi.
2. Tergenerate **item lepas** sebanyak isi karton — **N diambil dari qty quant karton**, bukan dari `product_packaging` saat ini (packaging bisa berubah setelah karton diterima) — mewarisi batch & expiry dari karton induk, di bin yang sama.
3. Setiap item lepas tetap **tertaut ke Carton S/N induk** (`serial.origin_hu_id`) sehingga traceability tidak putus.

**Konvensi ledger (dikunci):** agar tetap seragam *location→location* dan balance, carton break memakai lokasi virtual **`VIRTUAL_TRANSFORM`** (global). Konsumsi karton dicatat `bin → VIRTUAL_TRANSFORM`, dan N item lahir dicatat `VIRTUAL_TRANSFORM → bin` (bin yang sama). Dengan begitu tidak ada `stock_move` yang `from = to`, dan report movement tidak menampilkan pergerakan semu.

Carton break dijalankan sebagai **operasi instan** bertipe `INT_CARTON_BREAK` (create + confirm dalam satu transaksi) sehingga tetap punya `ref_no` dan `stock_move.operation_id` (lihat Behavioral D-7). Konversi bersifat satu arah dalam operasi ini (karton → item). Menggabungkan item lepas kembali menjadi karton adalah operasi "Repack/Consolidate" terpisah (opsional, fase berikutnya).

---

## 6. Model Data / ERD

Dua keputusan desain inti yang menyetir seluruh struktur:

1. **Stok disimpan dalam 2 lapis:**
   - `quant` — snapshot on-hand (kebenaran stok saat ini; di-update/di-delete).
   - `stock_move` — ledger append-only (catatan historis yang tidak pernah diubah; dasar audit & traceability).
   - Semua qty di kedua tabel disimpan dalam **base UOM** produk.
2. **Semua pergerakan adalah location → location**, memakai **virtual location** (supplier, customer, production, scrap, dan `transform` untuk carton break) sehingga incoming, outgoing, dan transformasi tetap "balance" seperti transfer. Ini membuat ledger seragam untuk 3 direction. Lokasi virtual/sistem bersifat **global** (tidak terikat warehouse) agar roll-up antar-site tidak terpecah.
3. **Semua perubahan stok lahir dari `operation` yang Done** — termasuk adjustment (`ADJ_GAIN`/`ADJ_LOSS` via lokasi sistem `INVENTORY_ADJUST`), carton break, dan QA/damaged. Perubahan **status** quant (mis. Available→Quarantine di bin yang sama) juga tercatat di ledger lewat `stock_move.from_status/to_status`.
4. **Satu sumber kebenaran lokasi = `quant`.** `handling_unit.location_id` hanya cache (di-sync dalam transaksi confirm yang sama); `serial` **tidak** menyimpan lokasi sama sekali — posisi item dibaca dari `quant`, riwayatnya dari `stock_move`. Ini menghindari data lokasi yang saling bertentangan.

### 6.1 Modul Product & UOM

**`product`** — `id`, `sku`, `name`, `base_uom_id → uom`, `sale_uom_id → uom` *(satu satuan jual)*, `track_level` *(CARTON | ITEM)*, `use_batch`, `use_expiry`, `use_fefo`, `use_serial`, `use_lpn`, `status`
> Flag efektif = flag global `app_setting.enable_*` AND flag produk (global mati ⇒ mati untuk semua produk). `track_level` menentukan kedalaman serialisasi. Flag batch/expiry/serial & `track_level` terkunci setelah produk punya stok.

**`uom`** — `id`, `name` (Pcs/Box/Carton/Pallet), `category`

**`product_packaging`** (konversi UOM) — `id`, `product_id → product`, `uom_id → uom`, `level_seq` (1=item, 2=inner, 3=carton, 4=pallet), `qty_in_base`
> Menyimpan konversi "1 karton = N item".

### 6.2 Modul Location

Hierarki lokasi berjenjang: **site (pabrik) → warehouse (gudang) → location (zona → rak → bin)**. Satu perusahaan (satu instalasi) dapat memiliki banyak site, dan satu site dapat memiliki banyak gudang. Semua site berada dalam satu database yang sama. Akses user **tidak** dibatasi per site — semua user yang punya akses menu dapat melihat seluruh site (tidak ada scoping `user_site`).

**`site`** (pabrik) — `id`, `code`, `name`, `address`
> Instalasi satu pabrik cukup di-seed dengan satu default site; user tidak merasakan kompleksitas multi-site.

**`warehouse`** — `id`, `site_id → site`, `code`, `name`, `timezone` *(IANA, mis. Asia/Jakarta — dasar "hari ini" untuk expiry, reset ref_no, tugas harian)*

**`location`** — `id`, `warehouse_id → warehouse` *(nullable)*, `code` (mis. A-01-03-02), `parent_id → location` (hierarki zona→rak→bin), `type` *(STOCK, STAGING, DOCK, QUARANTINE, SCRAP, PRODUCTION, IN_TRANSIT, VIRTUAL_SUPPLIER, VIRTUAL_CUSTOMER, VIRTUAL_TRANSFORM, INVENTORY_ADJUST)*, `is_system`, `is_usable`
> Tipe `IN_TRANSIT` dipakai untuk barang yang sedang dalam perjalanan antar site (lihat Bab 10.4). **Lokasi sistem** (`VIRTUAL_*`, `IN_TRANSIT`, `VIRTUAL_TRANSFORM`, `INVENTORY_ADJUST`) bersifat **global**: `is_system=true` & `warehouse_id=NULL`. Kode unik per-warehouse untuk bin fisik, unik global untuk lokasi sistem. Constraint DB menegakkan: `is_system` ⇒ `warehouse_id` NULL, dan sebaliknya.

### 6.3 Modul Batch, Handling Unit & Serial

**`batch`** — `id`, `product_id → product`, `batch_no`, `mfg_date`, `expiry_date`

**`handling_unit`** (LPN pallet & Carton) — `id`, `code` (LPN / Carton S/N), `hu_type` *(PALLET | CARTON)*, `parent_hu_id → handling_unit` (pallet berisi karton), `location_id → location` *(cache posisi, quant tetap otoritatif)*, `status` *(PENDING, INTACT, BROKEN, SHIPPED, EMPTY, VOID)*
> `PENDING` = kode sudah terbit & label tercetak (submit receipt) tapi barang belum Done; `VOID` = operasi asal dibatalkan (kode tidak diterbitkan ulang).

**`serial`** (Pack S/N item) — `id`, `code`, `product_id → product`, `batch_id → batch`, `status` *(PENDING, ACTIVE, CONSUMED, VOID)*, `origin_hu_id → handling_unit` *(carton induk asal — lineage carton break)*
> Hanya dipakai bila `product.track_level = ITEM`. **Tidak** menyimpan `location_id`: posisi item dibaca dari `quant`, riwayat dari `stock_move`.

### 6.4 Modul Inventory (inti)

**`quant`** (snapshot on-hand) — `id`, `product_id`, `location_id`, `batch_id`, `hu_id → handling_unit` (nullable), `serial_id → serial` (nullable), `qty` *(base UOM)*, `status` *(AVAILABLE, RESERVED, QUARANTINE, DAMAGED)*, `version` *(optimistic lock)*
> Satu baris per kombinasi unik. Ini kebenaran stok saat ini. **Baris dengan `qty=0` dihapus** (bukan disimpan) agar unique index tidak dipenuhi baris hantu. Setiap update qty wajib di transaksi ber-lock (`SELECT … FOR UPDATE`) atau cek `version` untuk mencegah oversell.

**`stock_move`** (ledger, append-only) — `id`, `operation_id → operation` *(NOT NULL)*, `product_id`, `batch_id`, `hu_id`, `serial_id`, `from_location_id`, `to_location_id` *(keduanya NOT NULL)*, `from_status`, `to_status`, `qty` *(base UOM)*, `uom_id` *(= base UOM produk)*, `reason_code_id`, `user_id → app_user`, `moved_at`
> Immutable — ditegakkan trigger DB (`forbid_mutation`) + `REVOKE UPDATE/DELETE`; semua FK dari tabel ini `ON DELETE RESTRICT` (user/master di-soft-delete). Semua transaksi (receipt, transfer, carton break, QA, adjustment, delivery) menulis di sini. `CHECK (from ≠ to OR from_status ≠ to_status)` mencegah move semu tetapi mengizinkan perubahan status di bin yang sama.

**`stock_reservation`** (jejak kepemilikan reservasi) — `id`, `operation_id → operation`, `operation_line_id` *(NOT NULL)*, `quant_id → quant` *(nullable, ON DELETE SET NULL)*, `product_id`, `location_id`, `batch_id`, `hu_id`, `serial_id`, `source_status`, `qty` *(base UOM)*, `status` *(ACTIVE | RELEASED | CONSUMED)*
> Menjawab "quant RESERVED ini milik operasi/line mana & berapa". Unik per `(operation_line_id, quant_id)` selagi ACTIVE — dua line ber-SKU sama boleh berbagi pool RESERVED. Atribut quant disalin sehingga release tetap presisi walau baris quant RESERVED sudah terhapus (qty 0). Dibuat saat Ready→In progress; RELEASED saat cancel/penutupan line parsial (qty kembali ke `source_status`); CONSUMED saat Done.

### 6.5 Modul Operation

**`operation_type`** — `id`, `code`, `name`, `direction` *(INCOMING | INTERNAL | OUTGOING)*, `default_src_location_id`, `default_dest_location_id`, `require_approval`, `require_reason`, `allowed_from_status[]`, `to_status`, `menu_code`, `confirm_menu_code`, `approve_menu_code`, `is_active`
> `*_menu_code` = pemetaan RBAC endpoint generik `/operations/{id}/*`: aksi dicek terhadap menu milik optype, bukan route request (API §1.4). `require_approval` adalah satu-satunya sumber kebenaran "butuh approval".

**`operation`** (dokumen/header) — `id`, `operation_type_id → operation_type`, `ref_no`, `status` *(DRAFT, READY, IN_PROGRESS, DONE, CANCELLED)*, `warehouse_id`, `source_doc_type` + `source_doc_id` (polimorfik: SO/PO), `dest_warehouse_id` *(inter-site)*, `parent_operation_id → operation` *(receive inter-site menunjuk dispatch)*, `reason_code_id`, `created_by → app_user`, `assigned_to` *(klaim tugas handheld)*, `approved_by` *(≠ created_by)*, `approved_at`, `started_at`, `submitted_at`, `confirmed_at`, `cancelled_at`, `cancelled_by`, `version` *(optimistic lock)*
> Transisi status meng-lock baris ini (`SELECT … FOR UPDATE`) & cek status di dalam transaksi → mencegah double-confirm/double-start. `ref_no` di-generate mengikuti `app_setting.ref_no_format` = `{TYPE}-{YYYY}-{seq}` (sekuens reset per tahun, mis. `RCV-2026-00001`).

**`operation_line`** — `id`, `operation_id → operation`, `product_id`, `batch_id`, `hu_id`, `serial_id`, `qty` + `uom_id` *(UOM transaksi)*, `qty_base`, `qty_done_base` *(base UOM)*, `from_location_id`, `to_location_id`, `so_line_id` / `po_line_id` *(tautan ke baris order)*, `fefo_override_reason_id`, `fefo_override_by`, `status`
> Line diedit hanya saat DRAFT. Tautan `so_line_id`/`po_line_id` membuat update `qty_reserved`/`qty_delivered`/`qty_received` presisi per baris order (termasuk SO dengan dua baris ber-SKU sama).

**`reason_code`** — `id`, `code`, `name`, `applies_to` *(SCRAP | ISSUE | ADJUST | QA | FEFO_OVERRIDE)*, `is_active`

### 6.6 Modul Orders (integrasi ERP)

**`partner`** — `id`, `code`, `name`, `type` *(CUSTOMER | SUPPLIER)*, `min_shelf_life_days` *(nullable — sisa umur simpan minimum saat kirim ke customer; NULL = pakai `default_min_shelf_life_days`)*

**`purchase_order`** — `id`, `erp_ref`, `partner_id → partner` *(supplier)*, `order_date`, `expected_date`, `status` *(OPEN | PARTIAL | CLOSED | CANCELLED)*

**`purchase_order_line`** — `id`, `po_id → purchase_order`, `line_no`, `product_id`, `qty` *(base UOM)*, `qty_received` *(akumulasi terima, base UOM)*, `erp_qty` + `erp_uom_id` *(angka asli ERP, untuk callback)*
> Acuan validasi INCOMING: `qty_received + qty_terima ≤ qty × (1 + toleransi)`. Receipt = `operation` INCOMING dengan `source_doc_type='PURCHASE_ORDER'`, `source_doc_id = po.id`.

**`sales_order`** — `id`, `erp_ref`, `partner_id → partner`, `delivery_date`, `status` *(RECEIVED | PROCESSING | PARTIAL | DONE | CANCELLED)*

**`sales_order_line`** — `id`, `so_id → sales_order`, `line_no`, `product_id`, `qty` *(base UOM)*, `qty_reserved`, `qty_delivered`, `erp_qty` + `erp_uom_id` · `CHECK (qty_reserved + qty_delivered ≤ qty)`
> Pick List = `operation` bertipe OUTGOING yang di-generate dari SO (`source_doc_type='SALES_ORDER'`, `source_doc_id = so.id`), bukan tabel terpisah. `qty_reserved`/`qty_delivered` memungkinkan satu SO dipenuhi beberapa operasi (pemenuhan bertahap) meski tiap operasi tetap atomik.

---

## 7. Access Control (User & RBAC)

### 7.1 Tabel

**`app_user`** — `id`, `username`, `email`, `password_hash`, `full_name`, `status` *(ACTIVE | INACTIVE | LOCKED)*, `default_warehouse_id`, kolom auth (auth-session), `last_login_at`
> Password disimpan sebagai hash (argon2id; bcrypt seed di-rehash), bukan plaintext. User **tidak pernah di-hard-delete** (dirujuk ledger immutable) — dinonaktifkan (`INACTIVE`).

**`role`** — `id`, `code` (ADMIN, SUPERVISOR, dll.), `name`, `description`

**`user_role`** (junction many-to-many) — `id`, `user_id → app_user`, `role_id → role`
> Satu user boleh memiliki lebih dari satu role.

**`menu`** (modul/page) — `id`, `code`, `name`, `route` (path halaman), `parent_id → menu` (hierarki menu & submenu), `icon`, `sort_order`, `is_active`
> Registri kode untuk RBAC. Konvensi: `code` = route tanpa `/` awal, `/` dan `-` → `_` (mis. `/internal/carton-break` → `internal_carton_break`). Struktur tampilan otoritatif di katalog FE (frontend §5); CI memverifikasi keduanya sama.

**`role_menu_access`** (matriks RBAC) — `id`, `role_id → role`, `menu_id → menu`, `can_view`, `can_create`, `can_edit`, `can_delete`
> Inti RBAC: per kombinasi role × menu terdapat 4 flag CRUD.

### 7.2 Keputusan yang dikunci

- **User boleh multi-role** — via `user_role`.
- **Permission = 4 CRUD flag** (`can_view/create/edit/delete`) untuk baseline fase 1. **Approve scrap** di fase 1 dimodelkan sebagai **menu terpisah** `outbound_scrap_approval` (hak `edit`) + aturan approver ≠ pembuat (CHECK DB) — segregation of duties tanpa tabel baru. Override FEFO memakai reason wajib (tercatat per line). Permission granular lain (void transaksi, dsb.) tetap fase 2 lewat tabel `permission` + `role_permission`.
- **Endpoint generik operasi** dicek terhadap menu milik **operation type** (`menu_code`/`confirm_menu_code`/`approve_menu_code`), bukan route request — mencegah user modul A mengeksekusi operasi modul B.
- **Deny by default** — tidak ada baris `role_menu_access` = tidak ada akses.
- **Seed Super Admin** dengan akses penuh disiapkan saat instalasi awal agar tidak terkunci.

### 7.3 Catatan implementasi

- Permission dicek di **2 lapis**: `can_view` mengontrol tampilnya menu & terbukanya halaman; `can_create/edit/delete` mengontrol tombol aksi. **Backend wajib memvalidasi ulang tiap request** — jangan hanya menyembunyikan tombol di frontend.
- `menu.parent_id` membentuk hierarki. Kontrol akses ada di level submenu (yang punya `route`); menu induk hanya wadah tampilan dan otomatis muncul bila minimal satu submenunya `can_view = true`.

### 7.4 Jejak audit

- **Jejak stok:** `stock_move.user_id` (+ `from_status/to_status`, `reason_code_id`) dan `operation.created_by`/`approved_by`/`cancelled_by` mencatat pelaku tiap transaksi.
- **Jejak non-stok (`audit_log`):** aksi admin/config — buat/ubah/hapus user, role, matriks RBAC (`role_menu_access`), dan `app_setting` — dicatat di tabel `audit_log` (`user_id`, `entity`, `entity_id`, `action`, `before`/`after` JSONB, `ip_address`, `at`), append-only. `app_setting.updated_by` mencatat pengubah terakhir tiap flag. Ini menutup celah compliance: perubahan kebijakan (mis. mematikan `enable_quarantine`) kini punya jejak "siapa & kapan".

**`audit_log`** — `id`, `user_id → app_user`, `entity`, `entity_id`, `action`, `before` (JSONB), `after` (JSONB), `ip_address`, `at`
> Immutable (trigger `forbid_mutation`). Sumber utama menu Audit Log.

---

## 8. State Machine Status

State machine adalah aturan resmi tentang status apa saja yang boleh ada dan perpindahan mana yang diizinkan. Fungsinya sebagai pagar pengaman konsistensi data: mencegah stok dikirim sebelum di-reserve, mencegah dua order merebut stok yang sama, mengunci dokumen yang sudah selesai, dan menentukan kapan tepatnya stok berubah.

### 8.1 SM#1 — Status Operasi

Status: **Draft → Ready → In progress → Done**, + **Cancelled**. (Tanpa Partially done — operasi harus selesai penuh.)

> **Atomik & anti double-submit.** Setiap transisi meng-lock baris `operation` (`SELECT … FOR UPDATE`) lalu memeriksa status saat itu di dalam transaksi. `confirm`/`start` yang dipanggil dua kali cepat → panggilan kedua melihat status sudah berubah dan ditolak `409 INVALID_TRANSITION`. Kolom `version` memberi optimistic lock tambahan.
>
> **"Tanpa partially done" ≠ tanpa pemenuhan bertahap.** Satu *operasi* memang selesai penuh atau tidak sama sekali; tetapi satu *SO/PO* boleh dipenuhi **beberapa operasi** (backorder) — dilacak lewat `sales_order_line.qty_delivered` / `purchase_order_line.qty_received`, bukan lewat status "partial" pada operasi.

| Dari | Ke | Pemicu | Efek |
|---|---|---|---|
| Draft | Ready | Data operasi divalidasi lengkap | stok belum berubah |
| Draft | Cancelled | Dibatalkan | — |
| Ready | In progress | Operator mulai mengerjakan | stok terkait di-**reserve** |
| Ready | Cancelled | Dibatalkan | reservasi dilepas |
| In progress | Done | Semua langkah scan selesai & confirm | **ledger ditulis, stok berubah** |
| In progress | Cancelled | Dibatalkan di tengah | reservasi dilepas, stok dikembalikan |
| Done | *(terminal)* | — | terkunci, tidak bisa diedit |
| Cancelled | *(terminal)* | — | — |

Opsional: `Ready → Draft` (buka kembali untuk edit) bila diinginkan.

### 8.2 SM#2 — Status Stok (quant)

Status: **Available, Reserved, Quarantine, Damaged**. (Quarantine adalah status opsional lewat feature flag.)

| Dari | Ke | Pemicu (operation type) |
|---|---|---|
| *(barang masuk)* | Available **atau** Quarantine | Receipt `RCV_*` — Quarantine bila `qa_on_receipt` |
| *(barang masuk)* | Available | Adjustment gain `ADJ_GAIN` |
| Available (/Damaged/Quarantine untuk scrap) | Reserved | `start` operasi OUTGOING/INTERNAL (reserve) |
| Reserved | status asal | Cancel / penutupan line parsial / swap batch (release) |
| Available | Quarantine | `INT_QA_HOLD` |
| Quarantine | Available | `INT_QA_RELEASE` (lolos QA) |
| Quarantine | Damaged | `INT_QA_REJECT` (gagal QA) |
| Available | Damaged | `INT_MARK_DAMAGED` (ditemukan rusak) |
| Reserved | *(keluar/habis)* | `OUT_DELIVERY` / `OUT_SCRAP` / `OUT_ISSUE_PROD` Done — quant dikonsumsi |
| Available / Quarantine / Damaged | *(keluar/habis)* | Adjustment loss `ADJ_LOSS` |

Setiap baris di atas menghasilkan `stock_move` dengan `from_status`/`to_status` (perubahan status di bin sama = satu baris ledger).

### 8.3 Dua hubungan penting

1. **Reservasi terjadi saat operasi Ready → In progress, bukan saat Done.** Stok "dikunci" (Reserved) begitu picking dimulai, mencegah order lain merebutnya. Stok baru benar-benar keluar saat operasi mencapai Done. Mekanisme: quant sumber dipecah — sebagian menjadi baris RESERVED — dan tiap reservasi dicatat di **`stock_reservation`** per line (menaut ke `operation`, `operation_line`, `quant_id`, atribut & `source_status` + qty). Saat cancel, reservasi di-RELEASE dan qty dikembalikan **persis** sebanyak yang dipesan (tidak ada tebak-tebakan quant mana yang harus dibuka). Untuk item ber-serial (qty=1) reservasi = flip status pada quant serial tersebut. **Saran FEFO di-validasi ulang saat reserve**, bukan hanya saat pick list di-generate, karena stok bisa berubah di sela itu.
2. **"Broken" (karton pecah) bukan status quant, melainkan status di `handling_unit`.** Saat Carton Break, quant karton dikonsumsi dan lahir quant item baru berstatus Available. Damaged (rusak) dan Broken (pecah untuk dijadikan item) sengaja dipisah karena dua hal berbeda.

---

## 9. Daftar Menu / Modul

Struktur hierarkis (menu induk → submenu). Tiap submenu punya `route` yang menjadi titik kontrol RBAC. Menu ber-flag hanya muncul bila fiturnya diaktifkan.

| # | Menu Induk | Submenu | Route | Catatan / Flag |
|---|---|---|---|---|
| 1 | **Dashboard** | — | `/dashboard` | Ringkasan aktivitas & KPI |
| 2 | **Inbound** | Purchase Orders | `/inbound/orders` | PO dari ERP (read-only untuk user; tulis oleh ERP) |
| | | Receipts | `/inbound/receipts` | Operasi barang masuk |
| | | Putaway | `/inbound/putaway` | Eksekusi penyimpanan ke bin |
| 3 | **Internal** | Transfers | `/internal/transfers` | Bin-to-bin & inter-site transfer |
| | | Carton Break | `/internal/carton-break` | flag: `enable_carton_break` (produk `track_level=ITEM`) |
| | | Quarantine / QA | `/internal/quarantine` | flag: `enable_quarantine` |
| 4 | **Outbound** | Sales Orders | `/outbound/orders` | Order dari ERP |
| | | Picking | `/outbound/picking` | Full / partial / loose item |
| | | Deliveries | `/outbound/deliveries` | Staging & loading dock |
| | | Scrap / Issue | `/outbound/scrap` | Butuh reason; approval bila optype `require_approval` |
| | | Scrap Approval | `/outbound/scrap-approval` | Antrean approval (hak `edit` = boleh approve) |
| 5 | **Inventory** | Stock on Hand | `/inventory/stock` | Quant per produk & lokasi |
| | | Handling Units | `/inventory/units` | LPN & karton |
| | | Traceability Lookup | `/inventory/trace` | Telusur Serial/Batch/LPN |
| | | Stock Adjustment | `/inventory/adjustment` | Penyesuaian manual (+/−) |
| 6 | **Master Data** | Products | `/master/products` | Termasuk setting UOM & flag |
| | | UOM & Packaging | `/master/uom` | Satuan & konversi |
| | | Sites & Warehouses | `/master/sites` | Pabrik & gudang · flag: `enable_multi_site` |
| | | Locations | `/master/locations` | Zona, rak, bin |
| | | Partners | `/master/partners` | Customer & supplier |
| | | Batches | `/master/batches` | flag: `enable_batch` |
| | | Reason Codes | `/master/reason-codes` | Alasan scrap/issue/adjust/QA/FEFO override |
| 7 | **Configuration** | Operation Types | `/config/operation-types` | Kelola turunan 3 baseline |
| | | App Settings | `/config/settings` | Feature flag & kebijakan |
| 8 | **Reports** | Stock Report | `/reports/stock` | |
| | | Movement / Ledger | `/reports/movement` | Histori `stock_move` |
| | | Traceability Report | `/reports/traceability` | Jejak Pack→Carton→LPN→Customer |
| 9 | **Administration** | Users | `/admin/users` | |
| | | Roles | `/admin/roles` | |
| | | Access Control | `/admin/access` | Matriks RBAC |
| | | Audit Log | `/admin/audit` | Siapa, apa, kapan |
| | | Integration Events | `/admin/integration` | API key & outbox ERP (retry DEAD) |

### 9.1 Template Role (baseline seed)

Lima role bawaan, hak akses di level modul (V=view, C=create, E=edit, D=delete):

| Modul | Super Admin | Supervisor | Operator | Inventory Controller | Auditor | ERP Integration |
|---|---|---|---|---|---|---|
| Dashboard | VCED | V | V | V | V | — |
| Inbound | VCED | VCE | VCE | V | V | — |
| Internal | VCED | VCE | VCE | V | V | — |
| Outbound | VCED | VCE | VCE | V | V | — |
| Inventory | VCED | VCE | V | VCED | V | — |
| Master Data | VCED | V | — | VCED | V | — |
| Configuration | VCED | — | — | — | — | — |
| Reports | VCED | V | — | V | V | — |
| Administration | VCED | — | — | — | — | — |

**Override per-submenu** (menang atas grant modul, seed §8):

| Submenu | Super Admin | Supervisor | Operator | Inventory Controller | ERP Integration |
|---|---|---|---|---|---|
| Purchase Orders / Sales Orders | VCED | V | V | V | VCE |
| Scrap Approval | VCED | VE | — (deny eksplisit) | — (deny eksplisit) | — |
| Stock Adjustment | VCED | V | V | VCED | — |
| Integration Events | VCED | V | — | — | — |

Ringkasan peran:

- **Super Admin** — akses penuh; di-seed otomatis saat instalasi.
- **Supervisor** — jalankan & pantau semua operasi + laporan; tanpa config/admin.
- **Operator** — pengguna handheld: eksekusi inbound/internal/outbound; tanpa ubah master data.
- **Inventory Controller** — kelola master data & penyesuaian stok.
- **Auditor** — read-only di semua modul (audit/compliance).
- **ERP Integration** — service account (bukan manusia); hanya `view+create+edit` di **Purchase Orders & Sales Orders** (bukan seluruh modul) untuk menerima/mengubah PO/SO via API key. Lihat kontrak di `erp-integration-wms-baseline.md`.

### 9.2 Catatan

- Menu induk hanya wadah tampilan; kontrol akses ada di submenu ber-`route`.
- Menu ber-flag **disembunyikan total** bila fiturnya mati (bukan sekadar di-disable). Contoh: instalasi retail tanpa expiry → menu Batches & Quarantine tidak muncul.

---

## 10. Alur Validasi per Operation Type

### 10.1 Aturan umum (semua operation type)

- **Barcode wajib** — S/N, LPN, dan Bin di-input via scan.
- **Entitas valid & ada** — kode yang di-scan terdaftar dan sesuai konteks.
- **UOM sesuai `track_level`** — sistem hanya menerima scan di level yang diizinkan produk.
- **Klaim tugas** — operator meng-claim operasi sebelum scan; operasi milik operator lain terkunci (Behavioral D-13).
- **Idempoten** — tiap scan & transisi dari handheld membawa `Idempotency-Key`; retry jaringan tidak menggandakan efek.
- **Confirm atomik + ber-lock** — saat confirm, sistem (dalam satu transaksi) meng-lock baris `operation` & baris `quant` terkait (`SELECT … FOR UPDATE`), menulis `stock_move`, meng-update `quant`, meng-update cache `handling_unit.location_id`, menutup `stock_reservation` (→CONSUMED), menaikkan `qty_delivered`/`qty_received`, dan menulis event outbox ERP. Urutan lock baku: operation → baris order → advisory lock per produk → quant (Behavioral A-5). Bila salah satu gagal, semua rollback. Stok hanya berubah saat operasi mencapai **Done**. Lock ini yang mencegah oversell & double-confirm; `CHECK (qty ≥ 0)` hanya jaring terakhir.

### 10.2 INCOMING — Receipt + Putaway

Prasyarat: `direction=IN`; sumber = lokasi virtual (supplier/produksi), tujuan = bin STOCK.

1. Terima/buat operasi (dari PO, produksi, atau retur) → Ready (validasi header: partner & dokumen ref valid; PO `OPEN/PARTIAL`) → operator claim & start. Untuk receipt dari PO, `source_doc_type='PURCHASE_ORDER'` menaut ke `purchase_order`; tiap line menaut `po_line_id`.
2. Scan produk / S/N per unit sesuai `track_level` (status In progress):
   - `ITEM` → scan Pack S/N tiap item, atau scan Carton S/N (isi diketahui dari packaging).
   - `CARTON` → scan Carton S/N saja.
   - Validasi: S/N tidak duplikat, produk cocok, batch & expiry terisi (bila flag aktif). **Qty terhadap PO:** `qty_received + qty_terima_baru ≤ qty_dipesan × (1 + over_receipt_tolerance_pct/100)` per `purchase_order_line`. (Receipt dari produksi/retur tanpa PO melewati cek ini.)
3. Submit → sistem generate LPN pallet (bila `enable_lpn`) & S/N berstatus `PENDING` → print label (Zebra). Bila receipt dibatalkan setelah submit, kode menjadi `VOID`.
4. Putaway: forklift scan LPN → scan bin tujuan. Validasi: bin valid, bertipe STOCK, `is_usable`, LPN cocok. *(Validasi kapasitas bin = fase 2, lihat requirements OQ-1.)*
5. Confirm → operasi **Done**.

**Efek:** quant baru di bin, status Available (atau Quarantine bila `qa_on_receipt`), HU `INTACT`, serial `ACTIVE`. Stok **+**. Ledger: `virtual_supplier → bin` (`to_status` tercatat). Validasi over-receipt diulang di bawah lock baris PO saat confirm.

### 10.3 INTERNAL — Bin-to-Bin Transfer

Prasyarat: `direction=INTERNAL`; kedua lokasi internal.

1. Pilih operasi transfer.
2. Scan source bin → scan LPN/Carton/Serial. Validasi: barang ada di source bin, status Available, qty ≤ tersedia.
3. Scan destination bin. Validasi: valid, ≠ source, `is_usable`. *(Kapasitas = fase 2.)*
4. Confirm.

**Efek:** `quant.location` berubah source→dest; batch/expiry/S/N ikut tanpa berubah. Stok **netral**. Ledger: `source → dest`.

### 10.4 INTERNAL — Inter-Site Transfer (antar gudang / site)

Berlaku saat sumber dan tujuan berada di gudang/site berbeda. Dilakukan **2 langkah** memakai lokasi `IN_TRANSIT`, agar barang yang sedang dalam perjalanan terlihat statusnya dan tidak muncul sebagai available di tujuan sebelum benar-benar tiba. Transfer di dalam satu gudang tetap 1 langkah (lihat 10.3).

**Operasi #1 — Dispatch dari site A** (wajib menentukan `dest_warehouse_id`):
1. Scan source bin (di Gudang A) → scan LPN/Carton/Serial. Validasi: barang ada, status Available, qty ≤ tersedia.
2. Confirm → stok pindah ke lokasi `IN_TRANSIT`. Barang tidak lagi available di A.

**Operasi #2 — Receive di site B:**
3. Scan barang dari `IN_TRANSIT` → scan destination bin (di Gudang B). Validasi: bin valid, `is_usable`. *(Kapasitas = fase 2.)*
4. Confirm → stok masuk bin Gudang B, status Available. Receive hanya bisa dibuat di gudang tujuan. Penerimaan boleh parsial; sisa tetap di `IN_TRANSIT` (laporan in-transit) dan diselesaikan via `ADJ_LOSS` reason `TRANSIT_LOSS` bila hilang/rusak.

**Efek:** batch/expiry/S/N/LPN ikut sepanjang perjalanan tanpa berubah. Stok **netral** secara total (hanya berpindah lokasi/site). Ledger: `bin A → IN_TRANSIT` lalu `IN_TRANSIT → bin B`.

### 10.5 INTERNAL — Carton Break

Prasyarat: `direction=INTERNAL`; hanya produk `track_level=ITEM`; flag `enable_carton_break` aktif.

1. Buka menu Carton Break → scan Carton S/N. Validasi: HU bertipe CARTON, status INTACT, quant Available (bukan Reserved), produk `track_level=ITEM`. Sistem ambil jumlah isi dari **qty quant karton** (harus bilangan bulat) dan batch/expiry dari karton induk.
2. Konfirmasi jumlah item yang akan lahir. Opsional: scan/generate Pack S/N tiap item (validasi tidak duplikat).
3. Confirm.

**Efek:**
- HU karton → status BROKEN; quant karton (N base) dikonsumsi seluruhnya.
- Lahir N quant item baru, status Available, di bin yang sama, mewarisi batch/expiry, `serial.origin_hu_id` menunjuk karton induk.
- Total qty dalam base UOM tidak berubah (konversi, bukan pengurangan). Ledger memakai lokasi `VIRTUAL_TRANSFORM`: 1 baris konsumsi (`bin → VIRTUAL_TRANSFORM`, qty N) + baris produksi (`VIRTUAL_TRANSFORM → bin`: satu per serial bila S/N digenerate, atau satu baris qty N bila tidak), sehingga tiap `stock_move` tetap punya `from ≠ to`.

### 10.6 INTERNAL — Move to Quarantine *(bila `enable_quarantine`)*

Quarantine adalah **status**, bukan lokasi. Pilih reason → scan item → (opsional) scan bin tipe QUARANTINE → confirm (operasi instan `INT_QA_HOLD`).

**Efek:** `quant.status` Available→Quarantine, in-place atau pindah ke bin QA; `stock_move` mencatat `from_status/to_status` walau lokasi sama. Release (`INT_QA_RELEASE`, Quarantine→Available) meminta scan bin tujuan dengan saran bin asal (dari ledger); Reject (`INT_QA_REJECT`, Quarantine→Damaged) dan Mark Damaged (`INT_MARK_DAMAGED`, Available→Damaged) in-place dengan reason wajib. Unit Reserved tidak bisa di-hold.

### 10.7 OUTGOING — Picking / Delivery

Prasyarat: `direction=OUT`; ada Sales Order dari ERP yang di-generate jadi pick list.

1. Terima SO dari ERP. Validasi: produk & qty ada di master, customer valid.
2. Generate pick list — satu operasi `OUT_DELIVERY` (picking + delivery dalam **satu operasi, satu confirm**), satu line per baris SO (`so_line_id`) untuk sisa yang belum teralokasi; sistem menyarankan batch (FEFO bila flag aktif), lokasi, dan LPN/Carton/Serial. Operasi → Ready. **Prioritas antar-SO:** bila stok terbatas, pick list diurutkan `delivery_date` (paling mendesak dulu); reservasi bersifat *first-start* (operasi yang start lebih dulu mengunci stok). Tidak ada alokasi terencana saat SO masuk (fase 2).
3. Operator claim & mulai (Ready→In progress) → stok terpilih di-reserve (Available→Reserved), tercatat di `stock_reservation` per line; `sales_order_line.qty_reserved` naik (ditolak bila melebihi sisa SO line). FEFO/expiry divalidasi ulang di titik ini terhadap stok terkini.
4. Eksekusi per baris di handheld:
   - Drive ke bin → scan bin (validasi cocok dengan saran).
   - Scan sesuai mode:
     - *Full pallet* → scan LPN.
     - *Full carton (partial)* → scan Carton S/N tertentu; sisa karton tetap di pallet.
     - *Loose item* → scan Pack S/N item (hasil carton break).
   - Validasi: match ke SO (produk/batch/qty), FEFO (batch bukan saran → blokir, atau *warn* yang **wajib acknowledgement + reason** dan tercatat per line), expiry check (tidak expired; sisa umur ≥ `partner.min_shelf_life_days`, fallback `default_min_shelf_life_days`), status Reserved.
   - Tutup line (penuh atau parsial; parsial → sisa reservasi langsung di-release).
5. Move ke staging → scan lokasi staging.
6. Scan loading dock → Confirm (hak menu Deliveries) → operasi Done.

**Efek:** quant Reserved dikonsumsi, pindah ke `virtual_customer` (global). Stok **−**. Ledger: `bin → virtual_customer`; `stock_reservation`→CONSUMED; `sales_order_line.qty_delivered` naik (bila belum penuh, SO tetap terbuka untuk operasi berikutnya). Untuk partial: hanya karton/item terpilih yang keluar; reservasi sisanya di-RELEASE saat line ditutup dan quant kembali Available. SO berstatus PARTIAL sampai terpenuhi.

### 10.8 OUTGOING — Scrap / Issue to Production

Prasyarat: `direction=OUT`, tujuan = `virtual_scrap` / `virtual_production`. Butuh reason code, dan approval bila `operation_type.require_approval` aktif.

1. Buat operasi, pilih reason. Bila butuh approval → menunggu approver yang punya hak `edit` di menu **Scrap Approval** dan **bukan pembuat operasi**.
2. Scan item — boleh dari status Available, Quarantine, maupun Damaged (`allowed_from_status`).
3. Confirm (setelah di-approve).

**Efek:** quant dikonsumsi. Stok **−**. Ledger mencatat `reason_code_id` & pelaku; approver tercatat di `operation.approved_by`.

### 10.9 Stock Adjustment

Operasi instan `ADJ_GAIN` (INCOMING, dari `INVENTORY_ADJUST`) atau `ADJ_LOSS` (OUTGOING, ke `INVENTORY_ADJUST`) dengan reason wajib. Tidak boleh menyentuh qty Reserved dan tidak boleh membuat stok negatif. Karena `INVENTORY_ADJUST` lokasi endpoint, invarian on-hand = ledger tetap terjaga.

---

## 11. Feature Flag & Konfigurasi Instalasi

Feature flag disimpan di tabel `app_setting` (`key`, `value`, `data_type`, `description`) dan menjadi konfigurasi global instalasi. Inilah yang membedakan instalasi farmasi vs retail vs F&B dari satu basis kode yang sama.

Flag utama (default disiapkan saat seeding):

| Flag | Fungsi | Contoh dampak bila mati |
|---|---|---|
| `enable_batch` | Aktifkan batch/lot | Menu Batches disembunyikan |
| `enable_expiry` | Aktifkan tanggal kadaluarsa | Kolom expiry tidak wajib |
| `enable_fefo` | Aktifkan saran FEFO saat picking | Picking tidak menyarankan batch tertua |
| `enable_serial` | Aktifkan serialisasi item | Pack S/N tidak dipakai |
| `enable_lpn` | Aktifkan Pallet LPN | Tidak ada label pallet |
| `enable_carton_break` | Aktifkan operasi Carton Break | Menu Carton Break disembunyikan |
| `enable_quarantine` | Aktifkan status & alur QA | Status Quarantine & menu QA disembunyikan |
| `enable_multi_site` | Aktifkan banyak site (pabrik) | Menu Sites disembunyikan; sistem pakai satu default site |

Selain flag boolean, `app_setting` juga menampung kebijakan: toleransi over-receipt (`over_receipt_tolerance_pct`), kebijakan FEFO (`fefo_policy`: warning vs blokir), sisa umur simpan minimum default (`default_min_shelf_life_days`), format nomor dokumen (`ref_no_format` = `{TYPE}-{YYYY}-{seq:05}`, tahun menurut zona waktu warehouse), format kode LPN/S/N, URL print service label, dan TTL klaim tugas. Kebutuhan approval **bukan** flag global — diatur per operation type (`operation_type.require_approval`).

**Aturan prioritas flag:** flag efektif per produk = flag global `app_setting.enable_*` **AND** flag produk `product.use_*`. Global mati ⇒ fitur mati untuk semua produk; global hidup ⇒ produk menentukan.

---

## Ringkasan Keputusan yang Terkunci

1. Multi-level UOM configurable per produk (`track_level` CARTON/ITEM); satu produk = satu satuan jual.
2. Operation Type = 3 baseline (incoming/internal/outgoing), extensible, berbasis data.
3. Carton Break = operasi Internal mandiri; kardus boleh dipecah jadi item lepas dengan lineage utuh.
4. Arsitektur single-tenant per-deployment; perbedaan klien lewat feature flag.
5. ERD lengkap: Product & UOM, Location, HU/Serial/Batch, Quant + Ledger, Operation, Orders, User & RBAC — tanpa `tenant_id`.
6. RBAC: user multi-role, 4 CRUD flag per menu, deny by default, seed Super Admin.
7. State machine: status operasi (5) & status stok (4), dengan Quarantine & QA opsional.
8. Daftar menu baseline + 5 role template + matriks akses.
9. Alur validasi per operation type diformalkan langkah demi langkah.
10. Dukungan multi-site: hierarki site → warehouse → location; inter-site transfer 2-langkah via `IN_TRANSIT` (operasi receive menaut dispatch via `parent_operation_id`); akses user tidak dibatasi per site.
11. **Konkurensi:** transisi status ber-lock (`FOR UPDATE`) + kolom `version`; cegah oversell & double-confirm. `CHECK(qty≥0)` hanya jaring terakhir.
12. **Reservasi punya jejak:** tabel `stock_reservation` menaut operasi↔quant↔qty; release presisi saat cancel.
13. **Invarian UOM:** quant/stock_move/stock_reservation selalu base UOM; UOM transaksi hanya di `operation_line`.
14. **Sumber kebenaran lokasi tunggal:** `quant` otoritatif; `handling_unit.location_id` cache; `serial` tanpa lokasi.
15. **Data PO:** `purchase_order`/`purchase_order_line` (dengan `qty_received`) jadi acuan validasi qty INCOMING; `sales_order_line` punya `qty_reserved`/`qty_delivered` untuk pemenuhan bertahap.
16. **Audit non-stok:** tabel `audit_log` + `app_setting.updated_by` untuk jejak aksi admin/config (compliance).
17. **Immutabilitas ledger:** `stock_move` & `audit_log` ditegakkan trigger DB, bukan sekadar konvensi.
18. **Carton break** memakai lokasi virtual `VIRTUAL_TRANSFORM` agar tetap seragam location→location; lokasi sistem bersifat global; N = qty quant karton.
19. **Semua perubahan stok lewat operation** (adjustment `ADJ_GAIN/LOSS` via `INVENTORY_ADJUST`, QA, mark damaged, carton break sebagai operasi instan); perubahan status quant tercatat di ledger (`from_status/to_status`).
20. **RBAC per operation type** (`menu_code`/`confirm_menu_code`/`approve_menu_code`) + menu **Scrap Approval** + approver ≠ pembuat; grant seed per-submenu (ERP hanya PO/SO).
21. **Picking + delivery = satu operasi, satu confirm**; reservasi per line dengan tautan `so_line_id`; anti over-allocation SO & over-receipt PO di bawah lock baris order.
22. **Zona waktu per warehouse** untuk expiry/shelf-life/ref_no; **klaim tugas** handheld; **idempotensi** scan/transisi; user & master **soft-delete**.
