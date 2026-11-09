# Configuration & Industry Profiles — WMS Baseline

**Katalog `app_setting` lengkap + playbook konfigurasi per industri**

Versi: 1.3 · 13 Oktober 2026 · Pembaruan 1.3 (M5): env callback ERP (`ERP_CALLBACK_*`, `OUTBOX_MAX_ATTEMPTS`), profil dipasang lewat `scripts/apply-profile.sh`. Pembaruan 1.2 (M4, behavioral D-36): validasi `PATCH /config/settings/{key}` lewat katalog bertipe, aturan data & dependensi per flag, env export laporan. Sebelumnya 1.1 · 24 September 2026: `scrap_require_approval` dihapus (approval per operation type), aturan prioritas flag, setting baru (print service, TTL klaim), zona waktu per warehouse.

> Topik: seluruh feature flag & kebijakan (`app_setting`), dan cara mengubah baseline menjadi profil farmasi/retail/F&B/manufaktur lewat konfigurasi. Terkait: seed (`seed-wms-baseline.sql`), branding hardcoded di FE (`frontend-design-wms-baseline.md` §3).

---

## 1. Katalog `app_setting` Lengkap

Referensi tunggal semua konfigurasi. `data_type`: boolean/integer/string. "Efek" = dampak runtime.

| key | type | default | nilai valid | Efek |
|---|---|---|---|---|
| `enable_batch` | boolean | true | true/false | Menu Batches & kolom batch aktif |
| `enable_expiry` | boolean | true | true/false | Kolom expiry wajib; cek expiry outbound |
| `enable_fefo` | boolean | true | true/false | Saran FEFO saat pick list & reserve |
| `enable_serial` | boolean | true | true/false | Pack S/N item aktif (butuh track_level=ITEM) |
| `enable_lpn` | boolean | true | true/false | Label pallet LPN |
| `enable_carton_break` | boolean | true | true/false | Menu & operasi Carton Break |
| `enable_quarantine` | boolean | true | true/false | Status Quarantine & menu QA |
| `enable_multi_site` | boolean | false | true/false | Menu Sites; >1 site |
| `fefo_policy` | string | warn | warn/block | Batch bukan saran → `warn` = wajib ack + reason (tercatat per line) · `block` = tolak |
| `over_receipt_tolerance_pct` | integer | 0 | 0–100 | Toleransi terima melebihi qty PO |
| `default_min_shelf_life_days` | integer | 0 | ≥0 | Sisa umur min default (0=tak dicek) bila partner NULL |
| `qa_on_receipt` | boolean | false | true/false | Barang masuk default ke QUARANTINE (butuh enable_quarantine) |
| `ref_no_format` | string | `{TYPE}-{YYYY}-{seq:05}` | pola | Format nomor dokumen operasi (tahun menurut timezone warehouse) |
| `lpn_code_format` | string | `LPN-{seq:07}` | pola | Format kode LPN |
| `serial_code_format` | string | `SN-{seq:07}` | pola | Format kode Pack S/N |
| `login_max_failed_attempts` | integer | 5 | ≥1 | Ambang lockout |
| `lockout_minutes` | integer | 15 | ≥1 | Durasi kunci setelah gagal berturut |
| `label_dpi` | integer | 203 | 203/300 | Resolusi label Zebra |
| `label_print_service_url` | string | (kosong) | URL | Print service lokal (Zebra Browser Print/agen); kosong = unduh ZPL/PDF |
| `claim_ttl_minutes` | integer | 120 | ≥5 | Klaim tugas handheld kedaluwarsa tanpa aktivitas |

Validasi: `PATCH /config/settings/{key}` menolak nilai di luar kolom "nilai valid" (`400 VALIDATION_ERROR`) dan menulis `audit_log`.

### 1.1 Aturan prioritas flag

| Lapis | Contoh | Aturan |
|---|---|---|
| Global (`app_setting.enable_*`) | `enable_fefo` | Mati ⇒ fitur mati untuk **semua** produk (menu/kolom disembunyikan, validasi dilewati) |
| Produk (`product.use_*`) | `use_fefo` | Berlaku hanya bila global hidup: **flag efektif = global AND produk** |
| Operation type | `require_approval`, `require_reason`, `allowed_from_status` | Satu-satunya sumber kebenaran approval/reason per jenis operasi |
| Warehouse | `timezone` | Dasar "hari ini" untuk expiry/shelf-life/ref_no/tugas harian |

Mematikan flag global yang datanya sudah ada ditolak `409 CONFLICT/LOCKED_AFTER_STOCK` sampai datanya nol (behavioral D-36):

| Flag | Data yang menghalangi |
|---|---|
| `enable_batch` | quant ber-batch |
| `enable_serial` | quant ber-serial |
| `enable_lpn` | pallet (LPN) berstatus INTACT |
| `enable_quarantine` | quant QUARANTINE (atau reservasi dari status itu); juga butuh `qa_on_receipt=false` |
| `enable_multi_site` | lebih dari satu site, atau stok di IN-TRANSIT |

Dependensi (`422 SETTING_DEPENDENCY`): `qa_on_receipt=true` butuh `enable_quarantine=true`; `lpn_code_format` dan `serial_code_format` tak boleh identik. Pola kode: `ref_no_format` wajib memuat `{TYPE}`, `{YYYY}`, `{seq}` (counter di-scope per tahun); `lpn_code_format`/`serial_code_format` wajib `{seq}`; di luar placeholder hanya huruf, angka, `-_./`. Aturan ini hidup sebagai katalog bertipe di kode (`packages/domain/src/settings.ts`) dan dikirim ke UI lewat `GET /config/settings` (`rule`). `warehouse.timezone` diubah lewat `PATCH /master/warehouses/{id}` (hak edit App Settings atau Sites).

> **Branding (warna/logo/nama app/bahasa) TIDAK di `app_setting`** — hardcoded di codebase FE, dikustomisasi per klien lewat folder `brands/<klien>/` yang dipilih `BRAND_ID` saat build (lihat `frontend-design-wms-baseline.md` §3).

> **Bukan di `app_setting`** (di environment/secret): signing key JWT, access/refresh TTL, kredensial DB, URL+secret callback ERP. Alasan: keamanan & rotasi. Export laporan (M4): `REPORT_STORAGE_DIR` (direktori yang **sama & terbagi** antara web dan worker; kosong = `<tmpdir>/wms-reports`), `REPORT_TTL_HOURS` (24), `REPORT_MAX_ROWS` (1.000.000). Callback ERP (M5, erp-integration §6.1): `ERP_CALLBACK_URL` (http/https; kosong = gateway mati, event tetap PENDING), `ERP_CALLBACK_SECRET` (≥ 16 karakter; kunci HMAC `X-WMS-Signature`), `ERP_CALLBACK_AUTH_HEADER` (`Nama: nilai`, opsional), `ERP_CALLBACK_TIMEOUT_MS` (10.000), `OUTBOX_MAX_ATTEMPTS` (10) — nilai yang sama untuk web **dan** worker.

---

## 2. Playbook Konfigurasi per Industri

Inti model bisnis: satu basis kode → banyak profil lewat konfigurasi. Semua industri memakai schema & kode sama; hanya `app_setting` + master data berbeda.

### 2.1 Matriks flag per industri

| Flag | Farmasi | Retail | F&B | Manufaktur |
|---|---|---|---|---|
| `enable_batch` | ✅ | ❌ | ✅ | ➖ opsional |
| `enable_expiry` | ✅ | ❌ | ✅ | ➖ |
| `enable_fefo` | ✅ | ❌ | ✅ | ➖ |
| `fefo_policy` | **block** | — | warn | warn |
| `enable_serial` | ✅ (track ITEM) | ❌ | ❌ | ➖ |
| `enable_lpn` | ✅ | ✅ | ✅ | ✅ |
| `enable_carton_break` | ✅ | ➖ | ➖ | ❌ |
| `enable_quarantine` | ✅ | ❌ | ➖ | ➖ |
| `qa_on_receipt` | ✅ | ❌ | ➖ | ➖ |
| `default_min_shelf_life_days` | >0 (mis. 180) | 0 | >0 | 0 |
| `OUT_SCRAP.require_approval` (operation type) | ✅ | ➖ | ➖ | ✅ |

✅ nyala · ❌ mati · ➖ sesuai kebutuhan klien.

### 2.2 Master data minimum per profil

| Data | Farmasi | Retail | F&B | Manufaktur |
|---|---|---|---|---|
| UOM & packaging | Pcs→Carton→Pallet, `track_level=ITEM` | Pcs/Carton, CARTON | Pcs/Carton, CARTON/ITEM | sesuai BOM |
| Operation types dipakai | semua (termasuk carton break, QA) | receipt supplier, transfer, delivery, scrap | + carton break bila jual eceran | **RCV_PRODUCTION, OUT_ISSUE_PROD** dominan |
| Partner | supplier+customer + `min_shelf_life_days` | supplier+customer | supplier+customer | supplier internal/eksternal |
| Lokasi | + QA bin | tanpa QA | opsional QA | + lokasi produksi |

### 2.3 Langkah instalasi profil baru (implementor)

```
1. Deploy kode baseline + jalankan schema + seed (default full-featured/farmasi).
2. Sesuaikan app_setting sesuai matriks §2.1 (mis. retail: matikan batch/expiry/fefo/serial/quarantine) —
   `bash scripts/apply-profile.sh <farmasi|retail|fnb|manufaktur>` memasang baris ✅/❌ lewat API dengan urutan
   aman-dependensi (validasi D-36 + audit tetap berlaku); baris ➖ diatur manual di App Settings.
3. Isi master data: UOM & packaging, sites/warehouse (**set `timezone`**), locations (bin, cetak label bin), partners, reason codes, (batches bila aktif).
4. Definisikan/sesuaikan operation types turunan bila perlu (tetap terikat 3 direction).
5. Set matriks RBAC per role sesuai kebutuhan klien (atau pakai role template); pastikan minimal satu user non-operator punya hak Scrap Approval bila `require_approval` aktif.
6. Buat service account + api_key untuk integrasi ERP; set URL callback (env); konfigurasi print service & prefix/suffix scanner handheld.
7. Ganti password admin; buat user riil.
8. Brand FE: siapkan `brands/<klien>/` (tokens, logo, `brand.ts`), build dengan `BRAND_ID=<klien>`; gate kontras CI harus lolos.
9. Smoke test: 1 receipt → putaway → transfer → pick → delivery end-to-end + 1 adjustment + 1 scrap dengan approval.
```
Menu ber-flag tersembunyi otomatis untuk fitur yang dimatikan — user profil retail tak melihat Batches/Quarantine/Carton Break sama sekali.

---

## Ringkasan Keputusan (konfigurasi)

1. `app_setting` = satu katalog konfigurasi (§1); rahasia & branding dikecualikan; approval per operation type (bukan flag global).
2. Flag efektif = global AND produk (§1.1); timezone per warehouse.
3. Satu basis kode → profil industri lewat **matriks flag + master data + brand build** (§2); langkah instalasi baku (§2.3).
