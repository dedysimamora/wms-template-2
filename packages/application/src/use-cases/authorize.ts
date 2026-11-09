import {
  can,
  DomainError,
  mergeMenuAccess,
  toPermissionMap,
  type CrudAction,
  type MenuAccess,
  type PermissionMap,
} from '@wms/domain';
import type { Repos } from '../ports';

/**
 * Menu yang disembunyikan bila feature flag-nya mati (app_setting). Contoh: matikan
 * `enable_sample_items` → menu Sample Items hilang dari sidebar DAN API-nya 403.
 */
const MENU_FLAGS: Record<string, string> = {
  sample_items: 'enable_sample_items',
};

export function isTrue(v: string | null | undefined) {
  return v === 'true';
}

/** menuAccess efektif = union hak semua role ∩ feature flag (api-design §2). */
export async function effectiveMenuAccess(repos: Repos, userId: string): Promise<MenuAccess> {
  // Sekuensial: semua repo berbagi SATU koneksi transaksi — query paralel pada satu klien pg tidak didukung.
  const rows = await repos.access.menuAccessRows(userId);
  const settings = await repos.settings.all();
  const merged = mergeMenuAccess(rows);
  for (const [menu, flag] of Object.entries(MENU_FLAGS)) {
    if (!isTrue(settings[flag]?.value)) delete merged[menu];
  }
  for (const [code, f] of Object.entries(merged)) {
    if (!f.view && !f.create && !f.edit && !f.delete) delete merged[code];
  }
  return merged;
}

export async function permissionsOf(r: Repos, actor: string): Promise<PermissionMap> {
  return toPermissionMap(await effectiveMenuAccess(r, actor));
}

/**
 * Guard server-side per request. WAJIB dipanggil di awal setiap use-case (di dalam uow.run)
 * dengan menu.code + aksi CRUD. Melempar 403 bila tak berhak.
 */
export async function authorize(
  repos: Repos,
  userId: string,
  menuCode: string,
  action: CrudAction,
) {
  if (!can(await permissionsOf(repos, userId), menuCode, action)) {
    throw new DomainError('FORBIDDEN', undefined, `Tidak berhak ${action} pada ${menuCode}`);
  }
}
