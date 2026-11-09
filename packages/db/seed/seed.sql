-- =============================================================
-- WMS v2 BOILERPLATE — DATA SEED (instalasi awal)
-- Target: PostgreSQL 14+ · dijalankan SETELAH migrasi (pnpm db:migrate)
-- Idempoten: ON CONFLICT ... DO NOTHING → aman dijalankan ulang.
-- Referensi antar-baris memakai lookup by code/key (bukan UUID hardcode).
-- =============================================================

BEGIN;

-- =============================================================
-- 1. FEATURE FLAG & KEBIJAKAN (app_setting)
-- `enable_*` (boolean) dikirim ke FE lewat /auth/me → flags. Menu yang terikat flag
-- (lihat MENU_FLAGS di packages/application/src/use-cases/authorize.ts) hilang saat flag mati.
-- =============================================================
INSERT INTO app_setting (key, value, data_type, description) VALUES
  ('enable_sample_items',       'true', 'boolean', 'Contoh feature flag: tampilkan menu Sample Items'),
  ('login_max_failed_attempts', '5',    'integer', 'Ambang gagal login sebelum akun terkunci'),
  ('lockout_minutes',           '15',   'integer', 'Durasi kunci akun setelah gagal login berturut (menit)')
ON CONFLICT (key) DO NOTHING;

-- =============================================================
-- 2. MENU (induk dulu, lalu submenu)
-- Konvensi kode = route tanpa '/' awal, '/' dan '-' → '_'. Kode induk = kode "module".
-- Tambah halaman baru = tambah baris di sini + di katalog FE (apps/web/src/config/app.config.ts).
-- =============================================================
INSERT INTO menu (code, name, route, parent_id, icon, sort_order) VALUES
  ('sample', 'Sample',         NULL, NULL, 'box',    1),
  ('admin',  'Administration', NULL, NULL, 'shield', 9)
ON CONFLICT (code) DO NOTHING;

INSERT INTO menu (code, name, route, parent_id, sort_order)
SELECT c.code, c.name, c.route, p.id, c.sort_order
FROM (VALUES
  ('sample_items', 'Sample Items', '/sample/items', 'sample', 1),
  ('admin_users',  'Users',        '/admin/users',  'admin',  1)
) AS c(code, name, route, parent_code, sort_order)
JOIN menu p ON p.code = c.parent_code
ON CONFLICT (code) DO NOTHING;

-- =============================================================
-- 3. ROLE
-- =============================================================
INSERT INTO role (code, name, description) VALUES
  ('ADMIN', 'Administrator', 'Akses penuh seluruh menu, termasuk kelola user'),
  ('STAFF', 'Staff',         'Pengguna biasa: Sample Items tanpa hak hapus; tanpa akses Administration')
ON CONFLICT (code) DO NOTHING;

-- =============================================================
-- 4. MATRIKS RBAC (role_menu_access)
-- Dua lapis:
--   (a) OVERRIDE per-submenu — di-insert DULU sehingga menang; baris all-false = deny eksplisit.
--   (b) GRANT per-modul — di-expand ke menu induk + semua submenu yang belum punya baris.
-- deny-by-default: tanpa baris = tanpa akses (STAFF tak punya baris admin_* → tak bisa buka Users).
-- =============================================================
WITH override_matrix(menu_code, role_code, v, c, e, d) AS (
  VALUES
    -- STAFF: lihat/tambah/ubah, TANPA hapus
    ('sample_items', 'STAFF', true, true, true, false)
),
module_matrix(module_code, role_code, v, c, e, d) AS (
  VALUES
    ('sample', 'ADMIN', true, true, true, true),
    ('admin',  'ADMIN', true, true, true, true)
),
ins_override AS (
  INSERT INTO role_menu_access (role_id, menu_id, can_view, can_create, can_edit, can_delete)
  SELECT r.id, m.id, o.v, o.c, o.e, o.d
  FROM override_matrix o
  JOIN role r ON r.code = o.role_code
  JOIN menu m ON m.code = o.menu_code
  ON CONFLICT (role_id, menu_id) DO NOTHING
  RETURNING role_id, menu_id
),
menu_module AS (
  SELECT m.id AS menu_id, m.code AS menu_code, COALESCE(p.code, m.code) AS module_code
  FROM menu m
  LEFT JOIN menu p ON m.parent_id = p.id
)
INSERT INTO role_menu_access (role_id, menu_id, can_view, can_create, can_edit, can_delete)
SELECT r.id, mm.menu_id, g.v, g.c, g.e, g.d
FROM module_matrix g
JOIN role r         ON r.code = g.role_code
JOIN menu_module mm ON mm.module_code = g.module_code
WHERE NOT EXISTS (                         -- override menang (CTE data-modifying tak terlihat oleh SELECT lain)
  SELECT 1 FROM override_matrix o
  WHERE o.menu_code = mm.menu_code AND o.role_code = g.role_code
)
ON CONFLICT (role_id, menu_id) DO NOTHING;

-- =============================================================
-- 5. USER AWAL
-- Password awal keduanya: ChangeMe123!  (bcrypt cost 12) — WAJIB diganti saat login pertama
-- (must_change_password default TRUE). Hash bcrypt di-upgrade ke argon2id saat login sukses.
-- =============================================================
INSERT INTO app_user (username, email, password_hash, full_name, status) VALUES
  ('admin', 'admin@example.com', '$2b$12$FqcKMwZa.BNxSfDTihLuqeHNjv94uyaz9JIZD85RBb0lnZ24URwQu', 'System Administrator', 'ACTIVE'),
  ('staff', 'staff@example.com', '$2b$12$FqcKMwZa.BNxSfDTihLuqeHNjv94uyaz9JIZD85RBb0lnZ24URwQu', 'Staff Demo',           'ACTIVE')
ON CONFLICT (username) DO NOTHING;

INSERT INTO user_role (user_id, role_id)
SELECT u.id, r.id
FROM (VALUES ('admin', 'ADMIN'), ('staff', 'STAFF')) AS x(username, role_code)
JOIN app_user u ON u.username = x.username
JOIN role r     ON r.code = x.role_code
ON CONFLICT (user_id, role_id) DO NOTHING;

COMMIT;

-- =============================================================
-- CATATAN:
-- - Ganti password admin & staff segera (dipaksa saat login pertama).
-- - Di produksi, nonaktifkan/hapus user `staff` bila tidak dipakai (halaman Users → Nonaktifkan).
-- - Seed ini idempoten: aman dijalankan ulang (ON CONFLICT DO NOTHING).
-- =============================================================
