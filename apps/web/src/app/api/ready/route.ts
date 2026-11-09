import { currentSchemaVersion, isSchemaInRange } from '@wms/db';
import { container } from '@/server/container';

export const dynamic = 'force-dynamic';

/** Readiness: DB reachable + versi schema_migration di rentang app (migration §4). */
export async function GET() {
  try {
    const c = container();
    const version = await currentSchemaVersion(c.pool);
    const ok = isSchemaInRange(version, c.env.SCHEMA_MIN_VERSION, c.env.SCHEMA_MAX_VERSION);
    return Response.json(
      {
        status: ok ? 'ready' : 'schema_mismatch',
        schema: version,
        supported: [c.env.SCHEMA_MIN_VERSION, c.env.SCHEMA_MAX_VERSION],
      },
      { status: ok ? 200 : 503 },
    );
  } catch {
    return Response.json({ status: 'db_unreachable' }, { status: 503 });
  }
}
