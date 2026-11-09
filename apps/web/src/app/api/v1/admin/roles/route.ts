import { listRoles } from '@wms/application';
import { container } from '@/server/container';
import { authed, ok } from '@/server/http';

/** GET /api/v1/admin/roles — pilihan role untuk form user. */
export const GET = authed(async (ctx) => ok(await listRoles(container().uow, ctx.userId)));
