# Behavioral Specification — WMS Baseline

**Spesifikasi perilaku (sequence, edge case, algoritma) · pelengkap Spesifikasi Sistem v1.3 & Requirements v1.1 · Schema v1.4**

Versi: 1.5 · 13 Oktober 2026 · Pembaruan 1.5 (implementasi M5, `m5-integration-hardening-wms-baseline.md`): D-39 kontrak kawat callback ERP + urutan per order, D-40 ERP tak melayani menghentikan putaran kirim, D-41 rekonsiliasi & cek integritas harian (rincian di erp-integration v1.2). Pembaruan 1.4 (implementasi M4, `m4-visibility-admin-wms-baseline.md`): D-32 adjustment satu sasaran ber-kode + delta/hitungan fisik + batas error, D-33 transit loss terikat dispatch, D-34 audit feed = `audit_log` ∪ peristiwa operasi, D-35 pengaman administrasi (hak hanya untuk user ACTIVE, administrator terakhir), D-36 katalog setting bertipe, D-37 operation type turunan dari template, D-38 satu mesin trace + dashboard; §5.4 & §5.8 ditulis ulang; §6.5 `NO_CHANGE`; CC-13. Pembaruan 1.3 (implementasi M3, `m3-outbound-wms-baseline.md`): D-23 unit kerja picking = reservasi, D-24 definisi deviasi FEFO, D-25 swap (hanya OUT_DELIVERY), D-26 aturan kedaluwarsa per tujuan, D-27 pick list = stok tersedia, D-28 status SO fungsi murni, D-29 serah-terima tahap delivery, D-30 identitas unit keluar, D-31 approval gugur saat reopen; A-2/A-3/A-4a/A-4c diperjelas; CC-12. Pembaruan 1.2 (implementasi M2, `m2-internal-wms-baseline.md`): D-17 HU karton saat submit, D-18 progres per reservasi (`qty_done`, schema v1.6), D-19 identitas unit di tujuan (aturan HU utuh; `stock_move.hu_id` = identitas di tujuan), D-20 tujuan per line, D-21 kepemilikan IN-TRANSIT dari ledger, D-22 selector QA; A-2/A-3/A-4c diperjelas. Pembaruan 1.1.2 (implementasi M1): D-14 aturan terbit kode saat submit, D-15 idempotensi di transaksi bisnis, D-16 klaim implisit, A-5 tingkat order = header lalu line. Pembaruan 1.1.1 (hasil validasi DDL di PostgreSQL 14, `ddl-validation-wms-baseline.sql`): urutan tulis reservasi→quant di A-3/A-4, ledger tak pernah mencatat status RESERVED, invarian D-2 diperjelas (+D-2b). Pembaruan 1.1: koreksi audit desain — protokol lock tunggal, reservasi per line, lifecycle per direction (submit INCOMING, satu confirm OUTGOING), semua perubahan stok lewat operasi (adjustment/QA/carton break), status di ledger, idempotensi scan, FEFO ack, zona waktu, anti self-approval.

---

## Cara memakai dokumen ini

Dokumen ini menerjemahkan alur naratif (Spesifikasi §10) dan use case (Requirements §6) menjadi **langkah presisi yang siap dikodekan**: siapa memanggil apa, baris mana yang di-lock, kapan ledger ditulis, dan apa yang terjadi di tiap cabang error. Tujuannya: saat coding, tidak ada lagi keputusan perilaku yang tersisa.

Notasi:
- **Partisipan:** `OP` (operator/handheld), `API` (REST layer), `SVC` (domain/service), `DB` (PostgreSQL).
- **`⟦TX⟧`** = batas satu transaksi DB (ACID). **`🔒row`** = `SELECT … FOR UPDATE` pada baris itu. **`🔒adv(p)`** = `pg_advisory_xact_lock` per produk.
- **base** = base UOM. Error ditulis `HTTP code/reason` (mis. `422 BUSINESS_RULE/FEFO_VIOLATION`) — `code` = kategori baku API §1.2, `reason` = subkode (katalog API §1.2.1).

---

## Daftar Isi

1. [Prinsip Perilaku Bersama](#1-prinsip-perilaku-bersama)
2. [Keputusan Mikro (dibuat di dokumen ini)](#2-keputusan-mikro-dibuat-di-dokumen-ini)
3. [Mesin Transisi Generik](#3-mesin-transisi-generik)
4. [Algoritma Inti](#4-algoritma-inti)
5. [Sequence per Operation Type](#5-sequence-per-operation-type)
6. [Katalog Edge Case & Error](#6-katalog-edge-case--error)
7. [Skenario Uji Konkurensi](#7-skenario-uji-konkurensi)

---

## 1. Prinsip Perilaku Bersama

Berlaku untuk **semua** operation type (mengikat, konsisten dengan BR di Requirements §7):

- **P-1 — Stok berubah hanya saat Done.** `ready`/`start`/scan tidak menyentuh on-hand (kecuali `start` yang mereservasi = flip status, bukan mengubah total). Hanya `confirm` menulis `stock_move`. **Tidak ada jalur lain**: adjustment, carton break, dan QA juga `operation` (boleh "instan" = create+confirm dalam satu ⟦TX⟧, D-7).
- **P-2 — Confirm atomik & ber-lock.** Semua efek confirm dalam satu `⟦TX⟧`; gagal sebagian ⇒ rollback penuh.
- **P-3 — Satu protokol lock (A-5).** Urutan global: `operation` → order line (`sales_order_line`/`purchase_order_line`, urut `id`) → advisory lock per produk (urut `product_id`) → baris `quant` (`FOR UPDATE OF q`). Semua transaksi mengikuti urutan sama; tidak ada alternatif lain.
- **P-4 — RBAC & flag dicek di awal tiap request** (sebelum kerja apa pun). Untuk endpoint generik `/operations/{id}/*`, menu yang dicek = milik **operation type** operasi itu (API §1.4), bukan route request. `403 FORBIDDEN` bila ditolak; `404 NOT_FOUND` bila fitur mati.
- **P-5 — Validasi berlapis.** Validasi murah dulu (format, keberadaan entitas), lalu aturan domain, lalu lock & tulis. Tolak secepat mungkin.
- **P-6 — Idempotensi.** Transisi pada status yang sudah lewat ⇒ `409 INVALID_TRANSITION` tanpa efek. Request dengan `Idempotency-Key` yang sudah diproses ⇒ respons tersimpan dikembalikan (tabel `idempotency_key`); wajib untuk scan & transisi dari handheld.
- **P-7 — Waktu.** DB/API menyimpan UTC. Semua konsep "hari ini" (expiry, shelf-life, reset `ref_no` tahunan, tugas hari ini) dievaluasi pada `warehouse.timezone` operasi.

---

## 2. Keputusan Mikro (dibuat di dokumen ini)

Keputusan kecil yang diperlukan agar perilaku tak ambigu. **Silakan koreksi bila tak sesuai maksud Anda.**

| ID | Keputusan | Alasan |
|---|---|---|
| **D-1** | **Quant TIDAK disimpan di lokasi endpoint virtual** (`VIRTUAL_SUPPLIER/CUSTOMER`, `PRODUCTION`, `SCRAP`, `VIRTUAL_TRANSFORM`, `INVENTORY_ADJUST`). Quant **disimpan** di lokasi fisik (STOCK/STAGING/DOCK/QUARANTINE) **dan** di `IN_TRANSIT`. | On-hand = stok yang bisa ditindak. Endpoint virtual = sink/source tak terbatas. Ledger tetap merekam ke/dari mereka untuk balance & audit. |
| **D-2** | **Invarian on-hand:** untuk tiap lokasi *non-endpoint*, produk, batch, dan status non-RESERVED: `Σ quant.qty (status itu) + Σ reservasi ACTIVE (source_status itu) = Σ move.to (to_status) − Σ move.from (from_status)`. **D-2b:** untuk tiap quant RESERVED, `qty = Σ stock_reservation.qty` ACTIVE yang menunjuknya. **RESERVED tidak pernah muncul di ledger** (reservasi bukan peristiwa stok, P-1) — konsumsi dicatat dengan `from_status = source_status`. | Quant dapat direkonsiliasi penuh terhadap ledger (uji integritas nightly; query acuan di `ddl-validation-wms-baseline.sql`). |
| **D-3** | **Staging & dock = logis, bukan hop ledger** di fase 1. Picking & delivery = **satu operasi `OUT_DELIVERY` dengan satu `confirm`**. Scan staging/dock hanya menandai progres. `confirm` menulis `bin → VIRTUAL_CUSTOMER`. | Menghormati P-1 & menyederhanakan. Staging ber-quant = fase 2. |
| **D-4** | **Reserve = flip in-place.** Reserved quant lahir di **lokasi & atribut sama** dengan sumbernya (hanya `status` → RESERVED). Baris RESERVED adalah *pool* per atribut yang bisa dipakai bersama beberapa operasi; kepemilikan per line ada di `stock_reservation`. | Reservasi adalah penguncian, bukan perpindahan. |
| **D-5** | **Putaway & Receipt = satu `operation` INCOMING.** Scan unit, submit (generate HU/LPN), scan LPN→bin, confirm — semuanya saat IN_PROGRESS. | Lifecycle tunggal & seragam dengan direction lain. |
| **D-6** | **Generate serial/HU terjadi saat `submit`** (sebelum putaway) dengan status `PENDING`, agar label bisa dicetak. Quant baru hanya lahir saat confirm (HU→`INTACT`, serial→`ACTIVE`). Operasi di-cancel ⇒ HU/serial → `VOID` (kode tetap terpakai, tidak diterbitkan ulang). | Label perlu kode sebelum barang masuk rak; stok tetap taat P-1. |
| **D-7** | **Semua perubahan stok = operation.** Adjustment (`ADJ_GAIN`/`ADJ_LOSS`), carton break (`INT_CARTON_BREAK`), QA (`INT_QA_HOLD/RELEASE/REJECT`), mark damaged (`INT_MARK_DAMAGED`) boleh dieksekusi sebagai **operasi instan**: create → (validasi) → confirm dalam satu ⟦TX⟧, status langsung DONE, tetap punya `ref_no`. | Invarian #3 & `stock_move.operation_id NOT NULL`; audit seragam. |
| **D-8** | **Perubahan status quant tercatat di ledger** via `stock_move.from_status/to_status`. Perubahan status di bin yang sama = baris sah (`from_location = to_location`, status beda). | Riwayat QA/damaged teraudit (GDP farmasi). |
| **D-9** | **Quarantine = status, bukan lokasi.** Hold boleh in-place atau pindah ke bin tipe `QUARANTINE`; `qa_on_receipt` menaruh barang berstatus QUARANTINE di bin putaway (STOCK). | Satu model; tidak memaksa bin QA per warehouse. |
| **D-10** | **FEFO `warn` butuh acknowledgement.** Scan batch non-saran ⇒ `422 BUSINESS_RULE/FEFO_ACK_REQUIRED` sampai klien mengirim ulang dengan `fefo_override_reason` (reason_code `FEFO_OVERRIDE`); lalu 200 + dicatat di `operation_line.fefo_override_*`. `block` ⇒ selalu `FEFO_VIOLATION`. | Pelanggaran FEFO selalu punya jejak siapa & kenapa. |
| **D-11** | **Anti self-approval di fase 1.** Approver ≠ pembuat (`CHECK` DB + `403 FORBIDDEN/SELF_APPROVAL`), dan approve dicek pada `operation_type.approve_menu_code` (menu *Scrap Approval*), bukan `can_edit` menu scrap. | Segregation of duties tanpa tabel permission fase 2. |
| **D-12** | **Edit line hanya saat DRAFT.** READY → `reopen` dulu. Saat IN_PROGRESS, line hanya berubah lewat endpoint scan (INCOMING/INTERNAL membuat line dari scan) atau `close` line (partial). Hapus line ber-reservasi ditolak. | Mencegah reservasi yatim (stok RESERVED tanpa pemilik). |
| **D-14** | **Kode yang terbit saat `submit` (M1).** Per line: **LPN pallet** satu per line bila flag efektif `lpn` (`enable_lpn ∧ product.use_lpn`). **Pack S/N** hanya untuk line yang diterima dalam **UOM base** (`qty_in_base = 1`) dengan flag efektif `serial` (`enable_serial ∧ use_serial ∧ track_level=ITEM`); line dipecah menjadi N line qty 1 ber-serial di bawah LPN line asal (qty wajib bulat → `FRACTIONAL_CONTENT`). Barang yang diterima **dalam karton** tidak diserialisasi di receipt — item-nya mendapat S/N saat Carton Break. HU karton (Carton S/N) saat receipt **belum** diterbitkan → dikerjakan bersama Carton Break (M2). Line fase A digabung per (produk, batch, UOM, baris PO). | Selaras D-6 & §5.5; menghindari serialisasi item yang masih tersegel di karton. |
| **D-15** | **Idempotensi dicatat di transaksi bisnis yang sama.** Baris `idempotency_key` di-INSERT di awal ⟦TX⟧ use-case (sebelum 🔒operation) dan respons disimpan sebelum COMMIT. Request paralel ber-key sama menunggu commit pertama (unique index) lalu mendapat respons tersimpan (CC-9); bila use-case gagal, baris key ikut ROLLBACK sehingga retry dengan key sama dieksekusi ulang (aman: tanpa efek). Tidak ada celah "sudah commit tapi respons belum tersimpan". Replay membandingkan isi (JSONB menormalkan urutan kunci). | Retry handheld aman tanpa status `IN_PROGRESS` yatim. |
| **D-16** | **Klaim implisit.** `start` INCOMING dan scan pertama meng-claim operasi yang belum di-claim (atau klaimnya kedaluwarsa — aktivitas = `operation.updated_at`); klaim user lain yang masih aktif → `409 CLAIMED_BY_OTHER`. `unclaim` milik orang lain butuh hak `delete` pada `menu_code`. | Mengurangi satu round-trip handheld; tetap mencegah dua operator pada satu tugas. |
| **D-17** | **HU karton terbit saat `submit` INCOMING (menutup D-14).** Bila `enable_serial ∧ product.use_serial` (Carton S/N: `track_level` ITEM maupun CARTON) dan UOM line bukan base (`qty_in_base > 1`): satu HU `CARTON` per unit UOM transaksi (qty transaksi bulat → else `FRACTIONAL_CONTENT`), kode dari sekuens `SN`/`serial_code_format`, `parent_hu_id` = LPN line asal. Line dipecah jadi N line (qty 1 UOM itu, `qty_base = qty_in_base`, `hu_id` = karton). Quant menunjuk HU **terdalam**; scan LPN (putaway/transfer) mencakup karton anaknya; label karton dicetak bersama LPN. | Carton Break butuh HU CARTON INTACT; satu quant = satu karton sehingga N = qty quant (AC-03.3). |
| **D-18** | **Progres scan per reservasi.** `stock_reservation.qty_done` (0 ≤ qty_done ≤ qty, schema v1.6). Scan LPN/karton/serial menandai reservasi spesifik; qty lepas (`ENTER_QTY`) dibagi ke reservasi line urut FEFO (expiry, lalu id). `operation_line.qty_done_base = Σ qty_done` reservasi ACTIVE-nya; line otomatis `DONE` bila = `qty_base`. Close line & cancel melepas `qty − qty_done` (A-3); confirm mengonsumsi reservasi. | Line ber-banyak quant (serial, beberapa batch) dapat ditutup parsial secara presisi; dipakai ulang picking M3. |
| **D-19** | **Identitas unit di tujuan (aturan HU utuh).** HU pindah **utuh** bila seluruh quant-nya (pallet: termasuk quant karton anak) dikonsumsi operasi ini ke **satu** tujuan → quant tujuan mempertahankan `hu_id`, cache `handling_unit.location_id` = tujuan, nesting dipertahankan. Tidak utuh → quant tujuan `hu_id = NULL`; karton yang dirinya utuh tetap ber-`hu_id` karton dengan `parent_hu_id := NULL`. HU tanpa isi → `EMPTY`. `stock_move.hu_id` = identitas unit **di tujuan** (bukan HU asal); rekonsiliasi D-2 tidak ber-kunci HU. Berlaku untuk transfer, dispatch, receive, QA berpindah bin. | HU tak boleh "berada di dua bin"; ledger konsisten dengan identitas quant tujuan (dasar D-21). |
| **D-20** | **Tujuan per line.** Tipe bin tujuan INTERNAL: `STOCK`/`QUARANTINE`, `is_usable`, gudang operasi, ≠ sumber bila status sama (`SAME_LOCATION`). F-TRF dokumen & ad-hoc: satu scan DEST berlaku untuk semua line ber-`qty_done > 0` yang belum bertujuan (bulk). F-ISR: per unit. Line bertujuan yang menerima qty tambahan **dipecah** (line baru + reservasi dipindah) — satu line = satu tujuan. | Confirm & ledger sederhana; receive truk butuh tujuan per pallet. |
| **D-21** | **Kepemilikan IN-TRANSIT per dispatch dari ledger.** Outstanding = Σ `stock_move` ke `IN-TRANSIT` oleh dispatch − Σ `stock_move` dari `IN-TRANSIT` oleh receive anak DONE, per (produk, batch, HU, serial). Receive: dispatch DONE (`409 INVALID_TRANSITION`); gudang (body/default user) = `dest_warehouse_id` (`409 WRONG_WAREHOUSE`); 🔒 dispatch, satu receive aktif (`422 ORDER_IN_EXECUTION`); tanpa outstanding → `422 NO_LINES`. Receive lahir READY; reservasi dari IN-TRANSIT dengan atribut persis. | Quant lepas dua dispatch menyatu di IN-TRANSIT (lokasi global); ledger immutable satu-satunya jejak kepemilikan. |
| **D-22** | **Selector QA.** Body `units[]` (kode HU/serial; seluruh isi HU) dan/atau `lines[]` (`{location_code, sku, qty, uom?, batch_no?}`, FEFO, quant tanpa S/N). Quant `RESERVED` → `409 UNIT_RESERVED`; status sumber ∉ `allowed_from_status` / qty kurang → `422 INSUFFICIENT_STOCK`. Tujuan: hold opsional, release wajib (saran = asal move hold terakhir), reject & mark-damaged in-place (tujuan → `400`). | Barang lepas & sebagian karton bisa di-QA; identitas unit ikut D-19. |
| **D-23** | **Unit kerja picking = reservasi, bukan line (M3).** Line `OUT_DELIVERY` (satu per baris SO) tidak menyimpan lokasi/batch/HU — ketiganya ada di reservasi. *Urutan saran* dalam satu line: expiry naik (bila FEFO efektif) → kode lokasi → kode unit → id. *Bin aktif* line = lokasi reservasi pending pertamanya; *urutan jalan* antar-line = kode bin aktif lalu id line. `cursor.line_id` dikosongkan saat reservasi pending line di bin cursor habis. Line scrap/issue tetap ber-`from_location`. | Satu baris SO bisa dipenuhi dari beberapa bin; FEFO di dalam line didahulukan dari rute sehingga close parsial selalu menyisakan batch ber-expiry terjauh. |
| **D-24** | **Definisi deviasi FEFO (hanya F-OUT, flag FEFO efektif).** Acuan = expiry terawal di antara reservasi pending line. Scan/swap batch Y menyimpang bila `expiry(Y) > acuan` (tanpa expiry = paling jauh); untuk qty lepas, Y = expiry terjauh di antara reservasi yang ditandai. Berlaku juga untuk unit yang direservasi. `block` → `422 FEFO_VIOLATION`; `warn` → `422 FEFO_ACK_REQUIRED` sampai scan yang sama dikirim ulang dengan `fefo_override_reason` (reason aktif ber-`applies_to = FEFO_OVERRIDE`, selain itu `400`). Tiap scan menyimpang membawa reason sendiri; dicatat di `operation_line.fefo_override_*` (kejadian terakhir) + `audit_log` `FEFO_OVERRIDE` (tiap kejadian); respons membawa warning `FEFO_OVERRIDDEN`. | Menutup celah "ambil batch muda lalu close parsial"; saran server sendiri tak pernah memicu ack karena urutan saran sudah FEFO (D-23). |
| **D-25** | **Swap (hanya F-OUT).** Unit/qty di luar reservasi operasi diterima bila: produk = produk line PENDING (line cursor/aktif dulu); quant berada di bin cursor, berstatus ∈ `allowed_from_status`, tidak dipegang operasi lain; unit ber-kode muat **utuh** di sisa pending line; lolos D-26 lalu D-24. Efek atomik dalam ⟦TX⟧ scan dengan A-5 penuh: 🔒adv(produk) → `FOR UPDATE` quant → reservasi unit baru (`qty_done = qty`) → lepas reservasi pending line **menurut urutan saran** sebesar qty unit (A-3). `sales_order_line.qty_reserved` tidak berubah. Gagal syarat → `409 NOT_RESERVED` dengan `details.cause` ∈ `OTHER_OPERATION`, `EXCEEDS_REMAINING`, `PRODUCT_MISMATCH`, `STATUS`, `EMPTY`. F-SCR dan INTERNAL tidak mengenal swap. | Saran bersifat non-mengikat (API §7.2); "ambil pallet sebelah" adalah kejadian harian. Melepas saran yang sedang diminta = maksud operator. |
| **D-26** | **Aturan kedaluwarsa mengikuti tujuan** (`default_dest.type`), bila flag expiry efektif: `VIRTUAL_CUSTOMER` → tolak expired **dan** sisa umur < minimum partner (A-6d); `PRODUCTION` → tolak expired saja; lainnya (`SCRAP`) → tanpa cek. Diterapkan di reserve (kandidat dilewati; `INSUFFICIENT_STOCK.details.excluded_by_expiry`), scan/swap (`422 EXPIRED` / `SHELF_LIFE`), dan confirm (cek ulang expired saja). | Scrap justru jalur keluar barang kedaluwarsa (reason `EXPIRED` di seed); operasi yang melewati tengah malam tak boleh mengirim batch yang baru kedaluwarsa. |
| **D-27** | **Pick list = yang bisa diambil sekarang.** `generate-picklist {warehouse_id?}` membuat satu operasi untuk satu SO di satu gudang. Qty line = `min(sisa, tersedia)`: sisa = `qty − qty_reserved − qty_delivered −` qty pick list READY milik baris itu; tersedia = stok lolos D-26 `−` qty pick list READY milik SO ini untuk produk itu. Baris tanpa stok → `skipped[]`. Lahir READY, tanpa reservasi, tidak diedit (`reopen` → `409 INVALID_TRANSITION`). `start` tetap semua-atau-gagal (A-2, CC-1). Lintas SO tidak ada alokasi saat generate (OQ-11 first-start). | Backorder (FR-OUT-10) berjalan tanpa edit manual; generate ganda tak menghasilkan tugas yang pasti gagal. |
| **D-28** | **Status SO = fungsi murni** baris-barisnya, dihitung ulang setelah reserve, release, consume, PATCH: `CANCELLED` (lekat) → semua `qty_delivered ≥ qty` ⇒ `DONE` → `Σ qty_delivered > 0` ⇒ `PARTIAL` → `Σ qty_reserved > 0` ⇒ `PROCESSING` → `RECEIVED`. `ORDER_STATUS_CHANGED` hanya untuk `PARTIAL`, `DONE`, `CANCELLED`. | Pick list yang dibatalkan mengembalikan SO ke `RECEIVED`; satu sumber kebenaran untuk empat jalur tulis. |
| **D-29** | **Serah-terima tahap delivery.** *Tahap delivery* = `OUT_DELIVERY` IN_PROGRESS, semua line DONE, ada qty terpick, staging sudah discan (atau gudang tanpa lokasi STAGING). Pada tahap ini aktor ber-hak edit `confirm_menu_code` boleh scan dock dan confirm tanpa menunggu klaim kedaluwarsa — klaim berpindah kepadanya; scan `SCAN_DOCK` menerima hak edit `menu_code` **atau** `confirm_menu_code`; G-4 dikecualikan untuknya; operasi muncul di antrean Deliveries dan `my-tasks` miliknya. | Picker dan petugas delivery biasanya orang berbeda; tanpa ini delivery tertahan TTL klaim. |
| **D-30** | **Identitas unit keluar (perluasan D-19 ke OUTGOING).** HU keluar **utuh** bila seluruh isinya (pallet: termasuk karton anak) dikonsumsi operasi ini → `stock_move.hu_id` = HU itu, status `SHIPPED` (tujuan `VIRTUAL_CUSTOMER`) atau `EMPTY` (scrap/issue), cache `location_id = NULL`. Tidak utuh → `stock_move.hu_id = NULL`; karton yang dirinya utuh tetap tercatat dengan `parent_hu_id := NULL`. HU yang kehabisan isi karena diambil sebagian-sebagian → `EMPTY`. Serial selalu `CONSUMED`. | Satu aturan identitas untuk semua direction; trace "pallet X dikirim ke siapa" terbaca dari ledger. |
| **D-31** | **Approval melekat pada isi yang disetujui.** `reopen` mengosongkan `approved_by/approved_at`. Approve sah di READY atau IN_PROGRESS; confirm tanpa approval → `422 NEEDS_APPROVAL`. Reason operasi wajib ber-`applies_to` sesuai tujuan: `SCRAP` → `SCRAP`, `PRODUCTION` → `ISSUE` (selain itu `422 MISSING_REASON`). Scrap/issue hanya mode dokumen (line bentuk I-14). | Segregation of duties (D-11) tak berarti bila isi bisa diubah setelah disetujui. |
| **D-32** | **Adjustment = satu sasaran per request, dipilih lewat kode.** Sasaran: `unit_code` (serial, atau HU = quant milik HU itu sendiri) **atau** `location_code` + `sku` (+ `batch_no` bila batch efektif → `MISSING_BATCH`). Nilai: `delta` bertanda **atau** `counted_qty`. *On-hand sasaran* per status = quant berstatus itu + reservasi ACTIVE ber-`source_status` itu; `counted_qty` → `delta = counted − on_hand`, dihitung di bawah lock; selisih 0 → `422 NO_CHANGE`. Loss hanya mengambil bagian bebas: `|delta| ≤ free` sukses; `free < |delta| ≤ on_hand` → `409 UNIT_RESERVED`; `> on_hand` → `422 NEGATIVE_STOCK`. Gain: bin simpan usable gudang (`INVALID_BIN`), status = `status` (default AVAILABLE). Identitas unit: gain ke HU → `stock_move.hu_id` = HU (D-19); loss mengikuti D-30 (HU habis utuh → `hu_id` = HU, `EMPTY`, karton lepas dari pallet; sebagian → `NULL`); serial selalu qty 1 (loss → `CONSUMED`; gain hanya untuk S/N tanpa stok → `ACTIVE`, selain itu `DUPLICATE_SERIAL`). Reason wajib ber-`applies_to = ADJUST`; produk `track_level=ITEM` → qty bulat (`FRACTIONAL_CONTENT`). Outbox `ADJUSTMENT_POSTED` ditulis di ⟦TX⟧ yang sama. | Selector kode sama dengan transfer dokumen (M2 I-14) sehingga handheld cukup scan; hitungan fisik menghilangkan salah hitung selisih dan lock menutup celah baca-lalu-tulis; batas error memberi tahu apakah stok kurang atau hanya tertahan operasi lain. |
| **D-33** | **Transit loss terikat dispatch.** `dispatch_id` pada request adjustment memaksa lokasi `IN-TRANSIT`, hanya loss, qty ≤ sisa baris dispatch (D-21); tanpa sasaran = hapus seluruh sisa. Operasi `ADJ_LOSS` menyimpan `parent_operation_id = dispatch` (gudang = gudang tujuan dispatch) sehingga rumus D-21 menurunkan sisa secara otomatis; `stock_move.hu_id` = HU baris sisa walau sebagian (kunci rumus D-21). Bagian yang direservasi receive aktif → `409 UNIT_RESERVED`. Adjustment biasa menolak unit di lokasi sistem (`INVALID_BIN`). | IN-TRANSIT global dan quant lepasnya bercampur antar-dispatch; tanpa tautan, sisa "hantu" tetap bisa di-receive lalu gagal reserve selamanya. |
| **D-34** | **Audit feed = `audit_log` ∪ peristiwa operasi**, bukan baris ledger. Peristiwa operasi diturunkan saat baca: `CREATE` (`created_by/at`), `APPROVE`, `CANCEL`, `CONFIRM` (`confirmed_at`, pelaku = `stock_move.user_id`, ringkasan jumlah baris & qty). Kunci keyset `(at, key)`, `key = sumber:id[:aksi]`. Rincian per unit = Movement report. | Menjawab "siapa, apa, kapan" tanpa membanjiri audit dengan ribuan baris serial. |
| **D-35** | **Pengaman administrasi.** (a) Hak akses hanya dihitung untuk user `ACTIVE` — lock/deactivate berlaku pada request berikutnya dan mencabut semua refresh token. (b) *Administrator terakhir*: perubahan (status user, role user, matriks, hapus role) yang menyisakan nol user manusia ACTIVE ber-hak view+edit `admin_users` **dan** `admin_access` → `409 LAST_ADMIN`. (c) Lock/deactivate diri sendiri → `409 SELF_ACTION`. (d) Reset password: admin mengisi password sementara, `must_change_password = true`, semua sesi dicabut. (e) Service account dibuat lewat `POST /admin/users {is_service}`; API key hanya untuk service account ACTIVE, nilai mentah ditampilkan sekali, disimpan SHA-256. (f) `role.code` tak berubah setelah dibuat. | Merealisasikan auth-session §3–4 dan mencegah instalasi terkunci dari UI. |
| **D-36** | **Validasi setting = katalog bertipe** (configuration §1): boolean, enum, integer berentang, URL kosong/http(s), pola kode (`ref_no_format` wajib `{TYPE}`,`{YYYY}`,`{seq}`; `lpn/serial_code_format` wajib `{seq}` dan tak boleh identik). Mematikan flag yang datanya masih ada → `409 LOCKED_AFTER_STOCK` (`enable_batch`, `enable_serial`, `enable_lpn`, `enable_quarantine`, `enable_multi_site`). Dependensi `qa_on_receipt` ↔ `enable_quarantine` → `422 SETTING_DEPENDENCY`. Key di luar katalog → `404`. | Satu sumber aturan untuk API, UI, dan tes; pola tanpa `{seq}`/`{YYYY}` menghasilkan kode duplikat (counter di-scope per tahun). |
| **D-37** | **Operation type turunan = salinan tipe baseline yang jalurnya menerima `operation_type_code`**: keluarga receipt (`menu_code = inbound_receipts`) dan scrap/issue (`outbound_scrap`). Direction, lokasi default, status, dan menu disalin dari `template_code`. Yang bisa diubah: `name`, `require_reason`, `is_active`; `require_approval` hanya keluarga scrap/issue; `allowed_from_status` hanya sebelum dipakai. 15 tipe baseline tak bisa dihapus (hanya dinonaktifkan); turunan: terpakai → nonaktif, belum → hapus. | Tipe lain terikat kode di use-case (pick list, transfer, QA, carton break, adjustment); turunannya tak bisa dieksekusi tanpa "tipe induk" di schema. |
| **D-38** | **(a) Satu mesin trace** untuk lookup (`inventory_trace`) dan report (`reports_traceability`): deteksi serial → HU → `batch_no` (cocok > 1 produk → `matches[]`); isi = genealogi (serial → karton asal → pallet), posisi kini (quant), asal & tujuan (move dari/ke endpoint + PO/SO/partner), jejak ledger kronologis (maks 200 di layar; lengkap lewat export). **(b) Dashboard** = hitungan operasional gudang default user tanpa tabel agregat. | Satu jawaban untuk satu pertanyaan (NFR-CMP-3). |
| **D-39** | **Callback ERP dikirim di luar ⟦TX⟧ stok** (P-2) oleh worker, satu ⟦TX⟧ per event: klaim kepala antrean `(ref_table, ref_id)` yang jatuh tempo dengan `FOR UPDATE SKIP LOCKED` → `POST` bertanda tangan HMAC (`X-Event-Id`, `X-WMS-Signature` atas `<timestamp>.<body>`) → hanya 2xx = `SENT`; selainnya `FAILED` + backoff 30 dtk × 2^(n−1) (maks 1 jam), percobaan ke-`OUTBOX_MAX_ATTEMPTS` → `DEAD`. Event berikutnya pada ref yang sama ditahan sampai pendahulunya `SENT`/`DEAD`; waktu tulis event = `clock_timestamp()` agar event se-⟦TX⟧ berurutan (erp-integration §3, §6.1). | Kontrak kawat yang bisa diverifikasi ERP; at-least-once tanpa status perantara; urutan status per order. |
| **D-40** | **ERP tak melayani menghentikan putaran kirim**: galat jaringan, timeout, `429/502/503/504` menghitung satu percobaan untuk event itu lalu putaran berhenti sampai tick berikutnya. | Gangguan ERP tak menghabiskan percobaan seluruh antrean (DEAD massal) dan tak menyandera worker dengan timeout berantai. |
| **D-41** | **Rekonsiliasi & kesehatan data.** `GET /admin/reconciliation` (hak `admin_integration`) = order terbuka lewat jatuh tempo (`OVERDUE_RECEIPT`/`OVERDUE_DELIVERY`, "hari ini" pada zona waktu gudang pemohon — P-7) + callback `DEAD`/`FAILED`/`PENDING` > 15 menit. Worker tiap hari menjalankan ringkasannya dan invarian D-2/D-2b (`checkIntegrity`) lalu menulis log ber-`alert`; tak ada yang ditulis ke DB. | Menjawab "apa yang ERP harapkan tetapi belum terjadi" dan "apa yang terjadi tetapi ERP belum tahu"; selisih stok terdeteksi tanpa menunggu keluhan. |
| **D-13** | **Klaim tugas.** Handheld meng-`claim` operasi (`assigned_to`) sebelum scan; operasi yang di-claim user lain ⇒ `409 CONFLICT/CLAIMED_BY_OTHER`. Supervisor boleh `unclaim`. Klaim kedaluwarsa setelah `claim_ttl_minutes` tanpa aktivitas. | Cegah dua operator mengerjakan pick list yang sama. |

---

## 3. Mesin Transisi Generik

Semua endpoint transisi (`ready`/`start`/`submit`/`confirm`/`cancel`/`approve`/`reopen`) mengikuti kerangka sama:

```
OP ──POST /operations/{id}/{action}  [Idempotency-Key, If-Match: <version>]──► API
                                        │  P-6: key sudah diproses → kembalikan respons tersimpan
                                        │  P-4: resolve menu = operation_type.{menu|confirm_menu|approve_menu}_code
                                        │       cek can_edit → 403 bila gagal
                                        ▼
                                       SVC ⟦TX⟧
                                        │  🔒 SELECT operation WHERE id=:id FOR UPDATE      (P-3)
                                        │  bila tidak ada        → 404 NOT_FOUND (rollback)
                                        │  bila If-Match dikirim & ≠ operation.version → 409 VERSION_CONFLICT
                                        │  bila (status, action) bukan transisi sah → 409 INVALID_TRANSITION   (P-6)
                                        │  ── jalankan efek spesifik action (lihat §4/§5) ──
                                        │  UPDATE operation SET status=<next>, [started_at/confirmed_at/...]
                                        │     (trigger bump_version menaikkan version)
                                        ▼  COMMIT → simpan respons ke idempotency_key → 200 {operation, next_expected}
```

**Tabel transisi sah (SM#1):**

| action | Dari status | Ke status | Prasyarat tambahan | Menu RBAC (optype) |
|---|---|---|---|---|
| `ready` | DRAFT | READY | INCOMING: header valid (PO `OPEN/PARTIAL` bila PO-linked); INTERNAL/OUTGOING: ≥1 line & valid; `reason_code` bila `require_reason` | `menu_code` |
| `reopen` | READY | DRAFT | opsional; tanpa reservasi | `menu_code` |
| `start` | READY | IN_PROGRESS | OUTGOING/INTERNAL: reserve sukses (A-2); INCOMING: tanpa reserve | `menu_code` |
| `submit` | IN_PROGRESS | IN_PROGRESS | **hanya INCOMING**, sekali; ≥1 unit discan; generate HU/LPN/serial `PENDING` (D-6); set `submitted_at` | `menu_code` |
| `approve` | READY / IN_PROGRESS | (tetap) | hanya bila `require_approval`; `approved_by ≠ created_by` (D-11) | `approve_menu_code` |
| `confirm` | IN_PROGRESS | DONE | semua line `DONE` (tertutup, A-4c); approval ada bila wajib; INCOMING: sudah `submit` & semua line punya `to_location` | `confirm_menu_code ?? menu_code` |
| `cancel` | DRAFT/READY/IN_PROGRESS | CANCELLED | release reservasi (A-3); INCOMING: HU/serial PENDING → VOID | `menu_code` |

Transisi di luar tabel → `409 INVALID_TRANSITION`. Operasi instan (D-7) menjalankan `create → ready → start → confirm` dalam satu ⟦TX⟧ dengan aturan yang sama.

---

## 4. Algoritma Inti

### A-1 — Seleksi kandidat FEFO

Dipakai saat `generate pick list` (saran, tanpa lock) dan `start` (reserve, dengan lock). Menghasilkan daftar quant terurut.

```
INPUT: product_id, qty_needed(base), allowed_status[], [location_scope], [batch_filter], eff_flags(fefo, expiry)
candidates := SELECT q.id, q.qty, q.batch_id, q.location_id, q.hu_id, q.serial_id, q.status, b.expiry_date
              FROM quant q LEFT JOIN batch b ON b.id = q.batch_id
              WHERE q.product_id = :product AND q.status = ANY(:allowed_status) AND q.qty > 0
                    [AND q.location_id IN :location_scope]      -- default: lokasi fisik di warehouse operasi
                    [AND q.batch_id = :batch_filter]
              ORDER BY
                 CASE WHEN :fefo THEN b.expiry_date END ASC NULLS LAST,  -- FEFO: kadaluarsa terdekat dulu
                 q.location_id, q.id                                      -- tie-breaker deterministik
              [FOR UPDATE OF q]                                           -- ⚠ WAJIB "OF q": PG menolak FOR UPDATE
                                                                          --   pada sisi nullable LEFT JOIN
RETURN candidates
```
- Flag efektif: `fefo = app_setting.enable_fefo AND product.use_fefo` (sama untuk batch/expiry/serial).
- Bila `fefo=false`: urut hanya `q.location_id, q.id`.

### A-2 — Reserve (Ready → In progress, OUTGOING & INTERNAL berbasis line)

```
⟦TX⟧
🔒 operation; assert status=READY
lines := operation_line WHERE operation_id=:op ORDER BY id
IF SO-linked: 🔒 sales_order_line WHERE id IN lines.so_line_id ORDER BY id           -- P-3 langkah 2
FOR p IN distinct(lines.product_id) ORDER BY p: 🔒adv(p)                            -- P-3 langkah 3
FOR each L in lines:
    needed := L.qty_base
    IF L.so_line_id:
        sl := sales_order_line(L.so_line_id)
        if sl.qty_reserved + sl.qty_delivered + needed > sl.qty → ROLLBACK 422 BUSINESS_RULE/SO_OVER_ALLOCATION
    rows := A-1(L.product, needed, optype.allowed_from_status, scope, L.batch, flags) FOR UPDATE OF q
    FOR each q in rows WHILE needed > 0:
        if eff.expiry AND expired(q.batch, wh_tz)                                → skip
        if eff.expiry AND remaining_shelf_life(q.batch, wh_tz) < min_shelf_life(partner) → skip   (hanya OUT_DELIVERY)
        take := min(needed, q.qty)
        UPDATE quant SET qty = qty - take WHERE id = q.id;  if 0 → DELETE          -- BR-11 (aman: reservasi tak menunjuk quant sumber)
        rq := UPSERT quant(product, location, batch, hu, serial, status='RESERVED') qty += take   -- D-4
        UPSERT stock_reservation(operation_line_id=L.id, quant_id=rq.id) WHERE status='ACTIVE'
               SET qty += take                                                     -- uq_resv_active(line, quant)
               ON INSERT: operation_id, product, location, batch, hu, serial, source_status=q.status
        needed -= take
    if needed > 0: ROLLBACK → 422 BUSINESS_RULE/INSUFFICIENT_STOCK (detail: product, kurang N base)
    IF L.so_line_id: UPDATE sales_order_line SET qty_reserved += L.qty_base WHERE id=L.so_line_id
IF SO-linked AND sales_order.status='RECEIVED': UPDATE sales_order SET status='PROCESSING'
UPDATE operation SET status='IN_PROGRESS', started_at=now()
COMMIT
```
- Produk ber-serial (qty=1/quant): "split" = seluruh quant serial itu flip ke RESERVED.
- Dua line dengan SKU sama boleh menunjuk pool RESERVED yang sama — unik per `(operation_line_id, quant_id)`.
- **OUT_DELIVERY (M3):** urutan lock = 🔒operation → 🔒`sales_order` (header; `CANCELLED`/`DONE` → `422 ORDER_NOT_OPEN`) → 🔒`sales_order_line` urut id → 🔒adv(produk) → `FOR UPDATE OF q`. Scope lokasi = semua bin non-sistem & `is_usable` di gudang operasi; batch di bawah cutoff D-26 dilewati; urutan kandidat = FEFO (bila efektif) → barang lepas dulu → kode lokasi → id. Kurang → rollback `422 INSUFFICIENT_STOCK` `{product, short, excluded_by_expiry}`. Status SO dihitung ulang (D-28). Scrap/issue: scope = `line.from_location` + filter atribut line (sama dengan INTERNAL), cutoff per D-26.
- **INTERNAL (M2):** scope lokasi = `line.from_location` (F-ISR: `IN-TRANSIT` dengan atribut persis, D-21) + filter `batch`/`hu` (hu = X atau karton anak X)/`serial` line; tanpa cek expiry; urutan kandidat = FEFO (bila efektif) → barang lepas dulu → kode lokasi → id. Reservasi baru ber-`qty_done = 0` (D-18); ad-hoc langsung `qty_done = qty`.

### A-3 — Release reservasi (cancel / penutupan line parsial / ganti batch)

```
release(R, qty_rel):                                   -- dipanggil di dalam ⟦TX⟧ yang sudah 🔒operation & 🔒adv(product)
    🔒 quant rq = R.quant_id  (FOR UPDATE)
    -- URUTAN WAJIB: ubah reservasi DULU (CHECK: reservasi ACTIVE harus punya quant_id), baru quant
    IF qty_rel = R.qty: UPDATE stock_reservation SET status='RELEASED' WHERE id=R.id
    ELSE              : UPDATE stock_reservation SET qty = qty - qty_rel WHERE id=R.id
    UPDATE quant SET qty = qty - qty_rel WHERE id = rq.id; if 0 → DELETE    -- R.quant_id otomatis NULL (ON DELETE SET NULL)
    UPSERT quant(R.product, R.location, R.batch, R.hu, R.serial, status = R.source_status) qty += qty_rel   -- kembali PERSIS
    IF line.so_line_id: UPDATE sales_order_line SET qty_reserved = qty_reserved - qty_rel

cancel:
⟦TX⟧
🔒 operation; assert status ∈ {DRAFT, READY, IN_PROGRESS}
🔒 order lines (urut id); 🔒adv(product) urut
FOR each R in stock_reservation WHERE operation_id=:op AND status='ACTIVE' ORDER BY quant_id: release(R, R.qty)
IF INCOMING: UPDATE handling_unit/serial SET status='VOID' WHERE dibuat oleh op ini AND status='PENDING'   (D-6)
UPDATE operation SET status='CANCELLED', cancelled_at=now(), cancelled_by=:user
COMMIT
```
**Kunci (BR):** reservasi menyimpan qty + seluruh atribut + `source_status` ⇒ pengembalian **persis**, walau baris quant RESERVED sudah terhapus.
**Close line (D-18):** release hanya bagian `qty − qty_done` tiap reservasi line (`qty_done = 0` → RELEASED penuh; sebagian → `qty` dikurangi); line → DONE. Cancel melepas seluruh `qty`.
**OUTGOING ber-SO (M3):** close line & cancel mengunci header SO → line SO sebelum advisory lock; `qty_reserved` turun sebesar yang dilepas; status SO dihitung ulang (D-28).

### A-4 — Confirm (In progress → Done)

Tiga varian efek stok berdasarkan `direction`. Semua baris `stock_move` menyertakan `operation_id`, `user_id`, `reason_code_id` (bila ada), `from_status`, `to_status`.

**(a) OUTGOING confirm** (delivery / scrap / issue / adjustment loss):
```
⟦TX⟧
🔒 operation; assert IN_PROGRESS
if require_approval AND approved_by IS NULL → 422 BUSINESS_RULE/NEEDS_APPROVAL
if EXISTS line status='PENDING' → 422 BUSINESS_RULE/LINES_OPEN            -- line harus ditutup (A-4c)
🔒 order lines (urut id); 🔒adv(product) urut
dest := operation_type.default_dest (VIRT-CUSTOMER | SCRAP | PRODUCTION | INV-ADJUST)
FOR each R in reservations(op, ACTIVE) ORDER BY quant_id:
    🔒 quant rq = R.quant_id
    UPDATE stock_reservation SET status='CONSUMED' WHERE id=R.id           -- DULU (lihat A-3: urutan wajib)
    UPDATE quant SET qty = qty - R.qty WHERE id=rq.id; if 0 → DELETE     -- D-1: tak ada quant di dest
    INSERT stock_move(op, product, batch, hu, serial, from=R.location, to=dest,
                      from_status=R.source_status, to_status=NULL, qty=R.qty, uom=base, reason, user)   -- bukan 'RESERVED' (D-2)
    if serial: UPDATE serial SET status='CONSUMED'
    if hu tak lagi punya quant: UPDATE handling_unit SET status='SHIPPED' (delivery) | 'EMPTY' (lainnya)
    if line.so_line_id: UPDATE sales_order_line SET qty_delivered += R.qty, qty_reserved -= R.qty
UPDATE operation SET status='DONE', confirmed_at=now()
IF SO-linked: SO status := DONE bila Σ qty_delivered = Σ qty, else PARTIAL
INSERT integration_event(SHIPMENT_CONFIRMED | ORDER_STATUS_CHANGED ...)     -- outbox, dalam TX yang sama
COMMIT
```

**Catatan implementasi (M3):** yang dikonsumsi = `qty_done` tiap reservasi (D-18); sisa yang belum discan dilepas dulu (defensif). Tanpa line ber-`qty_done` → `422 NO_LINES`. Tujuan `VIRTUAL_CUSTOMER`/`PRODUCTION`: batch yang kini expired → `422 EXPIRED` (D-26). `stock_move.hu_id` & status HU mengikuti D-30. Pada baris SO, `qty_reserved` diturunkan **sebelum** `qty_delivered` dinaikkan (CHECK `qty_reserved + qty_delivered ≤ qty` dievaluasi per statement). Outbox: `SHIPMENT_CONFIRMED` memuat qty operasi ini, lalu `ORDER_STATUS_CHANGED` bila status SO berubah (D-28). Scrap/issue: tanpa SO, tanpa outbox.

**(b) INCOMING confirm** (receipt+putaway / return / adjustment gain):
```
⟦TX⟧
🔒 operation; assert IN_PROGRESS AND submitted_at IS NOT NULL (receipt) 
assert semua line punya to_location (tipe STOCK, is_usable, warehouse = operation.warehouse)
IF PO-linked: 🔒 purchase_order_line WHERE id IN lines.po_line_id ORDER BY id
🔒adv(product) urut
src := operation_type.default_src (VIRT-SUPPLIER | PRODUCTION | VIRT-CUSTOMER | INV-ADJUST)
FOR each operation_line L:
    IF L.po_line_id: A-6b (authoritative, di bawah lock) → 422 BUSINESS_RULE/OVER_RECEIPT
    st := (enable_quarantine AND qa_on_receipt) ? 'QUARANTINE' : (optype.to_status ?? 'AVAILABLE')
    🔒 UPSERT quant(product, L.to_location, batch, hu, serial, status=st) qty += L.qty_done_base
    UPDATE handling_unit SET location_id=L.to_location, status='INTACT'   -- PENDING → INTACT, sync cache (BR-14)
    if serial: UPDATE serial SET status='ACTIVE'   (lokasi TIDAK disimpan di serial)
    INSERT stock_move(op, ..., from=src, to=L.to_location, from_status=NULL, to_status=st, qty=L.qty_done_base, uom=base, user)
    if L.po_line_id: UPDATE purchase_order_line SET qty_received += L.qty_done_base
UPDATE operation SET status='DONE', confirmed_at=now()
IF PO-linked: PO status := CLOSED bila semua line qty_received ≥ qty, else PARTIAL
INSERT integration_event(RECEIPT_CONFIRMED)
COMMIT
```

**(c) INTERNAL confirm** — lihat sequence spesifik §5.3–5.6 (transfer, inter-site, carton break, QA). Pola: reservasi (A-2) di-CONSUMED dulu lalu quant RESERVED dikurangi di `from`; quant diproduksi di `to` dengan `to_status = optype.to_status ?? R.source_status`; ledger `from_status = R.source_status`. Status berubah di bin sama = satu baris ledger (D-8).
```
⟦TX⟧ (M2)
🔒 operation; assert IN_PROGRESS
if EXISTS line PENDING → 422 LINES_OPEN;  if tak ada line ber-qty_done → 422 NO_LINES
tujuan per line: F-ISD = optype.default_dest (IN-TRANSIT); lainnya line.to_location (kosong → 422 PUTAWAY_INCOMPLETE),
                 divalidasi ulang (INVALID_BIN) & ≠ sumber bila status sama (SAME_LOCATION)
🔒adv(product) urut; 🔒 quant RESERVED milik reservasi (FOR UPDATE)
totals := isi HU yang disentuh (SEBELUM mutasi) → rencana identitas unit (D-19)
FOR each R (urut quant_id): R → CONSUMED; quant RESERVED −R.qty (0 → DELETE)
    UPSERT quant(tujuan, atribut R, hu = D-19, status) += R.qty; stock_move(R.location → tujuan, hu = identitas tujuan)
HU utuh → location = tujuan; karton lepas pallet → parent NULL; HU tanpa isi → EMPTY
line DONE; cursor dihapus; operation DONE
```

### A-4c — Aturan scan (IN_PROGRESS, semua direction)

```
POST /operations/{id}/scan {expected_step, code, qty?, batch?, fefo_override_reason?}   [Idempotency-Key WAJIB]
⟦TX⟧ singkat
🔒 operation (FOR UPDATE, lock_timeout pendek); assert IN_PROGRESS; assert assigned_to = user (D-13)
- BIN:    validasi bin di warehouse operasi, is_usable, tipe sesuai langkah
          (sumber: berisi reservasi op ini; tujuan putaway: STOCK; staging/dock: STAGING/DOCK) → set konteks bin
- UNIT (LPN/CARTON/SERIAL):
    OUTGOING/INTERNAL: unit ada & milik reservasi ACTIVE line op ini (status RESERVED); match produk/batch line
        FEFO (eff.fefo): if batch(unit).expiry lebih lama dari saran terdekat yang masih tersedia:
            fefo_policy=block → 422 BUSINESS_RULE/FEFO_VIOLATION
            fefo_policy=warn  → tanpa fefo_override_reason: 422 BUSINESS_RULE/FEFO_ACK_REQUIRED
                                dengan reason: lanjut + isi operation_line.fefo_override_* (D-10)
        unit valid dari batch lain (belum di-reserve op ini) → swap atomik: release(R lama) + reserve unit ini (A-2 mini)
        expiry (OUT_DELIVERY): expired → 422 EXPIRED; shelf-life < min → 422 SHELF_LIFE
        qty_done_base += qty unit
    INCOMING (sebelum submit): cek S/N unik global (serial.code / handling_unit.code) → 409 DUPLICATE_SERIAL;
        produk cocok PO line; batch/expiry wajib bila flag; A-6b pre-check (early reject OVER_RECEIPT);
        tambah/isi operation_line (qty_base via A-6a)
- LINE CLOSE (POST .../lines/{lineId}/close {qty_done?}): tutup line (status DONE);
        bila qty_done_base < reserved → release(sisa) (A-3); SO tetap terbuka
UPDATE operation (touch) — version naik, jadi scan paralel ber-If-Match terdeteksi
RETURN {line, next_expected, warnings[]}
```
**F-OUT (M3):** unit milik reservasi → cek FEFO (D-24) → tandai `qty_done`, tanpa advisory lock. Unit di luar reservasi → swap (D-25) dengan A-5 penuh. Bin sumber = bin `STOCK`/`QUARANTINE` usable mana pun di gudang operasi (bin tanpa reservasi = bin swap). Qty lepas diisikan FEFO ke reservasi line **di bin cursor**; kelebihannya = swap dari stok bebas bin itu. Scan staging/dock menulis `operation.staging_location_id/dock_location_id`. F-SCR memakai aturan INTERNAL (tanpa swap, tanpa FEFO).

Klien **menserialkan** scan (antrean satu-per-satu) — lihat handheld §4.5. Jenis kode diklasifikasi server & langkah berikutnya dihitung oleh tabel keputusan di `flow-steps-wms-baseline.md` (state antar-scan di `operation_cursor`, schema v1.5).

### A-5 — Protokol locking & anti-deadlock (satu-satunya)

1. **`operation`** by id (`FOR UPDATE`).
2. **Order** terkait: header (`sales_order`/`purchase_order`, urut `id`) lalu **line** (`sales_order_line`/`purchase_order_line`) urut `id` naik. Header dikunci lebih dulu agar confirm sejalan dengan `PATCH`/`cancel` order (yang mengunci header → line) — tanpa itu keduanya bisa saling menunggu.
3. **Advisory lock per produk**: `pg_advisory_xact_lock(hashtext('p:'||product_id))` untuk setiap produk yang disentuh, **urut `product_id` naik**. Ini men-serialisasi semua mutasi quant per produk, sehingga urutan lock baris quant di dalam satu produk tidak lagi bisa membentuk siklus.
4. **Baris `quant`** via `FOR UPDATE OF q` (urutan bebas; sudah terlindungi langkah 3).

- **Timeout:** `lock_timeout` 3–5 s → `409 CONFLICT/LOCK_TIMEOUT` agar handheld tidak menggantung. Scan memakai `lock_timeout` lebih pendek (≈1 s).
- **Transaksi pendek:** I/O berat (cetak label, panggil ERP, export) **di luar** `⟦TX⟧` stok. Outbox ditulis di dalam TX, dikirim worker.
- Trade-off: serialisasi per produk menurunkan throughput bila satu SKU sangat panas — diterima (NFR-PERF-6 10 scan/dtk lintas SKU; scan tidak mengambil advisory lock).

### A-6 — Konversi UOM & roll-up

**(a) Scan → base.** `base_qty = scanned_qty × packaging[uom_scan].qty_in_base`. Contoh: scan 2 Carton, `qty_in_base(Carton)=100` ⇒ 200 base. Disimpan di `operation_line.qty_base`.

**(b) Validasi over-receipt (PO).** Untuk tiap `purchase_order_line` (di bawah 🔒 order line saat confirm; pre-check tanpa lock saat scan):
```
allowed := qty × (1 + over_receipt_tolerance_pct/100)
if qty_received + Σ(qty_done_base line op ini) > allowed → 422 BUSINESS_RULE/OVER_RECEIPT
```

**(c) Roll-up tampilan** dari base `B`, level menurun (pallet→carton→…→pcs):
```
sisa := B
FOR level in packaging ORDER BY level_seq DESC:
    n := floor(sisa / qty_in_base[level]); sisa := sisa mod qty_in_base[level]
    display[uom[level]] := n
```
Contoh `B=250`, packaging {Pcs=1, Box=10, Carton=100} → **{Carton:2, Box:5, Pcs:0}**. Contoh `B=250`, {Pcs=1, Carton=100} → **{Carton:2, Pcs:50}**. Qty di API dikirim sebagai **string desimal** (API §1.1) — jangan hitung dengan float.

**(d) Tanggal & shelf-life.** `today := (now() AT TIME ZONE warehouse.timezone)::date`. `expired(b) := b.expiry_date < today`. `remaining_shelf_life(b) := b.expiry_date − today` (hari). `min_shelf_life(partner) := COALESCE(partner.min_shelf_life_days, default_min_shelf_life_days)`.

### A-7 — Generator kode (ref_no, LPN, S/N)

Sekuens aman-konkuren via tabel penghitung `doc_counter` (bisa reset per-scope):
```
next_seq(scope):
  INSERT INTO doc_counter(scope_key,last_seq) VALUES(:scope,1)
  ON CONFLICT (scope_key) DO UPDATE SET last_seq = doc_counter.last_seq + 1
  RETURNING last_seq;
```
- **ref_no:** `scope = "{TYPE}:{YYYY}"` (YYYY menurut `warehouse.timezone`) → `ref_no_format` `{TYPE}-{YYYY}-{seq:05}`. Mis. `RCV-2026-00001`.
- **LPN/S/N:** `scope = "LPN"` / `"SN"` global → `lpn_code_format`/`serial_code_format`.
- Generasi kode boleh di luar `⟦TX⟧` stok (transaksi pendek sendiri); celah nomor akibat rollback diterima (tidak perlu gapless).

---

## 5. Sequence per Operation Type

### 5.1 INCOMING — Receipt + Putaway (UC-01)

```
OP  buat receipt (optype RCV_*, PO ref)                    → POST /inbound/receipts            → DRAFT
OP  ready                                                  → POST /operations/{id}/ready       → READY  (header valid)
OP  claim + start                                          → POST /operations/{id}/claim, /start → IN_PROGRESS (tanpa reserve)
OP  scan Carton/Serial per unit                            → POST /operations/{id}/scan  [A-4c INCOMING]
    │  S/N unik global → 409 DUPLICATE_SERIAL; produk cocok PO → 422 PRODUCT_MISMATCH;
    │  batch/expiry wajib bila flag → 422 MISSING_BATCH/MISSING_EXPIRY; pre-check OVER_RECEIPT
OP  submit                                                 → POST /operations/{id}/submit
    │  generate HU/LPN + serial (status PENDING, D-6); set submitted_at
OP  cetak label (di luar TX)                               → POST /inbound/receipts/{id}/print-lpn (ZPL/PDF)
OP  putaway: scan LPN → scan bin STOCK                     → POST /operations/{id}/scan
    │  bin tipe STOCK & is_usable & warehouse sama & LPN milik op → set operation_line.to_location  (kapasitas: fase 2)
OP  confirm                                                → POST /operations/{id}/confirm  ⟦A-4b⟧
    ▼  quant baru (AVAILABLE/QUARANTINE), stock_move VIRT-SUPPLIER→bin, qty_received naik, HU INTACT, serial ACTIVE
```
`next_expected`: `SCAN_UNIT → SUBMIT → PRINT_LABEL → SCAN_LPN → SCAN_BIN → (ulang per LPN) → CONFIRM`.

### 5.2 OUTGOING — Picking + Delivery (UC-02) — satu operasi, satu confirm

```
ERP POST /outbound/orders (idempoten erp_ref)  → SO(RECEIVED)
OP/sys POST /outbound/orders/{id}/generate-picklist            (RBAC: create pada outbound_picking)
    │  SVC: 1 operation_line per so_line (so_line_id terisi, qty_base = sisa belum teralokasi);
    │       A-1 saran batch(FEFO)/lokasi/HU (tanpa lock); operation OUT_DELIVERY (READY); urut delivery_date
OP  claim + start                                              → ⟦A-2 reserve⟧
    │  quant AVAILABLE→RESERVED (in-place), stock_reservation ACTIVE per line, qty_reserved naik,
    │  SO → PROCESSING, FEFO/expiry re-check
OP  per line: scan bin → scan LPN/Carton/Serial (mode full/partial/loose) ⟦A-4c⟧
    │  FEFO block/ack, expiry/shelf-life, swap batch valid; line close (partial → release sisa)
OP  scan staging → scan loading dock                           (D-3: penanda progres)
OP  confirm (menu confirm = outbound_deliveries)               → ⟦A-4a⟧
    ▼  reserved dikonsumsi → VIRT-CUSTOMER, reservation CONSUMED, qty_delivered naik, serial CONSUMED/HU SHIPPED,
       SO PARTIAL/DONE, outbox SHIPMENT_CONFIRMED
OP  cetak surat jalan                                          → POST /outbound/deliveries/{id}/document
```
Cancel kapan pun sebelum Done → A-3 (semua reservasi RELEASED). `next_expected`: `SCAN_BIN → SCAN_LPN|SCAN_CARTON|SCAN_SERIAL → (CLOSE_LINE) → … → SCAN_STAGING → SCAN_DOCK → CONFIRM`.

### 5.3 INTERNAL — Bin-to-Bin Transfer

```
OP  buat transfer (INT_TRANSFER) + line (produk/unit, from_location)   → POST /internal/transfers → DRAFT → ready
OP  claim + start                                                       → ⟦A-2⟧ reserve dari from_location
OP  scan source bin → scan LPN/Carton/Serial → scan dest bin            ⟦A-4c⟧
    │  dest valid, ≠ source, is_usable, warehouse sama → set to_location; line close
OP  confirm  ⟦TX⟧ (A-4c pola internal)
    ▼  per reservasi: kurangi RESERVED di source, UPSERT quant di dest (status = source_status),
       stock_move source→dest (from_status = to_status = source_status), HU.location sync. Stok netral.
```
Varian cepat (handheld, tanpa dokumen sebelumnya): `POST /internal/transfers {mode:"adhoc"}` membuat operasi kosong yang langsung IN_PROGRESS & di-claim; setiap scan unit di source bin membuat `operation_line` **dan** mereservasi unit itu seketika (A-2 untuk satu line, dengan protokol lock A-5); scan dest bin mengisi `to_location`; `confirm` seperti biasa. Ini satu-satunya kasus line dibuat saat IN_PROGRESS pada OUTGOING/INTERNAL.

### 5.4 INTERNAL — Inter-Site Transfer (2 langkah, UC-04)

```
── Operasi #1 DISPATCH (Gudang A) ──
OP  POST /internal/transfers {optype: INT_INTERSITE, warehouse_id: A, dest_warehouse_id: B}   (dest wajib)
OP  start (reserve) → scan source bin → scan unit
OP  confirm ⟦TX⟧ → quant: bin A → IN-TRANSIT (qty pindah), stock_move bin_A→IN_TRANSIT
── Operasi #2 RECEIVE (Gudang B) ──
OP  POST /internal/transfers/{dispatchId}/receive  → operation(parent_operation_id=dispatch, warehouse_id=B)
    │  hanya boleh bila dispatch DONE & user bekerja di dest_warehouse_id → else 409 CONFLICT/WRONG_WAREHOUSE
OP  start (reserve dari IN-TRANSIT, filter hu/serial milik dispatch) → scan unit → scan dest bin (Gudang B)
OP  confirm ⟦TX⟧ → quant: IN_TRANSIT → bin B, stock_move IN_TRANSIT→bin_B
```
- Selagi di IN_TRANSIT: tidak AVAILABLE di A maupun B (D-1). Total netral.
- **Selisih penerimaan:** receive boleh parsial (line close); sisa tetap di IN_TRANSIT dan tampil di laporan in-transit (`GET /reports/in-transit`, per dispatch: umur, baris sisa, loss tercatat). Penyelesaian barang hilang/rusak = **transit loss** (D-33): `POST /inventory/adjustment {dispatch_id, reason_code: TRANSIT_LOSS, …}` → `ADJ_LOSS` dari IN-TRANSIT ber-`parent_operation_id = dispatch`, sehingga sisa dispatch turun dan tak bisa di-receive lagi (`NO_LINES` bila habis).

### 5.5 INTERNAL — Carton Break (UC-03) — operasi instan

```
OP  POST /internal/carton-break/preview {carton_code}
    │  SVC: HU tipe CARTON & status INTACT; produk track_level=ITEM; quant karton AVAILABLE (bukan RESERVED);
    ▼  N := quant.qty karton (base) — BUKAN product_packaging saat ini; N wajib bilangan bulat
       → {items_to_generate:N, batch, expiry, location, status}
OP  POST /internal/carton-break {carton_code, generate_serials, Idempotency-Key}   ⟦TX⟧ operasi instan INT_CARTON_BREAK
    │  🔒 operation(baru); 🔒adv(product); 🔒 quant karton
    │  UPDATE handling_unit(karton) SET status='BROKEN'
    │  DELETE quant karton (qty N → 0)
    │  stock_move: bin → VIRT-TRANSFORM, qty N, hu=karton (from_status AVAILABLE)
    │  IF generate_serials (eff.serial): FOR i in 1..N: serial(code=next SN, status ACTIVE, origin_hu_id=karton)
    │        UPSERT quant item (AVAILABLE, bin sama, batch warisan, serial_id); stock_move VIRT-TRANSFORM → bin qty 1
    │  ELSE: UPSERT quant item (AVAILABLE, bin sama, batch warisan, hu=NULL) qty N; stock_move VIRT-TRANSFORM → bin qty N
    ▼  total base tetap; from≠to terpenuhi (BR-10); operation DONE dengan ref_no CBR-YYYY-nnnnn
```

### 5.6 INTERNAL — Quarantine Hold / Release / Reject / Mark Damaged — operasi instan

| Optype | Dari → Ke status | Lokasi | Reason |
|---|---|---|---|
| `INT_QA_HOLD` | AVAILABLE → QUARANTINE | in-place atau pindah ke bin tipe `QUARANTINE` (scan) | wajib (`QA`) |
| `INT_QA_RELEASE` | QUARANTINE → AVAILABLE | dest discan; **saran** = `from_location` dari `stock_move` hold terakhir unit itu | — |
| `INT_QA_REJECT` | QUARANTINE → DAMAGED | in-place | wajib |
| `INT_MARK_DAMAGED` | AVAILABLE → DAMAGED | in-place | wajib |

```
POST /internal/quarantine/{hold|release|reject|mark-damaged} {units[], dest_location?, reason_code}   ⟦TX⟧ instan
    🔒 operation(baru); 🔒adv(product) urut; 🔒 quant unit (status ∈ allowed_from_status)
    kurangi quant sumber; UPSERT quant(dest ?? lokasi sama, status = to_status)
    stock_move(from=lokasi, to=dest ?? lokasi, from_status, to_status, reason)     -- D-8
```
Damaged tetap on-hand (keluar lewat `OUT_SCRAP`). Unit berstatus RESERVED tidak bisa di-hold → `409 CONFLICT/UNIT_RESERVED` (cancel/ubah operasi pemiliknya dulu).

### 5.7 OUTGOING — Scrap / Issue to Production

```
OP  POST /outbound/scrap {optype OUT_SCRAP|OUT_ISSUE_PROD, reason_code, lines[]}   (reason wajib → 422 MISSING_REASON)
OP  ready → (bila require_approval) approver POST /operations/{id}/approve
    │  RBAC: can_edit pada approve_menu_code (outbound_scrap_approval); approver ≠ pembuat → 403 SELF_APPROVAL
OP  start (reserve dari status ∈ allowed_from_status: AVAILABLE/DAMAGED/QUARANTINE) → scan unit → line close
OP  confirm ⟦A-4a, dest=SCRAP|PRODUCTION⟧ → konsumsi, stock_move bin→endpoint dengan reason_code_id
```
Approval boleh sebelum `start` (READY) atau saat IN_PROGRESS; `confirm` tanpa approval → `422 NEEDS_APPROVAL`.

### 5.8 Inventory — Stock Adjustment (UC-05) — operasi instan (D-32/D-33)

```
OP  POST /inventory/adjustment {location_code?, unit_code?, sku?, batch_no?, status?, delta | counted_qty,
                                reason_code, note?, warehouse_id?, dispatch_id?}   ⟦TX⟧ + Idempotency-Key WAJIB
    │  RBAC create pada inventory_adjustment; reason aktif ber-applies_to ADJUST → else 422 MISSING_REASON
    │  sasaran (tanpa lock): unit_code (serial · HU = quant milik HU itu) ATAU lokasi + SKU (+ batch → MISSING_BATCH)
    │  🔒adv(product) → FOR UPDATE quant pada identitas (lokasi, produk, batch, hu, serial), semua status
    │  free := quant berstatus `status`;  reserved := Σ reservasi ACTIVE ber-source_status `status` pada identitas itu
    │  on_hand := free + reserved;  counted_qty → delta := counted − on_hand;  delta = 0 → 422 NO_CHANGE
    │  delta>0: ADJ_GAIN → bin simpan usable (INVALID_BIN); UPSERT quant += delta;
    │           stock_move INV-ADJUST → lokasi (to_status = status, hu = HU); serial → ACTIVE
    │  delta<0: ADJ_LOSS → |delta| ≤ free → kurangi;  free < |delta| ≤ on_hand → 409 UNIT_RESERVED;
    │           > on_hand → 422 NEGATIVE_STOCK;  stock_move lokasi → INV-ADJUST (from_status = status, hu per D-30);
    │           HU habis → EMPTY (karton lepas dari pallet); serial → CONSUMED
    ▼  operasi DONE + ref_no ADJ-YYYY-nnnnn + line; outbox ADJUSTMENT_POSTED (dalam ⟦TX⟧)
OP  POST /inventory/adjustment/preview — body sama tanpa reason; tanpa lock, tanpa tulis → {free, reserved, on_hand, delta, on_hand_after}
OP  transit loss: dispatch_id → lokasi IN-TRANSIT, hanya loss, ≤ sisa baris dispatch (D-21); tanpa sasaran = seluruh sisa;
    ADJ_LOSS ber-parent_operation_id = dispatch (§5.4)
```
Invarian D-2 terjaga karena `INV-ADJUST` adalah lokasi endpoint. Konkurensi: CC-13.

---

## 6. Katalog Edge Case & Error

Format `HTTP code/reason`. Konsolidasi per alur; tiap baris = satu skenario yang **wajib** ditangani.

### 6.1 Umum (semua operasi)

| Skenario | Hasil |
|---|---|
| Token invalid/kadaluarsa | 401 UNAUTHENTICATED |
| RBAC menolak menu/aksi (menu optype) | 403 FORBIDDEN |
| Operation id tak ada / fitur flag mati | 404 NOT_FOUND |
| Transisi tak sah / double action | 409 INVALID_TRANSITION |
| `If-Match` mismatch | 409 VERSION_CONFLICT |
| Lock melebihi `lock_timeout` | 409 CONFLICT/LOCK_TIMEOUT |
| Operasi di-claim user lain | 409 CONFLICT/CLAIMED_BY_OTHER |
| `Idempotency-Key` sama, payload beda | 422 BUSINESS_RULE/IDEMPOTENCY_MISMATCH |
| `Idempotency-Key` sama, request pertama masih diproses | 409 CONFLICT/IN_PROGRESS |
| Edit/hapus line di luar DRAFT | 409 INVALID_TRANSITION/LINE_LOCKED |
| Payload/parameter cacat | 400 VALIDATION_ERROR |

### 6.2 Inbound

| Skenario | Hasil |
|---|---|
| Scan S/N / kode HU duplikat (global, termasuk VOID) | 409 CONFLICT/DUPLICATE_SERIAL |
| Produk hasil scan ≠ produk PO line | 422 BUSINESS_RULE/PRODUCT_MISMATCH |
| Batch/expiry kosong padahal flag aktif | 422 BUSINESS_RULE/MISSING_BATCH · MISSING_EXPIRY |
| Terima > qty PO × (1+toleransi) (scan & confirm) | 422 BUSINESS_RULE/OVER_RECEIPT |
| Scan LPN/bin sebelum `submit` | 409 INVALID_TRANSITION/NOT_SUBMITTED |
| Bin tujuan bukan STOCK / `is_usable=false` / warehouse lain | 422 BUSINESS_RULE/INVALID_BIN |
| LPN tak cocok dengan operasi | 409 CONFLICT/LPN_MISMATCH |
| Confirm dengan line tanpa `to_location` | 422 BUSINESS_RULE/PUTAWAY_INCOMPLETE |
| Cancel setelah submit | sukses; HU/serial PENDING → VOID; label lama tak berlaku |
| Confirm gagal di tengah | rollback penuh; 500 INTERNAL (tak ada quant/ledger sebagian) |

### 6.3 Outbound (picking/delivery)

| Skenario | Hasil |
|---|---|
| Stok tak cukup untuk reserve | 422 BUSINESS_RULE/INSUFFICIENT_STOCK |
| Reserve melebihi sisa SO line (pick list ganda) | 422 BUSINESS_RULE/SO_OVER_ALLOCATION |
| Dua op reserve stok sama (balapan) | satu sukses; lain gagal — **total reserved ≤ on-hand** (CC-1) |
| Scan batch bukan saran, `fefo_policy=block` | 422 BUSINESS_RULE/FEFO_VIOLATION |
| Scan batch bukan saran, `fefo_policy=warn`, tanpa reason | 422 BUSINESS_RULE/FEFO_ACK_REQUIRED |
| Idem, dengan `fefo_override_reason` | 200 + `warnings:[FEFO_OVERRIDDEN]`; tercatat di line |
| Batch expired | 422 BUSINESS_RULE/EXPIRED |
| Sisa umur < min_shelf_life (partner/default) | 422 BUSINESS_RULE/SHELF_LIFE |
| Scan unit bukan milik reservasi op ini & tak bisa di-swap | 409 CONFLICT/NOT_RESERVED + `details.cause`: `OTHER_OPERATION` · `EXCEEDS_REMAINING` · `PRODUCT_MISMATCH` · `STATUS` · `EMPTY` (D-25) |
| Unit pengganti tidak berada di bin yang discan / bin sumber bukan STOCK/QUARANTINE usable gudang ini | 422 BUSINESS_RULE/INVALID_BIN |
| `fefo_override_reason` bukan reason FEFO_OVERRIDE aktif | 400 VALIDATION_ERROR |
| Generate pick list: semua baris sudah teralokasi/terkirim · tak ada stok · SO batal/selesai | 422 NO_LINES · INSUFFICIENT_STOCK (+`skipped[]`) · ORDER_NOT_OPEN |
| `reopen` pick list | 409 INVALID_TRANSITION (D-27) |
| Start saat SO sudah CANCELLED/DONE | 422 BUSINESS_RULE/ORDER_NOT_OPEN |
| Confirm: batch kedaluwarsa setelah dipick | 422 BUSINESS_RULE/EXPIRED (D-26) |
| Confirm: semua line ditutup dengan qty 0 | 422 BUSINESS_RULE/NO_LINES |
| Scan dock / confirm oleh pemegang hak Deliveries saat operasi di-claim picker (tahap delivery) | sukses; klaim berpindah (D-29) |
| Line close dengan qty < reserved | sukses; sisa reservasi RELEASED; SO tetap terbuka |
| Confirm dengan line masih PENDING | 422 BUSINESS_RULE/LINES_OPEN |
| Cancel di tengah | semua reservasi op → RELEASED; qty kembali ke `source_status` |
| Double-confirm | kedua: 409 INVALID_TRANSITION; ledger tak ganda |

### 6.4 Internal

| Skenario | Hasil |
|---|---|
| Carton break produk track_level=CARTON | 422 BUSINESS_RULE/NOT_ITEM_LEVEL |
| Carton break HU ≠ CARTON / status ≠ INTACT / quant RESERVED | 422 BUSINESS_RULE/INVALID_HU |
| Carton break N bukan bilangan bulat | 422 BUSINESS_RULE/FRACTIONAL_CONTENT |
| Generate serial duplikat | 409 CONFLICT/DUPLICATE_SERIAL |
| Transfer dest = source (status sama) | 422 BUSINESS_RULE/SAME_LOCATION |
| Inter-site dispatch tanpa `dest_warehouse_id` | 400 VALIDATION_ERROR |
| Inter-site receive di warehouse ≠ tujuan / dispatch belum DONE | 409 CONFLICT/WRONG_WAREHOUSE · INVALID_TRANSITION |
| Barang di source tak berstatus yang diizinkan / qty kurang | 422 BUSINESS_RULE/INSUFFICIENT_STOCK |
| QA hold atas unit RESERVED | 409 CONFLICT/UNIT_RESERVED |
| Scan unit yang bukan milik reservasi op / LPN yang tak direservasi utuh (M2 tanpa swap) | 409 CONFLICT/NOT_RESERVED |
| Scan unit yang sudah discan | 409 INVALID_TRANSITION/ALREADY_DONE |
| Bin tujuan transfer bukan STOCK/QUARANTINE / tak usable / gudang lain | 422 BUSINESS_RULE/INVALID_BIN |
| Confirm INTERNAL dengan line PENDING / line ber-qty tanpa tujuan / semua line qty 0 | 422 LINES_OPEN · PUTAWAY_INCOMPLETE · NO_LINES |
| Line dokumen dari unit di gudang lain | 409 CONFLICT/WRONG_WAREHOUSE |
| Receive kedua saat receive lain masih aktif / tak ada sisa di IN-TRANSIT | 422 BUSINESS_RULE/ORDER_IN_EXECUTION · NO_LINES |
| Carton Break / QA saat flag mati | 404 NOT_FOUND |

### 6.5 Scrap/Issue & Adjustment

| Skenario | Hasil |
|---|---|
| Scrap/adjustment/QA tanpa reason_code | 422 BUSINESS_RULE/MISSING_REASON |
| Confirm scrap tanpa approval (require_approval) | 422 BUSINESS_RULE/NEEDS_APPROVAL |
| Approver = pembuat operasi | 403 FORBIDDEN/SELF_APPROVAL |
| Approve tanpa hak di menu approval | 403 FORBIDDEN |
| Reason scrap/issue tidak cocok tujuan (`applies_to`) | 422 BUSINESS_RULE/MISSING_REASON (D-31) |
| `reopen` operasi yang sudah di-approve | sukses; approval digugurkan (D-31) |
| Issue to production atas batch kedaluwarsa | 422 BUSINESS_RULE/INSUFFICIENT_STOCK (`excluded_by_expiry`) — D-26 |
| Adjustment negatif melebihi on-hand | 422 BUSINESS_RULE/NEGATIVE_STOCK |
| Adjustment negatif atas qty RESERVED (`free < |delta| ≤ on_hand`) | 409 CONFLICT/UNIT_RESERVED (`details.free`, `details.reserved`) |
| Hitungan fisik sama dengan on-hand / delta 0 | 422 BUSINESS_RULE/NO_CHANGE |
| Reason adjustment bukan `applies_to ADJUST` / nonaktif | 422 BUSINESS_RULE/MISSING_REASON |
| Gain ke bin non-simpan / tak usable / gudang lain | 422 BUSINESS_RULE/INVALID_BIN |
| Sasaran HU tanpa stok sendiri (pallet berisi karton) / HU kosong | 422 BUSINESS_RULE/INVALID_HU |
| Gain S/N yang masih punya stok / qty ≠ 1 | 422 BUSINESS_RULE/DUPLICATE_SERIAL |
| Transit loss melebihi sisa dispatch | 422 BUSINESS_RULE/NEGATIVE_STOCK; tanpa sisa → 422 NO_LINES |
| Transit loss atas bagian yang direservasi receive aktif | 409 CONFLICT/UNIT_RESERVED |

---

## 7. Skenario Uji Konkurensi

Uji wajib (mengacu AC-02.1, MS-2 "0 oversell") — dijalankan sebagai integration test dengan transaksi paralel:

| ID | Setup | Aksi paralel | Ekspektasi |
|---|---|---|---|
| CC-1 | 1 produk, on-hand 100 AVAILABLE | 2× `start` (masing-masing butuh 70) serempak | Σ RESERVED ≤ 100; satu gagal `INSUFFICIENT_STOCK`; tidak ada quant negatif |
| CC-2 | Operasi IN_PROGRESS | 2× `confirm` serempak | 1 sukses (Done); 1 → `INVALID_TRANSITION`; ledger 1× |
| CC-3 | 1 quant, 2 transfer beda dest | 2× `start`+`confirm` serempak | Hanya total ≤ tersedia yang pindah; sisanya `INSUFFICIENT_STOCK` |
| CC-4 | Reserve lalu cancel + start baru | `cancel` op A saat op B `start` | Setelah A cancel, stok kembali; B boleh reserve dari stok yang dilepas; tak ada double-count |
| CC-5 | Optimistic lock | 2 klien `ready` dengan `If-Match` versi sama | 1 sukses, 1 → `VERSION_CONFLICT` |
| CC-6 | Deadlock probe | 2 op reserve produk {X,Y} dengan urutan line berbeda | Tak ada deadlock (A-5 advisory lock urut product_id) |
| CC-7 | PO line qty 100, toleransi 0 | 2 receipt (masing-masing 60) `confirm` serempak | 1 sukses; 1 `OVER_RECEIPT`; `qty_received` = 60 |
| CC-8 | SO line qty 100 | 2 pick list (masing-masing 100) `start` serempak | 1 sukses; 1 `SO_OVER_ALLOCATION`; `qty_reserved` = 100 |
| CC-9 | Scan idempoten | scan sama 2× paralel dengan `Idempotency-Key` sama | 1 line terbentuk; respons kedua identik / `IN_PROGRESS` |
| CC-10 | Line ganda SKU sama | 1 op, 2 line SKU & bin sama, `start` | 2 reservasi (satu per line) menunjuk quant RESERVED sama; confirm menghapus quant tanpa FK error |
| CC-11 | Refresh token paralel | 2 `POST /auth/refresh` dengan token sama dalam grace window | keduanya mendapat sesi valid; family **tidak** dicabut |
| CC-12 | Op A IN_PROGRESS memegang pallet P1; op B READY akan mereservasi P2 | A swap ke P2 (scan LPN) ‖ B `start` | tepat satu operasi memegang tiap pallet: swap menang → B mereservasi P1 yang dilepas; start menang → swap `NOT_RESERVED`. Σ RESERVED ≤ on-hand; D-2b utuh |
| CC-13 | 1 quant on-hand 20 | 2× adjustment loss −15 serempak; lalu 2× hitungan fisik bernilai sama serempak | tepat 1 loss sukses, 1 → `NEGATIVE_STOCK`; hitungan kedua melihat stok terbaru → `NO_CHANGE`; quant tak pernah negatif |

---

## Ringkasan Keputusan (behavioral)

1. Quant tidak disimpan di lokasi endpoint virtual (termasuk `INV-ADJUST`); IN_TRANSIT menyimpan quant (D-1/D-2).
2. Picking + delivery = satu operasi `OUT_DELIVERY`, satu confirm; staging/dock = penanda progres (D-3).
3. Reserve = flip in-place + `stock_reservation` **per line**; release/consume presisi via atribut tersalin & `source_status` (A-2/A-3/A-4); **status reservasi diubah sebelum quant**; RESERVED tak pernah di ledger (D-2).
4. **Satu protokol lock:** operation → order line → advisory lock per produk (urut) → `FOR UPDATE OF q` (A-5).
5. INCOMING: scan hanya saat IN_PROGRESS; `submit` menerbitkan HU/serial `PENDING`; cancel → `VOID` (D-5/D-6).
6. **Semua perubahan stok = operation** (adjustment, carton break, QA sebagai operasi instan); perubahan status tercatat di ledger (D-7/D-8/D-9).
7. FEFO `warn` wajib ack + reason; anti self-approval; edit line hanya DRAFT; klaim tugas handheld (D-10..D-13).
8. Semua I/O berat di luar transaksi stok; outbox di dalam; `lock_timeout` mencegah handheld menggantung; `Idempotency-Key` wajib untuk scan & transisi handheld.
9. Generator kode via `doc_counter`; waktu dievaluasi pada `warehouse.timezone`.
10. Katalog error (§6, format `code/reason`) & uji konkurensi CC-1..CC-13 (§7) adalah kontrak test.
11. **M2:** HU karton terbit saat submit (D-17); progres scan per reservasi `qty_done` (D-18); identitas unit di tujuan mengikuti aturan HU utuh dan `stock_move.hu_id` = identitas di tujuan (D-19); satu line = satu tujuan (D-20); kepemilikan IN-TRANSIT dari ledger (D-21); selector QA unit & qty lepas (D-22).
12. **M3:** unit kerja picking = reservasi (D-23); deviasi FEFO terdefinisi & berlaku juga untuk unit reservasi (D-24); swap hanya OUT_DELIVERY dengan A-5 penuh (D-25); aturan kedaluwarsa per tujuan (D-26); pick list dibatasi stok tersedia (D-27); status SO fungsi murni (D-28); serah-terima tahap delivery (D-29); identitas unit keluar (D-30); approval gugur saat reopen (D-31).
13. **M4:** adjustment satu sasaran ber-kode dengan delta/hitungan fisik dan batas error presisi (D-32); transit loss terikat dispatch (D-33); audit feed = `audit_log` ∪ peristiwa operasi (D-34); hak hanya untuk user ACTIVE + pengaman administrator terakhir (D-35); setting divalidasi katalog bertipe (D-36); operation type turunan dari template receipt / scrap-issue (D-37); satu mesin trace & dashboard tanpa agregat (D-38).
14. **M5:** callback ERP dikirim worker di luar transaksi stok dengan tanda tangan, retry → DEAD, dan urutan per order (D-39); ERP tak melayani menghentikan putaran (D-40); rekonsiliasi + cek D-2 harian sebagai log ber-`alert` (D-41).
