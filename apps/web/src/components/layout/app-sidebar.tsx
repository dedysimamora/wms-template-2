'use client';
import { Box, ChevronRight, Circle, Shield, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore, type ReactNode } from 'react';
import { BRAND } from '@/brand/brand';
import type { NavIcon, NavItem } from '@/config/app.config';
import { cn } from '@/lib/cn';

/** Ikon menu induk — tambah ikon lucide di sini saat menambah modul baru (lihat NavIcon). */
const ICONS: Record<NavIcon, LucideIcon> = {
  box: Box,
  shield: Shield,
};
const iconOf = (n?: NavIcon) => (n ? ICONS[n] : Circle);

/** Rute aktif = sama persis atau turunannya (halaman detail). */
export const isActiveHref = (path: string, href?: string) =>
  !!href && (path === href || path.startsWith(`${href}/`));

/** Kepala sidebar (logo + nama brand); `children` = aksi tambahan di kanan (mis. tutup laci). */
export function SidebarBrand({ children }: { children?: ReactNode }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={BRAND.logo} alt="" className="size-7 rounded-md" />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-semibold">{BRAND.name}</span>
      </span>
      {children}
    </div>
  );
}

/* Grup yang dilipat user disimpan per peramban (preferensi tampilan, bukan data). */
const STORE_KEY = 'wms.nav.collapsed';
const listeners = new Set<() => void>();
const readCollapsed = () => {
  try {
    return localStorage.getItem(STORE_KEY) ?? '';
  } catch {
    return '';
  }
};
function toggleCollapsed(key: string) {
  const set = new Set(readCollapsed().split(',').filter(Boolean));
  if (set.has(key)) set.delete(key);
  else set.add(key);
  try {
    localStorage.setItem(STORE_KEY, [...set].join(','));
  } catch {
    /* penyimpanan diblokir — abaikan */
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const itemBase =
  'flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-[0.8125rem] transition-colors duration-(--duration-fast) hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const itemActive =
  'bg-surface-1 font-medium text-foreground shadow-xs ring-1 ring-border hover:bg-surface-1';

export function AppSidebar({ items }: { items: NavItem[] }) {
  const t = useTranslations();
  const path = usePathname();
  const collapsed = new Set(
    useSyncExternalStore(subscribe, readCollapsed, () => '')
      .split(',')
      .filter(Boolean),
  );
  return (
    <nav aria-label={t('app.mainMenu')} className="flex flex-col gap-0.5 px-3 pt-1 pb-4">
      {items.map((item) => {
        const Icon = iconOf(item.icon);
        if (!item.children) {
          const on = isActiveHref(path, item.href);
          return (
            <Link
              key={item.key}
              href={item.href!}
              aria-current={on ? 'page' : undefined}
              className={cn(itemBase, 'text-muted-foreground', on && itemActive)}
            >
              <Icon className={cn('size-4', on && 'text-primary')} aria-hidden />
              {t(item.titleKey)}
            </Link>
          );
        }
        const hasActive = item.children.some((c) => isActiveHref(path, c.href));
        const open = hasActive || !collapsed.has(item.key);
        const name = t(item.titleKey);
        return (
          <div key={item.key} className="mt-3">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={`nav-${item.key}`}
              aria-label={t('app.toggleGroup', { name })}
              disabled={hasActive}
              onClick={() => toggleCollapsed(item.key)}
              className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
            >
              <Icon className={cn('size-4', hasActive && 'text-primary')} aria-hidden />
              <span className="flex-1 text-left">{name}</span>
              <ChevronRight
                className={cn(
                  'size-3.5 opacity-0 transition-transform duration-(--duration-fast) group-hover:opacity-100 group-focus-visible:opacity-100',
                  open && 'rotate-90',
                  hasActive && 'hidden',
                )}
                aria-hidden
              />
            </button>
            {open && (
              <div id={`nav-${item.key}`} className="mt-0.5 flex flex-col gap-0.5">
                {item.children.map((c) => {
                  const on = isActiveHref(path, c.href);
                  return (
                    <Link
                      key={c.key}
                      href={c.href!}
                      aria-current={on ? 'page' : undefined}
                      className={cn(itemBase, 'pl-9 text-muted-foreground', on && itemActive)}
                    >
                      {t(c.titleKey)}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/** Jejak navigasi header: grup › halaman, diturunkan dari katalog menu (tanpa konfigurasi per page). */
export function Breadcrumb({ items }: { items: NavItem[] }) {
  const t = useTranslations();
  const path = usePathname();
  let trail: NavItem[] = [];
  for (const item of items) {
    if (isActiveHref(path, item.href)) trail = [item];
    const child = item.children?.find((c) => isActiveHref(path, c.href));
    if (child) trail = [item, child];
  }
  if (trail.length === 0) return null;
  const leaf = trail[trail.length - 1]!;
  const isDetail = leaf.href !== path;
  return (
    <nav aria-label={t('app.breadcrumb')} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {trail.map((n, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={n.key} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && (
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              {last && isDetail ? (
                <Link
                  href={n.href!}
                  className="truncate text-muted-foreground hover:text-foreground"
                >
                  {t(n.titleKey)}
                </Link>
              ) : (
                <span
                  className={cn('truncate', last ? 'font-medium' : 'text-muted-foreground')}
                  aria-current={last ? 'page' : undefined}
                >
                  {t(n.titleKey)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
