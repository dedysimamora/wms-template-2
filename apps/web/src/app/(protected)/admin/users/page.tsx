import { can } from '@wms/domain';
import { UsersFeature } from '@/features/admin-users';
import { requirePageAccess } from '@/server/guards';

export const metadata = { title: 'Users' };

/** Halaman Users — hanya role ber-hak `admin_users` (seed: ADMIN). Selain itu → /forbidden. */
export default async function UsersPage() {
  const s = await requirePageAccess('admin_users');
  return (
    <UsersFeature
      me={s.userId}
      canCreate={can(s.permissions, 'admin_users', 'create')}
      canEdit={can(s.permissions, 'admin_users', 'edit')}
    />
  );
}
