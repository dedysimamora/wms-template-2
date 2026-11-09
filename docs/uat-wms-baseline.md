# UAT — WMS Baseline

**Skrip User Acceptance Test · diturunkan dari acceptance criteria (requirements §6), alur handheld (handheld §7), dan metrik sukses MS-1..MS-4 · merealisasikan test-delivery §11**

Versi: 1.0 · 13 Oktober 2026

> Dokumen ini dijalankan **pengguna gudang** di lingkungan staging bersama implementor, sebelum go-live tiap klien. Yang diuji adalah _alur kerja nyata_ (scanner, label, bin fisik) — kebenaran aturan satu per satu sudah dibuktikan otomatis (147 uji integrasi, smoke M0–M5, e2e; lihat m5 §8). Kolom **Hasil** diisi `LULUS` / `GAGAL` + catatan; satu `GAGAL` pada skenario bertanda ★ menahan go-live.

---

## 1. Persiapan

| # | Prasyarat | Penanggung jawab |
|---|---|---|
| P-1 | Staging terpasang dari artefak rilis yang akan dipakai produksi (runbook operasi §3); `GET /api/ready` = `ready` | Implementor |
| P-2 | Profil industri klien terpasang (`scripts/apply-profile.sh <profil>`), zona waktu gudang benar | Implementor |
| P-3 | Master data UAT: ≥ 3 produk (satu polos, satu ber-batch + kedaluwarsa, satu ber-serial bila dipakai), packaging + barcode, ≥ 6 bin berlabel, 1 bin QA, staging, dock, supplier, customer, reason code | Inventory Controller klien |
| P-4 | Akun per peran: Supervisor, 2 Operator, Inventory Controller, Auditor; service account + API key ERP | Admin klien |
| P-5 | Handheld terhubung Wi-Fi gudang; prefix/suffix scanner sesuai (handheld §4); printer label ZPL terpasang | Implementor |
| P-6 | ERP uji (atau `scripts/erp-stub.mjs`) menerima callback; `ERP_CALLBACK_URL` + rahasia terisi | Tim ERP klien |
| P-7 | Stok awal fisik = 0 pada produk UAT (hitung & catat) | Supervisor |

Peran pelaksana: **SPV** (Supervisor), **OP1/OP2** (Operator handheld), **IC** (Inventory Controller), **AUD** (Auditor), **ERP** (tim integrasi).

## 2. Skenario per Modul

### 2.1 Inbound — UC-01

| ID | Skenario (langkah → hasil yang diharapkan) | AC | Pelaku | Hasil |
|---|---|---|---|---|
| U-IN-1 ★ | ERP mengirim PO 2 baris → muncul di Purchase Orders berstatus OPEN dengan qty & UOM asli ERP | FR-IN-1 | ERP, SPV | |
| U-IN-2 ★ | SPV membuat receipt dari PO → OP1 mengambil tugas di handheld → scan barcode karton, isi batch + kedaluwarsa, isi qty → "Selesai scan" → label LPN tercetak & terbaca scanner | AC-01.3 | SPV, OP1 | |
| U-IN-3 ★ | OP1 scan LPN → scan bin → tahan-konfirmasi → Stock on Hand menampilkan qty di bin itu; PO menjadi PARTIAL/CLOSED; ERP menerima `RECEIPT_CONFIRMED` | AC-01.4 | OP1, ERP | |
| U-IN-4 | Scan melebihi qty PO → ditolak dengan pesan over-receipt | AC-01.1 | OP1 | |
| U-IN-5 | Scan bin bukan STOCK (mis. dock) saat putaway → ditolak | AC-01.5 | OP1 | |
| U-IN-6 | Receipt yang sudah terbit label dibatalkan SPV → label lama tak bisa dipakai lagi, stok tak bertambah | AC-01.7 | SPV | |
| U-IN-7 | Dua operator: OP2 membuka tugas yang sudah diambil OP1 → terlihat "diambil OP1", tak bisa scan | D-16 | OP1, OP2 | |

### 2.2 Internal — UC-03, UC-04

| ID | Skenario | AC | Pelaku | Hasil |
|---|---|---|---|---|
| U-INT-1 ★ | Transfer ad-hoc dari handheld: scan bin asal → scan LPN/barang → qty → scan bin tujuan → konfirmasi → stok pindah, total tak berubah | FR-INT-1 | OP1 | |
| U-INT-2 | Transfer dokumen dibuat SPV (2 baris) → OP1 eksekusi, satu baris ditutup sebagian → sisa kembali tersedia di bin asal | A-3 | SPV, OP1 | |
| U-INT-3 | (multi-site) Dispatch Gudang A → laporan In-Transit menampilkan sisa → receive di Gudang B → stok tersedia di B dengan batch/LPN yang sama | AC-04.1–04.3 | SPV, OP1, OP2 | |
| U-INT-4 | (carton break aktif) Pecah karton produk ITEM → N item muncul di bin yang sama, karton berstatus BROKEN, label S/N tercetak bila dipilih | AC-03.3–03.5 | OP1 | |
| U-INT-5 | (QA aktif) Barang masuk berstatus QUARANTINE → tak bisa dipick → IC release → tersedia; reject → rusak | AC-05.4 | IC | |

### 2.3 Outbound — UC-02

| ID | Skenario | AC | Pelaku | Hasil |
|---|---|---|---|---|
| U-OUT-1 ★ | ERP mengirim SO → SPV generate pick list → qty dibatasi stok tersedia | D-27 | ERP, SPV | |
| U-OUT-2 ★ | OP1 mulai picking: handheld mengarahkan ke bin & batch FEFO → scan bin → scan LPN/barang → staging → dock → tahan-konfirmasi → stok berkurang, SO PARTIAL/DONE, ERP menerima `SHIPMENT_CONFIRMED` lalu `ORDER_STATUS_CHANGED` | AC-02.2, AC-02.7 | OP1, ERP | |
| U-OUT-3 ★ | Scan batch yang bukan saran FEFO: profil `warn` → diminta alasan lalu diterima & tercatat; profil `block` → ditolak | AC-02.3, AC-02.4 | OP1 | |
| U-OUT-4 | Scan batch kedaluwarsa → ditolak apa pun kebijakannya | AC-02.5 | OP1 | |
| U-OUT-5 | Pick sebagian lalu tutup baris → sisa reservasi lepas, SO tetap terbuka, pick list lanjutan bisa dibuat | AC-02.8, FR-OUT-8/10 | OP1, SPV | |
| U-OUT-6 | Picking dibatalkan di tengah → semua reservasi kembali persis; qty tersedia = sebelum mulai | AC-02.6 | SPV | |
| U-OUT-7 ★ | Dua operator memulai dua pick list yang berebut stok yang sama pada saat bersamaan → hanya yang muat yang berhasil; tak ada stok minus | AC-02.1 | OP1, OP2 | |
| U-OUT-8 | Scrap dibuat OP1 → OP1 mencoba approve → ditolak; SPV approve → konfirmasi → stok ke SCRAP ber-alasan | AC-02.12 | OP1, SPV | |
| U-OUT-9 | Surat jalan dicetak dari delivery DONE: nomor, customer, baris, batch sesuai | FR-OUT-11 | SPV | |

### 2.4 Inventory & laporan — UC-05

| ID | Skenario | AC | Pelaku | Hasil |
|---|---|---|---|---|
| U-INV-1 ★ | Hitung fisik satu bin di handheld (`/hh/adjustment`): scan bin → scan barang → isi hitungan → pratinjau selisih → alasan → tahan-konfirmasi → stok = hitungan | AC-05.3 | IC | |
| U-INV-2 | Adjustment tanpa alasan → ditolak; loss melebihi stok → ditolak; loss atas stok yang sedang direservasi → pesan "tertahan operasi lain" | AC-05.1, AC-05.2 | IC | |
| U-INV-3 ★ | Traceability: scan LPN / S/N / batch → terlihat asal (PO, supplier), posisi kini, tujuan (SO, customer), jejak pergerakan | FR-INV-4 | AUD | |
| U-INV-4 | Laporan Movement difilter tanggal hari ini memuat semua transaksi UAT; export XLSX terunduh dan terbuka | FR-RPT-2 | AUD | |
| U-INV-5 | Audit Log memuat siapa-apa-kapan untuk: perubahan setting, user baru, konfirmasi operasi, override FEFO | MS-4 | AUD | |

### 2.5 Administrasi & integrasi

| ID | Skenario | Sumber | Pelaku | Hasil |
|---|---|---|---|---|
| U-ADM-1 ★ | Operator membuka URL menu yang bukan haknya → "Akses ditolak"; menu itu tak ada di navigasinya | FR-ADM-4 | OP1 | |
| U-ADM-2 ★ | Admin mengunci akun OP2 saat OP2 sedang bekerja → aksi OP2 berikutnya langsung ditolak | D-35 | Admin, OP2 | |
| U-ADM-3 | User baru login pertama → wajib ganti password | auth §2 | Admin | |
| U-ADM-4 ★ | ERP dimatikan → konfirmasi operasi tetap berjalan; halaman Integration menampilkan event Gagal + tab Rekonsiliasi memuatnya; ERP dinyalakan → "Retry" → event Terkirim berurutan, tanpa duplikat di ERP | D-39..D-41 | Admin, ERP | |
| U-ADM-5 | SO dengan tanggal kirim kemarin yang belum dikirim muncul di Rekonsiliasi sebagai "SO lewat jatuh tempo" | D-41 | SPV/Admin | |
| U-ADM-6 | Handheld kehilangan jaringan → banner offline, tombol aksi terkunci; jaringan kembali → lanjut tanpa scan ganda | NFR-AVL-3 | OP1 | |

## 3. UAT Integritas Stok — MS-1 ★

Tujuan: **selisih stok fisik vs sistem = 0** setelah rangkaian transaksi terkontrol.

| Langkah | Aksi | Catat |
|---|---|---|
| 1 | Hitung fisik produk UAT (harus 0) | Fisik awal |
| 2 | Terima N₁ unit lewat PO (U-IN-2/3) dalam ≥ 2 LPN | N₁ |
| 3 | Transfer sebagian antar-bin (U-INT-1) | — |
| 4 | Kirim N₂ unit lewat SO dalam ≥ 2 pick list, salah satunya parsial (U-OUT-2/5) | N₂ |
| 5 | Scrap N₃ unit ber-approval (U-OUT-8) | N₃ |
| 6 | Hitung fisik **semua** bin yang tersentuh | Fisik akhir per bin |
| 7 | Bandingkan dengan Stock on Hand per bin & per batch | Selisih |
| 8 | Implementor menjalankan `pnpm db:integrity` | Harus `OK` (D-2 = 0) |

Lulus bila: fisik akhir = N₁ − N₂ − N₃ = Stock on Hand (per bin, per batch), langkah 8 `OK`, dan ERP menerima tepat satu `RECEIPT_CONFIRMED` per receipt dan satu `SHIPMENT_CONFIRMED` per pick list dengan qty yang sama.

## 4. UAT Konfigurasi — MS-3 ★

Tujuan: **profil industri berganti tanpa mengubah kode** — dari artefak yang sama.

| Langkah | Aksi | Yang diperiksa |
|---|---|---|
| 1 | Instalasi segar; `apply-profile.sh farmasi` | Menu Batches, Quarantine, Carton Break ada; receipt meminta batch + kedaluwarsa; barang masuk QUARANTINE; scrap butuh approval |
| 2 | Instalasi segar kedua (atau DB dikosongkan); `apply-profile.sh retail` | Menu Batches & Quarantine hilang untuk semua peran; receipt tak meminta batch; picking tanpa langkah FEFO |
| 3 | Bandingkan versi aplikasi kedua instalasi (`/api/ready`, tag image) | Identik |
| 4 | Di instalasi ber-stok batch, coba matikan `enable_batch` | Ditolak (`LOCKED_AFTER_STOCK`) — data tak menjadi yatim |

## 5. Non-fungsional (diamati selama UAT)

| ID | Pengamatan | Ambang | Hasil |
|---|---|---|---|
| U-NF-1 | Respons scan handheld terasa seketika di Wi-Fi gudang (ukur dengan `scripts/load/run.mjs` di staging) | NFR-PERF-1: p95 ≤ 300 ms | |
| U-NF-2 | Label terbaca scanner pada jarak kerja normal; kode manusia-terbaca sesuai | labeling §2 | |
| U-NF-3 | Layar handheld terbaca di cahaya gudang (mode kontras tinggi bila perlu); target sentuh nyaman dengan sarung tangan | NFR-USE-4, NFR-USE-5 | |
| U-NF-4 | Uji restore: backup staging dipulihkan `scripts/restore-drill.sh` → `OK` | NFR-BKP-2/4 | |

## 6. Kriteria Lulus & Tanda Tangan

- Semua skenario ★ `LULUS`; skenario lain boleh `GAGAL` hanya dengan rencana perbaikan bertanggal yang disetujui klien.
- MS-1 (§3) dan MS-3 (§4) `LULUS`.
- Temuan dicatat sebagai: ID skenario, langkah, yang diharapkan, yang terjadi, tangkapan layar/`ref_no`, tingkat (menahan go-live / tidak).

| Modul | Penguji (klien) | Tanggal | Hasil | Tanda tangan |
|---|---|---|---|---|
| Inbound | | | | |
| Internal | | | | |
| Outbound | | | | |
| Inventory & laporan | | | | |
| Administrasi & integrasi | | | | |
| MS-1 Integritas stok | | | | |
| MS-3 Konfigurasi | | | | |
| **Persetujuan go-live** | | | | |

---

## Ringkasan Keputusan (UAT)

1. UAT menguji alur kerja nyata oleh pengguna; kebenaran aturan satu per satu tetap dijaga gate otomatis.
2. Skenario ★ + MS-1 + MS-3 adalah syarat go-live; tanda tangan per modul.
3. MS-1 ditutup dua bukti: hitung fisik = sistem, dan `db:integrity` (D-2) = 0 selisih.
4. MS-3 dibuktikan dengan dua profil dari artefak yang identik lewat `apply-profile.sh`.
