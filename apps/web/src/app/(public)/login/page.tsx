import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { LoginForm } from '@/features/auth/login-form';

export const metadata = { title: 'Login' };

export default async function LoginPage() {
  const t = await getTranslations('auth');
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">{t('title')}</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </>
  );
}
