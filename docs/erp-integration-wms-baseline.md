# ERP Integration — WMS Baseline

**Kontrak integrasi ERP (PO/SO masuk, callback status keluar) · merealisasikan OQ-5**

Versi: 1.2 · 13 Oktober 2026 · Pembaruan 1.2 (implementasi M5, `m5-integration-hardening-wms-baseline.md` D-39..D-41): kontrak kawat callback (§6.1: amplop, header, tanda tangan HMAC, 2xx saja, redirect tak diikuti), backoff & batas percobaan dirinci, ERP tak melayani menghentikan putaran, urutan per order memakai waktu tulis event, retry massal, rekonsiliasi lima jenis. Sebelumnya 1.1 · 24 September 2026: PATCH/cancel order, `line_no`, qty asli ERP vs base, outbox multi-worker (`SKIP LOCKED`) + `X-Event-Id` + urutan per order, role ERP dibatasi ke PO/SO.

> Topik: bagaimana ERP eksternal dan WMS bertukar Purchase Order, Sales Order, dan status. Tabel terkait: `purchase_order(_line)`, `sales_order(_line)`, `integration_event` (outbox), `api_key`. Auth mesin detail di `auth-session-wms-baseline.md`.

---

## 1. Prinsip & arah (dikunci — OQ-5)

- **Masuk (ERP → WMS):** ERP **push** via REST saat PO/SO dibuat/diubah. Endpoint: `POST /inbound/orders`, `POST /outbound/orders`, `PATCH /{inbound|outbound}/orders/{id}`, `POST /{inbound|outbound}/orders/{id}/cancel` (API §5.0/§7.1).
- **Keluar (WMS → ERP):** WMS **callback** status via **outbox** (`integration_event`) dengan retry — bukan panggilan sinkron di tengah transaksi stok (Behavioral P-2: I/O berat di luar `⟦TX⟧`).
- **Sumber kebenaran:** ERP memiliki PO/SO (angka pesanan). WMS memiliki stok & eksekusi fisik. Keduanya rekonsiliasi lewat `erp_ref` + status.

```
ERP ──POST /inbound|outbound/orders──► WMS  (idempoten erp_ref)
WMS  ──(operasi Done)──► tulis integration_event(PENDING)
worker ──ambil PENDING──► POST ke ERP callback URL ──► SENT | retry(FAILED) | DEAD
```

## 2. Autentikasi integrasi

- Klien mesin (ERP) pakai **API key** di header `X-API-Key: <key>` (bukan alur login/refresh manusia).
- Key disimpan **hash** (`api_key.key_hash`); nilai mentah hanya ditampilkan **sekali** saat dibuat.
- Tiap key dipetakan ke **service account** (`app_user.is_service=true`) ber-role `ERP_INTEGRATION` → RBAC & audit tetap berlaku (aksi tercatat atas nama service account).
- Role `ERP_INTEGRATION` hanya diberi `view+create+edit` pada submenu **`inbound_orders` & `outbound_orders`** (bukan seluruh modul — tak bisa membuat receipt/scrap). Deny-by-default menutup sisanya.
- Key kedaluwarsa (`expires_at`) & bisa dicabut (`status=REVOKED`, `POST /admin/api-keys/{id}/revoke`) tanpa mengubah kode.

## 3. Idempotensi & retry

- **Ingest order idempoten pada `erp_ref`** (UNIQUE): kirim ulang PO/SO yang sama → WMS kembalikan resource yang sudah ada (`200`, bukan duplikat). Beda isi dengan `erp_ref` sama → `409 CONFLICT/ERP_REF_CONFLICT` (pakai `PATCH`).
- `Idempotency-Key` didukung untuk semua POST/PATCH (tabel `idempotency_key`, retensi 24 jam) — disarankan untuk `PATCH`/`cancel`.
- **Callback WMS→ERP** memakai outbox: worker mengklaim satu event per transaksi dengan `SELECT … FOR UPDATE SKIP LOCKED` (aman multi-worker; baris terkunci selama HTTP — worker mati = event dikirim ulang), `attempts++`, backoff eksponensial **30 dtk × 2^(n−1), maks 1 jam** (`next_retry_at`), setelah N gagal (`OUTBOX_MAX_ATTEMPTS`, default 10 ≈ 3 jam) → `DEAD` + alert `OUTBOX_DEAD`. Retry manual: `POST /admin/integration-events/{id}/retry` (satu event) atau `POST /admin/integration-events/retry` (semua `DEAD`/`FAILED` — antrean dikirim ulang dari yang tertua).
- **ERP tak melayani** (galat jaringan, timeout, `429/502/503/504`): event itu tetap dihitung satu percobaan, lalu putaran kirim dihentikan sampai tick berikutnya — gangguan ERP tak menghabiskan percobaan seluruh antrean (D-40).
- **Dedupe & urutan:** header `X-Event-Id: <integration_event.id>` — ERP wajib idempoten terhadapnya (at-least-once). Event untuk `ref_id` yang sama dikirim berurutan (`created_at` = waktu event **ditulis**, sehingga dua event satu transaksi tetap berurutan); event berikutnya ditahan selama event sebelumnya belum `SENT`/`DEAD`. Retry tunggal atas event `DEAD` yang penerusnya sudah terkirim tiba terlambat — ERP memakai `occurred_at` untuk mengabaikan status yang lebih tua.

## 4. Kontrak masuk — Purchase Order

`POST /inbound/orders`
```json
{ "erp_ref": "PO-123",
  "partner_ref": "SUP-01",              // dipetakan ke partner.code (type SUPPLIER)
  "order_date": "2026-09-20",
  "expected_date": "2026-09-28",
  "lines": [
    { "line_no": 1, "sku": "MED-001", "qty": "1000", "uom": "Pcs" }
  ] }
```
Mapping & validasi:
- `partner_ref` → `partner.code` (harus ada, type SUPPLIER) else `422 (UNKNOWN_PARTNER)`.
- `sku` → `product.sku` (aktif) else `422 (UNKNOWN_PRODUCT)`.
- `uom` → harus ada di packaging produk else `422 (UNKNOWN_UOM)`. Angka asli disimpan di `erp_qty` + `erp_uom_id`; `qty` dikonversi ke **base** saat ingest (A-6a) dan dipakai semua validasi.
- `line_no` unik per order — kunci baris untuk `PATCH` & callback.
- Sukses → buat `purchase_order(OPEN)` + lines (`qty_received=0`). Ulang `erp_ref` → kembalikan existing.
- **PATCH:** tambah/ubah line (`qty` baru tak boleh < `qty_received`); **cancel:** ditolak `422 ORDER_IN_EXECUTION` bila ada receipt IN_PROGRESS; receipt DRAFT/READY ikut dibatalkan.

## 5. Kontrak masuk — Sales Order

`POST /outbound/orders`
```json
{ "erp_ref": "SO-9001",
  "partner_ref": "CUST-08",             // partner.code (type CUSTOMER)
  "delivery_date": "2026-09-30",
  "lines": [ { "line_no": 1, "sku": "MED-001", "qty": "250", "uom": "Pcs" } ] }
```
Mapping identik pola PO (partner type CUSTOMER). Sukses → `sales_order(RECEIVED)` + lines (`qty_reserved=0`, `qty_delivered=0`). Pick list dibuat terpisah via `generate-picklist` oleh user gudang (service account ERP tidak berhak — RBAC `outbound_picking`).
- **Status SO (behavioral D-28)** = fungsi baris: semua terkirim → `DONE`; ada yang terkirim → `PARTIAL`; ada yang direservasi → `PROCESSING`; selain itu `RECEIVED` (pick list dibatalkan mengembalikan `PROCESSING` → `RECEIVED`). `CANCELLED` lekat.
- **PATCH:** qty line baru tak boleh < `qty_reserved + qty_delivered`. **Cancel:** ditolak `422 ORDER_IN_EXECUTION` bila ada pick list IN_PROGRESS; pick list READY ikut dibatalkan; SO → CANCELLED (qty yang sudah terkirim tetap tercatat).

## 6. Kontrak keluar — Callback status (outbox)

Event yang dikirim WMS ke ERP (URL & auth callback dikonfigurasi per instalasi di env — `ERP_CALLBACK_URL`, `ERP_CALLBACK_SECRET`, `ERP_CALLBACK_AUTH_HEADER`; URL kosong = gateway mati, event tetap `PENDING`):

| `event_type` | Dipicu saat | Payload inti |
|---|---|---|
| `RECEIPT_CONFIRMED` | Receipt INCOMING Done | `{event_id, erp_ref(PO), ref_no, lines:[{line_no, sku, qty_received_base, qty_received_erp_uom, erp_uom}], received_at, warehouse}` |
| `SHIPMENT_CONFIRMED` | Delivery OUTGOING Done | `{event_id, erp_ref(SO), ref_no, warehouse, lines:[{line_no, sku, qty_delivered_base, qty_delivered_erp_uom, erp_uom, batches:[{batch_no, qty_base, expiry}]}], shipped_at}` — qty = **pengiriman ini** (bukan kumulatif); satu event per pick list |
| `ORDER_STATUS_CHANGED` | PO → PARTIAL/CLOSED; SO → PARTIAL/DONE/CANCELLED | `{event_id, erp_ref, type: PURCHASE_ORDER\|SALES_ORDER, status}` |
| `ADJUSTMENT_POSTED` | Stock adjustment Done (selalu ditulis sejak M4; ERP boleh mengabaikan) | `{event_id, ref_no, operation_type: ADJ_GAIN\|ADJ_LOSS, warehouse, reason, dispatch_ref (transit loss), at, lines:[{sku, location, batch_no, unit_code, status, delta_base}]}` — `ref` = operasi |

Qty dalam UOM ERP = qty base ÷ `qty_in_base` UOM ERP (boleh desimal; ERP yang memutuskan pembulatan). Waktu dalam UTC.

Pengiriman: baris `integration_event(PENDING)` ditulis **dalam transaksi confirm** (bagian dari atomic Done) → worker mengirim asinkron. Ini menjamin "kalau operasi Done, callback pasti terkirim (eventually)".

### 6.1 Kontrak kawat (D-39)

```
POST <ERP_CALLBACK_URL>
Content-Type: application/json
X-Event-Id: <integration_event.id>            ← kunci dedupe (= event_id di body)
X-Event-Type: SHIPMENT_CONFIRMED
X-WMS-Attempt: 1                              ← percobaan ke-n
X-WMS-Timestamp: 1791909315                   ← detik UNIX saat dikirim
X-WMS-Signature: sha256=<hex>                 ← HMAC-SHA256(ERP_CALLBACK_SECRET, "<timestamp>.<body mentah>")
Authorization: Bearer …                       ← opsional, dari ERP_CALLBACK_AUTH_HEADER

{ "event_type": "SHIPMENT_CONFIRMED", "occurred_at": "2026-10-13T09:15:02.118Z", "event_id": "…", "erp_ref": "SO-9001", … }
```

- Body = payload tabel di atas + `event_type` + `occurred_at` (waktu event ditulis, UTC).
- **Hanya jawaban 2xx yang dianggap terkirim.** Redirect (3xx) tidak diikuti dan dihitung gagal. Batas waktu `ERP_CALLBACK_TIMEOUT_MS` (10 dtk).
- **Kewajiban ERP:** (1) verifikasi tanda tangan atas body **mentah** dan tolak timestamp yang selisihnya > 5 menit; (2) idempoten pada `X-Event-Id` — jawab 2xx untuk event yang sudah diproses; (3) jawab cepat (proses berat diantrekan di sisi ERP). Contoh penerima: `scripts/erp-stub.mjs`.

## 7. Rekonsiliasi

- ERP menarik keadaan via `GET /inbound/orders?status=` & `GET /outbound/orders?status=` untuk mencocokkan.
- **Rekonsiliasi (D-41)** — `GET /admin/reconciliation` (tab di Admin → Integrasi, hak view `admin_integration`): `OVERDUE_RECEIPT` (PO OPEN/PARTIAL lewat `expected_date`), `OVERDUE_DELIVERY` (SO RECEIVED/PROCESSING/PARTIAL lewat `delivery_date`), `CALLBACK_DEAD`, `CALLBACK_FAILED`, `CALLBACK_STUCK` (PENDING > 15 menit). "Hari ini" = zona waktu gudang default pemohon. Worker menjalankan ringkasannya tiap hari (log `alert: RECONCILIATION`).
- `integration_event` berstatus `DEAD` = antrian yang butuh intervensi manual: dashboard admin, alert `OUTBOX_DEAD`, tombol retry massal.

---

## Ringkasan Keputusan (ERP)

1. ERP push masuk (idempoten `erp_ref`); WMS callback keluar via **outbox `integration_event`** (retry, dead-letter).
2. Auth mesin = **API key → service account** ber-role `ERP_INTEGRATION` (detail: `auth-session-wms-baseline.md`).
3. Callback ditulis dalam transaksi confirm → jaminan "Done ⇒ callback terkirim (eventually, at-least-once)"; ERP dedupe via `X-Event-Id`; urutan per order dijaga.
5. Kawat callback = `POST` JSON bertanda tangan HMAC atas `<timestamp>.<body>`; hanya 2xx = terkirim; backoff 30 dtk × 2^(n−1) → `DEAD` pada percobaan ke-10; ERP tak melayani menghentikan putaran (D-39, D-40).
6. Rekonsiliasi = order terbuka lewat jatuh tempo + callback mati/gagal/macet, di halaman Integration dan ringkasan harian worker (D-41).
4. Order bisa di-`PATCH`/`cancel` dengan batas terhadap qty yang sudah dieksekusi; `line_no` = kunci baris; qty base untuk WMS, qty asli ERP untuk callback.
