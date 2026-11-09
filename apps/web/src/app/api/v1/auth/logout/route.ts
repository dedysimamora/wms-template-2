import type { NextRequest } from 'next/server';
import { logout } from '@wms/application';
import { container } from '@/server/container';
import { clearSessionCookies, COOKIE } from '@/server/cookies';
import { assertCsrf, ok, requestMeta, toErrorResponse } from '@/server/http';

export async function POST(req: NextRequest) {
  try {
    assertCsrf(req, { requireToken: false });
    await logout(container().auth, req.cookies.get(COOKIE.refresh)?.value, requestMeta(req));
  } catch (e) {
    container().logger.warn({ err: e }, 'logout gagal mencabut token');
  }
  const res = ok({ loggedOut: true });
  clearSessionCookies(res);
  return res;
}
