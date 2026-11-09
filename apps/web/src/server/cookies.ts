import type { NextResponse } from 'next/server';
import type { MeResponse } from '@wms/contracts';
import type { SessionTokens } from '@wms/application';
import { randomToken, sealSession } from './session-seal';

export const COOKIE = {
  access: 'access_token',
  refresh: 'refresh_token',
  session: 'user_session',
  csrf: 'csrf_token',
} as const;

/** Refresh token hanya dikirim ke endpoint auth (path sempit) — proxy mengarahkan ke sana saat perlu. */
export const REFRESH_PATH = '/api/v1/auth';

/**
 * Cookie `Secure` (hanya dikirim lewat HTTPS): default aktif di production. COOKIE_SECURE=false
 * hanya untuk uji deploy tanpa TLS (mis. akses IP di LAN) — jangan dipakai di produksi.
 */
const secure = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : process.env.NODE_ENV === 'production';

export async function setSessionCookies(
  res: NextResponse,
  tokens: SessionTokens,
  me: MeResponse,
  env: { SESSION_SECRET: string; ACCESS_TOKEN_TTL_SECONDS: number },
) {
  const accessMaxAge = Math.max(
    1,
    Math.floor((tokens.accessExpiresAt.getTime() - Date.now()) / 1000),
  );
  const refreshMaxAge = Math.max(
    1,
    Math.floor((tokens.refreshExpiresAt.getTime() - Date.now()) / 1000),
  );
  const base = { httpOnly: true, secure, sameSite: 'lax' as const };
  res.cookies.set(COOKIE.access, tokens.accessToken, { ...base, path: '/', maxAge: accessMaxAge });
  res.cookies.set(COOKIE.refresh, tokens.refreshToken, {
    ...base,
    path: REFRESH_PATH,
    maxAge: refreshMaxAge,
  });
  res.cookies.set(
    COOKIE.session,
    await sealSession(me, env.SESSION_SECRET, env.ACCESS_TOKEN_TTL_SECONDS),
    {
      ...base,
      path: '/',
      maxAge: accessMaxAge,
    },
  );
  res.cookies.set(COOKIE.csrf, randomToken(), {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: refreshMaxAge,
  });
}

export function clearSessionCookies(res: NextResponse) {
  for (const [name, path] of [
    [COOKIE.access, '/'],
    [COOKIE.session, '/'],
    [COOKIE.csrf, '/'],
    [COOKIE.refresh, REFRESH_PATH],
  ] as const) {
    res.cookies.set(name, '', { path, maxAge: 0 });
  }
}
