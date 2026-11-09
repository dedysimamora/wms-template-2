import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { can, menuCodeFromRoute } from '@wms/domain';
import { NAV, type NavItem } from '@/config/app.config';
import { buildAuthorizedNavigation } from '@/lib/authz/navigation';
import { menuForPath } from '@/lib/authz/route-access';

const root = path.resolve(import.meta.dirname, '../../..');
const seed = readFileSync(path.join(root, 'packages/db/seed/seed.sql'), 'utf8');
const menuSection = seed.slice(seed.indexOf('-- 2. MENU'), seed.indexOf('-- 3. ROLE'));
const seedCodes = new Set([...menuSection.matchAll(/^\s*\('([a-z_]+)',\s+'/gm)].map((m) => m[1]!));
const flatten = (i: readonly NavItem[]): NavItem[] =>
  i.flatMap((x) => [x, ...(x.children ? flatten(x.children) : [])]);
const navCodes = new Set(flatten(NAV).map((i) => i.key));

describe('sinkron katalog menu FE ↔ seed (frontend §2.1, test-delivery §7)', () => {
  it('kunci NAV == menu.code seed', () => {
    expect(seedCodes.size).toBe(4);
    expect([...navCodes].sort()).toEqual([...seedCodes].sort());
  });
  it('konvensi: key = route dengan /,- → _ (tanpa singkatan)', () => {
    for (const i of flatten(NAV).filter((x) => x.href))
      expect(menuCodeFromRoute(i.href!), i.href).toBe(i.key);
  });
  it('route → menu (longest-prefix); rute asing = undefined (deny)', () => {
    expect(menuForPath('/sample/items')).toBe('sample_items');
    expect(menuForPath('/sample/items/123')).toBe('sample_items');
    expect(menuForPath('/admin/users')).toBe('admin_users');
    expect(menuForPath('/change-password')).toBeNull();
    expect(menuForPath('/rahasia')).toBeUndefined();
  });
});

describe('navigasi = katalog ∩ akses', () => {
  it('deny-by-default & grup kosong disembunyikan', () => {
    const nav = buildAuthorizedNavigation({ sample_items: 1 }); // STAFF: tanpa admin_users
    expect(nav.map((n) => n.key)).toEqual(['sample']);
    expect(nav[0]!.children!.map((c) => c.key)).toEqual(['sample_items']);
    expect(buildAuthorizedNavigation({})).toEqual([]);
    expect(can({ sample_items: 2 }, 'sample_items', 'view')).toBe(false); // create tanpa view ≠ tampil
  });
});

describe('guard wajib per page (frontend §6.3, pengganti lint require-page-guard)', () => {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = path.join(d, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const appDir = path.resolve(import.meta.dirname, '../src/app');
  const pages = walk(appDir).filter((p) => p.endsWith('page.tsx') && p.includes('(protected)'));
  it.each(pages.map((p) => [path.relative(appDir, p), p]))('%s memanggil guard', (_n, p) => {
    const src = readFileSync(p, 'utf8');
    expect(/requirePageAccess\(|requireSession\(/.test(src)).toBe(true);
  });
  it('page (protected) ber-menu memakai requirePageAccess, bukan hanya sesi', () => {
    for (const p of pages.filter((x) => x.includes('(protected)')))
      expect(readFileSync(p, 'utf8'), p).toMatch(/requirePageAccess\(/);
  });
});
