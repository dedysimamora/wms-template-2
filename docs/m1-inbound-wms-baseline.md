# M1 Inbound — Desain Implementasi · WMS Baseline

**Bagaimana milestone M1 (PO ingest, Receipt, Putaway, LPN, Stock on Hand, handheld receipt/putaway) direalisasikan di kode · pelengkap test-delivery §12**

Versi: 1.0 · 25 September 2026

> Dokumen ini **tidak** mengulang aturan bisnis — sumbernya tetap behavioral §5.1 / A-4b / A-5, flow-steps §7.1, API §5, ERP §4. Isinya: peta komponen yang dibangun, alur data, keputusan implementasi (beserta trade-off), cara membuktikannya, dan apa yang perlu ditinjau ulang saat sistem tumbuh.

---

## 1. Cakupan & Kriteria Selesai

| Item M1 (test-delivery §12) | Status | Bukti |
|---|---|---|
| PO ingest dari ERP (idempoten `erp_ref`, PATCH, cancel) | ✅ | `inbound.int.test.ts` "PO ingest", "PO PATCH / cancel"; smoke M1 |
| Receipt INCOMING: create → ready → start → scan → submit | ✅ | walkthrough flow-steps §9 (int test), smoke M1 |
| Generate & cetak LPN (ZPL, cetak ulang teraudit) | ✅ | int test (label + REPRINT), smoke M1 |
| Putaway: scan LPN / barang lepas → bin STOCK → confirm atomik | ✅ | AC-01.4/01.5/01.6, invarian D-2 |
| Stock on Hand + roll-up multi-UOM | ✅ | int test + smoke ("200 Pcs → 2 Carton") |
| Handheld receipt/putaway (dipandu `next_expected`) | ✅ | halaman `/hh`, `/hh/receipt/[id]`, `/hh/putaway/[id]` |
| `Idempotency-Key` di endpoint | ✅ | CC-9 (int test), replay/mismatch (smoke) |
| AC-01.1 … AC-01.7, CC-7, CC-9 | ✅ | `packages/infrastructure/test/inbound.int.test.ts` |
| Master pendukung: partner, packaging + barcode, lokasi | ✅ | smoke M1 |

Di luar cakupan M1 (tetap tercatat): HU karton & S/N supplier saat receipt (§4 D-14), UI penerbitan API key (M4/M5), fallback kamera ZXing, PWA manifest/service worker, export laporan.

## 2. Arsitektur (yang dibangun)

```
 Handheld /hh (PWA-shell)          Desktop (protected)                     ERP
  OperationFlow ← next_expected     Orders · Receipts · Putaway · Stock      │ X-API-Key
  ScanField(wedge/manual/kamera)    Partners · Locations · Packaging          │
  antrean scan serial + Idem-Key          │                                   │
        └──────────────┬───────────────────┘                                   │
                       ▼  apps/web /api/v1 (adapter tipis: authed → CSRF → zod → use-case)
                       │   http.ts: X-API-Key (allowService), idempotencyScope(hash body), If-Match
                       ▼
  packages/application   use-cases: ingest/patch/cancel PO · createReceipt · transitionOperation
                         (claim/start/submit/confirm/cancel) · scanOperation · printReceiptLabels ·
                         listStock/stockSummary · master · idempotent(uow) · authenticateApiKey
                         operation-view: OperationView → FlowSnapshot → nextExpected() → DTO
  packages/domain        nextExpected (tabel flow-steps) · formatCode/refTypeFor · todayIn/yearIn ·
                         exceedsReceivable/purchaseOrderStatus · effectiveFlags · fromBase/rollUp
  packages/infrastructure Drizzle repos (SQL mentah untuk view/list/stock), ZplLabelRenderer,
                         mapPgError (55P03/40P01 → LOCK_TIMEOUT, 23505 → CONFLICT/DUPLICATE_SERIAL)
                       ▼
  PostgreSQL  operation(+cursor, line) · purchase_order(+line) · handling_unit · serial · batch ·
              quant (UPSERT uq_quant_combo) · stock_move · doc_counter · idempotency_key · integration_event
```

## 3. Alur Data Kritis

**Scan (A-4c, ⟦TX⟧ singkat, tanpa advisory lock):** 🔒 `operation` → RBAC `menu_code` edit → klaim (D-16) → muat `OperationView` → `nextExpected` → validasi `expected_step` ∈ {step, alternatives} (`STEP_CHANGED`) → klasifikasi kode (flow-steps §4) → efek pada `operation_line`/`operation_cursor`/`batch` → `touch` (version++) → `next_expected` baru dari view yang sama.

**Confirm INCOMING (A-4b, ⟦TX⟧ atomik):**
```
🔒 operation → 🔒 purchase_order (header) → 🔒 purchase_order_line (urut id) → validasi OVER_RECEIPT otoritatif
→ 🔒adv(product) urut → per line: UPSERT quant (+= qty_done_base) · stock_move VIRT-SUPPLIER→bin (to_status)
→ HU INTACT + location cache · serial ACTIVE → line DONE, cursor dihapus → qty_received += · status PO
→ integration_event RECEIPT_CONFIRMED (+ ORDER_STATUS_CHANGED) → operation DONE
```
Kegagalan di langkah mana pun ⇒ rollback penuh (AC-01.6 dibuktikan dengan trigger yang memaksa gagal di langkah terakhir).

## 4. Keputusan Implementasi & Trade-off

| # | Keputusan | Alasan | Trade-off / biaya |
|---|---|---|---|
| I-1 | **Kode terbit saat submit** (behavioral D-14): LPN per line; S/N hanya untuk penerimaan dalam UOM base; HU karton ditunda ke M2 | Dokumen tidak menetapkan kapan Carton S/N lahir; menyerialisasi item yang masih di karton berbenturan dengan Carton Break | Carton Break (M2) wajib menambah penerbitan HU karton di receipt; supplier S/N belum bisa ditangkap (flow-steps §11 #10) |
| I-2 | **Idempotensi di transaksi bisnis** (D-15), dibungkus `idempotent(uow, scope)` | Tanpa celah crash antara commit & simpan respons; request paralel otomatis menunggu | Use-case yang dibungkus wajib memanggil `uow.run` tepat sekali; replay mengembalikan isi yang sama tapi urutan kunci JSON bisa beda (JSONB) |
| I-3 | Klaim implisit di `start`/scan pertama (D-16) | Satu round-trip lebih sedikit di handheld | Klaim kedaluwarsa memakai `operation.updated_at` (bukan kolom aktivitas khusus) — update apa pun memperpanjang klaim |
| I-4 | Lock order: header PO sebelum line (A-5 diperjelas) | Confirm vs PATCH/cancel PO tidak boleh saling menunggu | Confirm receipt PO yang sama terserialisasi di header — diterima (volume per PO kecil) |
| I-5 | Generator kode (`doc_counter`) di **dalam** ⟦TX⟧ submit/create | Sederhana; nomor tak berlubang bila commit | Baris counter `LPN`/`SN` terkunci sampai commit → submit lintas gudang terserialisasi singkat. Pindahkan ke TX terpisah bila jadi hotspot (A-7 mengizinkan) |
| I-6 | `OperationView` dimuat penuh per scan (header, line, unit, cursor, PO) | Satu sumber untuk DTO & snapshot `nextExpected`; konsisten dengan state ter-commit | Receipt ber-serial besar (ribuan line) memperlambat scan → revisit (§6) |
| I-7 | Resolusi kode termasuk HU/serial VOID; lokasi gudang lain → `INVALID_BIN` | AC-01.2 "termasuk VOID"; pesan lebih berguna daripada `UNKNOWN_CODE` | Satu query UNION per scan |
| I-8 | Label dirender server (ZPL + escape `^FH`), dikirim klien ke print service atau diunduh `.zpl` | labeling §3: browser tak bisa TCP 9100 | Tanpa print service, operator handheld mengunduh file — cetak dari desktop |
| I-9 | X-API-Key hanya untuk endpoint order (`allowService`) | Service account tak boleh menyentuh endpoint UI (403 `SERVICE_ACCOUNT_UI`) | Penerbitan key masih lewat SQL sampai UI admin (M4/M5) |
| I-10 | UI: blok design system baru (`DataTable`, `UomQuantity`, `ScanField`, `ScanFeedback`, `QtyStepper`, `HoldToConfirm`, `StepProgress`) | frontend §4.4; dipakai ulang M2/M3 | Kamera hanya `BarcodeDetector` (Android Chrome); iOS butuh ZXing |

## 5. Pembuktian (gate)

| Lapisan | Isi | Perintah |
|---|---|---|
| Domain | kode/tanggal/over-receipt/flag/roll-up + tabel F-RCV revisi | `pnpm test` |
| Integrasi (PG14 nyata) | 24 skenario M1: walkthrough, AC-01.1–01.7, CC-7, CC-9, klaim, aturan scan, PATCH/cancel PO, stock, **invarian D-2 di akhir suite** | `pnpm test:integration` |
| HTTP end-to-end | 48 cek: ERP via API key, receipt→putaway→confirm, idempotensi, halaman ber-guard, D-2 | `bash scripts/smoke-m1.sh` (DB segar) |

## 6. Revisit Saat Sistem Tumbuh

1. **Scan p95 ≤ 300 ms (NFR-PERF-1)** pada receipt ber-serial besar: muat view ringkas (agregat per HU) alih-alih semua line; ukur dengan uji beban.
2. **Counter kode di TX terpisah** bila `doc_counter` LPN/SN menjadi hotspot (I-5).
3. **Penangkapan kode supplier** (S/N / karton / GS1 SSCC) — step baru fase A + tes tabel.
4. **HU karton di receipt** — prasyarat Carton Break (M2).
5. **Putaway parsial** satu line ke beberapa bin & saran lokasi putaway (fase 2).
6. **Kolom aktivitas klaim** terpisah dari `updated_at` bila supervisor sering mengedit operasi yang sedang dikerjakan.
7. **ZXing fallback + manifest/service worker PWA** untuk perangkat iOS & instalasi.
8. **UI penerbitan/pencabutan API key** & monitor outbox (M4/M5); gateway ERP worker (M5).

---

## Ringkasan Keputusan (M1)

1. Receipt + putaway = satu operasi INCOMING; stok berubah hanya di confirm atomik dengan urutan lock operation → header PO → line PO → advisory produk → quant.
2. Kode terbit saat submit: LPN per line, S/N hanya untuk penerimaan UOM base; HU karton & kode supplier ditunda (D-14).
3. `Idempotency-Key` dicatat di transaksi bisnis yang sama (D-15); scan menolak request tanpa key.
4. Klaim implisit di start/scan; B2 dievaluasi sebelum B1 agar "Lewati cetak" tidak mengunci alur.
5. ERP masuk via X-API-Key (service account) hanya di endpoint order; outbox `RECEIPT_CONFIRMED` ditulis dalam TX confirm.
6. Bukti: 24 uji integrasi (termasuk CC-7/CC-9 & D-2) + smoke HTTP 48 cek; semua gate CI (format, lint, type-check, test, build) hijau.
