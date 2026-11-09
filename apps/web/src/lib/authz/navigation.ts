import { can, type PermissionMap } from '@wms/domain';
import { NAV, type NavItem } from '@/config/app.config';

/** Katalog FE ∩ akses BE (frontend §5.3): item butuh view; grup tampil bila ≥1 anak tampil. */
export function buildAuthorizedNavigation(
  map: PermissionMap,
  items: readonly NavItem[] = NAV,
): NavItem[] {
  return items.flatMap((item) => {
    if (item.children?.length) {
      const children = buildAuthorizedNavigation(map, item.children);
      return children.length ? [{ ...item, children }] : [];
    }
    return can(map, item.key, 'view') ? [item] : [];
  });
}
