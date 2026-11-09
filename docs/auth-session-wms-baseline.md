# Auth & Session — WMS Baseline

**Kontrak autentikasi, token, sesi, password & lockout**

Versi: 1.2 · 13 Oktober 2026 · Pembaruan 1.2 (M4, behavioral D-35): guard status tanpa cache, `LAST_ADMIN`/`SELF_ACTION`, reset password oleh admin, penerbitan API key lewat UI. Sebelumnya 1.1 · 24 September 2026: grace window rotasi refresh + single-flight, refresh di middleware (bukan Server Component), cookie `user_session` tersegel ber-TTL pendek, soft-delete user, mode cookie vs API key.

> Topik: token JWT + refresh, kebijakan password/lockout, logout/revoke, service account. Tabel terkait: `app_user` (kolom auth), `refresh_token`, `api_key`, `audit_log`. Implementasi FE (guard, cookie) di `frontend-design-wms-baseline.md` §6–7.

---

## 1. Token

- **Access token (JWT, `jose`):** umur pendek (15 mnt). Claims: `sub`(user id), `roles`, `jti`, `iat`, `exp`, `iss=wms`, `is_service`, `mcp` (must_change_password — selama true API hanya mengizinkan change-password/me/logout: `403 FORBIDDEN/MUST_CHANGE_PASSWORD`). **Menu & permission TIDAK di token** — diambil dari `GET /auth/me` / cookie `user_session` (§5).
- **Refresh token:** umur panjang (7 hari), **rotasi one-time-use**, disimpan sebagai **hash** di `refresh_token.token_hash`. Tiap refresh menerbitkan refresh baru (`replaced_by`), mengisi `used_at` pada token lama.
- **Deteksi reuse dengan grace window:**

  | Kondisi saat token lama dipakai lagi | Tindakan |
  |---|---|
  | `now − used_at ≤ refresh_reuse_grace_seconds` (default 30 s) | Balapan sah (multi-tab, query paralel, retry jaringan handheld) → terbitkan pasangan baru **tanpa** mencabut family; catat `audit_log` `REFRESH_RACE` |
  | Lewat grace window | Indikasi token dicuri → cabut **seluruh `family_id`** (`revoked=true`, `revoked_at`) + `audit_log` `REFRESH_REUSE` → 401 |
  | Token `revoked`/kedaluwarsa | 401 |

- **Single-flight di klien & middleware:** paling banyak satu refresh berjalan per tab/perangkat; request lain menunggu promise refresh yang sama (frontend §7.2). Grace window adalah jaring kedua.
- **Rahasia & TTL** (signing key, access TTL, refresh TTL, grace window) berada di **environment/secret store**, BUKAN `app_setting`. Saran: access 15 mnt, refresh 7 hari, grace 30 s.

## 2. Kebijakan password & lockout

| Aturan | Nilai (sebagian di `app_setting`) |
|---|---|
| Hash | argon2id (utama). Hash bcrypt (akun seed/impor) diverifikasi lalu **di-rehash ke argon2id** saat login sukses |
| Panjang min | 10 karakter |
| Kompleksitas | campuran huruf+angka; larang password umum (daftar top-10k) |
| Ganti saat login pertama | `app_user.must_change_password=true` → hanya `POST /auth/change-password` & logout yang diizinkan sampai diganti |
| Lockout | setelah `login_max_failed_attempts` (default 5) → `locked_until = now()+lockout_minutes` (default 15) |
| Reset counter | pada login sukses → `failed_login_count=0`, `locked_until=NULL` |
| Username tak dikenal | respons & waktu identik dengan password salah (anti user-enumeration) |

Semua peristiwa auth (LOGIN, LOGIN_FAILED, LOCK, UNLOCK, RESET_PASSWORD, CHANGE_PASSWORD, LOGOUT, REFRESH_REUSE) ditulis ke `audit_log` (`user_id` NULL bila username tak dikenal).

## 3. Logout, revoke, nonaktif

- `POST /auth/logout` → cabut **family** refresh aktif perangkat itu + hapus semua cookie.
- Admin `POST /admin/users/{id}/lock` atau `/deactivate` → `status=LOCKED|INACTIVE` + cabut semua refresh token user. User **tidak pernah di-DELETE** (dirujuk ledger immutable); status `INACTIVE` menolak login.
- Perubahan role/matriks RBAC berlaku di server seketika (guard membaca DB/cache server per request); di klien berlaku paling lambat saat refresh berikutnya (≤ 15 mnt) karena `user_session` dibangun ulang tiap refresh.
- Access token tetap valid sampai `exp`, tetapi **hak akses hanya dihitung untuk user `ACTIVE`** (dibaca dari DB tiap request, tanpa cache): user yang dikunci/dinonaktifkan ditolak `403` pada request berikutnya tanpa denylist `jti`.
- Admin tak bisa mengunci/menonaktifkan dirinya sendiri (`409 SELF_ACTION`); perubahan status, role, atau matriks yang menyisakan nol user manusia ACTIVE ber-hak edit Users **dan** Access Control ditolak `409 LAST_ADMIN`.
- `POST /admin/users/{id}/reset-password {new_password}`: admin mengisi password sementara (kebijakan §2), `must_change_password=true`, semua sesi user dicabut. User baru juga lahir dengan password sementara + `must_change_password=true`.

## 4. Service account (ERP)

- `app_user.is_service=true`, tanpa akses UI (`403 SERVICE_ACCOUNT_UI` pada endpoint UI), hanya lewat `api_key` (`X-API-Key`). Tidak tunduk lockout password.
- Dibuat lewat `POST /admin/users {is_service:true}` (tanpa password yang bisa dipakai login); key diterbitkan di menu Integration (`POST /admin/api-keys`) hanya untuk service account ACTIVE.
- Key: `key_prefix` (identifikasi) + `key_hash` (SHA-256); mentah (`wms_…`) ditampilkan sekali. Rotasi berkala: buat key baru → ERP pindah → `revoke` key lama.

## 5. Sesi web & handheld (cookie)

| Cookie | httpOnly | Isi | Umur |
|---|---|---|---|
| `access_token` | ✅ | JWT akses | 15 mnt |
| `refresh_token` | ✅ | refresh (path sempit `/api/v1/auth`) | 7 hari |
| `user_session` | ✅ | profil + `menuAccess` + flags, **tersegel** (JWE/iron-session, kunci dari env) | = access token (dibangun ulang tiap refresh) |
| `csrf_token` | ❌ | double-submit token | = refresh |

- `sameSite=lax` + CSRF double-submit untuk semua mutasi (lax agar tautan masuk dari email/bookmark tetap membawa sesi; mutasi tetap dilindungi CSRF). `secure` di produksi.
- **Refresh hanya di route handler** `/api/v1/auth/refresh`, **bukan** di Server Component (RSC tidak bisa menulis cookie) dan bukan di proxy (cookie refresh ber-path sempit). Navigasi: proxy → `GET /api/v1/auth/refresh?next=…` → redirect balik. Fetch: `POST` + single-flight (frontend §6.2).
- `user_session` hanya cache tampilan; keputusan otorisasi server selalu dari DB (`role_menu_access`, dengan cache server pendek).

---

## Ringkasan Keputusan (auth)

1. Access JWT 15 mnt + refresh 7 hari **rotasi one-time-use** dengan deteksi reuse, **grace window 30 s** & single-flight. Rahasia/TTL di environment.
2. Refresh di middleware/route handler; cookie `user_session` tersegel ber-TTL = access token; RBAC server selalu dari DB.
3. argon2id (rehash bcrypt saat login); lockout & kebijakan password via `app_user` + `app_setting`; semua peristiwa auth ke `audit_log`.
4. User tidak di-hard-delete (deactivate); lock/deactivate mencabut semua sesi.
5. Service account ERP lewat `api_key`, tanpa akses UI.
