import { can } from '@wms/domain';
import { SampleItemsFeature } from '@/features/sample-items';
import { requirePageAccess } from '@/server/guards';

export const metadata = { title: 'Sample Items' };

/**
 * CONTOH HALAMAN — pola 1 fitur = 1 page:
 *  1. requirePageAccess('<menu.code>') → wajib di SETIAP page terlindung (cek RBAC ke DB);
 *  2. turunkan hak per aksi (create/edit/delete) sebagai props → UI menyembunyikan tombol;
 *  3. render komponen fitur (client) dari src/features/<nama>.
 * Tombol yang disembunyikan hanya kenyamanan; penegakan tetap di server (use-case `authorize`).
 */
export default async function SampleItemsPage() {
  const s = await requirePageAccess('sample_items');
  return (
    <SampleItemsFeature
      canCreate={can(s.permissions, 'sample_items', 'create')}
      canEdit={can(s.permissions, 'sample_items', 'edit')}
      canDelete={can(s.permissions, 'sample_items', 'delete')}
    />
  );
}
