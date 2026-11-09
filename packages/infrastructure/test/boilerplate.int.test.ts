import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  createSampleItem,
  createUser,
  deleteSampleItem,
  effectiveMenuAccess,
  getMe,
  listRoles,
  listSampleItems,
  listUsers,
  login,
  refreshSession,
  setUserRoles,
  updateSampleItem,
  userAction,
} from '@wms/application';
import type { DomainError } from '@wms/domain';
import { race, startTestDb, type TestDb } from './harness';

let t: TestDb;
const q = <R extends pg.QueryResultRow = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
  t.c.pool.query<R>(sql, p);
const reason = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    (e: DomainError) => `${e.code}/${e.reason ?? ''}`,
  );
const idOf = async (username: string) =>
  (await q<{ id: string }>(`SELECT id FROM app_user WHERE username=$1`, [username])).rows[0]!.id;

let admin: string;
let staff: string;

beforeAll(async () => {
  t = await startTestDb();
  admin = await idOf('admin');
  staff = await idOf('staff');
}, 180_000);
afterAll(async () => {
  await t?.stop();
});

describe('auth dengan seed nyata', () => {
  it('admin seed (bcrypt) login → rehash argon2id, must_change_password, audit', async () => {
    const r = await login(t.c.auth, { username: 'admin', password: 'ChangeMe123!' }, {});
    expect(r.me.roles).toEqual(['ADMIN']);
    expect(r.me.user.must_change_password).toBe(true);
    // kode menu induk (modul) ikut terkirim karena grant per-modul di seed
    expect(Object.keys(r.me.menuAccess).sort()).toEqual([
      'admin',
      'admin_users',
      'sample',
      'sample_items',
    ]);
    const { rows } = await q<{ password_hash: string }>(
      `SELECT password_hash FROM app_user WHERE username='admin'`,
    );
    expect(rows[0]!.password_hash.startsWith('$argon2id$')).toBe(true);
    expect((await q(`SELECT 1 FROM audit_log WHERE action='LOGIN'`)).rowCount).toBe(1);
  });

  it('refresh paralel (2 tab) → keduanya sukses, family tidak dicabut', async () => {
    const r = await login(t.c.auth, { username: 'staff', password: 'ChangeMe123!' }, {});
    const res = await race(2, () => refreshSession(t.c.auth, r.tokens.refreshToken, {}));
    expect(res).toEqual(['OK', 'OK']);
  });
});

describe('matriks RBAC seed', () => {
  it('ADMIN: semua hak; STAFF: sample_items tanpa delete, tanpa admin_users', async () => {
    const a = await t.c.uow.run((r) => effectiveMenuAccess(r, admin));
    const s = await t.c.uow.run((r) => effectiveMenuAccess(r, staff));
    expect(a.admin_users).toEqual({ view: true, create: true, edit: true, delete: true });
    expect(a.sample_items).toEqual({ view: true, create: true, edit: true, delete: true });
    expect(s.sample_items).toEqual({ view: true, create: true, edit: true, delete: false });
    expect(s).not.toHaveProperty('admin_users');
    expect(s).not.toHaveProperty('admin');
  });

  it('feature flag mati → menu hilang & API 403', async () => {
    await q(`UPDATE app_setting SET value='false' WHERE key='enable_sample_items'`);
    expect((await getMe(t.c.auth, staff)).menuAccess).toEqual({});
    expect(await reason(listSampleItems(t.c.uow, staff, { page: 1, per_page: 10 }))).toBe(
      'FORBIDDEN/',
    );
    await q(`UPDATE app_setting SET value='true' WHERE key='enable_sample_items'`);
  });
});

describe('sample items (SQL nyata)', () => {
  it('CRUD + RBAC per aksi + audit', async () => {
    const it1 = await createSampleItem(t.c.uow, staff, { code: 'ITEM-001', name: 'Pertama' });
    expect(it1.created_by?.username).toBe('staff');
    const up = await updateSampleItem(t.c.uow, staff, it1.id, { status: 'INACTIVE' });
    expect(up.status).toBe('INACTIVE');
    expect(await reason(deleteSampleItem(t.c.uow, staff, it1.id))).toBe('FORBIDDEN/');
    const page = await listSampleItems(t.c.uow, admin, {
      page: 1,
      per_page: 10,
      q: 'pert',
      status: 'INACTIVE',
    });
    expect(page.total).toBe(1);
    expect(await reason(deleteSampleItem(t.c.uow, admin, it1.id))).toBe('OK');
    const audit = await q<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity='sample_item' ORDER BY at, id`,
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
  });

  it('create paralel kode sama → tepat 1 sukses, sisanya CODE_TAKEN', async () => {
    const res = await race(4, () =>
      createSampleItem(t.c.uow, admin, { code: 'RACE-1', name: 'Balapan' }),
    );
    expect(res).toEqual([
      'CONFLICT/CODE_TAKEN',
      'CONFLICT/CODE_TAKEN',
      'CONFLICT/CODE_TAKEN',
      'OK',
    ]);
  });
});

describe('users (admin)', () => {
  it('staff tak bisa membuka daftar user (403)', async () => {
    expect(await reason(listUsers(t.c.uow, staff, { page: 1, per_page: 10 }))).toBe('FORBIDDEN/');
  });

  it('admin membuat user baru ber-role STAFF → bisa login, wajib ganti password', async () => {
    const roles = await listRoles(t.c.uow, admin);
    const staffRole = roles.find((r) => r.code === 'STAFF')!;
    const u = await createUser(t.c.userAdmin, admin, {
      username: 'budi',
      full_name: 'Budi',
      password: 'Sementara123',
      role_ids: [staffRole.id],
    });
    expect(u.roles.map((r) => r.code)).toEqual(['STAFF']);
    const r = await login(t.c.auth, { username: 'budi', password: 'Sementara123' }, {});
    expect(r.me.user.must_change_password).toBe(true);
    expect(
      await reason(
        createUser(t.c.userAdmin, admin, { username: 'BUDI', password: 'Sementara123' }),
      ),
    ).toBe('CONFLICT/CODE_TAKEN');
  });

  it('nonaktifkan → hak hilang seketika & sesi dicabut; aktifkan lagi', async () => {
    const budi = await idOf('budi');
    await userAction(t.c.userAdmin, admin, budi, 'deactivate', {});
    expect(await t.c.uow.run((r) => effectiveMenuAccess(r, budi))).toEqual({});
    const live = await q(`SELECT 1 FROM refresh_token WHERE user_id=$1 AND NOT revoked`, [budi]);
    expect(live.rowCount).toBe(0);
    await userAction(t.c.userAdmin, admin, budi, 'activate', {});
    expect(await t.c.uow.run((r) => effectiveMenuAccess(r, budi))).toHaveProperty('sample_items');
  });

  it('pengaman: tak bisa menonaktifkan diri sendiri & tak boleh sisa nol admin', async () => {
    expect(await reason(userAction(t.c.userAdmin, admin, admin, 'deactivate', {}))).toBe(
      'CONFLICT/SELF_ACTION',
    );
    expect(await reason(setUserRoles(t.c.uow, admin, admin, []))).toBe('CONFLICT/LAST_ADMIN');
    expect((await getMe(t.c.auth, admin)).roles).toEqual(['ADMIN']); // rollback utuh
  });

  it('reset password → must_change_password & sesi lama dicabut', async () => {
    const budi = await idOf('budi');
    await userAction(t.c.userAdmin, admin, budi, 'reset-password', {
      new_password: 'BaruLagi1234',
    });
    const r = await login(t.c.auth, { username: 'budi', password: 'BaruLagi1234' }, {});
    expect(r.me.user.must_change_password).toBe(true);
    // password lemah → ZodError (dipetakan ke HTTP 400 VALIDATION_ERROR oleh adapter web)
    await expect(
      userAction(t.c.userAdmin, admin, budi, 'reset-password', { new_password: 'x' }),
    ).rejects.toMatchObject({ name: 'ZodError' });
  });
});
