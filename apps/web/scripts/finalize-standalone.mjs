// Output standalone (ADR-001) tidak menyertakan aset statis & public — salin agar artefak siap jalan.
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(web, '.next/standalone/apps/web');
if (!existsSync(out)) process.exit(0);
cpSync(path.join(web, '.next/static'), path.join(out, '.next/static'), { recursive: true });
cpSync(path.join(web, 'public'), path.join(out, 'public'), { recursive: true });
console.log('standalone siap: node .next/standalone/apps/web/server.js');
