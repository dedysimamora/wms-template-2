import type {
  AuditEntry,
  Clock,
  PasswordHasher,
  RefreshTokenRecord,
  Repos,
  TokenService,
  UnitOfWork,
  UserRecord,
} from '../src';
import type { SampleItemDto } from '@wms/contracts';
import type { MenuAccessFlags } from '@wms/domain';

/**
 * Repository palsu (in-memory) untuk unit test use-case — cepat, tanpa DB.
 * Perilaku SQL sungguhan (lock, constraint) diuji di packages/infrastructure/test (Testcontainers).
 */
export class FakeClock implements Clock {
  constructor(public t = new Date('2026-11-01T08:00:00Z')) {}
  now() {
    return new Date(this.t);
  }
  advance(ms: number) {
    this.t = new Date(this.t.getTime() + ms);
  }
}

export const hasher: PasswordHasher = {
  hash: async (p) => `argon:${p}`,
  verify: async (h, p) => ({
    ok: h === `argon:${p}` || h === `bcrypt:${p}`,
    needsRehash: h.startsWith('bcrypt:'),
  }),
  dummyVerify: async () => {},
};

let n = 0;
export const tokens: TokenService = {
  signAccess: async (c) => ({
    token: `access-${c.sub}-${++n}`,
    expiresAt: new Date(Date.now() + 900_000),
  }),
  verifyAccess: async () => null,
  newRefreshToken: () => {
    const raw = `rt-${++n}`;
    return { raw, hash: `h(${raw})` };
  },
  hashRefresh: (raw) => `h(${raw})`,
};

const flags = (v: boolean, c: boolean, e: boolean, d: boolean): MenuAccessFlags => ({
  view: v,
  create: c,
  edit: e,
  delete: d,
});

export type World = {
  users: UserRecord[];
  roles: Record<string, string[]>;
  access: Record<string, Array<{ menuCode: string } & MenuAccessFlags>>;
  settings: Record<string, { value: string | null; dataType: string }>;
  refresh: Array<RefreshTokenRecord & { hash: string }>;
  audit: AuditEntry[];
  items: SampleItemDto[];
};

const user = (id: string, username: string, passwordHash: string, mcp: boolean): UserRecord => ({
  id,
  username,
  fullName: username,
  passwordHash,
  status: 'ACTIVE',
  mustChangePassword: mcp,
  failedLoginCount: 0,
  lockedUntil: null,
});

/** Dunia awal = cermin seed: admin (ADMIN) & staff (STAFF, tanpa hak hapus). */
export function world(): World {
  return {
    users: [
      user('u1', 'admin', 'bcrypt:ChangeMe123!', true),
      user('u2', 'staff', 'argon:Secret12345', false),
    ],
    roles: { u1: ['ADMIN'], u2: ['STAFF'] },
    access: {
      u1: [
        { menuCode: 'sample_items', ...flags(true, true, true, true) },
        { menuCode: 'admin_users', ...flags(true, true, true, true) },
      ],
      u2: [{ menuCode: 'sample_items', ...flags(true, true, true, false) }],
    },
    settings: {
      login_max_failed_attempts: { value: '3', dataType: 'integer' },
      lockout_minutes: { value: '15', dataType: 'integer' },
      enable_sample_items: { value: 'true', dataType: 'boolean' },
    },
    refresh: [],
    audit: [],
    items: [],
  };
}

export function uow(w: World): UnitOfWork {
  const repos: Repos = {
    users: {
      findByUsername: async (u) => w.users.find((x) => x.username === u) ?? null,
      findById: async (id) => w.users.find((x) => x.id === id) ?? null,
      recordLoginSuccess: async (id, _at, h) => {
        const u = w.users.find((x) => x.id === id)!;
        u.failedLoginCount = 0;
        u.lockedUntil = null;
        if (h) u.passwordHash = h;
      },
      recordLoginFailure: async (id, c, l) => {
        const u = w.users.find((x) => x.id === id)!;
        u.failedLoginCount = c;
        u.lockedUntil = l;
      },
      updatePassword: async (id, h) => {
        w.users.find((x) => x.id === id)!.passwordHash = h;
      },
    },
    access: {
      rolesOf: async (id) => w.roles[id] ?? [],
      menuAccessRows: async (id) =>
        w.users.find((u) => u.id === id)?.status === 'ACTIVE' ? (w.access[id] ?? []) : [],
    },
    settings: { all: async () => w.settings },
    refreshTokens: {
      insert: async (r) => {
        const id = `rt${w.refresh.length + 1}`;
        w.refresh.push({
          id,
          userId: r.userId,
          familyId: r.familyId,
          hash: r.tokenHash,
          replacedBy: null,
          usedAt: null,
          revoked: false,
          expiresAt: r.expiresAt,
        });
        return id;
      },
      lockByHash: async (h) => w.refresh.find((x) => x.hash === h) ?? null,
      markUsed: async (id, by, at) => {
        const r = w.refresh.find((x) => x.id === id)!;
        r.usedAt = at;
        r.replacedBy = by;
      },
      revokeFamily: async (f) => {
        w.refresh.filter((x) => x.familyId === f).forEach((x) => (x.revoked = true));
      },
      revokeAllForUser: async (u) => {
        w.refresh.filter((x) => x.userId === u).forEach((x) => (x.revoked = true));
      },
    },
    audit: {
      log: async (e) => {
        w.audit.push(e);
      },
    },
    // Users admin diuji di integrasi (SQL nyata); unit test tidak memakainya.
    userAdmin: new Proxy({} as Repos['userAdmin'], {
      get: () => () => Promise.reject(new Error('userAdmin tidak di-fake')),
    }),
    sampleItems: {
      list: async (q) => {
        const rows = w.items.filter((i) => !q.status || i.status === q.status);
        return { rows, total: rows.length };
      },
      findById: async (id) => w.items.find((i) => i.id === id) ?? null,
      codeExists: async (code) => w.items.some((i) => i.code === code),
      insert: async (p, by) => {
        const id = `i${w.items.length + 1}`;
        const now = new Date().toISOString();
        w.items.push({
          id,
          code: p.code,
          name: p.name,
          description: p.description ?? null,
          status: 'ACTIVE',
          created_by: { id: by, username: by },
          created_at: now,
          updated_at: now,
        });
        return id;
      },
      update: async (id, p) => {
        const i = w.items.find((x) => x.id === id)!;
        Object.assign(i, p);
      },
      lock: async (id) => w.items.some((i) => i.id === id),
      delete: async (id) => {
        w.items = w.items.filter((i) => i.id !== id);
      },
    },
  };
  return { run: (fn) => fn(repos) };
}
