/**
 * PORT (ADR-002): kontrak yang diimplementasi packages/infrastructure. Application hanya
 * bergantung pada interface ini — tanpa next/*, drizzle, pg.
 *
 * Menambah fitur baru = (1) tambah interface repository di sini, (2) daftarkan di `Repos`,
 * (3) implementasikan di packages/infrastructure/src/repos, (4) wiring di uow.ts.
 */
import type { MenuAccessFlags } from '@wms/domain';
import type {
  RoleDto,
  SampleItemCreate,
  SampleItemDto,
  SampleItemListQuery,
  SampleItemUpdate,
  UserDto,
  UserListQuery,
  UserStatus,
} from '@wms/contracts';

export interface Clock {
  now(): Date;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
export type UserRecord = {
  id: string;
  username: string;
  fullName: string | null;
  passwordHash: string;
  status: UserStatus;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
};

export interface UserRepository {
  findByUsername(username: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  recordLoginSuccess(id: string, at: Date, newPasswordHash?: string): Promise<void>;
  recordLoginFailure(id: string, failedCount: number, lockedUntil: Date | null): Promise<void>;
  updatePassword(id: string, hash: string): Promise<void>;
}

export interface AccessRepository {
  rolesOf(userId: string): Promise<string[]>;
  /** Baris role_menu_access semua role user (belum di-merge); kosong bila user bukan ACTIVE. */
  menuAccessRows(userId: string): Promise<Array<{ menuCode: string } & MenuAccessFlags>>;
}

export interface SettingsRepository {
  all(): Promise<Record<string, { value: string | null; dataType: string }>>;
}

export type RefreshTokenRecord = {
  id: string;
  userId: string;
  familyId: string;
  replacedBy: string | null;
  usedAt: Date | null;
  revoked: boolean;
  expiresAt: Date;
};

export interface RefreshTokenRepository {
  insert(r: {
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
  }): Promise<string>;
  /** Harus mengunci baris (FOR UPDATE) agar rotasi paralel terserialisasi. */
  lockByHash(hash: string): Promise<RefreshTokenRecord | null>;
  markUsed(id: string, replacedBy: string, at: Date): Promise<void>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
}

export type AuditEntry = {
  userId: string | null;
  entity: string;
  entityId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
};

export interface AuditRepository {
  log(e: AuditEntry): Promise<void>;
}

// ── Users (admin) ────────────────────────────────────────────────────────────
export interface UserAdminRepository {
  list(q: UserListQuery): Promise<{ rows: UserDto[]; total: number }>;
  get(id: string): Promise<UserDto | null>;
  /** FOR UPDATE app_user — serialisasi aksi admin pada user yang sama. */
  lock(id: string): Promise<boolean>;
  identityTaken(
    p: { username?: string; email?: string | null },
    exceptId?: string,
  ): Promise<boolean>;
  insert(u: {
    username: string;
    fullName: string | null;
    email: string | null;
    passwordHash: string;
  }): Promise<string>;
  update(id: string, p: { fullName?: string | null; email?: string | null }): Promise<void>;
  /** ACTIVE juga mengosongkan failed_login_count & locked_until (= unlock). */
  setStatus(id: string, status: UserStatus): Promise<void>;
  /** Reset oleh admin: must_change_password = true. */
  resetPassword(id: string, hash: string): Promise<void>;
  setRoles(id: string, roleIds: string[]): Promise<void>;
  /** Jumlah user ACTIVE yang masih punya hak view+edit menu admin_users. */
  adminCount(): Promise<number>;
  listRoles(): Promise<RoleDto[]>;
  rolesExist(ids: string[]): Promise<boolean>;
}

// ── CONTOH CRUD NETRAL ───────────────────────────────────────────────────────
export interface SampleItemRepository {
  list(q: SampleItemListQuery): Promise<{ rows: SampleItemDto[]; total: number }>;
  findById(id: string): Promise<SampleItemDto | null>;
  codeExists(code: string): Promise<boolean>;
  insert(p: SampleItemCreate, createdBy: string): Promise<string>;
  update(id: string, p: SampleItemUpdate): Promise<void>;
  /** Kunci baris (FOR UPDATE) sebelum ubah/hapus agar aksi paralel terserialisasi. */
  lock(id: string): Promise<boolean>;
  delete(id: string): Promise<void>;
}

/** Semua repository berbagi SATU transaksi (UnitOfWork). */
export type Repos = {
  users: UserRepository;
  access: AccessRepository;
  settings: SettingsRepository;
  refreshTokens: RefreshTokenRepository;
  audit: AuditRepository;
  userAdmin: UserAdminRepository;
  sampleItems: SampleItemRepository;
};

export interface UnitOfWork {
  /** Menjalankan fn dalam satu transaksi DB; rollback bila melempar. */
  run<T>(fn: (repos: Repos) => Promise<T>): Promise<T>;
}

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<{ ok: boolean; needsRehash: boolean }>;
  /** Hash tiruan untuk menyamakan waktu respons saat username tak dikenal (auth-session §2). */
  dummyVerify(plain: string): Promise<void>;
}

/** mustChangePassword: selama true, API hanya mengizinkan change-password/me/logout (auth-session §2). */
export type AccessClaims = {
  sub: string;
  roles: string[];
  mustChangePassword: boolean;
};

export interface TokenService {
  signAccess(claims: AccessClaims): Promise<{ token: string; expiresAt: Date }>;
  verifyAccess(token: string): Promise<(AccessClaims & { jti: string }) | null>;
  newRefreshToken(): { raw: string; hash: string };
  hashRefresh(raw: string): string;
}
