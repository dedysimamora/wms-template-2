import { z } from 'zod';
import { newPassword } from './auth';
import { listQuery, uuid } from './common';

/** Kontrak halaman Users (admin): kelola akun, role, status, dan sesi. */

export const USER_STATUSES = ['ACTIVE', 'INACTIVE', 'LOCKED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

const username = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,59}$/, 'huruf/angka/._-, 3–60 karakter');

export const userCreate = z.object({
  username,
  full_name: z.string().trim().max(150).optional(),
  email: z.email().max(150).optional(),
  /** Password sementara — wajib diganti user saat login pertama. */
  password: newPassword,
  role_ids: z.array(uuid).max(20).default([]),
});
export type UserCreate = z.input<typeof userCreate>;

export const userUpdate = z
  .object({
    full_name: z.string().trim().max(150).nullable().optional(),
    email: z.email().max(150).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'tidak ada perubahan');
export type UserUpdate = z.infer<typeof userUpdate>;

export const userListQuery = listQuery.extend({
  status: z.enum(USER_STATUSES).optional(),
  role_id: uuid.optional(),
});
export type UserListQuery = z.infer<typeof userListQuery>;

/** POST /admin/users/{id}/{action} */
export const USER_ACTIONS = [
  'activate',
  'deactivate',
  'unlock',
  'reset-password',
  'revoke-sessions',
] as const;
export type UserAction = (typeof USER_ACTIONS)[number];

export const resetPasswordRequest = z.object({ new_password: newPassword });
export const userRolesPut = z.object({ role_ids: z.array(uuid).max(20) });

export type UserDto = {
  id: string;
  username: string;
  full_name: string | null;
  email: string | null;
  status: UserStatus;
  must_change_password: boolean;
  failed_login_count: number;
  locked_until: string | null;
  roles: Array<{ id: string; code: string; name: string }>;
  active_sessions: number;
  last_login_at: string | null;
  created_at: string;
};

export type RoleDto = {
  id: string;
  code: string;
  name: string;
  description: string | null;
};
