import { deleteSampleItem, getSampleItem, updateSampleItem } from '@wms/application';
import { sampleItemUpdate, uuid } from '@wms/contracts';
import { container } from '@/server/container';
import { authed, ok, parseBody } from '@/server/http';

type P = { id: string };

/** GET /api/v1/sample/items/{id} */
export const GET = authed<P>(async (ctx, { id }) =>
  ok(await getSampleItem(container().uow, ctx.userId, uuid.parse(id))),
);

/** PATCH /api/v1/sample/items/{id} */
export const PATCH = authed<P>(async (ctx, { id }) => {
  const input = await parseBody(ctx, sampleItemUpdate);
  return ok(await updateSampleItem(container().uow, ctx.userId, uuid.parse(id), input));
});

/** DELETE /api/v1/sample/items/{id} */
export const DELETE = authed<P>(async (ctx, { id }) =>
  ok(await deleteSampleItem(container().uow, ctx.userId, uuid.parse(id))),
);
