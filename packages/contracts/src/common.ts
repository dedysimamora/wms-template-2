import { z } from 'zod';

export const uuid = z.uuid();

/** Query daftar standar (api-design §1.3): paging offset + pencarian bebas + sort. */
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(100).optional(),
  sort: z
    .string()
    .regex(/^-?[a-z_]+$/)
    .optional(),
});
export type ListQuery = z.infer<typeof listQuery>;

export type Envelope<T> =
  { success: true; data: T; meta?: Record<string, unknown> } | { success: false; error: ApiError };

export type ApiError = { code: string; reason?: string; message: string; details?: unknown };

/**
 * Katalog reason (api-design §1.2.1) — subkode error yang dipetakan UI ke pesan i18n.
 * Tambah reason = tambah di sini + `errors.<reason>` di apps/web/src/messages/*.json.
 */
export const ERROR_REASONS = [
  // auth
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ACCOUNT_INACTIVE',
  'MUST_CHANGE_PASSWORD',
  'TOKEN_REUSED',
  // umum
  'CODE_TAKEN',
  'LOCK_TIMEOUT',
  'IN_USE',
  // users
  'LAST_ADMIN',
  'SELF_ACTION',
] as const;
export type ErrorReason = (typeof ERROR_REASONS)[number];
