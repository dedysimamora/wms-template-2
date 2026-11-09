import { z } from 'zod';

export const loginRequest = z.object({
  username: z.string().trim().min(1).max(60),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequest>;

/** Kebijakan password (auth-session §2). */
export const newPassword = z
  .string()
  .min(10, 'minimal 10 karakter')
  .max(200)
  .regex(/[A-Za-z]/, 'harus mengandung huruf')
  .regex(/\d/, 'harus mengandung angka');

export const changePasswordRequest = z.object({
  current_password: z.string().min(1),
  new_password: newPassword,
});

export const menuAccessFlags = z.object({
  view: z.boolean(),
  create: z.boolean(),
  edit: z.boolean(),
  delete: z.boolean(),
});

/** GET /auth/me — juga isi cookie `user_session` (cache tampilan, bukan dasar otorisasi). */
export const meResponse = z.object({
  user: z.object({
    id: z.string(),
    username: z.string(),
    full_name: z.string().nullable(),
    must_change_password: z.boolean(),
  }),
  roles: z.array(z.string()),
  menuAccess: z.record(z.string(), menuAccessFlags),
  /** Feature flag dari app_setting (`enable_*`) — UI menyembunyikan fitur yang mati. */
  flags: z.record(z.string(), z.boolean()),
});
export type MeResponse = z.infer<typeof meResponse>;
