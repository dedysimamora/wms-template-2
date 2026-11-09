// Salin brands/<BRAND_ID>/ → src/brand/ (kode) & public/branding/ (aset). Dijalankan sebelum dev/build/type-check.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.env.BRAND_ID || 'default';
const src = path.join(root, 'brands', id);
if (!existsSync(src)) {
  console.error(`Brand "${id}" tidak ditemukan di brands/`);
  process.exit(1);
}
const outCode = path.join(root, 'src', 'brand');
const outPublic = path.join(root, 'public', 'branding');
for (const d of [outCode, outPublic]) {
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
}
cpSync(path.join(src, 'brand.ts'), path.join(outCode, 'brand.ts'));
cpSync(path.join(src, 'tokens.css'), path.join(outCode, 'tokens.css'));
cpSync(path.join(src, 'logo.svg'), path.join(outPublic, 'logo.svg'));
console.log(`brand: ${id}`);
