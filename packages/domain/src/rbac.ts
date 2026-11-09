/**
 * RBAC bitmask (frontend §5.4): 4 flag CRUD per menu.code, deny-by-default.
 * Tidak ada izin yang disuntikkan/di-hardcode di sini — map hanya berasal dari role_menu_access.
 */
export const PERMISSION = { READ: 1, CREATE: 2, EDIT: 4, DELETE: 8 } as const;
export type PermissionBit = (typeof PERMISSION)[keyof typeof PERMISSION];
export type CrudAction = 'view' | 'create' | 'edit' | 'delete';

export type MenuAccessFlags = { view: boolean; create: boolean; edit: boolean; delete: boolean };
export type MenuAccess = Record<string, MenuAccessFlags>;
export type PermissionMap = Record<string, number>;

export const ACTION_BIT: Record<CrudAction, PermissionBit> = {
  view: PERMISSION.READ,
  create: PERMISSION.CREATE,
  edit: PERMISSION.EDIT,
  delete: PERMISSION.DELETE,
};

export function toBitmask(flags: MenuAccessFlags): number {
  return (
    (flags.view ? PERMISSION.READ : 0) |
    (flags.create ? PERMISSION.CREATE : 0) |
    (flags.edit ? PERMISSION.EDIT : 0) |
    (flags.delete ? PERMISSION.DELETE : 0)
  );
}

export function toPermissionMap(access: MenuAccess): PermissionMap {
  const map: PermissionMap = {};
  for (const [code, flags] of Object.entries(access)) {
    const mask = toBitmask(flags);
    if (mask !== 0) map[code] = mask; // baris all-false = deny eksplisit → tidak dikirim
  }
  return map;
}

/** Union hak dari beberapa role (user multi-role). */
export function mergeMenuAccess(
  rows: ReadonlyArray<{ menuCode: string } & MenuAccessFlags>,
): MenuAccess {
  const out: MenuAccess = {};
  for (const r of rows) {
    const cur = out[r.menuCode] ?? { view: false, create: false, edit: false, delete: false };
    out[r.menuCode] = {
      view: cur.view || r.view,
      create: cur.create || r.create,
      edit: cur.edit || r.edit,
      delete: cur.delete || r.delete,
    };
  }
  return out;
}

export function can(
  map: PermissionMap | null | undefined,
  menuCode: string,
  action: CrudAction,
): boolean {
  if (!map) return false;
  const mask = map[menuCode] ?? 0;
  const bit = ACTION_BIT[action];
  return (mask & bit) === bit;
}

/** Konvensi kode menu (frontend §2.1): route tanpa '/' awal, '/' dan '-' → '_'. */
export function menuCodeFromRoute(route: string): string {
  return route.replace(/^\/+/, '').replace(/[/-]/g, '_');
}
