# Frontend Design — WMS Baseline

**Desain frontend: theming & design system, menu (RBAC), auth guard, session · pelengkap ADR Tech Stack v1.0, auth-session v1.1, configuration**

Versi: 1.2 · 17 Oktober 2026 · Pembaruan v1.2: **design system v0.2 "Calm workspace"** (§4.6: shell inset, kanvas netral hangat, Plus Jakarta Sans self-host, label sentence case, `Menu`/`Pager`, aksi baris di menu ⋯). Pembaruan v1.1: brand per klien di `brands/<id>` (tetap hardcoded, tanpa fork), **design system v0.1** (token status/tipografi/density/elevation/motion, tema high-contrast handheld, gate kontras CI, inventaris komponen), konvensi nama menu↔route↔folder, guard per-page (bukan layout), perbaikan middleware, refresh di middleware, cookie `user_session` tersegel, handheld di segmen `/hh`.

> Referensi pola: codebase `fe-access-backoffice-portal` (Next.js App Router, Tailwind v4, shadcn, TanStack Query, zustand, next-intl, next-themes). Branding (warna/logo/nama/bahasa) **hardcoded di codebase FE**, menu = **katalog statis di FE** yang di-*mapping* dengan hak akses dari BE saat login. Kustomisasi per-klien = **berkas brand terpusat yang dipilih saat build**, bukan lewat DB dan bukan cabang kode.

---

## Daftar Isi

1. [Prinsip & Stack FE](#1-prinsip--stack-fe)
2. [Struktur Folder `apps/web`](#2-struktur-folder-appsweb)
3. [Theming & Brand per Klien](#3-theming--brand-per-klien)
4. [Design System v0.2](#4-design-system-v02)
5. [Menu (katalog FE × akses BE)](#5-menu-katalog-fe--akses-be)
6. [Auth Guarding](#6-auth-guarding)
7. [Session Management](#7-session-management)
8. [Client-side Permission Gating](#8-client-side-permission-gating)
9. [Konvensi Pendukung](#9-konvensi-pendukung)
10. [Pemetaan ke Referensi & Keputusan](#10-pemetaan-ke-referensi--keputusan)

---

## 1. Prinsip & Stack FE

- **FE-P1 — Branding hardcoded di FE, dipilih saat build.** Warna, logo, nama app, dan override teks ada di `brands/<brand-id>/`. Build klien = `BRAND_ID=<klien> pnpm build`. Satu basis kode, tanpa fork per klien (selaras prinsip "bukan cabang kode").
- **FE-P2 — Katalog menu hardcoded, di-gate oleh akses BE.** FE mendeklarasikan seluruh menu (struktur, label, ikon, route). Saat login BE mengirim `menuAccess` (code → CRUD); FE memetakan katalognya.
- **FE-P3 — Guard di server, dekat data.** Setiap `page.tsx` terlindung memanggil guard sendiri (layout **tidak** di-render ulang saat soft navigation). Klien hanya UX; backend tetap otoritatif (BR-5, FR-ADM-4).
- **FE-P4 — Handheld first-class.** Handheld (segmen `/hh`) berbagi token, session, dan auth dengan desktop, tapi punya density, layout, dan alur sendiri.
- **FE-P5 — Feature-based (1 fitur = 1 page).** Setiap fitur = satu route/page + satu folder `features/<nama>`.
- **FE-P6 — Design system dulu.** Fitur hanya merakit komponen `components/ui` + `components/blocks` dan token semantik; warna/ukuran literal dilarang (lint).

Stack (selaras ADR-006 & referensi):

| Area | Pilihan |
|---|---|
| Framework | Next.js App Router (React 19), TypeScript strict |
| Styling | Tailwind v4 (`@theme inline`) + shadcn/ui + CSS variables (OKLCH) |
| Theme mode | `next-themes` (light/dark + `hc` handheld) |
| Server state | TanStack Query |
| UI state | zustand |
| Form & validasi | react-hook-form + zod (`contracts/`) |
| Angka desimal | `decimal.js-light` (qty string ↔ tampilan) |
| i18n | next-intl (pesan + format angka/tanggal lokal) |
| Notifikasi | sonner |
| Ikon | lucide-react (+ map nama→komponen) |
| Barcode (handheld) | `BarcodeDetector` + fallback ZXing (ADR-004) |
| Katalog komponen | halaman `/dev/ui` (hanya build non-produksi) + test visual Playwright |

---

## 2. Struktur Folder `apps/web`

```
apps/web/
  brands/
    default/        tokens.css · brand.ts · logo.svg · favicon.ico · icons/ (192,512,maskable) · messages/{id,en}.json (override opsional)
    <klien>/        salinan struktur yang sama — dipilih via BRAND_ID saat build
  src/
    app/
      (public)/        login, forgot-password, change-password, error — tanpa guard
      (protected)/     layout.tsx = cek SESI saja + AppShell; tiap page memanggil requirePageAccess()
        dashboard/ inbound/ internal/ outbound/ inventory/ master/ config/ reports/ admin/
        forbidden/page.tsx   error.tsx
      hh/              HANDHELD (segmen URL nyata /hh — tak bentrok dengan route desktop)
        layout.tsx         cek sesi + <HandheldShell> + tema hc/density handheld
        page.tsx           home: daftar tugas (/operations/my-tasks)
        receipt/[id]/ putaway/[id]/ picking/[id]/ transfer/[id]/
        carton-break/ quarantine/ scrap/[id]/ adjustment/
      api/             route handlers (adapter tipis → application/use-case)  [ADR-002]
      providers/       QueryClient, ThemeProvider, Toaster, i18n, Authz
      layout.tsx       ROOT: font, html lang, tokens brand
      globals.css      token dasar design system (§4) + @import brand tokens
      manifest.ts      PWA manifest (warna dari brand.ts)
    proxy.ts           pathname header + arahkan ke refresh + paksa ganti password (§6.2)
    components/
      layout/          app-sidebar, app-header, handheld-shell
      ui/              shadcn primitives (button, dialog, table, badge, ...)
      blocks/          komposisi design system (§4.4): data-table, scan-field, status-badge, uom-quantity, ...
    features/          per-modul: components + hooks + services + types
    lib/
      theme/           kontrak token brand + util kontras
      authz/           permissions (bitmask), navigation, route-access (route→menu map), server guards, client hooks
      auth/            public-routes, session (seal/unseal)
      i18n/  env/  logger/  security/(csrf)  format/(qty, date, timezone)
    services/
      session/         cookie helpers (§7)
      http/            fetch wrapper (CSRF, Idempotency-Key, refresh single-flight, error envelope)
    config/            app.config (katalog NAV, konstanta UI)
    stores/            zustand stores (sidebar, scanSession, scanQueue)
```

Batas Clean Architecture (ADR-002/005): `app/api/*` = adapter ke `packages/application`. Komponen UI **tidak** memanggil DB/domain langsung — lewat route handler `/api/v1` atau server action yang memanggil use-case **setelah** guard.

### 2.1 Aturan penulisan code: Feature-based + konvensi nama

**Satu fitur = satu route/page = satu folder fitur = satu `menu.code`**, dengan transformasi deterministik dari route:

| Route | `menu.code` (DB, `menuAccess`, katalog NAV) | Folder fitur |
|---|---|---|
| `/master/products` | `master_products` | `features/master-products` |
| `/internal/carton-break` | `internal_carton_break` | `features/internal-carton-break` |
| `/outbound/scrap-approval` | `outbound_scrap_approval` | `features/outbound-scrap-approval` |

Aturan: `menu.code` = route tanpa `/` awal, `/` dan `-` → `_`; folder = route tanpa `/` awal, `/` → `-`. **Tidak ada singkatan.** Test CI membandingkan kunci `NAV` dengan `menu.code` di seed dan gagal bila berbeda.

```
src/app/(protected)/master/products/page.tsx   ← route tipis: requirePageAccess + render fitur
src/features/master-products/
  components/  hooks/  services/  schemas/  types/  index.ts
```
- **`page.tsx` tipis** — guard (`requirePageAccess`), ambil data awal, render komponen fitur.
- **Isolasi fitur** — fitur A tidak mengimpor internal fitur B (eslint-plugin-boundaries).
- **Scaffolding** — `scripts/create-feature.mjs <route>` membuat folder fitur, `page.tsx` **yang sudah berisi guard**, entri NAV, i18n key, dan menu seed snippet.

---

## 3. Theming & Brand per Klien

### 3.1 Arsitektur token (3 lapis)

```
Primitive tokens   → skala mentah: --brand-50..950 (dari brands/<id>/tokens.css), --gray-*, --green/amber/red/blue-*
      ↓
Semantic tokens    → --primary, --primary-foreground, --status-*, --surface-*, --border, --ring, --radius (light, .dark, .hc)
      ↓
@theme inline      → --color-primary: var(--primary) → utility bg-primary/text-primary
```
Komponen **hanya** memakai token semantik (lint `no-literal-colors`: larang hex/oklch/`bg-[#…]` di `src/**` kecuali `globals.css` & `brands/**`).

### 3.2 Titik kustomisasi per-klien (semua di `brands/<id>/`)

| Aspek | Berkas | Cara ganti |
|---|---|---|
| **Warna** | `tokens.css` — `--brand-50..950` (+ opsional `--sidebar-*`, `--radius`) | Isi skala OKLCH (generator skala di `scripts/brand-scale.mjs` dari satu warna hex) |
| **Nama, locale, mode, warna manifest** | `brand.ts` | Ubah konstanta |
| **Logo & ikon** | `logo.svg`, `favicon.ico`, `icons/*` | Ganti berkas |
| **Teks khusus klien** | `messages/{id,en}.json` (override sebagian) | Di-merge di atas pesan dasar |

```ts
// brands/<id>/brand.ts
export const BRAND = {
  name: 'WMS',                       // mis. 'PharmaWMS'
  logo: '/branding/logo.svg',
  favicon: '/branding/favicon.ico',
  defaultLocale: 'id',
  defaultMode: 'light',              // light | dark | system
  themeColorHex: '#1d4ed8',          // untuk manifest PWA (manifest tak bisa baca CSS var/OKLCH)
  backgroundHex: { light: '#ffffff', dark: '#0b0f17' },
} as const;
```
`src/config/brand.ts` me-re-export `brands/${process.env.BRAND_ID ?? 'default'}/brand.ts` (alias webpack/turbopack saat build); aset disalin ke `public/branding` oleh `scripts/prepare-brand.mjs` (prebuild). Test CI memastikan `themeColorHex` ≈ `--brand-600` (ΔE kecil).

### 3.3 Turunan warna & kontras

- Shade interaktif diturunkan dari skala brand, **bukan** `color-mix(…, black)` (buruk di dark mode):
  ```css
  :root  { --primary: var(--brand-600); --primary-hover: var(--brand-700); --primary-subtle: var(--brand-50); }
  .dark  { --primary: var(--brand-400); --primary-hover: var(--brand-300); --primary-subtle: color-mix(in oklch, var(--brand-400) 16%, var(--background)); }
  ```
- `--primary-foreground` **wajib** didefinisikan di `tokens.css` klien (putih atau hampir hitam) — tidak diasumsikan.
- **Gate kontras CI** (`pnpm test:contrast`): untuk tiap brand × mode (light/dark/hc), hitung rasio WCAG pasangan wajib — `primary/primary-foreground`, `foreground/background`, `muted-foreground/background`, setiap `--status-*-fg/--status-*-bg`, `ring/background` — minimum 4.5:1 (teks) / 3:1 (non-teks); tema `hc` minimum 7:1. Build klien gagal bila tidak lolos.

### 3.4 Mode tampilan

`next-themes` mengelola `light`, `dark`, dan **`hc`** (high-contrast, default untuk handheld di area terang/redup; operator dapat mengganti). Preferensi per perangkat di `localStorage` (preferensi tampilan, bukan konfigurasi produk).

### 3.5 Root layout

```tsx
// app/layout.tsx — TANPA baca DB
import { BRAND } from '@/config/brand';
export default function RootLayout({ children }) {
  return (
    <html lang={BRAND.defaultLocale} suppressHydrationWarning>
      <body className="bg-background text-foreground font-sans">
        <Providers defaultTheme={BRAND.defaultMode}>{children}</Providers>
      </body>
    </html>
  );
}
```
> Branding **tidak** disimpan di DB/`app_setting`; tidak ada halaman "Branding" admin.

---

## 4. Design System v0.2

Sumber kebenaran visual. Token di `globals.css`; komponen di `components/ui` (primitif shadcn) & `components/blocks` (komposisi WMS). Tiap komponen blocks punya entri di `/dev/ui` dengan semua varian & state, plus test axe.

### 4.1 Token warna semantik

| Grup | Token | Pemakaian |
|---|---|---|
| Surface | `--background` (kanvas: sidebar & latar), `--surface-1` (lembar konten, kartu, input), `--surface-2` / `--surface-3` (isian halus, hover), `--border` / `--border-strong`, `--ring` | netral hangat kroma rendah (hue 95) agar tak bersaing dengan warna brand |
| Brand | `--primary(-hover/-subtle/-foreground)`, `--accent` | aksi utama, highlight |
| Feedback | `--status-success-{bg,fg,border}`, `--status-warning-*`, `--status-danger-*`, `--status-info-*`, `--status-neutral-*` | toast, banner, validasi, feedback scan |
| Status quant | `--quant-available-*`, `--quant-reserved-*`, `--quant-quarantine-*`, `--quant-damaged-*` | `StatusBadge` stok |
| Status operasi | `--op-draft-*`, `--op-ready-*`, `--op-in-progress-*`, `--op-done-*`, `--op-cancelled-*` | `StatusBadge` operasi |

Status **tidak diturunkan dari brand** (hijau/kuning/merah tetap bermakna di semua klien). Setiap status punya **ikon** tetap (lucide) sehingga tidak hanya bergantung warna:

| Status | Warna dasar | Ikon |
|---|---|---|
| Available / Done / Success | green | `circle-check` |
| Reserved / In progress | blue | `lock` / `loader` |
| Quarantine / Warning | amber | `shield-alert` |
| Damaged / Danger / Cancelled | red | `circle-x` |
| Draft / Ready / Neutral | gray | `circle-dashed` / `circle-dot` |

### 4.2 Tipografi

| Token | Nilai | Catatan |
|---|---|---|
| `--font-sans` | Plus Jakarta Sans (variable, `next/font/google` di `app/fonts.ts` — diunduh saat build, disajikan dari origin sendiri; build butuh akses internet) | UI umum |
| `--font-mono` | JetBrains Mono (`next/font`) | **Kode** (S/N, LPN, bin, ref_no, batch) — selalu mono agar O/0, I/1 terbedakan |
| Angka | `font-variant-numeric: tabular-nums` global pada tabel & qty | kolom qty rata |
| Skala | `--text-xs 12 · sm 14 · base 16 · lg 18 · xl 20 · 2xl 24 · 3xl 30 · hh-qty 40 · hh-code 28` (px) | `hh-*` hanya handheld |
| Weight | 400 / 500 / 600 / 700 | qty & kode handheld = 700 |
| Kapitalisasi | **sentence case** di label, header tabel, grup menu (tanpa `uppercase tracking-wide`); pengecualian: dokumen cetak (surat jalan) & input kode | — |
| Line-height | 1.25 (heading), 1.5 (teks) | — |

### 4.3 Spacing, density, ukuran, elevation, motion, layer

| Kategori | Token |
|---|---|
| Spacing | skala 4px: `--space-1(4) 2(8) 3(12) 4(16) 5(20) 6(24) 8(32) 10(40) 12(48)` |
| Density | `data-density="compact"` (desktop tabel: row 40px, input 40px) · `"comfortable"` (default form: row 44px, input 40px) · `"handheld"` (row 64px, input 56px) |
| Target sentuh | `--touch-min: 44px` (desktop/mobile) · `--hh-touch-min: 56px` (handheld, sarung tangan) · aksi utama handheld 64px, lebar penuh |
| Radius | `--radius` (brand) → `sm = radius−4`, `md = radius−2`, `lg = radius` (tombol, input), `xl = radius+4` (kartu, tabel, menu), `2xl = radius+8` (lembar konten, kartu login), `full` |
| Border | `1px` default, `2px` fokus/seleksi, `3px` fokus tema `hc` |
| Elevation | `shadow-xs` (tombol, input, item aktif) · `shadow-sheet` (lembar konten) · `shadow-popover` (menu, laci mobile) — nilai di `--elev-*`; tema `hc` = border tebal alih-alih bayangan |
| Motion | `--duration-fast 150ms`, `--duration-base 220ms`, `--duration-slow 320ms`, `--ease-standard cubic-bezier(.2,0,0,1)`; hormati `prefers-reduced-motion` (tanpa animasi kecuali progres) |
| Z-index | `--z-sticky 10 · dropdown 20 · overlay 30 · dialog 40 · toast 50 · scan-feedback 60 · offline-banner 70` |
| Breakpoint | `sm 640 · md 768 · lg 1024 · xl 1280`; handheld dirancang untuk lebar 360–480, portrait |

### 4.4 Inventaris komponen (blocks)

| Komponen | Varian | State wajib | A11y |
|---|---|---|---|
| `DataTable` | compact/comfortable; selectable; expandable row | loading (skeleton), empty (`EmptyState`), error (`ErrorState` + retry), no-permission, stale (refetching) | `<table>` semantik, sort `aria-sort`, pagination keyboard |
| `FilterBar` | text, select, date-range (timezone warehouse), status multi | default, active (chip + clear) | label eksplisit |
| `StatusBadge` | `quant` · `operation` · `order` · `integration` | — | teks + ikon (tidak hanya warna) |
| `UomQuantity` | inline (`2 Carton · 50 Pcs`), stacked, base-only | loading, zero, negatif (hanya adjustment preview) | `aria-label` berisi base qty |
| `CodeText` | LPN/SN/bin/ref_no/batch; copyable | — | mono, `aria-label` dieja per karakter opsional |
| `ScanField` | wedge / kamera / manual | idle, listening, processing, success, error, disabled-offline | live region `aria-live="assertive"` untuk hasil scan |
| `ScanFeedback` | success / warning / error (overlay layar penuh ≤ 800 ms) | — | ikon besar + teks + suara + getar (tak hanya warna) |
| `StepProgress` | linear (`3/8 baris`), per-line checklist | — | `aria-valuenow` |
| `QtyStepper` | stepper ± + keypad numerik; UOM picker | default, min/max, invalid | `inputmode="decimal"`, tombol ≥ `--hh-touch-min` |
| `HoldToConfirm` | primary / destructive | idle, holding (progres 800 ms), confirmed, disabled | alternatif keyboard: fokus + tahan `Enter`/`Space`; teks "Tahan untuk konfirmasi" |
| `ConfirmDialog` | default / destructive (ketik ref_no untuk aksi massal) | — | fokus terperangkap, `Esc` batal |
| `ReasonPicker` | per `applies_to` | required, error | combobox ARIA |
| `EmptyState` / `ErrorState` / `ForbiddenView` | dengan/ tanpa aksi | — | heading jelas |
| `ConnectionIndicator` + `OfflineBanner` | online / degraded / offline | — | `role="status"` |
| `PageHeader` | judul + deskripsi + aksi utama (di-gate `can`); breadcrumb ada di header shell | — | satu `h1` per halaman |
| `Menu` / `MenuItem` (`components/ui/menu.tsx`) | aksi baris (⋯), menu akun; item `tone="danger"` | open/closed, item disabled | Popover API (top layer, tak terpotong `overflow`), pola WAI-ARIA menu button: panah/Home/End, `Esc`, fokus kembali ke pemicu |
| `Pager` | kaki tabel (jumlah item, `Hal x dari y`, ‹ ›) | awal/akhir (disabled) | tombol ikon berlabel |

Aturan pola:
- **Feedback tidak pernah hanya warna**: selalu ikon + teks; di handheld ditambah suara & getar (operator buta warna / area bising).
- **Error API** ditampilkan berdasarkan `error.reason` (i18n `errors.<reason>`), bukan `message` mentah.
- **Aksi destruktif/final** (confirm, cancel, scrap, adjustment) → `HoldToConfirm` di handheld, `ConfirmDialog` di desktop.
- **Qty** selalu lewat `UomQuantity`/`QtyStepper` (tak pernah `Number()` langsung pada string qty).
- **Kode** selalu lewat `CodeText`.

### 4.5 Aksesibilitas (target WCAG 2.1 AA; handheld hc ≈ AAA kontras)

Kontras dijaga gate CI (§3.3); navigasi keyboard penuh di desktop; fokus terlihat (`--ring`, 2px/3px); label form eksplisit; `lang` sesuai locale; axe di test komponen & e2e.

### 4.6 Shell & gaya visual "Calm workspace" (v0.2)

| Area | Aturan |
|---|---|
| Shell desktop (≥ md) | Sidebar menyatu dengan kanvas `--background` (tanpa garis batas); konten di **lembar** `--surface-1` membulat (`rounded-2xl`, `shadow-sheet`, jarak 8px) yang menjadi wadah scroll sendiri — header lengket di dalamnya. |
| Header | Breadcrumb grup › halaman diturunkan dari katalog menu (tautan bila di halaman detail) + menu akun (avatar inisial → nama/role, pilihan tema terang/gelap/kontras tinggi, keluar). Header **tanpa** `backdrop-filter` (membuat laci `fixed` terkurung). |
| Sidebar | Item aktif = "chip" `--surface-1` + `shadow-xs` + ring; grup bisa dilipat (preferensi di `localStorage`, grup yang memuat rute aktif selalu terbuka). |
| Mobile (< md) | Lembar penuh layar, scroll di body; laci menu memakai kanvas + `shadow-popover`. |
| Dashboard | Tile berikon; nilai 0 diredam (`muted`); tile tautan menampilkan panah saat hover; warna status hanya untuk yang butuh tindakan. |
| Tabel | Kelas bersama `tableFrame` / `tableHead` / `tableRow` (ekspor `data-table.tsx`) untuk tabel rakitan; hover baris; aksi baris ≥ 2 → `Menu` ⋯. |
| Empty state | Ikon dalam lingkaran + judul (+ aksi), tanpa bingkai putus-putus. |
| Handheld | Tetap tema `hc` (≥ 7:1); pintasan = tile ikon 2 kolom (≥ 96px), tugas berikon per jenis, tugas milik sendiri ber-border primary. |

---

## 5. Menu (katalog FE × akses BE)

**Katalog menu = statis di FE** (`src/config/app.config.ts`): struktur, hierarki, label (i18n key), ikon, route. BE hanya mengirim `menuAccess`. Tabel `menu` di DB = registri kode untuk matriks RBAC (label di UI matriks diambil dari i18n katalog FE).

### 5.1 Katalog statis

```ts
export const NAV: NavItem[] = [
  { key: 'dashboard', href: '/dashboard', icon: 'layout-dashboard', titleKey: 'nav.dashboard' },
  { key: 'inbound', icon: 'arrow-down-to-line', titleKey: 'nav.inbound', children: [
      { key: 'inbound_orders',   href: '/inbound/orders',   titleKey: 'nav.inbound_orders' },
      { key: 'inbound_receipts', href: '/inbound/receipts', titleKey: 'nav.inbound_receipts' },
      { key: 'inbound_putaway',  href: '/inbound/putaway',  titleKey: 'nav.inbound_putaway' },
  ]},
  // ... internal, outbound (+ outbound_scrap_approval), inventory, master (+ master_reason_codes),
  //     config, reports, admin (+ admin_integration)
];
// Handheld: rute /hh/* dipetakan ke menu desktop yang sama (HH_ROUTE_MENU di lib/authz/route-access.ts)
export const HH_ROUTE_MENU = {
  '/hh/receipt': 'inbound_receipts', '/hh/putaway': 'inbound_putaway', '/hh/picking': 'outbound_picking',
  '/hh/transfer': 'internal_transfers', '/hh/carton-break': 'internal_carton_break',
  '/hh/quarantine': 'internal_quarantine', '/hh/scrap': 'outbound_scrap', '/hh/adjustment': 'inventory_adjustment',
} as const;
```
`key` = `menu.code` (konvensi §2.1). Ikon = nama lucide yang sama dengan kolom `menu.icon` di seed.

### 5.2 Akses dari BE saat login

```json
{ "user": {...}, "roles": ["OPERATOR"],
  "menuAccess": { "dashboard": {"view":true},
                  "inbound_receipts": {"view":true,"create":true,"edit":true,"delete":false} },
  "flags": { "enable_batch": true, "fefo_policy": "warn" } }
```
Menu yang tidak dikirim = deny. Fitur yang flag-nya mati **tidak dikirim** oleh BE (satu sumber); FE tidak perlu logika flag untuk menu, tapi memakai `flags` untuk kolom/field (batch, expiry).

### 5.3 Bangun navigasi = katalog ∩ akses

```ts
const permissionMap = toBitmask(menuAccess);            // view→1, create→2, edit→4, delete→8
const nav = buildAuthorizedNavigation(permissionMap);   // filter katalog by can(view)
```
- Item tampil bila `can(map, key, READ)`; grup tampil bila ≥1 anak tampil (FR-ADM-6).
- `iconOf(name)` memetakan string → lucide dengan fallback. Label via next-intl.

### 5.4 Permission bitmask

`{READ:1, CREATE:2, EDIT:4, DELETE:8}`. Aksi khusus (approve) fase 1 = **menu terpisah** (`outbound_scrap_approval` → EDIT), bukan bit tambahan; tabel permission granular = fase 2 (SC-2).

---

## 6. Auth Guarding

### 6.1 Lapisan

| Lapis | Tugas | Catatan |
|---|---|---|
| `middleware.ts` | set header pathname **ke request**, refresh token bila access habis, redirect ke `/login` bila tak ada sesi | ringan, tanpa DB (verifikasi JWT via `jose`, refresh via fetch internal) |
| `(protected)/layout.tsx`, `hh/layout.tsx` | `requireSession()` + shell | **bukan** tempat RBAC route (layout tidak re-render saat soft navigation) |
| **`page.tsx`** | `requirePageAccess(menuKey)` → `forbidden`/redirect | dijalankan tiap navigasi (RSC payload per page) |
| Server action / route handler | `requirePermission(menuKey, action)` / RBAC per optype (API §1.4) | otoritatif |

### 6.2 Proxy (`src/proxy.ts`, Next ≥ 16; dulu `middleware.ts`)

Terimplementasi di M0 (`apps/web/src/proxy.ts`). Tanpa DB, runtime Node.js:

```ts
export async function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set('x-request-pathname', req.nextUrl.pathname);           // ke RSC lewat REQUEST headers
  const pass = () => NextResponse.next({ request: { headers } });     // ⚠ bukan res.headers.set(...)
  if (isPublic(req.nextUrl.pathname)) return pass();
  if (!(await validAccess(req.cookies.get('access_token')?.value)))   // jose, tanpa DB
    return NextResponse.redirect(`/api/v1/auth/refresh?next=${path}`); // rotasi → kembali ke `next`
  const view = await unsealSession(req.cookies.get('user_session')?.value);
  if (!view) return NextResponse.redirect(`/api/v1/auth/refresh?next=${path}`);
  if (view.user.must_change_password && path !== '/change-password') return NextResponse.redirect('/change-password');
  return pass();
}
export const config = { matcher: ['/((?!api|_next/static|_next/image|branding|favicon.ico|.*\\.(?:svg|png|jpg|ico|webmanifest)$).*)'] };
```
- **Rotasi refresh tidak dilakukan di proxy.** Cookie `refresh_token` sengaja ber-path sempit `/api/v1/auth` (tidak ikut terkirim ke navigasi halaman), jadi proxy mengarahkan ke `GET /api/v1/auth/refresh?next=…`, yang merotasi token lalu redirect balik. `next` hanya menerima path relatif (anti open-redirect). Biayanya satu redirect tambahan kira-kira tiap 15 menit.
- Fetch klien memakai `POST /api/v1/auth/refresh` dengan single-flight (`services/http.ts`).

### 6.3 Guard per page

```tsx
// app/(protected)/inbound/receipts/page.tsx  (dibuat generator)
export default async function Page() {
  await requirePageAccess('inbound_receipts');          // session + can(view) → forbidden()/redirect('/forbidden')
  return <InboundReceiptsFeature />;
}
```
- `forbidden()` memerlukan `experimental.authInterrupts` pada Next 15; bila versi terkunci belum stabil, pakai `redirect('/forbidden')`.
- Halaman detail memakai menu induknya (`/inbound/receipts/[id]` → `inbound_receipts`); handheld via `HH_ROUTE_MENU` (longest-prefix).
- Lint rule `require-page-guard`: setiap `page.tsx` di `(protected)`/`hh` wajib memanggil `requirePageAccess`.

---

## 7. Session Management

Next.js **adalah** backend WMS; token diterbitkan WMS sendiri dan disimpan di cookie (detail kontrak di auth-session §5).

### 7.1 Cookie
| Cookie | httpOnly | Isi | Umur |
|---|---|---|---|
| `access_token` | ✅ | JWT akses | 15 mnt |
| `refresh_token` | ✅ | refresh (rotasi, path sempit `/api/v1/auth`) | 7 hari |
| `user_session` | ✅ | profil + `menuAccess` + flags, **tersegel** (JWE/iron-session) | = access (dibangun ulang tiap refresh) |
| `csrf_token` | ❌ | double-submit token | = refresh |

`sameSite=lax`, `secure` di produksi. Ukuran `user_session` dipantau (< 3 KB; `menuAccess` dikodekan ringkas `code:bitmask`).

### 7.2 Alur
- **Login:** `POST /api/v1/auth/login` → verifikasi → cookie. `must_change_password` → redirect `/change-password` (semua route lain diblok middleware).
- **Akses:** `getSession()` meng-unseal `user_session` **dan** memverifikasi `access_token` (keduanya wajib valid).
- **Refresh:** di middleware (navigasi) dan di `services/http` (fetch klien: 401 → satu refresh bersama → ulang request sekali). Grace window di server menoleransi balapan (auth-session §1).
- **Logout:** cabut family + hapus cookie.
- **CSRF:** `assertCsrfProtection` (same-origin + double-submit) untuk semua mutasi.

---

## 8. Client-side Permission Gating

```tsx
const { can } = useAuthz();                                  // dari user_session (hydrate via provider server)
{can('master_products', 'create') && <Button>Tambah Produk</Button>}
{can('outbound_scrap_approval', 'edit') && op.created_by !== me.id && <ApproveButton/>}
```
Gating klien hanya kosmetik; **backend wajib re-validasi** (FR-ADM-4), termasuk RBAC per optype & SELF_APPROVAL.

---

## 9. Konvensi Pendukung

- **Data fetching:** TanStack Query; query key di `constants/query-keys`. `services/http` otomatis: CSRF header, `Idempotency-Key` (UUID per aksi mutasi; disimpan ulang saat retry), `If-Match` dari `ETag` bila ada, parsing envelope → `ApiError{code, reason, details}`.
- **Form:** react-hook-form + zod schema dari `packages/contracts` (satu sumber).
- **Qty & angka:** qty = string desimal dari API; format tampilan via `lib/format/qty` (locale `id`: pemisah ribuan titik, desimal koma; nol trailing dibuang).
- **Tanggal & waktu:** timestamp UTC → tampil di **timezone warehouse** operasi (`lib/format/date`), bukan timezone browser; tanggal kalender (expiry) tampil apa adanya.
- **Error:** `reason` → pesan i18n + aksi (mis. `VERSION_CONFLICT` → tawarkan muat ulang; `FEFO_ACK_REQUIRED` → `ReasonPicker`; `FORBIDDEN` → `ForbiddenView`).
- **Export:** tombol export membuat job (`202`), toast "sedang disiapkan", poll `GET /reports/jobs/{id}`, toast unduh saat `DONE`.
- **i18n:** next-intl; `id` (default) + `en`; override brand di-merge. Multi-bahasa penuh = SC-6.
- **Loading global:** progress bar navigasi (`@bprogress/next`).

---

## 10. Pemetaan ke Referensi & Keputusan

### 10.1 Apa yang di-reuse dari `fe-access-backoffice-portal`
| Pola | File referensi | Adopsi WMS |
|---|---|---|
| Token theming 3-lapis | `src/app/globals.css` | Ya + token status/tipografi/density (§4); nilai brand di `brands/<id>` |
| Katalog menu statis | `src/config/app.config.ts` | Ya — kunci = `menu.code` (§2.1) |
| RBAC build navigation | `src/lib/authz/navigation.ts`, `types.ts` | Ya |
| `can()` bitmask | `src/lib/authz/permissions.ts` | Ya |
| Route guard | `src/lib/authz/server.ts` | Ya — dipanggil **per page**, bukan di layout |
| Session cookie + CSRF | `src/services/session/index.ts` | Ya (token terbit dari WMS; `user_session` tersegel) |
| Route groups public/protected | `src/app/(public|protected)` | Ya + segmen `hh/` |
| Feature-based + generator | `src/features/*`, `scripts/create-feature.mjs` | Ya (generator menulis guard) |
| Providers | `src/app/providers` | Ya |

### 10.2 Perbedaan sengaja
1. **Next.js = backend** → token diterbitkan WMS; route handler `/api/v1` = adapter ke use-case.
2. `/auth/login`+`/auth/me` mengembalikan **`menuAccess` + `flags`**, bukan pohon menu.
3. Guard RBAC di **page** (layout hanya sesi) & refresh di **middleware**.
4. Brand per klien di `brands/<id>` dipilih saat build (bukan edit berkas bersama).

### 10.3 Keputusan terkunci (frontend)
1. **Theming hardcoded di FE**: `brands/<id>/` (tokens, brand.ts, aset, override pesan) dipilih via `BRAND_ID` saat build; tidak ada `app_setting.theme_*` / halaman Branding. Shade dari skala brand; `--primary-foreground` eksplisit; **gate kontras CI**.
2. **Design system v0.2** (§4): token semantik status/quant/operasi, tipografi (Plus Jakarta Sans + JetBrains Mono self-host, tabular-nums, sentence case), shell "calm workspace" (§4.6), density compact/comfortable/handheld, target 44/56 px, elevation/motion/z-index; komponen blocks dengan state wajib; tema `hc` handheld; feedback tak hanya warna.
3. **Menu katalog statis di FE**, kunci = `menu.code` (konvensi route, tanpa singkatan, diverifikasi CI); BE mengirim `menuAccess` terfilter flag.
4. **Auth guard:** middleware (pathname via request headers + refresh) → layout (`requireSession`) → **page** (`requirePageAccess`, wajib via lint) → server (`requirePermission`/RBAC optype).
5. **Session:** cookie httpOnly access/refresh + `user_session` tersegel ber-TTL access + CSRF double-submit, `sameSite=lax`.
6. Gating klien (`can`) kosmetik; server otoritatif (FR-ADM-4).
7. **Feature-based (1 fitur = 1 page)**, generator scaffolding menulis guard & entri NAV.
8. Handheld di segmen nyata `/hh` (tanpa bentrok route desktop).
