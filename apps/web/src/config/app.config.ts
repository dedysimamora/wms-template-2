/**
 * Katalog menu statis (frontend §5.1). key = menu.code DB (konvensi route: '/', '-' → '_').
 * Tes `test/menu-sync.test.ts` memverifikasi katalog ini == menu.code di seed.
 *
 * Menambah halaman: tambah leaf('/modul/halaman') di sini + baris menu & RBAC di seed.sql
 * + teks `nav.<key>` di messages/*.json + page.tsx yang memanggil requirePageAccess('<key>').
 */
export type NavIcon = 'box' | 'shield';

export type NavItem = {
  key: string;
  href?: string;
  icon?: NavIcon;
  titleKey: string;
  children?: NavItem[];
};

const leaf = (route: string): NavItem => {
  const key = route.replace(/^\//, '').replace(/[/-]/g, '_');
  return { key, href: route, titleKey: `nav.${key}` };
};

export const NAV: NavItem[] = [
  {
    key: 'sample',
    icon: 'box',
    titleKey: 'nav.sample',
    children: [leaf('/sample/items')],
  },
  {
    key: 'admin',
    icon: 'shield',
    titleKey: 'nav.admin',
    children: [leaf('/admin/users')],
  },
];

/** Rute terlindung yang tak berpadanan menu (cukup sesi). */
export const SESSION_ONLY_ROUTES = ['/change-password', '/forbidden'];
