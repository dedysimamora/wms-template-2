import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader } from '@/components/blocks/page-header';
import { menuForPath } from '@/lib/authz/route-access';
import { requirePageAccess } from '@/server/guards';

/**
 * Penangkap rute terlindung tanpa page sendiri: rute tak terdaftar di katalog → 404; rute katalog yang
 * belum punya halaman tetap dijaga RBAC (tidak bocor). Jaring
 * untuk menu yang ditambahkan ke katalog sebelum fiturnya dibuat (1 fitur = 1 page).
 */
export default async function ComingSoon({ params }: { params: Promise<{ slug: string[] }> }) {
  const path = `/${(await params).slug.join('/')}`;
  const menu = menuForPath(path);
  if (!menu) notFound();
  await requirePageAccess(menu);
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t(`nav.${menu}`)} />
      <EmptyState title={t('comingSoon.title')} body={t('comingSoon.body')} />
    </>
  );
}
