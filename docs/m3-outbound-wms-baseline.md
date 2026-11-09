# M3 Outbound — Desain Implementasi · WMS Baseline

**Bagaimana milestone M3 (SO ingest, pick list + reserve FEFO, picking, delivery, scrap/issue + approval, handheld picking) direalisasikan di kode · pelengkap test-delivery §12**

Versi: 1.0 · 12 Oktober 2026 (rancangan 0.1 → dikonfirmasi 0.2 → diimplementasi 1.0 pada hari yang sama)

> Dokumen ini **tidak** mengulang aturan bisnis. Sumbernya tetap behavioral §4 (A-1/A-2/A-3/A-4a/A-4c/A-5) & §5.2/§5.7, flow-steps §7.2/§7.6, API §7, erp-integration §5–6, requirements UC-02 (AC-02.1–02.12). Isinya: celah yang harus ditutup sebelum coding (**G7–G19**), peta komponen, alur data, keputusan baru (behavioral **D-23..D-31**, implementasi **I-22..I-33**) beserta trade-off, rencana pembuktian, dan urutan pengerjaan.
>
> **Status: M3 selesai (12-10-2026).** Kelima keputusan §5.3 dikonfirmasi pemilik produk sebelum coding. D-23..D-31 sudah disalin ke behavioral v1.3, flow-steps v1.3, API v1.5, handheld v1.2 (§6). Empat hal yang baru terlihat saat implementasi dicatat sebagai I-34..I-39 (§5.2). Bukti di §8.

---

## 1. Kebutuhan & Cakupan

### 1.1 Fungsional (M3) — status: semua ✅ (bukti §8)

| Item | Sumber | Inti | Modal dari M0–M2 |
|---|---|---|---|
| SO ingest, PATCH, cancel, list/detail | FR-OUT-1, erp-integration §5, API §7.1 | ERP push ber-`X-API-Key`, idempoten `erp_ref`, qty → base | Cermin `inbound-orders.ts` (PO) |
| Generate pick list | FR-OUT-2, behavioral §5.2 | Operasi `OUT_DELIVERY` READY, satu line per baris SO | — (baru) |
| Start = reserve FEFO | FR-OUT-3, A-1/A-2, AC-02.1/02.2 | Flip in-place ke RESERVED, `qty_reserved` naik, cek expiry/shelf-life | `reserveLine`/`reserveQuant` (M2) |
| Picking: scan bin → unit (pallet / karton / serial / lepas) | FR-OUT-4, A-4c, F-OUT O1–O5 | Tandai `qty_done` per reservasi | `markDone`, `distributeDone`, `unitKindOf` (M2) |
| FEFO block / warn + ack | FR-OUT-5, D-10, AC-02.3/02.4 | Deviasi → `FEFO_VIOLATION` / `FEFO_ACK_REQUIRED` | Kolom `fefo_override_*` sudah ada |
| Expiry & shelf-life | FR-OUT-6, A-6d, AC-02.5 | Tolak expired; sisa umur ≥ minimum partner | `partner.min_shelf_life_days` sudah ada |
| Swap unit/batch saat scan | A-4c, API §7.2, M2 revisit #1 | Unit valid di luar reservasi menggantikan saran | Pola ad-hoc `takeUnitAdhoc` (M2) |
| Close line parsial & cancel | FR-OUT-8, A-3, AC-02.6/02.8 | Release presisi `qty − qty_done`; `qty_reserved` turun | `closeLineInternal`, `cancelInternal` (M2) |
| Staging → dock → confirm delivery | FR-OUT-7, A-4a, AC-02.7/02.9/02.10 | Konsumsi ke `VIRT-CUSTOMER`, `qty_delivered`, outbox | Kolom `staging/dock_location_id`, O6–O8 di `nextExpected` |
| Backorder (beberapa operasi per SO) | FR-OUT-10 | SO `PARTIAL` sampai terpenuhi | — |
| Scrap / Issue to Production + approval | FR-OUT-9, §5.7, AC-02.12 | Reason wajib, approver ≠ pembuat, konsumsi ke `SCRAP`/`PRODUCTION` | Aksi `approve` generik (M0), line dokumen I-14 (M2) |
| Surat jalan | FR-OUT-11 (S) | Dokumen cetak setelah DONE | — |
| Handheld picking & scrap | handheld §7.2/§7.7 | `/hh/picking/[id]`, `/hh/scrap/[id]` | Komponen `OperationFlow` (M1/M2) |
| Desktop outbound | frontend §5 | Sales Orders, Picking, Deliveries, Scrap/Issue, Scrap Approval | Katalog menu sudah berisi 5 route |

Stub `notImplemented(…, 'M3')` di `operations.ts` & `scan.ts` sudah diganti; `stagingScanned/dockScanned` kini dibaca dari `operation.staging/dock_location_id`; daftar tugas handheld merutekan pick list & scrap.

### 1.2 Non-fungsional yang mengikat

| NFR | Konsekuensi desain M3 |
|---|---|
| MS-2 "0 oversell" / CC-1, CC-2, CC-5, CC-8 | Semua mutasi quant tetap satu protokol A-5; jalur baru (swap) ikut protokol penuh dan mendapat uji balapan sendiri (CC-12) |
| NFR-PERF-1 (scan p95 ≤ 300 ms) | Scan unit reservasi tanpa advisory lock; hanya swap yang mengambilnya |
| NFR-PERF-2 (confirm p95 ≤ 1 s) | Confirm = satu ⟦TX⟧; outbox ditulis di dalam, dikirim worker |
| NFR-PERF-4 (generate pick list ≤ 2 s) | Generate hanya membaca agregat stok per produk, tanpa lock quant |
| Integritas D-2/D-2b | Invarian dijalankan di akhir suite integrasi & smoke M3 |

### 1.3 Batasan

Tech stack terkunci (ADR). **Tanpa perubahan schema** — tetap v1.6 (I-33). Di luar M3: alokasi terencana saat SO masuk (OQ-11, fase 2), wave/satu pick list untuk banyak SO, pick list otomatis saat ingest, staging ber-quant (D-3), PDF sisi server, scrap ad-hoc dari handheld, swap pada transfer INTERNAL (tetap `NOT_RESERVED`), warning `NEAR_EXPIRY` (belum ada ambang di `app_setting`), Adjustment (`ADJ_*`, M4), gateway callback ERP (M5).

## 2. Celah Desain yang Ditemukan (harus diputuskan sebelum coding)

| # | Celah | Dampak bila dibiarkan | Keputusan |
|---|---|---|---|
| G7 | Line pick list = satu per baris SO, tetapi stoknya bisa tersebar di beberapa bin/batch. Tabel F-OUT & `pickSteps()` memakai `line.from_location` tunggal | `SCAN_BIN` tak tahu bin mana; urutan jalan tak terdefinisi | **D-23** |
| G8 | "Batch non-saran" (D-10) tak terdefinisi presisi. Reservasi *adalah* saran FEFO; bila dibaca harfiah, server sendiri bisa mengarahkan operator ke batch yang memicu ack | FEFO bisa dilewati lewat close parsial, atau operator diminta ack tanpa sebab | **D-24** |
| G9 | Swap disebut di tiga dokumen tanpa aturan: unit mana yang sah, reservasi mana yang dilepas, lock apa yang diambil | Reservasi yatim atau oversell di jalur scan | **D-25** |
| G10 | A-2 melompati batch expired untuk semua OUTGOING, padahal seed punya reason `EXPIRED` untuk scrap | Barang kedaluwarsa tak bisa di-scrap | **D-26** |
| G11 | Start A-2 bersifat semua-atau-gagal; tak ada cara mengirim sebagian bila stok kurang, dan generate dua kali menghasilkan pick list ganda | Backorder (FR-OUT-10) butuh edit manual; daftar tugas berisi pick list yang pasti gagal | **D-27** |
| G12 | `sales_order` tak punya gudang; `operation.warehouse_id` wajib | Pick list tak tahu gudang pelaksana | **D-27** (`warehouse_id` di body) |
| G13 | Status SO hanya ditulis sepihak (A-2 → PROCESSING, A-4a → PARTIAL/DONE); cancel/close tak mengembalikannya | SO tersangkut `PROCESSING` setelah pick list dibatalkan | **D-28** |
| G14 | Picker meng-claim operasi; petugas delivery (user lain) harus scan dock & confirm. RBAC scan = `menu_code`, G-4 menyembunyikan langkah dari non-pemegang klaim | Delivery tertahan sampai klaim kedaluwarsa (120 menit) | **D-29** |
| G15 | D-19 (identitas unit di tujuan) hanya ditulis untuk INTERNAL. Tujuan OUTGOING adalah endpoint tanpa quant | `stock_move.hu_id`, status HU, dan cache lokasi tak terdefinisi saat barang keluar | **D-30** |
| G16 | Approval scrap tetap berlaku walau operasi di-`reopen` lalu line-nya diubah | Yang dikonsumsi bisa berbeda dari yang disetujui | **D-31** |
| G17 | `stagingScanned`/`dockScanned` belum diisi; O6/O7 muncul walau tak ada barang yang dipick | Alur buntu di staging untuk operasi kosong | Flow-steps v1.3 (§6) |
| G18 | Saran batch/lokasi pick list: bila disimpan di `operation_line.batch_id/hu_id`, reserve memperlakukannya sebagai filter (mengikat) | Start gagal saat stok bergeser sejak generate | **I-26** |
| G19 | API §7.3 menjanjikan PDF surat jalan; stack tak punya pustaka PDF | Dependensi baru di luar ADR | **I-27** |

## 3. Arsitektur (yang dibangun)

```
 Handheld /hh                                   Desktop (protected)
  Tugas → /hh/picking/[id] (OperationFlow +      Sales Orders (list · detail · generate pick list)
          dialog ack FEFO)                       Picking (list · detail + saran/reservasi · cancel)
  Tugas → /hh/scrap/[id]                         Deliveries (antrean · confirm · cetak surat jalan)
                                                 Scrap/Issue (list · buat · detail) · Scrap Approval
        └───────────────┬─────────────────────────────┘
                        ▼  apps/web /api/v1 (authed → CSRF → zod → idempotent(uow) → use-case)
                        │  /outbound/orders[/{id}[/cancel|/generate-picklist]]      (X-API-Key: ingest/PATCH/cancel/GET)
                        │  /outbound/picking[/{id}] · /outbound/deliveries[/{id}/document]
                        │  /outbound/scrap · /outbound/scrap-approval
                        │  /operations/{id}/{start|scan|approve|confirm|cancel} · …/lines/{lineId}/close
                        ▼
  packages/application   outbound-orders (ingest/PATCH/cancel, cermin PO) · picklists (generate, list, saran)
                         outgoing (startOutgoing, closeLine, cancel, confirmOutgoing A-4a, outbox)
                         scan-outgoing (F-OUT: bin/unit/qty, FEFO, swap, staging/dock) · scrap (create, antrean approval)
                         F-SCR memakai scan-internal apa adanya (I-24)
  packages/domain        nextExpected v1.3 (bin aktif dari reservasi, O1 + swap, O6/O7) · salesOrderStatus ·
                         fefoDeviation · planSwap · expiryCutoff · unitIdentity (tujuan tunggal) — semuanya murni
  packages/infrastructure DrizzleSalesOrderRepository (baru) · inventory.candidates(+minExpiryDate, scope gudang) ·
                         operations: setStaging/setDock, antrean deliveries & approval, myTasks(+delivery_date)
                        ▼
  PostgreSQL (schema v1.6, tak berubah)  sales_order(_line) · stock_reservation · quant · stock_move ·
              operation(staging/dock_location_id, approved_by) · operation_line(fefo_override_*) · integration_event
```

## 4. Alur Data Kritis

### 4.1 Sales Order (ingest / PATCH / cancel) — cermin PO (M1)

```
POST /outbound/orders        partner type CUSTOMER (UNKNOWN_PARTNER) · sku (UNKNOWN_PRODUCT) · uom (UNKNOWN_UOM) → qty base
                             erp_ref ada & isi sama → 200 resource lama; isi beda → 409 ERP_REF_CONFLICT
PATCH  /outbound/orders/{id} 🔒 header → 🔒 line; qty baru ≥ qty_reserved + qty_delivered (QTY_BELOW_EXECUTED);
                             status dihitung ulang (D-28); SO CANCELLED → 409 INVALID_TRANSITION
POST   …/cancel              🔒 pick list (urut id) → 🔒 header; ada IN_PROGRESS → 422 ORDER_IN_EXECUTION;
                             pick list READY ikut CANCELLED; SO → CANCELLED (qty_delivered tetap) + ORDER_STATUS_CHANGED
```

### 4.2 Generate pick list (D-27, ⟦TX⟧, tanpa lock quant)

```
POST /outbound/orders/{id}/generate-picklist {warehouse_id?}      RBAC: create pada outbound_picking
🔒 sales_order → status ∈ {RECEIVED, PROCESSING, PARTIAL} (else 422 ORDER_NOT_OPEN) → 🔒 sales_order_line urut id
per baris SO (urut line_no):
    sisa     := qty − qty_reserved − qty_delivered − Σ qty_base line pick list READY milik baris ini
    tersedia := Σ quant(produk, status ∈ allowed_from_status, bin usable gudang, lolos D-26)
                − qty pick list READY milik SO ini untuk produk itu (sudah dijanjikan, belum direservasi)
                − yang sudah dipakai baris sebelumnya ber-SKU sama (penghitung berjalan per produk)
    q := min(sisa, tersedia);  q = 0 → skipped[] {line_no, sku, sisa, tersedia}
semua sisa = 0 → 422 NO_LINES;  ada sisa tetapi semua q = 0 → 422 INSUFFICIENT_STOCK
INSERT operation OUT_DELIVERY (READY, ref_no DLV-YYYY-nnnnn, source_doc = SALES_ORDER/so.id, gudang)
     + operation_line per baris ber-q (qty = qty_base = q, UOM base, so_line_id; TANPA from_location/batch/hu)
→ 201 {operation, skipped[]}
```

### 4.3 Start OUT_DELIVERY = reserve (A-2, ⟦TX⟧)

```
🔒 operation (READY) → klaim (D-16)
→ 🔒 sales_order (CANCELLED → 422 ORDER_NOT_OPEN) → 🔒 sales_order_line urut id          (A-5 langkah 2)
→ 🔒adv(product) urut product_id                                                          (A-5 langkah 3)
→ per line (urut id):
     qty_reserved + qty_delivered + line.qty_base > so_line.qty → ROLLBACK 422 SO_OVER_ALLOCATION
     kandidat := quant(produk, status ∈ allowed_from_status, bin usable gudang operasi,
                       expiry ≥ cutoff D-26)  ORDER BY expiry (FEFO efektif), hu NULLS FIRST, kode lokasi, id
                 FOR UPDATE OF q
     flip in-place ke RESERVED + UPSERT stock_reservation (qty_done = 0)                  (reserveLine M2)
     kurang → ROLLBACK 422 INSUFFICIENT_STOCK {product, short, excluded_by_expiry}
     so_line.qty_reserved += line.qty_base
→ status SO dihitung ulang (D-28) → operation IN_PROGRESS
```
Scrap/issue (`F-SCR`) memakai `startInternal` apa adanya: scope = `line.from_location` + filter atribut line, cutoff expiry per D-26.

### 4.4 Scan F-OUT (A-4c, ⟦TX⟧ singkat)

| Kode | Milik reservasi pending operasi | Di luar reservasi |
|---|---|---|
| Bin | Cursor = bin itu (SOURCE); line aktif = line ber-reservasi pending di bin (line cursor dulu, lalu urutan jalan) | Bin usable gudang operasi → cursor = bin itu, line aktif tetap; unit berikutnya diproses sebagai swap. Bin gudang lain / tak usable → `422 INVALID_BIN` |
| LPN / karton | HU direservasi utuh & berada di bin cursor → cek FEFO (D-24) → semua reservasinya `qty_done = qty` | Swap (D-25) bila seluruh isi bebas HU muat di sisa line; selain itu `409 NOT_RESERVED` |
| Serial | Reservasi `serial = X` di bin cursor → cek FEFO → done | Swap (D-25) satu unit |
| Barcode produk → `ENTER_QTY` | Qty dibagi FEFO ke reservasi lepas line **di bin cursor** (D-18) | Kelebihan dari reservasi di bin itu → swap (D-25) sebesar selisih; stok bin kurang → `422 INSUFFICIENT_STOCK` |
| Staging / Dock | — | Tipe `STAGING`/`DOCK`, usable, gudang operasi (`INVALID_BIN`) → `operation.staging_location_id` / `dock_location_id` |

Setelah tiap scan: line `DONE` otomatis bila `Σ qty_done = qty_base`; `cursor.line_id` dikosongkan bila line selesai **atau** reservasi pending line di bin cursor habis (D-23), sehingga langkah berikutnya mengikuti urutan jalan.

### 4.5 Close line & cancel (A-3, ⟦TX⟧)

```
🔒 operation → 🔒 sales_order → 🔒 sales_order_line → 🔒adv(product) → 🔒 quant RESERVED milik reservasi
close line : tiap reservasi line dilepas qty − qty_done (kembali persis ke source_status); line DONE;
             so_line.qty_reserved −= Σ dilepas
cancel     : semua reservasi ACTIVE dilepas penuh; so_line.qty_reserved −= Σ; cursor dihapus; operation CANCELLED
→ status SO dihitung ulang (D-28)
```

### 4.6 Confirm OUTGOING (A-4a, ⟦TX⟧ atomik)

```
🔒 operation (IN_PROGRESS) → hak confirm_menu_code ?? menu_code
→ require_approval ∧ belum approve → 422 NEEDS_APPROVAL;  ada line PENDING → 422 LINES_OPEN;
  tak ada line ber-qty_done → 422 NO_LINES
→ 🔒 sales_order → 🔒 sales_order_line → 🔒adv(product) → 🔒 quant RESERVED
→ tujuan VIRT-CUSTOMER/PRODUCTION: batch kini expired (zona waktu gudang) → 422 EXPIRED          (D-26)
→ sisa reservasi yang belum discan dilepas (defensif; normalnya 0 setelah close)
→ rencana identitas unit (D-30, fungsi murni, total isi HU dibaca SEBELUM mutasi)
→ per reservasi R ber-qty_done (urut quant_id):
     R → CONSUMED (DULU) → quant RESERVED −qty_done (0 → DELETE); tak ada quant di tujuan (D-1)
     stock_move(R.location → optype.default_dest, from_status = R.source_status, to_status = NULL,
                hu = D-30, batch, serial, reason_code_id)
     serial → CONSUMED
     so_line.qty_delivered += qty_done;  so_line.qty_reserved −= R.qty
→ HU utuh → SHIPPED (delivery) / EMPTY (scrap, issue); karton utuh dari pallet → parent NULL; HU tanpa isi → EMPTY
→ line.to_location = default_dest; line DONE; cursor dihapus
→ status SO dihitung ulang (D-28) → outbox SHIPMENT_CONFIRMED (+ ORDER_STATUS_CHANGED bila status berubah)
→ operation DONE
```

### 4.7 Scrap / Issue to Production (§5.7)

```
POST /outbound/scrap {operation_type_code, reason_code, warehouse_id?, note?, lines[]}     → DRAFT
     reason wajib (MISSING_REASON) & applies_to cocok tujuan (D-31); lines = bentuk I-14 (unit_code | lokasi+sku+qty)
ready → [approve oleh user lain ber-hak outbound_scrap_approval — kapan pun READY/IN_PROGRESS]
start (reserve di from_location, status ∈ allowed_from_status) → scan bin → unit → close line
confirm → 4.6 dengan tujuan SCRAP | PRODUCTION; tanpa SO, tanpa outbox
```

## 5. Keputusan Baru

### 5.1 Behavioral (akan masuk behavioral §2)

| ID | Keputusan | Alasan |
|---|---|---|
| **D-23** | **Unit kerja picking = reservasi, bukan line.** Line `OUT_DELIVERY` (satu per baris SO) tidak menyimpan lokasi, batch, atau HU; ketiganya ada di reservasi. *Urutan saran* dalam satu line: expiry naik (bila FEFO efektif) → kode lokasi → id. *Bin aktif* line = lokasi reservasi pending pertamanya. *Urutan jalan* antar-line = kode bin aktif, lalu id line. `cursor.line_id` dilepas saat reservasi pending line di bin cursor habis. Line scrap/issue tetap ber-`from_location` (dokumen menunjuk stok tertentu). | Satu baris SO bisa dipenuhi dari beberapa bin. FEFO di dalam line didahulukan dari rute, sehingga close parsial selalu menyisakan batch ber-expiry paling jauh. |
| **D-24** | **Definisi deviasi FEFO (hanya F-OUT, flag FEFO efektif).** Acuan = expiry terawal di antara reservasi pending line. Scan/swap batch Y adalah deviasi bila `expiry(Y) > acuan` (tanpa expiry = paling jauh). Untuk qty lepas, Y = expiry terjauh di antara reservasi yang ditandai. `fefo_policy=block` → `422 FEFO_VIOLATION`; `warn` → `422 FEFO_ACK_REQUIRED` sampai request yang sama dikirim ulang dengan `fefo_override_reason` (reason `applies_to = FEFO_OVERRIDE`). Tiap scan deviasi membawa reason sendiri. Dicatat di `operation_line.fefo_override_*` (kejadian terakhir) dan `audit_log` (tiap kejadian); respons membawa warning `FEFO_OVERRIDDEN`. | Menutup celah "pick batch muda lalu close parsial". Saran server sendiri tak pernah memicu ack karena urutan saran sudah FEFO (D-23). |
| **D-25** | **Swap (hanya F-OUT).** Unit/qty di luar reservasi operasi diterima bila: produk = produk line PENDING (line aktif dulu); quant berada di bin cursor, berstatus ∈ `allowed_from_status`, dan tidak dipegang operasi lain; unit ber-kode muat **utuh** di sisa pending line; lolos D-26 dan D-24. Efek atomik: 🔒adv(produk) → `FOR UPDATE` quant → lepas reservasi pending line **menurut urutan saran** sebesar qty unit (A-3) → reservasi unit baru dengan `qty_done = qty`. `sales_order_line.qty_reserved` tidak berubah. Gagal syarat → `409 NOT_RESERVED` (`details.cause`: `OTHER_OPERATION`, `EXCEEDS_REMAINING`, `PRODUCT_MISMATCH`, `STATUS`). F-SCR dan INTERNAL tidak mengenal swap. | "Ambil pallet sebelah" adalah kejadian harian; saran bersifat non-mengikat (API §7.2). Melepas saran yang sedang diminta sesuai maksud operator: unit ini menggantikan yang itu. |
| **D-26** | **Aturan kedaluwarsa mengikuti tujuan** (`default_dest.type`), bila flag expiry efektif: `VIRTUAL_CUSTOMER` → tolak expired **dan** sisa umur < minimum partner (A-6d); `PRODUCTION` → tolak expired saja; `SCRAP` → tanpa cek. Diterapkan di tiga titik: reserve (kandidat dilewati), scan/swap (`422 EXPIRED` / `SHELF_LIFE`), dan confirm (cek ulang expired saja). | Scrap justru jalur keluar barang kedaluwarsa (reason `EXPIRED` di seed). Operasi yang melewati tengah malam tak boleh mengirim batch yang baru saja kedaluwarsa. |
| **D-27** | **Pick list = yang bisa diambil sekarang.** `generate-picklist {warehouse_id?}` (default gudang user) membuat satu operasi untuk satu SO di satu gudang. Qty line = `min(sisa, tersedia)`; sisa memperhitungkan pick list READY yang belum start. Baris tanpa stok masuk `skipped[]`. Pick list lahir READY dan tidak diedit: `reopen` → `409 INVALID_TRANSITION`; salah → cancel lalu generate ulang. `start` tetap semua-atau-gagal (A-2, CC-1). | Backorder berjalan tanpa edit manual: sisa SO tetap "belum teralokasi" dan di-generate lagi saat stok datang. Generate ganda tak lagi menghasilkan tugas yang pasti gagal. |
| **D-28** | **Status SO = fungsi murni** dari baris-barisnya, dihitung ulang setelah reserve, release, consume, dan PATCH: `CANCELLED` (lekat) → semua `qty_delivered ≥ qty` ⇒ `DONE` → `Σ qty_delivered > 0` ⇒ `PARTIAL` → `Σ qty_reserved > 0` ⇒ `PROCESSING` → `RECEIVED`. `ORDER_STATUS_CHANGED` dikirim saat status menjadi `PARTIAL`, `DONE`, atau `CANCELLED`. | Pick list yang dibatalkan mengembalikan SO ke `RECEIVED`; satu sumber kebenaran untuk empat jalur tulis. |
| **D-29** | **Serah-terima tahap delivery.** *Tahap delivery* = `OUT_DELIVERY` IN_PROGRESS, semua line DONE, ada qty terpick, dan staging sudah discan (atau gudang tanpa lokasi STAGING). Pada tahap ini aktor ber-hak edit `confirm_menu_code` boleh scan dock dan confirm **tanpa menunggu klaim kedaluwarsa**; klaim berpindah kepadanya. Scan `SCAN_DOCK` menerima hak edit `menu_code` **atau** `confirm_menu_code`. G-4 dikecualikan untuk aktor tersebut; operasi muncul di antrean Deliveries dan `my-tasks` miliknya. | Picker dan petugas delivery biasanya orang berbeda (handheld §7.2). Tanpa ini delivery tertahan TTL klaim. |
| **D-30** | **Identitas unit keluar (perluasan D-19 ke OUTGOING).** HU keluar **utuh** bila seluruh isinya (pallet: termasuk karton anak) dikonsumsi operasi ini → `stock_move.hu_id` = HU itu, status `SHIPPED` (delivery) atau `EMPTY` (scrap/issue), cache `location_id = NULL`. Tidak utuh → `stock_move.hu_id = NULL`; karton yang dirinya utuh tetap tercatat dengan `parent_hu_id := NULL`. HU yang kehabisan isi karena diambil sebagian-sebagian → `EMPTY`. Serial selalu `CONSUMED`. | Satu aturan identitas untuk semua direction; trace "pallet X dikirim ke siapa" terbaca dari ledger. |
| **D-31** | **Approval melekat pada isi yang disetujui.** `reopen` mengosongkan `approved_by/approved_at`. Approve sah di READY atau IN_PROGRESS; confirm tanpa approval → `422 NEEDS_APPROVAL`. Reason operasi wajib ber-`applies_to` sesuai tujuan: `SCRAP` → `SCRAP`, `PRODUCTION` → `ISSUE` (selain itu `422 MISSING_REASON`). | Segregation of duties (D-11) tak berarti bila isi bisa diubah setelah disetujui. |

### 5.2 Implementasi

| # | Keputusan | Alasan | Trade-off / biaya |
|---|---|---|---|
| I-22 | `startOutgoing` memanggil `reserveLine` M2; `CandidateFilter` ditambah `minExpiryDate` dan scope "bin usable gudang" | Satu mesin reservasi untuk INTERNAL & OUTGOING | Filter expiry dievaluasi per produk (flag efektif) → satu query kandidat per line |
| I-23 | Urutan lock OUTGOING ber-SO: operation → header SO → line SO → advisory produk → quant, di start, close line, cancel, confirm | A-5 langkah 2; sejalan dengan PATCH/cancel SO | Operasi pada SO yang sama terserialisasi di header (volume per SO kecil) |
| I-24 | F-SCR memakai handler `scan-internal` tanpa perubahan; F-OUT di modul baru `scan-outgoing.ts` | Line scrap ber-`from_location` persis seperti transfer dokumen | Dua modul scan non-INCOMING; logika bersama tetap di `reservations.ts` |
| I-25 | Swap mengambil advisory lock produk di dalam ⟦TX⟧ scan | Swap memutasi quant → wajib A-5 penuh | Scan swap lebih lambat dari scan biasa (sama dengan ad-hoc I-12) |
| I-26 | Saran pick list READY **tidak disimpan**; dihitung A-1 tanpa lock saat `GET /outbound/picking/{id}` (`suggestions[]`, `shortage`). Setelah start, saran = reservasi | Kolom line bersifat filter; saran harus non-mengikat | Detail READY menjalankan query stok per line tiap dibuka |
| I-27 | Surat jalan = DTO dari `POST /outbound/deliveries/{id}/document` + halaman cetak HTML (print CSS); dicatat `audit_log` `PRINT` | Tanpa dependensi PDF di luar ADR | "Simpan PDF" lewat dialog cetak browser; tata letak tak piksel-presisi |
| I-28 | Line pick list dalam base UOM | Sisa SO setelah kirim parsial belum tentu kelipatan UOM ERP | Tampilan mengandalkan roll-up A-6c |
| I-29 | Kirim ulang scan dengan `fefo_override_reason` memakai `Idempotency-Key` **baru** | Payload berbeda; baris key request gagal sudah ikut rollback (D-15) | Klien wajib membuat key baru di dialog ack |
| I-30 | `SHIPMENT_CONFIRMED` memuat qty **operasi ini** (bukan kumulatif), `ref = sales_order` agar urutan per order terjaga | Cermin `RECEIPT_CONFIRMED` (M1) | ERP menjumlah sendiri untuk kumulatif |
| I-31 | Scrap/issue hanya mode dokumen: dibuat di desktop, dieksekusi dari daftar tugas handheld | Butuh reason + approval sebelum eksekusi | Operator tak bisa membuat scrap dari handheld |
| I-32 | `my-tasks` diurutkan `delivery_date` SO lalu `created_at`; operasi tahap delivery terlihat oleh pemegang hak confirm (D-29) | API §4.1 | Satu LEFT JOIN ke `sales_order` |
| I-33 | Tanpa perubahan schema & seed; katalog `reason` tidak bertambah | Kolom yang dibutuhkan sudah ada sejak v1.5/v1.6 | Kegagalan swap dibedakan lewat `details.cause`, bukan reason baru |
| I-34 | `SCAN_BIN` menjadi alternatif di semua langkah unit F-OUT (O2–O5, O5′) | Ditemukan uji swap: di bin saran operator tak bisa pindah ke bin lain untuk mengambil pengganti | Kode lokasi yang tertembak tak sengaja memindahkan konteks bin (operator cukup scan ulang) |
| I-35 | Rute `/hh/delivery/{id}` (guard `outbound_deliveries`) + `my-tasks` memuat operasi tahap delivery bagi pemegang hak confirm; desktop Deliveries punya input scan dock | D-29 butuh pintu masuk bagi petugas tanpa hak Picking | Dua rute handheld untuk operasi yang sama (layar identik) |
| I-36 | Saat confirm, `qty_reserved` baris SO diturunkan **sebelum** `qty_delivered` dinaikkan | `CHECK (qty_reserved + qty_delivered <= qty)` dievaluasi per statement — urutan terbalik ditolak DB pada uji pertama | Dua `UPDATE` per reservasi ber-SO (bisa digabung jadi satu statement bila jadi hotspot) |
| I-37 | Ketersediaan saat generate dikurangi qty pick list READY milik **SO yang sama** | Tanpa itu generate kedua menawarkan stok yang sudah dijanjikan ke pick list pertama SO itu | Lintas SO tetap tanpa alokasi (OQ-11): dua SO bisa sama-sama mendapat pick list untuk stok yang sama, yang start lebih dulu menang |
| I-38 | `cursor.line_id` dibersihkan **setelah** scan (`staleCursorLine`) dengan memuat ulang view hanya bila perlu | D-23 tanpa aritmetika per handler (mark, swap, lepas) | Satu muat-ulang view tambahan saat reservasi line di bin habis |
| I-39 | Antrean Scrap Approval menampilkan isi operasi inline (`GET /operations/{id}` mengizinkan view lewat `approve_menu_code`) | Approver belum tentu punya hak menu Scrap | Detail penuh (reservasi) tetap di halaman Scrap |

### 5.3 Keputusan yang mengubah perilaku tertulis (dikonfirmasi 12-10-2026)

Lima keputusan di bawah mengubah atau mempersempit perilaku yang sudah tertulis; rekomendasinya disetujui pemilik produk.

| Keputusan | Yang berubah dari dokumen sekarang | Alternatif yang ditolak |
|---|---|---|
| D-27 | Qty pick list dibatasi stok tersedia; `reopen` pick list ditolak | Start parsial (melanggar A-2/CC-1); edit line lewat reopen (butuh endpoint PATCH line yang belum ada) |
| D-25 | Swap hanya untuk `OUT_DELIVERY`; transfer INTERNAL tetap `NOT_RESERVED` (M2 revisit #1 ditunda lagi) | Swap untuk semua flow (line transfer menunjuk unit spesifik, swap tak bermakna) |
| D-26 | Scrap boleh mengambil barang expired; issue ke produksi menolak expired | Satu aturan untuk semua OUTGOING (A-2 sekarang) |
| D-29 | Pemegang hak `outbound_deliveries` boleh mengambil alih klaim di tahap delivery | Klaim dilepas otomatis setelah staging (picker ber-hak confirm kehilangan tugasnya) |
| I-27 | Surat jalan berupa halaman cetak, bukan PDF dari server | Menambah pustaka PDF (perlu ADR baru) |

## 6. Perubahan Kontrak (sudah diterapkan)

| Dokumen | Perubahan |
|---|---|
| Schema | Tidak ada (tetap v1.6); `ddl-validation` tetap 48 skenario |
| Behavioral 1.3 | D-23..D-31; A-2 varian OUT_DELIVERY (scope gudang, cutoff expiry, lock header SO); A-4a memakai `qty_done` & D-30; A-4c memuat definisi FEFO & swap; §6.3 `NOT_RESERVED` + `details.cause`; **CC-12** (swap ‖ start pada unit yang sama → tepat satu menang, Σ RESERVED ≤ on-hand) |
| Flow-steps 1.3 | Urutan jalan F-OUT dari bin aktif reservasi (D-23); O1 menerima scan unit sebagai alternatif bila bin SOURCE sudah discan (swap); O6/O7 hanya bila ada qty terpick; G-4 dikecualikan di tahap delivery (D-29); §8 `SCAN_BIN` SOURCE F-OUT menerima bin usable mana pun di gudang |
| API 1.5 | Body & respons `generate-picklist` (`warehouse_id?`, `skipped[]`); `GET /outbound/picking[/{id}]` (+`suggestions[]`, `shortage`); `GET /outbound/deliveries` (antrean tahap delivery); `…/document` mengembalikan DTO; body `POST /outbound/scrap`; `GET /outbound/scrap-approval`; §1.4 scan `SCAN_DOCK` menerima `confirm_menu_code`; detail operasi menambah `sales_order`, `staging_location`, `dock_location`, `approved_by` |
| Handheld 1.2 | §7.2 dialog ack FEFO (ReasonPicker → kirim ulang ber-key baru); serah-terima ke petugas delivery; rute `/hh/picking`, `/hh/delivery`, `/hh/scrap` |
| ERP integration | Status SO (D-28); `SHIPMENT_CONFIRMED` = qty pengiriman ini; `ORDER_STATUS_CHANGED` SO → PARTIAL/DONE/CANCELLED |
| Test-delivery | CC-12 masuk suite konkurensi (CC-1..12); `scripts/smoke-m3.sh` di runbook |
| `scripts/smoke-m0.sh` | Cek "OUTGOING belum tersedia (M3)" diganti cek kerangka transisi (reason wajib, If-Match, cancel); placeholder dipindah ke modul M4 |
| CLAUDE.md / README | Status M3, perintah smoke, peta dokumen & kode |

## 7. Skala & Keandalan

- **Kunci:** start/close/cancel/confirm pada SO yang sama antre di header SO; lintas SO hanya bertemu di advisory lock produk (SKU panas → antrean per produk, diterima — NFR-PERF-6 lintas SKU).
- **Scan:** unit reservasi = satu `UPDATE` reservasi + sinkron line, tanpa advisory lock. Swap = advisory lock + release + reserve; frekuensinya rendah.
- **Beban data:** pick list ber-serial besar memuat semua reservasi per scan (I-19 M2) — diukur di uji beban M5, mitigasi sama (view ringkas per HU).
- **Kegagalan:** confirm gagal di langkah mana pun ⇒ rollback penuh, termasuk baris outbox. Idempotensi di ⟦TX⟧ bisnis (D-15) melindungi retry handheld.
- **Stok bergeser sejak generate:** start gagal `INSUFFICIENT_STOCK` → cancel + generate ulang (D-27). Tak ada reservasi yatim karena generate tidak mereservasi.
- **Observabilitas:** D-2/D-2b di akhir suite & smoke; `integration_event` `PENDING` menumpuk sampai gateway M5 — worker outbox M0 sudah mengambilnya.

## 8. Pembuktian (gate)

| Lapisan | Isi | Perintah |
|---|---|---|
| Domain | **90 tes**: `nextExpected` v1.3 (baris O1–O8, O5′/swap, O6/O7 tanpa qty, pengecualian G-4, dua walkthrough), `salesOrderStatus` (D-28), `expiryRule`/`expiryCutoff`/`expiryVerdict` (D-26), `fefoDeviation` (D-24), `planSwap` (D-25) | `pnpm test` |
| Integrasi (PG14 nyata) | **31 skenario M3** (`outbound.int.test.ts`): SO ingest/PATCH/cancel (+ balapan ingest); generate (cap, `skipped`, janji SO sendiri, `NO_LINES`, `ORDER_NOT_OPEN`, reopen ditolak); **AC-02.1–02.12**; reserve FEFO + expired/shelf-life (`excluded_by_expiry`); close line & cancel presisi; walkthrough pallet + serah-terima D-29; barang lepas multi-bin + backorder → `PARTIAL` → `DONE`; serial & karton (D-30) + swap serial; FEFO warn/ack/audit/block + unit reservasi di luar urutan; `NOT_RESERVED` per cause + swap lepas antar-bin; expiry di swap & confirm; operasi kosong; scrap expired + approval, reopen menggugurkan approval, issue menolak expired, scrap dari DAMAGED; **CC-1, CC-2, CC-5, CC-8, CC-12**; matriks RBAC optype × aksi (13 baris × 5 peran) + service account ERP; **D-2 & D-2b** di akhir suite. Suite M0 (14), M1 (24), M2 (22) tetap hijau → total 91 | `pnpm test:integration` |
| HTTP end-to-end | **81 cek** `scripts/smoke-m3.sh`: SO via API key → pick list → reserve → scan → staging → dock → confirm → surat jalan; backorder + close parsial; FEFO ack + swap; cancel SO; scrap + approval oleh user kedua; 13 halaman ber-guard; D-2. Smoke M0 (31), M1 (48), M2 (63) tetap hijau | `bash scripts/smoke-m3.sh` (DB segar; `PSQL=…` untuk DB selain compose) |
| Gate statis | format, lint, type-check, build (15 route API + 12 halaman outbound/handheld baru) | `pnpm format:check` · `pnpm lint` · `pnpm type-check` · `pnpm build` |

CC-8 dibangun dengan pick list kedua yang disisipkan langsung oleh harness uji: D-27 mencegah pick list ganda lewat API, sehingga CC-8 menguji jaring pengaman A-2 dan `CHECK` DB. Tampilan halaman diverifikasi lewat HTTP 200 + build, **belum** lewat uji visual/e2e browser (Playwright = gate rilis, test-delivery §11).

## 9. Urutan Pengerjaan (semua irisan selesai)

Tiap irisan berakhir dengan gate hijau.

| # | Irisan | Menutup |
|---|---|---|
| 1 | Sales Order: repo, ingest/PATCH/cancel, list/detail, halaman Sales Orders | FR-OUT-1, D-28 (fungsi murni + PATCH) |
| 2 | Generate pick list, daftar/detail picking + saran, start reserve, cancel, close line | FR-OUT-2/3/8/10, D-27, I-22/23/26, AC-02.1/02.2/02.6/02.8, CC-1, CC-8 |
| 3 | Scan F-OUT untuk unit reservasi, staging/dock, confirm A-4a, outbox, status SO | FR-OUT-4/7, D-23, D-29, D-30, AC-02.7/02.9/02.10/02.11, CC-2 |
| 4 | Expiry, FEFO, swap | FR-OUT-5/6, D-24, D-25, D-26, AC-02.3/02.4/02.5, CC-12 |
| 5 | Scrap / issue + approval | FR-OUT-9, D-31, AC-02.12, CC-5 |
| 6 | Handheld picking & scrap; halaman Picking, Deliveries (+ surat jalan), Scrap, Scrap Approval | FR-OUT-11, handheld §7.2/§7.7 |
| 7 | Matriks RBAC, `smoke-m3.sh`, sinkron behavioral/flow-steps/API/handheld/CLAUDE.md | §6, §8 |

## 10. Revisit Saat Sistem Tumbuh

1. **Alokasi terencana & wave picking** (OQ-11, fase 2) — reservasi saat SO masuk, satu pick list lintas SO.
2. **Pick list otomatis saat ingest** — setting per instalasi; hari ini manual (D-27).
3. **Swap pada transfer dokumen** (M2 revisit #1) — bila klien membutuhkan fleksibilitas unit di transfer.
4. **Start parsial** — bila generate-lalu-gagal terlalu sering pada SKU panas (D-27).
5. **PDF surat jalan sisi server** & nomor dokumen terpisah dari `ref_no` (I-27).
6. **Warning `NEAR_EXPIRY`** — butuh ambang di `app_setting`.
7. **Scrap ad-hoc dari handheld** dengan approval menyusul (I-31).
8. **Staging ber-quant** (D-3) — hop ledger bin → staging → customer.
9. **View ringkas per HU** untuk pick list ber-serial besar (gabung dengan revisit M1 #1 / M2 #2).

---

## Ringkasan Keputusan (M3)

1. Pick list = satu operasi `OUT_DELIVERY` untuk satu SO di satu gudang, lahir READY, qty dibatasi stok tersedia; start tetap semua-atau-gagal dengan urutan lock operation → header SO → line SO → advisory produk → quant (D-27, I-23).
2. Unit kerja picking adalah reservasi: bin aktif, urutan saran (FEFO lalu lokasi), dan urutan jalan diturunkan dari reservasi pending (D-23).
3. Deviasi FEFO = batch ber-expiry lebih jauh dari reservasi pending terawal line; `block` menolak, `warn` meminta reason per scan dan mencatatnya di line + audit (D-24).
4. Swap hanya untuk `OUT_DELIVERY`: unit valid di bin cursor menggantikan saran berikutnya secara atomik dengan protokol A-5 penuh; selain itu `NOT_RESERVED` (D-25).
5. Aturan kedaluwarsa mengikuti tujuan: customer = expired + shelf-life, produksi = expired, scrap = bebas; dicek di reserve, scan, dan confirm (D-26).
6. Status SO adalah fungsi murni dari baris-barisnya dan dihitung ulang di setiap jalur tulis (D-28).
7. Tahap delivery boleh diambil alih pemegang hak `outbound_deliveries`; scan dock menerima hak picking atau delivery (D-29).
8. Confirm OUTGOING mengonsumsi `qty_done` tiap reservasi; HU utuh → `SHIPPED`/`EMPTY`, serial → `CONSUMED`, `stock_move.hu_id` mengikuti aturan HU utuh (D-30); outbox `SHIPMENT_CONFIRMED` ditulis dalam ⟦TX⟧ yang sama.
9. Approval scrap gugur saat `reopen`; reason wajib sesuai tujuan; scrap/issue hanya mode dokumen (D-31, I-31).
10. Tanpa perubahan schema, seed, maupun katalog reason; mesin reservasi M2 dipakai ulang (I-22, I-33).
11. Bukti: 90 tes domain, 31 uji integrasi M3 (AC-02.1–02.12, CC-1/2/5/8/12, matriks RBAC optype, D-2/D-2b; M0–M2 tetap hijau), smoke HTTP 81 cek; gate format, lint, type-check, build hijau.
