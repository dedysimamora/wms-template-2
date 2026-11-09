import { createSampleItem, listSampleItems } from '@wms/application';
import { sampleItemCreate, sampleItemListQuery } from '@wms/contracts';
import { container } from '@/server/container';
import { authed, ok, paged, parseBody, parseQuery } from '@/server/http';

/**
 * CONTOH CRUD NETRAL — route handler = adapter tipis:
 * validasi input (zod contract) → panggil use-case → bungkus envelope. Tanpa logika bisnis.
 */

/** GET /api/v1/sample/items?q=&status=&page=&per_page=&sort= */
export const GET = authed(async (ctx) => {
  const q = parseQuery(ctx.req, sampleItemListQuery);
  return paged(await listSampleItems(container().uow, ctx.userId, q), q);
});

/** POST /api/v1/sample/items */
export const POST = authed(async (ctx) => {
  const input = await parseBody(ctx, sampleItemCreate);
  return ok(await createSampleItem(container().uow, ctx.userId, input), { status: 201 });
});
