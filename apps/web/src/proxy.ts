import { jwtVerify } from 'jose';
import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE } from '@/server/cookies';
import { unsealSession } from '@/server/session-seal';

/**
 * Proxy (Next 16, frontend §6.2) — ringan, tanpa DB:
 *  1. teruskan pathname ke Server Component lewat REQUEST headers (bukan res.headers);
 *  2. access token habis/tidak ada → /api/v1/auth/refresh?next=… (satu-satunya path yang menerima cookie refresh);
 *  3. must_change_password → paksa /change-password.
 * Otorisasi menu TIDAK di sini — dilakukan requirePageAccess di tiap page (otoritatif, DB).
 */
const PUBLIC = ['/login'];
const key = () => new TextEncoder().encode(process.env.JWT_SECRET ?? '');

async function validAccess(token: string | undefined) {
  if (!token) return false;
  try {
    await jwtVerify(token, key(), { issuer: 'wms', algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const headers = new Headers(req.headers);
  headers.set('x-request-pathname', pathname);
  const pass = () => NextResponse.next({ request: { headers } });

  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return pass();

  if (!(await validAccess(req.cookies.get(COOKIE.access)?.value))) {
    const url = new URL('/api/v1/auth/refresh', req.url);
    url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }

  const view = await unsealSession(
    req.cookies.get(COOKIE.session)?.value,
    process.env.SESSION_SECRET ?? '',
  );
  if (!view) {
    const url = new URL('/api/v1/auth/refresh', req.url);
    url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }
  if (view.user.must_change_password && pathname !== '/change-password') {
    return NextResponse.redirect(new URL('/change-password', req.url));
  }
  return pass();
}

export const config = {
  // Lewati API (punya autentikasi sendiri), aset Next, branding, dan file statis.
  matcher: [
    '/((?!api|_next/static|_next/image|branding|favicon.ico|.*\\.(?:svg|png|jpg|ico|webmanifest)$).*)',
  ],
};
