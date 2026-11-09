# Handheld PWA Design — WMS Baseline

**Desain aplikasi handheld (PWA scan-guided) · pelengkap ADR-004, Frontend Design v1.1, Behavioral Spec v1.1**

Versi: 1.3 · 13 Oktober 2026 (M4: adjustment `/hh/adjustment` — hitungan fisik + pratinjau selisih) · sebelumnya 1.2 · 12 Oktober 2026 (M3: picking/delivery/scrap, ack FEFO, rute `/hh/delivery`) · sebelumnya 1.1 · 24 September 2026 · Pembaruan: segmen `/hh`, klaim tugas & pilih gudang, antrean scan serial + `Idempotency-Key`, wedge berbasis prefix/suffix, enum `next_expected` lengkap, alur per direction diselaraskan (submit INCOMING, satu confirm OUTGOING, QA/carton break/adjustment sebagai operasi instan), FEFO ack, error berbasis `reason`, token handheld (56px, tema `hc`), cetak via print service.

> Handheld = antarmuka operator gudang (AC-1) untuk eksekusi inbound/internal/outbound via scan. **PWA online-only** (ADR-004, OQ-7), berbagi token/session/auth dengan desktop, tapi punya density, layout & alur sendiri (`app/hh`).

---

## Daftar Isi

1. [Prinsip & Target Perangkat](#1-prinsip--target-perangkat)
2. [Setup PWA](#2-setup-pwa)
3. [Layout & Route `/hh`](#3-layout--route-hh)
4. [Arsitektur Input Scan](#4-arsitektur-input-scan)
5. [Scan-guided Flow Engine (`next_expected`)](#5-scan-guided-flow-engine-next_expected)
6. [Pola UX Handheld](#6-pola-ux-handheld)
7. [Alur per Operasi (layar handheld)](#7-alur-per-operasi-layar-handheld)
8. [Penanganan Error & Online-only](#8-penanganan-error--online-only)
9. [Session, Performa, Cetak, Testing](#9-session-performa-cetak-testing)
10. [Keputusan Terkunci (handheld)](#10-keputusan-terkunci-handheld)

---

## 1. Prinsip & Target Perangkat

- **HH-P1 — Scan-first, minim ketik.** Input utama = scan (S/N, LPN, bin). Ketik manual hanya untuk qty/pengecualian. Alur dipandu `next_expected`.
- **HH-P2 — Online-only.** Jaringan putus → aksi diblok dengan banner + retry (OQ-7). Tidak ada antre offline (SC-10).
- **HH-P3 — Satu tangan, sarung tangan.** Target sentuh ≥ **56px** (`--hh-touch-min`), aksi utama 64px lebar penuh di zona jempol, angka/kode besar & tebal, tema **high-contrast** (`hc`) default.
- **HH-P4 — Server otoritatif.** Validasi & efek stok di server. Handheld hanya memandu & menampilkan hasil.
- **HH-P5 — Umpan balik cepat & multimodal.** Tiap scan → suara + getar + visual (ikon + teks + warna) < 300 ms (NFR-PERF-1). Tidak pernah hanya warna.
- **HH-P6 — Satu scan satu waktu.** Scan diproses berurutan (antrean), masing-masing idempoten.

**Target perangkat:** Android (Chromium) kelas Zebra TC/Honeywell dengan imager hardware + kamera. iOS/Safari → fallback ZXing.

---

## 2. Setup PWA

### 2.1 Manifest
```ts
// app/manifest.ts
import { BRAND } from '@/config/brand';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} Handheld`, short_name: BRAND.name,
    start_url: '/hh', scope: '/hh',
    display: 'standalone', orientation: 'portrait',
    background_color: BRAND.backgroundHex.light,
    theme_color: BRAND.themeColorHex,          // hex dari brand.ts (manifest tak bisa membaca var CSS/OKLCH)
    icons: [/* 192, 512, maskable dari brands/<id>/icons */],
  };
}
```

### 2.2 Service worker (shell/asset SAJA)
- Cache **app shell + aset statis** untuk load cepat & installability. **Jangan** cache respons `/api/*`.
- Strategi: `StaleWhileRevalidate` untuk aset; **NetworkOnly** untuk `/api/*`.
- Implementasi: Serwist, scope `/hh`.
- **Update SW:** versi baru tidak diaktifkan di tengah operasi. Prompt "Muat ulang" hanya muncul di layar home `/hh` atau setelah `confirm` (tidak ada `skipWaiting` paksa).

### 2.3 Syarat & instalasi
- **HTTPS wajib** (`BarcodeDetector`, `getUserMedia`, install PWA) — reverse proxy TLS (ADR-001).
- "Add to Home Screen" → fullscreen. Izin **kamera** diminta saat pertama memakai mode kamera.

---

## 3. Layout & Route `/hh`

```
app/hh/
  layout.tsx            requireSession + <HandheldShell> (tema hc, density handheld)
  page.tsx              home: pilih gudang aktif + daftar tugas (GET /operations/my-tasks)
  receipt/[id]/page.tsx       → menu inbound_receipts
  putaway/[id]/page.tsx       → menu inbound_putaway
  picking/[id]/page.tsx       → menu outbound_picking (confirm butuh outbound_deliveries)
  transfer/[id]/page.tsx      → menu internal_transfers
  carton-break/page.tsx       → menu internal_carton_break
  quarantine/page.tsx         → menu internal_quarantine
  scrap/[id]/page.tsx         → menu outbound_scrap
  adjustment/page.tsx         → menu inventory_adjustment
```
- Segmen URL nyata `/hh` → **tidak bentrok** dengan route desktop (`/internal/carton-break` dsb.).
- **Guard:** `requireSession` di layout; `requirePageAccess(HH_ROUTE_MENU[...])` di tiap page (frontend §6.3).
- **HandheldShell:** header ringkas (judul tugas, gudang aktif, `ConnectionIndicator`, user), konten besar, footer aksi. Tanpa sidebar; navigasi via home + back.
- **Gudang aktif:** default `user.default_warehouse`; bisa diganti di home (disimpan di `localStorage` per perangkat). Semua daftar tugas & validasi bin memakai gudang ini.

---

## 4. Arsitektur Input Scan

Tiga sumber input disatukan di `useScanner()` / `<ScanField>`:

```
 Laser/imager (HID wedge) ──┐
 Kamera (BarcodeDetector/ZXing) ──┼──► normalisasi ──► scanQueue (serial) ──► POST /operations/{id}/scan
 Manual (input teks) ────────┘                         (Idempotency-Key per scan)
```

### 4.1 Laser-gun (keyboard-wedge) — utama
- **Konfigurasi scanner (runbook onboarding):** set **prefix** `F13` (atau karakter STX `\x02`) dan **suffix** `Enter`. Listener mengenali scan dari prefix — tidak bergantung jeda antar-tombol yang rapuh. Fallback bila prefix tak bisa diset: heuristik jeda < 30 ms + Enter.
- Listener global `keydown` hanya aktif saat layar scan aktif **dan** fokus tidak berada di input editable. Saat `QtyStepper` fokus, karakter berprefix tetap dicegat (`preventDefault`) sehingga tak "bocor" ke field qty.
- `<ScanField>` memakai `inputmode="none"` agar soft keyboard Android tidak muncul saat menerima wedge.
- Karakter kontrol GS (`\x1d`, pemisah GS1) dipertahankan; untuk Code128 identifier fase 1 cukup trim whitespace.

### 4.2 Kamera — `BarcodeDetector`
- Bila tersedia: `getUserMedia({video:{facingMode:'environment'}})`, `detect()` ~8 fps. Format: Code128, QR, DataMatrix.
- Sukses → hentikan stream, masukkan ke antrean. Kode identik dalam 1,5 s diabaikan (kamera sering mendeteksi frame berulang).

### 4.3 Fallback ZXing
- Tanpa `BarcodeDetector` (iOS): lazy-load `@zxing/browser` (dynamic import).

### 4.4 Kontrak `useScanner`
```ts
const { start, stop, mode, setMode, lastError } = useScanner({
  accept: ['CODE128','QR','DATA_MATRIX'],
  onScan: (code, source) => scanQueue.enqueue({ code, source }),
});
// mode: 'wedge' | 'camera' | 'manual'; default 'wedge'
```

### 4.5 Antrean scan (`stores/scanQueue`)
- **Serial:** hanya satu request scan in-flight per operasi. Scan berikutnya menunggu hasil sebelumnya (karena `next_expected` bisa berubah). UI menampilkan badge antrean bila > 1 (mis. imager ditekan beruntun).
- Tiap item antrean membawa `Idempotency-Key` (UUID) yang **dipertahankan saat retry** (timeout/jaringan) → server tidak membuat line ganda (CC-9).
- Bila respons error, antrean sisanya **dibatalkan** (scan berikutnya mungkin tak relevan lagi) dan operator diberi tahu.
- Wedge: kode identik berturut < 300 ms diabaikan (double-trigger imager); scan ulang yang disengaja tetap dimungkinkan.

---

## 5. Scan-guided Flow Engine (`next_expected`)

Alur handheld = mesin langkah yang **dipandu server**. `GET /operations/{id}` dan setiap `POST .../scan` / transisi mengembalikan `next_expected {step, alternatives, line_id, hint, can_confirm}`.

```
Layar alur (state = next_expected dari server)
  ├─ step=SCAN_BIN, hint.location_code="A-01-01-02"  → <ScanField> + petunjuk besar
  ├─ enqueue scan → POST /operations/{id}/scan {expected_step, code} [Idempotency-Key]
  │     ├─ 200 → {line, progress, next_expected}  → ScanFeedback sukses, render langkah berikut
  │     ├─ 200 + warnings → ScanFeedback warning (mis. FEFO_OVERRIDDEN)
  │     ├─ 422 FEFO_ACK_REQUIRED → ReasonPicker(FEFO_OVERRIDE) → kirim ulang dengan fefo_override_reason
  │     ├─ 422/409 lain → ScanFeedback error + pesan dari reason; langkah ditahan
  └─ step=CONFIRM → HoldToConfirm "Selesai" → POST /confirm [Idempotency-Key]
```

Enum `step`, bentuk `{step, alternatives, line_id, hint, can_confirm}`, dan **tabel keputusan lengkap per operation type** ada di [`flow-steps-wms-baseline.md`](flow-steps-wms-baseline.md), yang menjadi kontrak mesin langkah. Ringkasnya: step utama ditonjolkan; `alternatives` tampil sebagai tombol sekunder dan scan yang cocok dengannya juga diterima. Klien mengirim `expected_step`, bukan jenis kode; server yang mengklasifikasi kode. `409 STEP_CHANGED` berarti layar basi: render ulang tanpa feedback gagal keras. Bila `can_confirm = false`, tampilkan "Serahkan ke petugas" alih-alih tombol konfirmasi.

- Handheld menyimpan konteks ringan (operation id, line aktif, step) di `scanSession` (zustand), bukan status stok.

---

## 6. Pola UX Handheld

| Aspek | Aturan |
|---|---|
| **Langkah tunggal per layar** | Satu aksi menonjol; `StepProgress` "3/8 baris" selalu terlihat |
| **Target sentuh** | ≥ 56px; aksi utama 64px lebar penuh di footer |
| **Umpan balik** | Sukses = 1 beep pendek + getar 50 ms + overlay hijau ikon ✓ + teks · Peringatan = 2 beep naik + overlay amber ikon ⚠ · Gagal = beep rendah panjang + getar 300 ms + overlay merah ikon ✕ + pesan (tetap tampil sampai disentuh) |
| **Font & kontras** | Qty `--text-hh-qty` (40px) bold, kode `--text-hh-code` (28px) mono bold; tema `hc` default (kontras ≥ 7:1) |
| **Qty entry** | `QtyStepper` + keypad numerik; default dari saran server; tampil multi-UOM (`UomQuantity`) |
| **Koreksi** | "Ulangi scan" / "Tutup baris" jelas; scan salah tidak merusak progres |
| **Status koneksi** | `ConnectionIndicator` permanen; offline → aksi terkunci (§8) |
| **Mode scan** | Toggle wedge/kamera/manual; default wedge |
| **Konfirmasi berat** | Confirm/Cancel/Scrap/Adjustment → `HoldToConfirm` (800 ms) |
| **Klaim** | Membuka tugas otomatis `claim`; tugas milik orang lain tampil terkunci dengan nama pemegang |

Bahasa & label mengikuti i18n FE; default `id`. Pesan error dari `errors.<reason>`.

---

## 7. Alur per Operasi (layar handheld)

Tiap alur = urutan langkah `next_expected`. Detail aturan di Behavioral §5.

### 7.1 Receipt + Putaway (INCOMING) — Behavioral §5.1
```
Home → pilih Receipt → claim + start (otomatis bila READY)
[SCAN_UNIT]  scan Carton/Serial per unit  (duplikat/produk/batch/over-receipt divalidasi server)
[SUBMIT]     "Selesai scan unit" → server generate HU/LPN (PENDING)
[PRINT_LABEL] cetak label LPN via print service
[SCAN_LPN] → [SCAN_BIN] bin STOCK  (ulang per LPN)
[CONFIRM]    HoldToConfirm "Selesai" → stok masuk (ringkasan)
```

### 7.2 Picking + Delivery (OUTGOING, satu operasi) — Behavioral §5.2
```
Home → pilih Pick List (urut delivery_date) → claim + start (reserve)
per baris: [SCAN_BIN] bin saran → [SCAN_LPN|SCAN_CARTON|SCAN_SERIAL] (+ENTER_QTY bila loose)
           FEFO block → ditolak; FEFO warn → SELECT_REASON lalu lanjut; expiry/shelf-life divalidasi server
           [CLOSE_LINE] (parsial → konfirmasi, sisa di-release)
[SCAN_STAGING] → [SCAN_DOCK]
[CONFIRM] "Kirim" (butuh hak outbound_deliveries) → stok keluar; surat jalan dicetak dari desktop/print service
```
Operator tanpa hak `outbound_deliveries` boleh scan dock, lalu melihat `CONFIRM` dengan `can_confirm=false` ("serahkan ke petugas yang berhak"). Sejak staging discan (tahap delivery, behavioral D-29) tugas muncul di antrean Deliveries dan daftar tugas petugas delivery, yang membukanya lewat `/hh/delivery/{id}` (guard `outbound_deliveries`) — scan dock atau confirm-nya mengambil alih klaim picker.

**Implementasi M3 (flow-steps v1.3):**
- Bin & unit mengikuti **reservasi** (bin aktif); field scan menerima kode bin lain atau unit lain kapan pun (swap, behavioral D-25) — server yang memutuskan.
- **Ack FEFO:** `422 FEFO_ACK_REQUIRED` tidak diperlakukan sebagai gagal. Layar menampilkan dialog (expiry saran vs yang discan) + daftar reason `applies_to=FEFO_OVERRIDE`; memilih reason mengirim ulang scan yang sama + `fefo_override_reason` dengan `Idempotency-Key` baru; "Batal" kembali ke saran. `FEFO_VIOLATION` (policy `block`) = error biasa.
- Rute: `/hh/picking/{id}` (guard `outbound_picking`), `/hh/delivery/{id}` (guard `outbound_deliveries`), `/hh/scrap/{id}` (guard `outbound_scrap`); ketiganya merender `OperationFlow` yang sama.

### 7.3 Bin-to-Bin Transfer — Behavioral §5.3
```
(ad-hoc) scan unit pertama membuat operasi → [SCAN_BIN source] → [SCAN unit] → [SCAN_BIN dest] → [CONFIRM]
```

### 7.4 Inter-Site Transfer — Behavioral §5.4
```
Dispatch: pilih gudang tujuan → [SCAN_BIN A] → [SCAN unit] → [CONFIRM] (ke IN_TRANSIT)
Receive : di gudang B, tugas "Terima kiriman" → [SCAN unit dari IN_TRANSIT] → [SCAN_BIN B] → [CLOSE_LINE] → [CONFIRM]
```

### 7.5 Carton Break — operasi instan (Behavioral §5.5)
```
[SCAN_CARTON] → preview isi (N item, batch, expiry) → opsi "Generate S/N" → HoldToConfirm
→ POST /internal/carton-break [Idempotency-Key] → karton BROKEN, N item lahir → cetak label S/N (opsional)
```

### 7.6 Quarantine / Damaged — operasi instan (Behavioral §5.6)
```
Hold:         pilih reason → [SCAN unit]… → (opsional [SCAN_BIN QA]) → HoldToConfirm
Release:      [SCAN unit]… → [SCAN_BIN] (saran = bin asal) → HoldToConfirm
Reject / Mark damaged: pilih reason → [SCAN unit]… → HoldToConfirm
```

### 7.7 Scrap / Issue — Behavioral §5.7
```
START (claim+reserve) → [SCAN_BIN → SCAN unit]… → [CLOSE_LINE] → AWAIT_APPROVAL (bila belum di-approve supervisor lain) → CONFIRM
(reason diisi saat DRAFT; approval hanya menahan confirm — flow-steps G-7)
```

### 7.8 Adjustment — operasi instan (Behavioral §5.8, D-32)
```
SCAN_BIN / scan unit (LPN·karton·serial → bin diisi dari stok unit) / scan barcode produk
→ [batch bila produk ber-batch] → ENTER_QTY = hitungan fisik → Pratinjau (stok sistem & selisih)
→ SELECT_REASON (applies_to ADJUST) → HoldToConfirm → POST /inventory/adjustment {…, counted_qty} (Idempotency-Key)
```
- Client-driven seperti QA (§7.6): kode diklasifikasi `GET /lookup/code`; server menghitung ulang selisih di bawah lock, sehingga hitungan yang sama dengan sistem ditolak `NO_CHANGE` dan stok yang tertahan operasi lain `UNIT_RESERVED`.
- Rute `/hh/adjustment` (guard `inventory_adjustment`); pintasan di daftar tugas bagi pemegang hak create. Transit loss hanya dari desktop (laporan In-Transit).

---

## 8. Penanganan Error & Online-only

### 8.1 Peta error API → layar (berdasarkan `error.reason`, API §1.2.1)
| reason | Tampilan handheld |
|---|---|
| `DUPLICATE_SERIAL` | "S/N sudah terdaftar" + minta scan lain |
| `FEFO_VIOLATION` | "Batch bukan FEFO. Ambil batch <saran>" (blok) |
| `FEFO_ACK_REQUIRED` | "Batch bukan saran FEFO" → `ReasonPicker` → kirim ulang |
| `EXPIRED` / `SHELF_LIFE` | "Kedaluwarsa / sisa umur kurang" — tahan |
| `NOT_RESERVED` | "Unit ini tidak ter-reserve untuk tugas ini" |
| `INVALID_BIN` | "Bin tidak valid (tipe/nonaktif/gudang lain)" |
| `OVER_RECEIPT` | "Melebihi qty PO (+toleransi)" |
| `CLAIMED_BY_OTHER` | "Tugas sedang dikerjakan <nama>" → kembali ke home |
| `INVALID_TRANSITION` | "Status tugas berubah" → muat ulang tugas |
| `VERSION_CONFLICT` | "Data berubah, muat ulang" |
| `LOCK_TIMEOUT` | "Sistem sibuk, coba lagi" (retry otomatis 1× dengan key sama) |
| `INSUFFICIENT_STOCK` / `SO_OVER_ALLOCATION` | "Stok/alokasi tidak cukup" (saat start) |
| `NEEDS_APPROVAL` | layar `AWAIT_APPROVAL` |
| lainnya | pesan `errors.<reason>` generik |

Semua error → feedback gagal + banner; **langkah ditahan** sampai koreksi.

### 8.2 Online-only (HH-P2)
- Deteksi koneksi: `navigator.onLine` + heartbeat ringan `GET /api/health` tiap 15 s saat layar alur aktif + kegagalan fetch.
- Offline → `OfflineBanner` permanen, **tombol aksi terkunci**, scan ditolak "sambungkan dulu" (tidak di-buffer). Saat online kembali: muat ulang tugas (`GET /operations/{id}`) sebelum aksi.
- Request yang terputus di tengah jalan diulang dengan **`Idempotency-Key` yang sama** → aman dari efek ganda.

---

## 9. Session, Performa, Cetak, Testing

### 9.1 Session
- Sama desktop (frontend §7): cookie httpOnly + CSRF; refresh single-flight + grace window server (auth-session §1) → sesi aman sepanjang shift walau banyak request paralel.
- Expired/locked → login; id operasi terakhir disimpan di `sessionStorage` untuk melanjutkan setelah login (klaim tetap milik user).

### 9.2 Performa (NFR-PERF-1: scan p95 ≤ 300 ms)
- Endpoint scan ringan: lock `operation` singkat, tanpa advisory lock produk. Jangan optimistic-commit stok; transisi langkah setelah 200 OK.
- Prefetch detail pick list saat "Mulai"; cache read-only TanStack Query.
- NFR-PERF-6 (10 scan/dtk) diukur lintas perangkat; per perangkat scan diserialkan (§4.5).

### 9.3 Cetak label dari handheld
- Browser tidak bisa membuka socket TCP 9100. Cetak lewat **print service** (`label_print_service_url`, mis. Zebra Browser Print / agen cetak di jaringan gudang): handheld mengambil ZPL dari `POST .../print-lpn` lalu mengirimnya ke print service beserta printer tujuan. Tanpa print service → label dicetak dari desktop.

### 9.4 Testing
- **Matriks perangkat:** Android Chrome (utama) — `BarcodeDetector`; iOS Safari — fallback ZXing.
- **Wedge:** unit test listener (prefix, heuristik jeda, fokus di input qty, `inputmode=none`).
- **Antrean & idempotensi:** retry dengan key sama tidak menggandakan line; error membatalkan sisa antrean.
- **E2E (Playwright):** receipt→putaway, pick→delivery (termasuk FEFO ack & line parsial), carton break, QA; mock kamera.
- **A11y:** target ≥ 56px, kontras `hc`, fokus, live region scan; axe.
- **Online-only:** fetch gagal → banner + kunci aksi; reconnect → reload tugas.

---

## 10. Keputusan Terkunci (handheld)

1. **PWA installable, online-only**, scope `/hh`; SW cache shell/aset saja, `/api/*` NetworkOnly; update SW hanya di home/setelah confirm.
2. **Input scan tersatukan** di `useScanner`: default wedge (prefix/suffix dikonfigurasi), kamera `BarcodeDetector` (fallback ZXing). HTTPS wajib.
3. **Antrean scan serial** + `Idempotency-Key` per scan (dipertahankan saat retry).
4. **Alur dipandu server** via `next_expected {step, hint}` (enum §5); device tak menghardcode urutan.
5. **Klaim tugas** & gudang aktif; tugas milik orang lain terkunci.
6. **UX:** satu langkah/layar, target 56/64 px, tema `hc`, feedback suara+getar+ikon+teks, `HoldToConfirm` untuk aksi final, error dari `reason`.
7. **Guard & session sama desktop**; segmen `app/hh`; cetak via print service.
8. **Server otoritatif**: handheld tak menghitung/optimistic-commit stok.

### Revisit saat tumbuh
- Offline queue (SC-10) via Capacitor + storage lokal.
- Integrasi scanner hardware (DataWedge intent) via Capacitor bila wedge kurang.
- Web Push untuk tugas baru.
