# M2 Internal — Desain Implementasi · WMS Baseline

**Bagaimana milestone M2 (Bin-to-bin, Inter-site via IN_TRANSIT, Carton Break, Quarantine/QA) direalisasikan di kode · pelengkap test-delivery §12**

Versi: 1.0 · 25 September 2026

> Dokumen ini **tidak** mengulang aturan bisnis. Sumbernya tetap behavioral §4 (A-2/A-3/A-4c/A-5) & §5.3–5.6, flow-steps §7.3–7.5 & §7.8, API §6, requirements UC-03/UC-04/UC-05 (AC-05.4). Isinya: celah yang harus ditutup sebelum coding, peta komponen, alur data, keputusan baru (behavioral **D-17..D-22**, implementasi **I-11..I-19**) beserta trade-off, cara membuktikannya, dan hal yang perlu ditinjau ulang.

---

## 1. Kebutuhan & Cakupan

### 1.1 Fungsional (M2) — status

| Item | Sumber | Inti | Status · bukti |
|---|---|---|---|
| Bin-to-bin transfer (mode dokumen & ad-hoc handheld) | FR-INT-1, behavioral §5.3, flow-steps F-TRF | Reserve saat `start` (A-2) → scan sumber → unit → tujuan → confirm netral | ✅ `internal.int.test.ts` "Bin-to-bin"; smoke M2 |
| Inter-site dispatch & receive | FR-INT-2, UC-04 (AC-04.1–04.4), §5.4, F-ISD/F-ISR | 2 operasi via `IN-TRANSIT`, receive menaut `parent_operation_id`, parsial boleh | ✅ "Inter-site" (2 skenario); smoke M2 (2 gudang) |
| Carton Break (preview + eksekusi instan) | FR-INT-3/4, UC-03 (AC-03.1–03.5), §5.5 | Karton → BROKEN, N item (± Pack S/N) via `VIRT-TRANSFORM` | ✅ "Carton Break" (6 skenario, termasuk packaging berubah & idempotensi) |
| HU karton saat receipt | behavioral D-14 (ditunda M1), M1 §6 #4 | Prasyarat Carton Break: Carton S/N harus ada | ✅ "D-17"; suite M1 tetap hijau |
| Quarantine hold/release/reject & mark damaged | FR-INT-5, AC-05.4, §5.6 | Operasi instan, perubahan status di ledger (D-8) | ✅ "Quarantine / QA" (3 skenario); smoke M2 |
| Lepas reservasi: cancel & close line | A-3, AC-02.6/02.8 (pola sama) | Kembali **persis** ke `source_status` | ✅ cancel presisi, close parsial, CC-4 |
| Handheld internal | handheld §7, flow-steps §7.3–7.5, §7.8 | Transfer server-driven; carton break & QA client-driven + `/lookup/code` | ✅ `/hh/transfer/[id]`, `/hh/carton-break`, `/hh/quarantine`, pintasan ad-hoc di `/hh` |
| Desktop internal | frontend §5 (1 fitur = 1 page) | Transfers (list/buat/detail/receive), Carton Break, Quarantine | ✅ halaman ber-guard (tes guard per page + smoke) |

### 1.2 Non-fungsional yang mengikat

| NFR | Konsekuensi desain M2 |
|---|---|
| MS-2 / CC-1..CC-6, CC-10 | Reservasi INTERNAL memakai protokol lock A-5 yang **sama** dengan M3 — M2 menjadi pembuktian pertama A-2/A-3 |
| NFR-PERF-1 (scan p95 ≤ 300 ms) | Scan tetap ⟦TX⟧ singkat; hanya scan ad-hoc (membuat reservasi) yang mengambil advisory lock |
| Integritas (D-2/D-2b) | Invarian quant ⇔ ledger dan RESERVED = Σ reservasi diuji di akhir suite |
| Offline = tidak ada | Handheld online-only; operasi instan satu request ber-`Idempotency-Key` |

### 1.3 Batasan

Tech stack terkunci (ADR). Pra-rilis: perubahan schema **dilipat ke `0001_baseline`** (tanpa migrasi `0002`). Di luar M2: swap batch/unit saat scan (A-4c swap → M3), FEFO ack/expiry di scan (OUTGOING, M3), kapasitas bin (SC-5), hold per batch sekaligus (recall), laporan in-transit (M4), UI master reason code (M4).

## 2. Celah Desain yang Ditemukan (harus diputuskan sebelum coding)

| # | Celah | Dampak bila dibiarkan | Keputusan |
|---|---|---|---|
| G1 | Carton S/N (HU CARTON) tak pernah diterbitkan (D-14 menunda) | Carton Break tidak punya objek untuk dipecah | **D-17** |
| G2 | `stock_reservation` tak mencatat bagian mana yang sudah discan | Line dengan >1 reservasi (serial, beberapa quant/batch) tak bisa ditutup parsial secara presisi; scan S/N tak bisa ditandai | **D-18** (`qty_done` per reservasi, schema v1.6) |
| G3 | Transfer sebagian isi pallet: quant tujuan tetap ber-`hu_id` pallet? | Pallet "ada di dua bin" — cache lokasi HU salah, scan LPN di tujuan menyesatkan | **D-19** (aturan HU utuh) |
| G4 | Tabel F-TRF T3 per line, F-ISR R1 bergantung `cursor.pending_hu`; barang lepas tak punya langkah qty di F-ISR | Alur tak lengkap untuk barang lepas; banyak scan tujuan | **D-20** + flow-steps v1.2 |
| G5 | IN_TRANSIT global: quant lepas dari dua dispatch menyatu (uq_quant_combo) | "Barang milik dispatch mana" tak bisa dibaca dari quant | **D-21** (hitung dari ledger) |
| G6 | QA API hanya `units[]` (kode) | Barang lepas tanpa kode tak bisa di-hold/damaged | **D-22** (`lines[]` qty lepas) |

## 3. Arsitektur (yang dibangun)

```
 Handheld /hh                              Desktop (protected)
  Tugas → /hh/transfer/[id] (OperationFlow)  Transfers (list · buat dokumen · detail · receive)
  Transfer ad-hoc (create → flow)            Carton Break (scan → preview → eksekusi · riwayat)
  /hh/carton-break · /hh/quarantine          Quarantine (unit QUARANTINE/DAMAGED · hold/release/reject/damaged)
  (client-driven + /lookup/code)
        └──────────────┬──────────────────────────┘
                       ▼  apps/web /api/v1 (authed → CSRF → zod → idempotent(uow) → use-case)
                       │  /internal/transfers[/{id}/receive] · /internal/carton-break[/preview]
                       │  /internal/quarantine/{hold|release|reject|mark-damaged|units}
                       │  /operations/{id}/lines[/{lineId}[/close]] · /lookup/code
                       ▼
  packages/application   transfers (create dokumen/ad-hoc, receive) · reservations (A-2 reserve,
                         A-3 release, A-4c confirm INTERNAL) · scan (F-TRF/F-ISD/F-ISR) ·
                         carton-break · quarantine · lookup · submit INCOMING + HU karton (D-17)
  packages/domain        nextExpected v1.2 (T3/R0–R3/B3 HU induk) · unitIdentity (D-19, murni) ·
                         distributeDone (D-18, murni) · cartonCount (D-17, murni)
  packages/infrastructure DrizzleReservationRepository (baru) · quant: candidates FOR UPDATE OF q,
                         take/put/delete-zero · HU: parent/location/status · inTransitOutstanding (ledger)
                       ▼
  PostgreSQL  stock_reservation(+qty_done v1.6) · quant · stock_move · handling_unit(parent_hu_id) ·
              serial(origin_hu_id) · operation(parent_operation_id, dest_warehouse_id) · operation_cursor
```

## 4. Alur Data Kritis

### 4.1 Start INTERNAL = reserve (A-2, ⟦TX⟧)

```
🔒 operation (READY) → klaim (D-16) → lines urut id
→ 🔒adv(product) urut product_id
→ per line: kandidat = quant(product, status ∈ optype.allowed_from_status, qty>0,
            lokasi = line.from_location  (F-ISR: IN-TRANSIT),
            [batch = line.batch] [hu = line.hu] [serial = line.serial])
            ORDER BY expiry (bila FEFO efektif), hu NULLS FIRST, location, id  FOR UPDATE OF q
     take := min(sisa, q.qty): quant sumber −take (0 → DELETE) → UPSERT quant RESERVED (atribut sama, D-4)
                               → UPSERT stock_reservation(line, quant RESERVED) qty += take
     sisa > 0 → ROLLBACK 422 INSUFFICIENT_STOCK
→ operation IN_PROGRESS
```

### 4.2 Scan (A-4c, ⟦TX⟧ singkat, **tanpa** advisory lock kecuali ad-hoc)

| Kode | F-TRF/F-ISD (dokumen) | F-ISR (receive) | Ad-hoc (H) |
|---|---|---|---|
| Bin | SOURCE: = `from_location` line aktif → cursor. DEST (T3): semua line ber-`qty_done>0` tanpa tujuan | DEST (R1): line ber-`qty_done>0` tanpa tujuan | SOURCE (H1/H4) atau DEST (H3) — peran dari `next_expected` |
| LPN / Carton | Tandai **semua** reservasi aktif op yang `hu = X` atau `hu.parent = X` → `qty_done = qty` | idem | Buat line per quant isi unit di bin sumber + reservasi seketika (🔒adv → FOR UPDATE) |
| Serial | Reservasi dengan `serial = X` → done | idem | idem, satu line |
| Barcode produk | → `ENTER_QTY`; qty (UOM barcode → base) didistribusikan FEFO ke reservasi line (D-18) | idem, dengan split line bila line sudah bertujuan | → `ENTER_QTY`; line qty itu + reservasi seketika |

Unit yang tidak dimiliki reservasi op → `409 NOT_RESERVED` (swap = M3). Line otomatis `DONE` bila Σ `qty_done` = `qty_base`.

### 4.3 Confirm INTERNAL (A-4c, ⟦TX⟧ atomik)

```
🔒 operation → assert tak ada line PENDING (LINES_OPEN); line ber-qty_done punya tujuan (PUTAWAY_INCOMPLETE)
   (F-ISD: tujuan = optype.default_dest = IN-TRANSIT) · tujuan divalidasi ulang (INVALID_BIN, SAME_LOCATION)
→ 🔒adv(product) urut → 🔒 quant RESERVED milik reservasi (FOR UPDATE)
→ rencana identitas unit (D-19, fungsi murni)
→ per reservasi R (urut quant_id):
     R → CONSUMED (DULU)  → quant RESERVED −R.qty (0 → DELETE)
     → UPSERT quant(tujuan, atribut R, hu' = D-19, status = optype.to_status ?? R.source_status) += R.qty
     → stock_move(R.location → tujuan, from_status = R.source_status, to_status = status)
→ HU utuh: location = tujuan; karton lepas dari pallet: parent_hu_id = NULL
→ line DONE, cursor dihapus → operation DONE
```

### 4.4 Operasi instan (Carton Break & QA, ⟦TX⟧ tunggal, `Idempotency-Key` wajib)

```
cek flag (enable_carton_break / enable_quarantine → 404) → RBAC create pada menu optype
→ validasi input (reason, unit, tujuan) → INSERT operation (ref_no) → 🔒adv(product) urut → 🔒 quant FOR UPDATE
→ efek stok + stock_move → operation DONE (started_at = confirmed_at = now)
```
Carton Break: `bin → VIRT-TRANSFORM` (hu = karton, qty N) lalu `VIRT-TRANSFORM → bin` (satu per serial atau satu baris qty N), HU karton `BROKEN`, serial baru `ACTIVE` dengan `origin_hu_id`.
QA: satu `stock_move` per quant, `from_location = to_location` bila in-place (sah karena status beda, D-8).

## 5. Keputusan Baru

### 5.1 Behavioral (masuk behavioral §2)

| ID | Keputusan | Alasan |
|---|---|---|
| **D-17** | **HU karton terbit saat `submit` INCOMING.** Bila `enable_serial ∧ product.use_serial` (Carton S/N berlaku untuk `track_level` ITEM maupun CARTON) dan UOM line **bukan base** (`qty_in_base > 1`): satu HU `CARTON` per unit UOM transaksi (qty transaksi wajib bulat → `FRACTIONAL_CONTENT`), kode dari `serial_code_format`/scope `SN` (Carton S/N), `parent_hu_id` = LPN line asal (bila ada). Line dipecah menjadi N line (qty 1 UOM itu, `qty_base = qty_in_base`, `hu_id` = karton). Quant menunjuk HU **terdalam** (karton); LPN adalah induk. Scan LPN (putaway/transfer) mencakup karton anaknya; label karton dicetak bersama LPN. | Menutup D-14; Carton Break (§5.5) butuh HU CARTON INTACT. Karton sebagai HU terdalam menjaga satu quant = satu karton sehingga N = qty quant karton (AC-03.3). |
| **D-18** | **Progres per reservasi.** `stock_reservation.qty_done` (0 ≤ qty_done ≤ qty). Scan LPN/karton/serial menandai reservasi spesifik; qty lepas (`ENTER_QTY`) didistribusikan ke reservasi line urut FEFO (expiry, lalu id). `operation_line.qty_done_base = Σ qty_done` reservasinya. Close line & cancel melepas `qty − qty_done` (A-3); confirm mengonsumsi reservasi (setelah close, `qty = qty_done`). | Tanpa ini, line dengan beberapa quant (serial, beberapa batch) tak bisa ditutup parsial secara presisi. Dipakai ulang oleh picking M3. |
| **D-19** | **Identitas unit di tujuan (aturan HU utuh).** HU dianggap pindah **utuh** bila seluruh quant-nya (untuk pallet: termasuk quant karton anak) dikonsumsi operasi ini ke **satu** lokasi tujuan. Utuh → quant tujuan mempertahankan `hu_id`, cache `handling_unit.location_id` = tujuan, nesting karton→pallet dipertahankan. Tidak utuh → quant tujuan `hu_id = NULL` (barang diambil dari HU), kecuali karton yang dirinya utuh: tetap ber-`hu_id` karton dan `parent_hu_id := NULL` (keluar dari pallet). HU yang tak lagi punya isi → `EMPTY`. `serial_id` & batch selalu ikut. **`stock_move.hu_id` = identitas unit di tujuan** (bukan HU asal) sehingga ledger konsisten dengan quant tujuan; rekonsiliasi D-2 dievaluasi per (lokasi, produk, batch, serial, status). Berlaku untuk transfer, dispatch, receive, dan QA berpindah bin. | HU tidak boleh "berada di dua bin"; scan LPN di tujuan harus berarti seluruh isi LPN; kepemilikan IN-TRANSIT (D-21) dibaca dari ledger. |
| **D-20** | **Tujuan per line.** Tipe bin tujuan transfer/receive: `STOCK` atau `QUARANTINE`, `is_usable`, gudang operasi, ≠ sumber bila status sama (`SAME_LOCATION`). F-TRF dokumen & ad-hoc: satu scan DEST berlaku untuk **semua** line ber-`qty_done > 0` yang belum bertujuan (bulk drop). F-ISR: per unit (scan unit → scan bin). Line yang sudah bertujuan lalu menerima qty tambahan **dipecah** (line baru + reservasi dipindah) agar satu line = satu tujuan. | Satu tujuan per line menjaga confirm sederhana & ledger jelas; transfer internal umumnya satu tujuan, receive truk butuh per pallet. |
| **D-21** | **Kepemilikan IN_TRANSIT per dispatch dari ledger.** Outstanding dispatch = Σ `stock_move` ke `IN-TRANSIT` oleh dispatch − Σ `stock_move` dari `IN-TRANSIT` oleh receive anak DONE, per (produk, batch, HU, serial). Receive: dispatch harus DONE (`409 INVALID_TRANSITION`); gudang = body/default user dan harus `dest_warehouse_id` (`409 WRONG_WAREHOUSE`); 🔒 dispatch, hanya satu receive aktif (`422 ORDER_IN_EXECUTION`); tak ada outstanding → `422 NO_LINES`. Line receive = outstanding; reservasi dari `IN-TRANSIT` dengan atribut persis. | Quant lepas dua dispatch menyatu di IN-TRANSIT (lokasi global); ledger immutable adalah satu-satunya jejak kepemilikan. |
| **D-22** | **Selector QA.** Body menerima `units[]` (kode HU/serial; seluruh isi HU termasuk karton anak) **dan/atau** `lines[]` (`{location_code, sku, qty, uom?, batch_no?}`, qty lepas diambil FEFO dari quant berstatus sumber). Unit dengan quant `RESERVED` → `409 UNIT_RESERVED`; status sumber ∉ `allowed_from_status` atau qty kurang → `422 INSUFFICIENT_STOCK`. Tujuan: hold opsional (STOCK/QUARANTINE), release **wajib** (STOCK/QUARANTINE; saran = `from_location` move hold terakhir), reject & mark-damaged in-place (tujuan ditolak `400`). | Barang lepas & karton rusak sebagian harus bisa di-QA; aturan identitas sama dengan D-19. |

### 5.2 Implementasi

| # | Keputusan | Alasan | Trade-off / biaya |
|---|---|---|---|
| I-11 | Reserve INTERNAL = A-2 dengan scope lokasi `from_location` (F-ISR: IN-TRANSIT) + filter atribut line; tanpa cek expiry | Transfer boleh memindah barang kedaluwarsa/rusak (allowed_from_status INT_TRANSFER termasuk QUARANTINE/DAMAGED) | Line qty lepas bisa mengambil campuran status; status tetap terjaga karena `to_status = source_status` |
| I-12 | Ad-hoc: create langsung IN_PROGRESS & ter-claim; scan unit di bin sumber membuat line + reservasi seketika dengan A-5 penuh | Behavioral §5.3 varian cepat | Scan ad-hoc mengambil advisory lock produk → lebih lambat dari scan biasa (satu-satunya pengecualian P-3 scan) |
| I-13 | Tanpa swap unit/batch di M2: unit bukan milik reservasi → `409 NOT_RESERVED` | Swap (A-4c) bergantung FEFO/expiry OUTGOING — dibangun M3 sekali untuk semua | Operator transfer dokumen harus mengambil unit yang direservasi (hint `unit_code`) |
| I-14 | Line dokumen dibuat saat create atau `POST /operations/{id}/lines` (DRAFT): `unit_code` → satu line per quant isi unit; `{location_code, sku, qty, uom?, batch_no?}` → satu line qty lepas | Reservasi 1:1 per unit memudahkan scan & close | Pallet ber-serial besar = banyak line (sama dengan receipt M1) |
| I-15 | `GET /lookup/code?code=&warehouse_id=` read-only: klasifikasi + isi stok (lokasi, status, qty, batch, saran bin asal) | Flow client-driven tidak menduplikasi klasifikasi kode (flow-steps §7.8) | Satu query per scan di layar instan |
| I-16 | Operasi instan: INSERT operation lalu langsung DONE di ⟦TX⟧ yang sama, dibungkus `idempotent()` | D-7; retry handheld aman | Tidak ada jejak "percobaan gagal" (rollback penuh) — sesuai P-2 |
| I-17 | `lines/{lineId}/close` tanpa parameter `qty_done` — menutup dengan qty yang sudah discan | Satu sumber kebenaran progres (scan) | Koreksi qty ke bawah = cancel/buat ulang |
| I-18 | Endpoint Carton Break/QA: flag mati → `404 NOT_FOUND` **sebelum** RBAC (P-4) | Fitur mati tak terlihat | — |
| I-19 | `OperationView` memuat reservasi + total isi HU yang disentuh (`huTotals`) untuk snapshot `reservedUnitKind` & aturan D-19 | Satu view untuk DTO, next_expected, confirm | View per scan makin berat untuk pallet ber-serial besar (revisit M1 §6 #1) |
| I-20 | `stock_move.hu_id` mencatat identitas di **tujuan** (D-19); pengambilan sebagian dari LPN tercatat `hu_id = NULL` | Ditemukan saat menyusun uji inter-site parsial: bila ledger memakai HU asal, outstanding IN-TRANSIT menunjuk HU yang quant-nya sudah tanpa HU → receive gagal reserve | Jejak "isi keluar dari LPN X" hanya terbaca lewat line/reservasi operasi, bukan ledger; trace per batch/serial tidak terdampak |
| I-21 | `operation.is_adhoc` (schema v1.6) menandai transfer ad-hoc | Mesin langkah H1–H4 butuh penanda tahan lama; `source_doc_type` bukan tempatnya | Satu kolom boolean lagi di `operation` |

## 6. Perubahan Kontrak

| Dokumen | Perubahan |
|---|---|
| Schema v1.6 | `stock_reservation.qty_done NUMERIC(18,4) NOT NULL DEFAULT 0` + `CHECK (qty_done >= 0 AND qty_done <= qty)`; `operation.is_adhoc BOOLEAN NOT NULL DEFAULT FALSE`; 3 skenario ddl-validation baru (48/48 PASS) |
| Behavioral 1.2 | D-17..D-22; A-2/A-3 mencatat `qty_done`; A-4c detail |
| Flow-steps 1.2 | T3 = line ber-`qty_done>0` tanpa tujuan (bulk); F-ISR R0 `ENTER_QTY`, R1 stateless (line ber-qty_done tanpa tujuan); B3 memakai HU induk (pallet) |
| API 1.4 | Body `POST /internal/transfers` (dokumen/ad-hoc, `lines[]`), `POST/DELETE /operations/{id}/lines`, close tanpa body, receive `{warehouse_id?}`, QA `lines[]`, `GET /lookup/code`, `GET /internal/quarantine/units` (+ saran bin), detail operasi + `reservations[]`, `dest_warehouse`, `parent_operation` |

## 7. Skala & Keandalan

- **Kunci:** semua mutasi quant tetap satu protokol (A-5). Hot SKU → antrean per produk (diterima, NFR-PERF-6 lintas SKU). Scan dokumen tidak mengambil advisory lock; scan ad-hoc mengambilnya (I-12).
- **Beban data:** pallet 1.000 serial → 1.000 reservasi & line; view per scan memuat semuanya (I-19). Diukur di uji beban M5; mitigasi = view ringkas per HU.
- **In-transit:** outstanding dihitung dari `stock_move` ber-index `operation_id` — O(move dispatch + receive), dipanggil hanya saat membuat receive & listing.
- **Kegagalan:** confirm/instan gagal di langkah mana pun ⇒ rollback penuh (dibuktikan uji); idempotensi di TX bisnis (D-15) melindungi retry.
- **Observabilitas:** invarian D-2/D-2b dijalankan di akhir suite integrasi & smoke; kandidat job nightly (test-delivery §19).

## 8. Pembuktian (gate)

| Lapisan | Isi | Perintah |
|---|---|---|
| Domain | tabel F-TRF/F-ISD/F-ISR/H v1.2 (T3 bulk, R0–R3), `unitIdentity` (D-19), `distributeDone` (D-18), `cartonCount` (D-17) — 77 tes | `pnpm test` |
| Integrasi (PG14 nyata) | **22 skenario M2** (`internal.int.test.ts`): HU karton di receipt; transfer dokumen/ad-hoc; close parsial; cancel presisi; D-19 utuh vs sebagian; AC-03.1–03.5; AC-04.1–04.4 (+ receive parsial & split line); AC-05.4 + release/reject/damaged; UNIT_RESERVED; flag mati 404; CC-3, CC-4, CC-6, CC-10; **D-2 & D-2b** di akhir suite. Suite M0 (14) & M1 (24) tetap hijau | `pnpm test:integration` |
| HTTP end-to-end | **63 cek**: transfer, inter-site 2 gudang, carton break (idempotensi), QA, lookup, reason code, flag 404, halaman ber-guard, D-2. Smoke M0 (31) & M1 (48) tetap hijau | `bash scripts/smoke-m2.sh` (DB segar) |

## 9. Revisit Saat Sistem Tumbuh

1. **Swap unit/batch saat scan** (A-4c) — dibangun M3 bersama FEFO ack; transfer dokumen ikut memakainya.
2. **View ringkas per HU** untuk scan pallet ber-serial besar (NFR-PERF-1) — gabungkan dengan revisit M1 #1.
3. **Hold per batch (recall)** — selector `batch` di QA: semua quant batch di gudang.
4. **Multi-tujuan dalam satu transfer dokumen** — saat ini bulk drop (D-20); tambahkan `planned_to_location` bila perlu.
5. **Laporan in-transit & penyelesaian `TRANSIT_LOSS`** (ADJ_LOSS dari IN-TRANSIT) — M4 bersama Adjustment.
6. **Repack/Consolidate** (SC-1) — kebalikan Carton Break.
7. **Label karton terpisah** (template Carton S/N) bila klien membutuhkan tata letak berbeda dari LPN.

---

## Ringkasan Keputusan (M2)

1. INTERNAL memakai reservasi A-2 saat `start` dengan protokol lock A-5 yang sama dengan outbound; confirm INTERNAL mengonsumsi reservasi (status reservasi dulu, lalu quant) dan memproduksi quant di tujuan dengan status sumber.
2. HU karton terbit saat submit receipt (D-17) sebagai HU terdalam di bawah LPN — prasyarat Carton Break.
3. Progres scan dicatat per reservasi (`qty_done`, schema v1.6, D-18); close/cancel melepas presisi.
4. Identitas unit di tujuan mengikuti aturan HU utuh (D-19); satu line = satu tujuan (D-20).
5. Kepemilikan IN_TRANSIT per dispatch dihitung dari ledger; satu receive aktif per dispatch, hanya di gudang tujuan (D-21).
6. Carton Break & QA = operasi instan ber-`Idempotency-Key`; QA menerima unit ber-kode maupun qty lepas (D-22); flag mati → 404.
7. Tanpa swap unit di M2 (`NOT_RESERVED`); swap & FEFO ack datang di M3.
8. `stock_move.hu_id` = identitas unit di tujuan; rekonsiliasi D-2 per (lokasi, produk, batch, serial, status).
9. Bukti: 22 uji integrasi M2 (+ M0/M1 tetap hijau), smoke HTTP 63 cek, validasi DDL 48/48; gate format, lint, type-check, test, build hijau.
