-- =============================================================
-- WMS BASELINE — DATA SEED (instalasi awal)
-- Target: PostgreSQL 14+ · dijalankan SETELAH schema-wms-baseline.sql (v1.4)
-- Idempotent: memakai ON CONFLICT (code/key) DO NOTHING di mana relevan.
-- Referensi antar-baris memakai lookup by code/key (bukan UUID hardcode).
-- Perubahan v1.4: kode menu mengikuti konvensi route (tanpa singkatan), ikon lucide,
--   menu Scrap Approval & Reason Codes & Integration, grant per-submenu (ERP hanya order,
--   order manual hanya admin), operation type baru (QA release/reject, mark damaged,
--   ADJ_GAIN/ADJ_LOSS) + pemetaan menu RBAC, lokasi INV-ADJUST, reason code default,
--   flag scrap_require_approval dihapus (sumber tunggal: operation_type.require_approval).
-- =============================================================

BEGIN;

-- =============================================================
-- 1. FEATURE FLAG & KEBIJAKAN (app_setting)
-- Default di bawah = profil "full-featured" (cocok untuk farmasi).
-- Matikan yang tidak diperlukan per instalasi (mis. retail: batch/expiry/fefo/quarantine=false).
-- Flag efektif fitur per produk = flag global AND flag produk (product.use_*).
-- =============================================================
INSERT INTO app_setting (key, value, data_type, description) VALUES
  ('enable_batch',        'true',    'boolean', 'Aktifkan batch/lot'),
  ('enable_expiry',       'true',    'boolean', 'Aktifkan tanggal kadaluarsa'),
  ('enable_fefo',         'true',    'boolean', 'Aktifkan saran FEFO saat picking'),
  ('enable_serial',       'true',    'boolean', 'Aktifkan serialisasi item (Pack S/N)'),
  ('enable_lpn',          'true',    'boolean', 'Aktifkan Pallet LPN'),
  ('enable_carton_break', 'true',    'boolean', 'Aktifkan operasi Carton Break'),
  ('enable_quarantine',   'true',    'boolean', 'Aktifkan status & alur QA/Quarantine'),
  ('enable_multi_site',   'false',   'boolean', 'Aktifkan banyak site; false = satu default site'),
  ('fefo_policy',         'warn',    'string',  'Batch bukan saran FEFO: warn (wajib ack + reason) | block'),
  ('over_receipt_tolerance_pct', '0', 'integer','Toleransi terima melebihi qty PO (persen)'),
  ('default_min_shelf_life_days', '0', 'integer', 'Sisa umur simpan min default saat kirim (bila partner.min_shelf_life_days NULL); 0 = tidak dicek'),
  ('qa_on_receipt',       'false',   'boolean', 'Barang masuk default berstatus QUARANTINE (butuh enable_quarantine)'),
  ('ref_no_format',       '{TYPE}-{YYYY}-{seq:05}', 'string', 'Format nomor dokumen operasi; reset sekuens per tahun (zona waktu warehouse)'),
  ('lpn_code_format',     'LPN-{seq:07}', 'string', 'Format kode LPN; {seq:0N} = sekuens ber-padding N digit'),
  ('serial_code_format',  'SN-{seq:07}',  'string', 'Format kode Pack S/N; {seq:0N} = sekuens ber-padding N digit'),
  ('login_max_failed_attempts', '5', 'integer', 'Ambang gagal login sebelum akun terkunci'),
  ('lockout_minutes',     '15',      'integer', 'Durasi kunci akun setelah gagal login berturut (menit)'),
  ('label_dpi',           '203',     'integer', 'Resolusi printer label Zebra (203 | 300)'),
  ('label_print_service_url', '',    'string',  'URL print service lokal (mis. Zebra Browser Print / agen cetak); kosong = unduh ZPL/PDF'),
  ('claim_ttl_minutes',   '120',     'integer', 'Klaim tugas handheld kedaluwarsa bila tak ada aktivitas (menit)')
  -- Catatan: branding (warna/logo/nama app/bahasa) TIDAK di DB — hardcoded di codebase FE
  -- (lihat frontend-design-wms-baseline.md §3). Rahasia & TTL token di environment.
ON CONFLICT (key) DO NOTHING;

-- =============================================================
-- 2. UNIT OF MEASURE (standar)
-- =============================================================
INSERT INTO uom (name, category) VALUES
  ('Pcs',     'unit'),
  ('Box',     'unit'),
  ('Carton',  'unit'),
  ('Pallet',  'unit')
ON CONFLICT (name) DO NOTHING;

-- =============================================================
-- 3. SITE / WAREHOUSE / LOKASI DEFAULT
-- Instalasi satu pabrik cukup pakai default site & warehouse ini.
-- Lokasi sistem WAJIB ada karena dirujuk operation type.
-- =============================================================
INSERT INTO site (code, name, address) VALUES
  ('MAIN', 'Default Site', '-')
ON CONFLICT (code) DO NOTHING;

INSERT INTO warehouse (site_id, code, name, timezone)
SELECT s.id, 'WH-MAIN', 'Main Warehouse', 'Asia/Jakarta'
FROM site s WHERE s.code = 'MAIN'
ON CONFLICT (code) DO NOTHING;

-- 3a. Lokasi SISTEM (GLOBAL): warehouse_id NULL, is_system=true.
INSERT INTO location (warehouse_id, code, type, is_system, is_usable)
VALUES
  (NULL, 'VIRT-SUPPLIER',  'VIRTUAL_SUPPLIER',  true, true),
  (NULL, 'VIRT-CUSTOMER',  'VIRTUAL_CUSTOMER',  true, true),
  (NULL, 'SCRAP',          'SCRAP',             true, true),
  (NULL, 'PRODUCTION',     'PRODUCTION',        true, true),
  (NULL, 'IN-TRANSIT',     'IN_TRANSIT',        true, true),
  (NULL, 'VIRT-TRANSFORM', 'VIRTUAL_TRANSFORM', true, true),   -- konsumsi/produksi carton break
  (NULL, 'INV-ADJUST',     'INVENTORY_ADJUST',  true, true)    -- sisi lawan adjustment gain/loss
ON CONFLICT (code) WHERE warehouse_id IS NULL DO NOTHING;

-- 3b. Lokasi OPERASIONAL contoh (terikat WH-MAIN)
INSERT INTO location (warehouse_id, code, type, is_usable)
SELECT w.id, v.code, v.type::location_type, v.usable
FROM warehouse w
CROSS JOIN (VALUES
  ('DOCK-01',       'DOCK',             true),
  ('STAGE-01',      'STAGING',          true),
  ('QA-01',         'QUARANTINE',       true),
  ('A-01-01-01',    'STOCK',            true),
  ('A-01-01-02',    'STOCK',            true)
) AS v(code, type, usable)
WHERE w.code = 'WH-MAIN'
ON CONFLICT (warehouse_id, code) WHERE warehouse_id IS NOT NULL DO NOTHING;

-- =============================================================
-- 4. MENU (induk dulu, lalu submenu)
-- Konvensi kode = route tanpa '/' awal, '/' dan '-' → '_'. Kode induk = kode "module".
-- Ikon = nama ikon lucide (sama dengan katalog FE; informatif untuk UI matriks akses).
-- Harus di-seed SEBELUM operation_type (FK operation_type.menu_code → menu.code).
-- =============================================================
INSERT INTO menu (code, name, route, parent_id, icon, sort_order) VALUES
  ('dashboard', 'Dashboard',      '/dashboard', NULL, 'layout-dashboard',   1),
  ('inbound',   'Inbound',        NULL,         NULL, 'arrow-down-to-line', 2),
  ('internal',  'Internal',       NULL,         NULL, 'arrow-left-right',   3),
  ('outbound',  'Outbound',       NULL,         NULL, 'arrow-up-from-line', 4),
  ('inventory', 'Inventory',      NULL,         NULL, 'boxes',              5),
  ('master',    'Master Data',    NULL,         NULL, 'database',           6),
  ('config',    'Configuration',  NULL,         NULL, 'settings',           7),
  ('reports',   'Reports',        NULL,         NULL, 'chart-column',       8),
  ('admin',     'Administration', NULL,         NULL, 'shield',             9)
ON CONFLICT (code) DO NOTHING;

INSERT INTO menu (code, name, route, parent_id, sort_order)
SELECT c.code, c.name, c.route, p.id, c.sort_order
FROM (VALUES
  ('inbound_orders',          'Purchase Orders',     '/inbound/orders',          'inbound',   1),
  ('inbound_receipts',        'Receipts',            '/inbound/receipts',        'inbound',   2),
  ('inbound_putaway',         'Putaway',             '/inbound/putaway',         'inbound',   3),
  ('internal_transfers',      'Transfers',           '/internal/transfers',      'internal',  1),
  ('internal_carton_break',   'Carton Break',        '/internal/carton-break',   'internal',  2),
  ('internal_quarantine',     'Quarantine / QA',     '/internal/quarantine',     'internal',  3),
  ('outbound_orders',         'Sales Orders',        '/outbound/orders',         'outbound',  1),
  ('outbound_picking',        'Picking',             '/outbound/picking',        'outbound',  2),
  ('outbound_deliveries',     'Deliveries',          '/outbound/deliveries',     'outbound',  3),
  ('outbound_scrap',          'Scrap / Issue',       '/outbound/scrap',          'outbound',  4),
  ('outbound_scrap_approval', 'Scrap Approval',      '/outbound/scrap-approval', 'outbound',  5),
  ('inventory_stock',         'Stock on Hand',       '/inventory/stock',         'inventory', 1),
  ('inventory_units',         'Handling Units',      '/inventory/units',         'inventory', 2),
  ('inventory_trace',         'Traceability Lookup', '/inventory/trace',         'inventory', 3),
  ('inventory_adjustment',    'Stock Adjustment',    '/inventory/adjustment',    'inventory', 4),
  ('master_products',         'Products',            '/master/products',         'master',    1),
  ('master_uom',              'UOM & Packaging',     '/master/uom',              'master',    2),
  ('master_sites',            'Sites & Warehouses',  '/master/sites',            'master',    3),
  ('master_locations',        'Locations',           '/master/locations',        'master',    4),
  ('master_partners',         'Partners',            '/master/partners',         'master',    5),
  ('master_batches',          'Batches',             '/master/batches',          'master',    6),
  ('master_reason_codes',     'Reason Codes',        '/master/reason-codes',     'master',    7),
  ('config_operation_types',  'Operation Types',     '/config/operation-types',  'config',    1),
  ('config_settings',         'App Settings',        '/config/settings',         'config',    2),
  ('reports_stock',           'Stock Report',        '/reports/stock',           'reports',   1),
  ('reports_movement',        'Movement / Ledger',   '/reports/movement',        'reports',   2),
  ('reports_traceability',    'Traceability Report', '/reports/traceability',    'reports',   3),
  ('admin_users',             'Users',               '/admin/users',             'admin',     1),
  ('admin_roles',             'Roles',               '/admin/roles',             'admin',     2),
  ('admin_access',            'Access Control',      '/admin/access',            'admin',     3),
  ('admin_audit',             'Audit Log',           '/admin/audit',             'admin',     4),
  ('admin_integration',       'Integration Events',  '/admin/integration',       'admin',     5)
) AS c(code, name, route, parent_code, sort_order)
JOIN menu p ON p.code = c.parent_code
ON CONFLICT (code) DO NOTHING;

-- =============================================================
-- 5. REASON CODE default (dapat ditambah via Master Data > Reason Codes)
-- =============================================================
INSERT INTO reason_code (code, name, applies_to) VALUES
  ('DMG_HANDLING',  'Rusak saat handling',          'SCRAP'),
  ('EXPIRED',       'Kedaluwarsa',                  'SCRAP'),
  ('QA_FAILED',     'Gagal QA',                     'SCRAP'),
  ('PROD_ISSUE',    'Pemakaian produksi',           'ISSUE'),
  ('COUNT_GAIN',    'Selisih hitung (lebih)',       'ADJUST'),
  ('COUNT_LOSS',    'Selisih hitung (kurang)',      'ADJUST'),
  ('TRANSIT_LOSS',  'Hilang/rusak dalam perjalanan','ADJUST'),
  ('QA_SUSPECT',    'Dicurigai cacat / recall',     'QA'),
  ('QA_REJECT',     'Ditolak QA',                   'QA'),
  ('FEFO_NEAR_BIN', 'Batch saran tak terjangkau',   'FEFO_OVERRIDE'),
  ('FEFO_DAMAGED',  'Batch saran rusak',            'FEFO_OVERRIDE')
ON CONFLICT (code) DO NOTHING;

-- =============================================================
-- 6. OPERATION TYPE BASELINE (turunan dari 3 direction)
-- menu_code (aksi umum), confirm_menu_code (confirm), approve_menu_code (approve) →
-- dasar RBAC endpoint generik /operations/{id}/* (api-design §1.4).
-- QA-01 TIDAK dijadikan default dest (terikat satu warehouse) — bin QA dipilih via scan.
-- =============================================================
INSERT INTO operation_type (code, name, direction, require_approval, require_reason,
                            allowed_from_status, to_status,
                            default_src_location_id, default_dest_location_id,
                            menu_code, confirm_menu_code, approve_menu_code)
SELECT v.code, v.name, v.direction::op_direction, v.appr, v.reason,
       v.from_st::quant_status[], v.to_st::quant_status,
       (SELECT id FROM location WHERE code = v.src  AND warehouse_id IS NULL),
       (SELECT id FROM location WHERE code = v.dest AND warehouse_id IS NULL),
       v.menu, v.cmenu, v.amenu
FROM (VALUES
  -- code,              name,                        dir,        appr,  reason, from_st,                          to_st,        src,             dest,            menu,                    confirm_menu,          approve_menu
  ('RCV_SUPPLIER',     'Receipt from Supplier',     'INCOMING', false, false, '{AVAILABLE}',                     NULL,         'VIRT-SUPPLIER', NULL,            'inbound_receipts',      'inbound_putaway',     NULL),
  ('RCV_PRODUCTION',   'Receipt from Production',   'INCOMING', false, false, '{AVAILABLE}',                     NULL,         'PRODUCTION',    NULL,            'inbound_receipts',      'inbound_putaway',     NULL),
  ('RCV_RETURN',       'Customer Return',           'INCOMING', false, true,  '{AVAILABLE}',                     NULL,         'VIRT-CUSTOMER', NULL,            'inbound_receipts',      'inbound_putaway',     NULL),
  ('INT_TRANSFER',     'Bin-to-Bin Transfer',       'INTERNAL', false, false, '{AVAILABLE,QUARANTINE,DAMAGED}',  NULL,         NULL,            NULL,            'internal_transfers',    NULL,                  NULL),
  ('INT_INTERSITE',    'Inter-Site Transfer',       'INTERNAL', false, false, '{AVAILABLE}',                     NULL,         NULL,            'IN-TRANSIT',    'internal_transfers',    NULL,                  NULL),
  ('INT_CARTON_BREAK', 'Carton Break',              'INTERNAL', false, false, '{AVAILABLE}',                     NULL,         NULL,            NULL,            'internal_carton_break', NULL,                  NULL),
  ('INT_QA_HOLD',      'Move to Quarantine',        'INTERNAL', false, true,  '{AVAILABLE}',                     'QUARANTINE', NULL,            NULL,            'internal_quarantine',   NULL,                  NULL),
  ('INT_QA_RELEASE',   'Quarantine Release',        'INTERNAL', false, false, '{QUARANTINE}',                    'AVAILABLE',  NULL,            NULL,            'internal_quarantine',   NULL,                  NULL),
  ('INT_QA_REJECT',    'Quarantine Reject',         'INTERNAL', false, true,  '{QUARANTINE}',                    'DAMAGED',    NULL,            NULL,            'internal_quarantine',   NULL,                  NULL),
  ('INT_MARK_DAMAGED', 'Mark as Damaged',           'INTERNAL', false, true,  '{AVAILABLE}',                     'DAMAGED',    NULL,            NULL,            'internal_quarantine',   NULL,                  NULL),
  ('OUT_DELIVERY',     'Customer Delivery',         'OUTGOING', false, false, '{AVAILABLE}',                     NULL,         NULL,            'VIRT-CUSTOMER', 'outbound_picking',      'outbound_deliveries', NULL),
  ('OUT_ISSUE_PROD',   'Issue to Production',       'OUTGOING', false, true,  '{AVAILABLE}',                     NULL,         NULL,            'PRODUCTION',    'outbound_scrap',        NULL,                  NULL),
  ('OUT_SCRAP',        'Scrap / Damage Out',        'OUTGOING', true,  true,  '{AVAILABLE,DAMAGED,QUARANTINE}',  NULL,         NULL,            'SCRAP',         'outbound_scrap',        NULL,                  'outbound_scrap_approval'),
  ('ADJ_GAIN',         'Adjustment Gain',           'INCOMING', false, true,  '{AVAILABLE}',                     NULL,         'INV-ADJUST',    NULL,            'inventory_adjustment',  NULL,                  NULL),
  ('ADJ_LOSS',         'Adjustment Loss',           'OUTGOING', false, true,  '{AVAILABLE,QUARANTINE,DAMAGED}',  NULL,         NULL,            'INV-ADJUST',    'inventory_adjustment',  NULL,                  NULL)
) AS v(code, name, direction, appr, reason, from_st, to_st, src, dest, menu, cmenu, amenu)
ON CONFLICT (code) DO NOTHING;

-- =============================================================
-- 7. ROLE BASELINE
-- =============================================================
INSERT INTO role (code, name, description) VALUES
  ('SUPER_ADMIN',    'Super Admin',          'Akses penuh seluruh modul; di-seed saat instalasi'),
  ('SUPERVISOR',     'Supervisor',           'Jalankan & pantau operasi, approve scrap, laporan'),
  ('OPERATOR',       'Operator',             'Pengguna handheld: eksekusi inbound/internal/outbound'),
  ('INV_CONTROLLER', 'Inventory Controller', 'Kelola master data & penyesuaian stok'),
  ('AUDITOR',        'Auditor',              'Read-only seluruh modul untuk audit/compliance'),
  ('ERP_INTEGRATION','ERP Integration',      'Service account integrasi ERP: hanya PO/SO (Purchase Orders & Sales Orders)')
ON CONFLICT (code) DO NOTHING;

-- =============================================================
-- 8. MATRIKS RBAC (role_menu_access)
-- Dua lapis:
--   (a) OVERRIDE per-submenu (menu_code spesifik) — di-insert DULU sehingga menang;
--       baris all-false = deny eksplisit (mis. operator tak boleh approve scrap).
--   (b) GRANT per-modul — di-expand ke menu induk + semua submenu yang belum punya baris.
-- deny-by-default: tanpa baris = tanpa akses.
-- =============================================================
WITH override_matrix(menu_code, role_code, v, c, e, d) AS (
  VALUES
    -- Order dari ERP: dibuat/diubah hanya oleh ERP & Super Admin; pengguna lain read-only
    ('inbound_orders',  'ERP_INTEGRATION', true, true, true, false),
    ('outbound_orders', 'ERP_INTEGRATION', true, true, true, false),
    ('inbound_orders',  'SUPERVISOR',      true, false,false,false),
    ('outbound_orders', 'SUPERVISOR',      true, false,false,false),
    ('inbound_orders',  'OPERATOR',        true, false,false,false),
    ('outbound_orders', 'OPERATOR',        true, false,false,false),
    -- Approval scrap: hanya Supervisor (+ Super Admin via modul); operator deny eksplisit
    ('outbound_scrap_approval', 'SUPERVISOR',     true, false, true, false),
    ('outbound_scrap_approval', 'OPERATOR',       false,false,false,false),
    ('outbound_scrap_approval', 'INV_CONTROLLER', false,false,false,false),
    -- Adjustment: Supervisor view saja (penyesuaian = Inventory Controller)
    ('inventory_adjustment', 'SUPERVISOR', true, false,false,false),
    -- Reason codes: dikelola Inventory Controller (ikut modul master), Supervisor view
    ('admin_integration', 'SUPERVISOR', true, false,false,false)
),
module_matrix(module_code, role_code, v, c, e, d) AS (
  VALUES
    ('dashboard','SUPER_ADMIN',   true, true, true, true),
    ('dashboard','SUPERVISOR',    true, false,false,false),
    ('dashboard','OPERATOR',      true, false,false,false),
    ('dashboard','INV_CONTROLLER',true, false,false,false),
    ('dashboard','AUDITOR',       true, false,false,false),
    ('inbound','SUPER_ADMIN',     true, true, true, true),
    ('inbound','SUPERVISOR',      true, true, true, false),
    ('inbound','OPERATOR',        true, true, true, false),
    ('inbound','INV_CONTROLLER',  true, false,false,false),
    ('inbound','AUDITOR',         true, false,false,false),
    ('internal','SUPER_ADMIN',    true, true, true, true),
    ('internal','SUPERVISOR',     true, true, true, false),
    ('internal','OPERATOR',       true, true, true, false),
    ('internal','INV_CONTROLLER', true, false,false,false),
    ('internal','AUDITOR',        true, false,false,false),
    ('outbound','SUPER_ADMIN',    true, true, true, true),
    ('outbound','SUPERVISOR',     true, true, true, false),
    ('outbound','OPERATOR',       true, true, true, false),
    ('outbound','INV_CONTROLLER', true, false,false,false),
    ('outbound','AUDITOR',        true, false,false,false),
    ('inventory','SUPER_ADMIN',   true, true, true, true),
    ('inventory','SUPERVISOR',    true, true, true, false),
    ('inventory','OPERATOR',      true, false,false,false),
    ('inventory','INV_CONTROLLER',true, true, true, true),
    ('inventory','AUDITOR',       true, false,false,false),
    ('master','SUPER_ADMIN',      true, true, true, true),
    ('master','SUPERVISOR',       true, false,false,false),
    ('master','INV_CONTROLLER',   true, true, true, true),
    ('master','AUDITOR',          true, false,false,false),
    ('config','SUPER_ADMIN',      true, true, true, true),
    ('reports','SUPER_ADMIN',     true, true, true, true),
    ('reports','SUPERVISOR',      true, false,false,false),
    ('reports','INV_CONTROLLER',  true, false,false,false),
    ('reports','AUDITOR',         true, false,false,false),
    ('admin','SUPER_ADMIN',       true, true, true, true)
    -- ERP_INTEGRATION sengaja TIDAK punya grant modul (hanya override order di atas).
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
JOIN role r        ON r.code = g.role_code
JOIN menu_module mm ON mm.module_code = g.module_code
WHERE NOT EXISTS (                         -- override menang (CTE data-modifying tak terlihat oleh SELECT lain)
  SELECT 1 FROM override_matrix o
  WHERE o.menu_code = mm.menu_code AND o.role_code = g.role_code
)
ON CONFLICT (role_id, menu_id) DO NOTHING;

-- =============================================================
-- 9. USER SUPER ADMIN (seed)
-- Password awal: ChangeMe123!  (bcrypt, cost 12) — WAJIB diganti saat login pertama
-- (must_change_password default TRUE). Hash bcrypt di-upgrade ke argon2id saat login sukses.
-- =============================================================
INSERT INTO app_user (username, email, password_hash, full_name, status, default_warehouse_id)
SELECT 'admin', 'admin@example.com',
       '$2b$12$FqcKMwZa.BNxSfDTihLuqeHNjv94uyaz9JIZD85RBb0lnZ24URwQu',
       'System Administrator', 'ACTIVE', w.id
FROM warehouse w WHERE w.code = 'WH-MAIN'
ON CONFLICT (username) DO NOTHING;

INSERT INTO user_role (user_id, role_id)
SELECT u.id, r.id
FROM app_user u, role r
WHERE u.username = 'admin' AND r.code = 'SUPER_ADMIN'
ON CONFLICT (user_id, role_id) DO NOTHING;

COMMIT;

-- =============================================================
-- CATATAN:
-- - Ganti password 'admin' segera setelah login pertama.
-- - Untuk instalasi non-farmasi, sesuaikan app_setting (mis. matikan
--   enable_batch/expiry/fefo/quarantine/carton_break sesuai kebutuhan) dan
--   operation_type.require_approval / is_active sesuai kebijakan klien.
-- - Menu ber-flag (Carton Break, Quarantine, Batches, Sites) tetap ter-seed; BE tidak
--   mengirimnya di menuAccess bila flag mati → FE menyembunyikan.
-- - Lokasi sistem (VIRT-SUPPLIER/CUSTOMER, SCRAP, PRODUCTION, IN-TRANSIT, VIRT-TRANSFORM,
--   INV-ADJUST) bersifat GLOBAL — dipakai lintas warehouse/site.
-- - Setelah membuat warehouse baru, seed lokasi fisiknya (DOCK/STAGING/QA/STOCK) sendiri
--   dan set warehouse.timezone sesuai lokasi (Asia/Jakarta | Asia/Makassar | Asia/Jayapura).
-- - Seed ini idempotent: aman dijalankan ulang (ON CONFLICT DO NOTHING).
-- - CI memverifikasi: kunci katalog menu FE (NAV) == menu.code di seed ini.
-- =============================================================
