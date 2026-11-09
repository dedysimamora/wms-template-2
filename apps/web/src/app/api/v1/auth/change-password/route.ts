import { changePassword } from '@wms/application';
import { changePasswordRequest } from '@wms/contracts';
import { container } from '@/server/container';
import { clearSessionCookies } from '@/server/cookies';
import { authed, ok, parseBody } from '@/server/http';

/** Ganti password → semua sesi dicabut → login ulang (auth-session §2). */
export const POST = authed(async (ctx) => {
  await changePassword(
    container().auth,
    ctx.userId,
    await parseBody(ctx, changePasswordRequest),
    ctx.meta,
  );
  const res = ok({ changed: true });
  clearSessionCookies(res);
  return res;
});
