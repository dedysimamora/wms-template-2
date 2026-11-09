# Flow Steps (`next_expected`) — WMS Baseline

**Tabel keputusan langkah handheld per operation type · pelengkap Behavioral v1.1.1, API v1.2, Handheld v1.1**

Versi: 1.3 · 12 Oktober 2026 · Pembaruan 1.3 (implementasi M3, `m3-outbound-wms-baseline.md`): F-OUT memakai **bin aktif dari reservasi** (behavioral D-23), semua scan unit + `SCAN_BIN` diterima sebagai alternatif (swap, D-25), O6/O7 hanya bila ada qty terpick, G-4 dikecualikan di tahap delivery (D-29), hint `qty_at_bin`, respons scan membawa `warnings`. Pembaruan 1.2 (implementasi M2): T3/H3 = semua line ber-`qty_done` tanpa tujuan (bulk DEST), F-ISR ditulis ulang (R0 `ENTER_QTY`, R1 stateless per unit, R2 sesuai komposisi reservasi), B3 memakai HU induk (LPN di atas karton, behavioral D-17), komposisi unit reservasi = HU direservasi utuh. Pembaruan 1.1 (implementasi M1): B2 dievaluasi sebelum B1, resolusi kode memuat HU/serial VOID (ditolak per langkah), `remaining_units` = HU distinct, penempatan barang lepas per produk, celah #9–#10.

> Dokumen ini adalah **kontrak** mesin langkah handheld: untuk setiap keadaan operasi, langkah apa yang diminta server (`next_expected`), input apa yang diterima, validasi apa yang dijalankan, dan efeknya. Implementasinya ada di `packages/domain/src/flow/next-expected.ts`. Tesnya (`packages/domain/test/next-expected.test.ts`) diturunkan baris demi baris dari tabel §7, jadi **mengubah tabel berarti mengubah tes**.

---

## Daftar Isi

1. [Tujuan & Cakupan](#1-tujuan--cakupan)
2. [Model: server-driven vs client-driven](#2-model-server-driven-vs-client-driven)
3. [Katalog Step](#3-katalog-step)
4. [Resolusi Kode Scan](#4-resolusi-kode-scan)
5. [State Pendukung & Perubahan Schema](#5-state-pendukung--perubahan-schema)
6. [Aturan Umum (berlaku untuk semua flow)](#6-aturan-umum-berlaku-untuk-semua-flow)
7. [Tabel Keputusan per Flow](#7-tabel-keputusan-per-flow)
8. [Validasi per Step → reason](#8-validasi-per-step--reason)
9. [Contoh Jalannya Alur](#9-contoh-jalannya-alur)
10. [Implementasi & Pengujian](#10-implementasi--pengujian)
11. [Temuan Celah & Perubahan Dokumen Lain](#11-temuan-celah--perubahan-dokumen-lain)

---

## 1. Tujuan & Cakupan

- Menghilangkan urutan langkah yang di-hardcode di device (HH-P4, handheld §5). Device hanya merender `step` yang diterimanya.
- Satu tabel keputusan per **flow**, bukan per layar. Flow dipilih dari `operation_type.code` dan `direction`.
- Cakupan: semua operation type seed v1.4 (RCV_*, OUT_*, INT_*, ADJ_*).
- Di luar cakupan: layout layar (wireframe), algoritma saran lokasi putaway (fase 2), GS1 composite (SC-7).

## 2. Model: server-driven vs client-driven

| Jenis | Operation type | Sumber `next_expected` | Alasan |
|---|---|---|---|
| **Server-driven** | RCV_*, OUT_DELIVERY, OUT_SCRAP, OUT_ISSUE_PROD, INT_TRANSFER, INT_INTERSITE (dispatch & receive) | Dihitung server dari snapshot operasi + cursor (§5), dikembalikan oleh `GET /operations/{id}`, `POST …/scan`, dan setiap transisi | Operasi hidup lintas banyak request; state ada di DB |
| **Client-driven** | INT_CARTON_BREAK, INT_QA_*, INT_MARK_DAMAGED, ADJ_GAIN/LOSS (operasi instan, behavioral D-7) | Urutan statis di `packages/contracts` (§7.8). Validasi terjadi sekali saat submit tunggal | Belum ada baris `operation` sampai submit; semua input dikirim dalam satu request ber-`Idempotency-Key` |

Bentuk respons server-driven (menggantikan bentuk di API §4.3):

```json
"next_expected": {
  "step": "SCAN_BIN",
  "alternatives": ["CLOSE_LINE"],
  "line_id": "…",
  "hint": { "role": "SOURCE", "location_code": "A-01-01-02", "product_sku": "MED-001",
            "batch_no": "B2407", "qty_remaining": "40", "uom": "Pcs" },
  "can_confirm": true
}
```

- `step`: satu langkah utama. Layar menonjolkannya dan `ScanField` menunggu inputnya.
- `alternatives[]`: aksi lain yang sah saat ini, ditampilkan sebagai tombol sekunder (mis. `CLOSE_LINE`, `SUBMIT`). Scan yang cocok dengan alternatif juga diterima.
- `hint`: data tampilan saja. Server tidak pernah mengandalkan hint yang dikirim balik oleh klien.
- `can_confirm`: hanya relevan saat `step = CONFIRM`; `false` bila aktor tak punya hak `confirm_menu_code` (§6 G-6).

## 3. Katalog Step

Enum final (menggantikan daftar di API §4.3 & handheld §5; **baru**: `START`, `ENTER_BATCH`).

| Step | Komponen UI (frontend §4.4) | Input yang diterima | Endpoint |
|---|---|---|---|
| `START` | `HoldToConfirm` "Mulai" | aksi | `POST /operations/{id}/claim` lalu `/start` |
| `SCAN_UNIT` | `ScanField` | kode produk (GTIN), kode carton supplier/SN supplier | `POST …/scan` |
| `ENTER_BATCH` | form batch + expiry (scan/ketik) | `{batch_no, expiry_date?, mfg_date?}` | `POST …/scan` (`batch`) |
| `ENTER_QTY` | `QtyStepper` + UOM | `{qty, uom_id}` | `POST …/scan` (`qty`) |
| `SUBMIT` | tombol "Selesai scan unit" | aksi | `POST …/submit` |
| `PRINT_LABEL` | tombol "Cetak label" + "Lewati" | aksi | `POST /inbound/receipts/{id}/print-lpn` |
| `SCAN_LPN` / `SCAN_CARTON` / `SCAN_SERIAL` | `ScanField` | kode HU / SN WMS | `POST …/scan` |
| `SCAN_BIN` | `ScanField` + petunjuk lokasi besar | kode lokasi (peran `SOURCE` atau `DEST` di `hint.role`) | `POST …/scan` |
| `SCAN_STAGING` / `SCAN_DOCK` | `ScanField` | kode lokasi tipe STAGING / DOCK | `POST …/scan` |
| `CLOSE_LINE` | `ConfirmDialog` (parsial → tampilkan sisa yang di-release) | aksi `{qty_done?}` | `POST …/lines/{lineId}/close` |
| `SELECT_REASON` | `ReasonPicker` | `reason_code` | `PATCH /operations/{id}` (DRAFT) / body operasi instan |
| `AWAIT_APPROVAL` | layar tunggu + refresh | — | (approver di desktop) |
| `CONFIRM` | `HoldToConfirm` "Selesai"/"Kirim" | aksi | `POST …/confirm` |
| `DONE` | ringkasan + kembali | — | — |

## 4. Resolusi Kode Scan

Klien **tidak** menentukan jenis kode. Klien mengirim `code` beserta `expected_step`, yaitu step yang sedang ia jawab, untuk deteksi balapan. Server mengklasifikasi kode dengan urutan pencarian berikut, dalam lingkup warehouse operasi:

| Urutan | Sumber | Menghasilkan |
|---|---|---|
| 1 | `location.code` (warehouse operasi, `is_usable`) | BIN / STAGING / DOCK sesuai `location.type` |
| 2 | `handling_unit.code` (status ≠ VOID) | LPN (`hu_type=PALLET`) / CARTON |
| 3 | `serial.code` (status ≠ VOID) | SERIAL |
| 4 | `product_packaging.barcode` (**baru**, §5) | PRODUCT (+ UOM level → qty bawaan = 1 UOM itu) |

- **Implementasi (v1.1):** HU & serial dicari **termasuk** status VOID, lalu langkah yang menolak: fase A menganggapnya duplikat (`409 DUPLICATE_SERIAL`, AC-01.2 "termasuk VOID"), fase B menolaknya `409 LPN_MISMATCH`. Lokasi dicari di gudang operasi; kode yang hanya cocok dengan bin gudang lain ditolak `422 INVALID_BIN` (bukan `UNKNOWN_CODE`), lokasi `is_usable=false` juga `INVALID_BIN`. Klasifikasi → step: lokasi → `SCAN_BIN`/`SCAN_STAGING`/`SCAN_DOCK`; HU PALLET → `SCAN_LPN`, CARTON → `SCAN_CARTON`; serial → `SCAN_UNIT` bila diterima, selain itu `SCAN_SERIAL`; barcode → `SCAN_UNIT`. `expected_step` boleh berupa step **atau** salah satu `alternatives`.
- Kode yang cocok dengan **>1 sumber** → `422 BUSINESS_RULE/AMBIGUOUS_CODE`. Format default (`LPN-…`, `SN-…`, bin `A-01-…`, GTIN numerik) tidak bertabrakan; validasi master data menolak kode bin yang cocok dengan pola `lpn_code_format`/`serial_code_format`.
- Tak cocok dengan sumber mana pun → `422 BUSINESS_RULE/UNKNOWN_CODE`.
- Jenis kode tidak termasuk `step` maupun `alternatives` → `422 BUSINESS_RULE/WRONG_SCAN_TYPE`, dengan `details: {expected, got}`. Contoh: saat diminta BIN, operator men-scan LPN.
- `expected_step` ≠ step server saat ini (layar basi karena scan paralel/antrean) → `409 CONFLICT/STEP_CHANGED` + `next_expected` terbaru. Klien merender ulang **tanpa** feedback gagal yang keras.
- `scan_type` pada API §4.3 **dihapus** dan diganti `expected_step`.

## 5. State Pendukung & Perubahan Schema

Mesin langkah butuh state yang tidak ada di schema v1.4.1. Perubahan ini **sudah diterapkan** di schema v1.5 (24-09-2026). Karena masih pra-rilis, perubahan dilipat ke baseline `0001` (migration §2.1). Ada 7 skenario validasi baru:

| Objek | Kolom | Fungsi |
|---|---|---|
| **`operation_cursor`** (tabel baru, 1 baris per operasi) | `operation_id PK FK`, `line_id FK NULL`, `bin_location_id FK NULL`, `bin_role` (`SOURCE`/`DEST`) NULL, `pending_hu_id FK NULL`, `pending_product_id FK NULL`, `pending_uom_id FK NULL`, `batch_id FK NULL` (batch "lengket" saat receipt), `updated_by`, `updated_at` | Konteks transien antar-scan: bin yang baru discan, unit yang menunggu bin, produk yang menunggu qty. Dihapus saat DONE/CANCELLED. Dikunci bersama `operation` (A-5 langkah 1) |
| `operation` | `staging_location_id FK NULL`, `dock_location_id FK NULL` | Fakta durable scan staging/dock (prasyarat daftar Deliveries, API §7.3) |
| `handling_unit` | `label_printed_at TIMESTAMPTZ NULL` | `PRINT_LABEL` muncul sekali; cetak ulang tetap bisa |
| `product_packaging` | `barcode VARCHAR(40) NULL UNIQUE` | GTIN/EAN per level UOM. Scan karton = produk + UOM Carton sekaligus (A-6a) |

Cursor adalah **konteks**, bukan fakta stok. Efek stok tetap hanya saat confirm (P-1). Kehilangan cursor, misalnya karena dihapus oleh `unclaim`, hanya membuat operator men-scan ulang bin.

## 6. Aturan Umum (berlaku untuk semua flow)

Dievaluasi **berurutan sebelum** tabel flow; aturan pertama yang cocok menang.

| ID | Kondisi | `step` | `alternatives` | Catatan |
|---|---|---|---|---|
| G-1 | `status ∈ {DONE, CANCELLED}` | `DONE` | — | `hint.status` = status akhir |
| G-2 | `status = DRAFT` | `null` | — | Belum masuk daftar tugas handheld (`my-tasks` hanya READY/IN_PROGRESS) |
| G-3 | `status = READY` | `START` | — | Claim + start (INCOMING tanpa reserve; lainnya reserve A-2) |
| G-4 | `IN_PROGRESS` & `assigned_to ≠ aktor` | — | — | Tidak dihitung; request → `409 CLAIMED_BY_OTHER`. **Kecuali (v1.3, behavioral D-29):** operasi di *tahap delivery* dan aktor ber-hak `confirm_menu_code` → langkah dihitung seolah miliknya (`SCAN_DOCK`/`CONFIRM`); scan/confirm-nya memindahkan klaim |
| G-5 | `IN_PROGRESS` & `require_reason` & `reason_code_id` kosong | `SELECT_REASON` | — | Jaring pengaman; normalnya diisi saat DRAFT |
| G-6 | Tabel flow menghasilkan `CONFIRM` | `CONFIRM` | per flow | `can_confirm = can(aktor, confirm_menu_code ?? menu_code, edit)` |
| G-7 | Tabel flow menghasilkan `CONFIRM` & `require_approval` & belum di-approve | `AWAIT_APPROVAL` | per flow | Approval tidak menghalangi scan, hanya confirm (behavioral §5.7) |

## 7. Tabel Keputusan per Flow

Notasi: *line aktif* = `cursor.line_id` bila masih PENDING. Kalau tidak, pakai line PENDING pertama menurut **urutan jalan** (`from_location.code` naik, lalu `line.id`). *Sisa* = `qty_base − qty_done_base`. Baris dievaluasi dari atas; baris pertama yang cocok menang.

### 7.1 F-RCV — Receipt + Putaway (RCV_SUPPLIER, RCV_PRODUCTION, RCV_RETURN) · behavioral §5.1

**Fase A — penerimaan unit (`submitted_at IS NULL`)**

| # | Kondisi | step | alternatives | hint |
|---|---|---|---|---|
| A1 | `cursor.pending_product` ada & produk butuh batch/expiry (flag efektif) & `cursor.batch_id` kosong | `ENTER_BATCH` | — | `product_sku` |
| A2 | `cursor.pending_product` ada & UOM tanpa identitas unit (bukan SN/carton code) | `ENTER_QTY` | — | `product_sku`, `uom` (dari barcode), `qty_default: 1` |
| A3 | Belum ada unit diterima | `SCAN_UNIT` | — | `po_lines_remaining[]` (bila PO-linked) |
| A4 | Σ diterima ≥ Σ dipesan (semua PO line penuh) | `SUBMIT` | `SCAN_UNIT` | `received`, `ordered` |
| A5 | lainnya | `SCAN_UNIT` | `SUBMIT` | `po_lines_remaining[]` |

Efek scan di fase A:
- **Produk (GTIN)** → set `cursor.pending_product/uom`. Kalau batch tak diperlukan atau batch lengket sudah ada, langsung ke A2.
- **SN supplier** (produk `use_serial`) → buat line qty 1, serial `PENDING`.
- **ENTER_QTY** → tambah/isi `operation_line` (qty & `qty_base` A-6a, `po_line_id`), lalu kosongkan `pending_*`.
- **ENTER_BATCH** → upsert `batch` (produk, batch_no), set `cursor.batch_id`. Batch ini tetap lengket untuk unit berikutnya dari produk yang sama sampai operator menggantinya lewat tombol "Ganti batch" (aksi `ENTER_BATCH` kapan pun di fase A).

**Fase B — label & putaway (`submitted_at` terisi)**

| # | Kondisi | step | alternatives | hint |
|---|---|---|---|---|
| B2 | `cursor.pending_hu` / `cursor.pending_product` ada | `SCAN_BIN` | — | `role: DEST`, `lpn_code`, tipe bin wajib `STOCK` |
| B1 | Ada HU PENDING milik operasi dengan `label_printed_at IS NULL` | `PRINT_LABEL` | `SCAN_LPN` | jumlah label |
| B3 | Ada line tanpa `to_location` yang ber-HU | `SCAN_LPN` (atau `SCAN_CARTON` bila HU carton tanpa pallet) | — | `unit_code` = HU **teratas** (LPN induk karton, v1.2), `remaining_units` = jumlah HU teratas **distinct** |
| B4 | Ada line tanpa `to_location` & tanpa HU (barang lepas, `use_lpn=false`) | `SCAN_UNIT` | — | `product_sku`, `batch_no`, sisa qty → lalu `SCAN_BIN` (`role: DEST`) |

- **B2 sebelum B1 (v1.1):** bila operator memilih "Lewati" cetak lalu men-scan LPN (alternatif B1), unit itu harus bisa langsung di-bin. Dengan urutan lama, `SCAN_BIN` tidak pernah diterima selama label belum dicetak. `PRINT_LABEL` tetap muncul lagi setelah tiap putaway sampai label dicetak.
- **B4 — barang lepas:** scan barcode produk → semua line lepas produk itu yang belum ber-bin menunggu bin (`cursor.pending_product`, `line_id` kosong); scan S/N milik operasi → hanya line serial itu (`cursor.line_id`). Satu scan bin menempatkan kelompok tersebut. Putaway lepas satu line ke beberapa bin = fase 2.
| B5 | Semua line punya `to_location` | `CONFIRM` | — | ringkasan per bin |

### 7.2 F-OUT — Picking + Delivery (OUT_DELIVERY) · behavioral §5.2

| # | Kondisi | step | alternatives | hint |
|---|---|---|---|---|
| O5′ | (F-OUT) `cursor.pending_product` ada & bin SOURCE sudah discan — termasuk bin di luar saran | `ENTER_QTY` | `SCAN_BIN`, `CLOSE_LINE` | `qty_default = min(sisa, qty di bin)`; bila qty di bin 0 → sisa |
| O1 | Ada line PENDING & `cursor.bin` kosong/bukan **bin aktif** line aktif | `SCAN_BIN` | `CLOSE_LINE`; F-OUT bila bin SOURCE sudah discan: + `SCAN_LPN`, `SCAN_CARTON`, `SCAN_SERIAL`, `SCAN_UNIT` (swap) | `role: SOURCE`, bin aktif line aktif, SKU, batch saran, sisa, `qty_at_bin` |
| O2 | line aktif, bin cocok, reservasi di bin = pallet utuh (`hu_type=PALLET`, qty HU ≤ sisa) | `SCAN_LPN` | F-OUT: scan unit lain + `SCAN_BIN` + `CLOSE_LINE` · F-SCR: `SCAN_CARTON`, `SCAN_SERIAL`, `CLOSE_LINE` | `unit_code` saran |
| O3 | … reservasi di bin = carton HU | `SCAN_CARTON` | F-OUT: idem · F-SCR: `SCAN_SERIAL`, `CLOSE_LINE` | carton code saran |
| O4 | … produk ber-serial (loose) | `SCAN_SERIAL` | F-OUT: idem · F-SCR: `CLOSE_LINE` | S/N saran |
| O5 | … barang lepas tanpa identitas | `SCAN_UNIT` → `ENTER_QTY` | F-OUT: idem · F-SCR: `CLOSE_LINE` | `qty_default = min(sisa, qty di bin)` |
| O6 | Semua line DONE & **ada qty terpick** & warehouse punya lokasi STAGING & `staging_location_id` kosong | `SCAN_STAGING` | — | — |
| O7 | Semua line DONE & **ada qty terpick** & warehouse punya lokasi DOCK & `dock_location_id` kosong | `SCAN_DOCK` | — | — |
| O8 | lainnya | `CONFIRM` | — | ringkasan; `can_confirm` per G-6. Semua line ditutup 0 → confirm `422 NO_LINES` → cancel |

- Line otomatis DONE ketika `qty_done_base = qty_base`. Line aktif lalu maju ke berikutnya dan `cursor.bin` dikosongkan bila bin line berikutnya berbeda.
- `CLOSE_LINE` pada line dengan sisa > 0 → release sisa (A-3). Konfirmasi wajib menampilkan qty yang dilepas.
- Pilihan O2–O5 memakai komposisi **reservasi** di bin tersebut, bukan komposisi quant bebas. Unit dari batch/HU lain yang valid diterima lewat swap (A-4c, behavioral D-25).
- **Bin aktif & urutan jalan F-OUT (v1.3, behavioral D-23):** line `OUT_DELIVERY` tidak punya `from_location`. Bin aktif line = lokasi reservasi pending pertamanya dalam *urutan saran* (expiry naik bila FEFO efektif → kode lokasi → kode unit → id); urutan jalan antar-line = kode bin aktif lalu id line. Bila reservasi line di bin cursor habis, `cursor.line_id` dikosongkan sehingga langkah berikutnya mengikuti urutan jalan (bisa line lain dulu). F-SCR tetap memakai `line.from_location`.
- **Pindah bin selalu sah di F-OUT:** `SCAN_BIN` adalah alternatif O2–O5; bin `STOCK`/`QUARANTINE` usable mana pun di gudang operasi diterima. Bin tanpa reservasi operasi = bin swap (line aktif tetap).
- **FEFO (behavioral D-24)** dinilai pada scan unit reservasi maupun swap; `422 FEFO_ACK_REQUIRED` bukan perubahan langkah — klien menampilkan ReasonPicker lalu mengirim ulang scan yang sama + `fefo_override_reason` dengan `Idempotency-Key` baru.
- Warehouse tanpa lokasi STAGING/DOCK melewati O6/O7 (gudang kecil).

### 7.3 F-TRF — Bin-to-Bin Transfer (INT_TRANSFER)

**Mode dokumen** (line dibuat di DRAFT dengan `from_location`):

| # | Kondisi | step | alternatives | hint |
|---|---|---|---|---|
| T1 | line aktif belum `qty_done` penuh & `cursor.bin` ≠ `from_location` line | `SCAN_BIN` | `CLOSE_LINE` | `role: SOURCE` |
| T2 | line aktif, bin sumber cocok, sisa > 0 | `SCAN_LPN`/`SCAN_CARTON`/`SCAN_SERIAL`/`SCAN_UNIT` (seperti O2–O5) | `CLOSE_LINE` | — |
| T3 | Ada line ber-`qty_done > 0` dengan `to_location` kosong (semua line sudah DONE) | `SCAN_BIN` | — | `role: DEST`, `lines` = jumlah line; satu scan berlaku untuk **semua** line tersebut (bulk, v1.2) |
| T4 | Semua line DONE & yang ber-qty punya `to_location` | `CONFIRM` | — | — |

- Komposisi unit T2 (dan O2–O5/R2) dari **reservasi** line yang belum discan: HU teratas direservasi **utuh** oleh operasi → `SCAN_LPN`/`SCAN_CARTON` (hint `unit_code`); karton utuh di pallet sebagian → `SCAN_CARTON`; serial → `SCAN_SERIAL`; selain itu (mis. sebagian isi LPN) → `SCAN_UNIT` → `ENTER_QTY` (barang lepas, qty dibagi FEFO ke reservasi, behavioral D-18).
- Scan LPN/karton = seluruh isinya; hanya sah bila HU direservasi utuh (`409 NOT_RESERVED` bila tidak). Line ditutup dengan qty 0 tidak butuh tujuan.

**Mode ad-hoc** (`{mode:"adhoc"}`, line lahir dari scan):

| # | Kondisi | step | alternatives | hint |
|---|---|---|---|---|
| H1 | Belum ada line & `cursor.bin` bukan SOURCE | `SCAN_BIN` | — | `role: SOURCE` |
| H2 | `cursor.pending_product` ada → `ENTER_QTY`; atau `cursor.bin_role = SOURCE` & tak ada line tanpa tujuan → `SCAN_LPN` | `SCAN_LPN` | `SCAN_CARTON`, `SCAN_SERIAL`, `SCAN_UNIT` | — |
| H3 | Ada line ber-qty tanpa `to_location` | `SCAN_BIN` | `SCAN_LPN`, `SCAN_CARTON`, `SCAN_SERIAL`, `SCAN_UNIT` | `role: DEST` (scan unit lagi = tambah dari sumber yang sama; satu scan DEST berlaku untuk semua line itu) |
| H4 | Semua line punya `to_location` | `CONFIRM` | `SCAN_BIN` (sumber baru) | — |

Aturan: bin DEST ≠ bin SOURCE bila status sama (`SAME_LOCATION`), dan warehouse harus sama. Transfer antar-warehouse wajib memakai INT_INTERSITE.

### 7.4 F-ISD — Inter-Site Dispatch (INT_INTERSITE, `parent_operation_id IS NULL`)

Sama seperti F-TRF mode dokumen **tanpa** T3: tujuan otomatis `IN-TRANSIT`, sehingga setelah semua line DONE → `CONFIRM`.

### 7.5 F-ISR — Inter-Site Receive (INT_INTERSITE, `parent_operation_id` terisi)

| # | Kondisi | step | alternatives | hint |
|---|---|---|---|---|
| R0 | `cursor.pending_product` (barcode barang lepas discan) | `ENTER_QTY` | — | `qty_default` = sisa line produk itu |
| R1 | Ada line ber-`qty_done > 0` tanpa `to_location` (stateless, v1.2) | `SCAN_BIN` | `SCAN_LPN`, `SCAN_CARTON`, `SCAN_SERIAL`, `SCAN_UNIT` | `role: DEST`, gudang = gudang receive (= `dest_warehouse_id` dispatch) |
| R2 | Ada line PENDING | sesuai komposisi reservasi (`SCAN_LPN`/`SCAN_CARTON`/`SCAN_SERIAL`/`SCAN_UNIT`) | unit scan lainnya + `CLOSE_LINE` | `unit_code` saran, `qty_remaining` |
| R3 | Semua line DONE | `CONFIRM` | — | sisa di IN_TRANSIT (bila ada line ditutup parsial) |

Tidak ada scan bin sumber karena sumbernya selalu IN-TRANSIT. Unit yang bukan milik reservasi receive → `409 NOT_RESERVED`. Tujuan per unit (scan unit → scan bin); line barang lepas yang sudah bertujuan lalu menerima qty lagi dipecah menjadi line baru (behavioral D-20).

### 7.6 F-SCR — Scrap / Issue (OUT_SCRAP, OUT_ISSUE_PROD)

Sama seperti F-OUT baris O1–O5 dengan `line.from_location` sebagai bin (dokumen menunjuk stok tertentu), **tanpa** O5′, swap, FEFO, maupun O6/O7. Setelah semua line DONE → `CONFIRM`, lalu G-7 mengubahnya menjadi `AWAIT_APPROVAL` bila perlu. Reason diisi saat DRAFT; G-5 menjadi jaring pengaman.

### 7.7 Ringkasan flow → tabel

| Operation type | Flow |
|---|---|
| RCV_SUPPLIER, RCV_PRODUCTION, RCV_RETURN | F-RCV (§7.1) |
| OUT_DELIVERY | F-OUT (§7.2) |
| OUT_SCRAP, OUT_ISSUE_PROD | F-SCR (§7.6) |
| INT_TRANSFER | F-TRF (§7.3) |
| INT_INTERSITE (dispatch / receive) | F-ISD (§7.4) / F-ISR (§7.5) |
| INT_CARTON_BREAK, INT_QA_*, INT_MARK_DAMAGED, ADJ_* | client-driven (§7.8) |
| Operation type turunan klien | Mengikuti flow direction induknya: INCOMING → F-RCV, OUTGOING → F-SCR (atau F-OUT bila `confirm_menu_code = outbound_deliveries`), INTERNAL → F-TRF |

### 7.8 Urutan statis operasi instan (client-driven)

| Operasi | Urutan | Request akhir |
|---|---|---|
| Carton break | `SCAN_CARTON` → (preview) → `CONFIRM` → `DONE` | `POST /internal/carton-break` |
| QA hold | `SELECT_REASON` → `SCAN_*` (≥1, ulang) → [`SCAN_BIN` opsional, tipe QUARANTINE/STOCK] → `CONFIRM` | `POST /internal/quarantine/hold` |
| QA release | `SCAN_*` (≥1) → `SCAN_BIN` (wajib; hint = bin asal) → `CONFIRM` | `…/release` |
| QA reject / mark damaged | `SELECT_REASON` → `SCAN_*` (≥1) → `CONFIRM` | `…/reject`, `…/mark-damaged` |
| Adjustment | `SCAN_BIN` → `SCAN_*`/`SCAN_UNIT` → `ENTER_QTY` (hitung fisik) → `SELECT_REASON` → `CONFIRM` | `POST /inventory/adjustment` |

Klien tetap memakai resolusi kode server (§4) lewat `POST /lookup/code {code, warehouse_id}` (**baru**, read-only), sehingga klasifikasi kode tidak diduplikasi di device.

## 8. Validasi per Step → reason

| Step | Validasi (urut murah → mahal) | reason bila gagal |
|---|---|---|
| semua scan | kode dikenal / tunggal / jenis sesuai step / `expected_step` segar | `UNKNOWN_CODE`, `AMBIGUOUS_CODE`, `WRONG_SCAN_TYPE`, `STEP_CHANGED` |
| `SCAN_UNIT` (RCV) | produk = produk PO line; SN belum terdaftar; pre-check over-receipt | `PRODUCT_MISMATCH`, `DUPLICATE_SERIAL`, `OVER_RECEIPT` |
| `ENTER_BATCH` | batch_no wajib; expiry wajib bila `use_expiry`; expiry > hari ini (tz warehouse) | `MISSING_BATCH`, `MISSING_EXPIRY`, `EXPIRED` |
| `ENTER_QTY` | qty > 0; kelipatan sesuai UOM; ≤ sisa (OUT/TRF) | `VALIDATION_ERROR`, `INSUFFICIENT_STOCK` |
| `SCAN_BIN` DEST (RCV) | tipe STOCK, `is_usable`, warehouse sama | `INVALID_BIN` |
| `SCAN_BIN` SOURCE (TRF/SCR) | bin = `from_location` line PENDING | `INVALID_BIN` |
| `SCAN_BIN` SOURCE (F-OUT) | bin tipe STOCK/QUARANTINE, `is_usable`, gudang operasi (ber-reservasi → line aktif pindah; tanpa reservasi → bin swap) | `INVALID_BIN` |
| `SCAN_BIN` DEST (TRF) | ≠ sumber, `is_usable`, warehouse sama | `SAME_LOCATION`, `INVALID_BIN` |
| `SCAN_LPN/CARTON/SERIAL` (TRF/SCR) | milik reservasi operasi, HU direservasi utuh, di bin sumber, belum discan | `NOT_RESERVED`, `INVALID_BIN`, `ALREADY_DONE` |
| `SCAN_LPN/CARTON/SERIAL` (F-OUT) | reservasi operasi di bin cursor → FEFO; selain itu swap: di bin cursor, produk line PENDING, status diizinkan, bukan milik operasi lain, muat di sisa → expiry/shelf-life → FEFO | `ALREADY_DONE`, `INVALID_BIN`, `NOT_RESERVED` (+`details.cause`), `INVALID_HU`, `EXPIRED`, `SHELF_LIFE`, `FEFO_VIOLATION`, `FEFO_ACK_REQUIRED` |
| `SCAN_LPN` (RCV fase B) | HU milik operasi, belum di-putaway | `LPN_MISMATCH` |
| `SCAN_STAGING` / `SCAN_DOCK` | tipe lokasi sesuai, warehouse sama | `INVALID_BIN` |
| `CLOSE_LINE` | line PENDING milik operasi | `INVALID_TRANSITION/LINE_LOCKED` |
| `CONFIRM` | lihat behavioral §3 | `LINES_OPEN`, `PUTAWAY_INCOMPLETE`, `NEEDS_APPROVAL` |

Reason baru (ditambahkan ke katalog API §1.2.1): `UNKNOWN_CODE`, `AMBIGUOUS_CODE`, `WRONG_SCAN_TYPE` (BUSINESS_RULE); `STEP_CHANGED` (CONFLICT).

## 9. Contoh Jalannya Alur

**Receipt PO 200 Pcs, 2 karton @100, produk ber-batch, `use_lpn`:**

```
READY                                  → START
start                                  → SCAN_UNIT            (A3)
scan GTIN karton (UOM Carton)          → ENTER_BATCH          (A1)
batch B2409 exp 2027-06-30             → ENTER_QTY qty_default 1 Carton (A2)
qty 1 Carton (=100)                    → SCAN_UNIT alt SUBMIT (A5)
scan GTIN karton, qty 1 (batch lengket)→ SUBMIT alt SCAN_UNIT (A4: 200 ≥ 200)
submit (1 LPN)                         → PRINT_LABEL alt SCAN_LPN (B1)
cetak                                  → SCAN_LPN             (B3)
scan LPN-0000007                       → SCAN_BIN role DEST   (B2)
scan A-01-01-01                        → CONFIRM              (B5)
confirm                                → DONE                 (G-1)
```

**Pick 2 line (40 & 30), line 2 hanya dapat 20:**

```
READY → START → (reserve) SCAN_BIN A-01-01-01 alt CLOSE_LINE     (O1, line 1)
bin ✓ → SCAN_UNIT (loose)  → ENTER_QTY default 40 → line 1 DONE
      → SCAN_BIN A-01-01-02 (line 2)                             (O1)
bin ✓ → SCAN_UNIT → ENTER_QTY 20 → SCAN_UNIT alt CLOSE_LINE (sisa 10)
CLOSE_LINE (release 10)    → SCAN_STAGING → SCAN_DOCK → CONFIRM (can_confirm per hak)
```

## 10. Implementasi & Pengujian

- **Fungsi murni** `nextExpected(snapshot, actor) → NextExpected | null` di `packages/domain/src/flow/next-expected.ts`. Tanpa I/O. Snapshot (operasi, line, reservasi ringkas, cursor, flag lokasi warehouse, hak aktor) dirakit application dari repository **di dalam transaksi scan yang sama**, sehingga respons selalu konsisten dengan state yang baru di-commit.
- Enum `NEXT_EXPECTED_STEPS` di `packages/contracts` = sumber kontrak API. Tes di `packages/application` memastikan enum domain == enum contracts.
- Tes `packages/domain/test/next-expected.test.ts`: minimal satu kasus per baris tabel §6–§7 (ID baris ditulis di nama tes), ditambah dua walkthrough §9.
- Resolusi kode (§4) dan efek scan ada di application/infrastructure (butuh DB), dibangun di M1 (schema v1.5 sudah tersedia).

## 11. Temuan Celah & Perubahan Dokumen Lain

Menyusun tabel ini mengungkap celah pada desain sebelumnya. Status tindak lanjutnya:

| # | Celah | Tindak lanjut |
|---|---|---|
| 1 | Receipt/pick barang lepas butuh scan **produk**, tetapi tidak ada barcode produk | `product_packaging.barcode` (schema v1.5 ✅) |
| 2 | Konteks antar-scan (bin terakhir, unit menunggu bin) tak punya tempat | tabel `operation_cursor` (schema v1.5 ✅) |
| 3 | Scan staging/dock tidak tercatat, padahal jadi prasyarat daftar Deliveries | `operation.staging_location_id/dock_location_id` (schema v1.5 ✅) |
| 4 | `PRINT_LABEL` tak bisa tahu label sudah dicetak | `handling_unit.label_printed_at` (schema v1.5 ✅) |
| 5 | Tidak ada langkah input batch/expiry saat receipt | step `ENTER_BATCH` + batch lengket |
| 6 | Tidak ada langkah "Mulai" (READY → claim+start) | step `START` |
| 7 | Klien harus menebak `scan_type` | resolusi kode di server + `expected_step` (§4) |
| 8 | Handheld §7.7 menaruh approval **sebelum** start | diselaraskan: approval hanya menahan confirm (G-7) |
| 9 | B1 mendahului B2 → setelah "Lewati" cetak, `SCAN_BIN` tak pernah diterima | B2 dipindah sebelum B1 (v1.1, domain + tes) |
| 10 | Tabel A tak punya langkah untuk **S/N atau kode karton dari supplier** (unit belum dikenal WMS) | Ditunda: M1 hanya menerima barcode produk (GTIN) + qty; S/N & kode HU diterbitkan WMS saat submit (behavioral D-14/D-17). Penangkapan kode supplier = revisit (butuh step baru di fase A) |
| 11 | T3 per line memaksa satu scan tujuan per line; R1 bergantung `cursor.pending_hu` & F-ISR tak punya langkah qty barang lepas (M2) | v1.2: T3/H3 bulk ke semua line ber-qty tanpa tujuan; F-ISR R0–R3 stateless (line ber-qty tanpa tujuan), R0 `ENTER_QTY` |
| 12 | "LPN utuh" di tabel O2 belum terdefinisi untuk pallet berisi karton (D-17) | Komposisi dari reservasi: HU teratas utuh (isi pallet + karton anak = Σ reservasi op) → `SCAN_LPN` (v1.2) |
| 13 | Tabel F-OUT memakai `line.from_location`, padahal satu baris SO tersebar di beberapa bin/batch (M3) | v1.3: bin aktif diturunkan dari reservasi pending pertama (behavioral D-23) |
| 14 | Swap dijanjikan (§8, API §7.2) tetapi tabel tak punya langkah untuk bin/unit di luar saran; operator tak bisa pindah bin saat diminta unit | v1.3: O5′, O1 + scan unit, `SCAN_BIN` sebagai alternatif O2–O5 |
| 15 | O6/O7 muncul untuk operasi tanpa barang terpick; petugas delivery (bukan pemegang klaim) tak melihat `SCAN_DOCK` | v1.3: O6/O7 butuh qty terpick; G-4 dikecualikan di tahap delivery (behavioral D-29) |

Dokumen yang ikut diperbarui: API §4.3 (payload scan, bentuk `next_expected`, enum, reason baru, endpoint `/lookup/code`), handheld §5 & §7.7, CLAUDE.md (peta dokumen).

---

## Ringkasan Keputusan (flow steps)

1. `next_expected = {step, alternatives[], line_id, hint, can_confirm}`; server-driven untuk operasi persisten, client-driven (urutan statis) untuk operasi instan.
2. Step baru `START` dan `ENTER_BATCH`; enum final di §3 menggantikan daftar lama.
3. Klien tidak menentukan jenis kode. Server mengklasifikasi (lokasi → HU → serial → barcode produk) dan menolak kode ambigu/salah jenis. `expected_step` mendeteksi layar basi (`STEP_CHANGED`).
4. Aturan umum G-1..G-7 dievaluasi sebelum tabel flow. Approval hanya menahan confirm.
5. Tabel keputusan per flow F-RCV, F-OUT, F-TRF (dokumen & ad-hoc), F-ISD, F-ISR, F-SCR, dengan urutan jalan line = kode lokasi naik.
6. State pendukung (`operation_cursor`, staging/dock, `label_printed_at`, `product_packaging.barcode`) sudah masuk schema v1.5 (dilipat ke baseline `0001`, pra-rilis).
7. Fungsi murni `nextExpected()` di domain dan tesnya diturunkan per baris tabel. Mengubah tabel berarti mengubah tes.
8. **v1.3 (M3):** F-OUT digerakkan reservasi — bin aktif & urutan jalan dari reservasi pending, pindah bin dan unit pengganti selalu diterima sebagai alternatif (swap), staging/dock hanya bila ada qty terpick, dan tahap delivery terbuka bagi pemegang hak confirm.
