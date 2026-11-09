import { readFileSync } from 'node:fs';
import path from 'node:path';

export const dynamic = 'force-dynamic';

let build: string | null | undefined;
/** BUILD_ID Next: memastikan proses yang menjawab = artefak yang baru di-deploy (runbook §17). */
function buildId() {
  if (build === undefined) {
    try {
      build = readFileSync(path.join(process.cwd(), '.next/BUILD_ID'), 'utf8').trim();
    } catch {
      build = null;
    }
  }
  return build;
}

/** Liveness (api-design §1.8). Tanpa data sensitif. */
export function GET() {
  return Response.json({ status: 'ok', build: buildId() });
}
