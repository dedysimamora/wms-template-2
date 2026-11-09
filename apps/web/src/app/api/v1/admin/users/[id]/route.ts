import { updateUser } from '@wms/application';
import { userUpdate, uuid } from '@wms/contracts';
import { container } from '@/server/container';
import { authed, ok, parseBody } from '@/server/http';

/** PATCH /api/v1/admin/users/{id} — nama lengkap & email. */
export const PATCH = authed<{ id: string }>(async (ctx, { id }) => {
  const input = await parseBody(ctx, userUpdate);
  return ok(await updateUser(container().uow, ctx.userId, uuid.parse(id), input));
});
