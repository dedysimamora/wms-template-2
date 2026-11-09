import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { ChangePasswordForm } from '@/features/auth/change-password-form';
import { getSession } from '@/server/guards';

export default async function ChangePasswordPage() {
  const s = await getSession();
  if (!s) redirect('/login');
  const t = await getTranslations('auth');
  return (
    <>
      <h1 className="mb-2 text-xl font-semibold">{t('changePassword')}</h1>
      {s.user.must_change_password && (
        <p className="mb-4 text-sm text-muted-foreground">{t('mustChange')}</p>
      )}
      <ChangePasswordForm />
    </>
  );
}
