import { createUser, listUsers } from '@wms/application';
import { userCreate, userListQuery } from '@wms/contracts';
import { container } from '@/server/container';
import { authed, ok, paged, parseBody, parseQuery } from '@/server/http';

/** GET /api/v1/admin/users?q=&status=&role_id=&page=&per_page= */
export const GET = authed(async (ctx) => {
  const q = parseQuery(ctx.req, userListQuery);
  return paged(await listUsers(container().uow, ctx.userId, q), q);
});

/** POST /api/v1/admin/users — user baru wajib ganti password saat login pertama. */
export const POST = authed(async (ctx) => {
  const input = await parseBody(ctx, userCreate);
  return ok(await createUser(container().userAdmin, ctx.userId, input), { status: 201 });
});
