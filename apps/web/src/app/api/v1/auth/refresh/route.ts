import { NextResponse, type NextRequest } from 'next/server';
import { refreshSession } from '@wms/application';
import { DomainError } from '@wms/domain';
import { container } from '@/server/container';
import { clearSessionCookies, COOKIE, setSessionCookies } from '@/server/cookies';
import { assertCsrf, ok, requestMeta, toErrorResponse } from '@/server/http';

/** Hanya path relatif internal (cegah open redirect). */
const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

/**
 * Redirect ber-`Location` relatif. `new URL(path, req.url)` memakai alamat bind server standalone
 * (`HOSTNAME=0.0.0.0:<PORT>`), bukan host publik di balik reverse proxy/tunnel — browser lalu
 * dilempar ke `http://0.0.0.0:…`. Path relatif selalu diselesaikan browser terhadap origin yang dibuka.
 */
const redirectTo = (path: string) =>
  new NextResponse(null, { status: 307, headers: { location: path } });

async function rotate(req: NextRequest) {
  const raw = req.cookies.get(COOKIE.refresh)?.value;
  if (!raw) return null;
  return refreshSession(container().auth, raw, requestMeta(req));
}

/** Navigasi halaman: proxy mengarahkan ke sini saat access token habis → rotasi → kembali ke `next`. */
export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get('next'));
  try {
    const r = await rotate(req);
    if (!r) throw new Error('no refresh');
    const res = redirectTo(next);
    await setSessionCookies(res, r.tokens, r.me, container().env);
    return res;
  } catch {
    const res = redirectTo(`/login?next=${encodeURIComponent(next)}`);
    clearSessionCookies(res);
    return res;
  }
}

/** Fetch klien (single-flight di services/http): 401 → POST refresh → ulang request. */
export async function POST(req: NextRequest) {
  try {
    assertCsrf(req);
    const r = await rotate(req);
    if (!r) throw new DomainError('UNAUTHENTICATED', undefined, 'Tidak ada sesi');
    const res = ok({ me: r.me });
    await setSessionCookies(res, r.tokens, r.me, container().env);
    return res;
  } catch (e) {
    const res = toErrorResponse(e);
    clearSessionCookies(res);
    return res;
  }
}
