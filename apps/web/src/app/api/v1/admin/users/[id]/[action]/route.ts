import { z } from 'zod';
import { userAction } from '@wms/application';
import { USER_ACTIONS, uuid } from '@wms/contracts';
import { container } from '@/server/container';
import { authed, ok, parseBody } from '@/server/http';

/** POST /api/v1/admin/users/{id}/{activate|deactivate|unlock|reset-password|revoke-sessions} */
export const POST = authed<{ id: string; action: string }>(async (ctx, p) => {
  const action = z.enum(USER_ACTIONS).parse(p.action);
  const body = await parseBody(ctx, z.unknown());
  return ok(await userAction(container().userAdmin, ctx.userId, uuid.parse(p.id), action, body));
});
