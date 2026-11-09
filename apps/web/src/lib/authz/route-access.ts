import { NAV, SESSION_ONLY_ROUTES, type NavItem } from '@/config/app.config';

const flatten = (items: readonly NavItem[]): NavItem[] =>
  items.flatMap((i) => (i.children ? flatten(i.children) : [i]));

const RULES: Array<{ prefix: string; menu: string | null }> = [
  ...flatten(NAV)
    .filter((i) => i.href)
    .map((i) => ({ prefix: i.href!, menu: i.key })),
  ...SESSION_ONLY_ROUTES.map((prefix) => ({ prefix, menu: null })),
].sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * pathname → menu.code (longest-prefix). null = cukup sesi; undefined = rute tak terdaftar (deny).
 */
export function menuForPath(pathname: string): string | null | undefined {
  for (const r of RULES)
    if (pathname === r.prefix || pathname.startsWith(`${r.prefix}/`)) return r.menu;
  return undefined;
}
