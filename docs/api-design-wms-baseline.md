# Desain API Endpoint — WMS Baseline

**Dokumen desain REST API · pelengkap Spesifikasi Sistem WMS Baseline v1.3 · Behavioral v1.1 · Schema v1.4**

Versi: 1.8 · 17 Oktober 2026 · Pembaruan 1.8: §3.1 kontrak `DELETE /master/products/{id}` (`{id, deleted}`; histori = dirujuk ledger/quant/reservasi/operasi/cursor/order line/batch/HU/serial), produk INACTIVE ditolak untuk batch baru. Pembaruan 1.7 (implementasi M5, `m5-integration-hardening-wms-baseline.md`): §11.5 `meta.gateway`, retry massal `POST /admin/integration-events/retry`, `GET /admin/reconciliation`. Pembaruan 1.6 (implementasi M4, `m4-visibility-admin-wms-baseline.md`): §3 CRUD UOM / sites & warehouses / batches / reason codes, §8.2–8.4 (Handling Units, trace, adjustment ber-kode + `counted_qty` + preview + transit loss), §9 (`template_code`, bentuk & validasi setting), §10 (query, cursor, `/reports/jobs`, download), §11 (body user/role/key, `LAST_ADMIN`/`SELF_ACTION`, bentuk audit feed), `GET /dashboard/summary`, lima reason baru (`NO_CHANGE`, `LAST_ADMIN`, `SELF_ACTION`, `IN_USE`, `SETTING_DEPENDENCY`). Pembaruan 1.5 (implementasi M3, `m3-outbound-wms-baseline.md`): `generate-picklist {warehouse_id?}` → `{operation, skipped[]}`, `GET /outbound/picking[/{id}]` (+`suggestions[]`, `shortages[]`), `GET /outbound/deliveries` (antrean tahap delivery), `POST …/document` mengembalikan DTO surat jalan (bukan PDF), body `POST /outbound/scrap`, `GET /outbound/scrap-approval`, scan `SCAN_DOCK` menerima `confirm_menu_code`, respons scan + `warnings[]`, `NOT_RESERVED.details.cause`, detail operasi + `sales_order`/`staging_location`/`dock_location`/`require_approval`/`approved_by`/`approved_at`, line + `so_line_id`, summary + `partner`/`delivery_date`. Pembaruan 1.4 (implementasi M2): body `POST /internal/transfers` (dokumen `lines[]` / ad-hoc), `POST/DELETE /operations/{id}/lines`, close line tanpa body (+`released_base`), receive `{warehouse_id?}`, QA `lines[]` + `warehouse_id?`, `Idempotency-Key` WAJIB untuk operasi instan (400), `GET /lookup/code` (query), `GET /master/reason-codes` (lookup), `GET /internal/carton-break` (riwayat), detail operasi + `mode`/`dest_warehouse`/`parent_operation`/`children`/`in_transit_base`/`reservations[]`, summary + `dest_warehouse`/`parent`. Pembaruan 1.3 (implementasi M1): reason baru (`NO_LINES`, `ORDER_NOT_OPEN`, `QTY_BELOW_EXECUTED`, `BATCH_CONFLICT`, `CODE_TAKEN`), `Idempotency-Key` wajib di scan (400), `X-API-Key` hanya untuk endpoint order, ingest 201/200, packaging `PATCH`, `/master/warehouses`, respons transisi `{version, status, next_expected}`. Pembaruan 1.2: subkode error (`reason`), RBAC endpoint generik via operation type, idempotensi wajib handheld, `If-Match`, lifecycle per direction (`submit`, `claim`, line `close`, satu confirm OUTGOING), operasi instan (adjustment/QA/carton break), menu Scrap Approval, export async, keyset pagination, qty sebagai string desimal, soft-delete user/master.

---

## Daftar Isi

1. [Konvensi Umum](#1-konvensi-umum)
2. [Autentikasi & Session](#2-autentikasi--session)
3. [Master Data](#3-master-data)
4. [Operations — Kerangka Umum](#4-operations--kerangka-umum)
5. [Inbound](#5-inbound)
6. [Internal](#6-internal)
7. [Outbound](#7-outbound)
8. [Inventory](#8-inventory)
9. [Configuration](#9-configuration)
10. [Reports](#10-reports)
11. [Administration](#11-administration)
12. [Ringkasan Seluruh Endpoint](#12-ringkasan-seluruh-endpoint)

---

## 1. Konvensi Umum

- **Base path:** `/api/v1`. **Path di tabel tiap bab ditulis lengkap relatif terhadap base path** (mis. `GET /master/products` = `GET /api/v1/master/products`).
- **Format:** JSON (request & response), `Content-Type: application/json`.
- **Penamaan:** resource jamak, kebab-case di path (mis. `/operation-types`, `/handling-units`), snake_case di field JSON.
- **Method:** `GET` (baca), `POST` (buat/aksi), `PATCH` (ubah sebagian), `DELETE` (hapus). Transisi status memakai sub-resource aksi (`POST .../confirm`), bukan `PATCH status`.
- **Waktu:** timestamp ISO-8601 UTC (`2026-09-23T14:03:00Z`). **Tanggal kalender** (expiry, delivery_date) = `YYYY-MM-DD` dan dimaknai pada `warehouse.timezone` terkait. Respons operasi menyertakan `warehouse.timezone` agar UI menampilkan jam lokal.
- **Angka qty:** dikirim sebagai **string desimal** (`"250.0000"`) — NUMERIC(18,4) tidak aman sebagai float JS. Parse dengan pustaka desimal di `packages/contracts`.
- **ID:** UUID.
- **Soft-delete:** user, product, partner, location, reason code tidak di-hard-delete bila punya histori; `DELETE` pada resource itu = nonaktifkan (`status=INACTIVE`/`is_active=false`), kecuali belum pernah dipakai.

### 1.1 Response envelope

Sukses:
```json
{ "success": true, "data": { }, "meta": { "warnings": [ ] } }
```
List (pagination offset — tabel master & operasi):
```json
{ "success": true, "data": [ ], "meta": { "page": 1, "per_page": 50, "total": 1234 } }
```
List (pagination keyset — ledger/audit/laporan besar, tanpa `total`):
```json
{ "success": true, "data": [ ], "meta": { "next_cursor": "eyJhdCI6Ii4uLiJ9", "per_page": 100 } }
```
Error:
```json
{ "success": false,
  "error": { "code": "BUSINESS_RULE", "reason": "FEFO_ACK_REQUIRED",
             "message": "Batch B2409 bukan saran FEFO (saran: B2407).",
             "details": { "suggested_batch": "B2407" } } }
```
- `code` = kategori baku (§1.2), stabil & sedikit. `reason` = subkode spesifik (§1.2.1) — **inilah yang dipetakan UI ke pesan/aksi**. `message` = teks default (id), UI boleh menimpa via i18n berdasarkan `reason`.
- `meta.warnings[]` = peringatan non-blokir (mis. `FEFO_OVERRIDDEN`), bentuk `{reason, message, details}`.

### 1.2 Kode error baku

| HTTP | code | Kapan |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Payload/parameter tidak valid (zod) |
| 401 | `UNAUTHENTICATED` | Token/API key tidak ada/kadaluarsa |
| 403 | `FORBIDDEN` | RBAC menolak (menu/aksi) atau aturan otorisasi (SELF_APPROVAL) |
| 404 | `NOT_FOUND` | Resource tidak ada / fitur flag mati |
| 409 | `CONFLICT` | Bentrok state/stok/duplikat/lock/klaim |
| 409 | `INVALID_TRANSITION` | Transisi status tidak diizinkan (mis. double-confirm) |
| 409 | `VERSION_CONFLICT` | `If-Match` tidak cocok (optimistic lock) |
| 422 | `BUSINESS_RULE` | Melanggar aturan domain (FEFO, expiry, UOM level, dsb.) |
| 500 | `INTERNAL` | Kesalahan server |
| 503 | `UNAVAILABLE` | DB/schema tidak siap (lihat `/api/ready`) |

### 1.2.1 Katalog `reason` (subkode)

| code | reason |
|---|---|
| `CONFLICT` | `DUPLICATE_SERIAL`, `LPN_MISMATCH`, `NOT_RESERVED`, `UNIT_RESERVED`, `LOCK_TIMEOUT`, `CLAIMED_BY_OTHER`, `IN_PROGRESS`, `WRONG_WAREHOUSE`, `ERP_REF_CONFLICT`, `STEP_CHANGED`, `CODE_TAKEN`, `LOCKED_AFTER_STOCK`, `LAST_ADMIN`, `SELF_ACTION`, `IN_USE` |
| `INVALID_TRANSITION` | `NOT_SUBMITTED`, `LINE_LOCKED`, `ALREADY_DONE` |
| `BUSINESS_RULE` | `INSUFFICIENT_STOCK`, `SO_OVER_ALLOCATION`, `OVER_RECEIPT`, `PRODUCT_MISMATCH`, `MISSING_BATCH`, `MISSING_EXPIRY`, `INVALID_BIN`, `PUTAWAY_INCOMPLETE`, `FEFO_VIOLATION`, `FEFO_ACK_REQUIRED`, `EXPIRED`, `SHELF_LIFE`, `LINES_OPEN`, `NEEDS_APPROVAL`, `MISSING_REASON`, `NEGATIVE_STOCK`, `NOT_ITEM_LEVEL`, `INVALID_HU`, `FRACTIONAL_CONTENT`, `SAME_LOCATION`, `UNKNOWN_PARTNER`, `UNKNOWN_PRODUCT`, `UNKNOWN_UOM`, `IDEMPOTENCY_MISMATCH`, `ORDER_IN_EXECUTION`, `UNKNOWN_CODE`, `AMBIGUOUS_CODE`, `WRONG_SCAN_TYPE`, `NO_LINES`, `ORDER_NOT_OPEN`, `QTY_BELOW_EXECUTED`, `BATCH_CONFLICT`, `NO_CHANGE`, `SETTING_DEPENDENCY` |
| `FORBIDDEN` | `SELF_APPROVAL`, `SERVICE_ACCOUNT_UI` |
| `VALIDATION_ERROR` | `UNKNOWN_MENU` |
| `NOT_FOUND` | `UNKNOWN_CODE` (trace) |
| warnings | `FEFO_OVERRIDDEN`, `NEAR_EXPIRY` |

Katalog ini adalah kontrak: tambah reason = tambah baris di sini + i18n key `errors.<reason>` di FE.

### 1.3 Query param umum (list)

`?page=1&per_page=50&sort=-created_at&q=<cari>` plus filter spesifik per resource (mis. `?status=DONE&warehouse_id=…`). Endpoint ledger/audit/laporan (`/reports/movement`, `/admin/audit`, `/inventory/trace/*`) memakai **keyset**: `?cursor=<next_cursor>&per_page=100` (urut `moved_at,id` / `at,key` menurun). `cursor` buram (base64url); respons membawa `meta.next_cursor` (`null` = habis) tanpa `total`; cursor rusak → `400`. `per_page` maks 200.

### 1.4 RBAC di setiap request

**Endpoint resource biasa** dipetakan ke satu `menu.code` + satu aksi CRUD (tabel pemetaan route→menu di `packages/application`):
- `GET` → `can_view` · `POST` (buat) → `can_create` · `PATCH` → `can_edit` · `DELETE` → `can_delete`.

**Endpoint generik `/operations/{id}/*`** — menu **tidak** diambil dari route, melainkan dari operation type operasi tersebut (schema `operation_type.*_menu_code`):

| Aksi | Menu yang dicek | Hak |
|---|---|---|
| `GET` detail/lines | `menu_code` | view |
| `ready`, `reopen`, `start`, `submit`, `claim`, `unclaim`, `scan`, line `close`, `cancel` | `menu_code` | edit |
| `scan` pada **tahap delivery** (langkah `SCAN_DOCK`, behavioral D-29) | `menu_code` **atau** `confirm_menu_code` | edit — pemegang `confirm_menu_code` mengambil alih klaim |
| `confirm` | `confirm_menu_code ?? menu_code` | edit |
| `approve` | `approve_menu_code` (+ approver ≠ pembuat) | edit |
| `unclaim` milik user lain | `menu_code` | delete (supervisor) |

Contoh: `OUT_DELIVERY` → aksi umum di `outbound_picking`, confirm di `outbound_deliveries`; `OUT_SCRAP` → approve di `outbound_scrap_approval`. Karena itu user yang hanya punya `inbound_putaway` **tidak** bisa confirm delivery lewat `/operations/{id}/confirm`.

Deny-by-default: tidak ada baris akses (atau baris all-false) = `403 FORBIDDEN`. Test matriks RBAC per optype × aksi wajib di CI.

### 1.5 Header kontrol

| Header | Wajib | Fungsi |
|---|---|---|
| `Idempotency-Key` | **Wajib** untuk `POST /operations/{id}/scan`, semua transisi, dan operasi instan dari handheld; disarankan untuk ERP | Request ulang dengan key sama → respons tersimpan dikembalikan (tabel `idempotency_key`, retensi 24 jam). Key sama + payload beda → `422 IDEMPOTENCY_MISMATCH`; masih diproses → `409 IN_PROGRESS`. |
| `If-Match: <version>` | Opsional (disarankan UI desktop) | Optimistic lock terhadap `operation.version` → mismatch `409 VERSION_CONFLICT`. Respons operasi menyertakan `ETag: <version>`. |
| `X-CSRF-Token` | Wajib untuk mutasi berbasis cookie | Double-submit (frontend §7). |
| `X-API-Key` | Klien mesin | Lihat §1.6 & erp-integration §2. |

**Penerapan M1:** `POST /operations/{id}/scan` **menolak** request tanpa `Idempotency-Key` (`400 VALIDATION_ERROR`). Transisi `/operations/{id}/{action}` menghormati key bila dikirim (klien handheld & web selalu mengirim); key disimpan per principal dengan hash `method + path + body` di transaksi bisnis yang sama (behavioral D-15). Respons transisi = `{version, status, next_expected}` + `ETag`.

### 1.6 Mode autentikasi

- **Web & handheld (manusia):** cookie httpOnly (`access_token`, `refresh_token`) + CSRF double-submit. Header `Authorization` tidak dipakai browser.
- **Klien mesin (ERP):** `X-API-Key` → service account; tanpa cookie/CSRF; hanya diterima di endpoint order (`/inbound/orders*`, kelak `/outbound/orders*`) — endpoint lain `403 SERVICE_ACCOUNT_UI`. Key disimpan sebagai SHA-256 (`api_key.key_hash`). Penerbitan key lewat UI admin = M4/M5 (sementara: SQL/skrip, lihat `scripts/smoke-m1.sh`).
- **Opsional (tool/CLI internal):** `Authorization: Bearer <access_token>` diterima sebagai alternatif cookie (tanpa CSRF).

### 1.7 Integrasi ERP (model yang dikunci)

- **Arah:** ERP **push** ke WMS (`POST /inbound/orders`, `POST /outbound/orders`, `PATCH`/`cancel`). WMS **callback** ke ERP via outbox (URL & auth di env instalasi).
- **Idempotensi:** ingest idempoten pada `erp_ref` (unik) — kirim ulang isi sama → `200` resource lama; isi beda → `409 CONFLICT/ERP_REF_CONFLICT` (pakai `PATCH`).
- **Autentikasi ERP:** API key → service account role `ERP_INTEGRATION` (hanya `inbound_orders`/`outbound_orders`).
- **Rekonsiliasi:** `GET /inbound/orders` & `GET /outbound/orders` dengan filter status.

### 1.8 Endpoint operasional (tanpa auth)

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/health` | Liveness: proses hidup → `200 {status:"ok"}` |
| GET | `/api/ready` | Readiness: DB reachable **dan** versi `schema_migration` tertinggi ada di rentang app → `200`; else `503` |

Dipakai reverse proxy/monitoring & runbook deploy (test-delivery §17/§19). Tidak mengembalikan data sensitif.

---

## 2. Autentikasi & Session

| Method | Endpoint | Aksi |
|---|---|---|
| POST | `/auth/login` | Login (username + password) → set cookie access & refresh + `user_session` |
| POST | `/auth/refresh` | Rotasi refresh (grace window, auth-session §1) → cookie baru |
| POST | `/auth/logout` | Cabut family refresh aktif + hapus cookie |
| GET | `/auth/me` | Profil + role + `menuAccess` + gudang default |
| POST | `/auth/change-password` | Ganti password (wajib bila `must_change_password`) |

`GET /auth/me` (dan respons `/auth/login`) mengembalikan **peta akses menu** (`menuAccess`: `menu.code` → hak CRUD), hasil union `role_menu_access` semua role user, **sudah difilter feature flag** (menu fitur mati tidak dikirim). **Struktur/label/ikon menu ada di katalog statis frontend** (frontend §5); BE hanya mengirim akses.
```json
{ "user": { "id":"…","username":"admin","full_name":"…","must_change_password":false,
            "default_warehouse": { "id":"…","code":"WH-MAIN","timezone":"Asia/Jakarta" } },
  "roles": ["SUPER_ADMIN"],
  "menuAccess": {
    "inbound_receipts": { "view":true, "create":true, "edit":true, "delete":true },
    "inbound_putaway":  { "view":true, "create":true, "edit":true, "delete":false }
  },
  "flags": { "enable_batch":true, "enable_quarantine":true, "fefo_policy":"warn" } }
```
`flags` = subset non-rahasia `app_setting` yang dibutuhkan UI (kolom batch/expiry, perilaku FEFO).

---

## 3. Master Data

CRUD standar. Semua mendukung list (filter + pagination), detail, create, update, delete (soft-delete bila sudah dipakai, §1).

### 3.1 Products
| Method | Endpoint |
|---|---|
| GET | `/master/products` · filter `?track_level=ITEM&status=ACTIVE&q=` |
| GET | `/master/products/{id}` (termasuk packaging) |
| POST | `/master/products` |
| PATCH | `/master/products/{id}` · semua field kecuali `sku`, + `status: ACTIVE\|INACTIVE` |
| DELETE | `/master/products/{id}` → `{id, deleted}` (→ INACTIVE, `deleted:false` bila ada histori) |
| GET | `/master/products/{id}/packaging` · daftar level UOM |
| POST | `/master/products/{id}/packaging` · tambah level konversi |
| PATCH | `/master/products/{id}/packaging/{pkg_id}` · ubah `barcode`/`qty_in_base` (level base tetap 1) |
| DELETE | `/master/products/{id}/packaging/{pkg_id}` (ditolak bila UOM sudah dipakai transaksi/order) |

`DELETE /master/products/{id}` (hak `can_delete` menu `master_products`): baris produk dikunci (`FOR UPDATE`) lalu dicek pemakaian. **Punya histori** — dirujuk `stock_move`, `quant`, `stock_reservation`, `operation_line`, `operation_cursor.pending_product_id`, `purchase_order_line`, `sales_order_line`, `batch`, `handling_unit`, atau `serial` (semua FK `RESTRICT`) → `status=INACTIVE`, respons `deleted:false`, audit `DEACTIVATE` (idempoten bila sudah INACTIVE). **Belum pernah dipakai** → hapus permanen (packaging ikut, FK `CASCADE`), `deleted:true`, audit `DELETE`. Produk INACTIVE tetap tampil di daftar (`?status=INACTIVE`), detail, laporan & histori, tetapi ditolak `422 UNKNOWN_PRODUCT` untuk transaksi/master baru (ingest PO/SO, scan, transfer ad-hoc, batch baru). Aktifkan kembali lewat `PATCH {status:"ACTIVE"}`.

Contoh `POST /master/products`:
```json
{ "sku":"MED-001","name":"Paracetamol 500mg",
  "base_uom_id":"…(Pcs)","sale_uom_id":"…(Carton)",
  "track_level":"ITEM",
  "use_batch":true,"use_expiry":true,"use_fefo":true,"use_serial":true,"use_lpn":true }
```
Validasi: `sku` unik; `base_uom`/`sale_uom` ada; packaging base (qty 1) otomatis dibuat; `track_level=ITEM` ⇒ semua `qty_in_base` bilangan bulat. Mengubah `use_batch/use_expiry/use_serial/track_level` ditolak bila produk sudah punya quant (`409 CONFLICT`). Mengubah `qty_in_base` packaging tidak mengubah isi karton yang sudah ada (carton break memakai qty quant).

### 3.2 UOM — `/master/uom` *(menu `master_uom`)*
`GET /master/uom` = lookup (form produk); `?manage=true` = daftar kelola (+`used`). `POST {name, category?}` · `PATCH /master/uom/{id}` · `DELETE /master/uom/{id}` → `409 IN_USE` bila dirujuk produk/packaging/transaksi. Nama unik (case-insensitive) → `409 CODE_TAKEN`. (Packaging per produk ada di 3.1.)

### 3.3 Sites & Warehouses *(menu `master_sites`, flag `enable_multi_site`)*
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/master/sites` | Site + gudangnya (`warehouses[]` + jumlah lokasi). Juga terbuka bagi pemegang view `config_settings` |
| POST | `/master/sites` | `{code, name, address?}` |
| PATCH / DELETE | `/master/sites/{id}` | `DELETE` ditolak `409 IN_USE` bila masih punya gudang |
| POST | `/master/warehouses` | `{site_id, code, name, timezone}` (IANA; tak dikenal → `400`) |
| PATCH | `/master/warehouses/{id}` | `{name?, timezone?}` — hak edit `master_sites` **atau** `config_settings` (FR-MD-11 untuk instalasi satu gudang, m4 I-53) |
| DELETE | `/master/warehouses/{id}` | `409 IN_USE` bila dirujuk lokasi/operasi/user |

Endpoint tulis site/gudang (kecuali `PATCH` gudang) → `404` bila `enable_multi_site` mati. `GET /master/warehouses` (tanpa flag) tetap tersedia sebagai **lookup** gudang bagi pemegang view `master_locations`/`inbound_receipts`/`inventory_stock`/`master_sites`/`internal_transfers`/`internal_quarantine`.

### 3.4 Locations — `/master/locations`
`GET/POST/PATCH/DELETE /master/locations` · filter `?warehouse_id=&type=&is_usable=`. Hierarki via `parent_id`. Lokasi sistem read-only. `POST /master/locations/{id}/print-label` → ZPL label bin.

### 3.5 Partners — `/master/partners`
`GET/POST/PATCH/DELETE /master/partners` · filter `?type=CUSTOMER|SUPPLIER`. `code` = `partner_ref` ERP.

### 3.6 Batches — `/master/batches` *(flag `enable_batch`)*
`GET /master/batches` · filter `?product_id=&expiry_before=&q=` → `{id, product, batch_no, mfg_date, expiry_date, on_hand_base, used}`. `POST {product_id, batch_no, mfg_date?, expiry_date?}`: produk harus ber-batch & ACTIVE (`422 UNKNOWN_PRODUCT`); expiry wajib bila expiry efektif (`422 MISSING_EXPIRY`); ganda → `409 CODE_TAKEN`. `PATCH /master/batches/{id} {mfg_date?, expiry_date?}` (koreksi; selalu diaudit). `DELETE` hanya bila belum dirujuk stok/ledger/unit (`409 IN_USE`).

### 3.7 Reason Codes — `/master/reason-codes`
`GET` · filter `?applies_to=SCRAP|ISSUE|ADJUST|QA|FEFO_OVERRIDE`. Tanpa parameter lain = **lookup** reason aktif bagi pemegang view `master_reason_codes`/`internal_quarantine`/`outbound_scrap`/`inventory_adjustment`; `?include_inactive=true` = daftar kelola (+`is_active`, `used`; menu `master_reason_codes`). `POST {code, name, applies_to}` · `PATCH /{id} {name?, is_active?}` · `DELETE /{id}`: terpakai → dinonaktifkan (`deleted:false`), belum → dihapus.

---

## 4. Operations — Kerangka Umum

Semua proses gudang adalah **operation** dengan pola sama. Endpoint per modul (Bab 5–8) hanya membuat operation dengan `operation_type` tertentu (atau menjalankan operasi instan); **eksekusi & transisi memakai endpoint generik** di bawah. RBAC endpoint generik mengikuti §1.4.

### 4.1 Resource operation

| Method | Endpoint | Aksi |
|---|---|---|
| GET | `/operations` | List · filter `?direction=&status=&type=&warehouse_id=&assigned_to=me&date=today` |
| GET | `/operations/my-tasks` | Tugas handheld: operasi READY/IN_PROGRESS di `warehouse_id` yang boleh diakses user (hak edit menu optype), belum di-claim orang lain; **plus** operasi di tahap delivery bila user memegang `confirm_menu_code` (D-29); urut milik sendiri → `delivery_date` SO → `created_at` |
| GET | `/operations/{id}` | Detail + lines + reservasi + `next_expected` + `ETag` |
| GET | `/operations/{id}/lines` | Daftar baris |
| POST | `/operations/{id}/lines` | Tambah baris — **hanya DRAFT** (M2: transfer dokumen; body `{lines: [{unit_code} | {location_code, sku, qty, uom?, batch_no?}]}`) |
| PATCH | `/operations/{id}/lines/{lineId}` | Ubah baris — **hanya DRAFT** |
| DELETE | `/operations/{id}/lines/{lineId}` | Hapus baris — **hanya DRAFT** (READY → `reopen` dulu) |
| POST | `/operations/{id}/lines/{lineId}/close` | Tutup line saat IN_PROGRESS dengan qty yang sudah discan (tanpa body, M2 I-17); sisa reservasi di-release (A-3). Respons `{version, released_base, progress, next_expected}` |

### 4.2 Transisi status (state machine SM#1)

| Method | Endpoint | Transisi | Efek |
|---|---|---|---|
| POST | `/operations/{id}/ready` | Draft → Ready | Validasi kelengkapan per direction (behavioral §3); stok belum berubah |
| POST | `/operations/{id}/reopen` | Ready → Draft | Buka kembali untuk edit line (tanpa reservasi) |
| POST | `/operations/{id}/claim` | (tetap) | Set `assigned_to`=user; sudah di-claim user lain → `409 CLAIMED_BY_OTHER` |
| POST | `/operations/{id}/unclaim` | (tetap) | Lepas klaim (milik sendiri: edit; orang lain: delete) |
| POST | `/operations/{id}/start` | Ready → In progress | OUTGOING/INTERNAL: **reserve** → `stock_reservation` per line, quant → RESERVED, `so_line.qty_reserved` naik. INCOMING: tanpa reserve |
| POST | `/operations/{id}/submit` | (IN_PROGRESS) | **Hanya INCOMING**: tutup fase scan unit, generate HU/LPN/serial `PENDING` |
| POST | `/operations/{id}/approve` | (READY/IN_PROGRESS) | Bila `require_approval`; menu `approve_menu_code`; approver ≠ pembuat |
| POST | `/operations/{id}/confirm` | In progress → Done | **Atomik + ber-lock:** `stock_move` + `quant`/HU/serial + reservasi CONSUMED + `qty_delivered`/`qty_received` + outbox |
| POST | `/operations/{id}/cancel` | *→ Cancelled | Reservasi RELEASED (qty kembali persis ke status asal); HU/serial PENDING → VOID |

Transisi tak sah → `409 INVALID_TRANSITION`. **Konkurensi (wajib):** protokol lock behavioral A-5 (operation → order line → advisory per produk → quant). Transisi dari handheld wajib `Idempotency-Key`; `If-Match` opsional.

### 4.3 Endpoint scan (IN_PROGRESS) — kontrak lengkap di `flow-steps-wms-baseline.md`

```
POST /operations/{id}/scan         Idempotency-Key: <uuid per scan>
{ "expected_step":"SCAN_BIN", "code":"A-01-01-01",          // jenis kode ditentukan SERVER (flow-steps §4)
  "qty":"1", "uom_id":"…(ENTER_QTY)",
  "batch": { "batch_no":"B2409", "expiry_date":"2027-06-30" },   // ENTER_BATCH
  "fefo_override_reason":"FEFO_NEAR_BIN (opsional, behavioral D-10)" }
```
Respons:
```json
{ "success": true,
  "data": { "line": { … }, "progress": { "lines_done": 3, "lines_total": 8 },
            "next_expected": { "step": "SCAN_BIN", "alternatives": ["CLOSE_LINE"], "line_id": "…",
                               "hint": { "role": "SOURCE", "location_code": "A-01-01-02", "batch_no": "B2407", "qty_remaining": "40" },
                               "can_confirm": true } },
  "meta": { "warnings": [] } }
```
- Operasi harus di-claim oleh user ini (behavioral D-13). Server me-lock `operation` sebentar per scan sehingga scan paralel diserialkan; klien juga mengirim scan satu per satu.
- `scan_type` **dihapus**. Server mengklasifikasi kode dengan urutan lokasi → HU → serial → barcode produk. Kode tak dikenal/ambigu/salah jenis → `422 UNKNOWN_CODE / AMBIGUOUS_CODE / WRONG_SCAN_TYPE`. `expected_step` basi → `409 STEP_CHANGED` + `next_expected` terbaru.
- Enum `next_expected.step` (flow-steps §3): `START`, `SCAN_UNIT`, `ENTER_BATCH`, `ENTER_QTY`, `SUBMIT`, `PRINT_LABEL`, `SCAN_LPN`, `SCAN_CARTON`, `SCAN_SERIAL`, `SCAN_BIN`, `SCAN_STAGING`, `SCAN_DOCK`, `CLOSE_LINE`, `SELECT_REASON`, `AWAIT_APPROVAL`, `CONFIRM`, `DONE`.
- `GET /lookup/code?code=&warehouse_id=` (read-only, **baru**): resolusi kode untuk operasi instan client-driven (flow-steps §7.8). Respons `{code, kind, location?|hu?|serial?|product?, stock[], suggested_location}` — `stock` = isi unit di gudang (lokasi, status, qty, batch), `suggested_location` = bin asal sebelum hold (unit QUARANTINE). RBAC: view salah satu `internal_*`/`inventory_stock`.
- Respons scan (M3) membawa `data.warnings[]` (disalin ke `meta.warnings`) — mis. `FEFO_OVERRIDDEN`. `422 FEFO_ACK_REQUIRED` membawa `details {sku, suggested_expiry, scanned_expiry}`; klien mengirim ulang scan yang sama + `fefo_override_reason` dengan `Idempotency-Key` **baru**. `409 NOT_RESERVED` pada F-OUT membawa `details.cause` (`OTHER_OPERATION`, `EXCEEDS_REMAINING`, `PRODUCT_MISMATCH`, `STATUS`, `EMPTY`).
- Detail operasi (M3) menambah `sales_order {id, erp_ref, status, partner, delivery_date}`, `staging_location`, `dock_location`, `require_approval`, `approved_by`, `approved_at`; line membawa `so_line_id`; hint F-OUT membawa `qty_at_bin`. Summary (list & my-tasks) menambah `partner` dan `delivery_date`.
- Detail operasi (M2) menambah `mode` (`document`/`adhoc`, INTERNAL), `dest_warehouse`, `parent_operation`, `children[]` (receive inter-site), `in_transit_base` (dispatch DONE), `reservations[]` (`qty`, `qty_done`, `source_status`, `status`); unit/line ber-HU membawa `parent_code` (LPN induk karton).

---

## 5. Inbound

### 5.0 Purchase Orders — menu `inbound_orders`
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/inbound/orders` | List PO · filter `?status=&partner_ref=` |
| POST | `/inbound/orders` | Terima PO dari ERP (idempoten `erp_ref`): baru → `201`, ulang isi sama → `200` resource lama |
| GET | `/inbound/orders/{id}` | Detail PO + lines (`qty`, `qty_received`, `erp_qty`, `erp_uom`) |
| PATCH | `/inbound/orders/{id}` | ERP mengubah PO (tambah/ubah line; qty tak boleh < `qty_received`) |
| POST | `/inbound/orders/{id}/cancel` | ERP membatalkan PO; ditolak `422 ORDER_IN_EXECUTION` bila ada receipt IN_PROGRESS |

`POST /inbound/orders` (kontrak lengkap di erp-integration §4): `{ "erp_ref":"PO-123","partner_ref":"SUP-01","order_date":"2026-09-20","expected_date":"2026-09-28","lines":[{"line_no":1,"sku":"MED-001","qty":"1000","uom":"Pcs"}] }`.

### 5.1 Receipts — menu `inbound_receipts`
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/inbound/receipts` | List operasi INCOMING (RCV_*) |
| POST | `/inbound/receipts` | Buat receipt (DRAFT) |
| GET | `/inbound/receipts/{id}` | Detail |

`POST` body: `{ "operation_type_code":"RCV_SUPPLIER", "warehouse_id":"…", "source_doc_type":"PURCHASE_ORDER", "source_doc_id":"…(po.id)" }`. Alur: `ready → claim → start → scan unit (CARTON/SERIAL) → submit → print-lpn → scan LPN → scan BIN → confirm` (behavioral §5.1). Line INCOMING lahir dari scan, masing-masing menaut `po_line_id`.

### 5.2 Putaway — menu `inbound_putaway` (menu confirm RCV_*)
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/inbound/putaway` | Receipt yang sudah `submit` & belum Done |
| POST | `/operations/{id}/scan` | Scan LPN → scan bin tujuan |
| POST | `/operations/{id}/confirm` | Selesaikan (stok **+**, quant di bin) |

Validasi bin: tipe `STOCK`, `is_usable=true`, warehouse sama, LPN milik operasi. *(Kapasitas bin = fase 2, OQ-1.)*

### 5.3 Print label LPN *(flag `enable_lpn`)*
`POST /inbound/receipts/{id}/print-lpn {hu_ids?}` → `{ "format":"ZPL", "payload":"^XA…", "print_service_url":"…" }` atau PDF. Hanya setelah `submit`; cetak ulang idempoten (tidak menerbitkan kode baru), dicatat `audit_log` (`action=REPRINT`). Detail di labeling.

---

## 6. Internal

### 6.1 Transfers (bin-to-bin & inter-site) — menu `internal_transfers`
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/internal/transfers` | List transfer · filter `?type=&status=&in_transit=true` |
| POST | `/internal/transfers` | Buat transfer (`INT_TRANSFER` atau `INT_INTERSITE`; inter-site wajib `dest_warehouse_id`). `{mode:"adhoc"}` (handheld) = buat operasi kosong yang langsung READY→IN_PROGRESS dan di-claim; line & reservasi lahir dari scan unit pertama |
| POST | `/internal/transfers/{id}/receive` | Buat operasi receive (anak) dari dispatch DONE; hanya di `dest_warehouse_id` |

Alur via `start` (reserve) → `scan` (source bin → unit → dest bin) → `confirm`. Inter-site = 2 operasi (dispatch ke `IN_TRANSIT`, receive dari `IN_TRANSIT`), tertaut `parent_operation_id`. Sisa tak diterima tetap `IN_TRANSIT` (lihat `?in_transit=true`).

`POST /internal/transfers` (M2):
```json
{ "operation_type_code": "INT_TRANSFER | INT_INTERSITE", "mode": "document | adhoc",
  "warehouse_id": "…(default gudang user)", "dest_warehouse_id": "…(wajib INT_INTERSITE)",
  "lines": [ { "unit_code": "LPN-0000007" },
             { "location_code": "A-01-01-01", "sku": "MED-001", "qty": "50", "uom": "Pcs", "batch_no": "B2409" } ] }
```
- `unit_code` → satu line per quant isi unit (LPN termasuk karton anak); unit di gudang lain → `409 WRONG_WAREHOUSE`, sebagian RESERVED → `409 UNIT_RESERVED`. Qty lepas → satu line (UOM transaksi → base).
- `mode:"adhoc"` hanya INT_TRANSFER tanpa `lines`; operasi langsung IN_PROGRESS & di-claim pembuat (`201`). `Idempotency-Key` dihormati.
- `GET /internal/transfers` → summary + `dest_warehouse`, `parent`, `in_transit_base`; filter `?type=&status=&warehouse_id=&in_transit=true|false&q=`.
- `POST /internal/transfers/{id}/receive` `{warehouse_id?}` → operasi receive **READY** (line = outstanding dispatch di IN-TRANSIT, behavioral D-21). Dispatch belum DONE → `409 INVALID_TRANSITION`; gudang ≠ tujuan → `409 WRONG_WAREHOUSE`; receive lain masih aktif → `422 ORDER_IN_EXECUTION`; tak ada sisa → `422 NO_LINES`.

### 6.2 Carton Break — menu `internal_carton_break` *(flag `enable_carton_break`)*
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/internal/carton-break` | Riwayat (operasi `INT_CARTON_BREAK`) |
| POST | `/internal/carton-break/preview` | Cek isi karton sebelum eksekusi |
| POST | `/internal/carton-break` | **Operasi instan** (create+confirm dalam satu TX; `Idempotency-Key` wajib) |

`POST /preview` `{ "carton_code":"CTN-0007" }` →
```json
{ "carton_code":"CTN-0007","product":{"sku":"MED-001","track_level":"ITEM"},
  "batch":"B2409","expiry_date":"2027-06-30",
  "items_to_generate":"100","location":"A-01-01-01","status":"INTACT" }
```
`items_to_generate` = qty quant karton (base), bukan packaging saat ini. Validasi (`422`): `NOT_ITEM_LEVEL`, `INVALID_HU` (bukan CARTON/INTACT/quant RESERVED), `FRACTIONAL_CONTENT`.

`POST /internal/carton-break` `{ "carton_code":"CTN-0007", "generate_serials":true }` → `201 { operation: {id, ref_no:"CBR-2026-00012", status:"DONE", operation_type}, moves:[…], serials:[…] }`. HU karton → `BROKEN`; N quant item lahir di bin sama tanpa HU; ledger 1 konsumsi + produksi via `VIRT-TRANSFORM`. `generate_serials` default = flag Pack S/N efektif produk; `true` pada produk tanpa serial → `400`. `Idempotency-Key` wajib (`400` bila tidak ada). Flag `enable_carton_break` mati → `404` (juga preview & riwayat). Carton S/N (HU CARTON) terbit saat submit receipt (behavioral D-17).

### 6.3 Quarantine / QA — menu `internal_quarantine` *(flag `enable_quarantine`)*
Semua **operasi instan** (`Idempotency-Key` wajib → `400`), body `{ "units":["LPN-…","SN-…"], "lines":[{"location_code","sku","qty","uom?","batch_no?"}], "dest_location_code":"QA-01", "reason_code":"…", "warehouse_id":"…(default gudang user)" }` — `units` dan/atau `lines` (qty lepas, FEFO, behavioral D-22). Respons `201 {operation, moves[]}`. Tujuan: hold opsional, release wajib (`400`), reject/mark-damaged ditolak (`400`); bin tujuan STOCK/QUARANTINE (`INVALID_BIN`). Flag `enable_quarantine` mati → `404`:

| Method | Endpoint | Optype · status |
|---|---|---|
| POST | `/internal/quarantine/hold` | `INT_QA_HOLD` · Available → Quarantine (in-place / pindah ke bin QA) |
| POST | `/internal/quarantine/release` | `INT_QA_RELEASE` · Quarantine → Available (dest wajib; respons preview menyarankan bin asal) |
| POST | `/internal/quarantine/reject` | `INT_QA_REJECT` · Quarantine → Damaged |
| POST | `/internal/quarantine/mark-damaged` | `INT_MARK_DAMAGED` · Available → Damaged |
| GET | `/internal/quarantine/units` | Unit berstatus QUARANTINE/DAMAGED · filter `?warehouse_id=&status=` · baris stok + `suggested_location` (bin asal move hold terakhir) |

---

## 7. Outbound

### 7.1 Sales Orders — menu `outbound_orders`
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/outbound/orders` | List SO · filter `?status=&partner_ref=&delivery_date=` |
| POST | `/outbound/orders` | Terima SO dari ERP (idempoten `erp_ref`) |
| GET | `/outbound/orders/{id}` | Detail SO + lines (`qty`, `qty_reserved`, `qty_delivered`) |
| PATCH | `/outbound/orders/{id}` | ERP mengubah SO (qty line tak boleh < `qty_reserved + qty_delivered`) |
| POST | `/outbound/orders/{id}/cancel` | ERP membatalkan SO; `422 ORDER_IN_EXECUTION` bila ada pick list IN_PROGRESS (operasi READY ikut dibatalkan) |
| POST | `/outbound/orders/{id}/generate-picklist` | Buat operasi `OUT_DELIVERY` (READY) untuk sisa belum teralokasi **yang stoknya tersedia** (behavioral D-27) — **RBAC: create pada `outbound_picking`** (bukan service account ERP) |

`GET /outbound/orders` → summary + `line_count`, `qty_total`, `qty_reserved_total`, `qty_delivered_total`; filter `?status=&partner_ref=&delivery_date=&open=true|false&q=`; urut `delivery_date` terdekat. Status SO = fungsi baris (behavioral D-28).

`POST …/generate-picklist` `{ "warehouse_id": "…(default gudang user)" }` → `201 { operation: {…detail, status:"READY", ref_no:"DLV-2026-00001"}, skipped: [{line_no, sku, remaining, available:"0"}] }`. Line = base UOM, `so_line_id` terisi, tanpa lokasi/batch. Semua baris sudah teralokasi/terkirim → `422 NO_LINES`; ada sisa tetapi tak ada stok → `422 INSUFFICIENT_STOCK` (+`details.skipped`); SO `CANCELLED`/`DONE` → `422 ORDER_NOT_OPEN`. `Idempotency-Key` dihormati. Pick list tidak diedit: `reopen` → `409 INVALID_TRANSITION`.

### 7.2 Picking — menu `outbound_picking` (aksi umum OUT_DELIVERY)
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/outbound/picking` | Pick list aktif (READY/IN_PROGRESS), urut `delivery_date` SO; `?status=` untuk riwayat |
| GET | `/outbound/picking/{id}` | Detail operasi + `suggestions[] {line_id, location_code, batch_no, expiry_date, qty}` + `shortages[] {line_id, short}`. READY: saran dihitung dari stok saat ini (non-mengikat, tanpa reservasi); IN_PROGRESS: saran = reservasi yang belum discan. RBAC view `outbound_picking` atau `outbound_deliveries` |
| POST | `/operations/{id}/claim` · `/start` | Klaim lalu Ready → In progress (**reserve** per line; FEFO/expiry divalidasi ulang) |
| POST | `/operations/{id}/scan` | Scan bin → LPN/Carton/Serial (mode full/partial/loose) → staging |
| POST | `/operations/{id}/lines/{lineId}/close` | Tutup line; qty < reserved → sisa di-release |

**Tidak ada confirm di tahap picking** — picking & delivery adalah satu operasi (behavioral D-3); confirm di §7.3. Validasi scan: match SO line (produk/batch/qty), FEFO (`block` → `FEFO_VIOLATION`; `warn` → `FEFO_ACK_REQUIRED` sampai `fefo_override_reason` dikirim), expiry & shelf-life, status RESERVED. Saran batch non-mengikat: batch valid lain → reservasi di-swap atomik.

### 7.3 Deliveries — menu `outbound_deliveries` (menu confirm OUT_DELIVERY)
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/outbound/deliveries` | Antrean **tahap delivery** (behavioral D-29): semua line tertutup, ada qty terpick, staging sudah discan (atau gudang tanpa STAGING). `?status=DONE` = riwayat |
| POST | `/operations/{id}/scan` | Scan lokasi loading dock (`expected_step:"SCAN_DOCK"`) — hak `outbound_picking` atau `outbound_deliveries`; pemegang hak Deliveries mengambil alih klaim |
| POST | `/operations/{id}/confirm` | Kirim → `qty_done` reservasi dikonsumsi ke `VIRT-CUSTOMER` (stok **−**), HU utuh `SHIPPED`, outbox `SHIPMENT_CONFIRMED` |
| POST | `/outbound/deliveries/{id}/document` | Data surat jalan (DTO: header SO/customer, baris + batch + unit) untuk halaman cetak FE (`/outbound/deliveries/{id}/print`); hanya setelah DONE (`409`); tiap panggilan diaudit `PRINT`. PDF sisi server = revisit (m3 I-27) |

### 7.4 Scrap / Issue — menu `outbound_scrap`; approval menu `outbound_scrap_approval`
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/outbound/scrap` | List scrap/issue |
| POST | `/outbound/scrap` | Buat operasi DRAFT: `{ operation_type_code: "OUT_SCRAP"\|"OUT_ISSUE_PROD", reason_code, warehouse_id?, note?, lines[] }` — `lines` berbentuk line transfer dokumen (§6.1: `unit_code` atau `location_code+sku+qty`). Reason kosong / tidak cocok tujuan (`SCRAP`→`applies_to SCRAP`, `PRODUCTION`→`ISSUE`) → `422 MISSING_REASON`. Line diubah lewat `POST/DELETE /operations/{id}/lines` saat DRAFT |
| GET | `/outbound/scrap-approval` | Antrean READY/IN_PROGRESS yang `require_approval` & belum di-approve (menu approval) |
| POST | `/operations/{id}/approve` | Approve — RBAC edit pada `outbound_scrap_approval`; pembuat → `403 SELF_APPROVAL` |
| POST | `/operations/{id}/confirm` | Konsumsi stok (stok **−**), `reason_code_id` di ledger; tanpa approval → `422 NEEDS_APPROVAL`. `reopen` menggugurkan approval (behavioral D-31) |

---

## 8. Inventory

### 8.1 Stock on Hand — menu `inventory_stock`
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/inventory/stock` | Quant · filter `?product_id=&location_id=&warehouse_id=&status=&batch_id=&expiry_before=` |
| GET | `/inventory/stock/summary` | Roll-up per produk (base UOM → tampilan multi-level UOM) per status |

Response quant: `{ "product":"MED-001","status":"AVAILABLE","qty_base":"250","display":[{"uom":"Carton","qty":"2"},{"uom":"Pcs","qty":"50"}] }` (`display` berurutan level menurun).

### 8.2 Handling Units — menu `inventory_units`
`GET /inventory/handling-units` · filter `?type=PALLET|CARTON&status=&warehouse_id=&location_id=&q=` → `{code, hu_type, status, product, batch, parent_code, location (dari quant, termasuk karton anak), warehouse_code, qty_base, children}`. `GET /inventory/handling-units/{code}` → + `children_units[]`, `contents[]` (quant sendiri + karton anak), `born_serials[]` (serial hasil carton break, maks 200) + `born_serials_total`, `display` (roll-up UOM).

### 8.3 Traceability Lookup — menu `inventory_trace`
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/inventory/trace/{code}` | Auto-deteksi: serial → HU → `batch_no`. Kode asing → `404 UNKNOWN_CODE` |
| GET | `/inventory/trace/serial/{code}` | Alias untuk serial |
| GET | `/inventory/trace/batch/{id}` | Jejak satu batch (dipakai setelah memilih dari `matches[]`) |

Respons (sama dengan `/reports/traceability`, behavioral D-38): `{code, kind: SERIAL|HU|BATCH, product, batch, genealogy[] (serial → karton asal → pallet), matches[] (batch_no cocok > 1 produk), positions[] (quant kini, maks 200 + `positions_truncated`), sources[] & destinations[] (move dari/ke lokasi endpoint per operasi + `order_ref` + `partner`), events[] (baris ledger kronologis, maks 200 + `events_truncated`)}`. Jejak HU = move ber-identitas HU itu (pengambilan sebagian ber-`hu_id` NULL per D-30 tampak di trace batch / Movement).

### 8.4 Stock Adjustment — menu `inventory_adjustment`
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/inventory/adjustment` | Riwayat = baris ledger operasi `ADJ_*` (keyset, bentuk §10 movement) |
| POST | `/inventory/adjustment/preview` | Body = sasaran + nilai (tanpa reason) → `{target, free, reserved, on_hand, delta, on_hand_after, display}`; tanpa lock & tanpa tulis |
| POST | `/inventory/adjustment` | **Operasi instan** (`Idempotency-Key` wajib → `400`) → `201 {operation, lines:[{target, on_hand_before, delta, on_hand_after}]}` |

Body (behavioral D-32/D-33): `{ "location_code":"A-01-01-02", "sku":"MED-001", "batch_no":"B2407", "unit_code":"LPN-…|SN-…", "status":"AVAILABLE|QUARANTINE|DAMAGED", "delta":"-5" | "counted_qty":"95", "reason_code":"COUNT_LOSS", "note":"…", "warehouse_id":"…", "dispatch_id":"…" }` — sasaran = `unit_code` **atau** `location_code`+`sku`(+`batch_no`); nilai = tepat satu dari `delta`/`counted_qty`. `dispatch_id` = transit loss (lokasi IN-TRANSIT; tanpa sasaran & nilai = seluruh sisa dispatch). Error: `MISSING_REASON`, `MISSING_BATCH`, `INVALID_BIN`, `INVALID_HU`, `NO_CHANGE`, `NEGATIVE_STOCK`, `UNIT_RESERVED`, `DUPLICATE_SERIAL`, `FRACTIONAL_CONTENT`, `NO_LINES`.

---

## 9. Configuration

### 9.1 Operation Types — menu `config_operation_types`
`GET /config/operation-types` · filter `?direction=` → `{…, is_baseline, used, derivable, approvable}`. `POST {code, name, template_code, require_reason?, require_approval?}` — tipe turunan = salinan template keluarga receipt (`inbound_receipts`) atau scrap/issue (`outbound_scrap`) (behavioral D-37); template lain → `422`. `PATCH /{id} {name?, require_reason?, require_approval?, is_active?, allowed_from_status?}`: `require_approval` hanya keluarga scrap/issue (otomatis `approve_menu_code = outbound_scrap_approval`); `allowed_from_status` terkunci setelah dipakai (`409 LOCKED_AFTER_STOCK`). `DELETE /{id}`: baseline → `409 IN_USE`; terpakai → `is_active=false`; belum → dihapus.

### 9.2 App Settings — menu `config_settings`
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/config/settings` | Semua flag & kebijakan: `{key, value, data_type, description, group, rule, updated_at, updated_by}` — `rule` = aturan katalog (`boolean` / `enum{options}` / `integer{min,max}` / `url` / `pattern{required}`) |
| GET | `/config/settings/{key}` | Satu setting |
| PATCH | `/config/settings/{key}` | `{value}` — validasi katalog (`400`), dependensi (`422 SETTING_DEPENDENCY`), flag dengan data (`409 LOCKED_AFTER_STOCK`), key di luar katalog (`404`) + `audit_log` (behavioral D-36) |

Perubahan flag berlaku runtime di server seketika; menu di klien ikut berubah saat sesi berikutnya di-refresh (≤ TTL access token, frontend §7).

---

## 10. Reports

Semua read-only. Tampilan on-screen berpaginasi (keyset untuk movement). Export **async** (NFR-PERF-5):

| Method | Endpoint | Isi |
|---|---|---|
| GET | `/reports/stock` | Agregat quant per produk/gudang/lokasi/batch/status (+`units`, `serials`, roll-up) · `?warehouse_id=&status=&expiry_before=&q=` · offset |
| GET | `/reports/movement` | Ledger `stock_move` terbaru dulu · `?from=&to=` (tanggal kalender pada zona waktu gudang) `&warehouse_id=&product_id=&q=&type=&direction=&location_code=&batch_no=&unit_code=&reason_code=&user_id=` · keyset. Baris memuat operasi, `order_ref`, `partner`, produk, batch, unit, lokasi & status asal/tujuan, qty base, reason, user |
| GET | `/reports/traceability` | `?code=` atau `?batch_id=` → DTO §8.3 (menu `reports_traceability`) |
| GET | `/reports/in-transit` | Dispatch inter-site DONE ber-sisa > 0: gudang asal/tujuan, `age_days`, `outstanding_base`, `loss_base`, `lines[]`, `children[]` · hak view `reports_stock` (tab Stock Report) |
| POST | `/reports/{report}/export` | `report ∈ stock|movement|traceability|in-transit` · `{params, format:"csv|xlsx"}` → `202 {job_id, job}` (tabel `report_job`, dieksekusi `apps/worker`); params divalidasi seperti query on-screen |
| GET | `/reports/jobs` | 20 job terakhir milik pemohon |
| GET | `/reports/jobs/{id}` | Status job (`QUEUED|RUNNING|DONE|FAILED`, `error`); `DONE` → `download_url` sampai `expires_at`. Job orang lain → `404` |
| GET | `/reports/jobs/{id}/download` | Berkas (`Content-Disposition: attachment`); hanya pemohon; belum siap/kedaluwarsa → `404` |

RBAC export = `view` menu laporan terkait (diperiksa saat meminta, saat worker mengeksekusi, dan saat mengunduh). Export berjalan dalam satu snapshot (`REPEATABLE READ`); sel berawalan `= + - @` dinetralkan; batas `REPORT_MAX_ROWS`. UI mem-poll status job dan menampilkan toast unduh saat selesai.

---

## 11. Administration

### 11.1 Users — menu `admin_users`
`GET /admin/users` · filter `?q=&status=&role_id=&is_service=` → `{…, roles[], default_warehouse, active_sessions, last_login_at}`. `POST {username, full_name?, email?, password | is_service:true, role_ids[], default_warehouse_id?}` — user manusia wajib password sementara (kebijakan auth §2) dan lahir `must_change_password=true`; service account tanpa password. `PATCH /admin/users/{id} {full_name?, email?, default_warehouse_id?}`. **Tidak ada hard-delete** (user dirujuk ledger immutable). Aksi:
- `POST /admin/users/{id}/deactivate` · `POST /admin/users/{id}/activate`
- `POST /admin/users/{id}/reset-password` `{new_password}` (set `must_change_password`, cabut semua sesi)
- `POST /admin/users/{id}/lock` · `POST /admin/users/{id}/unlock`
- `PUT /admin/users/{id}/roles` `{role_ids[]}` · set daftar role (multi-role)
- `POST /admin/users/{id}/revoke-sessions` · cabut semua refresh token

Lock/deactivate berlaku pada request berikutnya (hak hanya untuk user ACTIVE); terhadap diri sendiri → `409 SELF_ACTION`. Perubahan yang menyisakan nol administrator → `409 LAST_ADMIN` (behavioral D-35).

### 11.2 Roles — menu `admin_roles`
`GET/POST/PATCH/DELETE /admin/roles` — `{code, name, description?}`; `code` tak bisa diubah; `DELETE` ditolak `409 IN_USE` bila masih dipakai user. `GET` juga terbuka bagi pemegang view `admin_users`/`admin_access` (form user & matriks).

### 11.3 Access Control — menu `admin_access`
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/admin/access/matrix?role_id=` | `{role, entries[]}` — matriks role × menu (CRUD flag) |
| PUT | `/admin/access/matrix` | Upsert entri yang dikirim (hapus hak = kirim baris all-false) + `audit_log` berisi entri yang berubah; menu asing → `400 UNKNOWN_MENU` |
| GET | `/admin/menus` | Registri kode menu `{code, name, route, parent_code, sort_order}` (label dari katalog FE via i18n) |

`PUT` body: `{ "role_id":"…", "entries":[{"menu_code":"inbound_receipts","can_view":true,"can_create":false,"can_edit":false,"can_delete":false}] }`.

### 11.4 Audit Log — menu `admin_audit`
`GET /admin/audit` · filter `?user_id=&entity=&action=&source=AUDIT|OPERATION&from=&to=` · keyset. Read-only. Baris: `{key, at, source, user, entity, entity_id, entity_ref, action, before, after, ip}` — `AUDIT` = `audit_log`; `OPERATION` = peristiwa operasi turunan `CREATE`/`APPROVE`/`CANCEL`/`CONFIRM` (`entity_ref` = `ref_no`; `after` memuat tipe, gudang, dan untuk confirm jumlah baris & qty ledger) — behavioral D-34. Aksi tulis admin (user, role, matriks RBAC, setting, operation type, reason code, master, api key, retry outbox) **wajib** menulis `audit_log` dalam transaksi yang sama.

### 11.5 API Keys & Integration — menu `admin_integration`
| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/admin/api-keys` | Daftar key (`key_prefix`, status, service account, `last_used_at`) — tanpa nilai mentah |
| POST | `/admin/api-keys` | `{name, service_user_id, expires_at?}` → `201 {…, key:"wms_…"}`; `key` hanya muncul di respons ini; yang disimpan SHA-256. Bukan service account aktif → `400` |
| POST | `/admin/api-keys/{id}/revoke` | Cabut key |
| GET | `/admin/integration-events` | Outbox · filter `?status=PENDING|SENT|FAILED|DEAD&event_type=`; `meta.summary` = jumlah per status |
| GET | `/admin/integration-events` (meta) | `meta.gateway = {configured, host, signed, max_attempts}` — konfigurasi gateway proses web, **tanpa** URL lengkap maupun rahasia (m5 D-39) |
| POST | `/admin/integration-events/{id}/retry` | `FAILED`/`DEAD` → `PENDING` (`attempts=0`); status lain → `409 INVALID_TRANSITION` |
| POST | `/admin/integration-events/retry` | `{status?: "DEAD"\|"FAILED"}` (default `DEAD`) → semua event ber-status itu ke `PENDING`, `attempts=0` → `{status, retried}`; audit `RETRY_ALL` (m5 I-60) |
| GET | `/admin/reconciliation` | `?kind=OVERDUE_RECEIPT\|OVERDUE_DELIVERY\|CALLBACK_DEAD\|CALLBACK_FAILED\|CALLBACK_STUCK&limit=` (maks 500). Baris: `{kind, order_type, order_id, erp_ref, ref_no, partner, order_status, due_date, days_late, qty_ordered, qty_done, event}`; `meta = {as_of, today, timezone, stuck_after_minutes, summary}` — ringkasan selalu menyeluruh (m5 D-41). Service account → `403 SERVICE_ACCOUNT_UI` |

### 11.6 Dashboard — menu `dashboard`
`GET /dashboard/summary` → hitungan operasional gudang default user (behavioral D-38b): `tasks[]` (READY/IN_PROGRESS per menu optype), `awaiting_approval`, `stock[]` (SKU & baris per status), `expiry` (batch kedaluwarsa / ≤ 30 hari), `in_transit` (dispatch ber-sisa, umur tertua), `orders`, `done_today`, dan `outbox` (hanya bagi pemegang view `admin_integration`, selain itu `null`).

---

## 12. Ringkasan Seluruh Endpoint

| Modul | Jumlah endpoint utama | Catatan |
|---|---|---|
| Auth | 5 | login/refresh/logout/me/change-password |
| Master Data | ~40 | CRUD 7 resource + packaging + sites/warehouses + label bin |
| Operations (generik) | 16 | lifecycle + claim + submit + scan + line close + my-tasks |
| Inbound | 10 | purchase orders (+patch/cancel), receipts, putaway, print LPN |
| Internal | 12 | transfer, inter-site receive, carton break, quarantine (4 aksi + units) |
| Outbound | 15 | orders (+patch/cancel), picklist, picking, deliveries, scrap, approval |
| Inventory | 10 | stock, HU, trace, adjustment (+preview) |
| Configuration | 6 | operation types, settings |
| Reports | 8 | stock, movement, traceability, in-transit, export async, jobs, download |
| Administration | ~22 | users, roles, access matrix, audit, api key, integration events, dashboard |

### Prinsip yang konsisten dengan desain

- **Satu lifecycle, banyak proses** — endpoint modul hanya membuat operation; transisi & scan memakai `/operations/{id}/…`.
- **RBAC per request, per operation type** — endpoint generik dicek terhadap menu milik optype (§1.4); deny-by-default.
- **Confirm = titik perubahan stok** — hanya `confirm` (termasuk operasi instan) yang menulis ledger + update quant, atomik & ber-lock.
- **Konkurensi & idempotensi ditegakkan server** — protokol lock A-5; `Idempotency-Key` wajib untuk handheld; oversell/double-confirm ditolak `409`/`422`.
- **Reservasi eksplisit per line** — `start` menulis `stock_reservation`; `cancel`/line close melepas presisi; `confirm` meng-CONSUME.
- **Error = `code` + `reason`** — UI memetakan `reason` ke pesan & aksi.
- **Audit menyeluruh** — stok via `stock_move` (termasuk perubahan status), admin/config/auth via `audit_log`. Keduanya append-only di level DB.
