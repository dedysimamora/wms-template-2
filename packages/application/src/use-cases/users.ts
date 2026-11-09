/**
 * Use-case halaman Users (menu `admin_users`). Setiap aksi tulis:
 *  1. authorize (RBAC server-side) di dalam transaksi,
 *  2. validasi aturan bisnis → DomainError,
 *  3. tulis data + audit_log di transaksi yang SAMA,
 *  4. pengaman "administrator terakhir" (LAST_ADMIN) sebelum commit.
 */
import { DomainError } from '@wms/domain';
import {
  resetPasswordRequest,
  userCreate,
  type UserAction,
  type UserCreate,
  type UserDto,
  type UserListQuery,
  type UserUpdate,
} from '@wms/contracts';
import type { Clock, PasswordHasher, Repos, UnitOfWork } from '../ports';
import { authorize } from './authorize';

const MENU = 'admin_users';

export type UserAdminDeps = { uow: UnitOfWork; clock: Clock; hasher: PasswordHasher };

/** Perubahan yang menyisakan nol administrator → rollback 409 LAST_ADMIN. */
async function assertAdminRemains(r: Repos) {
  if ((await r.userAdmin.adminCount()) === 0)
    throw new DomainError(
      'CONFLICT',
      'LAST_ADMIN',
      'Perubahan ini menyisakan nol administrator aktif',
    );
}

/** Snapshot ringkas untuk audit (tanpa hash password). */
const auditView = (u: UserDto) => ({
  username: u.username,
  full_name: u.full_name,
  email: u.email,
  status: u.status,
  roles: u.roles.map((x) => x.code),
});

async function mustUser(r: Repos, id: string) {
  if (!(await r.userAdmin.lock(id)))
    throw new DomainError('NOT_FOUND', undefined, 'User tidak ditemukan');
  return (await r.userAdmin.get(id))!;
}

export async function listUsers(uow: UnitOfWork, actor: string, q: UserListQuery) {
  return uow.run(async (r) => {
    await authorize(r, actor, MENU, 'view');
    return r.userAdmin.list(q);
  });
}

/** Daftar role untuk form user (cukup hak view Users). */
export async function listRoles(uow: UnitOfWork, actor: string) {
  return uow.run(async (r) => {
    await authorize(r, actor, MENU, 'view');
    return r.userAdmin.listRoles();
  });
}

export async function createUser(deps: UserAdminDeps, actor: string, raw: UserCreate) {
  const input = userCreate.parse(raw);
  // Hash di luar transaksi (argon2 lambat) → transaksi tetap pendek.
  const hash = await deps.hasher.hash(input.password);
  return deps.uow.run(async (r) => {
    await authorize(r, actor, MENU, 'create');
    if (await r.userAdmin.identityTaken({ username: input.username, email: input.email ?? null }))
      throw new DomainError('CONFLICT', 'CODE_TAKEN', 'Username atau email sudah dipakai');
    if (input.role_ids.length && !(await r.userAdmin.rolesExist(input.role_ids)))
      throw new DomainError('VALIDATION_ERROR', undefined, 'Role tidak ditemukan');
    const id = await r.userAdmin.insert({
      username: input.username,
      fullName: input.full_name ?? null,
      email: input.email ?? null,
      passwordHash: hash,
    });
    await r.userAdmin.setRoles(id, input.role_ids);
    const after = (await r.userAdmin.get(id))!;
    await r.audit.log({
      userId: actor,
      entity: 'app_user',
      entityId: id,
      action: 'CREATE',
      after: auditView(after),
    });
    return after;
  });
}

export async function updateUser(uow: UnitOfWork, actor: string, id: string, input: UserUpdate) {
  return uow.run(async (r) => {
    await authorize(r, actor, MENU, 'edit');
    const before = await mustUser(r, id);
    if (input.email && (await r.userAdmin.identityTaken({ email: input.email }, id)))
      throw new DomainError('CONFLICT', 'CODE_TAKEN', 'Email sudah dipakai');
    await r.userAdmin.update(id, { fullName: input.full_name, email: input.email });
    const after = (await r.userAdmin.get(id))!;
    await r.audit.log({
      userId: actor,
      entity: 'app_user',
      entityId: id,
      action: 'UPDATE',
      before: auditView(before),
      after: auditView(after),
    });
    return after;
  });
}

/** POST /admin/users/{id}/{action}. Nonaktif → semua sesi dicabut seketika. */
export async function userAction(
  deps: UserAdminDeps,
  actor: string,
  id: string,
  action: UserAction,
  body: unknown,
) {
  const password = action === 'reset-password' ? resetPasswordRequest.parse(body) : null;
  const hash = password ? await deps.hasher.hash(password.new_password) : null;
  return deps.uow.run(async (r) => {
    await authorize(r, actor, MENU, 'edit');
    const before = await mustUser(r, id);
    const now = deps.clock.now();
    if (action === 'deactivate' && id === actor)
      throw new DomainError('CONFLICT', 'SELF_ACTION', 'Tidak bisa menonaktifkan diri sendiri');
    switch (action) {
      case 'deactivate':
        await r.userAdmin.setStatus(id, 'INACTIVE');
        await r.refreshTokens.revokeAllForUser(id, now);
        break;
      case 'activate':
      case 'unlock':
        await r.userAdmin.setStatus(id, 'ACTIVE');
        break;
      case 'reset-password':
        await r.userAdmin.resetPassword(id, hash!);
        await r.refreshTokens.revokeAllForUser(id, now);
        break;
      case 'revoke-sessions':
        await r.refreshTokens.revokeAllForUser(id, now);
        break;
    }
    await assertAdminRemains(r);
    const after = (await r.userAdmin.get(id))!;
    await r.audit.log({
      userId: actor,
      entity: 'app_user',
      entityId: id,
      action: action.toUpperCase().replace(/-/g, '_'),
      before: { status: before.status },
      after: { status: after.status },
    });
    return after;
  });
}

export async function setUserRoles(uow: UnitOfWork, actor: string, id: string, roleIds: string[]) {
  return uow.run(async (r) => {
    await authorize(r, actor, MENU, 'edit');
    const before = await mustUser(r, id);
    const ids = [...new Set(roleIds)];
    if (ids.length && !(await r.userAdmin.rolesExist(ids)))
      throw new DomainError('VALIDATION_ERROR', undefined, 'Role tidak ditemukan');
    await r.userAdmin.setRoles(id, ids);
    await assertAdminRemains(r);
    const after = (await r.userAdmin.get(id))!;
    await r.audit.log({
      userId: actor,
      entity: 'user_role',
      entityId: id,
      action: 'UPDATE',
      before: { roles: before.roles.map((x) => x.code) },
      after: { roles: after.roles.map((x) => x.code) },
    });
    return after;
  });
}
