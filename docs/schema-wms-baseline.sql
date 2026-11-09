-- =============================================================
-- WMS BASELINE — SKEMA DATABASE (DDL)
-- Target: PostgreSQL 14+
-- Versi skema: 1.6 (kumulatif = keadaan terkini). Pra-rilis: seluruhnya = migrasi 0001_baseline (migration §2.1).
-- Konvensi: snake_case, UUID primary key, timestamptz, deny-by-default RBAC
-- Perubahan v1.2: optimistic-lock (version) + kaidah FOR UPDATE, tabel stock_reservation,
--   tabel purchase_order(+line) & fulfillment qty di order lines, tabel audit_log +
--   app_setting.updated_by, lokasi sistem global (is_system), serial tanpa location_id,
--   invarian UOM base di ledger, VIRTUAL_TRANSFORM untuk carton break, immutabilitas
--   stock_move/audit_log via trigger, product_status enum.
-- Perubahan v1.3: partner.min_shelf_life_days, doc_counter (generator ref_no/LPN/SN),
--   kolom auth app_user (is_service/must_change_password/failed_login_count/locked_until),
--   refresh_token, api_key, integration_event (outbox ERP), schema_migration.
-- Perubahan v1.6 (dilipat ke migrasi 0001_baseline — pra-rilis; m2-internal-wms-baseline.md D-18):
--   stock_reservation.qty_done (progres scan per reservasi; close/cancel melepas qty − qty_done),
--   operation.is_adhoc (transfer ad-hoc handheld; mesin langkah H1–H4).
-- Perubahan v1.5 (dilipat ke migrasi 0001_baseline — pra-rilis; flow-steps-wms-baseline.md §5): tabel operation_cursor
--   (konteks antar-scan), operation.staging_location_id/dock_location_id, handling_unit.label_printed_at,
--   product_packaging.barcode (GTIN per level UOM).
-- Perubahan v1.4.1 (validasi DDL 2026-09-24, docs/ddl-validation-wms-baseline.sql): CHECK RESERVED tak
--   pernah di ledger/source_status; komentar urutan tulis reservasi→quant.
-- Perubahan v1.4 (hasil audit desain 2026-09-24):
--   - FK ke tabel immutable (stock_move, audit_log) & aktor = ON DELETE RESTRICT; user dihapus
--     lewat soft-delete (status INACTIVE), bukan DELETE (trigger immutable menolak SET NULL).
--   - stock_reservation: quant_id nullable + ON DELETE SET NULL (quant boleh dihapus saat 0),
--     unik per (operation_line_id, quant_id), simpan source_status/hu/serial untuk release presisi.
--   - operation_line: qty_base, qty_done_base, so_line_id/po_line_id, fefo_override_*.
--   - operation: reason_code_id, assigned_to (claim tugas), dest_warehouse_id (inter-site),
--     started_at/submitted_at/cancelled_at/cancelled_by, CHECK anti self-approval.
--   - operation_type: menu_code/confirm_menu_code/approve_menu_code (pemetaan RBAC per optype).
--   - stock_move: from_status/to_status (perubahan status quant tercatat di ledger), reason_code_id,
--     operation_id & kedua lokasi NOT NULL (semua perubahan stok lewat operation).
--   - Tabel baru: reason_code, idempotency_key, report_job. Lokasi sistem INVENTORY_ADJUST.
--   - Enum: hu_status/serial_status + PENDING/VOID; sales_order_status + PARTIAL; api_key_status.
--   - warehouse.timezone, app_user.default_warehouse_id, refresh_token.used_at/revoked_at.
--   - order line: erp_qty/erp_uom_id (UOM asli ERP) terpisah dari qty (base); CHECK alokasi SO.
-- =============================================================

-- gen_random_uuid() sudah built-in sejak PostgreSQL 13 → tidak perlu extension pgcrypto.

-- =============================================================
-- 0. ENUM TYPES
-- Catatan migrasi: ALTER TYPE ... ADD VALUE tak boleh dipakai di transaksi yang sama dengan
-- penambahannya → tiap penambahan nilai enum = skrip migrasi tersendiri.
-- =============================================================
CREATE TYPE user_status         AS ENUM ('ACTIVE', 'INACTIVE', 'LOCKED');
CREATE TYPE api_key_status      AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE track_level         AS ENUM ('CARTON', 'ITEM');
CREATE TYPE location_type       AS ENUM ('STOCK', 'STAGING', 'DOCK', 'QUARANTINE', 'SCRAP',
                                         'PRODUCTION', 'IN_TRANSIT', 'VIRTUAL_SUPPLIER', 'VIRTUAL_CUSTOMER',
                                         'VIRTUAL_TRANSFORM', 'INVENTORY_ADJUST');
CREATE TYPE product_status      AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE hu_type             AS ENUM ('PALLET', 'CARTON');
-- PENDING = kode sudah terbit (label tercetak) tapi barang belum Done; VOID = operasi asal dibatalkan.
CREATE TYPE hu_status           AS ENUM ('PENDING', 'INTACT', 'BROKEN', 'SHIPPED', 'EMPTY', 'VOID');
CREATE TYPE serial_status       AS ENUM ('PENDING', 'ACTIVE', 'CONSUMED', 'VOID');
CREATE TYPE quant_status        AS ENUM ('AVAILABLE', 'RESERVED', 'QUARANTINE', 'DAMAGED');
CREATE TYPE op_direction        AS ENUM ('INCOMING', 'INTERNAL', 'OUTGOING');
CREATE TYPE operation_status    AS ENUM ('DRAFT', 'READY', 'IN_PROGRESS', 'DONE', 'CANCELLED');
CREATE TYPE op_line_status      AS ENUM ('PENDING', 'DONE', 'CANCELLED');
CREATE TYPE partner_type        AS ENUM ('CUSTOMER', 'SUPPLIER');
CREATE TYPE sales_order_status  AS ENUM ('RECEIVED', 'PROCESSING', 'PARTIAL', 'DONE', 'CANCELLED');
CREATE TYPE purchase_order_status AS ENUM ('OPEN', 'PARTIAL', 'CLOSED', 'CANCELLED');
CREATE TYPE reservation_status  AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');
CREATE TYPE integration_status  AS ENUM ('PENDING', 'SENT', 'FAILED', 'DEAD');  -- outbox callback ke ERP
CREATE TYPE job_status          AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- =============================================================
-- Trigger util: auto-update kolom updated_at
-- =============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- Trigger util: naikkan kolom version (optimistic concurrency)
-- Dipakai tabel yang rawan write-conflict (quant, operation).
-- =============================================================
CREATE OR REPLACE FUNCTION bump_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- Trigger util: tegakkan tabel append-only (tolak UPDATE & DELETE)
-- Dipakai stock_move & audit_log agar ledger benar-benar immutable
-- di level DB, bukan sekadar konvensi aplikasi.
-- PENTING: karena FK action ON DELETE SET NULL/CASCADE juga memicu UPDATE/DELETE,
-- semua FK yang menunjuk DARI tabel immutable wajib ON DELETE RESTRICT.
-- =============================================================
CREATE OR REPLACE FUNCTION forbid_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Tabel % bersifat append-only (immutable): % ditolak', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- =============================================================
-- 1. KONFIGURASI INSTALASI (feature flag & kebijakan)
-- =============================================================
CREATE TABLE app_setting (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key         VARCHAR(100) NOT NULL UNIQUE,
    value       TEXT,
    data_type   VARCHAR(20) NOT NULL DEFAULT 'string',  -- string | boolean | integer | json
    description TEXT,
    updated_by  UUID,                                   -- app_user.id pengubah terakhir (FK ditambah setelah app_user dibuat)
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_app_setting_updated BEFORE UPDATE ON app_setting
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- 2. LOKASI (site -> warehouse) — didefinisikan sebelum app_user
--    karena app_user.default_warehouse_id menunjuk warehouse.
-- =============================================================
CREATE TABLE site (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code       VARCHAR(30) NOT NULL UNIQUE,
    name       VARCHAR(120) NOT NULL,
    address    TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE warehouse (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id    UUID NOT NULL REFERENCES site(id) ON DELETE RESTRICT,
    code       VARCHAR(30) NOT NULL UNIQUE,
    name       VARCHAR(120) NOT NULL,
    -- Zona waktu IANA gudang. Dipakai untuk: cek expiry/shelf-life ("hari ini"), reset ref_no
    -- per tahun, filter "tugas hari ini", tampilan jam lokal. DB & API tetap menyimpan UTC.
    timezone   VARCHAR(40) NOT NULL DEFAULT 'Asia/Jakarta',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_warehouse_site ON warehouse(site_id);

-- =============================================================
-- 3. ACCESS CONTROL (User & RBAC)
-- =============================================================
CREATE TABLE app_user (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username             VARCHAR(60) NOT NULL UNIQUE,
    email                VARCHAR(150) UNIQUE,
    password_hash        VARCHAR(255) NOT NULL,
    full_name            VARCHAR(150),
    -- Soft-delete: user tidak pernah di-DELETE (dirujuk ledger immutable) → status INACTIVE.
    status               user_status NOT NULL DEFAULT 'ACTIVE',
    is_service           BOOLEAN NOT NULL DEFAULT FALSE,   -- akun mesin (integrasi ERP), bukan manusia
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,    -- paksa ganti saat login pertama
    failed_login_count   INTEGER NOT NULL DEFAULT 0,       -- untuk lockout (FR-AUTH-6)
    locked_until         TIMESTAMPTZ,                      -- kunci sementara setelah gagal berturut
    -- Gudang default saat login (handheld). BUKAN pembatas akses (akses tak di-scope per site/warehouse).
    default_warehouse_id UUID REFERENCES warehouse(id) ON DELETE SET NULL,
    last_login_at        TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_app_user_updated BEFORE UPDATE ON app_user
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- FK app_setting.updated_by (dibuat di sini karena app_user baru ada sekarang)
ALTER TABLE app_setting
    ADD CONSTRAINT fk_app_setting_updated_by
    FOREIGN KEY (updated_by) REFERENCES app_user(id) ON DELETE RESTRICT;

CREATE TABLE role (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(50) NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_role (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES role(id)     ON DELETE CASCADE,
    UNIQUE (user_id, role_id)
);
CREATE INDEX idx_user_role_user ON user_role(user_id);
CREATE INDEX idx_user_role_role ON user_role(role_id);

-- Daftar menu = REGISTRI KODE untuk matriks RBAC (dipakai halaman Access Control & guard server).
-- Struktur tampilan (label/ikon/urutan/route UI) otoritatif di katalog statis FE (frontend §5);
-- kolom name/route/icon/sort_order di sini hanya informatif untuk UI matriks akses.
-- Konvensi kode: code = route tanpa '/' awal, '/' dan '-' → '_'
--   (mis. /internal/carton-break → internal_carton_break). CI memverifikasi katalog FE == kode di sini.
CREATE TABLE menu (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code       VARCHAR(60) NOT NULL UNIQUE,
    name       VARCHAR(100) NOT NULL,
    route      VARCHAR(150),                          -- NULL untuk menu induk (wadah tampilan)
    parent_id  UUID REFERENCES menu(id) ON DELETE CASCADE,
    icon       VARCHAR(60),                           -- nama ikon lucide (informatif)
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_menu_parent ON menu(parent_id);

-- Matriks RBAC: deny-by-default (tidak ada baris = tidak ada akses; baris all-false = deny eksplisit)
CREATE TABLE role_menu_access (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id    UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    menu_id    UUID NOT NULL REFERENCES menu(id) ON DELETE CASCADE,
    can_view   BOOLEAN NOT NULL DEFAULT FALSE,
    can_create BOOLEAN NOT NULL DEFAULT FALSE,
    can_edit   BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (role_id, menu_id)
);
CREATE INDEX idx_rma_role ON role_menu_access(role_id);
CREATE INDEX idx_rma_menu ON role_menu_access(menu_id);

-- =============================================================
-- 4. UNIT OF MEASURE
-- =============================================================
CREATE TABLE uom (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name     VARCHAR(50) NOT NULL UNIQUE,   -- Pcs, Box, Carton, Pallet
    category VARCHAR(50)
);

-- =============================================================
-- 5. LOKASI (location) — site & warehouse sudah di §2
-- =============================================================
CREATE TABLE location (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID REFERENCES warehouse(id) ON DELETE RESTRICT,        -- NULL = lokasi sistem GLOBAL (virtual/in-transit/transform/adjust)
    code         VARCHAR(60) NOT NULL,                  -- mis. A-01-03-02
    parent_id    UUID REFERENCES location(id) ON DELETE RESTRICT,
    type         location_type NOT NULL DEFAULT 'STOCK',
    is_system    BOOLEAN NOT NULL DEFAULT FALSE,        -- TRUE = lokasi sistem global (tak terikat warehouse)
    is_usable    BOOLEAN NOT NULL DEFAULT TRUE,
    -- Lokasi sistem WAJIB global (warehouse_id NULL); lokasi fisik WAJIB punya warehouse.
    CHECK ( (is_system AND warehouse_id IS NULL) OR (NOT is_system AND warehouse_id IS NOT NULL) )
);
-- Kode unik per-warehouse untuk lokasi fisik; unik global untuk lokasi sistem.
CREATE UNIQUE INDEX uq_location_wh_code  ON location(warehouse_id, code) WHERE warehouse_id IS NOT NULL;
CREATE UNIQUE INDEX uq_location_sys_code ON location(code)               WHERE warehouse_id IS NULL;
CREATE INDEX idx_location_warehouse ON location(warehouse_id);
CREATE INDEX idx_location_parent    ON location(parent_id);
CREATE INDEX idx_location_type      ON location(type);

-- =============================================================
-- 6. PRODUK & PACKAGING (konversi UOM)
-- =============================================================
CREATE TABLE product (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku         VARCHAR(60) NOT NULL UNIQUE,
    name        VARCHAR(200) NOT NULL,
    base_uom_id UUID NOT NULL REFERENCES uom(id) ON DELETE RESTRICT,
    sale_uom_id UUID NOT NULL REFERENCES uom(id) ON DELETE RESTRICT,  -- satu satuan jual
    track_level track_level NOT NULL DEFAULT 'CARTON',
    -- Flag efektif = flag global app_setting AND flag produk (global mati ⇒ fitur mati untuk semua produk).
    -- use_batch/use_expiry/use_serial tidak boleh diubah bila produk sudah punya quant (validasi aplikasi).
    use_batch   BOOLEAN NOT NULL DEFAULT FALSE,
    use_expiry  BOOLEAN NOT NULL DEFAULT FALSE,
    use_fefo    BOOLEAN NOT NULL DEFAULT FALSE,
    use_serial  BOOLEAN NOT NULL DEFAULT FALSE,
    use_lpn     BOOLEAN NOT NULL DEFAULT TRUE,
    status      product_status NOT NULL DEFAULT 'ACTIVE',  -- soft-delete: set INACTIVE, jangan hard-delete bila ada histori
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_product_updated BEFORE UPDATE ON product
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Aturan aplikasi: tiap produk WAJIB punya baris packaging untuk base UOM (qty_in_base=1);
-- produk track_level=ITEM wajib qty_in_base bilangan bulat di semua level (syarat carton break).
CREATE TABLE product_packaging (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID NOT NULL REFERENCES product(id) ON DELETE CASCADE,
    uom_id      UUID NOT NULL REFERENCES uom(id) ON DELETE RESTRICT,
    level_seq   INTEGER NOT NULL,                       -- 1=item, 2=inner, 3=carton, 4=pallet
    qty_in_base NUMERIC(18,4) NOT NULL,                 -- jumlah dalam base UOM
    barcode     VARCHAR(40) UNIQUE,                     -- GTIN/EAN level ini (v1.5): scan = produk + UOM sekaligus (flow-steps §4)
    UNIQUE (product_id, level_seq),
    UNIQUE (product_id, uom_id),
    CHECK (level_seq > 0),
    CHECK (qty_in_base > 0)
);
CREATE INDEX idx_packaging_product ON product_packaging(product_id);

-- =============================================================
-- 7. PARTNER (customer & supplier)
-- =============================================================
CREATE TABLE partner (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                VARCHAR(40) NOT NULL UNIQUE,     -- = partner_ref dari ERP
    name                VARCHAR(200) NOT NULL,
    type                partner_type NOT NULL,
    min_shelf_life_days INTEGER,                    -- sisa umur simpan min saat kirim (customer); NULL = pakai default_min_shelf_life_days
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,  -- soft-delete
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (min_shelf_life_days IS NULL OR min_shelf_life_days >= 0)
);

-- =============================================================
-- 8. REASON CODE — alasan wajib untuk scrap/issue/adjustment/QA/override
-- =============================================================
CREATE TABLE reason_code (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code       VARCHAR(40) NOT NULL UNIQUE,             -- mis. DMG_HANDLING, EXPIRED, COUNT_DIFF
    name       VARCHAR(120) NOT NULL,
    applies_to VARCHAR(20) NOT NULL,                    -- SCRAP | ISSUE | ADJUST | QA | FEFO_OVERRIDE
    is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

-- =============================================================
-- 9. BATCH / LOT
-- =============================================================
CREATE TABLE batch (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
    batch_no    VARCHAR(60) NOT NULL,
    mfg_date    DATE,
    expiry_date DATE,                                   -- tanggal kalender; dievaluasi pada zona waktu warehouse
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (product_id, batch_no)
);
CREATE INDEX idx_batch_product ON batch(product_id);
CREATE INDEX idx_batch_expiry  ON batch(expiry_date);

-- =============================================================
-- 10. HANDLING UNIT (LPN pallet & Carton) — nestable
-- =============================================================
CREATE TABLE handling_unit (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code         VARCHAR(60) NOT NULL UNIQUE,           -- LPN / Carton S/N
    hu_type      hu_type NOT NULL,
    parent_hu_id UUID REFERENCES handling_unit(id) ON DELETE RESTRICT,  -- pallet berisi karton
    product_id   UUID REFERENCES product(id) ON DELETE RESTRICT,        -- NULL bila pallet campuran
    batch_id     UUID REFERENCES batch(id) ON DELETE RESTRICT,
    location_id  UUID REFERENCES location(id) ON DELETE RESTRICT,
    status       hu_status NOT NULL DEFAULT 'PENDING',  -- PENDING saat kode terbit; INTACT saat receipt Done
    label_printed_at TIMESTAMPTZ,                       -- v1.5: PRINT_LABEL muncul sekali (flow-steps B1); cetak ulang tetap boleh
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- location_id di sini adalah CACHE posisi HU untuk query cepat (mis. "di mana pallet X").
-- quant tetap sumber kebenaran; keduanya WAJIB di-update dalam transaksi confirm yang sama.
CREATE TRIGGER trg_hu_updated BEFORE UPDATE ON handling_unit
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_hu_parent   ON handling_unit(parent_hu_id);
CREATE INDEX idx_hu_location ON handling_unit(location_id);
CREATE INDEX idx_hu_product  ON handling_unit(product_id);
CREATE INDEX idx_hu_status   ON handling_unit(status);

-- =============================================================
-- 11. SERIAL (Pack S/N item) — dipakai bila track_level=ITEM
-- =============================================================
-- Lokasi item TIDAK disimpan di sini; quant adalah sumber kebenaran lokasi.
-- serial hanya identitas + lineage; posisi terkini dibaca dari quant, riwayat dari stock_move.
-- Cek duplikat saat scan/generate: kode unik global (UNIQUE) — status VOID tetap memegang kodenya.
CREATE TABLE serial (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code         VARCHAR(80) NOT NULL UNIQUE,           -- Pack S/N
    product_id   UUID NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
    batch_id     UUID REFERENCES batch(id) ON DELETE RESTRICT,
    status       serial_status NOT NULL DEFAULT 'PENDING',  -- PENDING → ACTIVE saat Done; VOID bila dibatalkan
    origin_hu_id UUID REFERENCES handling_unit(id) ON DELETE RESTRICT,  -- carton induk (lineage carton break)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_serial_updated BEFORE UPDATE ON serial
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_serial_product ON serial(product_id);
CREATE INDEX idx_serial_origin  ON serial(origin_hu_id);
CREATE INDEX idx_serial_batch   ON serial(batch_id);
CREATE INDEX idx_serial_status  ON serial(status);

-- =============================================================
-- 12. ORDERS (integrasi ERP) — Purchase Order (masuk) & Sales Order (keluar)
--     Didefinisikan sebelum operation_line karena line menaut ke order line.
-- =============================================================
-- Purchase Order: acuan validasi qty saat INCOMING (qty diterima <= qty PO + toleransi).
CREATE TABLE purchase_order (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    erp_ref       VARCHAR(60) NOT NULL UNIQUE,
    partner_id    UUID NOT NULL REFERENCES partner(id) ON DELETE RESTRICT,  -- supplier
    order_date    DATE,
    expected_date DATE,
    status        purchase_order_status NOT NULL DEFAULT 'OPEN',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_po_updated BEFORE UPDATE ON purchase_order
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_po_partner ON purchase_order(partner_id);

-- qty/qty_received = BASE UOM (dipakai semua validasi). erp_qty + erp_uom_id = angka asli dokumen ERP
-- (disimpan untuk callback & tampilan; tidak dipakai perhitungan stok).
CREATE TABLE purchase_order_line (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id        UUID NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
    line_no      INTEGER NOT NULL,                       -- nomor baris ERP (kunci callback)
    product_id   UUID NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
    qty          NUMERIC(18,4) NOT NULL,                 -- qty dipesan (base UOM)
    qty_received NUMERIC(18,4) NOT NULL DEFAULT 0,        -- akumulasi terima (base UOM); untuk backorder & validasi toleransi
    erp_qty      NUMERIC(18,4) NOT NULL,                 -- qty sesuai UOM ERP
    erp_uom_id   UUID NOT NULL REFERENCES uom(id) ON DELETE RESTRICT,
    UNIQUE (po_id, line_no),
    CHECK (qty > 0),
    CHECK (qty_received >= 0)
);
CREATE INDEX idx_poline_po      ON purchase_order_line(po_id);
CREATE INDEX idx_poline_product ON purchase_order_line(product_id);

CREATE TABLE sales_order (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    erp_ref       VARCHAR(60) NOT NULL UNIQUE,
    partner_id    UUID NOT NULL REFERENCES partner(id) ON DELETE RESTRICT,
    delivery_date DATE,
    status        sales_order_status NOT NULL DEFAULT 'RECEIVED',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_so_updated BEFORE UPDATE ON sales_order
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_so_partner ON sales_order(partner_id);

CREATE TABLE sales_order_line (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    so_id        UUID NOT NULL REFERENCES sales_order(id) ON DELETE CASCADE,
    line_no      INTEGER NOT NULL,                       -- nomor baris ERP (kunci callback)
    product_id   UUID NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
    qty          NUMERIC(18,4) NOT NULL,                 -- qty dipesan (base UOM)
    qty_reserved NUMERIC(18,4) NOT NULL DEFAULT 0,        -- sedang di-reserve oleh operasi picking (base UOM)
    qty_delivered NUMERIC(18,4) NOT NULL DEFAULT 0,       -- akumulasi terkirim (base UOM); memungkinkan pemenuhan bertahap
    erp_qty      NUMERIC(18,4) NOT NULL,
    erp_uom_id   UUID NOT NULL REFERENCES uom(id) ON DELETE RESTRICT,
    UNIQUE (so_id, line_no),
    CHECK (qty > 0),
    CHECK (qty_reserved >= 0),
    CHECK (qty_delivered >= 0),
    -- Anti over-allocation (jaring terakhir; aplikasi mengecek di bawah lock baris ini).
    CHECK (qty_reserved + qty_delivered <= qty)
);
CREATE INDEX idx_soline_so      ON sales_order_line(so_id);
CREATE INDEX idx_soline_product ON sales_order_line(product_id);

-- =============================================================
-- 13. OPERATION TYPE & OPERATION
-- =============================================================
-- menu_code/confirm_menu_code/approve_menu_code = pemetaan RBAC untuk endpoint generik
-- /operations/{id}/* (lihat api-design §1.4). Aksi dicek terhadap menu milik optype operasi,
-- BUKAN terhadap route request. confirm_menu_code NULL ⇒ pakai menu_code.
CREATE TABLE operation_type (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                    VARCHAR(50) NOT NULL UNIQUE,
    name                    VARCHAR(120) NOT NULL,
    direction               op_direction NOT NULL,
    default_src_location_id UUID REFERENCES location(id) ON DELETE RESTRICT,
    default_dest_location_id UUID REFERENCES location(id) ON DELETE RESTRICT,
    -- Satu-satunya sumber kebenaran "butuh approval" (tidak ada flag global duplikat).
    require_approval        BOOLEAN NOT NULL DEFAULT FALSE,
    require_reason          BOOLEAN NOT NULL DEFAULT FALSE,   -- reason_code wajib (scrap/issue/adjust/QA)
    allowed_from_status     quant_status[] NOT NULL DEFAULT '{AVAILABLE}',  -- status quant sumber yang boleh diambil
    to_status               quant_status,                     -- status quant hasil (NULL = sama dgn sumber; INCOMING: AVAILABLE/QUARANTINE per qa_on_receipt)
    menu_code               VARCHAR(60) NOT NULL REFERENCES menu(code) ON DELETE RESTRICT,
    confirm_menu_code       VARCHAR(60) REFERENCES menu(code) ON DELETE RESTRICT,
    approve_menu_code       VARCHAR(60) REFERENCES menu(code) ON DELETE RESTRICT,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (NOT require_approval OR approve_menu_code IS NOT NULL)
);

CREATE TABLE operation (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_type_id   UUID NOT NULL REFERENCES operation_type(id) ON DELETE RESTRICT,
    ref_no              VARCHAR(60) NOT NULL UNIQUE,
    status              operation_status NOT NULL DEFAULT 'DRAFT',
    warehouse_id        UUID NOT NULL REFERENCES warehouse(id) ON DELETE RESTRICT,  -- gudang pelaksana
    dest_warehouse_id   UUID REFERENCES warehouse(id) ON DELETE RESTRICT,           -- inter-site: gudang tujuan (wajib utk INT_INTERSITE)
    source_doc_type     VARCHAR(40),                        -- mis. 'SALES_ORDER' | 'PURCHASE_ORDER' (polimorfik)
    source_doc_id       UUID,
    parent_operation_id UUID REFERENCES operation(id) ON DELETE RESTRICT,  -- receive inter-site menunjuk operasi dispatch
    is_adhoc            BOOLEAN NOT NULL DEFAULT FALSE,     -- v1.6: transfer ad-hoc handheld (line & reservasi lahir dari scan, behavioral §5.3)
    reason_code_id      UUID REFERENCES reason_code(id) ON DELETE RESTRICT,
    note                TEXT,
    created_by          UUID REFERENCES app_user(id) ON DELETE RESTRICT,
    assigned_to         UUID REFERENCES app_user(id) ON DELETE RESTRICT,     -- operator yang meng-claim tugas (handheld)
    assigned_at         TIMESTAMPTZ,
    approved_by         UUID REFERENCES app_user(id) ON DELETE RESTRICT,     -- pengapprove (bila require_approval)
    approved_at         TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    submitted_at        TIMESTAMPTZ,                        -- INCOMING: unit selesai discan & HU/LPN digenerate
    confirmed_at        TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    cancelled_by        UUID REFERENCES app_user(id) ON DELETE RESTRICT,
    staging_location_id UUID REFERENCES location(id) ON DELETE RESTRICT,   -- v1.5: fakta scan staging (flow-steps O6)
    dock_location_id    UUID REFERENCES location(id) ON DELETE RESTRICT,   -- v1.5: fakta scan dock (flow-steps O7)
    version             INTEGER NOT NULL DEFAULT 0,          -- optimistic lock; transisi status wajib SELECT ... FOR UPDATE
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Segregation of duties (fase 1): pembuat tidak boleh meng-approve operasinya sendiri.
    CHECK (approved_by IS NULL OR approved_by IS DISTINCT FROM created_by)
);
CREATE TRIGGER trg_operation_updated BEFORE UPDATE ON operation
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_operation_version BEFORE UPDATE ON operation
    FOR EACH ROW EXECUTE FUNCTION bump_version();
CREATE INDEX idx_operation_type      ON operation(operation_type_id);
CREATE INDEX idx_operation_status    ON operation(status);
CREATE INDEX idx_operation_warehouse ON operation(warehouse_id, status);
CREATE INDEX idx_operation_assigned  ON operation(assigned_to, status);
CREATE INDEX idx_operation_srcdoc    ON operation(source_doc_type, source_doc_id);
CREATE INDEX idx_operation_parent    ON operation(parent_operation_id);

-- qty + uom_id = UOM TRANSAKSI (yang discan/diminta). qty_base = konversi ke base (A-6a), dipakai
-- semua logika stok. qty_done_base = yang sudah benar-benar discan (partial pick / partial receive).
-- Line hanya boleh ditambah/diubah/dihapus saat operasi DRAFT (READY → reopen dulu), kecuali line
-- yang lahir dari scan pada INCOMING/INTERNAL saat IN_PROGRESS (dikelola endpoint scan).
CREATE TABLE operation_line (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id         UUID NOT NULL REFERENCES operation(id) ON DELETE CASCADE,
    product_id           UUID NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
    batch_id             UUID REFERENCES batch(id) ON DELETE RESTRICT,
    hu_id                UUID REFERENCES handling_unit(id) ON DELETE RESTRICT,
    serial_id            UUID REFERENCES serial(id) ON DELETE RESTRICT,
    qty                  NUMERIC(18,4) NOT NULL,             -- UOM transaksi
    uom_id               UUID NOT NULL REFERENCES uom(id) ON DELETE RESTRICT,
    qty_base             NUMERIC(18,4) NOT NULL,             -- base UOM
    qty_done_base        NUMERIC(18,4) NOT NULL DEFAULT 0,   -- base UOM, progres scan
    from_location_id     UUID REFERENCES location(id) ON DELETE RESTRICT,
    to_location_id       UUID REFERENCES location(id) ON DELETE RESTRICT,
    so_line_id           UUID REFERENCES sales_order_line(id) ON DELETE RESTRICT,
    po_line_id           UUID REFERENCES purchase_order_line(id) ON DELETE RESTRICT,
    fefo_override_reason_id UUID REFERENCES reason_code(id) ON DELETE RESTRICT,  -- diisi bila batch non-FEFO di-ack (fefo_policy=warn)
    fefo_override_by     UUID REFERENCES app_user(id) ON DELETE RESTRICT,
    status               op_line_status NOT NULL DEFAULT 'PENDING',   -- DONE = line ditutup (penuh/parsial)
    CHECK (qty > 0),
    CHECK (qty_base > 0),
    CHECK (qty_done_base >= 0 AND qty_done_base <= qty_base),
    CHECK (so_line_id IS NULL OR po_line_id IS NULL)
);
CREATE INDEX idx_opline_operation ON operation_line(operation_id);
CREATE INDEX idx_opline_product   ON operation_line(product_id);
CREATE INDEX idx_opline_status    ON operation_line(status);
CREATE INDEX idx_opline_soline    ON operation_line(so_line_id);
CREATE INDEX idx_opline_poline    ON operation_line(po_line_id);

-- =============================================================
-- 14. INVENTORY: quant (snapshot) & stock_move (ledger)
-- =============================================================
-- Snapshot on-hand: satu baris per kombinasi unik. Qty SELALU dalam base UOM.
-- Kebijakan housekeeping: baris yang qty-nya mencapai 0 DIHAPUS (bukan disimpan 0),
-- agar uq_quant_combo tidak dipenuhi baris hantu. Penulisan qty wajib di dalam
-- transaksi ber-lock (protokol A-5 behavioral: advisory lock per produk lalu FOR UPDATE).
-- Quant RESERVED dapat dipakai bersama beberapa operasi (pool per atribut); kepemilikan
-- per operasi/line dibaca dari stock_reservation.
CREATE TABLE quant (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
    location_id UUID NOT NULL REFERENCES location(id) ON DELETE RESTRICT,
    batch_id    UUID REFERENCES batch(id) ON DELETE RESTRICT,
    hu_id       UUID REFERENCES handling_unit(id) ON DELETE RESTRICT,
    serial_id   UUID REFERENCES serial(id) ON DELETE RESTRICT,
    qty         NUMERIC(18,4) NOT NULL DEFAULT 0,
    status      quant_status NOT NULL DEFAULT 'AVAILABLE',
    version     INTEGER NOT NULL DEFAULT 0,             -- optimistic lock (cegah oversell akibat write bersamaan)
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (qty >= 0)
);
CREATE TRIGGER trg_quant_updated BEFORE UPDATE ON quant
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_quant_version BEFORE UPDATE ON quant
    FOR EACH ROW EXECUTE FUNCTION bump_version();
-- Satu baris per kombinasi unik (NULL diperlakukan sebagai nilai tetap via COALESCE)
CREATE UNIQUE INDEX uq_quant_combo ON quant (
    product_id, location_id, status,
    COALESCE(batch_id,  '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(hu_id,     '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(serial_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
CREATE INDEX idx_quant_pick     ON quant(product_id, status, location_id);  -- seleksi FEFO/reserve
CREATE INDEX idx_quant_location ON quant(location_id);
CREATE INDEX idx_quant_batch    ON quant(batch_id);
CREATE INDEX idx_quant_hu       ON quant(hu_id);
CREATE INDEX idx_quant_serial   ON quant(serial_id);

-- Ledger append-only: TIDAK PERNAH di-update/di-delete. Dasar audit & traceability.
-- INVARIAN UOM: `qty` SELALU dalam base UOM produk (sama seperti quant). `uom_id`
-- di sini = base UOM produk (denormalisasi untuk kemudahan baca), BUKAN UOM saat scan.
-- INVARIAN OPERASI: setiap baris lahir dari operation yang Done (termasuk adjustment,
-- carton break, QA) → operation_id NOT NULL.
-- INVARIAN LOKASI: selalu location→location (lokasi sistem untuk sisi eksternal) → keduanya NOT NULL.
-- STATUS: from_status/to_status mencatat status quant sebelum/sesudah (NULL di sisi lokasi
-- endpoint virtual). RESERVED TIDAK PERNAH muncul di ledger: reservasi bukan peristiwa stok (P-1),
-- sehingga konsumsi dari quant RESERVED dicatat dengan from_status = stock_reservation.source_status. Perubahan status di bin yang sama (QA hold/release/reject, mark damaged)
-- adalah baris sah: from_location = to_location tetapi from_status ≠ to_status.
CREATE TABLE stock_move (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id     UUID NOT NULL REFERENCES operation(id) ON DELETE RESTRICT,
    product_id       UUID NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
    batch_id         UUID REFERENCES batch(id) ON DELETE RESTRICT,
    hu_id            UUID REFERENCES handling_unit(id) ON DELETE RESTRICT,
    serial_id        UUID REFERENCES serial(id) ON DELETE RESTRICT,
    from_location_id UUID NOT NULL REFERENCES location(id) ON DELETE RESTRICT,
    to_location_id   UUID NOT NULL REFERENCES location(id) ON DELETE RESTRICT,
    from_status      quant_status,
    to_status        quant_status,
    qty              NUMERIC(18,4) NOT NULL,                            -- base UOM
    uom_id           UUID NOT NULL REFERENCES uom(id) ON DELETE RESTRICT,  -- = product.base_uom (denormalisasi)
    reason_code_id   UUID REFERENCES reason_code(id) ON DELETE RESTRICT,
    user_id          UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    moved_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (qty > 0),
    -- Setiap move harus benar-benar berpindah tempat ATAU berpindah status (cegah move semu).
    CHECK (from_location_id <> to_location_id OR from_status IS DISTINCT FROM to_status),
    CHECK (from_status IS DISTINCT FROM 'RESERVED' AND to_status IS DISTINCT FROM 'RESERVED')
);
-- Tegakkan immutabilitas ledger di level DB (selain REVOKE UPDATE/DELETE untuk role app).
CREATE TRIGGER trg_stock_move_immutable BEFORE UPDATE OR DELETE ON stock_move
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE INDEX idx_move_operation ON stock_move(operation_id);
CREATE INDEX idx_move_product   ON stock_move(product_id, moved_at);
CREATE INDEX idx_move_from      ON stock_move(from_location_id);
CREATE INDEX idx_move_to        ON stock_move(to_location_id);
CREATE INDEX idx_move_movedat   ON stock_move(moved_at, id);          -- keyset pagination laporan
CREATE INDEX idx_move_serial    ON stock_move(serial_id);
CREATE INDEX idx_move_hu        ON stock_move(hu_id);
CREATE INDEX idx_move_batch     ON stock_move(batch_id);

-- =============================================================
-- 15. STOCK RESERVATION — jejak kepemilikan reservasi
-- Menjawab "quant RESERVED ini milik operasi/line mana & berapa" saat release/cancel.
-- Dibuat saat Ready -> In progress; RELEASED saat cancel/penutupan line parsial; CONSUMED saat Done.
-- Atribut quant (lokasi/batch/hu/serial/source_status) disalin agar release tetap presisi walau
-- baris quant RESERVED sudah dihapus (qty 0) — karena itu quant_id nullable & ON DELETE SET NULL.
-- =============================================================
CREATE TABLE stock_reservation (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id      UUID NOT NULL REFERENCES operation(id) ON DELETE RESTRICT,
    operation_line_id UUID NOT NULL REFERENCES operation_line(id) ON DELETE RESTRICT,
    quant_id          UUID REFERENCES quant(id) ON DELETE SET NULL,   -- baris quant RESERVED (pool)
    product_id        UUID NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
    location_id       UUID NOT NULL REFERENCES location(id) ON DELETE RESTRICT,
    batch_id          UUID REFERENCES batch(id) ON DELETE RESTRICT,
    hu_id             UUID REFERENCES handling_unit(id) ON DELETE RESTRICT,
    serial_id         UUID REFERENCES serial(id) ON DELETE RESTRICT,
    source_status     quant_status NOT NULL DEFAULT 'AVAILABLE',     -- status asal (AVAILABLE | DAMAGED utk scrap)
    qty               NUMERIC(18,4) NOT NULL,             -- base UOM
    qty_done          NUMERIC(18,4) NOT NULL DEFAULT 0,   -- v1.6: bagian yang sudah discan (D-18); release hanya qty − qty_done
    status            reservation_status NOT NULL DEFAULT 'ACTIVE',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (qty > 0),
    CHECK (qty_done >= 0 AND qty_done <= qty),
    CHECK (source_status <> 'RESERVED'),
    -- Reservasi ACTIVE wajib menunjuk quant. Konsekuensi urutan tulis (behavioral A-3/A-4a):
    -- ubah status reservasi (RELEASED/CONSUMED) DULU, baru kurangi/hapus quant RESERVED.
    CHECK (status <> 'ACTIVE' OR quant_id IS NOT NULL)
);
CREATE TRIGGER trg_reservation_updated BEFORE UPDATE ON stock_reservation
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_resv_operation ON stock_reservation(operation_id, status);
CREATE INDEX idx_resv_line      ON stock_reservation(operation_line_id);
CREATE INDEX idx_resv_quant     ON stock_reservation(quant_id);
-- Satu LINE memegang paling banyak satu reservasi aktif per baris quant (UPSERT menambah qty).
-- Dua line (mis. 2 baris SO ber-SKU sama) boleh mereservasi dari quant yang sama.
CREATE UNIQUE INDEX uq_resv_active ON stock_reservation(operation_line_id, quant_id)
    WHERE status = 'ACTIVE';

-- =============================================================
-- 15a. OPERATION CURSOR (v1.5) — konteks transien antar-scan handheld (flow-steps §5)
-- Satu baris per operasi yang sedang dikerjakan. Dikunci bersama operation (A-5 langkah 1).
-- KONTEKS, bukan fakta stok: hilangnya cursor hanya membuat operator men-scan ulang bin.
-- Dihapus aplikasi saat operasi DONE/CANCELLED atau unclaim.
-- =============================================================
CREATE TABLE operation_cursor (
    operation_id       UUID PRIMARY KEY REFERENCES operation(id) ON DELETE CASCADE,
    line_id            UUID REFERENCES operation_line(id) ON DELETE SET NULL,  -- line aktif
    bin_location_id    UUID REFERENCES location(id) ON DELETE RESTRICT,        -- bin terakhir discan
    bin_role           VARCHAR(6),                                             -- SOURCE | DEST
    pending_hu_id      UUID REFERENCES handling_unit(id) ON DELETE SET NULL,   -- unit menunggu bin tujuan
    pending_product_id UUID REFERENCES product(id) ON DELETE RESTRICT,         -- produk ter-scan menunggu batch/qty/bin
    pending_uom_id     UUID REFERENCES uom(id) ON DELETE RESTRICT,
    batch_id           UUID REFERENCES batch(id) ON DELETE RESTRICT,           -- batch "lengket" receipt (flow-steps A1)
    updated_by         UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (bin_role IS NULL OR bin_role IN ('SOURCE', 'DEST')),
    CHECK ((bin_location_id IS NULL) = (bin_role IS NULL)),
    CHECK ((pending_product_id IS NULL) = (pending_uom_id IS NULL))
);
CREATE TRIGGER trg_cursor_updated BEFORE UPDATE ON operation_cursor
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- 16. AUDIT LOG — jejak aksi NON-stok (admin/config/auth)
-- Melengkapi jejak stok (stock_move.user_id, operation.created_by):
-- perubahan user, role, matriks RBAC, dan app_setting. Append-only.
-- =============================================================
CREATE TABLE audit_log (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES app_user(id) ON DELETE RESTRICT,   -- pelaku (NULL = anonim, mis. login gagal username tak dikenal)
    entity     VARCHAR(60) NOT NULL,                              -- mis. 'app_user','role_menu_access','app_setting'
    entity_id  UUID,                                              -- id baris terdampak (bila ada)
    action     VARCHAR(40) NOT NULL,                              -- CREATE | UPDATE | DEACTIVATE | LOGIN | LOGIN_FAILED | LOGOUT | RESET_PASSWORD | ...
    before     JSONB,                                             -- state sebelum (UPDATE)
    after      JSONB,                                             -- state sesudah (CREATE/UPDATE)
    ip_address INET,
    at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE INDEX idx_audit_user   ON audit_log(user_id);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX idx_audit_at     ON audit_log(at, id);

-- =============================================================
-- 17. DOC COUNTER — generator sekuens aman-konkuren (ref_no, LPN, S/N)
-- scope_key mis. 'RCV:2026' (reset per tahun via scope, tahun menurut timezone warehouse), 'LPN', 'SN'.
-- Increment atomik via UPSERT (lihat behavioral-spec A-7).
-- =============================================================
CREATE TABLE doc_counter (
    scope_key  VARCHAR(60) PRIMARY KEY,
    last_seq   BIGINT NOT NULL DEFAULT 0
);

-- =============================================================
-- 18. CROSS-CUTTING: AUTH SESSION, API KEY, IDEMPOTENSI, INTEGRASI ERP, JOB, MIGRASI
-- =============================================================
-- Refresh token (rotasi one-time-use; deteksi reuse via family_id → cabut sekeluarga,
-- DENGAN grace window: reuse ≤ refresh_reuse_grace_seconds sejak used_at dianggap balapan sah).
CREATE TABLE refresh_token (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    token_hash   VARCHAR(255) NOT NULL UNIQUE,          -- simpan hash, bukan token mentah
    family_id    UUID NOT NULL,                         -- semua turunan dari satu login
    replaced_by  UUID REFERENCES refresh_token(id) ON DELETE SET NULL,
    used_at      TIMESTAMPTZ,                           -- saat pertama kali ditukar (awal grace window)
    revoked      BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at   TIMESTAMPTZ,
    user_agent   VARCHAR(255),                          -- info perangkat (handheld/desktop) untuk admin
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rt_user   ON refresh_token(user_id);
CREATE INDEX idx_rt_family ON refresh_token(family_id);

-- API key untuk klien mesin (ERP). Dipetakan ke service account demi RBAC & audit.
CREATE TABLE api_key (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    key_prefix      VARCHAR(12) NOT NULL,                -- beberapa karakter awal (identifikasi di UI, bukan rahasia)
    key_hash        VARCHAR(255) NOT NULL UNIQUE,        -- hash dari API key (mentah hanya ditampilkan sekali saat dibuat)
    service_user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,  -- app_user is_service=true
    status          api_key_status NOT NULL DEFAULT 'ACTIVE',
    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_apikey_user ON api_key(service_user_id);

-- Idempotensi request (header Idempotency-Key). WAJIB untuk scan & transisi dari handheld,
-- disarankan untuk ERP. Request ulang dengan key sama + hash sama → kembalikan respons tersimpan;
-- key sama + hash beda → 422 IDEMPOTENCY_MISMATCH. Dibersihkan worker setelah 24 jam.
CREATE TABLE idempotency_key (
    principal_id    UUID NOT NULL,                       -- app_user.id (manusia atau service account)
    key             VARCHAR(100) NOT NULL,
    method          VARCHAR(10) NOT NULL,
    path            VARCHAR(255) NOT NULL,
    request_hash    VARCHAR(80) NOT NULL,
    response_status INTEGER,                             -- NULL = masih diproses (request paralel → 409 IN_PROGRESS)
    response_body   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (principal_id, key)
);
CREATE INDEX idx_idem_created ON idempotency_key(created_at);

-- Outbox callback WMS→ERP (reliable delivery: retry + dead-letter).
-- Worker mengambil baris dengan SELECT ... FOR UPDATE SKIP LOCKED (aman multi-worker).
-- id dikirim ke ERP sebagai X-Event-Id agar ERP dapat dedupe; urutan per (ref_table, ref_id) dijaga.
CREATE TABLE integration_event (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type    VARCHAR(60) NOT NULL,                 -- mis. RECEIPT_CONFIRMED, SHIPMENT_CONFIRMED
    payload       JSONB NOT NULL,
    ref_table     VARCHAR(60),                          -- entitas sumber (operation/sales_order/...)
    ref_id        UUID,
    status        integration_status NOT NULL DEFAULT 'PENDING',
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    next_retry_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_intevent_updated BEFORE UPDATE ON integration_event
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_intevent_status ON integration_event(status, next_retry_at);
CREATE INDEX idx_intevent_ref    ON integration_event(ref_table, ref_id, created_at);

-- Job latar untuk report/export besar (NFR-PERF-5): dibuat oleh API, dieksekusi apps/worker.
CREATE TABLE report_job (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report       VARCHAR(60) NOT NULL,                  -- stock | movement | traceability | ...
    params       JSONB NOT NULL DEFAULT '{}'::jsonb,
    format       VARCHAR(10) NOT NULL,                  -- csv | xlsx
    status       job_status NOT NULL DEFAULT 'QUEUED',
    file_path    TEXT,                                  -- lokasi hasil (storage lokal/objek)
    error        TEXT,
    requested_by UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ                            -- file dihapus worker setelah lewat
);
CREATE INDEX idx_report_job_status ON report_job(status, created_at);
CREATE INDEX idx_report_job_user   ON report_job(requested_by, created_at);

-- Registri versi schema per instalasi (forward-only). Tiap skrip migrasi drizzle-kit menutup
-- dirinya dengan INSERT ke tabel ini (lihat migration §2); tabel eksekusi internal drizzle
-- (__drizzle_migrations) tetap dipakai runner, tabel ini yang dibaca /api/ready.
CREATE TABLE schema_migration (
    version     VARCHAR(40) PRIMARY KEY,                -- mis. '0001', '0002' (= prefix file drizzle)
    description TEXT,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    checksum    VARCHAR(80)                             -- integritas skrip (opsional, tool-dependent)
);

-- =============================================================
-- CATATAN INTEGRITAS YANG DITEGAKKAN DI LEVEL APLIKASI (bukan DDL):
-- - Transisi status operasi & quant hanya mengikuti state machine yang diizinkan.
-- - SEMUA perubahan stok lewat `operation` yang mencapai DONE (termasuk adjustment ADJ_GAIN/
--   ADJ_LOSS, carton break, QA hold/release/reject, mark damaged). Operasi "instan" = create +
--   confirm dalam satu transaksi, tetap punya ref_no & baris operation.
-- - KONKURENSI (behavioral A-5): lock operation (FOR UPDATE) → lock order line terkait urut id →
--   pg_advisory_xact_lock per produk urut product_id naik → FOR UPDATE OF quant. CHECK(qty>=0)
--   hanya jaring terakhir. Endpoint scan juga me-lock baris operation (singkat).
-- - RESERVASI: Ready->In progress memecah quant sumber menjadi RESERVED (in-place) dan UPSERT
--   stock_reservation per (operation_line, quant). Cancel/penutupan line parsial -> RELEASED &
--   qty dikembalikan ke source_status persis. Done -> CONSUMED. Menghapus line ber-reservasi
--   ditolak (FK RESTRICT) — release dulu.
-- - UOM: qty di quant, stock_move, stock_reservation, order line (qty*) SELALU base UOM. UOM
--   transaksi hanya di operation_line (qty+uom_id) dan erp_qty/erp_uom_id di order line.
-- - Confirm bersifat atomik: tulis stock_move + update quant/HU/serial + update reservation
--   + update qty_delivered/qty_received + integration_event dalam SATU transaksi.
-- - LOKASI otoritatif = quant. handling_unit.location_id = cache (di-sync di transaksi
--   yang sama). serial tidak menyimpan lokasi (dibaca dari quant / stock_move).
-- - stock_move & audit_log immutable: trigger forbid_mutation() + REVOKE UPDATE/DELETE
--   untuk role aplikasi; semua FK dari/ke aktor = RESTRICT; user & master = soft-delete.
-- - Carton Break hanya untuk product.track_level='ITEM' & enable_carton_break aktif;
--   N = quant.qty karton (base), bukan packaging saat ini. Ledger memakai VIRTUAL_TRANSFORM.
-- - Lokasi sistem (VIRTUAL_*, IN_TRANSIT, VIRTUAL_TRANSFORM, INVENTORY_ADJUST) bersifat GLOBAL.
-- - Inter-site transfer wajib lewat IN_TRANSIT (2 langkah); dispatch wajib dest_warehouse_id;
--   receive hanya boleh dibuat di dest_warehouse_id dan menunjuk dispatch via parent_operation_id.
-- - Pemenuhan bertahap: satu operasi tetap atomik (tanpa "partially done"), namun satu
--   SO/PO bisa dipenuhi beberapa operasi via qty_delivered / qty_received.
-- - FEFO/expiry check saat OUTGOING sesuai flag efektif (global AND produk); tanggal dievaluasi
--   pada warehouse.timezone; saran FEFO di-validasi ulang saat reserve.
-- - Approval: approved_by ≠ created_by (CHECK) + RBAC edit pada operation_type.approve_menu_code.
-- =============================================================
