'use client';
import type { ApiError } from '@wms/contracts';

/** Error API terketik — UI memetakan `reason` ke pesan i18n (api-design §1.2.1). */
export class HttpError extends Error implements ApiError {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public reason?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const csrf = () => document.cookie.match(/(?:^|; )csrf_token=([^;]+)/)?.[1] ?? '';

let refreshing: Promise<boolean> | null = null;
/** Single-flight: paling banyak satu refresh berjalan per tab (auth-session §1). */
function refreshOnce(): Promise<boolean> {
  refreshing ??= fetch('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'x-csrf-token': csrf() },
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export type Paged<T> = {
  data: T;
  meta?: {
    page: number;
    per_page: number;
    total: number;
    /** Meta khusus endpoint — dibaca pemanggil dengan tipe kontraknya. */
    [extra: string]: unknown;
  };
};

export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
  retried = false,
): Promise<Paged<T>> {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (method !== 'GET') headers.set('x-csrf-token', csrf());
  const res = await fetch(path, {
    ...init,
    method,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });

  if (res.status === 401 && !retried && !path.startsWith('/api/v1/auth/')) {
    if (await refreshOnce()) return api<T>(path, { ...init, headers }, true);
    // Utilitas non-React (tanpa router): sesi habis total → muat ulang penuh ke login.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const body = (await res.json().catch(() => null)) as
    | { success: true; data: T; meta?: Paged<T>['meta'] }
    | { success: false; error: ApiError }
    | null;
  if (!body) throw new HttpError(res.status, 'INTERNAL', 'Respons tidak valid');
  if (!body.success)
    throw new HttpError(
      res.status,
      body.error.code,
      body.error.message,
      body.error.reason,
      body.error.details,
    );
  return { data: body.data, meta: body.meta };
}

/** Kunci pesan i18n untuk error (reason > code). */
export const errorKey = (e: unknown) =>
  e instanceof HttpError ? `errors.${e.reason ?? e.code}` : 'errors.generic';

/** Kode yang pesan servernya spesifik untuk kasusnya (mis. "Kode ITEM-1 sudah dipakai"). */
const SPECIFIC = new Set(['NOT_FOUND', 'VALIDATION_ERROR', 'BUSINESS_RULE', 'CONFLICT']);

/**
 * Teks error untuk user: `reason` → i18n (api-design §1.2.1); tanpa reason → pesan server, yang
 * menyebut data penyebabnya (`message` = teks default, api-design §1.1); selain itu i18n per `code`.
 * Validasi payload ikut menampilkan field pertama yang ditolak.
 */
export function errorText(t: (key: string) => string, e: unknown): string {
  if (!(e instanceof HttpError)) return t('errors.generic');
  if (e.reason) return t(`errors.${e.reason}`);
  if (!SPECIFIC.has(e.code) || !e.message) return t(`errors.${e.code}`);
  const first = Array.isArray(e.details)
    ? (e.details[0] as { path?: string; message?: string } | undefined)
    : undefined;
  return first?.message
    ? `${e.message} — ${[first.path, first.message].filter(Boolean).join(': ')}`
    : e.message;
}
