import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { DomainError, isDomainError } from '@wms/domain';
import type { ApiError } from '@wms/contracts';
import { container } from './container';
import { COOKIE } from './cookies';

/**
 * Adapter HTTP (api-design §1): envelope `{ success, data, meta }` / `{ success:false, error }`,
 * pemetaan DomainError & ZodError → status HTTP, autentikasi cookie/Bearer, CSRF.
 * Pola route handler terlindung:
 *
 *   export const GET = authed(async (ctx) => ok(await useCase(container().uow, ctx.userId, ...)));
 */
export type Ctx = {
  req: NextRequest;
  userId: string;
  meta: { ip: string | null; userAgent: string | null };
  /** Body mentah (dibaca sekali) — dasar parseBody. */
  body: () => Promise<string>;
};

export const ok = <T>(data: T, init?: ResponseInit & { meta?: Record<string, unknown> }) =>
  NextResponse.json({ success: true, data, ...(init?.meta ? { meta: init.meta } : {}) }, init);

export function fail(status: number, error: ApiError) {
  return NextResponse.json({ success: false, error }, { status });
}

export function toErrorResponse(e: unknown): NextResponse {
  if (isDomainError(e)) {
    return fail(e.httpStatus, {
      code: e.code,
      ...(e.reason && { reason: e.reason }),
      message: e.message,
      ...(e.details !== undefined && { details: e.details }),
    });
  }
  if (e instanceof ZodError) {
    return fail(400, {
      code: 'VALIDATION_ERROR',
      message: 'Payload tidak valid',
      details: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  container().logger.error({ err: e }, 'unhandled error');
  return fail(500, { code: 'INTERNAL', message: 'Kesalahan server' });
}

export function requestMeta(req: NextRequest) {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent'),
  };
}

/** Same-origin + double-submit CSRF untuk mutasi berbasis cookie (frontend §7.2). */
export function assertCsrf(req: NextRequest, { requireToken = true } = {}) {
  const origin = req.headers.get('origin') ?? req.headers.get('referer');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) {
    throw new DomainError('FORBIDDEN', undefined, 'Origin tidak sah (CSRF)');
  }
  if (!requireToken) return;
  const header = req.headers.get('x-csrf-token');
  const cookie = req.cookies.get(COOKIE.csrf)?.value;
  if (!header || !cookie || header !== cookie)
    throw new DomainError('FORBIDDEN', undefined, 'Token CSRF tidak valid');
}

const MUST_CHANGE_ALLOWED = new Set([
  '/api/v1/auth/change-password',
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
]);

/** Autentikasi request: cookie access_token (web) atau Authorization: Bearer (tool/skrip). */
export async function authenticate(
  req: NextRequest,
): Promise<{ userId: string; viaCookie: boolean }> {
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  const token = bearer ?? req.cookies.get(COOKIE.access)?.value;
  if (!token) throw new DomainError('UNAUTHENTICATED', undefined, 'Belum login');
  const claims = await container().tokens.verifyAccess(token);
  if (!claims)
    throw new DomainError('UNAUTHENTICATED', undefined, 'Token tidak valid atau kedaluwarsa');
  if (claims.mustChangePassword && !MUST_CHANGE_ALLOWED.has(req.nextUrl.pathname)) {
    throw new DomainError('FORBIDDEN', 'MUST_CHANGE_PASSWORD', 'Ganti password terlebih dahulu');
  }
  return { userId: claims.sub, viaCookie: !bearer };
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Wrapper route handler terautentikasi: auth → CSRF (mutasi, mode cookie) → handler → envelope/error.
 * Otorisasi menu (RBAC) TIDAK di sini — dilakukan use-case lewat `authorize()`.
 */
export function authed<P = unknown>(handler: (ctx: Ctx, params: P) => Promise<Response>) {
  return async (req: NextRequest, { params }: { params: Promise<P> }) => {
    try {
      const { userId, viaCookie } = await authenticate(req);
      if (viaCookie && MUTATING.has(req.method)) assertCsrf(req);
      let raw: Promise<string> | undefined;
      const body = () => (raw ??= req.text());
      return await handler({ req, userId, meta: requestMeta(req), body }, await params);
    } catch (e) {
      return toErrorResponse(e);
    }
  };
}

/** Body JSON → divalidasi schema zod (gagal → 400 VALIDATION_ERROR). */
export async function parseBody<T>(ctx: Pick<Ctx, 'body'>, schema: ZodType<T>): Promise<T> {
  const text = await ctx.body();
  let json: unknown;
  try {
    json = text.trim() === '' ? {} : JSON.parse(text);
  } catch {
    throw new DomainError('VALIDATION_ERROR', undefined, 'Body bukan JSON valid');
  }
  return schema.parse(json);
}

/** Query string → divalidasi schema zod. */
export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams));
}

/** Respons list ber-paging: data = rows, meta = { page, per_page, total }. */
export const paged = <T>(r: { rows: T[]; total: number }, q: { page: number; per_page: number }) =>
  ok(r.rows, { meta: { page: q.page, per_page: q.per_page, total: r.total } });
