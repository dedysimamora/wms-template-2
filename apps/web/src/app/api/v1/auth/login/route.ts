import type { NextRequest } from 'next/server';
import { login } from '@wms/application';
import { loginRequest } from '@wms/contracts';
import { container } from '@/server/container';
import { setSessionCookies } from '@/server/cookies';
import { assertCsrf, ok, parseBody, requestMeta, toErrorResponse } from '@/server/http';

export async function POST(req: NextRequest) {
  try {
    assertCsrf(req, { requireToken: false }); // belum ada sesi → cukup same-origin
    const c = container();
    const input = await parseBody({ body: () => req.text() }, loginRequest);
    const { tokens, me } = await login(c.auth, input, requestMeta(req));
    const res = ok({ me });
    await setSessionCookies(res, tokens, me, c.env);
    return res;
  } catch (e) {
    return toErrorResponse(e);
  }
}
