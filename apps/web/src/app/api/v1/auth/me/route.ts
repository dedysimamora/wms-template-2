import { getMe } from '@wms/application';
import { container } from '@/server/container';
import { authed, ok } from '@/server/http';

export const GET = authed(async ({ userId }) => ok(await getMe(container().auth, userId)));
