# Panduan Uji Coba WMS — untuk Pemula

**Mencoba seluruh fitur WMS Baseline langkah demi langkah, sambil memahami apa yang terjadi di gudang. Termasuk berperan sebagai ERP dengan Postman dan menyimulasikan ERP yang menerima laporan dari WMS.**

Versi: 1.1 · 17 Oktober 2026 (isian per field di master data & form desktop)

> Prasyarat: WMS sudah online mengikuti [`panduan-deploy-mini-server.md`](panduan-deploy-mini-server.md) (contoh alamat di panduan ini: `https://wms.domainanda.com` dan `https://erp-sim.domainanda.com` — ganti dengan domain Anda). Skenario formal untuk klien ada di [`uat-wms-baseline.md`](uat-wms-baseline.md); panduan ini versi "belajar sambil mencoba"-nya.

---

## Daftar Isi

1. [Kenalan dengan WMS dalam 10 menit](#1-kenalan-dengan-wms-dalam-10-menit)
2. [Siapkan alat](#2-siapkan-alat)
3. [Login pertama & tur layar](#3-login-pertama--tur-layar)
4. [Master data: isi "kamus" gudang](#4-master-data-isi-kamus-gudang)
5. [Siapkan Postman sebagai ERP](#5-siapkan-postman-sebagai-erp)
6. [Skenario A — Barang masuk (PO → Receipt → Putaway)](#6-skenario-a--barang-masuk)
7. [Skenario B — Melihat stok & menelusuri barang](#7-skenario-b--melihat-stok--menelusuri-barang)
8. [Skenario C — Gerakan di dalam gudang](#8-skenario-c--gerakan-di-dalam-gudang)
9. [Skenario D — Barang keluar (SO → Pick list → Picking → Delivery)](#9-skenario-d--barang-keluar)
10. [Skenario E — Scrap dengan persetujuan](#10-skenario-e--scrap-dengan-persetujuan)
11. [Skenario F — Stock adjustment (hitung fisik)](#11-skenario-f--stock-adjustment)
12. [Skenario G — Integrasi ERP: callback, gangguan, rekonsiliasi](#12-skenario-g--integrasi-erp)
13. [Skenario H — User, peran, dan hak akses](#13-skenario-h--user-peran-dan-hak-akses)
14. [Skenario I — Laporan, audit, dashboard](#14-skenario-i--laporan-audit-dashboard)
15. [Skenario J — Konfigurasi (feature flag & profil industri)](#15-skenario-j--konfigurasi)
16. [Skenario K — Multi-gudang (lanjutan, opsional)](#16-skenario-k--multi-gudang)
17. [Skenario L — Kesehatan sistem (integritas, backup)](#17-skenario-l--kesehatan-sistem)
18. [Simulasi ERP: cara kerja & alternatif](#18-simulasi-erp-cara-kerja--alternatif)
19. [Checklist cakupan fitur](#19-checklist-cakupan-fitur)

---

## 1. Kenalan dengan WMS dalam 10 menit

### 1.1 WMS itu apa?

**WMS (Warehouse Management System)** adalah sistem yang mencatat **barang apa, berapa banyak, di rak mana, dalam kondisi apa** — dan memandu orang gudang saat memindahkan barang. Sistem ini **tidak** mengurus harga, faktur, atau pembayaran; itu urusan **ERP** (sistem akuntansi/penjualan perusahaan, mis. SAP, Odoo, Accurate).

Pembagian tugasnya:

```
        ERP (kantor)                                   WMS (gudang)
  "Kita pesan 10 karton dari supplier"  ── PO ──►  "Siap menerima 10 karton"
                                                     orang gudang scan barang masuk
  "Oke, tercatat sudah diterima"        ◄─ callback ─ "Sudah diterima 10 karton, batch X"

  "Toko A pesan 4 karton"               ── SO ──►  "Ambil dari rak mana? ini sarannya"
                                                     orang gudang ambil, kirim
  "Buat tagihan untuk 4 karton"         ◄─ callback ─ "Sudah dikirim 4 karton, batch X"
```

### 1.2 Kamus singkat (istilah yang akan sering muncul)

| Istilah | Arti sederhana | Contoh di uji coba |
|---|---|---|
| **SKU / Produk** | Kode unik barang | `AIR-600` Air Mineral 600ml |
| **UOM** | Satuan: Pcs, Box, Carton, Pallet | — |
| **Base UOM** | Satuan terkecil; **semua stok disimpan dalam satuan ini** | Pcs |
| **Packaging** | Konversi satuan per produk | 1 Carton air = 24 Pcs |
| **Barcode / GTIN** | Kode batang di kemasan, dipakai untuk scan | `8991000600024` (karton air) |
| **Site / Gudang** | Pabrik / gedung gudang | `WH-MAIN` |
| **Lokasi / Bin** | Alamat rak tempat barang diletakkan | `A-01-01-01` = Zona A, rak 01, tingkat 01, slot 01 |
| **Lokasi khusus** | `DOCK-01` (pintu bongkar-muat), `STAGE-01` (area tunggu kirim), `QA-01` (area karantina) | sudah ada dari awal |
| **Lokasi virtual** | Lokasi "di luar gudang" agar pencatatan selalu dari A ke B: `VIRT-SUPPLIER`, `VIRT-CUSTOMER`, `SCRAP`, `INV-ADJUST`, `IN-TRANSIT`… | muncul di laporan pergerakan |
| **LPN** | *License Plate Number* — label untuk satu **palet**/tumpukan | `LPN-0000001` |
| **Carton S/N** | Nomor seri satu **karton** | `SN-0000001` |
| **Pack S/N** | Nomor seri satu **item** (hasil pecah karton) | `SN-0000005` |
| **Batch / Lot** | Kelompok produksi yang sama, punya tanggal kedaluwarsa | `BT-2701`, exp 2027-06-30 |
| **FEFO** | *First Expired, First Out* — yang kedaluwarsanya paling dekat dikirim dulu | sistem menyarankan batch tertua |
| **PO** (Purchase Order) | Pesanan beli ke supplier, **dikirim ERP** ke WMS | `PO-1016-143005` |
| **SO** (Sales Order) | Pesanan jual ke customer, **dikirim ERP** ke WMS | `SO-1016-143005` |
| **Receipt** | Kegiatan menerima barang masuk (scan di dock) | `RCV-2026-00001` |
| **Putaway** | Menaruh barang yang baru diterima ke rak | scan LPN → scan bin |
| **Pick list** | Daftar ambil barang untuk satu SO | `DLV-2026-00001` |
| **Picking** | Mengambil barang dari rak sesuai pick list | — |
| **Staging → Dock** | Barang terambil ditaruh di area tunggu, lalu di pintu muat | `STAGE-01` → `DOCK-01` |
| **Delivery** | Barang resmi keluar gudang (stok berkurang) + surat jalan | — |
| **Reservasi** | Stok "dipesan" untuk satu tugas agar tak diambil tugas lain | status `RESERVED` |
| **Status stok** | `Available` (bisa dipakai), `Reserved` (dipesan), `Quarantine` (ditahan QA), `Damaged` (rusak) | — |
| **Quarantine / QA** | Menahan barang yang dicurigai bermasalah | hold → release/reject |
| **Carton Break** | Membuka karton jadi item satuan | 1 karton Vitamin C → 12 item |
| **Scrap** | Membuang barang rusak/kedaluwarsa (perlu persetujuan) | — |
| **Stock Adjustment** | Koreksi stok setelah hitung fisik | sistem 100, fisik 98 → −2 |
| **Ledger / Movement** | Buku besar semua pergerakan stok, **tidak bisa diubah/dihapus** | Laporan Movement |
| **Operasi** | Satu dokumen kerja (receipt, transfer, picking…) dengan status: **Draft → Siap → Dikerjakan → Selesai** (atau Dibatalkan) | — |
| **Handheld** | Perangkat scanner di tangan operator — di sini: **HP/tablet membuka `/hh`** | `https://wms.domainanda.com/hh` |
| **Callback / Outbox** | Laporan otomatis WMS → ERP setelah operasi selesai | dikirim worker ke ERP simulator |

### 1.3 Tiga aturan emas WMS ini

1. **Stok hanya berubah saat operasi "Selesai".** Selama masih Draft/Siap/Dikerjakan, angka stok di rak belum berubah (kecuali bagian yang direservasi).
2. **Setiap perubahan stok tercatat di ledger** (siapa, kapan, dari mana ke mana, batch apa). Koreksi pun lewat dokumen (adjustment), bukan mengedit angka.
3. **Handheld dipandu sistem.** Layar `/hh` selalu menampilkan judul langkah berikutnya (*Scan barang*, *Scan bin tujuan*, *Konfirmasi*…). Kalau bingung, **baca judul besar di layar** — itu yang diminta sistem.

## 2. Siapkan Alat

| Alat | Untuk apa | Catatan |
|---|---|---|
| Laptop + browser | Layar **desktop** (supervisor/admin): `https://wms.domainanda.com` | Chrome/Edge/Firefox |
| HP/tablet | Layar **handheld** operator: `https://wms.domainanda.com/hh` | Boleh juga dibuka di laptop (tab kedua) |
| Postman (desktop app) | Berperan sebagai **ERP** | <https://www.postman.com/downloads/> |
| File di repo | `deploy/postman/WMS-ERP-Simulator.postman_collection.json` dan `deploy/postman/WMS-Mini-Server.postman_environment.json` | — |
| Nilai dari `deploy/wms.env` di server | `ERP_CALLBACK_SECRET`, `ERP_SIM_UI_PASSWORD` | Untuk Postman & dashboard simulator |

**Tidak punya scanner barcode?** Tidak masalah. Di layar handheld, setiap kolom scan bisa **diketik**: ketuk kolom *Tembak barcode…*, ketik kodenya, tekan **Enter**. Kalau mau mencoba kamera HP: tombol **Kamera** (butuh HTTPS — sudah ada lewat tunnel); cetak/tampilkan barcode-nya di layar lain memakai generator barcode online (Code128) untuk kode yang ada di panduan ini.

**Tidak punya printer label?** Tombol *Cetak label* akan **mengunduh file `.zpl`** (bahasa printer Zebra). Untuk melihat rupanya: buka file itu dengan editor teks, salin isinya ke <https://labelary.com/viewer.html>. Kode LPN juga bisa dibaca di halaman detail receipt di desktop.

> 💡 Tips handheld: bila setelah pindah langkah ketikan tidak masuk, **ketuk sekali kolom scan** lalu ketik ulang. Tombol akhir **"Tahan untuk konfirmasi"** harus **ditekan dan ditahan ±1 detik** (mencegah salah sentuh).

## 3. Login Pertama & Tur Layar

1. Buka `https://wms.domainanda.com` → **Masuk**: `admin` / `ChangeMe123!`.
2. Sistem memaksa **Ganti password**: isi **Password saat ini** = `ChangeMe123!`, **Password baru** = password pilihan Anda (minimal 10 karakter, ada huruf **dan** angka, mis. `Gudang2026demo`) → tombol **Ganti password**. Setelah berhasil, Anda kembali ke halaman login → masuk dengan password baru. **Catat password ini** — dipakai lagi di Postman (§5).
3. Anda tiba di **Dashboard**. Menu kiri:

| Grup menu | Isi | Dipakai di skenario |
|---|---|---|
| Inbound | Purchase Orders, Receipts, Putaway | A |
| Internal | Transfer, Carton Break, Quarantine / QA | C, K |
| Outbound | Sales Orders, Picking, Deliveries, Scrap / Issue, Scrap Approval | D, E |
| Inventory | Stock on Hand, Handling Units, Traceability, Stock Adjustment | B, F |
| Master Data | Produk, UOM & Packaging, Site & Gudang, Lokasi, Partner, Batch, Reason Code | 4 |
| Konfigurasi | Operation Type, App Settings | J |
| Laporan | Laporan Stok, Movement / Ledger, Laporan Traceability | I |
| Administrasi | User, Role, Hak Akses, Audit Log, Integrasi | G, H |

4. Buka **Konfigurasi → App Settings** sekadar melihat: semua fitur (batch, kedaluwarsa, FEFO, serial, LPN, carton break, karantina) **aktif**, `fefo_policy = warn`. Zona waktu gudang `Asia/Jakarta`. Jangan ubah dulu.
5. Buka **Master Data → Lokasi**: sudah ada `DOCK-01`, `STAGE-01`, `QA-01`, `A-01-01-01`, `A-01-01-02`.

## 4. Master Data: Isi "Kamus" Gudang

Sebelum ada transaksi, WMS harus mengenal mitra, produk, dan rak. Ada dua cara — **disarankan cara 4.A** sekali agar paham, lalu cara 4.B untuk mengulang cepat.

### 4.A Lewat layar (belajar)

Kerjakan **berurutan** (langkah 1 → 5). Cara membaca tabel di bawah: kolom kiri = **label field persis seperti di layar**, kolom kanan = **apa yang diketik/dipilih**. Field yang tidak disebut → biarkan apa adanya.

> Pola umum semua halaman master: klik tombol biru di kanan atas (**Partner baru**, **Produk baru**, **Lokasi baru**, …) → form muncul di atas daftar → isi → **Simpan** → muncul notifikasi hijau kecil di pojok, form tertutup, dan data baru tampil di daftar. Kalau muncul tulisan merah *"Isian belum valid"*, ada field wajib yang kosong/salah format. *"Kode sudah dipakai"* / *"SKU sudah dipakai"* = data itu sudah pernah dibuat (mis. lewat Postman 4.B) — lewati saja.

#### Langkah 1 — Partner (supplier & customer)

*Master Data → Partner* → **Partner baru**. Buat dua kali:

| Field di layar | Partner 1 (supplier) | Partner 2 (customer) |
|---|---|---|
| **Kode (partner_ref ERP)** | `SUP-DEMO` | `CUST-DEMO` |
| **Nama** | `PT Sumber Makmur (Supplier Demo)` | `Toko Sejahtera (Customer Demo)` |
| **Jenis** | `Supplier` | `Customer` |

→ **Simpan**.

> **Kode harus persis** `SUP-DEMO` / `CUST-DEMO` (huruf besar, tanda minus) karena Postman mengirim PO/SO dengan kode ini. Kode partner = "nomor pelanggan/pemasok" di ERP.

> ℹ️ **Min. sisa umur (hari)** — aturan "customer menolak barang yang kedaluwarsa kurang dari N hari lagi" — **belum ada di form layar**, jadi partner yang dibuat lewat layar tidak punya batas ini. Nilai ini hanya dipakai variasi opsional D5. Bila ingin mencobanya, pilih salah satu: (a) buat `CUST-DEMO` **lewat Postman** saja (jangan lewat layar): setelah §5, jalankan dari folder **01** request *Login admin → simpan token* lalu *Partner: customer* (otomatis mengisi 30 hari); atau (b) tetap buat lewat layar, lalu di *Konfigurasi → App Settings* set `default_min_shelf_life_days` = `30` (berlaku untuk semua customer yang tak punya batas sendiri).

#### Langkah 2 — Produk

*Master Data → Produk* → **Produk baru**. Buat tiga produk; isi tiap field seperti tabel ini:

| Field di layar | `AIR-600` | `OBT-500` | `VIT-C` |
|---|---|---|---|
| **SKU** | `AIR-600` | `OBT-500` | `VIT-C` |
| **Nama** | `Air Mineral 600ml` | `Paracetamol 500mg` | `Vitamin C 1000mg` |
| **UOM dasar** | `Pcs` | `Pcs` | `Pcs` |
| **UOM jual** | `Pcs` | `Pcs` | `Pcs` |
| **Level lacak** | `CARTON` | `ITEM` | `ITEM` |
| **Fitur** ☐ batch | kosong | ✔ centang | ✔ centang |
| **Fitur** ☐ expiry | kosong | ✔ centang | ✔ centang |
| **Fitur** ☐ fefo | kosong | ✔ centang | ✔ centang |
| **Fitur** ☐ serial | kosong | kosong | ✔ centang |
| **Fitur** ☑ lpn | ✔ (sudah tercentang, biarkan) | ✔ | ✔ |

→ **Simpan**. Ulangi **Produk baru** untuk produk berikutnya.

Penjelasan tiap field (supaya tahu *kenapa* memilih itu):

| Field | Artinya | Kenapa diisi begitu |
|---|---|---|
| **UOM dasar** | Satuan **terkecil** tempat stok disimpan. Semua angka stok, laporan, dan ledger memakai satuan ini. | Pilih `Pcs` (botol/tablet/strip satuan). **Jangan** pilih `Carton` — karton bukan satuan dasar, karton adalah *kemasan berisi sejumlah Pcs* dan diatur di Langkah 3. |
| **UOM jual** | Satuan yang dipakai saat menjual ke customer (satu produk = satu satuan jual). | Samakan dengan UOM dasar: `Pcs`. Paling aman untuk uji coba; SO dari ERP tetap boleh memesan dalam `Carton` karena konversinya ada di Packaging. |
| **Level lacak** | Sampai level mana barang dilacak. `CARTON` = berhenti di karton. `ITEM` = sampai isi karton (syarat Carton Break). | Air cukup per karton; obat & vitamin perlu dilacak sampai item. |
| **batch / expiry / fefo** | Wajib isi nomor batch & tanggal kedaluwarsa saat barang masuk; `fefo` = yang kedaluwarsa duluan disarankan keluar duluan. | Obat & vitamin punya batch & kedaluwarsa; air mineral tidak (untuk uji coba). |
| **serial** | Tiap karton otomatis diberi nomor seri **Carton S/N** saat diterima. | Hanya `VIT-C`, agar bisa dicoba Carton Break (C3). |
| **lpn** | Barang diterima ditempeli label palet **LPN**. | Biarkan tercentang untuk semua. |

> Opsi dropdown **UOM dasar/UOM jual** berasal dari *Master Data → UOM & Packaging* (`Pcs`, `Box`, `Carton`, `Pallet` sudah ada dari awal). Jika dropdown hanya berisi "—", muat ulang halaman.

> ⚠️ Setelah produk punya stok, **UOM dasar, Level lacak, batch, expiry, serial terkunci** (tidak bisa diubah). Teliti sebelum menerima barang. Salah isi sebelum ada stok? Klik **Ubah** di baris produk.

> Kenapa tiga produk? `AIR-600` = barang biasa (retail). `OBT-500` = obat ber-batch & kedaluwarsa (farmasi, untuk FEFO). `VIT-C` = ber-serial: tiap karton otomatis mendapat **Carton S/N** saat diterima sehingga bisa dipecah (Carton Break) dan dilacak per item.

#### Langkah 3 — Packaging: "1 karton berisi berapa Pcs" + barcode karton

Di sini Anda mengajari WMS bahwa **1 Carton air = 24 Pcs** dan barcode yang tercetak di kardusnya. Tanpa langkah ini, scan barcode karton saat receipt akan ditolak *"Kode tidak dikenal"*.

1. Tetap di *Master Data → Produk*. Di daftar produk, setiap baris punya **tanda panah kecil `›` di ujung paling kiri** (sebelum kolom SKU). Klik panah pada baris `AIR-600` → panah berubah jadi `⌄` dan terbuka panel **Packaging & barcode** di bawah baris itu.
2. Panel berisi tabel yang **sudah punya satu baris otomatis**: `Level 1 · Pcs (base) · Isi (base) 1` — artinya "1 Pcs = 1 Pcs" (satuan dasar). Jangan dihapus.
3. Di bawah tabel ada form satu baris. Isi:

| Field di layar | `AIR-600` | `OBT-500` | `VIT-C` |
|---|---|---|---|
| **UOM** | `Carton` | `Carton` | `Carton` |
| **Level** | `3` (sudah terisi, biarkan) | `3` | `3` |
| **Isi (base)** | `24` | `100` | `12` |
| **Barcode (GTIN)** | `8991000600024` | `8991000500100` | `8991000100012` |

4. Klik **Tambah level** → tabel kini berisi 2 baris: `1 · Pcs (base) · 1` dan `3 · Carton · 24 · 8991000600024`.
5. Klik panah baris `AIR-600` lagi untuk menutup, lalu ulangi langkah 1–4 untuk `OBT-500` dan `VIT-C` dengan nilai kolomnya.

| Field | Artinya |
|---|---|
| **UOM** | Kemasan yang didefinisikan — di sini karton. |
| **Level** | Urutan kemasan dari kecil ke besar: `1` = item (Pcs, otomatis), `2` = inner/Box, `3` = karton, `4` = palet. Karena kita tak memakai Box, karton tetap di level `3`. Satu produk tak boleh punya dua baris dengan level sama. |
| **Isi (base)** | Berapa **UOM dasar (Pcs)** di dalam satu kemasan ini. `24` = 1 karton air berisi 24 botol. |
| **Barcode (GTIN)** | Kode batang yang tercetak di kardus. Saat operator men-scan kode ini, WMS langsung tahu: *produk = AIR-600, satuan = Carton (24 Pcs)*. Untuk uji coba, angka di tabel sudah cukup — tidak perlu barcode sungguhan. |

> Salah ketik barcode? Klik **Ubah barcode** di barisnya. Salah **Isi (base)** atau UOM? Klik **Hapus** pada baris Carton lalu tambah ulang (baris base `Pcs` memang tak bisa dihapus).

#### Langkah 4 — Lokasi (rak tambahan)

*Master Data → Lokasi* → **Lokasi baru**. Buat dua kali:

| Field di layar | Lokasi 1 | Lokasi 2 |
|---|---|---|
| **Gudang** | `WH-MAIN` | `WH-MAIN` |
| **Kode** | `A-02-01-01` | `A-02-01-02` |
| **Tipe** | `STOCK` | `STOCK` |

→ **Simpan**. Daftar kini berisi `DOCK-01`, `STAGE-01`, `QA-01`, `A-01-01-01`, `A-01-01-02`, `A-02-01-01`, `A-02-01-02`.

> **Tipe** menentukan fungsi lokasi: `STOCK` = rak simpan (satu-satunya tipe yang boleh jadi tujuan putaway & sumber picking), `DOCK` = pintu bongkar-muat, `STAGING` = area tunggu kirim, `QUARANTINE` = area karantina (mis. `QA-01`). Lokasi sistem (`VIRT-…`, `IN-TRANSIT`, `SCRAP`…) baru terlihat bila mencentang **Tampilkan lokasi sistem**.

#### Langkah 5 — Akun ERP (agar Postman bisa masuk sebagai ERP)

**5a. Service account** — *Administrasi → User* → **User baru**:

| Field di layar | Isi |
|---|---|
| **Username** | `erp-svc` |
| **Nama lengkap** | `ERP Integration (demo)` |
| **Email** | kosongkan |
| **Gudang default** | biarkan `—` |
| ☐ **Service account (integrasi ERP, tanpa login UI)** | ✔ centang — kolom *Password sementara* otomatis hilang (akun mesin tidak login lewat layar) |
| **Role** | centang **ERP Integration** saja |

→ **Simpan**. Di daftar user, `erp-svc` tampil dengan label `service`.

**5b. API key** — *Administrasi → Integrasi* → klik tab **API key** (di atas, sebelah *Outbox* dan *Rekonsiliasi*) → **API key baru**:

| Field di layar | Isi |
|---|---|
| **Nama** | `postman-demo` (bebas — hanya penanda) |
| **Service account** | `erp-svc (ERP_INTEGRATION)` |

→ **Simpan**.

**5c.** Muncul kotak peringatan *"Simpan key ini sekarang — tidak akan ditampilkan lagi"* berisi teks `wms_…` panjang → klik **Salin** → tempel ke Notepad. Key ini nanti diisi ke variabel `api_key` di Postman (§5). Bila terlewat/hilang: **Cabut** key itu dan buat yang baru.

#### ✅ Cek hasil 4.A

| Menu | Yang harus terlihat |
|---|---|
| Master Data → Partner | `SUP-DEMO` (Supplier), `CUST-DEMO` (Customer), keduanya Aktif |
| Master Data → Produk | 3 produk Aktif; klik panah tiap produk → ada baris `Carton` dengan isi 24 / 100 / 12 dan barcodenya |
| Master Data → Lokasi | `A-02-01-01` dan `A-02-01-02` bertipe STOCK, gudang WH-MAIN |
| Administrasi → User | `erp-svc` (service) role ERP Integration |
| Administrasi → Integrasi → API key | `postman-demo` berstatus Aktif |

### 4.B Lewat Postman (cepat)

Setelah Postman siap (§5), jalankan folder **01 Setup data demo cepat** (klik kanan folder → *Run folder*). Folder ini membuat semua data di atas **dan** mengisi variabel `api_key` otomatis. Aman diulang (data yang sudah ada dilewati).

## 5. Siapkan Postman sebagai ERP

1. Postman → **Import** → pilih kedua file dari `deploy/postman/`.
2. Kanan atas, pilih environment **WMS Mini Server**, lalu klik ikon mata/ *Edit* dan isi kolom **Current value**:

| Variabel | Isi |
|---|---|
| `base_url` | `https://wms.domainanda.com` (tanpa `/` di akhir) |
| `api_key` | key `wms_…` dari §4.A Langkah 5c (kosongkan bila memakai folder 01 — terisi otomatis) |
| `erp_sim_url` | `https://erp-sim.domainanda.com` |
| `erp_sim_user` / `erp_sim_password` | `erp` / nilai `ERP_SIM_UI_PASSWORD` |
| `erp_callback_secret` | nilai `ERP_CALLBACK_SECRET` (untuk folder 60) |
| `admin_user` / `admin_password` | `admin` / password baru Anda (hanya untuk folder 01) |

3. Jalankan folder **00 Cek koneksi** → kedua request harus hijau (HTTP 200, `ready`).

**Isi koleksi:**

| Folder | Peran | Isi |
|---|---|---|
| 00 Cek koneksi | — | health, ready |
| 01 Setup data demo cepat | Admin | partner, 3 produk + packaging, 2 bin, service account, API key |
| 10 Purchase Order | ERP | nomor PO/SO baru, kirim PO, kirim ulang (idempoten), konflik, daftar, detail, PATCH, batal, 4 uji negatif |
| 20 Sales Order | ERP | kirim SO, idempoten, daftar, detail, PATCH, ERP coba buat pick list (ditolak), batal, SO jatuh tempo kemarin, uji negatif |
| 30 Keamanan akses ERP | ERP | key salah, key ERP mencoba membuka data gudang |
| 40 ERP menarik status | ERP | daftar PO/SO per status (rekonsiliasi tarik) |
| 50 ERP simulator | Sisi ERP | lihat callback yang diterima, ubah mode jawaban (normal/500/503/401/timeout/flaky), kosongkan |
| 60 Pelajari tanda tangan callback | Sisi ERP | kirim callback buatan bertanda tangan HMAC: benar, rahasia salah, duplikat |

Tiap request punya **Tests** — tab *Test Results* menunjukkan apa yang diharapkan (hijau = sesuai).

## 6. Skenario A — Barang Masuk

**Cerita:** kantor membeli dari PT Sumber Makmur 10 karton air, 3 karton paracetamol, dan 2 karton vitamin C. Truk datang; gudang menerima, menempel label, dan menaruh barang di rak.

### A1. ERP mengirim PO (Postman)

1. Folder 10 → **Mulai putaran baru: nomor PO & SO baru** → Send. Hasil test menampilkan nomor, mis. `PO-1016-143005 / SO-1016-143005`. Catat.
2. **Kirim PO baru** → Send → `201`. Perhatikan respons: baris 1 `qty: "240"` padahal ERP mengirim `10 Carton` → **WMS menyimpan dalam Pcs (base UOM)**, angka asli ERP tetap disimpan untuk laporan balik.
3. **Kirim ulang PO yang sama** → `200` dengan id sama. *Pelajaran:* bila jaringan ERP putus lalu mengirim ulang, tak terjadi PO ganda (idempoten).
4. **erp_ref sama tapi isi beda** → `409 ERP_REF_CONFLICT`. Mengubah PO harus lewat PATCH.
5. **Ubah PO (PATCH): tambah baris 4** → `200` (48 Pcs air tambahan).
6. **PO kedua** lalu **Batalkan PO kedua** → `CANCELLED`.
7. Jalankan 4 request **Negatif** → semuanya ditolak dengan alasan jelas (`UNKNOWN_PRODUCT`, `UNKNOWN_PARTNER`, `UNKNOWN_UOM`, `400`).

✅ Di desktop: *Inbound → Purchase Orders* → PO baru berstatus **OPEN** dengan 4 baris; PO "-BATAL" berstatus dibatalkan.

### A2. Supervisor membuat Receipt (desktop)

1. *Inbound → Receipts* → **Receipt baru** → isi:

   | Field di layar | Isi |
   |---|---|
   | **Jenis** | `Dari supplier` |
   | **Purchase Order** | pilih baris bertuliskan nomor PO Anda, mis. `PO-1016-143005 · PT Sumber Makmur (Supplier Demo)` (**bukan** yang berakhiran `-BATAL`, dan bukan `— tanpa PO —`) |

   → **Buat**. (Cara lain: *Inbound → Purchase Orders* → buka PO → **Buat receipt**.)
2. Halaman detail `RCV-2026-0000x` (status **Draft**): "Diterima / dipesan **0 / 612**" (240 + 300 + 24 + 48 Pcs).
3. Klik **Siapkan (Ready)** → status **Siap**. Tugas kini muncul di handheld.

### A3. Operator menerima barang (handheld)

Buka `https://wms.domainanda.com/hh` (HP atau tab baru) → **Daftar tugas** → ketuk `RCV-…` → **Mulai**.

| Langkah di layar | Yang Anda lakukan | Penjelasan |
|---|---|---|
| **Scan barang** | ketik `8991000600024` ⏎ | Barcode karton air |
| **Jumlah** (Carton) | isi `10` → **Tambahkan** | "Diterima 240 dari 612" |
| **Scan barang** | `8991000500100` ⏎ | Karton paracetamol |
| **Isi batch & kedaluwarsa** | batch `BT-2701`, tanggal `2027-06-30` → **Simpan batch** | Produk ber-batch wajib diisi |
| **Jumlah** | `2` → **Tambahkan** | |
| **Scan barang** | `8991000500100` ⏎ lagi | Batch kedua (lebih lama kedaluwarsanya) |
| **Jumlah** | ketuk **Isi batch & kedaluwarsa** dulu → `BT-2812`, `2028-12-31` → Simpan → isi `1` → Tambahkan | Sistem mengingat batch terakhir; ganti bila beda |
| **Scan barang** | `8991000100012` ⏎ → batch `VC-2711`, `2027-11-30` → jumlah `2` | Vitamin C berserial |
| — | **Jangan** scan baris 4 (48 Pcs) | Agar PO jadi *sebagian diterima* |
| | ketuk **Selesai scan — terbitkan label** | Sistem menerbitkan LPN (+ Carton S/N untuk vitamin C) |

**Uji penolakan (opsional, sebelum "Selesai scan"):** scan `8991000500100` lagi, isi jumlah `1` → ditolak karena paracetamol sudah diterima penuh 3 karton (*over-receipt*; toleransinya diatur `over_receipt_tolerance_pct`). Jangan memakai air untuk uji ini — baris 4 (48 Pcs air) masih terbuka sehingga 1 karton air tambahan justru diterima. Scan kode asal `TIDAK-ADA` → *kode tidak dikenal*.

### A4. Label & Putaway (handheld)

1. Layar **Cetak label LPN** → **Cetak label (n)** → file `.zpl` terunduh. Kode LPN bisa dilihat juga di desktop: detail receipt → tabel **Unit (LPN)** dan **Baris** (kolom LPN/SN menunjukkan LPN mana berisi apa).
2. Layar **Scan LPN** / **Scan bin tujuan**, ulangi untuk tiap LPN (nomor LPN Anda bisa berbeda — cocokkan isinya dari halaman detail):

| LPN berisi | Scan LPN | Scan bin tujuan |
|---|---|---|
| Air 10 karton | `LPN-000000a` | `A-01-01-01` |
| Paracetamol BT-2701 | `LPN-000000b` | `A-02-01-01` |
| Paracetamol BT-2812 | `LPN-000000c` | `A-02-01-02` |
| Vitamin C (2 karton `SN-…`) | `LPN-000000d` | `A-01-01-02` |

   **Uji penolakan:** saat *Scan bin tujuan*, ketik `DOCK-01` → muncul **"Bin tidak valid (tipe/nonaktif/gudang lain)"** — barang hanya boleh ditaruh di bin bertipe STOCK.
3. Setelah semua di bin, jika layar kembali ke *Cetak label LPN*, tekan **Cetak label** sekali lagi (sistem mensyaratkan label sudah dicetak sebelum konfirmasi).
4. Layar **Konfirmasi** → **tekan & tahan "Tahan untuk konfirmasi"** → **Tugas selesai**.

✅ Yang harus terlihat:

| Di mana | Hasil |
|---|---|
| *Inbound → Purchase Orders* | PO berstatus **Sebagian (PARTIAL)** — baris 4 belum diterima |
| *Inventory → Stock on Hand* | AIR-600 240 Pcs (= 10 Carton) di A-01-01-01; OBT-500 200 @A-02-01-01 (BT-2701) + 100 @A-02-01-02 (BT-2812); VIT-C 24 @A-01-01-02 |
| Dashboard ERP simulator `https://erp-sim.domainanda.com` (±10 dtk) | `RECEIPT_CONFIRMED` + `ORDER_STATUS_CHANGED → PARTIAL`, tanda tangan **valid**; tabel "Buku ERP" menunjukkan PO Anda: diterima 10 / 3 / 2 Carton |
| *Administrasi → Integrasi → Outbox* | dua event berstatus **Terkirim** |

> **Apa yang baru terjadi?** Selama scan, stok belum berubah. Saat Anda menahan tombol konfirmasi, dalam **satu transaksi** sistem: menambah stok di bin, mencatat ledger `VIRT-SUPPLIER → bin`, menaikkan "qty diterima" PO, dan menulis laporan untuk ERP ke *outbox*. Worker lalu mengirim laporan itu ke ERP (simulator) di luar transaksi — bila ERP mati, gudang tetap jalan dan laporan dikirim ulang nanti.

### A5. Variasi receipt (opsional)

- **Receipt tanpa PO** (mis. dari produksi): *Receipts → Receipt baru* → Jenis **Dari produksi**, PO kosong.
- **Batalkan receipt** yang sudah terbit label: buat receipt baru, scan, *Selesai scan*, lalu di desktop **Batalkan** → LPN-nya berstatus **VOID** (tak bisa dipakai), stok tidak bertambah.
- **Dua operator**: login user operator lain (§13) di perangkat kedua, buka tugas yang sedang dikerjakan → terlihat "Dikerjakan {nama}", tak bisa scan.

## 7. Skenario B — Melihat Stok & Menelusuri Barang

| Langkah | Menu | Yang dipelajari |
|---|---|---|
| B1 | *Inventory → Stock on Hand*, cari `OBT` | Stok per bin/batch/status; tampilan multi-satuan (2 Carton = 200 Pcs) |
| B2 | *Inventory → Handling Units* | Daftar LPN & karton beserta isinya; LPN vitamin C berisi 2 karton `SN-…` |
| B3 | *Inventory → Traceability* → ketik LPN paracetamol → **Telusur** | Asal (supplier, PO, receipt), posisi sekarang, jejak ledger |
| B4 | Traceability → ketik `BT-2701` | Penelusuran per batch — penting untuk **recall** produk |
| B5 | *Laporan → Movement / Ledger* | Semua pergerakan, dari mana ke mana, oleh siapa |

## 8. Skenario C — Gerakan di Dalam Gudang

### C1. Transfer antar-rak (ad-hoc, handheld)

*Cerita: rak A-01-01-01 mau dikosongkan; pindahkan palet air ke A-01-01-02.*

1. `/hh` → **Transfer ad-hoc**.
2. Ikuti judul layar: **Scan bin sumber** `A-01-01-01` → scan LPN air → **Scan bin tujuan** `A-01-01-02` → tahan untuk konfirmasi.
3. ✅ Stock on Hand: air kini di A-01-01-02, **total tetap 240**. Movement: satu baris `A-01-01-01 → A-01-01-02`.

> Uji penolakan: tujuan sama dengan sumber → ditolak.

### C2. Transfer berdokumen (desktop → handheld)

1. *Internal → Transfer* → **Transfer baru**. Form punya dua bagian: atas = jenis, bawah = daftar barang yang akan dipindah.

   | Field di layar | Isi |
   |---|---|
   | **Jenis** | `Bin-to-bin` |
   | **Kode unit (LPN / karton / S/N)** | kosongkan (dipakai bila memindah satu palet/karton utuh) |
   | **Bin sumber** | `A-01-01-02` |
   | **SKU** | `AIR-600` |
   | **Qty** | `48` — dalam **UOM dasar (Pcs)**, jadi 48 = 2 karton |
   | **Batch (opsional)** | kosongkan (air tidak ber-batch) |

   → klik **Tambah barang lepas** → baris `AIR-600 · 48 · A-01-01-02` muncul di daftar bawah form (belum tersimpan) → klik **Buat**. Anda dibawa ke halaman detail `TRF-…` berstatus **Draft** → klik **Siapkan (Ready)**.

   > Tombol **Buat** abu-abu selama daftar barang masih kosong — klik **Tambah barang lepas** (atau **Tambah unit**) dulu. Tombol **Tambah baris** di halaman detail dipakai untuk menambah barang lagi ke dokumen Draft.
2. Di handheld, tugas transfer muncul → **Mulai** (48 Pcs air direservasi — cek Stock on Hand: status *Reserved*) → ikuti layar: scan bin sumber, scan barang, isi qty `1` karton saja, lalu **Tutup baris** → sisa 24 Pcs dilepas kembali → scan bin tujuan `A-01-01-01` → tahan konfirmasi.
3. ✅ Detail transfer di desktop menampilkan **Reservasi** per baris; Stock on Hand: 24 Pcs air di A-01-01-01 tanpa LPN (diambil sebagian dari palet), sisanya tetap di LPN di A-01-01-02.

> Saran bin picking di skenario D mengikuti posisi stok terbaru — bisa berbeda dari contoh di panduan; selalu ikuti bin yang disebut layar.

### C3. Carton Break (pecah karton)

*Cerita: toko kecil hanya mau beli satuan vitamin C; satu karton dibuka.*

1. *Internal → Carton Break* (atau `/hh` → **Carton Break**).
2. **Kode karton (Carton S/N)**: salah satu `SN-…` karton vitamin C (lihat Handling Units) → **Cek isi** → tampil "Item yang lahir **12 Pcs**", batch `VC-2711`, lokasi.
3. Centang **Terbitkan Pack S/N per item** → **Pecah karton → 12 item**.
4. ✅ Muncul `CBR-2026-0000x · Selesai` dan "12 S/N terbit (SN-… … SN-…)". Traceability salah satu S/N item → tampil silsilah **Serial → Karton (Dibongkar) → Pallet**, dan ledger `bin → VIRT-TRANSFORM → bin` (total qty tidak berubah).
5. Uji penolakan: pecah karton yang sama lagi → ditolak (karton sudah BROKEN). Coba kode LPN (palet) → ditolak (yang bisa dipecah hanya karton berserial produk tingkat ITEM).

### C4. Quarantine / QA

*Cerita: ada laporan paracetamol batch BT-2812 dicurigai cacat.*

Cari dulu kode LPN paracetamol batch BT-2812: *Inventory → Stock on Hand* → cari `OBT` → baris lokasi `A-02-01-02`, kolom **LPN/SN** (mis. `LPN-0000003`).

1. **Tahan** — *Internal → Quarantine / QA*, isi form di atas:

   | Field di layar | Isi |
   |---|---|
   | **Aksi** | `Tahan (Quarantine)` |
   | **Alasan** | `QA_SUSPECT · Dicurigai cacat / recall` |
   | **Pindah ke bin (opsional)** | `QA-01` (atau kosongkan agar barang tetap di raknya) |
   | **Kode unit (LPN / karton / S/N)** | kode LPN paracetamol BT-2812 → klik **Tambah unit** (kode muncul di daftar bawah) |

   Bagian *Bin sumber / SKU / Qty / Tambah barang lepas* dikosongkan — itu cara lain memilih barang tanpa kode unit. → klik tombol biru **Tahan (Quarantine)** di kanan bawah (nama tombol = aksi yang dipilih).
2. ✅ Muncul notifikasi `QA-2026-… selesai`; tabel **Unit QA** di bawah memuat LPN itu. Stock on Hand: status **Karantina**. Barang ini **tidak akan** disarankan untuk picking.
3. **Lepas** — Aksi `Lepas (Release)` (tanpa alasan) → **Bin tujuan (wajib)** = `A-02-01-02` (bin asalnya; kolom *Saran bin release* di tabel Unit QA menyebutkannya) → **Kode unit** = LPN yang sama → **Tambah unit** → tombol **Lepas (Release)** → status kembali **Tersedia**. (Pintasan: tombol **Lepas (Release)** pada baris tabel Unit QA mengisi form otomatis.)
4. **Tandai rusak** — Aksi `Tandai rusak` → **Alasan** = `QA_REJECT · Ditolak QA` → **Kode unit** = salah satu **Pack S/N item** vitamin C hasil C3 (mis. `SN-0000005`, lihat notifikasi C3 atau *Handling Units*) → **Tambah unit** → tombol **Tandai rusak** → status **Rusak** (dipakai di skenario E — catat S/N-nya).
5. Bisa juga dari handheld: `/hh` → **Quarantine / QA**.

## 9. Skenario D — Barang Keluar

**Cerita:** Toko Sejahtera memesan 4 karton air dan 150 Pcs paracetamol.

### D1. ERP mengirim SO (Postman)

Folder 20 → **Kirim SO baru** → `201` status `RECEIVED`. Coba **Kirim ulang** (idempoten), **PATCH** tanggal kirim, **ERP mencoba membuat pick list → 403** (keputusan mengambil barang ada di gudang, bukan di ERP), **SO kedua → Batalkan** (callback `CANCELLED` ke simulator), **SO jatuh tempo kemarin** (dipakai di skenario G).

### D2. Supervisor membuat pick list (desktop)

1. *Outbound → Sales Orders* → baris SO Anda → **Buat pick list**.
2. Terbuka `DLV-2026-0000x` status **Siap**, tabel **Saran ambil**: paracetamol dari batch **BT-2701** (kedaluwarsa paling dekat = FEFO), air dari bin tempatnya.
3. Pelajari: qty pick list **dibatasi stok tersedia**. Coba **Buat pick list** lagi untuk SO yang sama → ditolak *stok sudah dijanjikan* (`INSUFFICIENT_STOCK`).

### D3. Picking (handheld)

`/hh` → tugas `DLV-…` → **Mulai** (saat ini stok direservasi — lihat Stock on Hand: status **Reserved**).

| Layar | Aksi |
|---|---|
| Scan bin sumber (layar menyebut bin saran air) | ketik bin yang disebut |
| Scan barang | `8991000600024` → Jumlah (Carton) sesuai *sisa* (mis. `4`, atau `1` bila bin itu hanya berisi 24 Pcs) → Tambahkan; bila sisa masih ada, layar meminta bin berikutnya |
| Scan bin sumber (baris paracetamol) | **Uji FEFO**: ketik bin batch BT-2812 (`A-02-01-02`) lalu scan `8991000500100` → muncul dialog **"Bukan batch saran FEFO"** → pilih **Batal — ambil batch saran** |
| | ketik bin saran (`A-02-01-01`) → scan `8991000500100` → Jumlah `1` (= 100 Pcs) → Tambahkan |
| sisa 50 Pcs | ketuk **Tutup baris** → konfirmasi "Sisa 50 dilepas kembali ke stok" | 
| Scan staging | `STAGE-01` |
| Scan dock | `DOCK-01` |
| Konfirmasi | tahan **Tahan untuk konfirmasi** → **Tugas selesai** |

> Alternatif pada dialog FEFO: pilih alasan (`FEFO_NEAR_BIN` / `FEFO_DAMAGED`) → batch tak sesuai saran **diterima dan dicatat** (kebijakan `warn`). Di skenario J kita ubah menjadi `block` (ditolak keras).

> Jumlah boleh desimal dalam satuan karton: `0.5` Carton = 50 Pcs.

✅ Yang harus terlihat:

| Di mana | Hasil |
|---|---|
| Sales Orders | SO **Sebagian** (246 dipesan, 196 terkirim) |
| Stock on Hand | air berkurang 96; paracetamol BT-2701 sisa 100, status kembali Available |
| *Outbound → Deliveries* → filter riwayat → **Cetak surat jalan** | Surat jalan: customer, baris, batch |
| ERP simulator | `SHIPMENT_CONFIRMED` (4 Carton air, 100 Pcs batch BT-2701) + `ORDER_STATUS_CHANGED → PARTIAL` |

### D4. Pick list lanjutan (sisa 50 Pcs)

*Sales Orders* → SO yang sama → **Buat pick list** lagi → qty 50 → picking dengan Jumlah `0.5` Carton → staging → dock → konfirmasi. ✅ SO menjadi **Selesai (DONE)**; simulator menerima `ORDER_STATUS_CHANGED → DONE`.

### D5. Variasi outbound

- **Batalkan pick list di tengah jalan:** buat pick list, Mulai di handheld, scan sebagian, lalu di desktop *Picking → detail → Batalkan* → reservasi kembali **persis** (cek Stock on Hand).
- **Serah terima picker → petugas delivery:** login sebagai user yang hanya punya hak Picking (atur di Hak Akses) → setelah *Scan dock* ia melihat "Anda tidak berhak konfirmasi — serahkan ke petugas yang berhak"; user dengan hak Deliveries mengonfirmasi dari *Outbound → Deliveries* (**Kirim**).
- **Barang kedaluwarsa / sisa umur pendek:** terima paracetamol batch baru dengan kedaluwarsa 10 hari lagi, buat SO untuk `CUST-DEMO` (min. 30 hari) → batch itu tidak disarankan / ditolak. *Butuh batas 30 hari terpasang — lihat catatan di §4.A Langkah 1.*
- **Rebutan stok:** dua pick list untuk stok yang sama, dua operator menekan **Mulai** bersamaan → hanya yang muat yang berhasil, tidak ada stok minus.

## 10. Skenario E — Scrap dengan Persetujuan

*Cerita: 1 item vitamin C rusak (sudah Damaged di C4) harus dibuang. Pembuat dokumen tidak boleh menyetujui sendiri.*

1. Buat dua user `op1` (role Operator) dan `spv1` (role Supervisor) — isian field-nya ada di §13 H1 (jangan lupa **Gudang default** `WH-MAIN`). Login pertama masing-masing wajib ganti password.
2. Login `op1` (jendela incognito agar sesi admin tidak tertimpa) → *Outbound → Scrap / Issue* → **Dokumen baru**:

   | Field di layar | Isi |
   |---|---|
   | **Jenis** | `Scrap / rusak` |
   | **Alasan** | `DMG_HANDLING · Rusak saat handling` |
   | **Catatan** | opsional, mis. `Botol pecah saat dipindah` |
   | **Kode unit (LPN / karton / S/N)** | S/N item vitamin C yang ditandai rusak di C4 → **Tambah unit** |

   (Alternatif tanpa kode unit: isi **Bin sumber** + **SKU** + **Qty** (Pcs) → **Tambah barang lepas**.) → **Buat** → halaman detail `SCR-…` (Draft) → **Siapkan (Ready)**.
3. `op1` mengerjakan di handheld (tugas scrap): Mulai → scan → layar berhenti di **Menunggu approval**.
4. Masih sebagai `op1`, coba setujui → tidak bisa (menu Scrap Approval tak ada / ditolak `SELF_APPROVAL`).
5. Login `spv1` → *Outbound → Scrap Approval* → **Setujui**.
6. Kembali ke handheld/desktop → **Keluarkan stok** / konfirmasi → ✅ stok berkurang, ledger `bin → SCRAP` beralasan `DMG_HANDLING`, approver tercatat.
7. Variasi: **Issue ke produksi** (`OUT_ISSUE_PROD`, alasan `PROD_ISSUE`) — tanpa approval.

## 11. Skenario F — Stock Adjustment

*Cerita: hitung fisik rak A-02-01-02 menemukan paracetamol 98, sistem bilang 100.*

**F1. Dari desktop** — *Inventory → Stock Adjustment* (login `admin` atau user role Inventory Controller):

| Field di layar | Isi |
|---|---|
| **Sasaran** | `Barang lepas (lokasi + SKU)` |
| **SKU** | `OBT-500` |
| **Batch (bila produk ber-batch)** | `BT-2812` |
| **Lokasi** | `A-02-01-02` (bin tempat BT-2812 berada setelah C4) |
| **Status** | `Tersedia` |
| **Cara isi** | `Hitungan fisik` |
| **Jumlah hasil hitung** | `98` — dalam **Pcs** (UOM dasar), bukan karton |
| **Alasan** | `COUNT_LOSS · Selisih hitung (kurang)` |
| **Catatan** | opsional, mis. `Stock opname Oktober` |

1. Klik **Pratinjau** → muncul ringkasan *Stok sistem 100 · selisih −2 → 98*. Belum ada yang berubah.
2. Klik **Posting**. ✅ Stok = 98; *Riwayat adjustment* bertambah `ADJ-…`; simulator menerima `ADJUSTMENT_POSTED`.

> Variasi: **Sasaran** = `Unit ber-kode (LPN / karton / serial)` → **Kode unit** = kode LPN paracetamol BT-2812 (SKU/batch tak perlu diisi). **Cara isi** = `Selisih (+/−)` → **Selisih** = `-2` (hasilnya sama).

**F2. Dari handheld** — `/hh` → **Stock Adjustment**: scan bin → scan barang → isi hitungan → pratinjau selisih → pilih alasan → tahan konfirmasi.

**Uji penolakan:**
- Hitungan sama dengan sistem → ditolak *tidak ada perubahan* (`NO_CHANGE`).
- Selisih (−) melebihi stok → `NEGATIVE_STOCK`.
- Mengurangi stok yang sedang direservasi pick list lain → "tertahan operasi lain" (`UNIT_RESERVED`).

## 12. Skenario G — Integrasi ERP

Buka dashboard simulator `https://erp-sim.domainanda.com` di satu tab, dan *Administrasi → Integrasi* di tab lain.

### G1. Memahami callback

Di dashboard simulator, klik **lihat** pada satu baris → isi JSON yang dikirim WMS. Perhatikan kolom **Percobaan**, **Tanda tangan** (valid = dikirim oleh WMS asli, bukan pihak lain), dan tabel **Buku ERP** (keadaan PO/SO menurut ERP). Bandingkan dengan Purchase Orders / Sales Orders di WMS — harus cocok.

| Event | Kapan dikirim |
|---|---|
| `RECEIPT_CONFIRMED` | receipt selesai — qty per baris + satuan ERP |
| `SHIPMENT_CONFIRMED` | delivery selesai — qty + batch yang dikirim |
| `ORDER_STATUS_CHANGED` | PO → PARTIAL/CLOSED; SO → PARTIAL/DONE/CANCELLED |
| `ADJUSTMENT_POSTED` | stock adjustment diposting |

### G2. ERP error → WMS mencoba ulang

1. Simulator: **Jawaban ERP = Error 500** → **Terapkan** (atau Postman folder 50 *Mode: error 500*).
2. Lakukan sesuatu yang memicu callback, mis. Postman folder 20 *SO kedua* + *Batalkan*, atau satu stock adjustment.
3. ✅ Integrasi → Outbox: event **Gagal**, *Percobaan 1*, *Coba berikutnya* ±30 dtk. Simulator mencatat jawaban `500`. **Operasi gudang tetap selesai normal** — gangguan ERP tidak menghentikan gudang.
4. Kembalikan **Normal — jawab 200** → tunggu ±30 dtk → event **Terkirim** (percobaan 2). Simulator menunjukkan percobaan 1 = 500, percobaan 2 = 200.

### G3. ERP maintenance (503) & lambat (timeout)

- Mode **Tidak tersedia 503**: worker menganggap ERP sedang tak melayani → mencatat satu percobaan lalu **berhenti memutar antrean** sampai giliran berikutnya (antrean lain tidak dihabiskan percobaannya).
- Mode **Lambat — 15 dtk**: WMS memutus setelah 10 dtk (`timeout 10000 ms` di *last error*), lalu mencoba ulang. Perhatikan simulator tetap mencatat kedatangan — di dunia nyata inilah alasan ERP **wajib dedupe** pada `X-Event-Id`.
- Mode **Tidak stabil 50%**: picu beberapa event; semua akhirnya Terkirim, dengan urutan per order tetap terjaga.

### G4. Event "Mati" (DEAD) & Retry semua

Agar cepat, di server set `OUTBOX_MAX_ATTEMPTS=2` di `deploy/wms.env` → `wms up -d`. Mode simulator **Error 500** → picu satu event → setelah 2 percobaan (±1 menit) status **Mati** + log worker `alert: OUTBOX_DEAD`. Tab **Rekonsiliasi** memuat *Callback mati*. Kembalikan mode Normal → **Retry semua yang Mati** → Terkirim. Kembalikan `OUTBOX_MAX_ATTEMPTS=10`.

### G5. Tanda tangan salah

- Postman folder 60 → *Rahasia salah* → `401`, simulator mencatat "tanda tangan tidak cocok".
- Dari sisi WMS: mode simulator **Tolak 401** meniru ERP yang menolak kredensial → event Gagal dengan `HTTP 401` dan dicoba ulang. (Di compose ini WMS dan simulator membaca rahasia dari file env yang sama, jadi rahasia yang benar-benar berbeda disimulasikan lewat Postman di atas.)
- Opsional header Authorization: isi `ERP_SIM_EXPECT_AUTHORIZATION=Bearer token-erp-demo` dan `ERP_CALLBACK_AUTH_HEADER=Authorization: Bearer token-erp-demo` → `wms up -d` → callback tetap diterima; kosongkan salah satunya → 401.

### G6. Duplikat & idempotensi ERP

Postman folder 60 → *Kirim event yang sama dua kali* → jalankan 2× → kedua jawaban 200, tetapi simulator menandai yang kedua **duplikat** dan Buku ERP tidak berubah. Ini kewajiban ERP sungguhan nanti.

### G7. Rekonsiliasi

*Integrasi → Rekonsiliasi*: memuat **SO lewat jatuh tempo** (SO "-TELAT" dari Postman), **PO lewat jatuh tempo** (bila ada PO dengan `expected_date` lampau yang belum diterima penuh), dan callback gagal/mati/macet. Postman folder 40 menunjukkan sisi lain: ERP **menarik** status PO/SO kapan saja.

### G8. Keamanan API key

Postman folder 30: key salah → `401`; key ERP membuka data receipt/stok → `403`. Di *Integrasi → API key* coba **Cabut** key → request Postman berikutnya `401`. Terbitkan key baru untuk melanjutkan.

## 13. Skenario H — User, Peran, dan Hak Akses

**H1. Buat user per peran** — *Administrasi → User* → **User baru**, isi per user:

| Field di layar | Isi |
|---|---|
| **Username** | `spv1` / `op1` / `ic1` / `aud1` (lihat tabel bawah) |
| **Nama lengkap** | bebas, mis. `Supervisor Satu` |
| **Email** | boleh kosong |
| **Gudang default** | `WH-MAIN · …` — **wajib** untuk user gudang; handheld, Carton Break, QA, dan penerimaan antar-gudang bekerja di gudang default user |
| ☐ **Service account** | **jangan** dicentang (ini user manusia) |
| **Password sementara** | mis. `Sementara123` (min. 10 karakter, huruf + angka) — sampaikan ke pemilik akun; saat login pertama ia wajib menggantinya |
| **Role** | centang satu role sesuai tabel bawah |

→ **Simpan**.

| Username | Role (centang) | Bisa apa |
|---|---|---|
| `spv1` | Supervisor | Jalankan & pantau operasi, setujui scrap, laporan |
| `op1` | Operator | Kerja di handheld: inbound/internal/outbound |
| `ic1` | Inventory Controller | Master data, stock adjustment |
| `aud1` | Auditor | Hanya lihat semua modul |

> Aksi lain per user (Kunci, Nonaktifkan, Reset password, Cabut semua sesi, ubah role) ada di panel yang terbuka saat **username** di daftar diklik.

**H2. Uji hak akses:**

1. Login `op1` (browser lain / jendela incognito) → menu yang tampil lebih sedikit. Ketik langsung URL `https://wms.domainanda.com/admin/users` → **Akses ditolak**.
2. Login `aud1` → semua bisa dilihat, tombol simpan/aksi tidak ada atau ditolak.
3. *Administrasi → Hak Akses* → dropdown **Pilih role** = `Operator` → muncul matriks menu × kolom **Lihat / Buat / Ubah / Hapus** → pada baris **Stock on Hand** hilangkan centang **Lihat** → di bawah muncul *"1 perubahan belum disimpan"* → **Simpan** → `op1` muat ulang: menu Stock on Hand hilang. Kembalikan centangnya → **Simpan**.
4. **Kunci akun saat sedang bekerja:** `op1` membuka tugas di handheld; admin *Administrasi → User* → klik username `op1` → **Kunci** → aksi berikutnya `op1` langsung ditolak. Klik **Buka kunci**.
5. **Pengaman admin:** sebagai `admin`, coba kunci/nonaktifkan akun Anda sendiri → ditolak (`SELF_ACTION`); perubahan yang menyisakan nol administrator aktif ditolak (`LAST_ADMIN`).
6. Login gagal 5× dengan password salah → akun terkunci 15 menit (`login_max_failed_attempts`, `lockout_minutes`).
7. *User → Reset password*, *Cabut semua sesi* → user dipaksa login ulang.
8. *Administrasi → Role* → **Role baru**: **Kode** `CHECKER` (huruf besar, tak bisa diubah nanti), **Nama** `Checker`, **Deskripsi** `Cek barang masuk` → **Simpan**. Lalu *Hak Akses* → **Pilih role** `Checker` → centang **Lihat** pada Receipts & Stock on Hand → **Simpan**. Berikan ke user: *User* → klik username → centang role **Checker** → **Simpan role**.

## 14. Skenario I — Laporan, Audit, Dashboard

| Langkah | Menu | Yang dicek |
|---|---|---|
| I1 | Dashboard | Receipt/delivery selesai hari ini, order terbuka, batch mendekati kedaluwarsa, outbox ERP |
| I2 | *Laporan → Laporan Stok* (+ tab In-Transit) | Stok per produk/lokasi/batch/status |
| I3 | *Laporan → Movement / Ledger*, filter tanggal hari ini | Semua transaksi uji coba ada |
| I4 | Tombol **Export** (CSV/XLSX) di laporan | "Laporan sedang disiapkan…" → **Unduh** (dikerjakan worker; file kedaluwarsa 24 jam) |
| I5 | *Laporan → Laporan Traceability* | Sama dengan Traceability, dalam bentuk laporan + export |
| I6 | *Administrasi → Audit Log* | Siapa mengubah setting, membuat user, mengonfirmasi operasi, melewati FEFO — lengkap dengan waktu & nilai sebelum/sesudah |

## 15. Skenario J — Konfigurasi

> Cara mengubah setting: *Konfigurasi → App Settings* → setting dikelompokkan per kartu (*Fitur*, *Kebijakan stok*, …). Tiap baris = satu setting dengan dropdown/kolom isian dan tombol **Simpan** sendiri di ujung kanannya. Ubah nilainya lalu klik **Simpan** pada baris itu (bukan tombol lain). Flag on/off tampil sebagai `Aktif` / `Nonaktif`.

**J1. Kebijakan FEFO keras** — baris `fefo_policy` (kartu *Kebijakan stok*) → pilih `block` → **Simpan** → ulangi uji FEFO di D3 → batch bukan saran **ditolak** (tanpa pilihan alasan). Kembalikan ke `warn` → **Simpan**.

**J2. Flag terkunci setelah ada stok** — coba matikan `enable_batch` → ditolak `LOCKED_AFTER_STOCK` (data ber-batch tidak boleh jadi yatim).

**J3. Ketergantungan setting** — nyalakan `qa_on_receipt` saat `enable_quarantine` mati → ditolak `SETTING_DEPENDENCY` (mematikan `enable_quarantine` sendiri ditolak selama masih ada stok berstatus Quarantine). Dengan `qa_on_receipt = true`, barang yang diterima otomatis berstatus **Quarantine** dan harus di-*release* sebelum bisa dijual.

**J4. Operation type turunan** — *Konfigurasi → Operation Type* → **Tipe turunan**:

| Field di layar | Isi |
|---|---|
| **Template** | `RCV_SUPPLIER · Receipt from Supplier` (hanya keluarga receipt & scrap/issue yang bisa diturunkan) |
| **Kode** | `RCV_CONSIGNMENT` (huruf besar/angka/underscore, 3–50 karakter) |
| **Nama** | `Receipt from Consignment` |

→ **Simpan** → baris baru berlabel **Turunan** muncul di daftar, mewarisi lokasi/status/aturan alasan & approval dari templatenya (lihat kolom *Wajib alasan* / *Wajib approval*). Tipe baru tersedia sebagai jenis dokumen di menu terkait.

**J5. Profil industri (instalasi segar)** — satu basis kode jadi WMS retail/farmasi/F&B/manufaktur hanya lewat setting. Di server (setelah [§8.1 deploy: ulang dari nol](panduan-deploy-mini-server.md#81-mengulang-uji-coba-dari-nol) dan ganti password admin):

```bash
BASE=https://wms.domainanda.com ADMIN_USER=admin ADMIN_PASSWORD='<password-baru>' bash scripts/apply-profile.sh retail
```

✅ Menu Batch & Quarantine hilang, receipt tidak meminta batch, picking tanpa FEFO. Ulangi dengan `farmasi` (semua ketat, scrap wajib approval). *Skrip butuh `node` dan `curl` di mesin yang menjalankannya — boleh dari laptop.*

**J6. Zona waktu & format kode** — *App Settings* grup *Gudang* (zona waktu) & *Format kode* (`ref_no_format`, `lpn_code_format`) — perubahan tercatat di Audit Log.

## 16. Skenario K — Multi-gudang

*Lanjutan; lakukan setelah skenario lain.*

1. *App Settings* → baris `enable_multi_site` (kartu *Fitur*) → `Aktif` → **Simpan**.
2. *Master Data → Site & Gudang*:
   - **Site baru** → **Kode site** `CAB-BDG`, **Nama** `Cabang Bandung`, **Alamat** opsional → **Simpan**.
   - Pada kartu site `CAB-BDG` yang baru muncul, klik **Gudang baru** → **Kode gudang** `WH-BDG`, **Nama** `Gudang Bandung`, **Zona waktu** `Asia/Jakarta` → **Simpan**.
   - *Master Data → Lokasi* → **Lokasi baru** → **Gudang** `WH-BDG`, **Kode** `B-01-01-01`, **Tipe** `STOCK` → **Simpan**.
3. *Internal → Transfer* → **Transfer baru**:

   | Field di layar | Isi |
   |---|---|
   | **Jenis** | `Antar-gudang (dispatch)` |
   | **Gudang tujuan** | `WH-BDG · Gudang Bandung` |
   | **Kode unit (LPN / karton / S/N)** | kode LPN air (lihat Stock on Hand, kolom LPN/SN) → **Tambah unit** |

   → **Buat** → **Siapkan (Ready)** → kerjakan di handheld (ikuti judul layar) → tahan konfirmasi. ✅ Barang ada di **IN-TRANSIT**; *Laporan Stok → tab In-Transit* menampilkan sisa & umur kiriman.
4. Penerimaan di gudang tujuan dikerjakan user yang **gudang default-nya `WH-BDG`**. Gudang default tidak bisa diubah setelah user dibuat, jadi buat user baru: *Administrasi → User* → **User baru** → **Username** `op-bdg`, **Gudang default** `WH-BDG · Gudang Bandung`, **Password sementara** `Sementara123`, **Role** centang `Operator` → **Simpan**. Login sebagai `op-bdg` (ganti password) → detail transfer → **Buat operasi terima** → handheld `op-bdg`: scan unit → scan bin `B-01-01-01` → tahan konfirmasi.
5. Variasi **barang hilang di jalan**: terima sebagian, sisanya *Laporan In-Transit → Catat kehilangan* (adjustment `TRANSIT_LOSS`).

## 17. Skenario L — Kesehatan Sistem

Di server (alias `wms` dari panduan deploy):

| Cek | Perintah | Hasil benar |
|---|---|---|
| Integritas stok: angka stok = jumlah semua pergerakan ledger | `wms run --rm worker pnpm db:integrity` | `D-2 selisih=0 … → OK` |
| Backup | `BACKUP_DIR=~/wms-backups PG_DOCKER=wms-postgres-1 bash scripts/backup.sh` | `backup OK: …` |
| Uji restore | lihat panduan deploy §8 | `restore drill OK` |
| Health | `curl -s https://wms.domainanda.com/api/ready` | `ready` |

**Tes "online-only" handheld:** di HP, matikan Wi-Fi/data saat di layar tugas → muncul banner **"Tidak ada koneksi — aksi dikunci sampai online"**; nyalakan lagi → lanjut tanpa scan ganda.

## 18. Simulasi ERP: Cara Kerja & Alternatif

### 18.1 Arah ERP → WMS (pesanan masuk) = Postman

Postman memegang peran ERP: memanggil REST API WMS dengan header `X-API-Key`. Ini persis yang nanti dilakukan ERP sungguhan; kontraknya di [`erp-integration-wms-baseline.md`](erp-integration-wms-baseline.md) §4–§5. Postman juga bisa menjalankan seluruh folder sebagai uji regresi (*Run collection*), atau dari terminal:

```bash
npx newman run deploy/postman/WMS-ERP-Simulator.postman_collection.json -e deploy/postman/WMS-Mini-Server.postman_environment.json
```

### 18.2 Arah WMS → ERP (laporan keluar) = ERP Simulator

Masalahnya: WMS yang **memanggil** ERP, jadi harus ada "sesuatu" yang menerima di sebuah URL. Solusi terpasang: container **`erp-sim`** ([`deploy/erp-simulator/server.mjs`](../deploy/erp-simulator/server.mjs)).

```
operasi Done ──(transaksi sama)──► tabel integration_event (outbox, PENDING)
                                        │ worker tiap 10 dtk
                                        ▼
        POST http://erp-sim:4482/erp/callback
        X-Event-Id · X-Event-Type · X-WMS-Attempt · X-WMS-Timestamp
        X-WMS-Signature: sha256=HMAC(ERP_CALLBACK_SECRET, "<timestamp>.<body>")
                                        │
              erp-sim: verifikasi tanda tangan & umur timestamp (≤ 5 menit)
                       dedupe X-Event-Id → catat → "Buku ERP"
                       jawab sesuai mode (200 / 500 / 503 / 401 / timeout / flaky)
                                        │
        2xx → SENT   ·   lainnya → FAILED, coba lagi 30 dtk × 2^(n−1) (maks 1 jam)  →  DEAD setelah N kali
```

Kenapa cara ini dipilih:

| Kebutuhan uji | Dipenuhi oleh erp-sim |
|---|---|
| Data tidak keluar dari server | Callback lewat jaringan Docker internal |
| Membuktikan tanda tangan HMAC benar | Diverifikasi dengan rahasia yang sama |
| Melatih kegagalan ERP (retry, DEAD, rekonsiliasi) | Mode jawaban bisa diganti dari dashboard / Postman |
| Membuktikan "Done ⇒ ERP pasti menerima" & tanpa duplikat | Buku ERP hanya berubah sekali per `X-Event-Id` |
| Contoh kode untuk tim ERP nanti | `server.mjs` = referensi penerima yang benar (verifikasi, dedupe, jawab cepat) |

### 18.3 Alternatif lain (bila perlu)

| Alternatif | Cara | Kelebihan | Kekurangan |
|---|---|---|---|
| **webhook.site** / Beeceptor / RequestBin | `ERP_CALLBACK_URL=https://webhook.site/<uuid>` → `wms up -d` | Tanpa instalasi, tampilan header lengkap | Data uji keluar ke pihak ketiga; tak memverifikasi tanda tangan; tak bisa memaksa gagal |
| **Postman Mock Server** | Buat mock dengan respons 200 untuk `POST /erp/callback`; isi URL mock ke `ERP_CALLBACK_URL` | Semua di Postman | Mock tidak menyimpan "buku"; verifikasi HMAC manual |
| **`scripts/erp-stub.mjs`** (versi minimal tanpa UI) | Dipakai smoke test M5 & uji beban | Ringan | Hanya `127.0.0.1`, tanpa dashboard |
| **ERP sandbox sungguhan** | Ganti `ERP_CALLBACK_URL` + `ERP_CALLBACK_SECRET` (+ `ERP_CALLBACK_AUTH_HEADER`) | Uji integrasi nyata | Butuh tim ERP mengimplementasikan penerima sesuai erp-integration §6.1 |

**Saat ERP sungguhan siap:** (1) tim ERP membuat endpoint penerima yang meniru perilaku `server.mjs` (verifikasi HMAC atas body mentah, tolak timestamp > 5 menit, idempoten pada `X-Event-Id`, jawab 2xx cepat, abaikan status yang lebih tua menurut `occurred_at`); (2) ERP memakai API key dari *Integrasi → API key* untuk mengirim PO/SO; (3) ganti `ERP_CALLBACK_URL` → `wms up -d`; (4) putuskan apakah event lama yang menumpuk ikut dikirim (runbook §5).

## 19. Checklist Cakupan Fitur

Centang setelah dicoba.

| Modul | Fitur | Skenario | ✔ |
|---|---|---|---|
| Integrasi masuk | PO ingest, idempoten, konflik, PATCH, cancel, validasi master | A1 | ☐ |
| | SO ingest, idempoten, PATCH, cancel, ERP dilarang membuat pick list | D1 | ☐ |
| Inbound | Receipt dari PO, batch & kedaluwarsa, over-receipt ditolak | A2–A3 | ☐ |
| | Label LPN/ZPL, Carton S/N, putaway, validasi bin, konfirmasi tahan | A4 | ☐ |
| | Receipt tanpa PO, batal receipt (VOID), klaim tugas dua operator | A5 | ☐ |
| Inventory | Stock on Hand, Handling Units, Traceability (LPN, batch, serial) | B | ☐ |
| Internal | Transfer ad-hoc & berdokumen, tutup baris | C1–C2 | ☐ |
| | Carton Break + Pack S/N, silsilah serial | C3 | ☐ |
| | Quarantine hold/release/rusak | C4 | ☐ |
| Outbound | Pick list dibatasi stok, saran FEFO, reservasi | D2 | ☐ |
| | Picking, FEFO warn/ack, tutup baris parsial, staging, dock, delivery, surat jalan | D3 | ☐ |
| | Pick list lanjutan, SO DONE, batal pick list, serah terima, rebutan stok | D4–D5 | ☐ |
| | Scrap + approval (anti self-approval), issue ke produksi | E | ☐ |
| Adjustment | Hitungan fisik / delta, pratinjau, penolakan, handheld | F | ☐ |
| Integrasi keluar | 4 jenis callback, tanda tangan, retry, 503, timeout, DEAD + retry semua, duplikat, rekonsiliasi, cabut API key | G | ☐ |
| Admin | User per peran, RBAC per URL, matriks hak akses, kunci user seketika, LAST_ADMIN, lockout login, reset, cabut sesi, role baru | H | ☐ |
| Laporan | Dashboard, laporan stok/movement/in-transit/traceability, export CSV/XLSX, audit log | I | ☐ |
| Konfigurasi | FEFO block, flag terkunci, dependensi, operation type turunan, profil industri, zona waktu & format kode | J | ☐ |
| Multi-gudang | Dispatch → IN-TRANSIT → receive, transit loss | K | ☐ |
| Operasi | Integritas D-2, backup, restore drill, health/ready, handheld offline | L | ☐ |

---

## Ringkasan Keputusan (uji coba)

1. Uji coba disusun sebagai satu cerita berurutan (master data → masuk → simpan/gerak → keluar → koreksi → integrasi → admin → konfigurasi) dengan angka yang bisa dicocokkan di Stock on Hand dan Buku ERP.
2. Peran ERP dimainkan dua alat: **Postman** (ERP → WMS, API key) dan **ERP simulator** di Docker (WMS → ERP, callback bertanda tangan HMAC) — tanpa data keluar dari server dan dengan mode gagal yang bisa diatur.
3. Tanpa scanner/printer: semua kode bisa diketik di handheld; label `.zpl` dilihat lewat viewer Labelary; kamera HP bisa dipakai karena akses lewat HTTPS.
4. Checklist §19 memetakan seluruh fitur M1–M5 ke skenario; skenario formal untuk klien tetap `uat-wms-baseline.md`.
5. Form desktop ditulis per field dengan **label persis seperti di layar** dan nilai yang harus diisi (v1.1). Batas UI yang diketahui dicatat beserta jalan keluarnya: sisa umur min. customer tidak ada di form Partner (pakai Postman atau `default_min_shelf_life_days`), gudang default user tidak bisa diubah setelah dibuat (buat user baru).
