-- =============================================================
-- WMS v2 BOILERPLATE — SKEMA DATABASE (DDL) · migrasi 0001_baseline
-- Target: PostgreSQL 14+
-- Isi: konfigurasi (app_setting), user & RBAC (app_user/role/user_role/menu/role_menu_access),
--      sesi (refresh_token), audit_log, registri versi (schema_migration),
--      + CONTOH CRUD NETRAL (sample_item) sebagai acuan tabel fitur.
-- Konvensi: snake_case, UUID primary key, timestamptz (UTC), deny-by-default RBAC.
-- PRA-RILIS: file ini boleh ditimpa (lalu `pnpm db:reset`). SEJAK RILIS PERTAMA: beku
-- (checksum di meta/checksums.json) → perubahan berikutnya = migrasi baru 0002, 0003, ...
-- =============================================================

-- gen_random_uuid() sudah built-in sejak PostgreSQL 13 → tidak perlu extension pgcrypto.

-- =============================================================
-- 0. ENUM TYPES
-- =============================================================
CREATE TYPE user_status        AS ENUM ('ACTIVE', 'INACTIVE', 'LOCKED');
CREATE TYPE sample_item_status AS ENUM ('ACTIVE', 'INACTIVE');

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
-- Trigger util: tegakkan tabel append-only (tolak UPDATE & DELETE).
-- Dipakai audit_log (nanti juga ledger stok). Karena FK ON DELETE SET NULL/CASCADE memicu
-- UPDATE/DELETE, semua FK yang menunjuk DARI tabel immutable wajib ON DELETE RESTRICT.
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
-- 2. ACCESS CONTROL (User & RBAC)
-- =============================================================
CREATE TABLE app_user (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username             VARCHAR(60) NOT NULL UNIQUE,
    email                VARCHAR(150) UNIQUE,
    password_hash        VARCHAR(255) NOT NULL,
    full_name            VARCHAR(150),
    -- Soft-delete: user tidak pernah di-DELETE (dirujuk audit/ledger immutable) → status INACTIVE.
    status               user_status NOT NULL DEFAULT 'ACTIVE',
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,    -- paksa ganti saat login pertama
    failed_login_count   INTEGER NOT NULL DEFAULT 0,       -- untuk lockout
    locked_until         TIMESTAMPTZ,                      -- kunci sementara setelah gagal berturut
    last_login_at        TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_app_user_updated BEFORE UPDATE ON app_user
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

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

-- Daftar menu = REGISTRI KODE untuk matriks RBAC (dipakai guard server).
-- Struktur tampilan (label/ikon/urutan) otoritatif di katalog statis FE (apps/web/src/config/app.config.ts);
-- kolom name/route/icon/sort_order di sini hanya informatif.
-- Konvensi kode: code = route tanpa '/' awal, '/' dan '-' → '_' (mis. /admin/users → admin_users).
-- Tes FE (menu-sync) memverifikasi katalog FE == kode di seed.
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
-- 3. CONTOH CRUD NETRAL — acuan membuat tabel fitur baru
-- Pola: UUID PK, kode bisnis unik, status enum, jejak pembuat (FK RESTRICT ke app_user),
-- created_at/updated_at + trigger set_updated_at.
-- =============================================================
CREATE TABLE sample_item (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(30) NOT NULL UNIQUE,
    name        VARCHAR(120) NOT NULL,
    description TEXT,
    status      sample_item_status NOT NULL DEFAULT 'ACTIVE',
    created_by  UUID REFERENCES app_user(id) ON DELETE RESTRICT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_sample_item_updated BEFORE UPDATE ON sample_item
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_sample_item_status ON sample_item(status);

-- =============================================================
-- 4. AUDIT LOG — jejak aksi (auth/admin/master). Append-only.
-- =============================================================
CREATE TABLE audit_log (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES app_user(id) ON DELETE RESTRICT,   -- pelaku (NULL = anonim, mis. login gagal username tak dikenal)
    entity     VARCHAR(60) NOT NULL,                              -- mis. 'app_user','sample_item','auth'
    entity_id  UUID,                                              -- id baris terdampak (bila ada)
    action     VARCHAR(40) NOT NULL,                              -- CREATE | UPDATE | DELETE | LOGIN | LOGIN_FAILED | LOGOUT | ...
    before     JSONB,                                             -- state sebelum (UPDATE/DELETE)
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
-- 5. AUTH SESSION & MIGRASI
-- =============================================================
-- Refresh token (rotasi one-time-use; deteksi reuse via family_id → cabut sekeluarga,
-- DENGAN grace window: reuse ≤ REFRESH_REUSE_GRACE_SECONDS sejak used_at dianggap balapan sah).
CREATE TABLE refresh_token (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    token_hash   VARCHAR(255) NOT NULL UNIQUE,          -- simpan hash, bukan token mentah
    family_id    UUID NOT NULL,                         -- semua turunan dari satu login
    replaced_by  UUID REFERENCES refresh_token(id) ON DELETE SET NULL,
    used_at      TIMESTAMPTZ,                           -- saat pertama kali ditukar (awal grace window)
    revoked      BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at   TIMESTAMPTZ,
    user_agent   VARCHAR(255),                          -- info perangkat untuk admin
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rt_user   ON refresh_token(user_id);
CREATE INDEX idx_rt_family ON refresh_token(family_id);

-- Registri versi schema per instalasi (forward-only). Tiap skrip migrasi menutup dirinya dengan
-- INSERT ke tabel ini; tabel eksekusi internal drizzle (__drizzle_migrations) tetap dipakai runner,
-- tabel ini yang dibaca /api/ready.
CREATE TABLE schema_migration (
    version     VARCHAR(40) PRIMARY KEY,                -- mis. '0001', '0002' (= prefix file migrasi)
    description TEXT,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    checksum    VARCHAR(80)
);

-- Registri versi app — WAJIB baris terakhir setiap skrip migrasi.
INSERT INTO schema_migration(version, description) VALUES ('0001', 'boilerplate: auth, rbac, audit, sample_item');
