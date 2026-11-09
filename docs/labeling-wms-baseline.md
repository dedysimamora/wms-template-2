# Labeling & Barcode — WMS Baseline

**Spesifikasi label & barcode (LPN, carton, serial, bin) + alur cetak ZPL**

Versi: 1.1 · 24 September 2026 · Pembaruan: escape field ZPL (`^FH`) + UTF-8 (`^CI28`), template pallet campuran, cetak lewat print service (bukan langsung dari browser), audit cetak ulang, label berstatus PENDING.

> Topik: simbologi, apa yang di-encode, alur cetak Zebra, template ZPL. Terkait: flag `enable_lpn`, setting `label_dpi`/`lpn_code_format`/`serial_code_format`, endpoint `.../print-lpn` (api-design §5.3).

---

## 1. Simbologi & jenis label

| Label | Kapan | Simbologi (fase 1) |
|---|---|---|
| **LPN pallet** | Setelah receipt (bila `enable_lpn`) | Code128 |
| **Carton** | Bila karton butuh identitas scan | Code128 |
| **Pack S/N (item)** | `track_level=ITEM` & `enable_serial` | Code128 atau DataMatrix (padat) |
| **Bin/lokasi** | Setup gudang | Code128 |

GS1 (SSCC/GS1-128, DataMatrix GS1) = fase 2 (SC-7), untuk serialisasi/ekspor farmasi.

## 2. Apa yang di-encode

- **Fase 1: hanya identifier** (mis. `LPN-0000007`, `SN-0000123`, kode bin `A-01-01-01`). Scanner membaca kode → WMS lookup detail (batch/expiry/produk) dari DB. Sederhana, tak ada data usang tercetak di barcode.
- Fase 2 GS1: encode komposit (GTIN + batch + expiry + serial) sesuai regulasi.

## 3. Alur cetak

```
WMS API (POST .../print-lpn) ──► payload ZPL (atau PDF) — hanya setelah submit (HU berstatus PENDING/INTACT)
Klien ──► print service (label_print_service_url: Zebra Browser Print / agen cetak di LAN) ──► printer Zebra (TCP 9100)
          atau unduh PDF bila tak ada print service
```
- Browser **tidak** bisa membuka socket TCP 9100 langsung; jalur resmi = print service lokal. Alternatif server-side (worker mengirim ke IP printer) = fase 2 bila jaringan mengizinkan.
- Format & DPI dari `app_setting` (`label_dpi`) atau per-warehouse (fase 2). Payload ZPL dirender server dari template + data.
- Cetak ulang diizinkan (idempoten; tidak menerbitkan kode baru), dicatat `audit_log` (`action=REPRINT`, siapa, kode). HU `VOID` tidak bisa dicetak ulang.
- **Escape wajib:** semua field teks (nama produk, batch, partner) di-escape sebelum disisipkan — karakter `^` dan `~` adalah perintah ZPL (injeksi perintah). Pakai `^FH\` dan encode `^`→`\5E`, `~`→`\7E`, `\`→`\5C`; potong panjang per field. `^CI28` untuk UTF-8 (nama berhuruf non-ASCII).

## 4. Contoh template ZPL — label LPN (4x6", 203 dpi)

```
^XA
^CI28
^CF0,40
^FO40,40^FDLPN: {lpn_code}^FS
^FO40,100^FH\^FD{product_name_escaped}^FS
^FO40,150^FH\^FDBatch: {batch_no_escaped}  Exp: {expiry}^FS
^FO40,200^FDQty: {qty_display}^FS
^BY3,2,120
^FO40,260^BCN,120,Y,N,N^FD{lpn_code}^FS      // Code128 = kode LPN
^XZ
```
Placeholder `{…}` diisi server (`*_escaped` = hasil escape di atas; `{qty_display}` = roll-up UOM, mis. `2 Carton`). Human-readable + barcode dalam satu label.

**Pallet campuran** (`handling_unit.product_id` NULL): baris produk diganti `MIXED — {n_sku} SKU / {n_carton} karton`, tanpa batch/expiry; detail isi dilihat via scan (lookup DB).

**Label bin** (`POST /master/locations/{id}/print-label`): Code128 kode bin + teks besar kode bin; tanpa data stok.

## 5. Setting printer

- `label_dpi` (203/300), ukuran label, dan endpoint printer default = `app_setting` (atau per-warehouse fase 2).
- Kegagalan cetak **tidak** membatalkan operasi stok (cetak di luar `⟦TX⟧`); sediakan tombol cetak ulang.

---

## Ringkasan Keputusan (label)

1. Barcode fase 1 = **Code128 encode identifier saja**; WMS lookup detail dari DB. GS1 = fase 2.
2. Server merender ZPL dari template dengan **escape field** & `^CI28`; cetak di luar transaksi stok; cetak ulang idempoten & teraudit.
3. Pengiriman ke printer lewat **print service** lokal (bukan browser langsung); tanpa print service → PDF.
