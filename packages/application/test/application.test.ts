import { describe, expect, it } from 'vitest';
import { DomainError } from '@wms/domain';
import {
  createSampleItem,
  deleteSampleItem,
  getMe,
  listSampleItems,
  login,
  refreshSession,
  updateSampleItem,
  type AuthDeps,
} from '../src';
import { FakeClock, hasher, tokens, uow, world } from './fakes';

const deps = (
  w = world(),
  clock = new FakeClock(),
): AuthDeps & { w: typeof w; clock: FakeClock } => ({
  uow: uow(w),
  hasher,
  tokens,
  clock,
  refreshTtlSeconds: 604800,
  graceSeconds: 30,
  w,
});
const reason = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    (e: DomainError) => `${e.code}/${e.reason ?? ''}`,
  );

describe('login', () => {
  it('sukses: rehash bcrypt→argon2, menuAccess, flags, audit LOGIN', async () => {
    const d = deps();
    const { me, tokens: t } = await login(d, { username: 'admin', password: 'ChangeMe123!' }, {});
    expect(t.refreshToken).toBeTruthy();
    expect(d.w.users[0]!.passwordHash).toBe('argon:ChangeMe123!');
    expect(Object.keys(me.menuAccess).sort()).toEqual(['admin_users', 'sample_items']);
    expect(me.user.must_change_password).toBe(true);
    expect(me.flags).toEqual({ enable_sample_items: true });
    expect(d.w.audit.at(-1)?.action).toBe('LOGIN');
  });
  it('username tak dikenal & password salah → pesan identik (anti-enumerasi)', async () => {
    const d = deps();
    expect(await reason(login(d, { username: 'nobody', password: 'x' }, {}))).toBe(
      'UNAUTHENTICATED/INVALID_CREDENTIALS',
    );
    expect(await reason(login(d, { username: 'admin', password: 'x' }, {}))).toBe(
      'UNAUTHENTICATED/INVALID_CREDENTIALS',
    );
  });
  it('lockout setelah ambang gagal, terbuka setelah lockout_minutes', async () => {
    const d = deps();
    for (let i = 0; i < 3; i++)
      await reason(login(d, { username: 'admin', password: 'salah' }, {}));
    expect(await reason(login(d, { username: 'admin', password: 'ChangeMe123!' }, {}))).toBe(
      'UNAUTHENTICATED/ACCOUNT_LOCKED',
    );
    d.clock.advance(16 * 60_000);
    expect(await reason(login(d, { username: 'admin', password: 'ChangeMe123!' }, {}))).toBe('OK');
  });
  it('feature flag mati → menu disembunyikan', async () => {
    const d = deps();
    d.w.settings.enable_sample_items!.value = 'false';
    const me = await getMe(d, 'u2');
    expect(me.menuAccess).toEqual({});
    expect(me.flags.enable_sample_items).toBe(false);
  });
});

describe('refresh (rotasi token)', () => {
  it('rotasi; reuse dalam grace window → sesi baru tanpa cabut family', async () => {
    const d = deps();
    const { tokens: t } = await login(d, { username: 'admin', password: 'ChangeMe123!' }, {});
    const a = await refreshSession(d, t.refreshToken, {});
    d.clock.advance(5_000);
    const b = await refreshSession(d, t.refreshToken, {}); // balapan sah (2 tab)
    expect(a.tokens.refreshToken).not.toBe(b.tokens.refreshToken);
    expect(d.w.refresh.every((r) => !r.revoked)).toBe(true);
    expect(d.w.audit.some((e) => e.action === 'REFRESH_RACE')).toBe(true);
  });
  it('reuse di luar grace window → family dicabut + TOKEN_REUSED', async () => {
    const d = deps();
    const { tokens: t } = await login(d, { username: 'admin', password: 'ChangeMe123!' }, {});
    const a = await refreshSession(d, t.refreshToken, {});
    d.clock.advance(31_000);
    expect(await reason(refreshSession(d, t.refreshToken, {}))).toBe(
      'UNAUTHENTICATED/TOKEN_REUSED',
    );
    expect(await reason(refreshSession(d, a.tokens.refreshToken, {}))).toBe('UNAUTHENTICATED/'); // ikut dicabut
  });
  it('user dinonaktifkan → refresh & me ditolak', async () => {
    const d = deps();
    const { tokens: t } = await login(d, { username: 'admin', password: 'ChangeMe123!' }, {});
    d.w.users[0]!.status = 'INACTIVE';
    expect(await reason(refreshSession(d, t.refreshToken, {}))).toBe('UNAUTHENTICATED/');
    expect(await reason(getMe(d, 'u1'))).toBe('UNAUTHENTICATED/');
  });
});

describe('sample items (contoh CRUD + RBAC per aksi)', () => {
  const item = { code: 'ITEM-1', name: 'Contoh' };
  it('staff boleh view/create/edit, TIDAK boleh delete', async () => {
    const d = deps();
    const created = await createSampleItem(d.uow, 'u2', item);
    expect((await listSampleItems(d.uow, 'u2', { page: 1, per_page: 50 })).total).toBe(1);
    expect((await updateSampleItem(d.uow, 'u2', created.id, { name: 'Baru' })).name).toBe('Baru');
    expect(await reason(deleteSampleItem(d.uow, 'u2', created.id))).toBe('FORBIDDEN/');
    expect(await reason(deleteSampleItem(d.uow, 'u1', created.id))).toBe('OK');
    expect(d.w.audit.map((a) => a.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
  });
  it('kode duplikat → 409 CODE_TAKEN', async () => {
    const d = deps();
    await createSampleItem(d.uow, 'u1', item);
    expect(await reason(createSampleItem(d.uow, 'u1', item))).toBe('CONFLICT/CODE_TAKEN');
  });
  it('user tanpa role → 403 (deny-by-default)', async () => {
    const d = deps();
    d.w.access.u2 = [];
    expect(await reason(listSampleItems(d.uow, 'u2', { page: 1, per_page: 50 }))).toBe(
      'FORBIDDEN/',
    );
  });
  it('id tak ada → 404', async () => {
    const d = deps();
    expect(await reason(updateSampleItem(d.uow, 'u1', 'x', { name: 'A' }))).toBe('NOT_FOUND/');
  });
});
