import { DomainError } from '@wms/domain';
import type { LoginRequest, MeResponse } from '@wms/contracts';
import type { Clock, PasswordHasher, Repos, TokenService, UnitOfWork, UserRecord } from '../ports';
import { effectiveMenuAccess, isTrue } from './authorize';

export type AuthDeps = {
  uow: UnitOfWork;
  hasher: PasswordHasher;
  tokens: TokenService;
  clock: Clock;
  refreshTtlSeconds: number;
  graceSeconds: number;
};

export type RequestMeta = { ip?: string | null; userAgent?: string | null };

export type SessionTokens = {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
};

/** Feature flag yang dikirim ke FE = semua setting boolean ber-prefix `enable_`. */
function uiFlags(settings: Record<string, { value: string | null; dataType: string }>) {
  const flags: MeResponse['flags'] = {};
  for (const [k, s] of Object.entries(settings))
    if (k.startsWith('enable_') && s.dataType === 'boolean') flags[k] = isTrue(s.value);
  return flags;
}

export async function buildMe(repos: Repos, user: UserRecord): Promise<MeResponse> {
  // Sekuensial (satu koneksi transaksi).
  const roles = await repos.access.rolesOf(user.id);
  const menuAccess = await effectiveMenuAccess(repos, user.id);
  const settings = await repos.settings.all();
  return {
    user: {
      id: user.id,
      username: user.username,
      full_name: user.fullName,
      must_change_password: user.mustChangePassword,
    },
    roles,
    menuAccess,
    flags: uiFlags(settings),
  };
}

async function issue(
  deps: AuthDeps,
  repos: Repos,
  user: UserRecord,
  familyId: string,
  meta: RequestMeta,
) {
  const roles = await repos.access.rolesOf(user.id);
  const access = await deps.tokens.signAccess({
    sub: user.id,
    roles,
    mustChangePassword: user.mustChangePassword,
  });
  const refresh = deps.tokens.newRefreshToken();
  const refreshExpiresAt = new Date(deps.clock.now().getTime() + deps.refreshTtlSeconds * 1000);
  const id = await repos.refreshTokens.insert({
    userId: user.id,
    familyId,
    tokenHash: refresh.hash,
    expiresAt: refreshExpiresAt,
    userAgent: meta.userAgent?.slice(0, 255) ?? null,
  });
  return {
    id,
    tokens: {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken: refresh.raw,
      refreshExpiresAt,
    } satisfies SessionTokens,
  };
}

/**
 * Login (auth-session §2): lockout setelah N gagal, pesan identik untuk username/password salah
 * (anti-enumerasi), rehash bcrypt→argon2id, audit. Ambang & durasi lockout dari app_setting.
 */
export async function login(deps: AuthDeps, input: LoginRequest, meta: RequestMeta) {
  return deps.uow.run(async (repos) => {
    const now = deps.clock.now();
    const user = await repos.users.findByUsername(input.username);
    if (!user) {
      await deps.hasher.dummyVerify(input.password);
      await repos.audit.log({
        userId: null,
        entity: 'auth',
        action: 'LOGIN_FAILED',
        after: { username: input.username },
        ip: meta.ip ?? null,
      });
      throw new DomainError(
        'UNAUTHENTICATED',
        'INVALID_CREDENTIALS',
        'Username atau password salah',
      );
    }
    if (user.status === 'INACTIVE')
      throw new DomainError('UNAUTHENTICATED', 'ACCOUNT_INACTIVE', 'Akun nonaktif');
    if (user.status === 'LOCKED' || (user.lockedUntil && user.lockedUntil > now)) {
      throw new DomainError('UNAUTHENTICATED', 'ACCOUNT_LOCKED', 'Akun terkunci sementara');
    }

    const settings = await repos.settings.all();
    const maxFailed = Number(settings.login_max_failed_attempts?.value ?? 5);
    const lockMinutes = Number(settings.lockout_minutes?.value ?? 15);

    const check = await deps.hasher.verify(user.passwordHash, input.password);
    if (!check.ok) {
      const failed = user.failedLoginCount + 1;
      const lockUntil = failed >= maxFailed ? new Date(now.getTime() + lockMinutes * 60_000) : null;
      await repos.users.recordLoginFailure(user.id, lockUntil ? 0 : failed, lockUntil);
      await repos.audit.log({
        userId: user.id,
        entity: 'app_user',
        entityId: user.id,
        action: lockUntil ? 'LOCK' : 'LOGIN_FAILED',
        ip: meta.ip ?? null,
      });
      throw new DomainError(
        'UNAUTHENTICATED',
        'INVALID_CREDENTIALS',
        'Username atau password salah',
      );
    }

    const rehash = check.needsRehash ? await deps.hasher.hash(input.password) : undefined;
    await repos.users.recordLoginSuccess(user.id, now, rehash);
    const { tokens } = await issue(deps, repos, user, crypto.randomUUID(), meta);
    await repos.audit.log({
      userId: user.id,
      entity: 'app_user',
      entityId: user.id,
      action: 'LOGIN',
      ip: meta.ip ?? null,
    });
    return {
      tokens,
      me: await buildMe(repos, { ...user, failedLoginCount: 0, lockedUntil: null }),
    };
  });
}

/**
 * Rotasi refresh one-time-use + grace window (auth-session §1).
 * Baris refresh di-lock sehingga dua refresh paralel terserialisasi (CC-11).
 */
export async function refreshSession(deps: AuthDeps, raw: string, meta: RequestMeta) {
  const hash = deps.tokens.hashRefresh(raw);
  const outcome = await deps.uow.run(async (repos) => {
    const now = deps.clock.now();
    const rt = await repos.refreshTokens.lockByHash(hash);
    if (!rt || rt.revoked || rt.expiresAt <= now) return { kind: 'invalid' as const };

    if (rt.usedAt) {
      const withinGrace = now.getTime() - rt.usedAt.getTime() <= deps.graceSeconds * 1000;
      if (!withinGrace) {
        await repos.refreshTokens.revokeFamily(rt.familyId, now);
        await repos.audit.log({
          userId: rt.userId,
          entity: 'refresh_token',
          entityId: rt.familyId,
          action: 'REFRESH_REUSE',
          ip: meta.ip ?? null,
        });
        return { kind: 'reused' as const };
      }
      await repos.audit.log({
        userId: rt.userId,
        entity: 'refresh_token',
        entityId: rt.familyId,
        action: 'REFRESH_RACE',
        ip: meta.ip ?? null,
      });
    }

    const user = await repos.users.findById(rt.userId);
    if (!user || user.status !== 'ACTIVE' || (user.lockedUntil && user.lockedUntil > now)) {
      await repos.refreshTokens.revokeAllForUser(rt.userId, now);
      return { kind: 'invalid' as const };
    }
    const issued = await issue(deps, repos, user, rt.familyId, meta);
    if (!rt.usedAt) await repos.refreshTokens.markUsed(rt.id, issued.id, now);
    return { kind: 'ok' as const, tokens: issued.tokens, me: await buildMe(repos, user) };
  });
  // Pencabutan family harus ter-commit → lempar error SETELAH transaksi selesai.
  if (outcome.kind === 'reused')
    throw new DomainError('UNAUTHENTICATED', 'TOKEN_REUSED', 'Sesi dicabut (token dipakai ulang)');
  if (outcome.kind === 'invalid')
    throw new DomainError('UNAUTHENTICATED', undefined, 'Sesi tidak valid');
  return { tokens: outcome.tokens, me: outcome.me };
}

export async function logout(deps: AuthDeps, raw: string | undefined, meta: RequestMeta) {
  if (!raw) return;
  await deps.uow.run(async (repos) => {
    const rt = await repos.refreshTokens.lockByHash(deps.tokens.hashRefresh(raw));
    if (!rt) return;
    await repos.refreshTokens.revokeFamily(rt.familyId, deps.clock.now());
    await repos.audit.log({
      userId: rt.userId,
      entity: 'auth',
      action: 'LOGOUT',
      ip: meta.ip ?? null,
    });
  });
}

export async function getMe(deps: Pick<AuthDeps, 'uow'>, userId: string): Promise<MeResponse> {
  return deps.uow.run(async (repos) => {
    const user = await repos.users.findById(userId);
    if (!user || user.status !== 'ACTIVE')
      throw new DomainError('UNAUTHENTICATED', undefined, 'Sesi tidak valid');
    return buildMe(repos, user);
  });
}

export async function changePassword(
  deps: AuthDeps,
  userId: string,
  input: { current_password: string; new_password: string },
  meta: RequestMeta,
) {
  await deps.uow.run(async (repos) => {
    const user = await repos.users.findById(userId);
    if (!user) throw new DomainError('UNAUTHENTICATED');
    const ok = await deps.hasher.verify(user.passwordHash, input.current_password);
    if (!ok.ok)
      throw new DomainError('BUSINESS_RULE', 'INVALID_CREDENTIALS', 'Password lama salah');
    await repos.users.updatePassword(userId, await deps.hasher.hash(input.new_password));
    await repos.refreshTokens.revokeAllForUser(userId, deps.clock.now());
    await repos.audit.log({
      userId,
      entity: 'app_user',
      entityId: userId,
      action: 'CHANGE_PASSWORD',
      ip: meta.ip ?? null,
    });
  });
}
