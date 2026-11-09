import { and, eq } from 'drizzle-orm';
import { schema } from '@wms/db';
import type { AccessRepository, SettingsRepository } from '@wms/application';
import type { Tx } from './tx';

const { userRole, role, roleMenuAccess, menu, appSetting, appUser } = schema;

export class DrizzleAccessRepository implements AccessRepository {
  constructor(private readonly tx: Tx) {}
  async rolesOf(userId: string) {
    const rows = await this.tx
      .select({ code: role.code })
      .from(userRole)
      .innerJoin(role, eq(role.id, userRole.roleId))
      .where(eq(userRole.userId, userId))
      .orderBy(role.code);
    return rows.map((r) => r.code);
  }
  async menuAccessRows(userId: string) {
    return (
      this.tx
        .select({
          menuCode: menu.code,
          view: roleMenuAccess.canView,
          create: roleMenuAccess.canCreate,
          edit: roleMenuAccess.canEdit,
          delete: roleMenuAccess.canDelete,
        })
        .from(userRole)
        .innerJoin(roleMenuAccess, eq(roleMenuAccess.roleId, userRole.roleId))
        .innerJoin(menu, and(eq(menu.id, roleMenuAccess.menuId), eq(menu.isActive, true)))
        // hak hanya dihitung untuk user ACTIVE → nonaktifkan user berlaku seketika
        .innerJoin(appUser, eq(appUser.id, userRole.userId))
        .where(and(eq(userRole.userId, userId), eq(appUser.status, 'ACTIVE')))
    );
  }
}

export class DrizzleSettingsRepository implements SettingsRepository {
  constructor(private readonly tx: Tx) {}
  async all() {
    const rows = await this.tx
      .select({ key: appSetting.key, value: appSetting.value, dataType: appSetting.dataType })
      .from(appSetting);
    return Object.fromEntries(rows.map((r) => [r.key, { value: r.value, dataType: r.dataType }]));
  }
}
