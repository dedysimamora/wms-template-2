import { setUserRoles } from '@wms/application';
import { userRolesPut, uuid } from '@wms/contracts';
import { container } from '@/server/container';
import { authed, ok, parseBody } from '@/server/http';

/** PUT /api/v1/admin/users/{id}/roles — ganti seluruh role user. */
export const PUT = authed<{ id: string }>(async (ctx, { id }) => {
  const { role_ids } = await parseBody(ctx, userRolesPut);
  return ok(await setUserRoles(container().uow, ctx.userId, uuid.parse(id), role_ids));
});
